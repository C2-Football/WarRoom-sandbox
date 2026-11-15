'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync('js/components/mission-alex.js', 'utf8');
function harness(overrides = {}) {
    const stored = new Map(), calls = [], events = new Map();
    let account = 'account-a', props = { currentLeague: { league_id: 'league-a', name: 'Alpha', season: 2026, scoring_settings: { rec: 1 }, roster_positions: ['QB', 'WR', 'BN'] }, sleeperUserId: 'sleeper-a', activeTab: 'roster',
        myRoster: { players: ['a', 'b', 'missing'], starters: ['a'], reserve: ['b'], settings: { wins: 0, losses: 1 } }, playersData: { a: { full_name: 'Starter', position: 'WR', team: 'KC', age: 25 }, b: { full_name: 'Reserve', position: 'QB' } }, statsData: { a: { gp: 2, points: -4 } } };
    const root = { localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
        OD: { getCurrentUserId: () => account }, WR: {}, App: { calcRawPts: stats => stats.points }, S: { currentLeagueId: 'another-league', nflState: { week: 7 } }, wrIsPro: () => true,
        dhqAI: async (...args) => { calls.push(args); return 'Consider our roster before making a move.'; },
        addEventListener: (type, fn) => events.set(type, fn), removeEventListener: (type, fn) => { if (events.get(type) === fn) events.delete(type); }, ...overrides };
    vm.runInNewContext(source, { window: root, console });
    const api = root.WR.MissionAlex;
    function conversation() { const scope = api.scopeFor(props); return api.createConversation({ scope, isCurrent: () => api.scopeFor(props).key === scope.key, context: feedback => api.buildContext(props, feedback), onChange() {} }); }
    return { root, api, stored, calls, events, conversation, props: () => props, setProps: p => { props = { ...props, ...p }; }, setAccount: id => { account = id; } };
}

test('open/prefill is manual and the supported AI action receives full conversation turns', async () => {
    const h = harness(), chat = h.conversation();
    chat.open({ title: 'Waiver plan', prompt: 'Should I add this player?' });
    assert.equal(chat.state.title, 'Waiver plan'); assert.equal(h.calls.length, 0);
    await chat.send();
    assert.equal(h.calls[0][0], 'strategy-analysis'); assert.equal(h.calls[0][1], 'Should I add this player?');
    assert.match(h.calls[0][2], /"name":"Starter"/); assert.equal(chat.state.messages.length, 2);
    chat.setDraft('How does that affect my bench?'); await chat.send();
    assert.deepEqual(Array.from(h.calls[1][3].messages, m => m.role), ['user', 'assistant', 'user']);
    assert.equal(h.calls[1][3].messages[1].content, 'Consider our roster before making a move.');
    chat.close(); chat.open(); assert.equal(chat.state.messages.length, 4, 'Reopening retains this visit’s conversation');
});

test('context preserves negative and zero evidence, missingness, reserve status and league format', () => {
    const h = harness(), context = h.api.buildContext(h.props(), []);
    assert.match(context, /"loadedStatsPPG":-2/); assert.match(context, /"wins":0/);
    assert.match(context, /"rosterStatus":"reserve"/); assert.match(context, /"name":"Unknown player"/);
    assert.match(context, /"week":null/, 'Another league’s global week is not reused');
    assert.match(context, /"loadedStatsGames":null/); assert.match(context, /never claim to have submitted/);
    assert.match(context, /Missing|unknown/);
});

test('conversation context applies current global topics without treating them as league capabilities', async () => {
    let preferences = { focus: { cups: false, performance: false, trades: true }, channel: { inApp: false } };
    const h = harness({ WR: { AlexSettings: { get: () => preferences } } });
    const chat = h.conversation();
    chat.setDraft('What should I focus on this week?'); await chat.send();
    const context = h.calls[0][2];
    const topicLine = context.split('\n').find(line => line.startsWith('Global Alex topic preferences: '));
    const topics = JSON.parse(topicLine.slice('Global Alex topic preferences: '.length));
    assert(topics.muted.includes('cups'));
    assert(topics.muted.includes('performance'));
    assert(topics.enabled.includes('trades'));
    assert.equal(topics.inAppCards, false);
    assert.match(context, /Do not volunteer muted topics/);
    assert.match(context, /direct user question about a muted topic overrides/);
    assert.match(context, /inAppCards preference never blocks a direct reply/);
    assert.match(context, /never infer a competition from fantasy format alone/);
    assert.match(context, /A topic being enabled is not evidence/);
    preferences = { ...preferences, focus: { ...preferences.focus, cups: true } };
    chat.setDraft('Does this league have a Cup?'); await chat.send();
    const updated = JSON.parse(h.calls[1][2].split('\n').find(line => line.startsWith('Global Alex topic preferences: ')).slice('Global Alex topic preferences: '.length));
    assert(updated.enabled.includes('cups'), 'Each reply reads current settings rather than a stale chat-open snapshot');
    assert.match(h.calls[1][2], /requested competition is unconfirmed, say what is unknown/);
});

test('ratings persist by authenticated account, league and season and inform subsequent prompts', async () => {
    const h = harness(), chat = h.conversation();
    chat.setDraft('What is my priority?'); await chat.send(); const id = chat.state.messages[1].id;
    chat.vote(id, 'up'); assert.match(chat.state.notice, /Preference saved/);
    chat.setDraft('Give me another suggestion.'); await chat.send();
    assert.match(h.calls[1][2], /"rating":"helpful"/); assert.match(h.calls[1][2], /What is my priority/);
    assert.equal(h.conversation().state.feedback.length, 1);
    h.setAccount('account-b'); assert.equal(h.conversation().state.feedback.length, 0);
    h.setAccount('account-a'); h.setProps({ currentLeague: { ...h.props().currentLeague, league_id: 'league-b' } });
    assert.equal(h.conversation().state.feedback.length, 0);
    h.setProps({ currentLeague: { ...h.props().currentLeague, league_id: 'league-a', season: 2027 } });
    assert.equal(h.conversation().state.feedback.length, 0);
});

test('negative feedback can be changed, removed and cleared without a league mutation', async () => {
    const h = harness(), before = JSON.stringify(h.props()), chat = h.conversation();
    chat.setDraft('Read my roster'); await chat.send(); const id = chat.state.messages[1].id;
    chat.vote(id, 'down'); assert.equal(chat.state.feedback[0].vote, 'down');
    chat.vote(id, 'up'); assert.equal(chat.state.feedback.length, 1); assert.equal(chat.state.feedback[0].vote, 'up');
    chat.vote(id, 'up'); assert.equal(chat.state.feedback.length, 0);
    chat.vote(id, 'down'); chat.forget(); assert.equal(h.conversation().state.feedback.length, 0);
    assert.equal(JSON.stringify(h.props()), before);
});

test('storage failure and provider-local identity use session feedback truthfully', async () => {
    const h = harness(); h.setAccount(null); h.setProps({ currentLeague: { ...h.props().currentLeague, _mfl: true } });
    assert.equal(h.api.scopeFor(h.props()).storageKey, null);
    const chat = h.conversation(); chat.setDraft('Help'); await chat.send(); chat.vote(chat.state.messages[1].id, 'up');
    assert.match(chat.state.notice, /for this visit/); assert.equal(h.stored.size, 0);
    h.root.localStorage.setItem = () => { throw new Error('blocked'); }; h.setAccount('account-a');
    const signed = h.conversation(); signed.setDraft('Help'); await signed.send(); signed.vote(signed.state.messages[1].id, 'up');
    assert.equal(signed.state.feedback.length, 1); assert.match(signed.state.notice, /for this visit/);
});

test('late replies cannot cross an account or league change or component disposal', async () => {
    for (const change of ['account', 'league', 'dispose', 'clear']) {
        let resolve;
        const h = harness({ dhqAI: () => new Promise(r => { resolve = r; }) }), chat = h.conversation();
        chat.setDraft('Private question'); const sending = chat.send();
        if (change === 'account') h.setAccount('account-b');
        if (change === 'league') h.setProps({ currentLeague: { league_id: 'league-b' } });
        if (change === 'dispose') chat.dispose();
        if (change === 'clear') chat.clear();
        resolve('Private answer'); await sending;
        assert.equal(chat.state.messages.some(x => x.content === 'Private answer'), false, change);
        if (change === 'clear') assert.equal(chat.state.pending, false);
    }
});

test('failed/empty AI replies restore the editable question and retry does not duplicate history', async () => {
    const h = harness({ dhqAI: async () => { throw new Error('network'); } }), chat = h.conversation();
    chat.setDraft('What next?'); await chat.send();
    assert.equal(chat.state.pending, false); assert.equal(chat.state.draft, 'What next?'); assert.equal(chat.state.messages.length, 0);
    assert.match(chat.state.error, /ready to retry/);
    h.root.dhqAI = async () => ''; await chat.send(); assert.equal(chat.state.messages.length, 0);
    h.root.dhqAI = async () => ({ text: 'A useful answer' }); await chat.send(); assert.equal(chat.state.messages.length, 2);
});

test('a pending request cannot be doubled and a newly typed draft survives a failed request', async () => {
    let reject, requests = 0;
    const h = harness({ dhqAI: () => { requests++; return new Promise((_, r) => { reject = r; }); } }), chat = h.conversation();
    chat.setDraft('First'); const pending = chat.send(); chat.setDraft('Second'); await chat.send(); assert.equal(requests, 1);
    reject(new Error('network')); await pending; assert.equal(chat.state.draft, 'Second'); assert.equal(chat.state.pending, false);
});

test('access and unavailable transport are checked at Send, including prefills', async () => {
    const h = harness({ wrIsPro: () => false }), chat = h.conversation(); chat.open({ prompt: 'Help' }); await chat.send();
    assert.equal(h.calls.length, 0); assert.match(chat.state.error, /access/);
    h.root.wrIsPro = () => true; h.root.dhqAI = undefined; await chat.send();
    assert.match(chat.state.error, /not available/); assert.equal(chat.state.draft, 'Help');
});

test('malformed stored ratings are ignored and stored examples are bounded', () => {
    const h = harness(), scope = h.api.scopeFor(h.props());
    h.stored.set(scope.storageKey, '{broken'); assert.equal(h.api.readFeedback(scope.storageKey).length, 0);
    h.stored.set(scope.storageKey, JSON.stringify([{id:'x',vote:'up',question:'a'.repeat(2000),answer:'b'.repeat(3000)},{id:'bad',vote:'other'}]));
    const feedback = h.api.readFeedback(scope.storageKey); assert.equal(feedback.length, 1); assert.equal(feedback[0].question.length, 500); assert.equal(feedback[0].answer.length, 700);
});

test('cross-app listeners prefill without spending AI calls and leave draft events to Draft Room', () => {
    const h = harness(), refs = [], states = [], effects = [];
    let cursor = 0;
    h.root.React = {
        createElement: (type, props, ...children) => ({type,props:props || {},children}),
        useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => {states[i] = typeof value === 'function' ? value(states[i]) : value;}]; },
        useRef: initial => {const i = cursor++; return refs[i] || (refs[i] = {current:initial});},
        useEffect: fn => {effects.push(fn);},
    };
    const render = () => { cursor = 0; return h.root.WrMissionAlex(h.props()); };
    assert.equal(render(), null); const cleanup = effects[0]();
    h.events.get('wr:ask-open')({detail:{title:'Waiver plan',prompt:'Assess this add'}});
    const tree = render(); assert(tree); assert.equal(h.calls.length, 0);
    const walk = node => node && typeof node === 'object' ? [node,...(node.children || []).flat(Infinity).flatMap(walk)] : [];
    assert.equal(walk(tree).find(x => x.type === 'textarea').props.value, 'Assess this add');
    h.setProps({activeTab:'draft'}); render();
    h.events.get('wr:ask-open')({detail:{prompt:'Draft-only question'}});
    assert.equal(walk(render()).find(x => x.type === 'textarea').props.value, 'Assess this add', 'Draft action requests remain owned by Draft Room');
    h.events.get('wr:mission-alex-open')({detail:{prompt:'How does my draft affect my roster?'}});
    assert.equal(walk(render()).find(x => x.type === 'textarea').props.value, 'How does my draft affect my roster?', 'The explicit global Alex button opens on Draft too');
    assert.match(h.api.buildContext(h.props(), []), /\"screen\":\"draft\"/);
    assert.equal(h.calls.length, 0);
    cleanup(); assert.equal(h.events.size, 0);
});
