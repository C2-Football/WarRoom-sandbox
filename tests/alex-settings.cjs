'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync('js/shared/alex-settings.js', 'utf8');
function browser(disk = new Map()) {
    const listeners = new Map();
    const window = {
        WR: {},
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
        removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
        dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    };
    const localStorage = {
        getItem: key => disk.get(key) || null,
        setItem: (key, value) => disk.set(key, value),
    };
    vm.runInNewContext(source, { window, localStorage, CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts.detail; } } });
    return { api: window.WR.AlexSettings, window, disk };
}

test('existing preferences retain their values and gain enabled live topics', () => {
    const disk = new Map([['wr_alex_settings', JSON.stringify({ alertThreshold: 88, focus: { startSit: false, trades: false }, tradePriority: { positions: { QB: true }, picks: { 2028: true }, faab: false } })]]);
    const { api } = browser(disk);
    assert.equal(api.get().alertThreshold, 88);
    assert.equal(api.isTopicEnabled('startSit'), false);
    assert.equal(api.isTopicEnabled('trades'), false);
    for (const topic of ['performance', 'leagueOutlook', 'cups']) assert.equal(api.isTopicEnabled(topic), true);
    assert.equal(api.get().tradePriority.positions.QB, true);
    assert.equal(api.get().tradePriority.picks[2028], true);
    assert.equal(api.get().tradePriority.faab, false);
});

test('topic choices persist across league changes and reloads, and notify mounted surfaces', () => {
    const { api, window, disk } = browser();
    const received = [];
    const stop = api.subscribe(settings => received.push(settings));
    api.save({ ...api.get(), focus: { ...api.get().focus, cups: false, performance: false } });
    assert.equal(received.length, 1);
    assert.equal(received[0].focus.cups, false);
    window.S = { currentLeague: { league_id: 'another-league' } };
    assert.equal(api.isTopicEnabled('cups'), false);
    assert.equal(api.isTopicEnabled('performance'), false);
    const reopened = browser(disk).api;
    assert.equal(reopened.isTopicEnabled('cups'), false);
    assert.equal(reopened.isTopicEnabled('leagueOutlook'), true);
    stop();
    api.save({ ...api.get(), alertThreshold: 90 });
    assert.equal(received.length, 1);
    assert.equal(api.isTopicEnabled('performance'), false);
});

test('in-app switch and topic choices filter both live topics and tagged insights', () => {
    const { api } = browser();
    api.save({ ...api.get(), focus: { ...api.get().focus, leagueOutlook: false } });
    assert.equal(api.shouldShow({ focus: 'leagueOutlook', confidence: 99 }), false);
    assert.equal(api.shouldShow({ focus: 'performance', confidence: 99 }), true);
    assert.equal(api.shouldShow({ focus: 'performance', confidence: 50 }), false);
    api.save({ ...api.get(), channel: { ...api.get().channel, inApp: false } });
    for (const topic of ['startSit', 'performance', 'leagueOutlook', 'cups']) assert.equal(api.isTopicEnabled(topic), false);
    assert.equal(api.filterInsights([{ focus: 'performance', confidence: 99 }]).length, 0);
});

test('global settings expose all topics and preserve disabled choices through sensitivity presets', () => {
    const { api, window } = browser();
    window.WR.Card = 'card';
    window.WR.MobileSection = 'section';
    const tabSource = fs.readFileSync('js/tabs/alex-insights.js', 'utf8');
    const start = tabSource.indexOf('    function SettingsView(');
    const end = tabSource.indexOf('    const presetBtnStyle', start);
    const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
    const SettingsView = vm.runInNewContext('(' + tabSource.slice(start, end).trim() + ')', {
        window, h, DEFAULT_SETTINGS: api.DEFAULTS, PreferenceDetails: 'details',
        saveSettings: api.save, presetBtnStyle: {}, wrAlpha: value => value,
    });
    let settings = api.get();
    const render = () => SettingsView({ settings, setSettings: next => { settings = next; }, currentLeague: { season: '2026' }, leagueSkin: { type: 'dynasty', features: {} } });
    const elements = node => typeof node === 'object' && node ? [node, ...node.children.flatMap(elements)] : [];
    const label = node => node.children.map(child => typeof child === 'string' ? child : child && typeof child === 'object' ? label(child) : '').join('');
    const findButton = (tree, text) => elements(tree).find(node => node.type === 'button' && label(node).startsWith(text));
    let tree = render();
    for (const text of ['Lineup', 'Player results', 'League outlook', 'Cups', 'Trades', 'Waivers', 'Draft', 'Injury watch', 'Streaming', 'GM style']) assert(findButton(tree, text), text);
    findButton(tree, 'Cups').props.onClick();
    tree = render();
    assert.equal(findButton(tree, 'Cups').props['aria-pressed'], false);
    findButton(tree, 'Conservative').props.onClick();
    assert.equal(api.isTopicEnabled('cups'), false);
    assert.equal(api.get().alertThreshold, 85);
    assert.match(label(render()), /Saved on this device/);
});
