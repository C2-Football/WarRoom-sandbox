const assert = require('node:assert/strict');
require('../js/shared/league-live-scores.js');
const L = globalThis.App.LeagueLiveScores;
const league = { league_id: '123', season: '2026' };
assert.equal(L.rosterPoints({ points: 10, custom_points: 0 }), 0);
assert.equal(L.playerPoints({ players_points: { a: -2, b: 0 } }, 'a'), -2);
assert.equal(L.playerPoints({ players_points: { b: 0 } }, 'b'), 0);
assert.equal(L.playerPoints({}, 'a'), null);
assert.equal(L.rosterPoints({ points: null }), null);
assert.equal(L.supported({ league_id: '123', _espn: true }), false);
const rows = [{ roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: '1', points: -1 }, { roster_id: 3, matchup_id: null }, { roster_id: 4, matchup_id: null }];
assert.deepEqual(L.groupRows(rows).map(g => g.teams.length), [2, 1, 1]);
globalThis.S = { nflState: { season: '2026', week: 2, display_week: 2, season_type: 'regular' } };
assert.equal(L.currentWeek(league), 2);
assert.equal(L.currentWeek({ season: '2025', settings: { leg: 17 } }), 17);
assert.equal(L.currentWeek({ season: '2027' }), 1);
globalThis.S.nflState.season_type = 'post';
assert.equal(L.currentWeek(league), 18);

async function run() {
    let clock = 1000, calls = 0, fail = false, release;
    const timers = new Map(), events = new Set(); let timerId = 0;
    const doc = { hidden: false, addEventListener: (_, cb) => events.add(cb), removeEventListener: (_, cb) => events.delete(cb) };
    const client = L.createClient({
        now: () => clock,
        document: doc,
        setTimeout: (cb, delay) => { const id = ++timerId; timers.set(id, { cb, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        fetch: () => { calls++; return new Promise(resolve => { release = () => resolve({ ok: !fail, json: async () => rows }); }); }
    });
    const first = [], second = [];
    const off1 = client.subscribe(league, 2, s => first.push(s));
    const off2 = client.subscribe(league, 2, s => second.push(s));
    await Promise.resolve();
    assert.equal(calls, 1, 'concurrent subscribers share a request');
    const pending = client.refresh(league, 2); release(); await pending;
    assert.equal(first.at(-1).status, 'ready');
    assert.equal(second.at(-1).updatedAt, 1000);
    assert.equal([...timers.values()].filter(t => t.delay === 30000).length, 1, 'one shared poll');
    clock += 30000; fail = true;
    const failure = client.refresh(league, 2); await Promise.resolve(); release(); await failure;
    assert.equal(first.at(-1).status, 'stale');
    assert.equal(first.at(-1).updatedAt, 1000, 'failed attempts never advance freshness');
    assert.deepEqual(first.at(-1).rows, rows, 'retain the last successful scores');
    doc.hidden = true; events.forEach(cb => cb());
    assert.equal(timers.size, 0, 'hidden pages pause polling');
    doc.hidden = false; fail = false; events.forEach(cb => cb()); await Promise.resolve();
    assert.equal(calls, 3, 'return to page shares one refresh');
    const resumed = client.refresh(league, 2); release(); await resumed;
    off1(); assert.equal(events.size, 1);
    const count = first.length;
    off2(); assert.equal(events.size, 0); assert.equal(timers.size, 0, 'last unsubscribe clears polling');
    const next = client.refresh(league, 2); await Promise.resolve(); release(); await next;
    assert.equal(first.length, count, 'unmounted subscribers get no later updates');
    assert.equal(timers.size, 0, 'manual refresh without subscribers does not leave a timer');
    let unsupported;
    client.subscribe({ id: 'espn_2' }, 1, state => { unsupported = state; })();
    assert.equal(unsupported.status, 'unsupported');
    console.log('League live scores: scoring, season selection, sharing, stale recovery, visibility and cleanup passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
// Questionable participation has a usable conditional forecast, not missing stats.
{
    globalThis.App.NflContext = { gameStatus: game => game?.status || 'unknown' };
    const players={a:{team:'BUF'},b:{team:'KC'}},games=[{home:'BUF',away:'KC',status:'upcoming'}];
    const row={points:0,starters:['a','b']};
    const forecasts={a:{availabilityUnknown:true,points:{median:null},conditionalPoints:{median:12},statLine:{median:{rush_yd:120}},scoringSupport:{supported:true}},b:{points:{median:10},statLine:{median:{rec:5}}}};
    assert.equal(L.projectedFinish(row,players,games,league,8,forecasts),22);
    assert.equal(L.finishAssumption(row,forecasts),'If questionable players play');
    assert.equal(forecasts.a.points.median,null,'canonical unknown stays unknown');
    forecasts.a.scoringSupport.supported=false;
    assert.equal(L.projectedFinish(row,players,games,league,8,forecasts),null);
    forecasts.a.scoringSupport.supported=true;forecasts.a.statLine.median=null;
    assert.equal(L.projectedFinish(row,players,games,league,8,forecasts),null,'missing baseline is not zero');
    forecasts.a.statLine.median={rush_yd:120};games[0].status='final';
    assert.equal(L.projectedFinish({...row,points:31},players,games,league,8,forecasts),31,'final actuals stay authoritative');
}
