// ══════════════════════════════════════════════════════════════════
// js/shared/chopped.js — window.App.Chopped
// Elimination state for Sleeper CHOPPED leagues (the native guillotine /
// last-man-standing format, settings.type === 3).
//
// Every week the LOWEST-scoring team is chopped and its entire roster is
// released to waivers; the last team standing wins. There are no head-to-head
// matchups, no playoffs, and usually no trading.
//
// Sleeper marks this natively and we read it rather than infer it:
//   league.settings.type            3
//   league.settings.last_chopped_leg  most recently completed chop (not the finale)
//   league.settings.leg / last_scored_leg   current / last scored week
//   roster.settings.eliminated      THE WEEK that roster was chopped (absent
//                                   while alive) — verified against a
//                                   reconstructed 2025 ladder, 17/17 exact
//   roster.settings.locked          1 once chopped
//
// Pure + synchronous: callers pass the league and its rosters. No fetching.
// The point of this module is that "is this team dead?" has exactly ONE
// answer in the codebase — several engines were treating a chopped team's
// empty roster as a live, fully-funded, high-need rival.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const CHOPPED_TYPE = 3;

    function settingsOf(o) { return (o && o.settings) || {}; }

    // Native flag first. `last_chopped_leg` is a chopped-only setting and
    // corroborates it, but type is authoritative — a commissioner could in
    // principle clear the leg without changing the format.
    function isChopped(league) {
        if (!league) return false;
        const s = settingsOf(league);
        if (Number(s.type) === CHOPPED_TYPE) return true;
        // Explicit override / already-normalized skins.
        const t = String(league.type || league.league_type || '').toLowerCase();
        return t === 'chopped' || t === 'guillotine';
    }

    function lastChoppedLeg(league) {
        const n = Number(settingsOf(league).last_chopped_leg);
        return n > 0 ? n : null;
    }

    // One elimination per week needs N - 1 weeks from the league's start.
    // Keep the original field size, including eliminated rosters. Sleeper's
    // last_chopped_leg advances AFTER each chop and cannot bound the future.
    function finalChopWeek(league, rosters) {
        const settings = settingsOf(league);
        const start = Math.max(1, Number(settings.start_week) || 1);
        const teams = Number(league && league.total_rosters) || Number(settings.num_teams)
            || (rosters || (league && league.rosters) || []).length || 18;
        return Math.min(18, start + Math.max(1, teams - 1) - 1);
    }

    // The week this roster was chopped, or null while it's alive.
    function eliminatedWeek(roster) {
        const n = Number(settingsOf(roster).eliminated);
        return n > 0 ? n : null;
    }
    function isEliminated(roster) { return eliminatedWeek(roster) != null; }

    // Alive AS OF a given week: a team chopped in week 4 was still playing
    // during week 4 (its week-4 score is what killed it), so it counts as
    // alive for any week <= 4. Omit `week` to mean "alive right now".
    function isAliveInWeek(roster, week) {
        const w = eliminatedWeek(roster);
        if (w == null) return true;
        const wk = Number(week);
        return wk > 0 ? wk <= w : false;
    }

    function aliveRosters(rosters, week) {
        return (rosters || []).filter(r => isAliveInWeek(r, week));
    }
    function eliminatedRosters(rosters) {
        return (rosters || []).filter(isEliminated);
    }

    // The full picture for a league, in one call.
    function state(opts) {
        opts = opts || {};
        const league = opts.league || null;
        const rosters = opts.rosters || (league && league.rosters) || [];
        const chopped = isChopped(league);
        const week = Number(opts.week) || null;
        const order = eliminatedRosters(rosters)
            .map(r => ({ rosterId: r.roster_id, week: eliminatedWeek(r) }))
            .sort((a, b) => a.week - b.week);
        const alive = aliveRosters(rosters, null);
        return {
            isChopped: chopped,
            teams: (rosters || []).length,
            aliveCount: alive.length,
            aliveRosterIds: alive.map(r => r.roster_id),
            choppedCount: order.length,
            order,
            lastChoppedLeg: lastChoppedLeg(league),
            finalChopWeek: finalChopWeek(league, rosters),
            // Only a finished league has a survivor; mid-season "1 alive" can't
            // happen, but guard anyway rather than crowning someone early.
            survivorRosterId: (chopped && alive.length === 1 && order.length === (rosters || []).length - 1)
                ? alive[0].roster_id : null,
            // Next chop lands on the current week while the format is still
            // executing; a completed chop never terminates a living field.
            nextChopWeek: (chopped && alive.length > 1 && week
                && week >= (Number(settingsOf(league).start_week) || 1)
                && week > (lastChoppedLeg(league) || 0)
                && week <= finalChopWeek(league, rosters)) ? week : null,
        };
    }

    // A personal, current-week read. No ranking against an incomplete field and
    // no "nothing left to do" claim without verified starter locks.
    function survivalInsight({ league, roster, board, finishes = {}, games = [], playersData = {}, projections = {}, now = Date.now() }) {
        if (!isChopped(league) || roster?.roster_id == null || !board?.week) return null;
        const week = Number(board.week), start = Number(league.settings?.start_week) || 1;
        const final = finalChopWeek(league,league.rosters), out = eliminatedWeek(roster);
        const stage = w => final-w <= 3 ? 'late' : w-start < Math.max(1,Math.ceil((final-start+1)/3)) ? 'early' : 'middle';
        if (out && out <= week) return { status:'eliminated',tone:'bad',title:'The axe found us. 🪓',
            detail:'Chopped in Week '+out, noMoves:true,
            message:stage(out)==='early' ? 'A short run, a loud exit. Better luck next year, coach. 🫡'
                : stage(out)==='late' ? 'You gave it a good run, coach. So close to the trophy. 😢' : 'We had a good run. The revenge tour starts next season. 🫡' };
        if (!board.supported || board.error || !['ready','refreshing'].includes(board.status)) return null;
        const active = aliveRosters(league.rosters || [],week), id = String(roster.roster_id);
        const ids = active.map(r=>String(r.roster_id));
        if (active.length < 2 || new Set(ids).size !== ids.length || !ids.includes(id) || ids.some(rid=>!Number.isFinite(finishes[rid]))) return null;
        const mine = Math.round(finishes[id]*100), values = ids.map(rid=>Math.round(finishes[rid]*100));
        const placesAbove = values.filter(points=>points<mine).length;
        if (placesAbove>2) return null;
        const tied = values.filter(points=>points===mine).length>1;
        const ownRow = (board.rows || []).find(r=>String(r.roster_id)===id);
        const slots = (league.roster_positions || []).filter(pos=>!['BN','BE','BENCH','IR','TAXI','RES','RESERVE'].includes(String(pos).toUpperCase()));
        const normalize = value=>({WSH:'WAS',JAC:'JAX',LA:'LAR',AZ:'ARI',OAK:'LV',SD:'LAC'})[String(value||'').toUpperCase()]||String(value||'').toUpperCase();
        const locked = pid=>{
            if (!pid || String(pid)==='0' || !(roster.players || []).map(String).includes(String(pid))) return false;
            const team=normalize(playersData[pid]?.team);
            if(!team)return false;
            const game=games.find(g=>[normalize(g.home),normalize(g.away)].includes(team));
            if (!game || /POSTPONED|CANCEL|SUSPEND|DELAY/i.test(game.statusName||'')) return false;
            const status=App.NflContext?.gameStatus?.(game,now);
            return ['live','final'].includes(status);
        };
        const substitutions = Number(league.settings?.max_subs)>0 || Number(league.settings?.sub_start_time_eligibility)>0;
        const noMoves = !substitutions && slots.length>0 && ownRow?.starters?.length===slots.length && ownRow.starters.every(locked);
        const atBottom=placesAbove===0, late=stage(week)==='late'||active.length<=4;
        const title = atBottom ? tied ? 'Tied at the projected chop line. 🪓' : 'The axe is circling. 🪓' : 'A little too close to the axe. 🪓';
        const detail = finishes[id].toFixed(1)+' projected pts · '+(atBottom ? (tied?'Tied lowest':'Lowest')+' of '+active.length
            : placesAbove+' '+(placesAbove===1?'place':'places')+' above the chop line · +'+((mine-Math.min(...values))/100).toFixed(1)+' pts');
        const message = noMoves ? atBottom ? late ? 'Not this close to the trophy… 😢 Hopes and prayers mode: activated.'
            : 'Hopes and prayers mode: activated. 🕯️ No farewell speech yet, coach.'
            : 'Lineup locked. Stress-refreshing the scores is now a team sport. 😅'
            : atBottom ? 'The axe is circling, but the door is still open. Check your remaining starters before we light the candles.'
                : 'Sweaty-palms territory. Check your remaining starters; let’s keep the axe somebody else’s problem. 😅';
        return {status:'projected',title,detail,message,tone:atBottom?'bad':'neutral',placesAbove,noMoves,
            conditional:active.some(r=>App.LeagueLiveScores?.finishAssumption?.((board.rows||[]).find(row=>String(row.roster_id)===String(r.roster_id)),projections))};
    }

    const api = {
        CHOPPED_TYPE,
        isChopped, lastChoppedLeg, finalChopWeek,
        eliminatedWeek, isEliminated, isAliveInWeek,
        aliveRosters, eliminatedRosters,
        state, survivalInsight,
    };
    App.Chopped = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
