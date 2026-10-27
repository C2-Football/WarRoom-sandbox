'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'types', 'season', 'engine', 'ai', 'actions', 'ui', 'storage', 'public-state']) require('../js/shared/time-league-' + name + '.js');
const privateLeague = App.TimeLeagueEngine.createTimeLeague({ name: 'Saved recovery room', seed: 'fixture-only', createdAt: '2026-09-20T12:00:00Z',
    seats: [{ name: 'Host', manager: 'human' }, { name: 'Member', manager: 'human' }],
    settings: { rosterSlots: { QB: 1 }, maxQuarterbacks: 1, regularSeasonWeeks: 13, playoffTeams: 2, scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 }, eraRules: { mode: 'any-era', decades: [] } } });
privateLeague.phase = 'season'; privateLeague.weekStage = 'ready';
const row = { id: 'fixture-room', version: 4, seatTeamId: 't1', role: 'commissioner', draft_started: true,
    state: App.TimeLeaguePublicState.projectPublicState(privateLeague, 't1', [], new Map(), new Date().toISOString()) };
assert(App.TimeLeagueEngine.normalizePublicTimeLeague(row.state));
const disk = new Map([['wr-time-league-ui-v1', JSON.stringify({ onlineRowId: row.id, tab: 'home' })]]);
window.localStorage = { getItem: key => disk.get(key) ?? null, setItem: (key,value) => disk.set(key,value), removeItem: key => disk.delete(key) };
window.fetch = async () => { throw new Error('Fixture archive unavailable'); };
window.addEventListener = () => {}; window.removeEventListener = () => {};
window.requestAnimationFrame = () => 1;
window.setInterval = () => 1; window.clearInterval = () => {};
window.App.OD = { getCurrentUserId: () => 'fixture-host' };
let receive, reject, writes = 0;
window.App.TimeLeagueRemote = {
    loadOnlineLeague: async () => row,
    listMyOnlineLeagues: async () => [],
    subscribeToLeague(id, onChange, onError) { assert.equal(id,row.id); receive = onChange; reject = onError; return () => {}; },
    writeOnlineLeague: async () => { writes++; return { ok: true, row }; },
};
let cursor = 0, queued = [];
const hooks = [];
const equal = (a,b) => a && b && a.length === b.length && a.every((value,index) => value === b[index]);
window.React = {
    Fragment: 'fragment', createElement: (type,props,...children) => ({type,props:props||{},children}),
    useState(initial) { const index=cursor++; hooks[index] ??= {value: typeof initial === 'function' ? initial() : initial}; return [hooks[index].value, value => { hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value; }]; },
    useRef(initial) { const index=cursor++; return hooks[index] ||= {current:initial}; },
    useMemo(fn,deps) { const index=cursor++; if(!equal(hooks[index]?.deps,deps)) hooks[index]={value:fn(),deps}; return hooks[index].value; },
    useCallback(fn,deps) { return React.useMemo(()=>fn,deps); },
    useEffect(fn,deps) { const index=cursor++; if(!equal(hooks[index]?.deps,deps)) { hooks[index]?.cleanup?.(); hooks[index]={deps}; queued.push(()=>{hooks[index].cleanup=fn();}); } },
};
window.WrTimeLeagueHomePanel = function HomePanel() {};
window.WrTimeLeagueSetupPanel = function SetupPanel() {};
require('../js/components/game-room-status.js');
require('../js/components/time-league-week-gates.js');
require('../js/tabs/time-league.js');
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node,...nodes(node.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.children) : String(node);
const render = () => { cursor=0; const tree=TimeLeague({onClose(){}}); const effects=queued; queued=[]; effects.forEach(fn=>fn()); return tree; };
const settle = async () => { await new Promise(resolve=>setImmediate(resolve)); return render(); };
(async()=>{
    const savedNavigation=disk.get('wr-time-league-ui-v1');
    render(); await settle(); let tree=await settle();
    assert(!nodes(tree).some(node=>node.type===WrTimeLeagueHomePanel), 'Entry waits for an explicit Resume action');
    assert.equal(disk.get('wr-time-league-ui-v1'),savedNavigation,'Viewing the menu preserves saved navigation');
    nodes(tree).find(node=>node.type===WrTimeLeagueSetupPanel).props.onOpenOnline(row.id);
    render(); tree=await settle();
    assert.equal(nodes(tree).find(node=>node.type===WrTimeLeagueHomePanel).props.league.name,'Saved recovery room');
    const before=disk.get('wr-time-league-ui-v1');
    reject(new Error('Network interrupted'));tree=render();
    const interrupted=nodes(tree).find(node=>node.type===App.GameRoomStatus);
    assert.equal(App.GameRoomStatusModel.statusOf(interrupted.props).label,'Reconnecting');
    await interrupted.props.onRetry();tree=render();
    assert.equal(App.GameRoomStatusModel.statusOf(nodes(tree).find(node=>node.type===App.GameRoomStatus).props).label,'Synced');
    assert.equal(disk.get('wr-time-league-ui-v1'),before,'Manual reconnect preserves navigation');
    reject(Object.assign(new Error('Sign in again to reconnect to your saved league.'),{authRequired:true}));
    tree=render();
    assert(text(tree).includes('Your sign-in is no longer accepted.'));
    assert(!text(tree).includes('Reconnecting automatically'),'Rejected credentials are not presented as a transient connection failure');
    assert.equal(App.GameRoomStatusModel.statusOf(nodes(tree).find(node=>node.type===App.GameRoomStatus).props).label,'Sign-in required');
    assert(nodes(tree).some(node=>node.type==='a'&&node.props.href==='login.html?vault=1&reauth=1'));
    assert(nodes(tree).some(node=>node.type==='fieldset'&&node.props.disabled),'Saved room actions are disabled until sign-in');
    const gate=nodes(tree).find(node=>node.type===WrTimeLeagueWeekGates);
    assert.equal(gate.props.authRequired,true);
    const oldState=React.useState; React.useState=initial=>[initial,()=>{}];
    const footer=WrTimeLeagueWeekGates(gate.props); React.useState=oldState;
    assert(text(footer).includes('Sign-in required'));
    assert.equal(nodes(footer).filter(node=>node.type==='a').length,1,'The phone current-action footer offers one sign-in recovery action');
    assert(!nodes(footer).some(node=>node.type==='button'),'The unauthorized footer cannot advance or reconfigure a week');
    await gate.props.onAction({type:'week'}); assert.equal(writes,0,'Programmatic stale callbacks cannot send mutations while authentication is rejected');
    assert.equal(disk.get('wr-time-league-ui-v1'),before,'Recovery preserves the saved room and navigation context');
    receive(row); tree=render();
    assert(!text(tree).includes('Your sign-in is no longer accepted.'));
    assert.equal(App.GameRoomStatusModel.statusOf(nodes(tree).find(node=>node.type===App.GameRoomStatus).props).label,'Synced');
    console.log('PASS: source-real Vault401 UI preserves saved room, disables shared actions, offers reachable explicit sign-in and resumes an authenticated snapshot.');
})().catch(error=>{console.error(error);process.exitCode=1;});
