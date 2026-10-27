'use strict';
// Component behavior only: no browser, account, backend request or saved game.
const assert = require('node:assert/strict');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai']) require(`../js/shared/time-league-${name}.js`);
const helmet = App.TimeLeagueHelmet.defaultHelmet('Retained Comets');
let current, cursor = 0, effects = [], dirty = false, frames = new Map(), seen = new Set();
const focused = [];
const hook = initial => {
    const index = cursor++, frame = current;
    if (!(index in frame)) frame[index] = typeof initial === 'function' ? initial() : initial;
    return [frame[index], next => {
        const value = typeof next === 'function' ? next(frame[index]) : next;
        if (!Object.is(value, frame[index])) { frame[index] = value; dirty = true; }
    }];
};
global.React = {
    createElement(type, props, ...children) {
        props ||= {};
        const node = { type, props, children: children.flat(Infinity) };
        if (typeof type === 'string' && props.ref) props.ref.current = { focus: () => focused.push(props['aria-label'] || type) };
        return node;
    },
    useState: hook,
    useRef: initial => hook(() => ({ current: initial }))[0],
    useMemo: fn => fn(),
    useEffect(callback, deps) {
        const index = cursor++, frame = current, previous = frame[index];
        if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
            frame[index] = { deps };
            effects.push(() => { previous?.cleanup?.(); frame[index].cleanup = callback(); });
        }
    },
};
const h = React.createElement;
window.TimeLeagueHelmetPicker = function FixtureHelmetPicker({ onChange }) { return h('button', { 'aria-label': 'Choose fixture helmet', onClick: () => onChange(helmet) }, 'Fixture helmet'); };
window.TimeLeagueHelmetIcon = () => null;
let user = null;
App.OD = { getCurrentUserId: () => user };
window.TimeLeagueUtils = {
    MAX_QUARTERBACKS: 2, REGULAR_SEASON_WEEKS: 14,
    PERSONA_IDS: Object.keys(App.TimeLeagueAI.AI_PERSONAS),
    defaultSeats: () => Array.from({ length: 4 }, (_, i) => ({
        name: i ? `Archive Rival ${i + 1}` : 'My old club', manager: i ? 'ai' : 'human', aiPersona: 'steward',
        helmet: App.TimeLeagueHelmet.defaultHelmet(`Fixture ${i}`),
    })),
};
require('../js/components/time-league-setup-panel.js');
function execute(type, props, key) {
    seen.add(key);
    const old = current, oldCursor = cursor;
    current = frames.get(key) || [];
    frames.set(key, current); cursor = 0;
    const node = type(props);
    current = old; cursor = oldCursor;
    return expand(node, key);
}
function expand(node, key) {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return execute(node.type, { ...node.props, children: node.children }, key + '/' + node.type.name + ':' + (node.props.key ?? ''));
    return { ...node, children: node.children.map((child, i) => expand(child, key + '/' + i)) };
}
function mount(props = {}) {
    frames = new Map(); focused.length = 0;
    let currentProps = { index: [], onlineIndex: [], onlineIndexState: 'signed-out', onCreate() {}, onCreateOnline() {}, onOpenOnline() {}, ...props };
    return patch => {
        currentProps = { ...currentProps, ...patch };
        let tree;
        for (let pass = 0; pass < 5; pass++) {
            effects = []; dirty = false; seen = new Set();
            tree = execute(WrTimeLeagueSetupPanel, currentProps, 'Setup');
            for (const [key, frame] of frames) if (!seen.has(key)) {
                frame.forEach(value => value?.cleanup?.()); frames.delete(key);
            }
            effects.forEach(effect => effect());
            if (!dirty) return tree;
        }
        throw new Error('Component effects did not settle');
    };
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children || []).map(text).join(' ').replace(/\s+/g, ' ').trim();
const walk = (node, activeOnly = false) => !node || typeof node !== 'object' || (activeOnly && (node.props.hidden || node.props.style?.display === 'none')) ? [] : [node, ...node.children.flatMap(child => walk(child, activeOnly))];
const find = (tree, predicate, activeOnly = true) => walk(tree, activeOnly).find(predicate);
const button = (tree, label, activeOnly = true) => find(tree, node => node.type === 'button' && (node.props['aria-label'] === label || text(node).includes(label)), activeOnly);
const field = (tree, label, activeOnly = true) => find(tree, node => node.props['aria-label'] === label, activeOnly);
const placeholder = (tree, value) => find(tree, node => node.props.placeholder === value);
const labeledSelect = (tree, label) => find(find(tree, node => node.type === 'label' && text(node.children[0]) === label), node => node.type === 'select');
const change = (node, value) => { assert(node, 'Expected an editable field'); node.props.onChange({ target: { value } }); };
const submit = tree => find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
const wizard = tree => find(tree, node => String(node.props.className || '').split(' ').includes('tl-wizard'));
function activeStep(tree, expected) {
    assert.equal(wizard(tree).props['data-setup-step'], expected);
    const steps = walk(tree, true).filter(node => String(node.props.className || '').split(' ').includes('tl-wizard-step'));
    assert.equal(steps.length, 1, 'Exactly one native-unhidden wizard section is active');
    assert.equal(steps[0].props.id, `vault-setup-${expected}`);
}
function start(draw) { let tree = draw(); button(tree, 'Start new').props.onClick(); return draw(); }
function review(draw, tree) { for (let i = wizard(tree).props['data-setup-step']; i < 4; i++) { button(tree, 'Next →').props.onClick(); tree = draw(); } return tree; }
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok ' + name); };
(async () => {
    await test('menu owns four explicit routes and never eagerly mounts creation or touches saved records', () => {
        const opens = [], deletes = [], before = [{ leagueId: 'kept', name: 'Kept season', phase: 'season', currentWeek: 3, teamCount: 4 }];
        const draw = mount({ index: before, onOpen: id => opens.push(id), onDelete: id => deletes.push(id), settingsPanel: h('p', { 'aria-label': 'Existing profile controls' }, 'Profile'), joinPanel: h('p', { 'aria-label': 'Existing guest controls' }, 'Restore guest pass') });
        let tree = draw(); assert.equal(tree.props['data-entry-view'], 'menu');
        for (const label of ['Start new', 'Resume', 'Join league', 'Settings']) assert(button(tree, label));
        assert(!wizard(tree)); assert(!button(tree, 'START SOLO DRAFT'));
        button(tree, 'Settings').props.onClick(); tree = draw(); assert(field(tree, 'Existing profile controls')); assert(!wizard(tree));
        button(tree, '← Menu').props.onClick(); tree = draw(); button(tree, 'Join league').props.onClick(); tree = draw(); assert(field(tree, 'Existing guest controls'));
        assert.deepEqual(opens, []); assert.deepEqual(deletes, []); assert.equal(before[0].currentWeek, 3);
    });
    await test('wizard exposes one step, protects creation before Review and retains complete choices through Back', async () => {
        const created = []; const draw = mount({ onCreate: input => created.push(input) });
        let tree = start(draw); activeStep(tree, 0); assert(button(tree, 'Step 5: Review').props.disabled);
        assert(!button(tree, 'START SOLO DRAFT')); await button(tree, 'START SOLO DRAFT', false).props.onClick(); assert.equal(created.length, 0);
        button(tree, 'Next →').props.onClick(); tree = draw(); activeStep(tree, 1);
        button(tree, 'Decade Draft').props.onClick(); tree = draw(); button(tree, '1990s').props.onClick(); tree = draw(); button(tree, '2000s').props.onClick(); tree = draw();
        button(tree, 'Next →').props.onClick(); tree = draw(); activeStep(tree, 2); button(tree, 'Auction').props.onClick(); tree = draw();
        change(field(tree, 'Draft order mode'), 'manual'); tree = draw(); change(field(tree, 'Draft position for My old club'), '1');
        change(field(tree, 'Draft clock duration'), '0'); change(field(tree, 'AI draft pace'), '4'); change(field(tree, 'Auction budget per team'), '350'); tree = draw();
        button(tree, 'Next →').props.onClick(); tree = draw(); activeStep(tree, 3);
        change(placeholder(tree, 'My Vault Season'), 'Retained archive'); change(placeholder(tree, 'Name your team'), 'Retained Comets'); button(tree, 'Choose fixture helmet').props.onClick(); tree = draw();
        button(tree, 'Remove last team').props.onClick(); tree = draw(); button(tree, 'Remove last team').props.onClick(); tree = draw();
        button(tree, 'Next →').props.onClick(); tree = draw(); activeStep(tree, 4);
        change(labeledSelect(tree, 'Roster size'), 'compact'); change(labeledSelect(tree, 'Scoring'), 'ppr'); tree = draw();
        assert(text(tree).includes('Retained Comets')); assert(text(tree).includes('Compact · Full PPR'));
        button(tree, '← Back').props.onClick(); tree = draw(); activeStep(tree, 3); assert.equal(placeholder(tree, 'Name your team').props.value, 'Retained Comets');
        button(tree, '← Back').props.onClick(); tree = draw(); activeStep(tree, 2); assert.equal(field(tree, 'Draft clock duration').props.value, 0); assert.equal(field(tree, 'Auction budget per team').props.value, 350); assert.equal(field(tree, 'Draft position for Retained Comets').props.value, 1);
        tree = review(draw, tree); await button(tree, 'START SOLO DRAFT').props.onClick();
        assert.equal(created.length, 1); const payload = created[0]; assert.equal(payload.name, 'Retained archive'); assert.equal(payload.seats.length, 2); assert.equal(payload.seats[0].name, 'Retained Comets'); assert.deepEqual(payload.seats[0].helmet, helmet);
        assert.equal(payload.settings.draftFormat, 'auction'); assert.equal(payload.settings.draftAiSeconds, 4); assert.equal(payload.settings.draftPickSeconds, 0); assert.equal(payload.settings.draftAuctionBudget, 350); assert.deepEqual(payload.settings.draftTeamOrder, ['t2', 't1']); assert.deepEqual(payload.settings.eraRules.decades, ['1990s', '2000s']); assert.equal(payload.settings.scoring.reception, 1); assert.equal(payload.settings.rosterSlots.BN, 2);
    });
    await test('returning through Menu preserves the already mounted wizard and its current step', () => {
        const draw = mount(); let tree = start(draw);
        button(tree, 'Next →').props.onClick(); tree = draw(); button(tree, 'All-Era Classic').props.onClick(); tree = draw();
        button(tree, 'Next →').props.onClick(); tree = draw(); change(field(tree, 'Draft clock duration'), '90'); tree = draw();
        button(tree, '← Back').props.onClick(); tree = draw(); button(tree, '← Back').props.onClick(); tree = draw(); button(tree, '← Menu').props.onClick(); tree = draw();
        assert.equal(tree.props['data-entry-view'], 'menu'); assert(!wizard(tree)); assert(walk(tree).some(node => String(node.props.className || '').includes('tl-wizard')));
        button(tree, 'Settings').props.onClick(); tree = draw(); button(tree, '← Menu').props.onClick(); tree = draw(); button(tree, 'Start new').props.onClick(); tree = draw();
        activeStep(tree, 0); tree = review(draw, tree); assert.equal(field(tree, 'Draft clock duration', false).props.value, 90); assert(text(tree).includes('All-Era Classic'));
    });
    await test('concurrent creation is single-shot and a failed local save retains Review choices for retry', async () => {
        let calls = 0, resolve; const input = [];
        const draw = mount({ onCreate: value => { calls++; input.push(value); return new Promise(done => { resolve = done; }); } });
        let tree = review(draw, start(draw)); const create = button(tree, 'START SOLO DRAFT').props.onClick;
        const first = create(); await create(); assert.equal(calls, 1); tree = draw(); assert(wizard(tree).props['aria-busy']); assert(button(tree, 'CREATING LEAGUE').props.disabled);
        resolve(); await first; tree = draw(); assert.equal(wizard(tree).props['aria-busy'], false);
        tree = draw({ onCreate: () => { throw new Error('This browser could not save.'); } }); await button(tree, 'START SOLO DRAFT').props.onClick(); tree = draw();
        activeStep(tree, 4); assert(text(find(tree, node => node.props.role === 'alert')).includes('could not save')); assert(!button(tree, 'START SOLO DRAFT').props.disabled);
        let retry; tree = draw({ onCreate: value => { retry = value; } }); await button(tree, 'START SOLO DRAFT').props.onClick(); assert.deepEqual(retry, input[0]);
    });
    await test('friends failure and retry retain five-step choices and open only the successful returned room', async () => {
        user = 'fixture-account'; let calls = 0, resolve; const opened = [];
        const draw = mount({ onlineIndexState: 'ready', onOpenOnline: id => opened.push(id), onCreateOnline: () => { calls++; return new Promise(done => { resolve = done; }); } });
        let tree = start(draw); button(tree, 'Play with Friends').props.onClick(); tree = review(draw, draw()); const create = button(tree, 'CREATE & INVITE').props.onClick;
        const first = create(); await create(); assert.equal(calls, 1); resolve({ ok: false, error: 'not_configured' }); await first; tree = draw();
        assert(!text(tree).includes('not_configured')); assert(text(find(tree, node => node.props.role === 'alert')).includes('try again')); assert.deepEqual(opened, []);
        let payload; tree = draw({ onCreateOnline: value => { payload = value; return Promise.resolve({ ok: true, rowId: 'only-returned-room' }); } }); await button(tree, 'CREATE & INVITE').props.onClick();
        assert.deepEqual(opened, ['only-returned-room']); assert(payload.seats.every(seat => seat.manager === 'human')); user = null;
    });
    await test('Resume opens exact selected local/online records and explicit guest seat without recreating them', () => {
        const opens = [], guest = [], deleted = [];
        const index = [{ leagueId: 'local-draft', name: 'Draft saved', phase: 'draft', draftPickCount: 3, draftTotalPicks: 24 }, { leagueId: 'local-final', name: 'Final saved', phase: 'complete' }];
        const draw = mount({ index, onlineIndex: [{ rowId: 'online-season', name: 'Shared saved', phase: 'season', weekStage: 'lineup', currentWeek: 2 }], onOpen: id => opens.push(id), onOpenOnline: id => opens.push(id), onDelete: id => deleted.push(id), guestResume: { rowId: 'guest-room', name: 'Guest Comets', onResume: () => guest.push('guest-room') } });
        let tree = draw(); button(tree, 'Resume').props.onClick(); tree = draw(); assert(text(tree).includes('3 of 24 picks saved'));
        button(tree, 'ENTER DRAFT').props.onClick(); button(tree, 'SEASON RECORD').props.onClick(); button(tree, 'CONTINUE').props.onClick(); button(tree, 'Resume Guest Comets').props.onClick();
        assert.deepEqual(opens, ['local-draft', 'local-final', 'online-season']); assert.deepEqual(guest, ['guest-room']); assert.deepEqual(deleted, []); assert.equal(index[0].draftPickCount, 3);
        tree = draw({ guestResume: { rowId: 'online-season', onResume() { throw new Error('Duplicate guest action'); } } }); assert(!button(tree, 'Resume guest seat'));
    });
    await test('Join requires explicit valid submission, extracts only the token, and forwards existing guest controls', () => {
        const joins = []; const draw = mount({ onJoinInvite: value => joins.push(value), joinPanel: h('p', { 'aria-label': 'Existing guest controls' }, 'Guest pass') });
        let tree = draw(); button(tree, 'Join league').props.onClick(); tree = draw(); assert(field(tree, 'Existing guest controls')); assert(button(tree, 'Open invitation').props.disabled); assert.deepEqual(joins, []);
        change(placeholder(tree, 'Paste your invitation'), 'https://untrusted.example/route?tl_invite=fixture-seat-code'); tree = draw(); assert.deepEqual(joins, []); submit(tree); tree = draw(); assert.deepEqual(joins, ['fixture-seat-code']);
        for (const invalid of ['https://example.test/without-token', '<invalid>', 'x'.repeat(513), 'has spaces']) { change(placeholder(tree, 'Paste your invitation'), invalid); tree = draw(); submit(tree); tree = draw(); assert(find(tree, node => node.props.role === 'alert')); }
        assert.deepEqual(joins, ['fixture-seat-code']);
    });
    await test('pending invitations force Join initially and on arrival without automatically claiming a seat', () => {
        const joins = []; const draw = mount({ pendingInvite: 'pending-seat', onJoinInvite: value => joins.push(value), joinPanel: h('p', { 'aria-label': 'Authoritative join panel' }, 'Invitation ready') });
        let tree = draw(); assert.equal(tree.props['data-entry-view'], 'join'); assert(field(tree, 'Authoritative join panel')); assert.deepEqual(joins, []);
        button(tree, '← Menu').props.onClick(); tree = draw(); assert.equal(tree.props['data-entry-view'], 'menu'); tree = draw({ pendingInvite: 'newer-seat' }); assert.equal(tree.props['data-entry-view'], 'join'); assert.deepEqual(joins, []);
    });
    await test('signed-out friends setup explains account need and cannot advance its Play gate', () => {
        const draw = mount(); let tree = start(draw); button(tree, 'Play with Friends').props.onClick(); tree = draw(); activeStep(tree, 0);
        assert(button(tree, 'Next →').props.disabled); assert(walk(tree, true).some(node => node.type === 'a' && node.props.href === 'login.html?vault=1'));
    });
    console.log(`PASS ${passed} independent Vault entry menu/wizard interaction groups`);
})().catch(error => { console.error(error); process.exitCode = 1; });
