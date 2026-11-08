'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const Cup = require('../js/shared/woeppel-cup.js');
const source = Babel.transform(fs.readFileSync('js/components/woeppel-cup-panel.js', 'utf8'), { presets: ['react'] }).code;
const league = { league_id: '1234567890123456789', season: '2026', name: 'Test League', rosters: Array.from({ length: 5 }, (_, i) => ({ roster_id: i + 1 })), settings: { playoff_week_start: 15 } };
const walk = node => node == null || typeof node === 'boolean' ? [] : Array.isArray(node) ? node.flatMap(walk) : typeof node === 'object' ? [node, ...walk(node.children)] : [node];
const text = node => walk(node).filter(value => typeof value !== 'object').join('');
const find = (tree, predicate) => walk(tree).find(node => typeof node === 'object' && predicate(node));
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).startsWith(label));
const control = (tree, label) => find(tree, node => ['input', 'select'].includes(node.type) && node.props['aria-label'] === label);
const changeControl = async (app, label, value) => {
    const target = control(app.tree, label);
    assert(target && typeof target.props.onChange === 'function', 'Editable field exists: ' + label);
    target.props.onChange({ target: { value: String(value) } });
    return app.flush();
};
const writes = app => app.calls.filter(call => call.action !== 'load');
const saveActions = tree => find(tree, node => node.props?.className?.split(' ').includes('cup-save-actions'));
const assertSaveBlocked = (tree, reason) => {
    for (const label of ['Save & lock Cup', 'Save draft']) {
        const action = button(tree, label);
        assert(action, reason + ': ' + label + ' stays discoverable');
        assert(action.props.disabled, reason + ': ' + label + ' cannot save');
    }
};
function harness({ canManage = false, saved = null, deny = false, saveError = '', deferSaves = false, deferLoads = false, legacy = false, teamCount = 5 } = {}) {
    let slots = [], dependencies = [], pendingEffects = [], index = 0, dirty = true, tree;
    const calls = [], storage = new Map(), intervals = [];
    const config = { canManage, saved, deny, saveError, deferSaves, pendingSaves: [], deferLoads, pendingLoads: [], matchups: [], board: null, currentWeek: 9, subscriptions: [] };
    const React = {
        useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (next !== slots[i]) { slots[i] = next; dirty = true; } }]; },
        useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useMemo(fn) { index++; return fn(); },
        useEffect(fn, deps) { const i = index++; if (!dependencies[i] || deps.some((value, n) => value !== dependencies[i][n])) { dependencies[i] = deps; pendingEffects.push(fn); } },
        createElement(type, props, ...children) { return { type, props: props || {}, children }; }
    };
    const client = { functions: { async invoke(name, { body }) {
        assert.equal(name, 'league-cup');
        calls.push(structuredClone(body));
        if (config.deny) return { data: { error: 'A member sign-in is required.' }, error: null };
        if (body.action === 'save') {
            if (config.deferSaves) await new Promise(resolve => config.pendingSaves.push(resolve));
            if (config.saveError) return { data: { error: config.saveError }, error: null };
            config.saved = structuredClone(body.state);
            return { data: { cup: { state: config.saved, revision: body.revision + 1 }, canManage: config.canManage }, error: null };
        }
        const data = { cup: config.saved ? { state: structuredClone(config.saved), revision: 3 } : null, canManage: config.canManage };
        if (config.deferLoads) await new Promise(resolve => config.pendingLoads.push(resolve));
        return { data, error: null };
    } } };
    const liveScores = { currentWeek: () => config.currentWeek, useScores: options => { config.subscriptions.push({week:options.week,enabled:options.enabled}); return options.enabled ? config.board : null; } };
    const context = { React, console, document: { visibilityState: 'visible' }, setInterval: fn => intervals.push(fn), clearInterval() {}, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, window: { WoeppelCup: Cup, App: { LeagueLiveScores: liveScores, OD: { getClient: () => client } }, location: { pathname: '/dist-preview/index.html' }, confirm: () => true, prompt: () => 'Verified league tiebreak evidence', fetchMatchups: async () => config.matchups } };
    vm.createContext(context); vm.runInContext(source, context);
    const props = { league: { ...league, rosters: Array.from({ length: legacy ? 12 : teamCount }, (_, i) => ({ roster_id: i + 1 })) }, getOwnerName: id => 'Team ' + id, myRoster: { roster_id: 1 } };
    const render = () => { index = 0; dirty = false; tree = (legacy ? context.LegacyWoeppelCupPanel : context.window.WoeppelCupPanel)(props); pendingEffects.splice(0).forEach(effect => effect()); return tree; };
    async function flush() { for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !pendingEffects.length) return tree; } throw Error('React mock did not settle'); }
    async function click(label) { const target = button(tree, label); assert(target, 'Button exists: ' + label); assert(!target.props.disabled, 'Button enabled: ' + label); target.props.onClick(); return flush(); }
    async function choose(id) { const format = Cup.tournament.formats.find(f => f.id === id); const target = find(tree, node => node.props?.role === 'radio' && text(node).includes(format.name)); assert(target, 'Format radio exists: ' + id); target.props.onClick(); return flush(); }
    async function rename(value) { const input = find(tree, node => node.type === 'input' && node.props.maxLength === 80); assert(input, 'Cup name remains editable'); input.props.onChange({ target: { value } }); return flush(); }
    async function finishSave() { assert.equal(config.pendingSaves.length, 1, 'Exactly one save is awaiting the server'); config.pendingSaves.shift()(); return flush(); }
    async function backgroundRefresh() { intervals.forEach(fn => fn()); return flush(); }
    async function finishLoad() { assert.equal(config.pendingLoads.length, 1, 'Exactly one refresh is awaiting the server'); config.pendingLoads.shift()(); return flush(); }
    return { calls, config, storage, flush, click, choose, rename, finishSave, backgroundRefresh, finishLoad, pushBoard: board => {config.board=board;dirty=true;return flush();}, prepareEdit: (original, draft) => structuredClone(context.prepareCupEdit(original, draft, Cup.tournament)), get tree() { return tree; } };
}
(async () => {
    const loading = harness({ canManage: true, deferLoads: true }); await loading.flush();
    assertSaveBlocked(loading.tree, 'Initial permission check');
    assert.match(text(saveActions(loading.tree)), /connect|checking/i, 'Pending save actions explain that connection is being checked');
    button(loading.tree, 'Save & lock Cup').props.onClick();
    button(loading.tree, 'Save draft').props.onClick();
    find(loading.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await loading.flush();
    assert.equal(writes(loading).length, 0, 'Initial loading never authorizes a write through a tap or submit');
    await loading.finishLoad();
    assert(!button(loading.tree, 'Save & lock Cup').props.disabled, 'Verified commissioner can save once the connection completes');

    // Rejected authentication never hides the usable gallery or authorizes writes.
    for (const format of Cup.tournament.formats) {
        const app = harness({ deny: true }); await app.flush();
        assert.equal(walk(app.tree).filter(node => node.props?.role === 'radio').length, Cup.tournament.formats.length);
        assert(text(app.tree).includes('Explore now. Connect to save.'));
        assert(text(app.tree).includes('A member sign-in is required.'));
        assert.equal(find(app.tree, node => node.type === 'a' && text(node) === 'Open sign-in').props.href, '../login.html?reauth=1');
        assertSaveBlocked(app.tree, 'Failed connection');
        assert.match(text(saveActions(app.tree)), /connect|sign.in/i, 'Connection guidance is next to the save actions');
        assert(button(saveActions(app.tree), 'Retry connection'), 'Failed connection can be retried beside the save actions');
        button(app.tree, 'Save & lock Cup').props.onClick();
        button(app.tree, 'Save draft').props.onClick();
        find(app.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
        await app.flush();
        assert.equal(writes(app).length, 0, 'Rejected authentication cannot save through a tap or submit');
        await app.choose(format.id);
        assert.equal(writes(app).length, 0, 'Choosing ' + format.id + ' is local');
        await app.click('Try a sample Cup');
        assert(!button(app.tree, 'Save & lock Cup'), 'Sample mode has no creation save action');
        assert(!button(app.tree, 'Save draft'), 'Sample mode has no draft save action');
        assert(text(app.tree).includes('SAMPLE CUP · MADE-UP SCORES'));
        assert(text(app.tree).includes('Your league Cup is unchanged.'));
        let played = 0;
        while (!text(app.tree).includes('SAMPLE CHAMPION') && played++ < 18) await app.click('Play next sample week');
        assert(text(app.tree).includes('SAMPLE CHAMPION'), format.id + ' reaches champion through the visible sample controls');
        assert(!button(app.tree, 'Record in Hall of Fame'), 'No sample archive action');
        assert(!button(app.tree, 'Fetch Sleeper scores'), 'No live-score action in sample');
        assert.equal(writes(app).length, 0, format.id + ' sample never writes');
        await app.click('Restart sample');
        assert(!text(app.tree).includes('SAMPLE CHAMPION'));
        assert(button(app.tree, 'Play next sample week'));
    }
    const member = harness(); await member.flush();
    assert.equal(walk(member.tree).filter(node => node.props?.role === 'radio').length, Cup.tournament.formats.length);
    assertSaveBlocked(member.tree, 'View-only member');
    assert.match(text(saveActions(member.tree)), /commissioner|sign.in/i, 'Member save actions explain the required sign-in');
    assert(find(saveActions(member.tree), node => node.type === 'a' && node.props.href === '../login.html?reauth=1'), 'Member sign-in is available beside the save actions');
    assert.equal(find(member.tree, node => node.type === 'a' && text(node) === 'Open sign-in').props.href, '../login.html?reauth=1', 'Read-only members can reopen sign-in instead of returning to the current session');
    // A retained setup form must not authorize a member's write through Enter/submit.
    const memberForm = find(member.tree, node => node.type === 'form');
    if (memberForm) { memberForm.props.onSubmit({ preventDefault() {} }); await member.flush(); }
    button(member.tree, 'Save & lock Cup').props.onClick();
    button(member.tree, 'Save draft').props.onClick();
    await member.flush();
    assert.equal(writes(member).length, 0);

    const reconnecting = harness({ deny: true }); await reconnecting.flush();
    await reconnecting.choose('knockout'); await reconnecting.rename('Keep My Connection Draft');
    reconnecting.config.deny = false;
    reconnecting.config.canManage = true;
    await reconnecting.click('Retry connection');
    assert(!button(reconnecting.tree, 'Save & lock Cup').props.disabled, 'Successful retry enables commissioner saving');
    assert.equal(find(reconnecting.tree, node => node.type === 'input' && node.props.maxLength === 80).props.value, 'Keep My Connection Draft', 'Retry preserves the edited Cup name');
    assert(text(find(reconnecting.tree, node => node.props?.role === 'radio' && node.props['aria-checked'])).includes(Cup.tournament.formats.find(format => format.id === 'knockout').name), 'Retry preserves the selected format');
    assert.equal(writes(reconnecting).length, 0, 'Reconnecting does not automatically publish the draft');
    await reconnecting.click('Save & lock Cup');
    assert.equal(writes(reconnecting)[0].state.name, 'Keep My Connection Draft');
    assert.equal(writes(reconnecting)[0].state.format, 'knockout');

    const lostConnection = harness({ canManage: true }); await lostConnection.flush();
    await lostConnection.rename('Retain After Refresh');
    lostConnection.config.deny = true;
    await lostConnection.click('Refresh Cup');
    assertSaveBlocked(lostConnection.tree, 'Previously authorized connection failed');
    button(lostConnection.tree, 'Save & lock Cup').props.onClick();
    button(lostConnection.tree, 'Save draft').props.onClick();
    find(lostConnection.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await lostConnection.flush();
    assert.equal(writes(lostConnection).length, 0, 'Stale commissioner access cannot save after a failed refresh');
    assert.equal(find(lostConnection.tree, node => node.type === 'input' && node.props.maxLength === 80).props.value, 'Retain After Refresh', 'Connection failure retains the edited draft');

    const commissioner = harness({ canManage: true }); await commissioner.flush();
    await commissioner.choose('knockout');
    assert.equal(writes(commissioner).length, 0, 'Commissioner selection remains a draft');
    const selectedDetail = find(commissioner.tree, node => node.props?.className === 'cup-format-detail');
    assert(selectedDetail && text(selectedDetail).includes('seeded elimination bracket'), 'Selected format keeps its explanation available for the compact phone chooser');
    const lockButton = button(commissioner.tree, 'Save & lock Cup');
    assert(lockButton, 'Commissioner has an explicit save-and-lock action');
    assert.equal(lockButton.props.type, 'button', 'Phone save does not depend on browser form validation');
    assert.equal(typeof lockButton.props.onClick, 'function', 'Save-and-lock runs directly from the tapped button');
    assert(lockButton.props.className.includes('cup-primary'), 'Save-and-lock is the primary action');
    assert(button(commissioner.tree, 'Try a sample Cup'), 'Samples remain available alongside the real save action');
    await commissioner.click('Save & lock Cup');
    assert.equal(writes(commissioner).length, 1, 'Explicit save-and-lock saves once');
    assert.equal(writes(commissioner)[0].state.format, 'knockout');
    assert.equal(writes(commissioner)[0].state.locked, true);
    assert.equal(writes(commissioner)[0].state.enabled, true);
    assert.equal(writes(commissioner)[0].revision, 0);
    assert(text(commissioner.tree).includes('Saved & locked'), 'Successful server save confirms the Cup is locked');
    assert(!button(commissioner.tree, 'Save & lock Cup'), 'Locked Cup leaves setup mode');
    const reopened = harness({ canManage: true, saved: structuredClone(commissioner.config.saved) }); await reopened.flush();
    assert(text(reopened.tree).includes('Saved & locked'), 'A fresh mount restores the saved locked Cup');
    assert(text(reopened.tree).includes(Cup.tournament.formats.find(format => format.id === 'knockout').name));
    assert(!button(reopened.tree, 'Save & lock Cup'), 'Reopening does not ask the commissioner to save again');
    assert.equal(writes(reopened).length, 0, 'Loading a saved Cup never creates another save');

    const draftApp = harness({ canManage: true }); await draftApp.flush();
    await draftApp.choose('survivor'); await draftApp.rename('Friday Night Cup');
    await draftApp.click('Save draft');
    assert.equal(writes(draftApp).length, 1);
    assert.equal(writes(draftApp)[0].state.locked, false, 'Save draft does not lock the tournament');
    assert.equal(draftApp.config.saved.name, 'Friday Night Cup');
    assert.equal(draftApp.config.saved.format, 'survivor');
    assert(button(draftApp.tree, 'Save & lock Cup'), 'Saved draft remains ready to edit or lock');
    assert(!text(draftApp.tree).includes('Saved & locked'), 'Draft save never claims a lock');
    const reopenedDraft = harness({ canManage: true, saved: structuredClone(draftApp.config.saved) }); await reopenedDraft.flush();
    assert.equal(find(reopenedDraft.tree, node => node.type === 'input' && node.props.maxLength === 80).props.value, 'Friday Night Cup');
    assert(text(find(reopenedDraft.tree, node => node.props?.role === 'radio' && node.props['aria-checked'])).includes(Cup.tournament.formats.find(format => format.id === 'survivor').name), 'Reopening restores the saved draft format');
    await draftApp.click('Save & lock Cup');
    assert.equal(writes(draftApp).at(-1).revision, 1, 'Locking a draft uses the saved revision');
    assert.equal(writes(draftApp).at(-1).state.locked, true);
    assert.equal(writes(draftApp).at(-1).state.enabled, true);
    assert(text(draftApp.tree).includes('Saved & locked'));

    // The primary scheduling choice is the final, with earlier stages placed
    // backwards for every format rather than a user having to calculate dates.
    const startsForWeek12 = { points: 8, 'round-robin': 6, 'all-play': 8, median: 8, knockout: 10, survivor: 10, 'round-robin-double': 4, groups: 9 };
    for (const format of Cup.tournament.formats) {
        const app = harness({ canManage: true }); await app.flush(); await app.choose(format.id);
        await changeControl(app, 'Championship week', 12);
        assert.equal(control(app.tree, 'Championship week').props.value, 12, format.id + ' exposes the selected final week');
        assert.equal(control(app.tree, 'First Cup week').props.value, startsForWeek12[format.id], format.id + ' displays the correct backwards-calculated first week');
        assert(text(find(app.tree, node => node.props['aria-label'] === 'Tournament preview')).includes('Championship W12'), format.id + ' preview confirms the final');
        await app.click('Save draft');
        const plan = writes(app).at(-1).state;
        assert.equal(plan.startWeek, startsForWeek12[format.id]);
        assert.equal(Cup.tournament.championshipWeek(plan), 12, format.id + ' saves the selected championship');
        assert.equal(Cup.tournament.schedule(plan).at(-1), format.id === 'round-robin-double' ? 13 : 12, format.id + ' reserves only the necessary reset week');
        const remount = harness({ canManage: true, saved: structuredClone(plan) }); await remount.flush();
        assert.equal(control(remount.tree, 'Championship week').props.value, 12, format.id + ' final survives a saved-draft remount');
        assert.equal(control(remount.tree, 'First Cup week').props.value, startsForWeek12[format.id]);
        assert.equal(writes(remount).length, 0, 'Restoring final-week settings never publishes a new revision');
    }

    const groupSetup = harness({ canManage: true, teamCount: 8 }); await groupSetup.flush(); await groupSetup.choose('groups');
    await changeControl(groupSetup, 'Championship week', 12);
    const initialDraw = find(groupSetup.tree, node => node.props['aria-label'] === 'Group draw');
    assert(initialDraw && text(initialDraw).includes('Group A') && text(initialDraw).includes('Group B'), 'Group format previews actual named groups before saving');
    for (let id = 1; id <= 8; id++) assert(text(initialDraw).includes('Team ' + id), 'The draw preview includes participating Team ' + id);
    assert.equal(control(groupSetup.tree, 'Knockout style').props.value, 'single');
    const styleOptions = walk(control(groupSetup.tree, 'Knockout style')).filter(node => node.type === 'option');
    assert.deepEqual(styleOptions.map(node => node.props.value), ['single', 'double'], 'Groups expose both single and double elimination');
    await changeControl(groupSetup, 'Number of groups', 4);
    await changeControl(groupSetup, 'Qualifiers per group', 1);
    assert.equal(control(groupSetup.tree, 'Championship week').props.value, 12, 'Changing groups and qualifiers retains the selected final');
    await changeControl(groupSetup, 'Group for Team 1', 'B');
    assert(button(groupSetup.tree, 'Save & lock Cup').props.disabled, 'An intermediate unbalanced draw cannot be locked');
    assert(text(groupSetup.tree).includes('Keep groups balanced'), 'An invalid assignment explains the required correction');
    await changeControl(groupSetup, 'Group for Team 2', 'A');
    const changedDraw = find(groupSetup.tree, node => node.props['aria-label'] === 'Group draw');
    assert(text(changedDraw).includes('Group ATeam 5 · Team 2') && text(changedDraw).includes('Group BTeam 6 · Team 1'), 'Draw preview follows the edited assignments instead of a generic format example');
    await changeControl(groupSetup, 'Group-stage weeks', 2);
    assert.equal(control(groupSetup.tree, 'Group-stage weeks').props.value, 2);
    assert.equal(control(groupSetup.tree, 'Championship week').props.value, 12, 'An explicit group-stage duration still works backwards from the final');
    await changeControl(groupSetup, 'Knockout style', 'double');
    assert.equal(control(groupSetup.tree, 'Championship week').props.value, 12);
    assert(text(groupSetup.tree).includes('Week 13 reserved for a reset'), 'Double elimination explains the possible extra week next to the championship choice');
    const validStart = control(groupSetup.tree, 'First Cup week').props.value;
    await changeControl(groupSetup, 'Championship week', 1);
    assert.equal(control(groupSetup.tree, 'Championship week').props.value, 12, 'An impossible early final never replaces the valid schedule');
    assert.equal(control(groupSetup.tree, 'First Cup week').props.value, validStart);
    assert(text(groupSetup.tree).includes('does not fit before Week 1'), 'A championship that cannot fit gives useful feedback');
    await groupSetup.rename('Custom Group Cup');
    await groupSetup.click('Save & lock Cup');
    const savedGroups = structuredClone(groupSetup.config.saved);
    assert.equal(savedGroups.format, 'groups');
    assert.equal(savedGroups.groupCount, 4); assert.equal(savedGroups.qualifiersPerGroup, 1); assert.equal(savedGroups.qualifierCount, 4);
    assert.equal(savedGroups.groupWeeks, 2, 'The saved group duration matches the commissioner selection');
    assert.equal(savedGroups.knockoutStyle, 'double'); assert.equal(Cup.tournament.championshipWeek(savedGroups), 12);
    assert.deepEqual(savedGroups.groups, { A: ['5', '2'], B: ['6', '1'], C: ['3', '7'], D: ['4', '8'] });
    assert.equal(walk(groupSetup.tree).filter(node => node.type === 'table' && /^Group [A-D] standings$/.test(node.props['aria-label'] || '')).length, 4, 'The saved tournament renders distinct group standings');
    const groupsRemount = harness({ canManage: true, teamCount: 8, saved: savedGroups }); await groupsRemount.flush(); await groupsRemount.click('Edit Cup');
    assert.equal(control(groupsRemount.tree, 'Championship week').props.value, 12);
    assert.equal(control(groupsRemount.tree, 'Number of groups').props.value, 4); assert.equal(control(groupsRemount.tree, 'Qualifiers per group').props.value, 1);
    assert.equal(control(groupsRemount.tree, 'Knockout style').props.value, 'double');
    assert.equal(control(groupsRemount.tree, 'Group-stage weeks').props.value, 2);
    for (const [group, ids] of Object.entries(savedGroups.groups)) for (const id of ids) assert.equal(control(groupsRemount.tree, 'Group for Team ' + id).props.value, group, 'Saved assignments survive remount and editing');
    assert.equal(writes(groupsRemount).length, 0, 'Reopening the group editor does not rewrite saved configuration');
    assert(button(groupsRemount.tree, 'Save Cup changes').props.disabled, 'Restored group settings remain unchanged until an edit');

    const failed = harness({ canManage: true, saveError: 'Cup save failed. Try again.' }); await failed.flush();
    await failed.choose('knockout'); await failed.rename('Keep My Cup');
    await failed.click('Save & lock Cup');
    assert.equal(writes(failed).length, 1);
    assert.equal(failed.config.saved, null, 'Failed request does not persist a Cup');
    assert(text(failed.tree).includes('Cup save failed. Try again.'), 'Save failure is shown inline');
    assert(!text(failed.tree).includes('Saved & locked'), 'Rejected save never claims a lock');
    assert.equal(find(failed.tree, node => node.type === 'input' && node.props.maxLength === 80).props.value, 'Keep My Cup', 'Save rejection preserves the commissioner draft');
    await failed.rename('Keep My Edited Cup');
    failed.config.saveError = '';
    await failed.click('Save & lock Cup');
    assert.equal(writes(failed).length, 2, 'A rejected save can be retried');
    assert.equal(writes(failed).at(-1).state.name, 'Keep My Edited Cup', 'Retry saves the editable retained draft');
    assert.equal(writes(failed).at(-1).state.format, 'knockout');
    assert.equal(writes(failed).at(-1).revision, 0, 'Rejected save does not advance the revision');
    assert(text(failed.tree).includes('Saved & locked'));
    assert(!text(failed.tree).includes('Cup save failed. Try again.'));

    const pending = harness({ canManage: true, deferSaves: true }); await pending.flush();
    const rapidTap = button(pending.tree, 'Save & lock Cup').props.onClick;
    const competingDraftSave = button(pending.tree, 'Save draft').props.onClick;
    const competingRefresh = button(pending.tree, 'Refresh Cup').props.onClick;
    rapidTap(); rapidTap(); competingDraftSave(); competingRefresh(); await pending.flush();
    assert.equal(writes(pending).length, 1, 'Two phone taps before rerender send only one save request');
    assert.equal(pending.calls.filter(call => call.action === 'load').length, 1, 'Refresh is guarded before buttons rerender during a pending save');
    assert.equal(pending.config.saved, null, 'Cup is not treated as saved before the server responds');
    assert(!text(pending.tree).includes('Saved & locked'), 'Pending request never claims a lock');
    assert(button(pending.tree, 'Save draft').props.disabled, 'Draft save cannot race the lock request');
    assert(find(pending.tree, node => node.type === 'fieldset' && node.props.className === 'cup-plan-controls').props.disabled, 'Setup fields stay fixed while a save is pending');
    assert(walk(pending.tree).filter(node => node.props?.role === 'radio').every(node => node.props.disabled), 'Format selection stays fixed while a save is pending');
    assert(button(pending.tree, 'Refresh Cup')?.props.disabled || button(pending.tree, 'Connecting…')?.props.disabled, 'Refresh cannot overwrite a pending save');
    await pending.finishSave();
    assert.equal(writes(pending).length, 1);
    assert(text(pending.tree).includes('Saved & locked'), 'Lock status appears after the pending save succeeds');

    const saved = { ...Cup.tournament.defaults(league), name: 'Real Shared Cup', locked: true, enabled: true };
    const browsingActive = harness({ canManage: true, saved }); await browsingActive.flush();
    await browsingActive.click('Explore formats'); await browsingActive.choose('survivor');
    const browsingForm = find(browsingActive.tree, node => node.type === 'form');
    if (browsingForm) { browsingForm.props.onSubmit({ preventDefault() {} }); await browsingActive.flush(); }
    assert(!button(browsingActive.tree, 'Save & lock Cup'), 'Exploring formats cannot replace a locked Cup');
    assert(!button(browsingActive.tree, 'Save draft'));
    assert.equal(writes(browsingActive).length, 0, 'Setup form cannot overwrite a locked Cup while exploring formats');
    const connected = harness({ canManage: true, saved }); await connected.flush();
    connected.config.deny = true;
    await connected.click('Refresh Cup');
    assert(text(connected.tree).includes('Real Shared Cup'), 'Refresh failure retains the shared tournament');
    assert(!text(connected.tree).includes('SAMPLE CUP'), 'Failed load does not substitute fake results');
    await connected.click('Explore formats'); await connected.choose('survivor'); await connected.click('Try a sample Cup');
    await connected.click('Play next sample week');
    assert(text(connected.tree).includes('SAMPLE CUP · MADE-UP SCORES'));
    assert.equal(writes(connected).length, 0);
    await connected.click('Explore formats'); await connected.click('Back to your Cup');
    assert(text(connected.tree).includes('Real Shared Cup'));
    assert(!text(connected.tree).includes('SAMPLE CUP'));
    assert.equal(Object.keys(connected.config.saved.weeks).length, 0, 'Exploring sample scores never mutates saved Cup');
    assert.equal(text(find(connected.tree, node => node.type === 'h2')), 'Real Shared Cup', 'Returning to active Cup restores its saved name, not the sample name');

    // Started Cups stay editable without unlocking or writing on entry/cancel.
    const started = { ...Cup.tournament.defaults(league), name: 'Started Cup', locked: true, enabled: true, startWeek: 1, knockoutStart: 6 };
    const originalScores = Object.fromEntries(started.teams.map((id, i) => [id, 110 - i * 10]));
    for (let w = started.startWeek; w < started.startWeek + started.groupWeeks; w++) started.weeks[w] = { final: true, scores: structuredClone(originalScores) };
    started.weeks[started.knockoutStart] = { final: true, scores: structuredClone(originalScores) };
    const editor = harness({ canManage: true, saved: structuredClone(started) }); await editor.flush();
    assert(button(editor.tree, 'Edit Cup'), 'Started Cup has a visible commissioner edit action');
    assert(!find(editor.tree, node => node.props?.className === 'cup-rules'), 'Rules are absent from the live view by default');
    await editor.click('Rules');
    assert(find(editor.tree, node => node.props?.className === 'cup-rules'), 'Rules remain available on request');
    await editor.click('Close rules');
    assert(!find(editor.tree, node => node.props?.className === 'cup-rules'));
    await editor.click('Edit Cup');
    assert.equal(writes(editor).length, 0, 'Entering editing never unlocks or writes the Cup');
    assert(button(editor.tree, 'Save Cup changes').props.disabled, 'Unchanged saved setup does not create a revision');
    await editor.choose('points');
    assert(button(editor.tree, 'Save Cup changes').props.disabled, 'Tapping the selected format preserves the saved custom dates');
    await editor.rename('Cup Name Only');
    await editor.click('Save Cup changes');
    assert.equal(writes(editor).at(-1).revision, 3);
    assert.equal(writes(editor).at(-1).state.locked, true, 'Editing preserves the shared lock');
    assert.deepEqual(writes(editor).at(-1).state.weeks, started.weeks, 'Name edits preserve all finalized scores');
    assert(text(editor.tree).includes('Cup changes saved.'));
    await editor.click('Edit Cup'); await editor.rename('Discard this name'); await editor.click('Cancel');
    assert.equal(writes(editor).length, 1, 'Cancel does not save or unlock');
    assert.equal(text(find(editor.tree, node => node.type === 'h2')), 'Cup Name Only');

    const structural = harness({ canManage: true, saved: structuredClone(started) }); await structural.flush();
    await structural.click('Edit Cup');
    await changeControl(structural, 'Teams advancing', 2);
    assert(text(structural.tree).includes('2 finalized score weeks will need review'), 'Impact is visible when a fixed championship moves the qualifying dates');
    assert.deepEqual(structural.config.saved, started, 'Draft edits leave the shared Cup unchanged');
    await structural.click('Save Cup changes');
    const adjusted = writes(structural).at(-1).state;
    assert.equal(adjusted.locked, true);
    assert.equal(adjusted.qualifierCount, 2);
    assert.equal(Cup.tournament.championshipWeek(adjusted), Cup.tournament.championshipWeek(started), 'Changing field size schedules backwards from the selected championship');
    assert.notEqual(adjusted.startWeek, started.startWeek, 'The shorter bracket moves the qualifying dates while preserving the final');
    for (const [week, record] of Object.entries(adjusted.weeks)) {
        assert.deepEqual(record.scores, started.weeks[week].scores, 'Compatible score evidence stays available');
        assert.equal(record.final, false, 'A shifted qualifying window requires its retained results to be reviewed');
    }
    assert(!adjusted.weeks[1] && !adjusted.weeks[6], 'Scores outside the replacement schedule are omitted only after saving');

    const robin = { ...Cup.tournament.configure(league, 'round-robin'), locked: true, enabled: true, startWeek: 1, groupWeeks: 5, knockoutStart: 6, weeks: {} };
    for (let w = 1; w <= 6; w++) robin.weeks[w] = { final: true, scores: structuredClone(originalScores) };
    const robinToDouble = structural.prepareEdit(robin, { ...robin, format: 'round-robin-double' });
    for (let w = 1; w <= 5; w++) assert.deepEqual(robinToDouble.state.weeks[w], robin.weeks[w], 'Choosing double elimination keeps an unchanged round-robin qualifying stage final');
    assert.equal(robinToDouble.state.weeks[6].final, false);
    assert.equal(robinToDouble.reviewWeeks, 1, 'Only the changed bracket needs review');

    const eightLeague = { ...league, rosters: Array.from({ length: 8 }, (_, i) => ({ roster_id: i + 1 })) };
    const groupStarted = { ...Cup.tournament.configure(eightLeague, 'groups'), name: 'Started Group Cup', enabled: true, locked: true, startWeek: 4, knockoutStart: 7, weeks: {} };
    const groupScores = Object.fromEntries(groupStarted.teams.map((id, i) => [id, 180 - i * 10]));
    for (let week = 4; week <= 7; week++) groupStarted.weeks[week] = { final: true, scores: structuredClone(groupScores), fetchedAt: 'preserved-score-evidence' };
    const groupNameEdit = harness({ canManage: true, teamCount: 8, saved: structuredClone(groupStarted) }); await groupNameEdit.flush(); await groupNameEdit.click('Edit Cup');
    await groupNameEdit.rename('Renamed Group Cup'); await groupNameEdit.click('Save Cup changes');
    assert.deepEqual(writes(groupNameEdit).at(-1).state.weeks, groupStarted.weeks, 'A group Cup name edit keeps completed group and knockout results final');
    assert.deepEqual(writes(groupNameEdit).at(-1).state.groups, groupStarted.groups, 'Name-only changes retain the actual draw');

    const groupAssignmentEdit = harness({ canManage: true, teamCount: 8, saved: structuredClone(groupStarted) }); await groupAssignmentEdit.flush(); await groupAssignmentEdit.click('Edit Cup');
    await changeControl(groupAssignmentEdit, 'Group for Team 1', 'B'); await changeControl(groupAssignmentEdit, 'Group for Team 2', 'A');
    assert(text(groupAssignmentEdit.tree).includes('4 finalized score weeks will need review'), 'Changed group membership explains that qualification and dependent brackets must be reviewed');
    assert.deepEqual(groupAssignmentEdit.config.saved, groupStarted, 'Editing assignments does not mutate the active shared draw');
    await groupAssignmentEdit.click('Save Cup changes');
    const assignmentAdjusted = writes(groupAssignmentEdit).at(-1).state;
    assert.equal(assignmentAdjusted.locked, true);
    assert.deepEqual(assignmentAdjusted.groups, { A: ['3', '5', '7', '2'], B: ['4', '6', '8', '1'] });
    for (const [week, record] of Object.entries(assignmentAdjusted.weeks)) {
        assert.equal(record.final, false, 'A reassigned group cannot retain a final result for its old opponents');
        assert.deepEqual(record.scores, groupStarted.weeks[week].scores, 'Reassignment retains underlying fantasy-score evidence for review');
        assert.equal(record.fetchedAt, 'preserved-score-evidence');
    }

    const groupStyleOnly = structural.prepareEdit(groupStarted, { ...groupStarted, knockoutStyle: 'double' });
    for (let week = 4; week <= 6; week++) assert.deepEqual(groupStyleOnly.state.weeks[week], groupStarted.weeks[week], 'A bracket-only style change keeps results from the same group draw and qualifying dates final');
    assert.equal(groupStyleOnly.state.weeks[7].final, false);
    assert.equal(groupStyleOnly.reviewWeeks, 1, 'Only the existing bracket result needs review when group provenance is unchanged');

    const fixedFinalStyle = harness({ canManage: true, teamCount: 8, saved: structuredClone(groupStarted) }); await fixedFinalStyle.flush(); await fixedFinalStyle.click('Edit Cup');
    assert.equal(control(fixedFinalStyle.tree, 'Championship week').props.value, 8);
    await changeControl(fixedFinalStyle, 'Knockout style', 'double');
    assert.equal(control(fixedFinalStyle.tree, 'Championship week').props.value, 8, 'Changing group knockout style retains the chosen championship');
    assert.equal(control(fixedFinalStyle.tree, 'First Cup week').props.value, 2, 'A longer double bracket moves the group stage earlier');
    assert(text(fixedFinalStyle.tree).includes('4 finalized score weeks will need review'), 'Earlier qualifying dates explicitly require old results to be reviewed');
    await fixedFinalStyle.click('Save Cup changes');
    const fixedFinalAdjusted = writes(fixedFinalStyle).at(-1).state;
    assert.equal(fixedFinalAdjusted.knockoutStyle, 'double'); assert.equal(Cup.tournament.championshipWeek(fixedFinalAdjusted), 8);
    assert.deepEqual(fixedFinalAdjusted.groups, groupStarted.groups, 'Changing bracket style retains group assignments');
    for (const [week, record] of Object.entries(fixedFinalAdjusted.weeks)) {
        assert.equal(record.final, false, 'A moved group week or newly changed stage cannot count a final result from its previous stage');
        assert.deepEqual(record.scores, groupStarted.weeks[week].scores, 'A shifted stage retains compatible score evidence');
    }

    const survivalEditState = { ...Cup.tournament.configure(league, 'survivor', { teams: ['1', '2', '3', '4'] }), locked: true, enabled: true, startWeek: 1, knockoutStart: 1, groupWeeks: 2,
        weeks: { 1: { final: true, scores: { '1': 20, '2': 10, '3': 10, '4': 0 } } }, survivorRulings: { 1: { ids: ['1', '2'], reason: 'Agreed cutoff tiebreak' } } };
    const survivalEditor = harness({ canManage: true, saved: survivalEditState }); await survivalEditor.flush();
    await survivalEditor.click('Edit Cup');
    await changeControl(survivalEditor, 'Championship week', 3);
    await changeControl(survivalEditor, 'Survival weeks', 3);
    assert(!button(survivalEditor.tree, 'Save Cup changes').props.disabled, 'Obsolete cutoff rulings do not block a valid duration change');
    await survivalEditor.click('Save Cup changes');
    const survivalAdjusted = writes(survivalEditor).at(-1).state;
    assert.equal(survivalAdjusted.startWeek, 1); assert.equal(Cup.tournament.championshipWeek(survivalAdjusted), 3);
    assert.equal(survivalAdjusted.weeks[1].final, false, 'Survivor duration changes require review from the first cut');
    assert.deepEqual(survivalAdjusted.weeks[1].scores, survivalEditState.weeks[1].scores);
    assert.deepEqual(survivalAdjusted.survivorRulings, {}, 'Old cut-size rulings are cleared before validation');

    const editFailure = harness({ canManage: true, saved: structuredClone(started), saveError: 'The Cup changed in another session. Refresh before editing.' }); await editFailure.flush();
    await editFailure.click('Edit Cup'); await editFailure.rename('Keep this correction'); await editFailure.click('Save Cup changes');
    assert.equal(editFailure.config.saved.name, 'Started Cup', 'Conflict cannot overwrite the server Cup');
    assert(button(editFailure.tree, 'Save Cup changes'), 'Rejected edit remains open for recovery');
    assert.equal(find(editFailure.tree, node => node.type === 'input' && node.props.maxLength === 80).props.value, 'Keep this correction');
    assert(!text(editFailure.tree).includes('Cup changes saved.'), 'Conflict never claims a confirmed save');

    const editPending = harness({ canManage: true, saved: structuredClone(started), deferSaves: true }); await editPending.flush();
    await editPending.click('Edit Cup'); await editPending.rename('Pending correction');
    const saveCorrection = button(editPending.tree, 'Save Cup changes').props.onClick;
    saveCorrection(); saveCorrection(); await editPending.flush();
    assert.equal(writes(editPending).length, 1, 'Rapid edit saves send one revision');
    assert(button(editPending.tree, 'Cancel').props.disabled, 'Cancel cannot race a pending save');
    assert.equal(editPending.config.saved.name, started.name);
    await editPending.finishSave();
    assert.equal(text(find(editPending.tree, node => node.type === 'h2')), 'Pending correction');
    const readonlyStarted = harness({ saved: structuredClone(started) }); await readonlyStarted.flush();
    assert(!button(readonlyStarted.tree, 'Edit Cup'), 'View-only members never receive commissioner edits');
    assert(text(readonlyStarted.tree).includes('View only'), 'Member status stays clear without setup instructions');
    assert(!text(readonlyStarted.tree).includes('Commissioner access is needed'), 'A running Cup does not show members a commissioner setup banner');
    await readonlyStarted.click('Explore formats'); await readonlyStarted.choose('round-robin-double');
    assert(!button(readonlyStarted.tree, 'Save Cup changes'), 'Format exploration never becomes edit authority');
    assert.equal(writes(readonlyStarted).length, 0);

    const doubleState = { ...Cup.tournament.configure(league, 'round-robin-double', { teams: ['1', '2'] }), locked: true, enabled: true };
    doubleState.weeks[doubleState.startWeek] = { final: true, scores: { '1': 200, '2': 100 } };
    doubleState.weeks[doubleState.knockoutStart] = { final: true, scores: { '1': 90, '2': 110 } };
    const oneLoss = harness({ saved: structuredClone(doubleState) }); await oneLoss.flush();
    const yourCup = app => find(app.tree, node => node.props?.className === 'cup-your-team');
    assert.match(text(yourCup(oneLoss)), /Still in the hunt/, 'First double-elimination loss does not mark your team knocked out');
    doubleState.weeks[doubleState.knockoutStart + 1] = { final: true, scores: { '1': 90, '2': 110 } };
    const twoLosses = harness({ saved: structuredClone(doubleState) }); await twoLosses.flush();
    assert.match(text(yourCup(twoLosses)), /Knocked out/, 'Second double-elimination loss ends the run');
    assert(text(twoLosses.tree).includes('Not needed · champion decided'), 'An unbeaten champion does not leave a pending reset');
    doubleState.weeks[doubleState.knockoutStart + 1].scores = { '1': 120, '2': 100 };
    const resetPending = harness({ saved: structuredClone(doubleState) }); await resetPending.flush();
    assert.match(text(yourCup(resetPending)), /Still in the hunt/, 'Both finalists stay alive after the first championship upset');
    doubleState.weeks[doubleState.knockoutStart + 2] = { final: true, scores: { '1': 120, '2': 100 } };
    const resetChampion = harness({ saved: structuredClone(doubleState) }); await resetChampion.flush();
    assert.match(text(yourCup(resetChampion)), /Champion/, 'A champion who previously lost is displayed correctly');

    const scoreApp = harness({ canManage: true, saved: structuredClone(saved) }); await scoreApp.flush();
    scoreApp.config.matchups = league.rosters.map((roster, i) => ({ roster_id: roster.roster_id, points: 100 + i, ...(i === 0 ? { custom_points: 0 } : i === 1 ? { custom_points: -2.25 } : {}) }));
    await scoreApp.click('Fetch Sleeper scores'); await scoreApp.click('Save score preview');
    const fetchedScores = writes(scoreApp).at(-1).state.weeks[saved.startWeek].scores;
    assert.equal(fetchedScores['1'], 0, 'Commissioner override zero takes precedence over standard points');
    assert.equal(fetchedScores['2'], -2.25, 'Commissioner override negative points remains valid');
    assert.equal(fetchedScores['3'], 102, 'Normal score remains when no override');
    assert.equal(writes(scoreApp).at(-1).state.weeks[saved.startWeek].final, false, 'Fetching scores does not finalize the week');

    const tied = { ...Cup.tournament.configure(league, 'knockout', { teams: ['1', '2', '3', '4'] }), locked: true, enabled: true };
    tied.weeks[tied.knockoutStart] = { final: true, scores: { '1': 100, '2': 100, '3': 100, '4': 100 } };
    const pairings = Cup.tournament.knockout(tied)[0];
    const tieApp = harness({ canManage: true, saved: tied }); await tieApp.flush();
    await tieApp.click('Advance Team ' + pairings[0].a);
    await tieApp.click('Advance Team ' + pairings[1].a);
    const rulings = writes(tieApp).at(-1).state.tieRulings;
    assert.equal(Object.keys(rulings).length, 2, 'Resolving a second matchup preserves the first same-week tiebreak');
    assert.equal(rulings[tied.knockoutStart + ':' + pairings[0].a + ':' + pairings[0].b].winner, pairings[0].a);
    assert.equal(rulings[tied.knockoutStart + ':' + pairings[1].a + ':' + pairings[1].b].winner, pairings[1].a);

    const legacy = harness({ saved: { groups: { A: [], B: [], C: [] }, weeks: {}, locked: false, drawMargin: 4 } }); await legacy.flush();
    assert.equal(legacy.tree.type.name, 'LegacyWoeppelCupPanel', 'Existing legacy Cup keeps legacy rendering');
    assert.equal(writes(legacy).length, 0);

    const legacyDraw = { groups: { A: ['1', '2', '3', '4'], B: ['5', '6', '7', '8'], C: ['9', '10', '11', '12'] }, weeks: {}, locked: false, drawMargin: 4 };
    const legacyRace = harness({ legacy: true, canManage: true, saved: legacyDraw, deferSaves: true }); await legacyRace.flush();
    await legacyRace.click('Manage Cup');
    legacyRace.config.deferLoads = true;
    await legacyRace.backgroundRefresh();
    assert.equal(legacyRace.config.pendingLoads.length, 1, 'Legacy background refresh is pending with the old unlocked draw');
    const lockGroups = button(legacyRace.tree, 'Lock groups & create fixtures').props.onClick;
    lockGroups(); lockGroups(); await legacyRace.flush();
    assert.equal(writes(legacyRace).length, 1, 'Legacy duplicate lock taps send one request');
    assert.equal(writes(legacyRace)[0].state.locked, true, 'Legacy lock supersedes a pending refresh');
    await legacyRace.backgroundRefresh();
    assert.equal(legacyRace.calls.filter(call => call.action === 'load').length, 2, 'Legacy automatic refresh is skipped while saving');
    await legacyRace.finishSave();
    assert(!button(legacyRace.tree, 'Lock groups & create fixtures'), 'Legacy save success leaves draw setup');
    assert(text(legacyRace.tree).includes('Twelve teams. One name on the trophy.'));
    await legacyRace.finishLoad();
    assert(!button(legacyRace.tree, 'Lock groups & create fixtures'), 'Stale refresh cannot unlock a saved legacy Cup');
    assert(text(legacyRace.tree).includes('Twelve teams. One name on the trophy.'));
    const backup = JSON.parse(legacyRace.storage.get('wr_woeppel_v1_' + league.league_id + '_' + league.season));
    assert.equal(backup.locked, true, 'Legacy local backup records the confirmed server lock');
    assert.deepEqual(backup.groups, legacyDraw.groups);
    const autoCup={...Cup.configure(league,'points'),enabled:true,locked:true,startWeek:9,groupWeeks:1,knockoutStart:10};
    const auto=harness({saved:autoCup});await auto.flush();
    assert.equal(control(auto.tree,'Tournament week').props.value,9,'Cup opens on the current competition week');
    const providerBoard={supported:true,status:'ready',week:9,rows:[1,2,3,4,5].map(id=>({roster_id:id,points:id===1?0:id===2?-2:id*10}))};
    await auto.pushBoard(providerBoard);
    const liveBlock=find(auto.tree,node=>node.props['aria-label']==='Live Cup scores');
    assert(liveBlock);assert.match(text(liveBlock),/Team 10.00/);assert.match(text(liveBlock),/Team 2-2.00/);
    assert.match(text(auto.tree),/auto refresh every 30s · not finalized/);
    assert(auto.config.subscriptions.some(s=>s.week===9&&s.enabled));
    const updated=structuredClone(providerBoard);updated.rows[0].points=23.5;
    await auto.pushBoard(updated);assert.match(text(find(auto.tree,node=>node.props['aria-label']==='Live Cup scores')),/Team 123.50/);
    assert.equal(writes(auto).length,0,'Score subscription updates never write or finalize Cup state');
    assert.equal(auto.config.saved.weeks[9],undefined,'Live data remains a local preview');
    const finalCup={...autoCup,weeks:{9:{final:true,scores:{1:100,2:90,3:80,4:70,5:60}}}};
    const immutable=harness({saved:finalCup});await immutable.flush();await immutable.pushBoard(providerBoard);
    assert(!immutable.config.subscriptions.some(s=>s.enabled),'Finalized weeks do not subscribe to automatic score changes');
    assert.equal(immutable.config.saved.weeks[9].scores['1'],100);
    const legacyAuto=harness({legacy:true,saved:{...legacyDraw,locked:true}});await legacyAuto.flush();
    const legacyBoard={...providerBoard,rows:Array.from({length:12},(_,i)=>({roster_id:i+1,points:31+i}))};
    await legacyAuto.pushBoard(legacyBoard);assert.match(text(legacyAuto.tree),/31.00/);assert.match(text(legacyAuto.tree),/Live scores · auto refresh/);
    assert.equal(writes(legacyAuto).length,0,'Legacy auto scores do not save previews or lock results');
    console.log('PASS Cup panel: permission-aware saves, final-week scheduling, group draw/setup and remount, result provenance across edits, duplicate-tap guards, all sample formats, score overrides, legacy routing, live score subscriptions and save/refresh races');
})().catch(error => { console.error(error); process.exitCode = 1; });
