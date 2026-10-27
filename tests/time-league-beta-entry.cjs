'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('login.html', 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(value => value.includes("const SESSION_KEY = 'fw_session_v1'"));

async function login({ search = '', local = {}, pendingInvite = null, oauth = null, blockedStorage = false } = {}) {
    const elements = new Map(), disk = new Map(Object.entries(local)), temporary = new Map();
    if (pendingInvite) temporary.set('tl-pending-invite-v1', pendingInvite);
    const element = id => {
        if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, value: '', textContent: '',
            classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, focus() {},
            listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
        return elements.get(id);
    };
    const requests = [], timers = new Map(); let timerId = 0; const location = { search, href: 'login.html' + search, origin: 'https://c2-football.github.io', pathname: '/WarRoom-sandbox/login.html' };
    let oauthReads = 0;
    const context = vm.createContext({ URLSearchParams, AbortController,
        window: { location, supabase: { createClient: () => ({ auth: { getSession: async () => { oauthReads++; return { data: { session: oauth } }; } } }) } },
        document: { title: '', getElementById: element, querySelector: element },
        localStorage: { get length() { return disk.size; }, key: index => [...disk.keys()][index] ?? null, getItem: key => disk.get(key) || null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) },
        sessionStorage: { get length() { return temporary.size; }, key: index => [...temporary.keys()][index] ?? null, getItem: key => { if (blockedStorage) throw new Error('Blocked'); return temporary.get(key) || null; }, setItem: (key, value) => { if (blockedStorage) throw new Error('Blocked'); temporary.set(key, value); }, removeItem: key => temporary.delete(key) },
        setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id),
        fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ token: 'app-token', user: { id: 'app-account', email: 'manager@example.test' } }) }; },
    });
    Object.assign(context.window, { localStorage: context.localStorage, sessionStorage: context.sessionStorage, atob: value => Buffer.from(value, 'base64').toString('utf8') });
    vm.runInContext(fs.readFileSync('js/shared/account-storage.js', 'utf8'), context);
    vm.runInContext(script, context);
    await Promise.resolve(); await Promise.resolve();
    return { context, element, location, requests, disk, temporary, oauthReads: () => oauthReads,
        submit: async id => { await element(id).listeners.submit({ preventDefault() {} }); while (timers.size) { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); } } };
}

(async () => {
    let page = await login({ search: '?vault=1' });
    assert.equal(page.context.document.title, 'The Vault · Sign in');
    assert(page.element('btnGoogle').hidden && page.element('btnApple').hidden);
    assert.equal(page.element('identifier').type, 'email');
    page.element('signupEmail').value = 'manager@example.test';
    page.element('signupPassword').value = 'test-password';
    await page.submit('panelSignup');
    assert.equal(page.requests[0].body.productSlug, 'war_room');
    assert.equal(JSON.parse(page.disk.get('fw_session_v1')).user.id, 'app-account');
    assert.equal(page.location.href, 'index.html?vault=1', 'Vault accounts return directly to the game without Dynasty onboarding');
    assert(!page.disk.has('od_profile_v1'), 'A Vault signup cannot mark unrelated Dynasty onboarding complete');

    page = await login();
    assert.equal(page.element('btnGoogle').hidden, false, 'The normal global login keeps its existing OAuth choices');
    page.element('signupEmail').value = 'normal@example.test'; page.element('signupPassword').value = 'test-password';
    await page.submit('panelSignup');
    assert.equal(page.location.href, 'onboarding.html', 'Normal signup keeps the existing destination');

    page = await login({ search: '?vault=1', pendingInvite: 'private-invitation' });
    page.element('identifier').value = 'manager@example.test'; page.element('password').value = 'test-password';
    await page.submit('panelSignin');
    assert(page.requests[0].url.endsWith('/fw-signin'));
    assert.equal(page.location.href, 'index.html?vault=1&tl_invite=private-invitation');
    assert.equal(page.temporary.get('tl-pending-invite-v1'), 'private-invitation', 'The game, not login, consumes the invitation');

    page = await login({ pendingInvite: 'private-invitation', local: { fw_session_v1: JSON.stringify({ token: 'app-token', user: { id: 'app-account' } }) } });
    assert.equal(page.location.href, 'index.html?vault=1&tl_invite=private-invitation', 'A pending invitation survives return to a login URL without the query');
    page = await login({ search: '?vault=1', oauth: { access_token: 'oauth-token', user: { email: 'oauth@example.test' } }, local: { fw_session_v1: JSON.stringify({ token: 'oauth-token', user: { email: 'oauth@example.test' } }) } });
    assert.equal(page.location.href, 'login.html?vault=1', 'An OAuth-only session cannot loop into an unsupported Vault account');
    assert.equal(page.oauthReads(), 0);
    page.element('identifier').value = 'sleeper-only'; page.element('password').value = 'test-password';
    await page.submit('panelSignin'); assert.equal(page.requests.length, 0, 'Vault does not treat legacy Sleeper login as an app account');

    const rejectedSession = JSON.stringify({ token: 'server-rejected-token', user: { id: 'app-account', email: 'manager@example.test' } });
    page = await login({ search: '?vault=1&reauth=1', local: { fw_session_v1: rejectedSession }, pendingInvite: 'still-pending-seat' });
    assert.equal(page.location.href, 'login.html?vault=1&reauth=1', 'Explicit recovery must not redirect with the rejected credential');
    assert.equal(page.disk.get('fw_session_v1'), rejectedSession, 'Opening recovery preserves the previous account until a new sign-in succeeds');
    assert.equal(page.temporary.get('tl-pending-invite-v1'), 'still-pending-seat', 'Authentication failure does not consume a pending seat invitation');
    assert.equal(page.oauthReads(), 0);
    page.element('identifier').value = 'manager@example.test'; page.element('password').value = 'test-password';
    await page.submit('panelSignin');
    assert.equal(page.location.href, 'index.html?vault=1&tl_invite=still-pending-seat');
    assert.equal(JSON.parse(page.disk.get('fw_session_v1')).token, 'app-token', 'Explicit recovery saves the newly authenticated credential');

    page = await login({ search: '?vault=1&tl_invite=stored%26only%2Fin%3Furl', blockedStorage: true });
    page.element('identifier').value = 'manager@example.test'; page.element('password').value = 'test-password';
    await page.submit('panelSignin');
    assert.equal(page.location.href, 'index.html?vault=1&tl_invite=stored%26only%2Fin%3Furl', 'Explicit invite survives login even when session storage is unavailable');

    // Exercise the real root and mobile menu with a minimal rendering host.
    global.window = globalThis; window.App = {};
    for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'types', 'season', 'helmet', 'engine', 'ai', 'actions', 'ui']) require('../js/shared/time-league-' + name + '.js');
    let states = [], refs = [], cursor = 0, refCursor = 0;
    window.React = { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState: initial => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef: initial => refs[refCursor++] ||= { current: initial }, useMemo: fn => fn(), useCallback: fn => fn, useEffect() {} };
    window.requestAnimationFrame = () => {};
    const reports = []; window.WR = { Feedback: { reportBug: value => reports.push(value) } };
    require('../js/tabs/time-league.js');
    const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.children)];
    const text = value => value == null || typeof value === 'boolean' ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.children) : String(value);
    const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node).trim().endsWith(label));
    const render = () => { cursor = refCursor = 0; return window.TimeLeague({ onClose() {} }); };
    let tree = render(); button(tree, 'Report a bug').props.onClick();
    assert(reports.at(-1).message.includes('League setup'));
    states[1] = { ...App.TimeLeagueEngine.createTimeLeague({ name: 'Private League Name', seed: 'secret-seed', createdAt: '2026-09-08T00:00:00Z', seats: [{ name: 'Private Manager', manager: 'human' }, { name: 'AI', manager: 'ai' }], settings: { rosterSlots: { QB: 1 }, regularSeasonWeeks: 12, scoring: {} } }), phase: 'season', currentWeek: 4, weekStage: 'postgame', rivalMessages: [{ text: 'private message' }] };
    states[4] = 'gameday'; tree = render();
    let closed = false;
    button(tree, 'Report a bug').props.onClick({ currentTarget: { closest: () => ({ removeAttribute: () => { closed = true; } }) } });
    assert(closed); assert(reports.at(-1).message.includes('week 3'));
    assert(!/secret-seed|Private League|Private Manager|private message/.test(JSON.stringify(reports)), 'Support context excludes private game data');

    window.WrTimeLeagueGamecastPanel = function GamecastPanel() {};
    window.WrTimeLeagueTeamPanel = function TeamPanel() {};
    window.WrTimeLeagueStatsPanel = function StatsPanel() {};
    window.WrTimeLeagueRivalsPanel = function RivalsPanel() {};
    states[6] = new Map([['fixture-player', {}]]);
    states[4] = 'roster'; tree = render();
    const cast = nodes(tree).find(node => node.type === window.WrTimeLeagueGamecastPanel);
    const playback = { leagueId: states[1].leagueId, week: 1, done: false, replay: true };
    cast.props.onPlaybackChange(playback);
    for (const [tab, panel] of [['roster', 'TeamPanel'], ['stats', 'StatsPanel'], ['messages', 'RivalsPanel']]) {
        states[4] = tab;
        assert.equal(nodes(render()).find(node => node.type === window['WrTimeLeague' + panel]).props.throughWeek, undefined,
            'Archived replays retain current YTD, stats and already-known messages');
    }
    cast.props.onPlaybackChange({ ...playback, replay: false });
    assert.equal(nodes(render()).find(node => node.type === window.WrTimeLeagueRivalsPanel).props.throughWeek, 0, 'First-time live playback still hides the final outcome');
    cast.props.onPlaybackChange({ ...playback, replay: false, done: true });
    tree = render();
    assert.equal(states[4], 'home');
    assert(!nodes(tree).some(node => node.type === window.WrTimeLeagueRivalsPanel), 'The completed playback returns to Home without remounting a compact inbox');
    states[4] = 'messages';
    assert.equal(nodes(render()).find(node => node.type === window.WrTimeLeagueRivalsPanel).props.throughWeek, undefined);

    states[4] = 'home'; states[1] = { ...states[1], phase: 'complete', settings: { ...states[1].settings, regularSeasonWeeks: 14, playoffTeams: 0 } };
    assert(!text(render()).includes('Finish with a playoff?'), 'A full 14-game season cannot offer playoffs using absent game logs');
    states[1].settings.regularSeasonWeeks = 13;
    assert(button(render(), 'Add 2-team playoffs')); assert(!button(render(), 'Add 4-team playoffs'));
    states[1].settings.regularSeasonWeeks = 12;
    states[1].teams.push({ ...states[1].teams[1], teamId: 't3' }, { ...states[1].teams[1], teamId: 't4' });
    assert(button(render(), 'Add 4-team playoffs'));
    tree = render();
    const menuNode = nodes(tree).find(node => node.type?.name === 'MobileGameNav');
    states = [true]; refs = []; cursor = refCursor = 0;
    const menu = menuNode.type(menuNode.props);
    assert(button(menu, 'Community'), 'The community destination has a readable name in More');
    const before = reports.length; button(menu, 'Report a bug').props.onClick();
    assert.equal(reports.length, before + 1); assert.equal(states[0], false, 'Opening feedback closes the More menu');
    console.log('PASS: scoped Vault email signup/signin and invite return, unchanged global login, OAuth-only guard, private-safe feedback, replay stats/mail continuity, 14-week playoff limit and labeled mobile navigation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
