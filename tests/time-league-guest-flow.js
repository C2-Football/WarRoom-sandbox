'use strict';
// Source-real UI contract; no real accounts, rooms, or network mutations.
const assert = require('node:assert/strict');
global.window = globalThis;
window.App = {};
for (const name of ['roster','helmet','rules','draft-room','era-rules','types','season','engine','ai','actions','ui','storage','public-state']) require('../js/shared/time-league-' + name + '.js');
const league = App.TimeLeagueEngine.createTimeLeague({ name: 'Friends fixture', seed: 'fixture', createdAt: '2026-09-26T00:00:00Z',
    seats: [{ name: 'Host', manager: 'human' }, { name: 'Guest', manager: 'human' }],
    settings: { rosterSlots: { QB: 1 }, regularSeasonWeeks: 13, maxQuarterbacks: 1, playoffTeams: 2, scoring: { passTd: 4, reception: 0.5, rushRecYd: 0.1, passingYd: 0.04, turnover: -2 }, eraRules: { mode: 'any-era', decades: [] } } });
league.phase = 'season'; league.weekStage = 'ready';
const row = { id: 'guest-room', version: 1, seatTeamId: 't2', role: 'member', draft_started: false,
    members: [{ id: 'm1', seat_team_id: 't1', joined: true }, { id: 'm2', seat_team_id: 't2', joined: true }],
    state: App.TimeLeaguePublicState.projectPublicState(league, 't2', [], new Map(), new Date().toISOString()) };
assert(App.TimeLeagueEngine.normalizePublicTimeLeague(row.state), 'Valid public fixture');
const disk = new Map();
window.localStorage = { getItem: key => disk.get(key) ?? null, setItem: (key,value) => disk.set(key,value), removeItem: key => disk.delete(key) };
window.location = { pathname: '/dist-preview/index.html' };
window.fetch = async () => { throw new Error('No fixture archive'); };
window.addEventListener = () => {}; window.removeEventListener = () => {};
window.requestAnimationFrame = () => 1;
let actor = null, guestChanged, pendingInvite = 'seat&private', consumed = 0, claims = 0, authResets = 0, failLoad = false;
const loads = []; let rejectSession;
App.OD = { getCurrentUserId: () => actor?.kind === 'account' ? actor.userId : null };
App.GameGuest = { getActor: () => actor, getSession: () => actor?.kind === 'guest' ? actor : null, subscribe(fn) { guestChanged = fn; return () => {}; } };
App.GameGuestPanel = function GuestPanel() {};
App.TimeLeagueRemote = {
    resetAuth: () => { authResets++; },
    listMyOnlineLeagues: async () => [],
    loadOnlineLeague: async id => { loads.push(id); if (failLoad) throw new Error('Connection interrupted'); return row; },
    claimInvite: async code => { assert.equal(code, pendingInvite); claims++; return { ok: true, rowId: row.id }; },
    subscribeToLeague: (_id,_receive,onError) => { rejectSession=onError; return () => {}; },
};
let cursor = 0, queued = [], hooks = [];
const equal = (a,b) => a && b && a.length === b.length && a.every((value,index) => value === b[index]);
window.React = {
    Fragment: 'fragment', createElement: (type,props,...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i=cursor++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
    useRef(initial) { const i=cursor++; return hooks[i] ||= { current: initial }; },
    useMemo(fn,deps) { const i=cursor++; if (!equal(hooks[i]?.deps,deps)) hooks[i]={ value:fn(), deps }; return hooks[i].value; },
    useCallback(fn,deps) { return React.useMemo(() => fn,deps); },
    useEffect(fn,deps) { const i=cursor++; if (!equal(hooks[i]?.deps,deps)) { hooks[i]?.cleanup?.(); hooks[i]={deps}; queued.push(() => { hooks[i].cleanup=fn(); }); } },
};
require('../js/tabs/time-league.js');
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node,...nodes(node.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.children) : String(node);
const render = () => { cursor=0; const tree=TimeLeague({ onClose() {}, pendingInvite, onInviteConsumed() { consumed++; pendingInvite=null; } }); const effects=queued; queued=[]; effects.forEach(fn=>fn()); return tree; };
const settle = async () => { await new Promise(resolve=>setImmediate(resolve)); return render(); };
const reset = () => { hooks.forEach(hook=>hook?.cleanup?.()); hooks=[]; queued=[]; loads.length=0; };
(async () => {
    render(); let tree=await settle();
    assert(text(tree).includes('You’re invited to The Vault'), 'A signed-out seat URL shows an invitation, not only solo setup');
    const signIn=nodes(tree).find(node=>node.type==='a' && text(node)==='Sign in or create account');
    assert.equal(signIn.props.href, '../login.html?vault=1&reauth=1&tl_invite=seat%26private');
    const panel=nodes(tree).find(node=>node.type===App.GameGuestPanel);
    assert.equal(panel.props.code, pendingInvite);
    assert.equal(claims,0);
    actor={ kind:'guest', userId:'guest-a', token:'guest-token', roomId:row.id, displayName:'Jamie Friend' };
    guestChanged(); panel.props.onJoined(); render(); tree=await settle(); tree=await settle();
    assert.equal(consumed,1); assert.equal(authResets,1); assert.equal(claims,0,'Joining as guest must not replay an account invite claim');
    assert(loads.length && loads.every(id=>id===row.id));
    assert(text(tree).includes('Friends fixture'), text(tree));
    assert(nodes(tree).some(node=>node.type===App.GameGuestPanel),'The guest pass remains accessible inside the room');
    const disclosure=nodes(tree).find(node=>node.type==='details'&&node.props.className==='tl-card tl-guest-access');
    assert(disclosure&&!disclosure.props.open,'The active guest pass starts in a compact disclosure');
    assert(text(disclosure).includes('Playing as Jamie Friend · Save your guest pass'));
    rejectSession(Object.assign(new Error('Restore guest session'),{authRequired:true})); tree=render();
    assert(!nodes(tree).some(node=>node.props.className==='tl-card tl-guest-access'),'Recovery remains expanded and visible');
    assert(nodes(tree).some(node=>node.type===App.GameGuestPanel));


    reset(); disk.set('wr-time-league-ui-v1',JSON.stringify({onlineRowId:'another-account-room'}));
    window.WrTimeLeagueSetupPanel = function SetupPanel() {};
    render(); await settle(); tree=await settle();
    assert.equal(loads.length,0,'Viewing the entry menu does not open or advance a guest room');
    nodes(tree).find(node=>node.type===WrTimeLeagueSetupPanel).props.guestResume.onResume();
    render(); tree=await settle();
    assert(loads.length && loads.every(id=>id===row.id),'Returning guests open their scoped room instead of another saved account room');

    reset(); actor={ kind:'account', userId:'account-a', token:'account-token' }; pendingInvite='retry-seat'; failLoad=true;
    render(); tree=await settle();
    assert.equal(pendingInvite,'retry-seat','A successful claim followed by failed read preserves the invitation');
    const retry=nodes(tree).find(node=>node.type==='button' && text(node)==='Retry joining');
    assert(retry,'The interrupted join has a visible retry');
    failLoad=false; retry.props.onClick(); render(); tree=await settle(); tree=await settle();
    assert.equal(pendingInvite,null); assert.equal(claims,2);
    assert(text(tree).includes('Friends fixture'));
    console.log('PASS: signed-out invitation entry, preview-safe sign-in, guest join/return/pass panel, no account claim replay, interrupted account join retry.');
})().catch(error=>{ console.error(error); process.exitCode=1; });
