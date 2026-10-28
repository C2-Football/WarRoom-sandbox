/* global module */
// Project a redraft trade through the remaining regular-season schedule.
// All branches share the same league-scored player projections and random
// draws. Historical scores, official records and live rosters are never edited.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const VERSION = 'trade-season-impact-v1';
    const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);
    const OUT = new Set(['OUT', 'IR', 'PUP', 'SUS', 'NA', 'DNP', 'BYE', 'COV', 'FA']);
    const str = x => String(x == null ? '' : x);
    const finite = x => typeof x === 'number' && Number.isFinite(x);
    const round = (x, digits = 1) => finite(x) ? Math.round(x * Math.pow(10, digits)) / Math.pow(10, digits) : null;
    const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
    const pickPlayers = (map, ids) => clone(Object.fromEntries(ids.filter(id => map && map[id] != null).map(id => [id, map[id]])));
    const unique = xs => new Set(xs.map(str)).size === xs.length;
    const nameOf = (roster, league) => roster.metadata?.team_name || roster._team_name
        || league.users?.find(u => str(u.user_id) === str(roster.owner_id))?.display_name || 'Team ' + roster.roster_id;
    function unavailable(reason, extra) { return { status: 'unavailable', reason, ...extra }; }
    function slotInfo(league) {
        const SS = App.StartSit;
        const raw = league.roster_positions;
        if (!Array.isArray(raw) || !raw.length) return { reason: 'The league starting lineup rules are unavailable.' };
        const slots = raw.map(s => SS.normSlot(s));
        const unknown = slots.filter(s => !BENCH.has(s) && !SS.BASE_POSITIONS.has(s) && !SS.FLEX_ALLOWED[s]);
        if (unknown.length) return { reason: 'The lineup rules include unsupported slots: ' + [...new Set(unknown)].join(', ') + '.' };
        return { slots, capacity: slots.filter(s => !['IR', 'TAXI', 'RES'].includes(s)).length,
            starters: slots.filter(s => !BENCH.has(s)).length };
    }
    function activeIds(roster) {
        const excluded = new Set([...(roster.reserve || []), ...(roster.taxi || [])].map(str));
        return (roster.players || []).map(str).filter(pid => pid && !excluded.has(pid));
    }
    function recordOf(roster) {
        const s = roster.settings || {};
        if (!['wins', 'losses', 'ties'].every(k => s[k] != null && Number.isInteger(Number(s[k])) && Number(s[k]) >= 0)
            || s.fpts == null || !Number.isFinite(Number(s.fpts)) || !Number.isFinite(Number(s.fpts_decimal || 0))) return null;
        return { wins: Number(s.wins), losses: Number(s.losses), ties: Number(s.ties),
            pf: Number(s.fpts) + Number(s.fpts_decimal || 0) / 100 };
    }
    async function providerSnapshots(league, from, to) {
        const maps = {};
        await Promise.all(Array.from({length: Math.max(0,to-from+1)}, (_,i)=>from+i).map(async week => {
            maps[week] = await App.WeeklyProj.ensureWeekProjections(week, { season: league.season }) || {};
        }));
        return maps;
    }
    async function prepare(opts) {
        opts = opts || {};
        const WP = App.WeeklyProj, SS = App.StartSit, M = App.Matchup, PO = App.PlayoffOdds;
        const league = clone(opts.league || {}), currentWeek = Number(WP?.currentWeek?.()) || 1;
        const games = opts.games || await App.NflContext?.loadScores?.(currentWeek, league.season) || [];
        const horizon = WP?.decisionHorizon?.(league, { games }) || { tradeFromWeek: currentWeek + 1, endWeek: 17 };
        const fromWeek = opts.fromWeek == null ? horizon.tradeFromWeek : Number(opts.fromWeek);
        const extra = { version: VERSION, fromWeek, currentWeek, excludedCurrentWeek: fromWeek > currentWeek, horizon, calculatedAt: Date.now() };
        if (!WP || !SS || !M?.dist || !PO?.fetchFuturePairs) return unavailable('The season projection engines have not loaded.', extra);
        const liveSeason = root.S?.nflState?.season;
        if (!league.season || liveSeason == null || str(liveSeason) !== str(league.season))
            return unavailable('Remaining-season analysis requires the current NFL season.', extra);
        if (league._mfl || league._espn || league._yahoo || str(league.id).startsWith('mfl_'))
            return unavailable('A verified full-league schedule is not available for this platform yet.', extra);
        if (!league.scoring_settings || !Object.keys(league.scoring_settings).length
            || Object.values(league.scoring_settings).some(v => v == null || !Number.isFinite(Number(v))))
            return unavailable('The league scoring rules are unavailable or incomplete.', extra);
        const start = Number(league.settings?.start_week || 1), pws = Number(league.settings?.playoff_week_start);
        if (!Number.isInteger(pws) || pws < 2 || pws > 19 || !Number.isInteger(start) || start < 1 || start >= pws)
            return unavailable('The regular-season cutoff has not been verified.', extra);
        const regularEnd = pws - 1;
        const lastReg = opts.horizon === 'season' || currentWeek >= pws ? horizon.endWeek : regularEnd;
        if (!Number.isInteger(fromWeek) || fromWeek < currentWeek || fromWeek === currentWeek && horizon.tradeFromWeek !== currentWeek || fromWeek > lastReg)
            return unavailable(fromWeek > lastReg ? 'No full regular-season weeks remain after this week.' : 'Trade effects begin with a full week after the current week.', { ...extra, lastReg });
        const si = slotInfo(league);
        if (si.reason || !si.starters) return unavailable(si.reason || 'The league has no supported starting slots.', { ...extra, lastReg });
        const rosters = league.rosters || [];
        const eligibility = App.RecommendationEligibility?.check(league, rosters[0], 'trade');
        if (eligibility && !eligibility.ok) return unavailable(eligibility.reason, extra);
        if (Number(league.total_rosters) > rosters.length) return unavailable('Complete league rosters are required.', extra);
        if (rosters.length < 2 || !unique(rosters.map(r => r.roster_id)) || rosters.some(r => !Array.isArray(r.players) || !unique(r.players)))
            return unavailable('Complete, unique league rosters are required.', { ...extra, lastReg });
        const pidList = [...new Set(rosters.flatMap(r => (r.players || []).map(str)))];
        const ctx = { ...extra, lastReg, regularEnd, startWeek: start, league, slotInfo: si,
            playersData: pickPlayers(opts.playersData, pidList), statsData: pickPlayers(opts.statsData, pidList),
            priorData: pickPlayers(opts.priorData || root.S?.priorData, pidList),
            projectionsData: pickPlayers(opts.projectionsData || root.S?.projectionsData, pidList),
            assumptions: [
                ...(horizon.assumption ? [horizon.assumption] : []),
                'Trade begins in Week ' + fromWeek + (fromWeek > currentWeek ? '; current-week lineups do not change.' : '; verified upcoming games and zero review delay.'),
                'Each future week uses the best legal projected lineup under this league scoring.',
                'Current rosters stay fixed; no free-agent replacements, new injuries or return dates are forecast. Unresolved availability has no central estimate.',
                'Published weekly projections are used when available, with season projections and current/prior production as the fallback.',
                'Score uncertainty is approximate; player and weekly scores are treated independently.',
            ], warnings: [], projectionsByWeek: {}, records: {} };
        const settled = await Promise.allSettled([
            App.Luck?.build ? App.Luck.build({ league, throughWeek: currentWeek - 1 }) : Promise.resolve(null),
            PO.fetchFuturePairs({ league, fromWeek: currentWeek, toWeek: lastReg }),
            providerSnapshots(league, currentWeek, lastReg),
        ]);
        ctx.ledger = settled[0].status === 'fulfilled' ? clone(settled[0].value) : null;
        ctx.futurePairs = settled[1].status === 'fulfilled' ? clone(settled[1].value || {}) : {};
        if (settled[0].status === 'rejected') ctx.warnings.push('Completed-week score history could not be loaded.');
        const providerMaps = settled[2].status === 'fulfilled' ? settled[2].value : {};
        for (let w = currentWeek; w <= lastReg; w++) {
            const map = {};
            for (const pid of pidList) {
                map[pid] = WP.projectPlayer(pid, { playersData: ctx.playersData, statsData: ctx.statsData, priorData: ctx.priorData,
                    scoring: league.scoring_settings, week: w, providerProjections: providerMaps[w] || {}, projectionsData: ctx.projectionsData });
                const player = ctx.playersData[pid];
                // Today's designation is neither a return date nor a season-long absence.
                if (w >= fromWeek && (player?.injury_status || !player?.team || player.active === false || ['Inactive','Retired','IR','PUP','Suspended'].includes(player?.status))) {
                    const evidence = opts.availabilityByWeek?.[pid]?.[w];
                    const verified = evidence && ['available','out'].includes(evidence.status) && evidence.source && evidence.season === Number(league.season) && Number.isFinite(Date.parse(evidence.asOf)) && Date.now() - Date.parse(evidence.asOf) >= 0 && Date.now() - Date.parse(evidence.asOf) < 24 * 60 * 60 * 1000;
                    if (!verified) map[pid] = { ...map[pid], available: false, availabilityUnknown: true, points: { median: null, floor: null, ceiling: null }, unavailableReason: 'Future availability is unresolved; no return date assumed.' };
                    else map[pid] = WP.projectPlayer(pid, { playersData: { ...ctx.playersData, [pid]: { ...player, injury_status: evidence.status === 'out' ? 'OUT' : '' } }, statsData: ctx.statsData, priorData: ctx.priorData, scoring: league.scoring_settings, week: w, providerProjections: providerMaps[w] || {}, projectionsData: ctx.projectionsData });
                }
            }
            ctx.projectionsByWeek[w] = map;
        }
        rosters.forEach(r => { ctx.records[str(r.roster_id)] = recordOf(r); });
        const expectedPrior = Math.max(0, currentWeek - start), median = Number(league.settings?.league_average_match || 0);
        const counts = rosters.map(r => { const rec = ctx.records[str(r.roster_id)]; return rec && rec.wins + rec.losses + rec.ties; });
        if (![0, 1].includes(median)) ctx.recordReason = 'The number of weekly standings decisions is unsupported.';
        else if (counts.every(n => n === expectedPrior * (1 + median))) {
            ctx.simulationStart = currentWeek;
            ctx.assumptions.push('The current week is held unchanged by the trade and simulated as a full week; live scores and player locks are not included.');
        } else if (counts.every(n => n === (expectedPrior + 1) * (1 + median))) ctx.simulationStart = currentWeek + 1;
        else ctx.recordReason = 'Official records do not cover the same verified completed weeks for every team.';
        ctx.freshness = Object.fromEntries(Object.keys(ctx.projectionsByWeek).map(w => [w, WP.freshness?.(Number(w), league.season) || { fetchedAt: null, providerAsOf: null }]));
        ctx.status = 'ready';
        return ctx;
    }
    function lineup(roster, week, ctx) {
        const projections = ctx.projectionsByWeek[week] || {}, ids = activeIds(roster), missing = [];
        const players = ids.map(pid => {
            const p = projections[pid], player = ctx.playersData[pid], pos = App.normPos ? App.normPos(player?.position) : player?.position;
            const knownOut = p && OUT.has(str(p.injuryStatus).toUpperCase());
            if (!player || !App.StartSit.BASE_POSITIONS.has(pos) || !p || (!p.statLine?.median && !knownOut) || !finite(p.points?.median)) missing.push(pid);
            return { pid, pos, available: p?.available === true, pts: p?.points?.median };
        });
        const optimal = App.StartSit.optimalLineupWeekly(players, ctx.league.roster_positions);
        const dist = App.Matchup.dist(optimal.starters.map(s => s.pid), projections, 'median');
        return { known: missing.length === 0, missing, points: missing.length ? null : optimal.total,
            starters: optimal.starters, unfilled: optimal.slots.filter(s => !s.pid).length, dist };
    }
    function fullPairs(ctx, week) {
        const ids = ctx.league.rosters.map(r => str(r.roster_id)), raw = ctx.futurePairs[week];
        if (!Array.isArray(raw)) return null;
        const flat = [];
        for (const pair of raw) {
            if (!Array.isArray(pair) || pair.length !== 2 || str(pair[0]) === str(pair[1]) || pair.some(id => !ids.includes(str(id)))) return null;
            flat.push(...pair.map(str));
        }
        return flat.length === ids.length && unique(flat) ? raw.map(p => p.map(str)) : null;
    }
    function verifiedOpponent(ctx, week, myId) {
        const raw = ctx.futurePairs[week];
        if (!Array.isArray(raw)) return null;
        const containing = raw.filter(pair => Array.isArray(pair) && pair.map(str).includes(myId));
        if (containing.length !== 1 || containing[0].length !== 2) return null;
        const pair = containing[0].map(str), opponent = pair.find(id => id !== myId);
        if (!opponent || !ctx.league.rosters.some(r => str(r.roster_id) === opponent)) return null;
        // An otherwise valid pair is not verified if either team appears in a
        // second matchup. Missing unrelated games do not erase this own game.
        const assignments = raw.filter(Array.isArray).flatMap(pair => pair.map(str));
        if (assignments.filter(id => id === myId).length !== 1 || assignments.filter(id => id === opponent).length !== 1) return null;
        return opponent;
    }
    function forecast(a, b) {
        if (!a?.known || !b?.known) return null;
        const sd = Math.sqrt(a.dist.sd * a.dist.sd + b.dist.sd * b.dist.sd), difference = a.dist.mean - b.dist.mean;
        return sd ? round(App.Matchup.normCdf(difference / sd) * 100) : difference > 0 ? 100 : difference < 0 ? 0 : 50;
    }
    function powerRank(branch, weeks, ids, myId) {
        if (ids.some(id => weeks.some(w => !branch[w][id]?.known))) return null;
        const rows = ids.map(id => ({ id, points: weeks.reduce((sum, w) => sum + branch[w][id].points, 0) / weeks.length }));
        rows.sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
        const me = rows.find(r => r.id === myId);
        return { rank: 1 + rows.filter(r => r.points > me.points + 1e-9).length, points: round(me.points) };
    }
    function rng(seed) {
        let a = seed >>> 0;
        return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }
    function normal(rand) { return Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, rand()))) * Math.cos(2 * Math.PI * rand()); }
    function qualificationReason(ctx) {
        const s = ctx.league.settings || {}, teams = Number(s.playoff_teams);
        if (!Number.isInteger(teams) || teams < 1 || teams >= ctx.league.rosters.length) return 'A competitive playoff field has not been verified.';
        if (Number(s.divisions || 0) > 0) return 'Division qualification rules are not modeled; playoff odds are unavailable.';
        if (s.playoff_seed_type == null || Number(s.playoff_seed_type) !== 0 || (ctx.league.bracket_overrides_id != null && str(ctx.league.bracket_overrides_id) !== '0'))
            return 'Standard record and points-for seeding has not been verified.';
        return null;
    }
    // Generate a single score per team/week and apply it to both branches using
    // the same normal draw. This preserves opponents' outcomes and median games.
    function pairedSimulation(ctx, before, after, myId, sims, seed, qualify) {
        const ids = ctx.league.rosters.map(r => str(r.roster_id)), rand = rng(seed), medianEnabled = Number(ctx.league.settings.league_average_match || 0) === 1;
        const weeks = Object.keys(before).map(Number).filter(w => w >= ctx.simulationStart).sort((a, b) => a - b);
        const slots = Number(ctx.league.settings.playoff_teams), byes = qualify ? Math.pow(2, Math.ceil(Math.log2(slots))) - slots : 0;
        const sums = [0, 1].map(() => ({ remaining: 0, final: 0, playoff: 0, bye: 0 }));
        for (let sim = 0; sim < sims; sim++) {
            // Further official tiebreakers are unknown. Share an exact record
            // and points tie fairly instead of awarding it by roster ID. The
            // tie draw is identical for both branches of this season trial.
            const tiePriority = Object.fromEntries(ids.map(id => [id, rand()]));
            const states = [0, 1].map(() => ({ wins: Object.fromEntries(ids.map(id => [id, ctx.records[id].wins + ctx.records[id].ties / 2])),
                pf: Object.fromEntries(ids.map(id => [id, ctx.records[id].pf])), remaining: 0 }));
            for (const week of weeks) {
                const scores = [{}, {}];
                for (const id of ids) {
                    const z = normal(rand);
                    [before, after].forEach((branch, i) => { const d = branch[week][id].dist; scores[i][id] = d.mean + d.sd * z; });
                }
                for (let i = 0; i < 2; i++) {
                    const state = states[i], score = scores[i];
                    ids.forEach(id => { state.pf[id] += score[id]; });
                    for (const [a, b] of fullPairs(ctx, week)) {
                        const gainA = score[a] > score[b] ? 1 : score[a] < score[b] ? 0 : 0.5;
                        state.wins[a] += gainA; state.wins[b] += 1 - gainA;
                        if (week >= ctx.fromWeek && (a === myId || b === myId)) state.remaining += a === myId ? gainA : 1 - gainA;
                    }
                    if (medianEnabled) {
                        const sorted = ids.map(id => score[id]).sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
                        const med = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
                        ids.forEach(id => { const gain = score[id] > med ? 1 : score[id] < med ? 0 : 0.5;
                            state.wins[id] += gain; if (id === myId && week >= ctx.fromWeek) state.remaining += gain; });
                    }
                }
            }
            states.forEach((state, i) => {
                sums[i].remaining += state.remaining; sums[i].final += state.wins[myId];
                if (qualify) {
                    const ordered = [...ids].sort((a, b) => state.wins[b] - state.wins[a] || state.pf[b] - state.pf[a] || tiePriority[a] - tiePriority[b]);
                    const index = ordered.indexOf(myId); sums[i].playoff += index < slots ? 1 : 0; sums[i].bye += index < byes ? 1 : 0;
                }
            });
        }
        return sums.map(s => ({ remaining: s.remaining / sims, final: s.final / sims, playoffPct: s.playoff / sims * 100,
            byePct: byes ? s.bye / sims * 100 : null }));
    }
    function analyze(opts) {
        opts = opts || {};
        const ctx = opts.context, effectiveWeek = ctx?.fromWeek;
        const no = reason => unavailable(reason, { effectiveWeek, remainingWeeks: ctx?.lastReg >= effectiveWeek ? ctx.lastReg - effectiveWeek + 1 : 0 });
        if (!ctx || ctx.status !== 'ready') return no(ctx?.reason || 'Season context has not loaded.');
        if ((opts.givePlayerIds != null && !Array.isArray(opts.givePlayerIds)) || (opts.receivePlayerIds != null && !Array.isArray(opts.receivePlayerIds)))
            return no('Traded players must be supplied as player lists.');
        const myId = str(opts.myRosterId), partnerId = str(opts.partnerRosterId), give = (opts.givePlayerIds || []).map(str), receive = (opts.receivePlayerIds || []).map(str);
        const rosters = ctx.league.rosters, mine = rosters.find(r => str(r.roster_id) === myId), partner = rosters.find(r => str(r.roster_id) === partnerId);
        if (!mine || !partner || myId === partnerId) return no('Choose two different teams in this league.');
        if (!unique(give) || !unique(receive) || give.some(pid => receive.includes(pid))) return no('Each traded player must appear once on exactly one side.');
        if (give.some(pid => !(mine.players || []).map(str).includes(pid)) || receive.some(pid => !(partner.players || []).map(str).includes(pid)))
            return no('Some proposed players are no longer owned by the selected teams.');
        const owners = {};
        rosters.forEach(r => (r.players || []).forEach(pid => { (owners[str(pid)] = owners[str(pid)] || []).push(str(r.roster_id)); }));
        if ([...give, ...receive].some(pid => !ctx.playersData[pid] || owners[pid]?.length !== 1)) return no('Traded-player data or unique ownership is unavailable.');
        const protectedIds = roster => new Set([...(roster.locked_players || []), ...(roster.keepers || []), ...(roster.reserve || []), ...(roster.taxi || []), ...(opts.protectedPlayerIds || [])].map(str));
        if (give.some(pid => protectedIds(mine).has(pid)) || receive.some(pid => protectedIds(partner).has(pid))) return no('This trade includes a protected or locked player.');
        const drops = (opts.dropPlayerIds || []).map(str), partnerDrops = (opts.partnerDropPlayerIds || []).map(str);
        if (!unique([...give,...drops]) || !unique([...receive,...partnerDrops]) || drops.some(pid => !activeIds(mine).includes(pid) || protectedIds(mine).has(pid)) || partnerDrops.some(pid => !activeIds(partner).includes(pid) || protectedIds(partner).has(pid))) return no('A required drop is invalid or protected.');
        const move = (roster, outgoing, incoming) => ({ ...roster, players: [...roster.players.map(str).filter(pid => !outgoing.includes(pid)), ...incoming],
            reserve: (roster.reserve || []).map(str).filter(pid => !outgoing.includes(pid)), taxi: (roster.taxi || []).map(str).filter(pid => !outgoing.includes(pid)),
            starters: (roster.starters || []).map(str).filter(pid => !outgoing.includes(pid)) });
        const changedMine = move(mine, [...give,...drops], receive), changedPartner = move(partner, [...receive,...partnerDrops], give);
        if ([changedMine, changedPartner].some(r => activeIds(r).length > ctx.slotInfo.capacity)) return no('This trade exceeds a team’s active roster capacity. Choose the required drop before evaluating it.');
        const ids = rosters.map(r => str(r.roster_id)), tradeWeeks = [];
        for (let w = ctx.fromWeek; w <= ctx.lastReg; w++) tradeWeeks.push(w);
        const before = {}, after = {};
        for (let w = ctx.currentWeek; w <= ctx.lastReg; w++) {
            before[w] = {}; after[w] = {};
            rosters.forEach(r => {
                const id = str(r.roster_id); before[w][id] = lineup(r, w, ctx);
                after[w][id] = w < ctx.fromWeek ? before[w][id]
                    : id === myId ? lineup(changedMine, w, ctx) : id === partnerId ? lineup(changedPartner, w, ctx) : before[w][id];
            });
        }
        if ([...give, ...receive].some(pid => tradeWeeks.some(w => {
            const p = ctx.projectionsByWeek[w]?.[pid]; return !p || (!p.statLine?.median && !OUT.has(str(p.injuryStatus).toUpperCase()));
        }))) return no('A traded player has no usable remaining-season projection.');
        const weekly = tradeWeeks.map(week => {
            const opponentId = verifiedOpponent(ctx, week, myId), opponent = rosters.find(r => str(r.roster_id) === opponentId);
            const b = before[week][myId], a = after[week][myId], ob = opponent && before[week][opponentId], oa = opponent && after[week][opponentId];
            const beforeWinPct = forecast(b, ob), afterWinPct = forecast(a, oa);
            return { week, opponentRosterId: opponent?.roster_id ?? null, opponentName: opponent ? nameOf(opponent, ctx.league) : 'Schedule unavailable',
                beforePoints: b.points, afterPoints: a.points, opponentBeforePoints: ob?.points ?? null, opponentAfterPoints: oa?.points ?? null,
                beforeWinPct, afterWinPct, winDelta: beforeWinPct == null || afterWinPct == null ? null : round(afterWinPct - beforeWinPct),
                pointsDelta: b.points == null || a.points == null ? null : round(a.points - b.points), beforeStarters: b.starters, afterStarters: a.starters,
                unfilledBefore: b.unfilled, unfilledAfter: a.unfilled, partnerUnfilledBefore: before[week][partnerId].unfilled, partnerUnfilledAfter: after[week][partnerId].unfilled, missingPlayerIds: [...new Set([...b.missing, ...a.missing, ...(ob?.missing || []), ...(oa?.missing || [])])] };
        });
        // Roster previews need deterministic legal-lineup points, not a season
        // Monte Carlo run. Both modes share the ownership/capacity checks and
        // the exact same before/after lineups above. The default Builder path
        // below is unchanged, including all wins and qualification estimates.
        if (opts.pointsOnly === true) {
            const complete = weekly.length > 0 && weekly.every(w => finite(w.beforePoints) && finite(w.afterPoints));
            const beforePoints = complete ? round(weekly.reduce((sum, w) => sum + w.beforePoints, 0)) : null;
            const afterPoints = complete ? round(weekly.reduce((sum, w) => sum + w.afterPoints, 0)) : null;
            const warnings = [];
            if (!complete) warnings.push('Some remaining weeks have incomplete lineup projections; missing production is not counted as zero.');
            if (weekly.some(w => w.partnerUnfilledAfter > w.partnerUnfilledBefore)) warnings.push('The other roster loses legal starting-slot coverage; no replacement is assumed.');
            if (weekly.some(w => w.unfilledAfter > 0)) warnings.push('The projected roster leaves starting slots empty in some weeks; no free-agent replacement is assumed.');
            if ([...give, ...receive].some(pid => ctx.playersData[pid]?.injury_status)) warnings.push('Future availability needs explicit evidence; unresolved return timing has no central estimate.');
            return { version: VERSION, status: complete ? (warnings.length ? 'limited' : 'ready') : 'unavailable',
                reason: complete ? null : warnings[0], pointsOnly: true, drops, partnerDrops, calculatedAt: ctx.calculatedAt, freshness: ctx.freshness,
                regularSeasonDelta: weekly.filter(w => w.week <= (ctx.regularEnd ?? ctx.lastReg)).every(w => w.pointsDelta != null) ? round(weekly.filter(w => w.week <= (ctx.regularEnd ?? ctx.lastReg)).reduce((n,w)=>n+w.pointsDelta,0)) : null,
                playoffDelta: weekly.filter(w => w.week > (ctx.regularEnd ?? ctx.lastReg)).every(w => w.pointsDelta != null) ? round(weekly.filter(w => w.week > (ctx.regularEnd ?? ctx.lastReg)).reduce((n,w)=>n+w.pointsDelta,0)) : null,
                partnerDelta: tradeWeeks.every(w => before[w][partnerId].known && after[w][partnerId].known) ? round(tradeWeeks.reduce((n,w)=>n+after[w][partnerId].points-before[w][partnerId].points,0)) : null, effectiveWeek: ctx.fromWeek, remainingWeeks: tradeWeeks.length,
                before: beforePoints, after: afterPoints, delta: complete ? round(afterPoints - beforePoints) : null, unit: 'ROS lineup points',
                coverage: { total: tradeWeeks.length, projected: weekly.filter(w => finite(w.beforePoints) && finite(w.afterPoints)).length },
                assumptions: ctx.assumptions.filter(line => /^(Trade begins|Each future week|Current rosters|Published weekly|Championship cutoff|Fantasy season)/.test(line)), warnings, weeks: weekly };
        }
        const regularWeeks = tradeWeeks.filter(w => w <= (ctx.regularEnd ?? ctx.lastReg));
        const bp = regularWeeks.length ? powerRank(before, regularWeeks, ids, myId) : null, ap = regularWeeks.length ? powerRank(after, regularWeeks, ids, myId) : null;
        const power = { before: bp?.rank ?? null, after: ap?.rank ?? null, total: ids.length, beforePoints: bp?.points ?? null, afterPoints: ap?.points ?? null,
            delta: bp && ap ? bp.rank - ap.rank : null };
        let simulationReason = ctx.recordReason || null;
        if (!simulationReason) {
            for (let w = ctx.simulationStart; w <= ctx.lastReg; w++) {
                if (!fullPairs(ctx, w)) { simulationReason = 'The full remaining league schedule could not be verified; playoff odds are unavailable.'; break; }
                if (ids.some(id => !before[w][id].known || !after[w][id].known)) { simulationReason = 'Some league players lack projections; complete season odds would imply missing data is zero.'; break; }
            }
        }
        const qReason = qualificationReason(ctx), sims = Math.max(500, Math.min(10000, Math.floor(Number(opts.sims) || 4000))), seed = opts.seed == null ? 12026 : Number(opts.seed);
        if (ctx.lastReg > ctx.regularEnd) simulationReason = 'Fantasy playoff lineup points are shown separately; qualification simulation is unavailable for this horizon.';
        const outcomes = !simulationReason ? pairedSimulation(ctx, before, after, myId, sims, seed, !qReason) : null;
        const medianEnabled = Number(ctx.league.settings.league_average_match || 0) === 1;
        const h2hKnown = weekly.every(w => w.beforeWinPct != null && w.afterWinPct != null);
        const wins = { beforeRemaining: outcomes ? round(outcomes[0].remaining, 2) : !medianEnabled && h2hKnown ? round(weekly.reduce((sum, w) => sum + w.beforeWinPct / 100, 0), 2) : null,
            afterRemaining: outcomes ? round(outcomes[1].remaining, 2) : !medianEnabled && h2hKnown ? round(weekly.reduce((sum, w) => sum + w.afterWinPct / 100, 0), 2) : null,
            beforeFinal: outcomes ? round(outcomes[0].final, 2) : null, afterFinal: outcomes ? round(outcomes[1].final, 2) : null,
            delta: null, decisionsPerWeek: medianEnabled ? 2 : 1 };
        wins.delta = wins.beforeRemaining == null || wins.afterRemaining == null ? null : round(wins.afterRemaining - wins.beforeRemaining, 2);
        const playoff = { available: !!outcomes && !qReason, reason: simulationReason || qReason || null, beforePct: null, afterPct: null, delta: null,
            byeBeforePct: null, byeAfterPct: null, byeDelta: null, simCount: outcomes ? sims : 0 };
        if (playoff.available) {
            playoff.beforePct = round(outcomes[0].playoffPct); playoff.afterPct = round(outcomes[1].playoffPct);
            playoff.delta = round(outcomes[1].playoffPct - outcomes[0].playoffPct);
            playoff.byeBeforePct = round(outcomes[0].byePct); playoff.byeAfterPct = round(outcomes[1].byePct);
            playoff.byeDelta = outcomes[0].byePct == null ? null : round(outcomes[1].byePct - outcomes[0].byePct);
        }
        const warnings = [...ctx.warnings];
        if (!bp || !ap) warnings.push('Remaining-season power rank needs complete league projections.');
        if (weekly.some(w => w.unfilledAfter > 0)) warnings.push('The projected roster leaves starting slots empty in some weeks; no free-agent replacement is assumed.');
        if ([...give, ...receive].some(pid => ctx.playersData[pid]?.injury_status)) warnings.push('Future availability needs explicit evidence; unresolved return timing has no central estimate.');
        if (!playoff.available) warnings.push(playoff.reason);
        const coverage = { scheduled: weekly.filter(w => w.opponentRosterId != null).length, total: tradeWeeks.length,
            projected: weekly.filter(w => w.beforeWinPct != null && w.afterWinPct != null).length,
            missing: [...new Set(weekly.flatMap(w => w.missingPlayerIds))].length };
        return { version: VERSION, status: warnings.length ? 'limited' : 'ready', reason: null, effectiveWeek: ctx.fromWeek, remainingWeeks: tradeWeeks.length,
            coverage, calculatedAt: ctx.calculatedAt, freshness: ctx.freshness, assumptions: [...ctx.assumptions, 'Ties count as half a win. Playoff seeding uses record, then points scored.',
                'Exact record and points ties are shared using common random tiebreak draws; further official tiebreakers may differ.',
                ...(medianEnabled ? ['This league awards a head-to-head and median standings decision each week; expected wins include both.'] : [])], warnings,
            powerRank: power, wins, playoffs: playoff, weeks: weekly };
    }
    const api = { VERSION, prepare, analyze };
    App.TradeSeasonImpact = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
