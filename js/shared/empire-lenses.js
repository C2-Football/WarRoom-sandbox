/* global module */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const modes = {
        waivers: { label: 'Waivers', tab: 'fa', service: 'RosterWaiverLens' },
        lineup: { label: 'Lineup', tab: 'lineup', service: 'RosterLineupLens' },
        trades: { label: 'Trades', tab: 'trades', service: 'RosterTradeLens' },
    };
    const id = league => String(league?.league_id || league?.id || '');
    const platform = league => league._platform || (league._mfl ? 'mfl' : league._espn ? 'espn' : league._yahoo ? 'yahoo' : 'sleeper');
    function ownerKey(userId) {
        const owner = (App.OD || root.OD)?.getCurrentUserId?.();
        return owner ? 'account:' + owner : userId ? 'sleeper:' + userId : '';
    }
    function createPriceCache() {
        const entries = new Map();
        const ttl = 15 * 60 * 1000;
        const ordered = object => Object.entries(object || {}).sort(([a], [b]) => a.localeCompare(b));
        const scope = (league, accountKey) => accountKey && id(league) && league.season
            ? JSON.stringify([accountKey, platform(league), id(league), String(league.season),
                Number(league.total_rosters) || league.rosters?.length, league.roster_positions || [], ordered(league.scoring_settings), ordered(league.settings)])
            : '';
        const fresh = (builtAt, now) => Number.isFinite(builtAt) && now >= builtAt && now - builtAt < ttl;
        const capture = (league, accountKey, intel, liveLeague, now = Date.now()) => {
            const key = scope(league, accountKey), builtAt = Date.parse(intel?.builtAt);
            if (!key || scope(liveLeague, accountKey) !== key || String(intel?.sourceLeagueId || '') !== id(league) || intel._projectedYear != null
                || !fresh(builtAt, now) || !Object.keys(intel?.playerScores || {}).length) return null;
            const saved = entries.get(key);
            if (saved?.builtAt === builtAt) return saved.values;
            const values = { ...intel.playerScores };
            entries.set(key, { builtAt, values });
            if (entries.size > 16) entries.delete(entries.keys().next().value);
            return values;
        };
        const read = (league, accountKey, now = Date.now()) => {
            const key = scope(league, accountKey), saved = entries.get(key);
            if (!saved) return null;
            if (fresh(saved.builtAt, now)) return saved.values;
            entries.delete(key);
            return null;
        };
        return { capture, read };
    }
    function captureActivePrices(cache, league, accountKey) {
        if (!cache || !league || !App.LI_LOADED || String(root.S?.currentLeagueId || '') !== id(league)) return null;
        if (root.S.season != null && String(root.S.season) !== String(league.season)) return null;
        const liveLeague = (root.S.leagues || []).find(item => id(item) === id(league));
        return liveLeague ? cache.capture(league, accountKey, App.LI, liveLeague) : null;
    }
    function list(leagues, sleeperUserId) {
        return (leagues || []).filter(league => id(league) && league.season != null).map(league => {
            const provider = platform(league);
            const userId = league.myUserId || (provider === 'sleeper' ? sleeperUserId : null);
            const rosters = Array.isArray(league.rosters) ? league.rosters : [];
            const rosterId = league.myRosterId ?? league._mflFranchiseId;
            const roster = rosters.find(item => rosterId != null && String(item.roster_id) === String(rosterId))
                || rosters.find(item => userId && String(item.owner_id) === String(userId))
                || rosters.find(item => userId && (item.co_owners || []).map(String).includes(String(userId)));
            return { key: JSON.stringify([provider, id(league), String(league.season), String(roster?.roster_id ?? '')]), league, userId, roster, provider };
        });
    }
    function elimination(entry, nfl) {
        const { league, roster, provider } = entry;
        if (!roster || league._portfolioStale || provider !== 'sleeper'
            || (nfl && String(nfl.season) !== String(league.season))) return null;
        if (App.Chopped?.isChopped?.(league)) {
            const choppedWeek = App.Chopped.eliminatedWeek?.(roster);
            const week = Number(nfl?.display_week || nfl?.week);
            return Number.isInteger(choppedWeek) && choppedWeek <= 18 && (!(week > 0) || choppedWeek <= week)
                ? 'Chopped in Week ' + choppedWeek : null;
        }
        if (nfl?.season_type !== 'regular' || ['pre_draft', 'drafting'].includes(league.status)
            || !Object.prototype.hasOwnProperty.call(league, 'bracket_overrides_id')) return null;
        // Use league records only after an entire week has cleared the provider
        // calendar. The playoff race verifier checks every team, the seeding
        // rules and exact record coverage before allowing elimination calls.
        const through = Number(nfl.display_week || nfl.week) - 1;
        if (!Number.isInteger(through) || through < 1 || through >= Number(league.settings?.playoff_week_start)) return null;
        const table = (league.rosters || []).map(({ roster_id: rid, settings = {} }) =>
            ({ rid, wins: settings.wins, losses: settings.losses, ties: settings.ties }));
        if (Number(league.total_rosters) !== table.length) return null;
        const race = root.WrWirePlayoffs?.race?.({ league, edition: { completedThrough: through, table } });
        return race?.supported && race.rows.some(row => row.id === String(roster.roster_id) && row.status === 'Eliminated')
            ? 'Eliminated from playoff contention' : null;
    }
    async function playoffElimination(entry, nfl, signal) {
        const { league, roster, provider, userId } = entry;
        const start = Number(league.settings?.playoff_week_start);
        const week = Number(nfl?.display_week || nfl?.week);
        const slots = Number(league.settings?.playoff_teams);
        if (!roster || league._portfolioStale || provider !== 'sleeper' || App.Chopped?.isChopped?.(league)
            || ['pre_draft', 'drafting'].includes(league.status) || ![2, 4, 6, 8].includes(slots)
            || !Number.isInteger(start) || start < 1 || start > 18 || !(week >= start)
            || !root.WrWirePlayoffs?.load || signal?.aborted) return null;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const timeout = setTimeout(cancel, 7000);
        try {
            const bracket = await root.WrWirePlayoffs.load({ league, signal: controller.signal });
            if (controller.signal.aborted || bracket?.provisional !== false || !['ready', 'partial'].includes(bracket.status)
                || id(bracket.league) !== id(league) || String(bracket.season) !== String(league.season)
                || Number(bracket.league?.settings?.playoff_teams) !== slots || !Array.isArray(bracket.paths)) return null;
            const ownId = String(roster.roster_id);
            const officialRoster = bracket.league?.rosters?.find(row => String(row.roster_id) === ownId);
            const account = String(userId || roster.owner_id || '');
            if (!officialRoster || !account || (String(officialRoster.owner_id) !== account
                && !(officialRoster.co_owners || []).map(String).includes(account))) return null;
            const own = bracket.paths.find(path => path.team?.id === ownId);
            if (own?.rounds?.some(round => round.outcome === 'eliminated')) return 'Eliminated in the playoffs';
            const field = new Set(bracket.paths.map(path => path.team?.id).filter(Boolean));
            return !own && field.size === slots ? 'Missed the playoffs' : null;
        } catch (_) {
            return null;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', cancel);
        }
    }
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'Other'];
    function groupPlayers(entries, rows, players) {
        const grouped = new Map();
        entries.forEach(entry => {
            const cached = rows[entry.key];
            if (cached?.league !== entry.league) return;
            for (const candidate of cached.result?.candidates || []) {
                for (const asset of candidate.incoming || []) {
                    const pid = String(asset?.pid ?? asset?.id ?? '');
                    if (!pid) continue;
                    let row = grouped.get(pid);
                    if (!row) {
                        const player = players?.[pid];
                        const raw = player?.position || asset.position || asset.pos;
                        const normalized = App.RosterLensBasis?.position(raw) || String(raw || '').toUpperCase();
                        const position = positions.includes(normalized) ? normalized : 'Other';
                        row = { pid, player, position, name: player?.full_name || asset.name || pid,
                            team: player?.team || asset.team || null, byLeague: new Map(), bestDelta: null };
                        grouped.set(pid, row);
                    }
                    if (!row.byLeague.has(entry.key)) row.byLeague.set(entry.key, { entry, candidates: [] });
                    const matches = row.byLeague.get(entry.key).candidates;
                    if (matches.some(value => value === candidate || (candidate.id != null && value.id === candidate.id))) continue;
                    matches.push(candidate);
                    const delta = candidate.weekly?.delta;
                    if (Number.isFinite(delta) && (row.bestDelta == null || delta > row.bestDelta)) row.bestDelta = delta;
                }
            }
        });
        const byPosition = new Map();
        for (const { byLeague, ...row } of grouped.values()) {
            if (!byPosition.has(row.position)) byPosition.set(row.position, []);
            byPosition.get(row.position).push({ ...row, leagues: Array.from(byLeague.values()) });
        }
        return positions.filter(position => byPosition.has(position)).map(position => ({
            position,
            players: byPosition.get(position).sort((a, b) => (b.bestDelta ?? -Infinity) - (a.bestDelta ?? -Infinity)
                || a.name.localeCompare(b.name) || a.pid.localeCompare(b.pid)),
        }));
    }
    function summarize(mode, result) {
        const candidates = mode === 'lineup' ? (result?.recommendations || result?.candidates) : result?.candidates;
        const available = mode === 'waivers' ? (candidates || []).filter(candidate => candidate.weekly?.delta > 0)
            .sort((a, b) => b.weekly.delta - a.weekly.delta) : (candidates || []);
        return { ...result, status: result?.status || 'unavailable', candidates: available, total: available.length };
    }
    const unavailable = reason => ({ status: 'unavailable', reason, candidates: [], total: 0 });
    async function load(entry, { mode, basis, players, accountKey, nfl, statsData, priorData, projectionsData, priceCache, signal, isCurrent = () => true }) {
        const service = App[modes[mode]?.service];
        const { league: raw, roster, userId, provider } = entry;
        const currentWeek = Number(nfl?.display_week || nfl?.week);
        if (!accountKey || !isCurrent()) return unavailable('Account context changed. Open Empire again.');
        if (!roster) return unavailable('Connect your team in this league to see recommendations.');
        if (raw._portfolioStale) return unavailable('Refresh this league to verify player ownership.');
        if (!nfl || String(nfl.season) !== String(raw.season) || !Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > 18) return unavailable('Current-season NFL data is unavailable for this league.');
        if (nfl.season_type !== 'regular') return unavailable('Recommendations resume in the NFL regular season.');
        const eliminationReason = elimination(entry, nfl) || await playoffElimination(entry, nfl, signal);
        if (!isCurrent()) return unavailable('Account context changed. Open Empire again.');
        const markEliminated = result => eliminationReason ? { ...result, status: 'eliminated', elimination: eliminationReason } : result;
        if (!service?.load) return markEliminated(unavailable('The comparison service could not load.'));
        const league = { ...raw, _platform: provider };
        const skin = App.LeagueSkin?.build?.({ league, rosters: league.rosters, myRoster: roster, nflState: nfl });
        const activePrices = captureActivePrices(priceCache, league, accountKey);
        const dynastyPrices = activePrices || priceCache?.read(league, accountKey);
        const gm = root.WR?.GmMode?.effects?.(id(league));
        const opts = { accountKey, userId: userId || roster.owner_id, league, roster, rosters: league.rosters,
            rostersLeagueId: id(league), players, skin, gm, basis, currentSeason: String(nfl.season),
            currentWeek, week: mode === 'trades' ? currentWeek + 1 : currentWeek,
            statsData, statsSeason: String(nfl.season), priorData, projectionsData };
        if (mode === 'waivers' && ['dynasty', 'empire'].includes(skin?.type)) {
            // Weekly comparisons can still use league-scored projections while
            // dynasty prices are loading. Saved price floors still apply.
            opts.valuesByPid = dynastyPrices || {};
        }
        if (mode === 'trades') {
            if (skin?.type === 'redraft') {
                const board = App.PlayerValue?.computePrices?.({ ...opts, leagueId: id(league), week: currentWeek, playersData: players, playerScores: {}, noMarketFetch: true });
                opts.valuesByPid = board?.values || {};
            } else if (['dynasty', 'keeper'].includes(skin?.type)) {
                opts.valuesByPid = dynastyPrices || {};
            }
            opts.assessments = league.empireAssessments;
            if (activePrices) opts.ownerIntel = App.LI;
            opts.projectionsByPid = {};
            if (basis === 'projected' && opts.week <= 18 && App.WeeklyProj?.projectPlayer) {
                const lines = await App.WeeklyProj.ensureWeekProjections?.(opts.week, { season: league.season }) || {};
                if (!isCurrent()) return unavailable('Account context changed. Open Empire again.');
                const rostered = new Set(league.rosters.flatMap(item => item.players || []));
                for (const pid of rostered) {
                    // A trade starts in the next full NFL week. Only use a
                    // published projection for that week in this forecast.
                    if (!lines[pid]) continue;
                    const projection = App.WeeklyProj.projectPlayer(pid, { playersData: players, statsData, priorData,
                        projectionsData, scoring: league.scoring_settings, providerProjections: lines, week: opts.week });
                    if (projection?.available) opts.projectionsByPid[pid] = projection;
                }
            }
        }
        const result = await service.load(opts);
        if (!isCurrent()) return unavailable('Account context changed. Open Empire again.');
        if (mode === 'trades' && ['dynasty', 'keeper'].includes(skin?.type) && !dynastyPrices && result?.status === 'unavailable') {
            return markEliminated(unavailable('Open this league to load its dynasty trade values.'));
        }
        return markEliminated(summarize(mode, result));
    }
    const api = { modes, ownerKey, createPriceCache, captureActivePrices, list, elimination, groupPlayers, load };
    App.EmpireLenses = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
