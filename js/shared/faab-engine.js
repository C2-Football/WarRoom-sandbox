// Descriptive completed same-position bid history, not winning probabilities.
// A bid requires five observations, verified eligibility and an affordable minimum.
// Rival need/aggression fields are comparative heuristics only.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const DEFAULT_PCTS = { p25: 4, p50: 8, p75: 15, p90: 25 }; // % of budget, league-agnostic
    const SPEND_CAP = 0.65;        // of my remaining, unless strength ≥ CAP_LIFT

    function quantile(sorted, q) {
        if (!sorted.length) return null;
        const i = (sorted.length - 1) * q;
        const lo = Math.floor(i), hi = Math.ceil(i);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
    }

    function rosterName(roster, league) {
        if (!roster) return '—';
        const users = (league && league.users) || [];
        const u = users.find(x => String(x.user_id) === String(roster.owner_id));
        return (roster.metadata && roster.metadata.team_name)
            || (u && u.metadata && u.metadata.team_name)
            || (u && u.display_name)
            || ('Team ' + roster.roster_id);
    }

    // Elimination awareness for CHOPPED leagues. Read lazily: chopped.js loads
    // before this file in the browser and Node tests require it first, but a
    // missing module must degrade to "nobody is eliminated" rather than throw.
    const choppedOf = () => (App && App.Chopped) || null;

    // Positional need from live rosters: healthy bodies at the position vs the
    // dedicated starting slots for it. HIGH = can't fill the slots without this
    // add (or exactly fills them — one injury from a hole), MED = one deep.
    const OUT = new Set(['OUT', 'IR', 'PUP', 'SUS', 'NA', 'COV', 'DOUBTFUL']);
    function needAt(roster, pos, league, playersData) {
        const demand = App.PlayerValue?.slotsFromRoster?.(league?.roster_positions) || {};
        const eligible = { FLEX:['RB','WR','TE'], SUPER_FLEX:['QB','RB','WR','TE'], QB_FLEX:['QB','RB','WR','TE'], OP:['QB','RB','WR','TE'] };
        const slots = demand[pos] ?? ((league?.roster_positions || []).reduce((n,s) => n + (s === pos ? 1 : eligible[s]?.includes(pos) ? (s === 'FLEX' ? 1/3 : pos === 'QB' ? .75 : 1/12) : 0), 0));
        if (!slots) return 'LOW';
        let healthy = 0;
        const res = new Set((roster.reserve || []).concat(roster.taxi || []));
        for (const pid of (roster.players || [])) {
            if (res.has(pid)) continue;
            const p = playersData && playersData[pid];
            const ppos = (App.normPos && App.normPos(p && p.position)) || (p && p.position);
            if (String(ppos || '').toUpperCase() !== pos) continue;
            if (!OUT.has(String((p && p.injury_status) || '').toUpperCase())) healthy++;
        }
        if (healthy <= slots) return 'HIGH';
        if (healthy === slots + 1) return 'MED';
        return 'LOW';
    }

    // Completed winning bids only, as a percent of this league budget.
    function extractBids(txns, budget) {
        const out = [];
        for (const t of (txns || [])) {
            if (!t || t.type !== 'waiver' || t.status !== 'complete') continue;
            const bid = Number(t.settings && t.settings.waiver_bid);
            if (!Number.isFinite(bid) || bid < 0 || bid > budget || !(budget > 0)) continue;
            const rosterId = (t.roster_ids && t.roster_ids[0]) != null ? t.roster_ids[0]
                : (t.adds ? Object.values(t.adds)[0] : null);
            out.push({
                week: Number(t.leg) || null,
                pid: t.adds ? Object.keys(t.adds)[0] : null,
                bid,
                pct: (bid / budget) * 100,
                rosterId,
                won: t.status !== 'failed',
            });
        }
        return out.sort((a, b) => (b.week || 0) - (a.week || 0) || (b.created || 0) - (a.created || 0));
    }

    function analyze(opts) {
        const league = (opts && opts.league) || {};
        const myId = String(opts && opts.myRosterId != null ? opts.myRosterId : '');
        const playersData = opts && opts.playersData;
        const pos = String((opts && opts.targetPos) || '').toUpperCase();
        const strength = Math.max(0, Math.min(1, Number(opts && opts.targetStrength) || 0.5));

        const st = league.settings || {};
        const budget = Number(st.waiver_budget) || 0;
        if (!(budget > 0)) return null;                       // not a FAAB league
        // GM Strategy's user-set minimum-bid override takes precedence over the
        // imported platform value — some leagues/platforms don't expose the
        // real waiver_budget_min reliably.
        const override = Number(opts && opts.minBidOverride);
        const minBid = override > 0 ? Math.round(override) : st.waiver_budget_min == null ? 1 : Math.max(0, Number(st.waiver_budget_min));

        const rosters = league.rosters || [];
        const mine = rosters.find(r => String(r.roster_id) === myId);
        const leftOf = r => Math.max(0, budget - (Number(r.settings && r.settings.waiver_budget_used) || 0));
        const myLeft = mine?.settings?.waiver_budget_used != null ? leftOf(mine) : null;
        const eligibility = App.RecommendationEligibility?.check(league, mine);
        const blocked = eligibility?.ok === false ? eligibility.reason : myLeft == null ? 'Remaining FAAB is unavailable.' : myLeft < minBid ? 'Remaining FAAB is below the minimum bid.' : null;

        const seen = new Set();
        const txns = (opts?.txns || []).filter(t => {
            const ids = Object.keys(t.adds || {}), key = t.transaction_id || JSON.stringify([ids,t.roster_ids,t.created,t.leg,t.settings?.waiver_bid]);
            if (seen.has(key) || ids.length !== 1 || playersData?.[ids[0]]?.position !== pos || t.league_id && String(t.league_id) !== String(league.league_id || league.id)) return false;
            seen.add(key); return true;
        });
        const bids = extractBids(txns, budget);
        const coldStart = bids.length < 5;
        const pctsSorted = bids.map(b => b.pct).sort((a, b) => a - b);
        const P = coldStart ? DEFAULT_PCTS : {
            p25: quantile(pctsSorted, 0.25), p50: quantile(pctsSorted, 0.5),
            p75: quantile(pctsSorted, 0.75), p90: quantile(pctsSorted, 0.9),
        };

        // Market price for THIS target: slide the quantile with strength.
        const q = 0.4 + 0.5 * strength;                        // 0.4 .. 0.9
        const marketPct = coldStart
            ? P.p50 + (P.p90 - P.p50) * Math.max(0, (q - 0.5) / 0.4)
            : quantile(pctsSorted, q);
        const marketBid = Math.max(minBid, Math.round((marketPct / 100) * budget));

        // Per-rival aggression: their median bid % vs the league's, 0.5..2.
        const byRoster = {};
        bids.forEach(b => { if (b.rosterId != null) (byRoster[String(b.rosterId)] = byRoster[String(b.rosterId)] || []).push(b.pct); });
        const leagueMed = P.p50 || 1;
        const aggrOf = id => {
            const own = (byRoster[String(id)] || []).sort((a, b) => a - b);
            if (own.length < 2) return 1;
            return Math.max(0.5, Math.min(2, (quantile(own, 0.5) || leagueMed) / leagueMed));
        };

        // A CHOPPED team is not a rival. Its roster is empty (so needAt saw
        // zero bodies and returned HIGH at every position) and its budget is
        // frozen rather than zeroed (so faabLeft stayed large) — which made
        // every eliminated team read as a fully-funded, high-need bidder and
        // inflated the recommendation with each week of the season. In an
        // 18-team chopped league that is 17 ghosts by the end.
        const rivals = rosters
            .filter(r => String(r.roster_id) !== myId)
            .filter(r => { const Ch = choppedOf(); return !(Ch && Ch.isEliminated(r)); })
            .map(r => {
                const need = pos ? needAt(r, pos, league, playersData) : 'MED';
                const faabLeft = leftOf(r);
                const aggr = aggrOf(r.roster_id);
                const engaged = need !== 'LOW' && faabLeft >= minBid;
                const raw = marketBid * aggr * (need === 'HIGH' ? 1.15 : 0.85);
                const estBid = engaged ? Math.max(minBid, Math.min(faabLeft, Math.round(raw))) : 0;
                return { rosterId: r.roster_id, name: rosterName(r, league), faabLeft, need, aggr: Math.round(aggr * 100) / 100, estBid, engaged };
            })
            .sort((a, b) => b.estBid - a.estBid);

        // Descriptive history only: no calibrated bidding/participation model.
        const ladder = !blocked && !coldStart ? [...new Set([P.p25,P.p50,P.p75].map(p => Math.min(myLeft, Math.max(minBid, Math.round(p * budget / 100)))))].map(bid => ({ bid, basis: 'historical winning bids' })) : [];
        // ── Horizon-aware spend cap ──────────────────────────────────
        // Holding budget back only makes sense if you will be alive to spend
        // it. In a CHOPPED league the survival horizon is short and shrinking,
        // and unspent FAAB is simply wasted: in a real 18-team league the
        // three teams that spent nothing went out in weeks 1, 2 and 3, and the
        // champion finished with $565 left while a team eliminated in week 15
        // still held $4,213. So the cap relaxes toward "spend it" as the
        // expected weeks remaining fall. No horizon supplied → unchanged.
        const horizonWeeks = Number(opts && opts.horizonWeeks) || null;
        const horizonCap = (() => {
            if (!(horizonWeeks > 0)) return SPEND_CAP;
            if (horizonWeeks <= 1.5) return 1;              // last stand — hold nothing back
            if (horizonWeeks <= 3) return 0.9;
            if (horizonWeeks <= 5) return 0.8;
            return SPEND_CAP;
        })();
        const cap = myLeft == null ? null : Math.min(myLeft, Math.max(minBid, Math.round(myLeft * horizonCap)));
        const rec = !blocked && !coldStart ? { bid: Math.min(cap, Math.max(minBid, Math.round(P.p50 * budget / 100))), capped: P.p50 * budget / 100 > cap, basis: 'Budget-limited historical median; not a prediction of a winning bid.' } : null;

        const spentPct = r => budget ? Math.round(((budget - leftOf(r)) / budget) * 100) : 0;
        // Average over LIVE teams only — a chopped team's spend is frozen, so
        // counting corpses drags league spend down every week and makes the
        // market read cheaper than it is.
        const liveRosters = rosters.filter(r => { const Ch = choppedOf(); return !(Ch && Ch.isEliminated(r)); });
        const leagueSpent = liveRosters.length
            ? Math.round(liveRosters.reduce((s, r) => s + spentPct(r), 0) / liveRosters.length) : 0;

        // Burn rate vs the horizon: what you can afford to spend per week, and
        // what you are on track to LEAVE ON THE TABLE if you keep pacing at
        // the league's average weekly outlay.
        const pacing = (horizonWeeks > 0) ? (() => {
            const perWeek = Math.round(myLeft / horizonWeeks);
            // League's average weekly spend so far, as a pace comparison.
            const weeksPlayed = Math.max(1, Math.max(...bids.map(b => b.week || 0), 0));
            const myBids = bids.filter(b => String(b.rosterId) === myId && b.won);
            const mySpend = myBids.reduce((s, b) => s + b.bid, 0);
            const myPace = Math.round(mySpend / weeksPlayed);
            const projectedUnspent = Math.max(0, Math.round(myLeft - myPace * horizonWeeks));
            return {
                horizonWeeks: Math.round(horizonWeeks * 10) / 10,
                affordPerWeek: perWeek,
                myPacePerWeek: myPace,
                projectedUnspent,
                cap: horizonCap,
                // Hoarding is the failure mode this format punishes.
                verdict: projectedUnspent > budget * 0.25 ? 'hoarding'
                    : projectedUnspent > budget * 0.1 ? 'slightly-under'
                    : 'on-pace',
            };
        })() : null;

        return {
            status: blocked ? 'unavailable' : coldStart ? 'insufficient-history' : 'ready', reason: blocked || (coldStart ? 'At least five completed same-position bids are needed for a descriptive range.' : null), probabilityCalibrated: false,
            coldStart, sampleSize: bids.length,
            budget, minBid, myLeft, pacing,
            mySpentPct: mine ? spentPct(mine) : 0,
            leagueSpentPct: leagueSpent,
            marketBid, medianBid: Math.max(1, Math.round((leagueMed / 100) * budget)),
            ladder, rec, rivals,
            comps: bids.filter(b => b.won).slice(0, 8),
        };
    }

    App.Faab = App.Faab || { analyze, extractBids, needAt, quantile };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Faab;
})(typeof window !== 'undefined' ? window : globalThis);
