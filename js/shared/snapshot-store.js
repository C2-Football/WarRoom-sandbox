// js/shared/snapshot-store.js — weekly DHQ / health time-series (P0-a data pipeline).
//
// Revives the long-dead STORAGE_KEYS.HEALTH_TIMELINE stub. On every LeagueIntel load
// (DhqEvents 'li:loaded'), it appends a compact per-league snapshot row keyed by NFL
// week — idempotent per (season, week), so reloading the same week overwrites rather
// than duplicates. This is the time-series the Empire terminal needs for the ▲/▼ deltas
// and the "Avg Health up from N last week" reads. localStorage-only v1; a Supabase
// mirror (cross-device, true history) is a later upgrade.
//
// Capture happens on li:loaded, which fires on the real current-season load of an open
// league — so snapshots reflect the current season (not a time-travelled timeYear).
// In pure Empire mode the value source is single-league; each league is captured as it
// is opened, and empireDelta() sums whatever per-league rows exist.
(function () {
    'use strict';

    const KEY = lid => 'dhq_health_timeline_' + lid;   // === STORAGE_KEYS.HEALTH_TIMELINE(lid)
    const MAX_ROWS = 36;                               // ~2 seasons of weekly rows per league

    function store() { return window.App && window.App.DhqStorage; }

    function nflContext() {
        const ns = (window.S && window.S.nflState) || (window.App && window.App.LI && window.App.LI.nflState) || {};
        const season = String(ns.season || (window.S && window.S.currentSeason) || new Date().getFullYear());
        const week = Number(ns.week || ns.display_week || 0);
        return { season, week };
    }

    // Compact snapshot of the currently-loaded league from LI player scores + assessments.
    function captureCurrentLeague() {
        const S = window.S || (window.App && window.App.S);
        const LI = window.App && window.App.LI;
        if (!S || !S.currentLeagueId || !LI || !LI.playerScores) return null;
        const scores = LI.playerScores || {};
        const rosters = S.rosters || [];
        if (!rosters.length) return null;
        let assess = [];
        try {
            assess = (typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal() : []) || [];
        } catch (e) { assess = []; }
        const healthByRid = {};
        assess.forEach(a => { if (a && a.rosterId != null) healthByRid[a.rosterId] = a.healthScore; });
        const teams = rosters.map(r => ({
            rosterId: r.roster_id,
            dhq: (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0),
            health: healthByRid[r.roster_id] != null ? healthByRid[r.roster_id] : null,
        })).filter(t => t.dhq > 0 || t.health != null);
        if (!teams.length) return null;
        const ctx = nflContext();
        return { season: ctx.season, week: ctx.week, ts: Date.now(), teams };
    }

    // Browser observations are distinct from a server monitor and local team totals.
    const saveStates=new Map(),pending=new Map();
    async function capturePlayerValues() {
        if (typeof window.OD?.recordValueSnapshots !== 'function') return;
        const S=window.S||window.App?.S, LI=window.App?.LI;
        if(!S?.currentLeagueId || !LI || LI.sourceLeagueId!==S.currentLeagueId)return;
        const league=(S.leagues||[]).find(l=>l.league_id===S.currentLeagueId);
        const type=league?.settings?.type==null?null:Number(league.settings.type)===0?'redraft':Number(league?.settings?.type)===2?'dynasty':null;
        const lid=S.currentLeagueId;
        if(pending.has(lid))return pending.get(lid);
        if(!type)return; // keeper/unknown formats are not silently labeled dynasty
        const PV=window.App?.PlayerValue,ctx=nflContext(),ts=new Date().toISOString();
        const rosters=(S.rosters||[]).map(r=>({...r,players:[...(r.players||[])]}));
        const ids=[...new Set(rosters.flatMap(r=>r.players||[]))];
        if(!ids.length)return;
        const board=type==='redraft'?PV?.rosState?.():null;
        const settingsFingerprint=await window.App.ValueHistory.fingerprint({scoring:league.scoring_settings,roster:league.roster_positions,settings:league.settings,totalTeams:league.total_rosters}).catch(()=>null);
        const calculated=type==='redraft'?board?.calculatedAt:Date.parse(LI.builtAt||'');
        const stale=!Number.isFinite(calculated)||Date.now()-calculated>(type==='redraft'?15*60000:2*3600000);
        const rows=ids.map(pid=>({leagueId:lid,playerId:pid,season:ctx.season,week:ctx.week,ts,
            value:type==='redraft'?board?.values?.[pid]??null:LI.playerScores?.[pid]??null,
            valueType:type,source:'periodic',status:stale?'stale':undefined,calculatedAt:type==='redraft'?(board?.calculatedAt?new Date(board.calculatedAt).toISOString():null):LI.builtAt||null,
            rosterIds:rosters.filter(r=>(r.players||[]).includes(pid)).map(r=>r.roster_id),
            provenance:{settingsFingerprint,origin:'browser observation; not scheduled monitoring',engineVersion:window.App.ValueEngineVersion||null,settings:league.scoring_settings,rosterPositions:league.roster_positions,sourceFreshness:board?.sourceFreshness||LI.sourceSnapshots||null}}));
        const task=(async()=>{
            saveStates.set(lid,{status:'saving',error:null});
            try {
                let count=0;
                for(let i=0;i<rows.length;i+=500){const result=await window.OD.recordValueSnapshots(rows.slice(i,i+500));count+=result.rows.length;}
                saveStates.set(lid,{status:'verified',verifiedAt:new Date().toISOString(),error:null,count});
                return {ok:true,verified:true,count};
            } catch(e) {
                saveStates.set(lid,{status:'failed',error:e.message});
                if(window.dhqLog)window.dhqLog('snapshot.recordPlayers',e);
                return {ok:false,error:e.message};
            } finally {pending.delete(lid);}
        })();pending.set(lid,task);return task;
    }

    // Append / replace this week's row (idempotent per season+week).
    function record() {
        const st = store(); if (!st) return;
        let row = null;
        try { row = captureCurrentLeague(); } catch (e) { row = null; }
        if (row) {
            const lid = window.S && window.S.currentLeagueId;
            if (lid) {
                const key = KEY(lid);
                const series = st.get(key, []) || [];
                const i = series.findIndex(s => String(s.season) === String(row.season) && Number(s.week) === Number(row.week));
                if (i >= 0) series[i] = row; else series.push(row);
                series.sort((a, b) => (Number(a.season) - Number(b.season)) || (Number(a.week) - Number(b.week)));
                while (series.length > MAX_ROWS) series.shift();
                try { st.set(key, series); } catch (e) { if (window.dhqLog) window.dhqLog('snapshot.record', e); }
            }
        }
        try { capturePlayerValues(); } catch (e) { if (window.dhqLog) window.dhqLog('snapshot.recordPlayers', e); }
        try { window.App?.ForecastLedger?.captureCurrent(); } catch (_) { /* shadow only */ }
    }

    function timeline(lid) { const st = store(); return (st && st.get(KEY(lid), [])) || []; }

    // Latest row vs the previously-captured row → per-team + aggregate deltas for one league.
    function leagueDelta(lid) {
        const s = timeline(lid);
        if (!s.length) return null;
        const cur = s[s.length - 1];
        const prev = s.length >= 2 ? s[s.length - 2] : null;
        const prevByRid = {};
        if (prev) prev.teams.forEach(t => { prevByRid[t.rosterId] = t; });
        const teams = cur.teams.map(t => {
            const p = prevByRid[t.rosterId];
            return {
                rosterId: t.rosterId, dhq: t.dhq, health: t.health,
                dhqDelta: p ? t.dhq - p.dhq : null,
                healthDelta: (p && p.health != null && t.health != null) ? t.health - p.health : null,
            };
        });
        const sum = arr => arr.reduce((a, b) => a + b, 0);
        return {
            season: cur.season, week: cur.week, hasPrev: !!prev,
            totalDHQ: sum(cur.teams.map(t => t.dhq)),
            totalDHQDelta: prev ? sum(cur.teams.map(t => t.dhq)) - sum(prev.teams.map(t => t.dhq)) : null,
            teams,
        };
    }

    // Empire-wide WoW: sum the latest per-league snapshots and their prior rows across
    // the given leagues (each captured independently as it is opened/loaded).
    function empireDelta(leagueIds) {
        // Display totals span ALL leagues; deltas span ONLY leagues that have a prior row
        // (else we'd compare all-leagues-now against some-leagues-then — a meaningless jump).
        let totalDHQ = 0; const allHealth = [];
        let curDHQp = 0, prevDHQp = 0; const curHealthP = [], prevHealthP = []; let anyPrev = false;
        (leagueIds || []).forEach(lid => {
            const s = timeline(lid); if (!s.length) return;
            const cur = s[s.length - 1];
            const prev = s.length >= 2 ? s[s.length - 2] : null;
            const curSum = cur.teams.reduce((a, t) => a + t.dhq, 0);
            totalDHQ += curSum;
            cur.teams.forEach(t => { if (t.health != null) allHealth.push(t.health); });
            if (prev) {
                anyPrev = true;
                curDHQp += curSum;
                prevDHQp += prev.teams.reduce((a, t) => a + t.dhq, 0);
                cur.teams.forEach(t => { if (t.health != null) curHealthP.push(t.health); });
                prev.teams.forEach(t => { if (t.health != null) prevHealthP.push(t.health); });
            }
        });
        const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
        return {
            totalDHQ,
            curDHQ: anyPrev ? curDHQp : null,   // current sum over ONLY the leagues that have a prior (the delta's universe)
            totalDHQDelta: anyPrev ? curDHQp - prevDHQp : null,
            avgHealth: avg(allHealth),
            avgHealthDelta: (anyPrev && prevHealthP.length && curHealthP.length) ? avg(curHealthP) - avg(prevHealthP) : null,
        };
    }

    // Attach the capture listener once DhqEvents is available (shared-loader may load it
    // after this script). li:loaded fires well after page load, so a brief retry is safe.
    (function attach() {
        if (window.DhqEvents && typeof window.DhqEvents.on === 'function') {
            window.DhqEvents.on('li:loaded', record);
            return;
        }
        setTimeout(attach, 200);
    })();

    window.WrSnapshots = { record, timeline, leagueDelta, empireDelta, captureCurrentLeague, capturePlayerValues, saveState:(lid=window.S?.currentLeagueId)=>saveStates.get(lid)||{status:'idle'} };
})();
