'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai', 'ui']) require(`../js/shared/time-league-${name}.js`);
let states = [], refs = [], stateIndex = 0, refIndex = 0;
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initial => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useRef: initial => { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useMemo: callback => callback(), useEffect: () => {},
};
App.TimeLeaguePlayerCards = {};
App.OD = { getCurrentUserId: () => 'beta-player' };
require('../js/tabs/time-league.js');
require('../js/components/time-league-setup-panel.js');
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(walk)];
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join(' ');
const button = (tree, name) => walk(tree).find(node => node.type === 'button' && text(node).includes(name));
const field = (tree, label) => walk(tree).find(node => node.props['aria-label'] === label);
const render = callback => { stateIndex = 0; refIndex = 0; return callback(); };
const reset = () => { states = []; refs = []; };
let Setup = render(() => WrTimeLeagueSetupPanel({ index: [], onlineIndex: [] }));
button(Setup, 'Start new').props.onClick();
Setup = render(() => WrTimeLeagueSetupPanel({ index: [], onlineIndex: [] }));
const Builder = walk(Setup).find(node => node.type?.name === 'LeagueBuilder').type;

(async () => {
    let calls = 0, resolveCreate, opened = null, request;
    const props = {
        onlineIndexState: 'ready', onOpenOnline: rowId => { opened = rowId; },
        onCreate: () => {}, onCreateOnline: input => { calls++; request = input; return new Promise(resolve => { resolveCreate = resolve; }); },
    };
    const draw = () => render(() => Builder(props));
    const review = tree => { while (tree.props['data-setup-step'] < 4) { button(tree, 'Next →').props.onClick(); tree = draw(); } return tree; };
    reset(); let tree = draw();
    assert(field(tree, 'Team 2 name'));
    assert(field(tree, 'Team 2 manager type'));
    assert(field(tree, 'Team 2 personality'));
    assert(!walk(tree).some(node => node.props.className === 'tl-persona-grid'), 'Setup must not expand a grid of every personality');
    const Guide = walk(tree).find(node => node.type?.name === 'PersonalityGuide').type;
    const customRoster = walk(tree).find(node => node.type === 'details' && text(node.children[0]).startsWith('Customize roster'));
    const rosterLabels = walk(customRoster).filter(node => node.type === 'label').map(node => text(node.children[0]));
    assert(!rosterLabels.includes('IR')); assert(!rosterLabels.includes('TAXI')); assert(rosterLabels.includes('SUPER_FLEX'));

    walk(tree).find(node => node.type?.name === 'PlayModeCard' && node.props.id === 'friends').props.onClick();
    tree = draw();
    field(tree, 'Team 1 name').props.onChange({ target: { value: 'Beta Rockets' } });
    tree = draw();
    tree = review(tree);
    const submit = button(tree, 'CREATE & INVITE').props.onClick;
    const first = submit(); await submit();
    assert.equal(calls, 1, 'Rapid repeated taps must create only one room');
    tree = draw(); assert.equal(tree.props['aria-busy'], true); assert(button(tree, 'CREATING LEAGUE').props.disabled);
    resolveCreate({ ok: false, error: 'not_configured' }); await first;
    tree = draw(); assert.equal(tree.props['aria-busy'], false);
    assert(!button(tree, 'CREATE & INVITE').props.disabled);
    assert.equal(field(tree, 'Team 1 name').props.value, 'Beta Rockets');
    assert(text(walk(tree).find(node => node.props.role === 'alert')).includes('try again'));
    assert(!text(tree).includes('not_configured'));
    assert.equal(opened, null);

    props.onCreateOnline = async () => { throw new Error('Connection interrupted. Try again.'); };
    tree = draw(); await button(tree, 'CREATE & INVITE').props.onClick();
    tree = draw(); assert(!button(tree, 'CREATE & INVITE').props.disabled);
    assert(text(walk(tree).find(node => node.props.role === 'alert')).includes('Connection interrupted'));
    props.onCreateOnline = async input => { request = input; return { ok: true, rowId: 'recovered-room' }; };
    tree = draw(); await button(tree, 'CREATE & INVITE').props.onClick();
    tree = draw(); assert.equal(opened, 'recovered-room'); assert.equal(request.seats[0].name, 'Beta Rockets');
    assert(!walk(tree).some(node => node.props.role === 'alert'));
    console.log('ok rapid taps create one room; returned and thrown failures preserve settings and allow retry');

    reset(); tree = draw();
    props.onCreate = () => { throw new Error('Unable to save this season.'); };
    tree = review(draw()); await button(tree, 'START SOLO DRAFT').props.onClick();
    tree = draw(); assert(!button(tree, 'START SOLO DRAFT').props.disabled);
    assert(text(walk(tree).find(node => node.props.role === 'alert')).includes('Unable to save'));
    console.log('ok local creation errors also recover');

    reset(); tree = render(() => Guide());
    assert.equal(tree.type, 'details'); assert.equal(tree.props.open, undefined);
    const selector = walk(tree).find(node => node.type === 'select');
    assert.equal(selector.children.length, Object.keys(App.TimeLeagueAI.AI_PERSONAS).length);
    const lastPersona = Object.keys(App.TimeLeagueAI.AI_PERSONAS).at(-1);
    selector.props.onChange({ target: { value: lastPersona } });
    tree = render(() => Guide());
    assert(text(tree).includes(App.TimeLeagueAI.AI_PERSONAS[lastPersona].tell));
    assert.equal(walk(tree).filter(node => node.type?.name === 'PersonaMeterRow').length, 3);
    console.log('ok the collapsed personality guide exposes the full catalog with one profile at a time');
    console.log('PASS: Vault beta setup interaction and error recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
