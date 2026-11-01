/* global module */
// Read-only, individual bench-for-starter comparisons. Alternatives are never
// combined into a claimed whole-lineup gain and never submitted to a provider.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const number = value => value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()
        ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    const idOf = league => String(league?.league_id || league?.id || '');
    const ids = values => [...new Set((values || []).filter(value => value != null && String(value) !== '0' && String(value) !== '').map(String))];
    const basisOf = args => ['average', 'idp-average'].includes(args.basis) ? args.basis : 'projected';
    const windowOf = args => App.RosterLensBasis?.normalizeWindow?.(args.averageWindow) || 'season';
    const upper = value => String(value || '').trim().toUpperCase();
    const norm = value => ({ DE: 'DL', DT: 'DL', NT: 'DL', IDL: 'DL', EDGE: 'DL', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', OLB: 'LB', ILB: 'LB', MLB: 'LB', DST: 'DEF', 'D/ST': 'DEF', PK: 'K' })[upper(value)] || upper(value);
    const team = value => ({ WSH: 'WAS', JAC: 'JAX', LA: 'LAR' })[upper(value)] || upper(value);
    const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);
    const BASE = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB']);
    const FLEX = { FLEX: ['RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], IDP_FLEX: ['DL', 'LB', 'DB'], WILDCARD: [...BASE] };
    const OUT = new Set(['O', 'OUT', 'IR', 'PUP', 'SUS', 'SUSPENDED', 'NA', 'DNP', 'COV', 'FA', 'BYE', 'INACTIVE', 'RETIRED']);
    const QUESTIONABLE = new Set(['Q', 'QUESTIONABLE']);
    function normSlot(value) {
        const raw = upper(value);
        return ({ SUPERFLEX: 'SUPER_FLEX', SFLEX: 'SUPER_FLEX', QB_FLEX: 'SUPER_FLEX', WRTQ: 'SUPER_FLEX', OP: 'SUPER_FLEX', 'Q/W/R/T': 'SUPER_FLEX',
            WRRBTE_FLEX: 'FLEX', 'WR/RB/TE': 'FLEX', 'W/R/T': 'FLEX', 'WR/TE': 'REC_FLEX', 'W/T': 'REC_FLEX', 'WR/RB': 'WRRB_FLEX', 'W/R': 'WRRB_FLEX', IDP: 'IDP_FLEX' })[raw] || norm(raw);
    }
    function slotEligibility(raw) {
        const name = normSlot(raw);
        return FLEX[name] ? [...FLEX[name]] : BASE.has(name) ? [name] : null;
    }
    function eligiblePlayer(player, allowed) {
        return Array.isArray(allowed) && ids([player?.position, ...(player?.fantasy_positions || [])]).map(norm).some(pos => allowed.includes(pos));
    }
    function account(args) {
        const owner = args.accountId || (App.OD || root.OD)?.getCurrentUserId?.();
        if (owner) return 'account:' + owner;
        return args.userId || root.S?.user?.user_id ? 'user:' + (args.userId || root.S.user.user_id) : '';
    }
    function scope(args) {
        return [account(args), args.league?._platform || root.S?.platform || 'sleeper', idOf(args.league), args.league?.season || '', args.roster?.roster_id ?? '', args.week || '', basisOf(args), ...(basisOf(args) === 'projected' ? [] : [windowOf(args)])].map(encodeURIComponent).join(':');
    }
    function result(args, status, reason, extra) {
        const basis = basisOf(args);
        return { status, reason, scope: scope(args), week: number(args.week), basis, averageWindow: windowOf(args),
            basisLabel: App.RosterLensBasis?.describe?.(basis, windowOf(args))?.label || ({ projected: 'Projected', average: 'Avg points', 'idp-average': 'IDP avg' })[basis],
            candidates: [], readiness: { weekly: false, complete: false }, ...extra };
    }
    function currentWeek(args) {
        return number(args.currentWeek) || number(App.LeagueLiveScores?.currentWeek?.(args.league)) || number(App.WeeklyProj?.currentWeek?.()) || number(root.S?.nflState?.display_week || root.S?.nflState?.week);
    }
    function restrictions(args) {
        const league = args.league || {}, roster = args.roster;
        if (!account(args) || !idOf(league) || !league.season || !roster || !Array.isArray(roster.players)) return ['unavailable', 'Your account, league and roster are still loading.'];
        if (args.dataScope && args.dataScope !== scope(args)) return ['unavailable', 'League data changed. Refresh the lens.'];
        if (args.rostersLeagueId && String(args.rostersLeagueId) !== idOf(league)) return ['unavailable', 'League roster data is still loading.'];
        const season = args.currentSeason || root.S?.nflState?.season;
        if (!season || String(season) !== String(league.season)) return ['unavailable', 'Current-season lineup comparisons are unavailable for this league season.'];
        if (typeof root.wrIsPro === 'function' && !root.wrIsPro()) return ['disabled', 'Lineup recommendations are included with Pro.'];
        if (args.skin?.type === 'best_ball' || number(league.settings?.best_ball) === 1) return ['disabled', 'This league selects its best-ball lineup automatically.'];
        if (args.skin?.type === 'dfs' || ['complete', 'pre_draft', 'drafting'].includes(args.skin?.phase || args.skin?.state?.phase)) return ['disabled', 'Lineup comparisons resume when this league is in season.'];
        if (App.Chopped?.isChopped?.(league) && App.Chopped?.isEliminated?.(roster)) return ['disabled', 'You were chopped — there is no active lineup to change.'];
        const user = args.userId || root.S?.user?.user_id;
        if (user && roster.owner_id && String(user) !== String(roster.owner_id) && !(roster.co_owners || []).map(String).includes(String(user))
            && !(league._mflFranchiseId != null && String(league._mflFranchiseId) === String(roster.roster_id))) return ['disabled', 'Open My Roster to compare your own lineup.'];
        if (!Array.isArray(league.roster_positions) || !league.roster_positions.length) return ['unavailable', 'Starting lineup slots are still loading.'];
        if (!league.scoring_settings || !Object.keys(league.scoring_settings).length || Object.values(league.scoring_settings).some(value => number(value) == null)) return ['unavailable', 'Complete league scoring rules are required.'];
        return null;
    }
    function gameStatus(game, now) {
        if (App.NflContext?.gameStatus) return App.NflContext.gameStatus(game, now);
        if (!game || /POSTPONED|CANCEL|SUSPEND|DELAY/i.test(game.statusName || '')) return 'unknown';
        if (game.completed) return 'final';
        if (game.state === 'in') return 'live';
        const kickoff = Date.parse(game.kickoff || '');
        if (!Number.isFinite(kickoff) || game.state === 'post') return 'unknown';
        if (kickoff <= now) return 'locked';
        return game.state === 'pre' ? 'upcoming' : 'unknown';
    }
    function statusOf(pid, args) {
        const player = args.players?.[pid], projection = args.projectionsByPid?.[pid];
        const bye = number(App.NFLByes?.weekForPlayer?.(player, Number(args.league.season)) ?? player?.bye_week);
        if (bye === args.week) return 'BYE';
        if (!player?.team || ['FA', 'FA*'].includes(upper(player.team))) return 'FA';
        if (player.active === false || ['INACTIVE', 'RETIRED'].includes(upper(player.status))) return 'INACTIVE';
        const native = upper(player.injury_status), projected = upper(projection?.injuryStatus);
        return OUT.has(native) ? native : OUT.has(projected) ? projected : native || projected;
    }
    function comparison(pid, args) {
        const player = args.players?.[pid], projected = args.projectionsByPid?.[pid];
        const average = args.basis === 'average' || args.basis === 'idp-average' && ['DL', 'LB', 'DB'].includes(norm(player?.position));
        if (average) {
            const value = App.RosterLensBasis?.comparison?.(pid, { ...args, projected });
            return { ...value, points: number(value?.points?.median), available: value?.available === true, comparisonBasis: 'average', conditional: QUESTIONABLE.has(statusOf(pid, args)) };
        }
        if (projected && typeof projected === 'object' && (projected.week != null && number(projected.week) !== args.week || projected.season != null && String(projected.season) !== String(args.league.season))) return { points: null, available: false, comparisonBasis: 'projected' };
        const uncertain = QUESTIONABLE.has(statusOf(pid, args));
        const conditional = uncertain ? number(projected?.conditionalPoints?.median) : null;
        let points = conditional ?? number(typeof projected === 'object' ? projected?.points?.median ?? projected?.median : projected);
        if (projected?.scoringSupported === false || projected?.supported === false || projected?.scoring?.supported === false
            || projected?.available === false && conditional == null || projected?.statLine && projected.statLine.median == null && conditional == null) points = null;
        return { points, available: points != null, comparisonBasis: 'projected', conditional: uncertain && points != null };
    }
    function evaluate(input) {
        const args = { ...input, players: input.players || input.playersData || {}, basis: basisOf(input) };
        args.currentWeek = currentWeek(args);
        args.week = number(args.week) || args.currentWeek;
        const blocked = restrictions(args);
        if (blocked) return result(args, ...blocked);
        if (!Number.isInteger(args.week) || args.week < args.currentWeek || args.week > 18 || !(args.currentWeek >= 1 && args.currentWeek <= 18)) return result(args, 'unavailable', 'Choose the current week or an upcoming regular-season week.');
        if (args.basis !== 'projected' && !App.RosterLensBasis?.comparison) return result(args, 'unavailable', 'The current-season average comparison service has not loaded.');
        const now = number(args.now) ?? Date.now(), updated = number(args.gamesUpdatedAt);
        if (!Array.isArray(args.games) || !args.games.length || updated == null || updated > now || now - updated >= 90000
            || number(args.scheduleWeek) !== args.week || String(args.scheduleSeason) !== String(args.league.season)) return result(args, 'unavailable', 'Refresh the NFL schedule to verify this week’s player locks.');
        if (args.projectionsWeek != null && number(args.projectionsWeek) !== args.week || args.projectionsSeason != null && String(args.projectionsSeason) !== String(args.league.season)
            || args.week > args.currentWeek && args.basis !== 'average' && (number(args.projectionsWeek) !== args.week || String(args.projectionsSeason) !== String(args.league.season))) return result(args, 'unavailable', 'Projections for the selected week are unavailable.');
        const slots = [];
        args.league.roster_positions.forEach(raw => {
            const name = normSlot(raw);
            if (!BENCH.has(name)) slots.push({ index: slots.length, name, eligible: slotEligibility(name) || [] });
        });
        if (!slots.length) return result(args, 'unavailable', 'This league has no verified starting slots.');
        const starters = args.platformStarters ?? args.roster.starters;
        if (!Array.isArray(starters) || starters.length !== slots.length) return result(args, 'unavailable', 'Your submitted starting lineup is unavailable. Refresh your league.');
        const startIds = starters.map(pid => pid == null || !String(pid) || String(pid) === '0' ? null : String(pid));
        if (ids(startIds).length !== startIds.filter(Boolean).length) return result(args, 'unavailable', 'The submitted lineup contains duplicate players. Refresh your league.');
        const owned = new Set(ids(args.roster.players)), reserved = new Set(ids([...(args.roster.reserve || []), ...(args.roster.taxi || [])]));
        const used = new Set(ids(startIds)), locked = new Set(ids([...(args.roster.locked_players || []), ...(args.lockedPids || [])]));
        const candidates = [], diagnostics = { missing: 0, unknownLocks: 0, locked: 0, unsupportedSlots: 0, compared: 0 };
        const stateOf = pid => gameStatus(args.games.find(game => team(game.home) === team(args.players[pid]?.team) || team(game.away) === team(args.players[pid]?.team)), now);
        const movable = (pid, outgoing) => {
            if (!pid) return true;
            if (locked.has(pid)) { diagnostics.locked++; return false; }
            if (outgoing && statusOf(pid, args) === 'BYE') return true;
            const state = stateOf(pid);
            if (state === 'upcoming') return true;
            if (state === 'unknown') diagnostics.unknownLocks++; else diagnostics.locked++;
            return false;
        };
        const asset = (pid, value) => {
            const p = args.players[pid];
            return { pid, name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || pid,
                position: norm(p.position), team: p.team || null, projection: value.points, comparisonBasis: value.comparisonBasis,
                averageGames: value.averageGames ?? null, averageSeason: value.averageSeason ?? null, averageWindow: value.averageWindow ?? null, averageSource: value.averageSource ?? null, injuryStatus: statusOf(pid, args) || null };
        };
        slots.forEach(slot => {
            if (!slot.eligible.length) { diagnostics.unsupportedSlots++; return; }
            const outgoingPid = startIds[slot.index], outgoingPlayer = args.players[outgoingPid];
            if (outgoingPid && (!owned.has(outgoingPid) || !outgoingPlayer?.position || reserved.has(outgoingPid))) { diagnostics.missing++; return; }
            if (!movable(outgoingPid, true)) return;
            const status = outgoingPid ? statusOf(outgoingPid, args) : '', unavailable = OUT.has(status);
            const before = outgoingPid ? comparison(outgoingPid, args) : { points: 0, available: true, comparisonBasis: 'empty' };
            // An absent baseline remains unknown, including for confirmed Out.
            if (unavailable) { before.points = null; before.available = false; }
            if (outgoingPid && !unavailable && !before.available) { diagnostics.missing++; return; }
            for (const incomingPid of owned) {
                if (used.has(incomingPid) || reserved.has(incomingPid)) continue;
                const player = args.players[incomingPid];
                if (!player?.position) { diagnostics.missing++; continue; }
                if (!eligiblePlayer(player, slot.eligible)) continue;
                if (OUT.has(statusOf(incomingPid, args))) continue;
                if (!movable(incomingPid, false)) continue;
                const after = comparison(incomingPid, args);
                if (!after.available) { diagnostics.missing++; continue; }
                diagnostics.compared++;
                const delta = before.points == null ? null : Math.round((after.points - before.points) * 100) / 100;
                if (!unavailable && !(delta > 0)) continue;
                const incoming = asset(incomingPid, after), outgoing = outgoingPid ? asset(outgoingPid, before) : null;
                const conditional = !!(before.conditional || after.conditional);
                const priority = !outgoingPid ? 30 : unavailable ? 20 : 10;
                const reason = !outgoingPid ? 'Fill the empty ' + slot.name.replace('_', ' ') + ' slot.'
                    : status === 'BYE' ? 'Replace a starter on bye this week.' : unavailable ? 'Replace an unavailable starter.'
                        : (delta > 0 ? '+' : '') + delta.toFixed(1) + (args.basis === 'projected' ? ' projected points this week.' : ' points on the selected comparison basis.');
                candidates.push({ id: [args.week, slot.index, outgoingPid || 'empty', incomingPid].join(':'), anchorPlayerId: outgoingPid || incomingPid,
                    incoming: [incoming], outgoing: outgoing ? [outgoing] : [], slotIndex: slot.index, slotName: slot.name,
                    weekly: { before: before.points, after: after.points, delta, status: delta == null ? 'unavailable' : 'ready', basis: args.basis, averageWindow: windowOf(args) },
                    reason, basis: args.basis, averageWindow: windowOf(args), conditional, conditionalLabel: conditional ? 'If they play' : null, priority,
                    handoff: { leagueId: idOf(args.league), season: args.league.season, rosterId: args.roster.roster_id, week: args.week,
                        slotIndex: slot.index, incomingPid, outgoingPid, basis: args.basis, averageWindow: windowOf(args), source: 'roster-lineup-lens' } });
            }
        });
        candidates.sort((a, b) => b.priority - a.priority || (b.weekly.delta ?? -Infinity) - (a.weekly.delta ?? -Infinity)
            || b.weekly.after - a.weekly.after || a.id.localeCompare(b.id));
        const incomplete = diagnostics.missing > 0 || diagnostics.unknownLocks > 0 || diagnostics.unsupportedSlots > 0;
        const reason = incomplete ? 'Some comparisons are unavailable because player data, forecasts or kickoff status are missing.'
            : candidates.length ? null : diagnostics.locked && !diagnostics.compared ? 'No eligible unlocked lineup changes remain this week.' : 'No better eligible bench replacement on the selected basis.';
        return result(args, candidates.length ? 'ready' : incomplete ? 'unavailable' : 'empty', reason,
            { candidates, diagnostics, readiness: { weekly: candidates.length > 0 || diagnostics.compared > 0, complete: !incomplete },
                lineupSource: args.lineupSource || (args.platformStarters ? 'Submitted starters' : 'Roster starters') });
    }
    async function submittedLineup(args) {
        if (Array.isArray(args.platformStarters)) return args.platformStarters;
        const live = App.LeagueLiveScores;
        if (!live?.supported?.(args.league)) return args.roster?.starters;
        if (!live.createClient) return null;
        let state, unsubscribe;
        try {
            const client = live.createClient();
            unsubscribe = client.subscribe(args.league, args.week, value => { state = value; });
            await client.refresh(args.league, args.week);
            if (state?.status !== 'ready' || !Array.isArray(state.rows)) return null;
            const row = state.rows.find(value => String(value.roster_id) === String(args.roster.roster_id));
            return Array.isArray(row?.starters) ? row.starters : null;
        } catch (_) { return null; }
        finally { unsubscribe?.(); }
    }
    const hasBaseline = line => !!line && Object.entries(line).some(([key, value]) => !['gp', 'season', 'week', 'season_type', 'player_id', 'team_id'].includes(key) && number(value) != null && number(value) !== 0);
    // WeeklyProj has a single live cache and emits refresh events. A future
    // lens must not evict that cache or trigger a current/future refresh loop.
    const futureProviders = new Map();
    async function futureProvider(args) {
        const key = String(args.league.season) + '|' + args.week, cached = futureProviders.get(key);
        if (cached && Date.now() - cached.at < 300000) return cached.promise;
        const fetcher = args.fetcher || root.fetch;
        if (typeof fetcher !== 'function') return null;
        const promise = Promise.resolve().then(() => fetcher('https://api.sleeper.app/v1/projections/nfl/regular/'
            + encodeURIComponent(args.league.season) + '/' + args.week))
            .then(response => response?.ok ? response.json() : null)
            .then(value => value && typeof value === 'object' && !Array.isArray(value) ? value : null)
            .catch(() => { futureProviders.delete(key); return null; });
        futureProviders.set(key, { at: Date.now(), promise });
        if (futureProviders.size > 6) futureProviders.delete(futureProviders.keys().next().value);
        return promise;
    }
    async function load(input) {
        let args = { ...input, league: input.league || {}, basis: basisOf(input), players: input.players || input.playersData || root.S?.players || {} };
        args.currentWeek = currentWeek(args); args.week = number(args.week) || args.currentWeek;
        const blocked = restrictions(args);
        if (blocked) return result(args, ...blocked);
        const initialAccount = account({}), initialScope = scope(args), state = root.S || {};
        const current = idOf(args.league) === String(state.currentLeagueId || '');
        const changed = () => account({}) !== initialAccount || scope(args) !== initialScope || current && String(root.S?.currentLeagueId || '') !== idOf(args.league);
        const fetchStats = async season => typeof root.fetchSeasonStats === 'function' ? root.fetchSeasonStats(String(season)).catch(() => ({})) : {};
        const [stats, prior, provider, games, starters] = await Promise.all([
            args.statsData ?? (current && state.statsData ? state.statsData : fetchStats(args.league.season)),
            args.priorData ?? args.priorStatsData ?? (current && state.priorData ? state.priorData : fetchStats(Number(args.league.season) - 1)),
            args.projectionsByPid || args.basis === 'average' ? null : args.week > args.currentWeek ? futureProvider(args)
                : Promise.resolve(App.WeeklyProj?.ensureWeekProjections?.(args.week)).catch(() => null),
            args.games ? args.games : Promise.resolve(App.NflContext?.loadScores?.(args.week, args.league.season, 2)).catch(() => []),
            submittedLineup(args),
        ]);
        if (changed()) return result(args, 'unavailable', 'League or account changed. Open the lens again.');
        args.statsData = stats || {}; args.priorData = prior || {};
        args.projectionsData = args.projectionsData || (current ? state.projectionsData : null);
        if (!args.games) { args.games = games || []; args.gamesUpdatedAt = Date.now(); args.scheduleWeek = args.week; args.scheduleSeason = args.league.season; }
        // Future matchup feeds often have no submitted lineup yet. The current
        // roster is an explicit planning baseline, never presented as submitted.
        args.platformStarters = starters || (args.week > args.currentWeek ? args.roster.starters : null);
        args.lineupSource = starters ? 'Submitted starters' : args.week > args.currentWeek ? 'Current starters for future-week planning' : 'Submitted lineup unavailable';
        if (!args.platformStarters) return result(args, 'unavailable', 'Your submitted starting lineup could not be refreshed.');
        if (args.basis !== 'projected') args = await (App.RosterLensBasis?.prepare?.(args) || args);
        if (changed()) return result(args, 'unavailable', 'League or account changed. Open the lens again.');
        if (!args.projectionsByPid) {
            args.projectionsByPid = {};
            if (args.basis !== 'average') ids(args.roster.players).forEach(pid => {
                const published = hasBaseline(provider?.[pid]);
                // No prior/current-week cache is substituted for a future week.
                if (args.week > args.currentWeek && !published) return;
                if (!published && !(number(args.statsData[pid]?.gp) > 0 && hasBaseline(args.statsData[pid])) && !(number(args.priorData[pid]?.gp) > 0 && hasBaseline(args.priorData[pid])) && !hasBaseline(args.projectionsData?.[pid])) return;
                try {
                    const projection = App.WeeklyProj?.projectPlayer?.(pid, { playersData: args.players, statsData: args.statsData, priorData: args.priorData,
                        projectionsData: args.projectionsData, providerProjections: provider || {}, scoring: args.league.scoring_settings, week: args.week });
                    if (projection) args.projectionsByPid[pid] = projection;
                } catch (_) { /* No invented point value on projection failure. */ }
            });
            args.projectionsWeek = args.week; args.projectionsSeason = args.league.season;
        }
        return evaluate(args);
    }
    const api = { evaluate, load, scope, normSlot, slotEligibility, eligiblePlayer };
    App.RosterLineupLens = api;
    root.WR = root.WR || {}; root.WR.RosterLineupLens = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
