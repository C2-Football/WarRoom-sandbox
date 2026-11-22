(function (root) {
    'use strict';
    // Build only from weeks visible in this edition, including archived editions.
    function ledger(league, weeks, through) {
        const start = Number(league.settings?.start_week) || 1;
        const rows = league.rosters.map(r => ({ rosterId: String(r.roster_id), wins: 0, losses: 0, ties: 0, pf: 0, weekly: [] }));
        const byId = new Map(rows.map(row => [row.rosterId, row]));
        for (let week = start; week <= through; week++) {
            const raw = weeks.find(w => Number(w.week) === week)?.rows;
            const pairs = root.WrWireStories.inspect(raw, league);
            if (!pairs || pairs.length * 2 !== rows.length) return null;
            const points = root.App.LeagueLiveScores.rosterPoints;
            const sorted = raw.map(r => points(r)).sort((a,b) => a-b);
            const median = (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)]) / 2;
            for (const pair of pairs) {
                pair.forEach((r,i) => {
                    const t = byId.get(String(r.roster_id)), pts = points(r), opp = points(pair[1-i]);
                    t[pts > opp ? 'wins' : pts < opp ? 'losses' : 'ties']++;
                    t.pf += pts;
                    t.weekly.push({week, pts, median});
                });
            }
        }
        return { rows };
    }
    function fullSchedule(pairs, race) {
        const ids = new Set(race.rows.map(r => r.id));
        for (let offset = 1; offset <= race.remainingWeeks; offset++) {
            const games = pairs?.[race.throughWeek + offset];
            if (!Array.isArray(games) || games.some(g => !Array.isArray(g) || g.length !== 2)) return false;
            const entrants = games.flat().map(String);
            if (entrants.length !== ids.size || new Set(entrants).size !== ids.size || entrants.some(id => !ids.has(id))) return false;
        }
        return true;
    }
    function advantage(a, b) {
        if (!a?.weekly.length || !b?.weekly.length) return null;
        let count = 0;
        for (const x of a.weekly) for (const y of b.weekly) count += x.pts > y.pts ? 1 : x.pts === y.pts ? 0.5 : 0;
        return Math.round(100 * count / (a.weekly.length * b.weekly.length));
    }
    function history(league, through, seasons) {
        const comparisons = new Map();
        const elapsed = through - (Number(league.settings?.start_week) || 1);
        for (const past of [...seasons].sort((a,b) => Number(b.league.season) - Number(a.league.season))) {
            const old = past.league;
            if (+old.season >= +league.season || !old.rosters?.length || Number(old.settings?.league_average_match || 0) !== Number(league.settings?.league_average_match || 0)) continue;
            const week = (Number(old.settings?.start_week) || 1) + elapsed;
            if (!(week < Number(old.settings?.playoff_week_start))) continue;
            const snap = ledger(old, past.weeks, week);
            if (!snap) continue;
            const table = snap.rows.map(row => {
                let { wins, losses, ties } = row;
                if (+old.settings.league_average_match === 1) for (const g of row.weekly) {
                    if (g.pts > g.median) wins++; else if (g.pts < g.median) losses++; else ties++;
                }
                return {rid:row.rosterId, wins, losses, ties};
            });
            const prior = root.WrWirePlayoffs.race({league:old, edition:{table, completedThrough:week}});
            for (const row of prior.rows) {
                const owner = old.rosters.find(r => String(r.roster_id) === row.id)?.owner_id;
                if (owner && !comparisons.has(owner)) comparisons.set(owner, { season:old.season, week, ...row });
            }
        }
        return comparisons;
    }
    root.WrWireHunt = { ledger, fullSchedule, advantage, history };
})(typeof window !== 'undefined' ? window : globalThis);
