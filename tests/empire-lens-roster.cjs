'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const Babel = require('@babel/standalone');

global.App = {};
const lenses = require('../js/shared/empire-lenses.js');
const source = fs.readFileSync(path.join(__dirname, '../js/components/empire-lens-board.js'), 'utf8');
const compiled = Babel.transform(source, { presets: ['react'] }).code;
const walk = node => Array.isArray(node) ? node.flatMap(walk) : node?.children ? [node, ...walk(node.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children)
    : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const cls = name => node => (node.props.className || '').split(' ').includes(name);

function fixture() {
    const account = 'sleeper:mine';
    const context = JSON.stringify([account, 'waivers', 'projected']);
    const leagues = ['League A', 'League B', 'League C'].map((name, index) => ({
        id: String(index + 1), name, season: '2026', rosters: [{ owner_id: 'mine', roster_id: 1 }],
    }));
    const entries = lenses.list(leagues, 'mine');
    const players = {
        one: { full_name: 'Jamie Receiver', position: 'WR', team: 'BUF' },
        two: { full_name: 'Taylor Runner', position: 'RB', team: 'DEN' },
    };
    const move = (id, pid, delta, outgoing) => ({ id, incoming: [{ pid, projection: 17.2 }], outgoing: [{ name: outgoing }], weekly: { delta } });
    const rows = Object.fromEntries(entries.map((entry, index) => [entry.key, {
        league: entry.league,
        result: { status: index === 2 ? 'eliminated' : 'ready', elimination: index === 2 ? 'Eliminated in the playoffs' : null,
            candidates: [move('move-' + index, index === 2 ? 'two' : 'one', index + 2, index === 1 ? 'Bench B' : 'Bench A')] },
    }]));
    const cache = { current: { context, rows } };
    const React = {
        Fragment: Symbol('Fragment'),
        createElement(type, props, ...children) {
            return typeof type === 'function' ? type({ ...props, children }) : { type, props: props || {}, children };
        },
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
        useMemo: callback => callback(),
        useEffect() {},
        useLayoutEffect() {},
    };
    const sandbox = vm.createContext({ React, window: { App: { EmpireLenses: lenses } } });
    vm.runInContext(compiled, sandbox);
    let view = { mode: 'waivers', basis: 'projected', scroll: 0 };
    const open = [];
    return { open, render: (sleeperUserId = 'mine') => sandbox.window.EmpireLensBoard({
        leagues, players, playersLoaded: true, sleeperUserId, view, cache,
        onView: patch => { view = { ...view, ...patch }; },
        onOpenLeague: (league, tab) => open.push([league.id, tab]),
    }) };
}

test('one compact player row combines league moves and drills down to the chosen league', () => {
    const { render, open } = fixture();
    let tree = render();
    const rows = walk(tree).filter(cls('empire-lens-player'));
    assert.equal(rows.length, 1);
    assert.match(text(rows[0]), /Jamie ReceiverBUF.*2 leagues\+3 pts/);
    const toggle = walk(rows[0]).find(cls('wr-roster-mobile-player-trigger'));
    assert.equal(toggle.props['aria-expanded'], false);
    toggle.props.onClick();
    tree = render();
    const detail = walk(tree).find(cls('empire-lens-player-detail'));
    assert.match(text(detail), /Drop Bench A/);
    assert.match(text(detail), /Drop Bench B/);
    const buttons = walk(detail).filter(cls('empire-lens-drill'));
    buttons[1].props.onClick();
    assert.deepEqual(open, [['2', 'fa']]);
});

test('eliminated leagues are unchecked by default and manual filters stay account scoped', () => {
    const { render } = fixture();
    let tree = render();
    const checks = () => walk(tree).filter(node => node.type === 'input');
    assert.deepEqual(checks().map(node => node.props.checked), [true, true, false]);
    checks()[2].props.onChange({ target: { checked: true } });
    tree = render();
    assert.deepEqual(walk(tree).filter(cls('wr-roster-mobile-group-heading')).map(text), ['RB1', 'WR1']);
    checks()[0].props.onChange({ target: { checked: false } });
    tree = render();
    assert.match(text(walk(tree).filter(cls('empire-lens-player'))[1]), /1 league\+3 pts/);
    tree = render('another-owner');
    assert.deepEqual(checks().map(node => node.props.checked), [true, true, true]);
    assert.equal(walk(tree).filter(cls('empire-lens-player')).length, 0);
});
