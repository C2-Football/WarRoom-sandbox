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
    function summarize(mode, result) {
        const candidates = mode === 'lineup' ? (result?.recommendations || result?.candidates) : result?.candidates;
        const available = mode === 'waivers' ? (candidates || []).filter(candidate => candidate.weekly?.delta > 0)
            .sort((a, b) => b.weekly.delta - a.weekly.delta) : (candidates || []);
        return { ...result, status: result?.status || 'unavailable', candidates: available.slice(0, 3), total: available.length };
    }
    const unavailable = reason => ({ status: 'unavailable', reason, candidates: [], total: 0 });
    async function load(entry, { mode, basis, players, accountKey, nfl, statsData, priorData, projectionsData, isCurrent = () => true }) {
        const service = App[modes[mode]?.service];
        const { league: raw, roster, userId, provider } = entry;
        const currentWeek = Number(nfl?.display_week || nfl?.week);
        if (!accountKey || !isCurrent()) return unavailable('Account context changed. Open Empire again.');
        if (!roster) return unavailable('Connect your team in this league to see recommendations.');
        if (raw._portfolioStale) return unavailable('Refresh this league to verify player ownership.');
        if (!nfl || String(nfl.season) !== String(raw.season) || !Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > 18) return unavailable('Current-season NFL data is unavailable for this league.');
        if (nfl.season_type !== 'regular') return unavailable('Recommendations resume in the NFL regular season.');
        if (!service?.load) return unavailable('The comparison service could not load.');
        const league = { ...raw, _platform: provider };
        const skin = App.LeagueSkin?.build?.({ league, rosters: league.rosters, myRoster: roster, nflState: nfl });
        const activeIntel = App.LI_LOADED && String(App.LI?.sourceLeagueId || '') === id(league) ? App.LI : null;
        const gm = root.WR?.GmMode?.effects?.(id(league));
        const opts = { accountKey, userId: userId || roster.owner_id, league, roster, rosters: league.rosters,
            rostersLeagueId: id(league), players, skin, gm, basis, currentSeason: String(nfl.season),
            currentWeek, week: mode === 'trades' ? currentWeek + 1 : currentWeek,
            statsData, statsSeason: String(nfl.season), priorData, projectionsData };
        if (mode === 'waivers' && ['dynasty', 'empire'].includes(skin?.type)) {
            // Weekly comparisons can still use league-scored projections while
            // dynasty prices are loading. Saved price floors still apply.
            opts.valuesByPid = activeIntel?.playerScores || {};
        }
        if (mode === 'trades') {
            if (skin?.type === 'redraft') {
                const board = App.PlayerValue?.computePrices?.({ ...opts, leagueId: id(league), week: currentWeek, playersData: players, playerScores: {}, noMarketFetch: true });
                opts.valuesByPid = board?.values || {};
            } else if (activeIntel && ['dynasty', 'keeper'].includes(skin?.type)) {
                opts.valuesByPid = activeIntel.playerScores;
            }
            opts.assessments = league.empireAssessments;
            if (activeIntel) opts.ownerIntel = activeIntel;
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
        if (mode === 'trades' && ['dynasty', 'keeper'].includes(skin?.type) && !activeIntel && result?.status === 'unavailable') {
            return unavailable('Open this league to load its dynasty trade values.');
        }
        return summarize(mode, result);
    }
    const api = { modes, ownerKey, list, load };
    App.EmpireLenses = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
