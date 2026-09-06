/* global module */
// Local, append-only IndexedDB ledger. Shadow forecasts NEVER feed displayed values.
(function(root) {
    'use strict';
    const SCHEMA_VERSION = 1;
    const BASELINE_VERSION = 'ros-v2-availability-shadow-20260906';
    const DB_NAME = 'dhq-forecast-ledger-v1';
    const clone = value => JSON.parse(JSON.stringify(value));
    function canonical(value) {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
        return JSON.stringify(value ?? null);
    }
    async function digest(value) {
        if (!root.crypto?.subtle) throw new Error('Secure hashing unavailable; forecast not recorded');
        const bytes = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
        return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
    }
    function indexedStore() {
        let pending;
        function open() {
            if (pending) return pending;
            pending = new Promise((resolve,reject) => {
                if (!root.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
                const req = root.indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => req.result.createObjectStore('forecasts', {keyPath: 'id'});
                req.onerror = () => reject(req.error);
                req.onblocked = () => reject(new Error('Forecast database upgrade blocked'));
                req.onsuccess = () => {req.result.onversionchange = () => {req.result.close(); pending = null;}; resolve(req.result);};
            }).catch(error => {pending = null; throw error;});
            return pending;
        }
        return {
            async addOnce(record) {
                const db = await open();
                return new Promise((resolve,reject) => {
                    const tx = db.transaction('forecasts', 'readwrite'), store = tx.objectStore('forecasts');
                    let inserted = false;
                    const request = store.get(record.id);
                    request.onsuccess = () => { if (!request.result) {store.add(record); inserted = true;} };
                    tx.oncomplete = () => resolve(inserted);
                    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Forecast write aborted'));
                });
            },
            async all() {
                const db = await open();
                return new Promise((resolve,reject) => {
                    const tx = db.transaction('forecasts', 'readonly'), req = tx.objectStore('forecasts').getAll();
                    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
                });
            },
        };
    }
    function createLedger({store = indexedStore(), hash = digest, now = () => new Date().toISOString()} = {}) {
        const status = {lastCapture: null, error: null, skipped: null};
        async function capture(ctx, result, healthyPerWeek) {
            try {
                // Snapshot mutable app state synchronously before the first await.
                const capturedAt = now();
                const liveSeason = Number(root.S?.nflState?.season || root.S?.currentSeason);
                const season = Number(ctx.league?.season || root.S?.season);
                const week = Number(result.week);
                const type = ctx.skin?.type || root.App?.LeagueSkin?.getCurrent?.()?.type;
                const isCurrentLeague = String(ctx.leagueId) === String(root.S?.currentLeagueId);
                if (!root.App?.AvailabilityForecast || !isCurrentLeague || !season || season !== liveSeason || !['dynasty', 'redraft', 'keeper'].includes(type) || !Number.isInteger(week) || week < 1 || week >= 18 || ctx.horizonWeeks != null) {
                    status.skipped = 'unsupported_or_nonlive_context'; return null;
                }
                if (Number(root.S?.season || season) !== season) {status.skipped = 'historical_stats'; return null;}
                // Chopped's survival horizon and time-travel are deliberately not
                // treated as standard ROS. Reject projected player inputs too.
                if (Object.values(ctx.playersData || {}).some(p => p?._projected)) {status.skipped = 'time_travel'; return null;}
                const endWeek = Number(ctx.league?.settings?.playoff_week_start) >= 16 ? 18 : 17;
                if (result.remainingWeeks !== endWeek - week) {status.skipped = 'noncalendar_horizon'; return null;}
                const weeks = Array.from({length: endWeek - week}, (_,i) => week + i + 1);
                const config = clone({scoring: ctx.scoring || ctx.league.scoring_settings || {}, rosterPositions: ctx.league.roster_positions || [], totalTeams: ctx.totalTeams || ctx.league.total_rosters || null, leagueType: type, endWeek});
                const provenance = clone({provider: Object.keys(ctx.projectionsData || {}).length ? 'season_projection_rows_present' : 'history_fallback', sourceAsOf: ctx.sourceAsOf || null, sourceTimestampsVerified: false, dataObservedAt: capturedAt});
                const models = {baseline: BASELINE_VERSION, challenger: root.App.AvailabilityForecast.VERSION};
                const rows = Object.keys(result.points).sort().map(pid => {
                    const p = ctx.playersData?.[pid] || {};
                    const inputs = clone({player: {position: p.position || null, team: p.team ?? null, injury_status: p.injury_status ?? null, status: p.status ?? null, bye_week: p.bye_week ?? null}, currentStats: ctx.statsData?.[pid] || null, priorStats: ctx.priorData?.[pid] || null, seasonProjection: ctx.projectionsData?.[pid] || null, availabilityEvidence: ctx.availabilityEvidence?.[pid] || null, recentWeeklyPoints: Object.fromEntries(Object.entries(root.S?.weeklyPlayerPoints || {}).filter(([w]) => Number(w) <= week).map(([w,map]) => [w, map?.[pid] ?? null]))});
                    inputs.player.age = p.age ?? null;
                    inputs.player.years_exp = p.years_exp ?? null;
                    inputs.marketValue = ctx.marketRedraft?.[pid] ?? null;
                    inputs.usageStats = clone(root.S?.playerStats?.[pid] || null);
                    const currentDynastyValue = root.App?.LI?.playerScores?.[pid] ?? null;
                    let dynastyScenario = null;
                    if (type !== 'redraft' && currentDynastyValue != null && root.App.PlayerValue?.projectPlayerValue) {
                        const stats = inputs.usageStats;
                        const trend = stats?.prevAvg > 0 && stats?.seasonAvg > 0 ? (stats.seasonAvg - stats.prevAvg) / stats.prevAvg : 0;
                        inputs.trend = trend;
                        inputs.elite = typeof root.App.isElitePlayer === 'function' ? !!root.App.isElitePlayer(pid) : currentDynastyValue >= 7000;
                        dynastyScenario = {modelVersion: 'current-age-scenario-20260906', kind: 'uncalibrated_value_scenario', valuesBySeason: Object.fromEntries([1,2,3].map(delta => [season + delta, root.App.PlayerValue.projectPlayerValue(pid, currentDynastyValue, p.age || 0, p.position || '', delta, {trend})]))};
                    }
                    return {pid, inputs, baseline: {healthyPerWeek: healthyPerWeek[pid] ?? null, points: result.points[pid], rosValue: result.values[pid] ?? null, currentDynastyValue}, dynastyScenario, challenger: root.App.AvailabilityForecast.forecast({player: inputs.player, season, weeks, healthyPerWeek: healthyPerWeek[pid] ?? null, capturedAt, evidence: inputs.availabilityEvidence})};
                });
                const frozen = {schemaVersion: SCHEMA_VERSION, leagueId: String(ctx.leagueId), season, decisionWeek: week, startWeek: week + 1, endWeek, config, models, rows, sourceAsOf: provenance.sourceAsOf, dynastyModelInputs: clone({ageCurves: root.App.ageCurveWindows || null, decayRates: root.App.decayRates || null})};
                // Runtime signatures identify actual loaded implementations rather
                // than a git SHA that may not match cached browser code.
                const wp = root.App.WeeklyProj, ss = root.App.StartSit;
                const runtime = clone({price: String(root.App.PlayerValue?.computePrices), baseline: String(wp?.buildBaseline), seasonBaseline: String(wp?.buildSeasonBaseline), project: String(ss?.projectPlayerWeek), score: String(ss?.scoreProjection), availability: String(root.App.AvailabilityForecast.forecast), dynasty: String(root.App.PlayerValue?.projectPlayerValue)});
                const inputHash = await hash(frozen);
                const runtimeHash = await hash(runtime);
                const configHash = await hash(config);
                const id = await hash({inputHash, runtimeHash, day: capturedAt.slice(0,10)});
                const record = {...frozen, id, capturedAt, provenance, inputHash, runtimeHash, configHash, mode: 'shadow', runtimeSignatures: runtime};
                const inserted = await store.addOnce(record);
                status.lastCapture = {id, inserted, rows: rows.length, centralEstimates: rows.filter(r => r.challenger.expectedPoints != null).length, capturedAt}; status.error = null; status.skipped = null;
                return {id, inserted};
            } catch (error) {status.error = String(error?.message || error); return null;}
        }
        async function read(leagueId) { return (await store.all()).filter(r => leagueId == null || r.leagueId === String(leagueId)); }
        async function exportLeague(leagueId) {return JSON.stringify({schemaVersion: SCHEMA_VERSION, exportedAt: now(), records: await read(leagueId)}, null, 2);}
        return {capture, read, exportLeague, status};
    }
    function captureCurrent() {
        const s = root.S, pv = root.App?.PlayerValue, skin = root.App?.LeagueSkin?.getCurrent?.();
        if (!s?.currentLeagueId || !pv?.computePrices) return null;
        const league = (s.leagues || []).find(l => String(l.league_id || l.id) === String(s.currentLeagueId));
        if (!league) return null;
        // Standalone production shadow for dynasty too; does not call ensureRos,
        // replace its cache, or turn a dynasty league into redraft.
        return pv.computePrices({leagueId: s.currentLeagueId, league: {...league, season: s.season}, skin,
            week: root.App.WeeklyProj?.currentWeek?.(), playersData: s.players, statsData: s.statsData,
            priorData: s.priorData, projectionsData: s.projectionsData,
            perTeamSlots: pv.slotsFromRoster(league.roster_positions), _captureForecast: true});
    }
    // Outcomes require explicit completed-week certification. Missing players in
    // a complete week count as zero; missing or incomplete WEEK data never does.
    function evaluate(record, outcomes, {evaluatedAt = new Date().toISOString()} = {}) {
        const capturedTime = Date.parse(record.capturedAt), evaluationTime = Date.parse(evaluatedAt);
        if (!Number.isFinite(capturedTime) || !Number.isFinite(evaluationTime) || capturedTime > evaluationTime || record.schemaVersion !== SCHEMA_VERSION || !Number.isInteger(record.startWeek) || !Number.isInteger(record.endWeek) || record.startWeek !== record.decisionWeek + 1 || record.endWeek < record.startWeek || record.endWeek > 18) return {ready: false, reason: 'invalid_capture_or_evaluation_context'};
        const weeks = Array.from({length: record.endWeek - record.startWeek + 1}, (_,i) => record.startWeek + i);
        const matches = weeks.map(w => outcomes.filter(o => String(o.leagueId) === record.leagueId && o.season === record.season && o.week === w && o.configHash === record.configHash));
        if (matches.some(m => m.length !== 1)) return {ready: false, reason: 'missing_or_ambiguous_outcomes'};
        const selected = matches.map(m => m[0]);
        if (selected.some(o => o.complete !== true || !o.points || typeof o.points !== 'object' || Array.isArray(o.points) || !Number.isFinite(Date.parse(o.asOf)) || Date.parse(o.asOf) <= capturedTime || Date.parse(o.asOf) > evaluationTime)) return {ready: false, reason: 'incomplete_or_invalid_outcome_timestamps'};
        const rows = record.rows.map(row => {
            const values = selected.map(o => Object.hasOwn(o.points, row.pid) ? o.points[row.pid] : 0);
            if (values.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Invalid outcome points');
            const actual = values.reduce((a,b) => a+b,0);
            return {pid: row.pid, actual, baseline: row.baseline.points, challenger: row.challenger.expectedPoints, low: row.challenger.scenarioLowPoints, high: row.challenger.scenarioHighPoints, baselineKnown: row.challenger.baselineKnown};
        });
        const paired = rows.filter(r => r.baselineKnown && Number.isFinite(r.baseline) && Number.isFinite(r.challenger));
        function metrics(key, sample = paired) {return {n: sample.length, mae: sample.length ? sample.reduce((s,r) => s+Math.abs(r[key]-r.actual),0)/sample.length : null, bias: sample.length ? sample.reduce((s,r) => s+r[key]-r.actual,0)/sample.length : null};}
        return {ready: true, recordId: record.id, models: record.models, totalPlayers: rows.length, pairedPlayers: paired.length, unresolvedPlayers: rows.filter(r => r.baselineKnown && r.challenger == null).length, missingBaselinePlayers: rows.filter(r => !r.baselineKnown).length, coverage: rows.length ? paired.length/rows.length : 0, baseline: metrics('baseline'), baselineAllKnown: metrics('baseline', rows.filter(r => r.baselineKnown && Number.isFinite(r.baseline))), challenger: metrics('challenger'), rows};
    }
    const api = {...createLedger(), captureCurrent, createLedger, evaluate, canonical, SCHEMA_VERSION, BASELINE_VERSION};
    root.App = root.App || {}; root.App.ForecastLedger = api;
    if (root.addEventListener) {
        root.addEventListener('wr:weekly-points-loaded', captureCurrent);
        root.addEventListener('wr:projections-loaded', captureCurrent);
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
