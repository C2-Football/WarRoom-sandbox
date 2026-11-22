#!/usr/bin/env node
'use strict';
const assert = require('assert');
global.window = globalThis;
global.App = {};
for (const module of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai', 'ui', 'player-cards', 'hidden-years', 'player-stats']) require('../js/shared/time-league-' + module + '.js');
let state = [], refs = [], effects = [], cursor = 0, refCursor = 0;
global.React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useMemo: fn => fn(),
    useState: initial => {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
        return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useRef: initial => { const index = refCursor++; return refs[index] ||= { current: initial }; },
    useEffect: fn => { effects.push(fn); },
};
require('../js/components/time-league-team-panel.js');
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason;
const reset = () => { state = []; refs = []; effects = []; };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => JSON.stringify(node);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && node.props['aria-label'] === label);
const byClass = (tree, cls) => walk(tree).filter(node => node.props.className?.split(' ').includes(cls));
let league = E.createTimeLeague({ name: 'Named roster swaps', seed: 'roster-ui', createdAt: '2026-01-01',
    settings: { gameDeckVersion: 0, waiversEnabled: true, rosterSlots: { QB: 1, WR: 1, TE: 1, FLEX: 1, SUPER_FLEX: 1, DEF: 1, BN: 4 }, regularSeasonWeeks: 12, playoffTeams: 4, scoring: { passingYd: .04, passTd: 4, turnover: -2, rushRecYd: .1, reception: .5 }, eraRules: { mode: 'any' } },
    seats: Array.from({ length: 4 }, (_, index) => ({ name: index ? `Rival ${index}` : 'Commander', manager: index ? 'ai' : 'human' })),
});
const entry = (entryId, name, position, slot) => ({ entryId, identity: position.toLowerCase() + ':' + entryId, name, position, slot, drawnSeason: 1994 });
const entries = [entry('young', 'Steve Young', 'QB', 'QB'), entry('montana', 'Joe Montana', 'QB', 'BN'), entry('stabler', 'Ken Stabler', 'QB', 'BN'), entry('payton', 'Walter Payton', 'RB', 'BN'), entry('rice', 'Jerry Rice', 'WR', 'WR'), entry('sharpe', 'Shannon Sharpe', 'TE', 'BN')];
const cards = new Map(entries.map(item => [item.identity, { identity: item.identity, name: item.name, position: item.position, peak: 200,
    seasons: [1993, 1994, 1995].map(year => ({ season: year, games: 14, points: 200, passYd: 100, passTd: 2, passInt: 0, rushYd: 20, rushTd: 0, rec: 0, recYd: 0, recTd: 0 })) }]));
for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) cards.set('free:' + pos, { identity: 'free:' + pos, name: 'Free ' + pos, position: pos, peak: 100, seasons: [{ season: 1994, games: 14, points: 100 }] });
const logs = new Map();
for (const item of entries) for (let week = 1; week <= 14; week++) logs.set(S.gameLogKey(item.identity, 1994, week), { stats: { ...S.emptyStatLine(), passYd: week * 10, rushYd: week * 10 } });
league = { ...league, phase: 'season', weekStage: 'lineup', currentWeek: 3, seasonsRevealed: true,
    finalizedWeeks: [{ week: 1, results: [], matchups: [] }, { week: 2, results: [], matchups: [] }],
    teams: league.teams.map((team, index) => ({ ...team, roster: index ? [entry('foreign', 'Not Your Player', 'QB', 'QB')] : entries })) };
let applied = [], saveResult = true, browsedSlot = null, selectedTeam;
let comparisonProps = null;
App.GamePlayerComparison = props => { comparisonProps = props; return React.createElement('section', { 'aria-label': props.title }); };
const render = (extra = {}) => {
    cursor = 0; refCursor = 0; effects = [];
    return WrTimeLeagueTeamPanel({ league, cards, section: 'roster', activeTeamId: league.teams[0].teamId, logIndex: logs,
        onSelectTeam: id => { selectedTeam = id; },
        onBrowseWaivers: slot => { browsedSlot = slot; },
        onUpdate: async (next, action) => { applied.push({ next, action }); return saveResult; }, ...extra });
};
const choices = tree => byClass(tree, 'tl-roster-candidate').map(node => node.props['aria-label']);

(async () => {
    const originalLeague = league;
    reset();
    let fillControl = button(render(), 'Fill empty slots');
    assert(!fillControl.props.disabled);
    assert(text(byClass(render(), 'tl-roster-fill-help')).includes('Fill 3 empty starting slots from your bench'));
    assert(fillControl.props['aria-describedby'], 'The fill action has a visible accessible explanation');
    const pendingFill = fillControl.props.onClick();
    await fillControl.props.onClick();
    await pendingFill;
    assert.equal(applied.length, 1, 'Repeated taps cannot submit the same in-flight fill twice');
    const filled = applied[0].next;
    assert.deepEqual(filled.teams[0].roster.filter(item => ['young', 'rice'].includes(item.entryId)).map(item => [item.entryId, item.slot]), [['young', 'QB'], ['rice', 'WR']], 'Gap filling preserves occupied starting slots');
    assert.equal(filled.teams[0].roster.find(item => item.entryId === 'sharpe').slot, 'TE');
    assert.equal(filled.teams[0].roster.find(item => item.entryId === 'payton').slot, 'FLEX');
    assert.equal(filled.teams[0].roster.find(item => item.entryId === 'montana').slot, 'SUPER_FLEX');
    assert(text(byClass(render(), 'tl-roster-notice')).includes('Filled 3 empty starting slots'));
    assert(text(byClass(render(), 'tl-roster-notice')).includes('1 starting slot remains open'));
    assert(byClass(render(), 'tl-roster-notice')[0].props['aria-atomic']);

    reset(); saveResult = false;
    await button(render(), 'Fill empty slots').props.onClick();
    assert(text(byClass(render(), 'tl-roster-notice')).includes('was not saved'));
    assert(!button(render(), 'Fill empty slots').props.disabled, 'An unsuccessful save leaves a retry available');
    saveResult = true;
    reset();
    await button(render({ onUpdate: async () => { throw new Error('fixture save failure'); } }), 'Fill empty slots').props.onClick();
    assert(text(byClass(render(), 'tl-roster-notice')).includes('could not be saved'));

    league = filled;
    reset(); fillControl = button(render(), 'Fill empty slots');
    assert(fillControl.props.disabled, 'A remaining gap with no eligible bench player does not offer an ineffective action');
    assert(text(byClass(render(), 'tl-roster-fill-help')).includes('No eligible bench player can fill the empty starting slot'));
    const callsBeforeNoOp = applied.length;
    await fillControl.props.onClick();
    assert.equal(applied.length, callsBeforeNoOp, 'No-op fills never write a save');
    league = { ...filled, settings: { ...filled.settings, rosterSlots: { ...filled.settings.rosterSlots, DEF: 0 } } };
    reset(); assert(button(render(), 'Fill empty slots').props.disabled);
    assert.equal(byClass(render(), 'tl-roster-fill-help').length, 0, 'A full lineup does not add occupied-slot filler');
    assert(button(render(), 'Fill empty slots').props.title.includes('Every starting slot is occupied'), 'The disabled action retains its accessible explanation');
    league = { ...originalLeague, weekStage: 'ready' };
    reset(); assert(button(render(), 'Fill empty slots').props.disabled);
    await button(render(), 'Fill empty slots').props.onClick();
    assert.equal(applied.length, callsBeforeNoOp, 'Locked lineups do not submit fills');
    assert(text(byClass(render(), 'tl-roster-fill-help')).includes('Lineups are locked'));
    league = originalLeague;
    reset(); applied = [];

    assert(byClass(render(), 'tl-lineup-ytd').length === entries.length, 'Starters and bench each show a YTD points column');
    const signals = byClass(render(), 'tl-roster-signals');
    assert.equal(signals.length, entries.length, 'Every starter and bench player has an always-visible metric group');
    assert(signals.every(row => text(row).includes('Avg pts / game') && text(row).includes('2.1') && text(row).includes('W3 game rating')));
    assert.equal(byClass(render(), 'tl-roster-mobile-detail').length, 0, 'Primary player signals never require opening a details element');
    let compareControl = walk(render()).find(node => node.type === 'button' && node.children?.[0] === 'Compare players');
    compareControl.props.onClick(); render();
    assert(comparisonProps && comparisonProps.rows.length === entries.length, 'Lineup comparison includes this owner’s starters and bench');
    assert(comparisonProps.workspaceKey.includes(league.leagueId) && comparisonProps.workspaceKey.endsWith(league.teams[0].teamId));
    assert(!comparisonProps.rows.some(row => Object.hasOwn(row, 'entry') || Object.hasOwn(row, 'drawnSeason')), 'Comparison adapters do not pass the private assigned edition');
    assert.deepEqual(comparisonProps.columns.map(column => column.label), ['Vault W3 outlook', 'Completed-game PPG', 'Completed games', 'Points left']);
    assert(comparisonProps.scoutingForRow(comparisonProps.rows[1]).reason.includes('On your bench'));
    assert(comparisonProps.scoutingForRow(comparisonProps.rows[0]).confidence.includes('league scoring'));
    comparisonProps.onSelect(comparisonProps.rows[0]);
    assert(text(byClass(render(), 'tl-roster-dossier')).includes('Steve Young'), 'Comparison opens the same full player card');
    button(render(), 'Close player history').props.onClick();
    compareControl = walk(render()).find(node => node.type === 'button' && node.children?.[0] === 'Hide comparison');
    compareControl.props.onClick();
    let tree = render({ activeTeamId: league.teams[1].teamId });
    assert(text(tree).includes('Steve Young'));
    assert(!text(tree).includes('Not Your Player'));
    assert(!walk(tree).some(node => node.props['aria-label'] === 'Teams'));
    assert.equal(byClass(tree, 'tl-roster-dossier').length, 0, 'No empty scouting column on a roster visit');
    assert.equal(byClass(tree, 'tl-lineup-hero').length, 0, 'Roster rows follow one compact toolbar');
    assert(byClass(tree, 'tl-roster-toolbar').length);
    assert(!walk(tree).some(node => node.type === 'details' && text(node).includes('Lineup tips')), 'The repeated scouting advice panel is removed');

    button(tree, 'Move Steve Young').props.onClick();
    tree = render();
    assert.deepEqual(choices(tree), ['Swap Steve Young with Joe Montana', 'Swap Steve Young with Ken Stabler']);
    assert(text(byClass(tree, 'tl-roster-move-sheet')).includes('1994 · Bench'));
    assert(text(byClass(tree, 'tl-roster-move-sheet')).includes('of 5 stars this week'));
    assert(text(byClass(tree, 'tl-roster-current-player')).includes('Steve Young') && text(byClass(tree, 'tl-roster-current-player')).includes('2.1'), 'The current player remains visible for direct comparison');
    assert(byClass(tree, 'tl-candidate-signals').every(row => text(row).includes('2.1') && text(row).includes('W3 game rating')), 'Each replacement shows the same average and game rating without another click');
    await button(tree, 'Swap Steve Young with Ken Stabler').props.onClick();
    let last = applied.at(-1);
    assert.equal(last.action.targetEntryId, 'stabler');
    assert.equal(last.next.teams[0].roster.find(item => item.entryId === 'young').slot, 'BN');
    assert.equal(last.next.teams[0].roster.find(item => item.entryId === 'stabler').slot, 'QB');
    assert.equal(last.next.teams[0].roster.filter(item => item.slot === 'BN').length, 4, 'A full bench remains legal after an exact swap');
    assert.equal(byClass(render(), 'tl-roster-move-sheet').length, 0, 'Successful save closes the choice sheet');

    const swappedLeague = last.next;
    assert.equal(button(render(), 'Undo lineup move'), undefined, 'Undo waits for the saved roster to arrive');
    const moved = render({ league: swappedLeague });
    const undo = button(moved, 'Undo lineup move');
    assert(undo, 'A valid saved move offers inline Undo');
    assert.equal(button(render({ league: { ...swappedLeague, weekStage: 'claims' } }), 'Undo lineup move'), undefined, 'Stage changes invalidate a previous Undo');
    const beforeUndoAttempt = applied.length;
    await undo.props.onClick();
    assert.equal(applied.length, beforeUndoAttempt, 'A stale Undo callback cannot write');
    await button(render({ league: swappedLeague }), 'Undo lineup move').props.onClick();
    last = applied.at(-1);
    assert.equal(last.action.targetEntryId, 'stabler');
    assert.deepEqual(last.next.teams[0].roster.map(item => [item.entryId, item.slot]), entries.map(item => [item.entryId, item.slot]), 'Undo uses the same exact swap and restores the earlier lineup');

    window.WR = { useViewport: () => ({ isPhone: true }) };
    const compact = render();
    assert.equal(byClass(compact, 'tl-reserve-lineup')[0].props.open, false, 'Bench starts collapsed on the phone');
    assert(text(byClass(compact, 'tl-starting-lineup')).includes('PPG'), 'Starters show PPG above the collapsed bench');
    window.WR = undefined;

    button(render(), 'Fill open TE slot').props.onClick();
    tree = render();
    assert.deepEqual(choices(tree), ['Start Shannon Sharpe at TE']);
    await button(tree, 'Start Shannon Sharpe at TE').props.onClick();
    assert.equal(applied.at(-1).next.teams[0].roster.find(item => item.entryId === 'sharpe').slot, 'TE');

    button(render(), 'Fill open Flex slot').props.onClick();
    tree = render();
    assert(choices(tree).includes('Start Walter Payton at Flex'));
    assert(choices(tree).includes('Start Shannon Sharpe at Flex'));
    assert(choices(tree).includes('Start Jerry Rice at Flex'));
    assert(!choices(tree).some(label => /Young|Montana|Stabler/.test(label)));
    button(tree, 'Close lineup choices').props.onClick();
    button(render(), 'Fill open Super flex slot').props.onClick();
    tree = render();
    assert.equal(choices(tree).length, entries.length, 'Super flex offers every eligible rostered QB, RB, WR and TE');
    button(tree, 'Close lineup choices').props.onClick();
    button(render(), 'Fill open D/ST slot').props.onClick();
    tree = render();
    assert.equal(choices(tree).length, 0);
    assert(text(tree).includes('No eligible players on your roster'));
    assert(text(tree).includes('Acquisitions are closed'), 'Closed planning points to recovery instead of an unavailable claim');
    assert.equal(byClass(tree, 'tl-roster-find-player').length, 0);
    button(tree, 'Close lineup choices').props.onClick();
    league = { ...league, weekStage: 'claims' };
    button(render(), 'Fill open D/ST slot').props.onClick();
    tree = render();
    byClass(tree, 'tl-roster-find-player')[0].props.onClick();
    assert.equal(browsedSlot, 'DEF');
    league = { ...league, weekStage: 'lineup' };

    // The same sheet supports keyboard focus and restores scrolling after dismissal.
    let focusName = '';
    const firstControl = { focus: () => { focusName = 'first'; } };
    const lastControl = { focus: () => { focusName = 'last'; } };
    const previous = { focus: () => { focusName = 'previous'; } };
    global.document = { body: { style: { overflow: 'auto' } }, activeElement: previous };
    button(render(), 'Move Steve Young').props.onClick();
    tree = render();
    const sheet = byClass(tree, 'tl-roster-move-sheet')[0];
    sheet.props.ref.current = { focus: () => { focusName = 'sheet'; }, querySelectorAll: () => [firstControl, lastControl] };
    const cleanupFocus = effects.map(effect => effect()).find(result => typeof result === 'function');
    assert.equal(focusName, 'sheet'); assert.equal(document.body.style.overflow, 'hidden');
    let prevented = false;
    document.activeElement = firstControl;
    sheet.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true; } });
    assert(prevented); assert.equal(focusName, 'last');
    document.activeElement = lastControl;
    sheet.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault: () => {} });
    assert.equal(focusName, 'first');
    sheet.props.onKeyDown({ key: 'Escape', preventDefault: () => {} });
    assert.equal(byClass(render(), 'tl-roster-move-sheet').length, 0);
    cleanupFocus();
    assert.equal(document.body.style.overflow, 'auto'); assert.equal(focusName, 'previous');
    delete global.document;

    saveResult = false;
    button(render(), 'Move Steve Young').props.onClick();
    await button(render(), 'Swap Steve Young with Joe Montana').props.onClick();
    tree = render();
    assert.equal(byClass(tree, 'tl-roster-move-sheet').length, 1, 'Failed saves retain named choices');
    assert(text(tree).includes('Move was not saved'));
    button(tree, 'Close lineup choices').props.onClick();
    saveResult = true;

    league = { ...league, seasonsRevealed: false };
    button(render(), 'Move Steve Young').props.onClick();
    tree = render();
    assert(!text(byClass(tree, 'tl-roster-move-sheet')).includes('1994'));
    assert(!text(byClass(tree, 'tl-roster-move-sheet')).includes('of 5 stars'));
    button(tree, 'Close lineup choices').props.onClick();
    button(render(), "Explore Steve Young's history").props.onClick();
    assert(text(byClass(render(), 'tl-roster-dossier')).includes('Your edition is sealed'));
    assert(text(byClass(render(), 'tl-lineup-guidance')).includes('Game clue sealed') && !text(byClass(render(), 'tl-lineup-guidance')).includes('Bench this week'), 'Sealed editions do not receive invented lineup guidance');
    assert(!text(byClass(render(), 'tl-roster-dossier')).includes('1993'));
    league = { ...league, seasonsRevealed: true };
    tree = render();
    assert(text(byClass(tree, 'tl-roster-dossier')).includes('1993'));
    assert(text(byClass(tree, 'tl-lineup-guidance')).includes('within the player’s own historical season') && text(byClass(tree, 'tl-lineup-guidance')).includes('Vault W3'), 'Current-star guidance states its period and player-relative meaning');
    assert(text(byClass(tree, 'tl-roster-dossier')).includes('Archive ceiling:'), 'Best unused archive clue remains available in player history');
    assert(!text(byClass(tree, 'tl-roster-dossier')).includes('1995'), 'Player archive still stops before the drawn season');
    const removedLogs = [];
    for (let week = 4; week <= 11; week++) {
        const key = S.gameLogKey(entries[0].identity, 1994, week);
        removedLogs.push([key, logs.get(key)]); logs.delete(key);
    }
    tree = render();
    const vaultTab = walk(tree).find(node => node.type === 'button' && node.children?.[0] === 'Vault games');
    vaultTab.props.onClick(); tree = render();
    const completedTable = byClass(tree, 'tl-season-game-table')[0];
    const completedRows = walk(completedTable).filter(node => node.type === 'tbody')[0].children[0];
    assert.equal(completedRows.length, 2, 'Only completed Vault weeks appear, including when future records are missing');
    assert(text(byClass(tree, 'tl-roster-dossier')).includes('Future weeks stay sealed'));
    assert(text(byClass(tree, 'tl-roster-dossier')).includes('Vault weeks left'));
    assert(!text(completedTable).includes('W3'), 'Upcoming Vault scores are not reconstructed from archive rows');
    assert(text(byClass(tree, 'tl-archive-season-scope')).includes('Archive GP · W1–14'), 'Legacy counts are never presented as full-season NFL appearances');
    const youngCard = cards.get(entries[0].identity);
    cards.legacyCards = new Map(cards);
    cards.set(entries[0].identity, { ...youngCard, seasons: youngCard.seasons.map(season => season.season === 1994 ? { ...season, games: 16, recordedGames: 16, points: 320, scheduledGames: 16, sourceWeekKind: 'nfl-week' } : season) });
    tree = render();
    const scope = text(byClass(tree, 'tl-archive-season-scope'));
    assert(scope.includes('Recorded GP') && scope.includes('NFL schedule') && scope.includes('16 games') && scope.includes('14 weeks'), 'NFL schedule, logged appearances and Vault length remain distinct');
    assert(scope.includes('Full NFL season') && scope.includes('320.0 pts') && scope.includes('Legacy Vault · W1–14') && scope.includes('200.0 pts'), 'Old saves show full historical totals separately from preserved league pricing');
    const youngRow = byClass(tree, 'tl-lineup-row').find(row => text(row).includes('Steve Young'));
    const left = App.TimeLeaguePlayerStats.scouting(league, entries[0], E.cardsFor(league, cards), logs).remainingPoints;
    assert(text(byClass(youngRow, 'tl-lineup-remaining')).includes(left.toFixed(1)), 'The roster now shows remaining points from the preserved legacy game pool');
    assert(!scope.includes('NFL GP'), 'Recorded games are not claimed to be verified official participation');
    const currentKey = S.gameLogKey(entries[0].identity, 1994, 3), currentLog = logs.get(currentKey);
    logs.delete(currentKey); tree = render();
    assert(text(byClass(tree, 'tl-roster-signals')).includes('No recorded game'));
    assert(text(byClass(tree, 'tl-roster-game-warning')).includes('Steve Young') && text(byClass(tree, 'tl-roster-game-warning')).includes('0 pts'), 'The compact warning names current zero-game starters and their actual points');
    assert(!E.lineupProblems(league, league.teams[0].teamId).some(problem => /no recorded|zero points/i.test(problem)), 'A missing game does not become a new lineup blocker');
    button(tree, 'Compare replacements for Steve Young').props.onClick();
    assert(text(byClass(render(), 'tl-roster-move-sheet')).includes('Move Steve Young'), 'The visible advisory opens the same legal replacement chooser');
    button(render(), 'Close lineup choices').props.onClick();
    assert(text(byClass(tree, 'tl-lineup-guidance')).includes('Bench this week') && text(byClass(tree, 'tl-lineup-guidance')).includes('score zero'), 'Confirmed missing games provide a concrete bench reason');
    button(tree, 'Review lineup options for Steve Young').props.onClick();
    assert(text(byClass(render(), 'tl-roster-move-sheet')).includes('Move Steve Young'), 'A current no-game warning opens the real replacement chooser');
    button(render(), 'Close lineup choices').props.onClick();
    assert(!text(byClass(tree, 'tl-season-game-table')[0]).includes('W3'), 'A missing current game never reveals future Vault results');
    logs.set(currentKey, currentLog);
    cards.set(entries[0].identity, youngCard);
    delete cards.legacyCards;
    for (const [key, log] of removedLogs) logs.set(key, log);

    league = { ...league, weekStage: 'postgame' };
    tree = render();
    assert.equal(byClass(tree, 'tl-roster-game-warning').length, 0, 'Postgame does not show stale future-game advisories');
    assert(byClass(tree, 'tl-week-stars').every(node => text(node).includes('Awaiting next week') && !text(node).includes('No recorded game')));
    assert(text(byClass(tree, 'tl-lineup-guidance')).includes('Awaiting a current game clue') && !text(byClass(tree, 'tl-lineup-guidance')).includes('Bench this week'), 'A stale postgame report cannot produce a new recommendation');
    assert(!text(byClass(tree, 'tl-season-game-table')[0]).includes('W3'), 'Postgame keeps the upcoming currentWeek absent from the completed-game table');

    league = { ...league, weekStage: 'ready' };
    const before = applied.length;
    tree = render();
    assert(button(tree, 'Move Steve Young').props.disabled);
    assert(button(tree, 'Fill open TE slot').props.disabled);
    assert.equal(walk(tree).filter(node => node.props.draggable).length, 0);
    button(tree, 'Move Steve Young').props.onClick();
    assert.equal(byClass(render(), 'tl-roster-move-sheet').length, 0);
    assert.equal(applied.length, before);
    reset();
    assert(!text(render({ onlineMeta: { seatTeamId: 'outsider' } })).includes('Steve Young'), 'No fallback into another roster for an unseated online viewer');
    league = { ...league, weekStage: 'lineup', teams: league.teams.map((team, index) => index === 1 ? { ...team, manager: 'human' } : team) };
    reset(); tree = render();
    const hotseat = walk(tree).find(node => node.props['aria-label'] === 'Hotseat manager');
    assert(hotseat);
    assert.equal(walk(hotseat).filter(node => node.type === 'option').length, 2);
    hotseat.props.onChange({ target: { value: league.teams[1].teamId } });
    assert.equal(selectedTeam, league.teams[1].teamId);
    reset(); tree = render({ activeTeamId: league.teams[0].teamId, onlineMeta: { seatTeamId: league.teams[1].teamId } });
    assert(text(tree).includes('Not Your Player')); assert(!text(tree).includes('Steve Young'));
    assert(!walk(tree).some(node => node.props['aria-label'] === 'Hotseat manager'));

    league = { ...league, weekStage: 'claims' };
    logs.set(S.gameLogKey('free:WR', 1994, 1), { stats: { ...S.emptyStatLine(), rushYd: 1000 } });
    for (const [pos, stats] of [['WR', { rushYd: 200 }], ['RB', { rushYd: 50 }], ['TE', { passInt: 1 }]]) {
        logs.set(S.gameLogKey('free:' + pos, 1994, 3), { stats: { ...S.emptyStatLine(), ...stats } });
    }
    reset(); tree = render({ section: 'waivers', waiverSlot: 'FLEX' });
    let wire = byClass(tree, 'tl-waiver-table')[0];
    assert(text(wire).includes('Free RB') && text(wire).includes('Free WR') && text(wire).includes('Free TE'));
    assert(!text(wire).includes('Free QB') && !text(wire).includes('Free K') && !text(wire).includes('Free DEF'));
    assert(text(wire).includes('1994 season') && !text(wire).includes('CAREER BEST'), 'The wire names the actual weekly edition');
    assert(!text(wire).includes('G LEFT'), 'Free agency does not disclose future game counts');
    const waiverSignals = byClass(wire, 'tl-player-signals');
    assert.equal(waiverSignals.length, 3);
    assert(waiverSignals.every(row => text(row).includes('Avg pts / game') && text(row).includes('W3 game rating')), 'Free agents carry directly visible comparable game average and rating');
    assert(text(waiverSignals).includes('100.0') && text(waiverSignals).includes('No games yet'), 'Waiver averages use completed games, with no-game players shown honestly');
    const wireRemaining = byClass(wire, 'tl-waiver-score').filter(node => node.type === 'td');
    assert.deepEqual(wireRemaining.map(node => node.children[0]), ['20.0', '5.0', '-2.0'], 'Free agents rank by points still playable, including negative scores');
    assert(text(wireRemaining[0]).includes('120.0 total'), 'The historical season total stays separate from remaining points');
    button(tree, 'Claim Free WR').props.onClick(); tree = render({ section: 'waivers' });
    assert(text(byClass(tree, 'tl-waiver-preview')).includes('20.0') && text(byClass(tree, 'tl-waiver-preview')).includes('120.0'), 'Claim builder carries the same remaining and total points');
    assert(text(byClass(tree, 'tl-waiver-preview')).includes('Vault weeks left') && !text(byClass(tree, 'tl-waiver-preview')).includes('Games left'));
    const claimDialog = byClass(tree, 'tl-waiver-claim')[0];
    assert.equal(claimDialog.type, 'dialog', 'Claim selection opens a modal instead of a builder below the wire');
    assert(!walk(tree).some(node => node.type === 'select' && node.props['aria-label'] === 'Drop entry'));
    assert.equal(byClass(tree, 'tl-waiver-drop-option').filter(node => node.props['aria-label']).length, entries.length);
    assert.equal(byClass(tree, 'tl-waiver-target-signals').length, 1, 'The add target retains its average and game rating beside drop candidates');
    assert(byClass(tree, 'tl-waiver-drop-option').filter(node => node.props['aria-label']).every(row => byClass(row, 'tl-player-signals').length === 1), 'Every drop choice carries the same always-visible player signals');
    assert(text(byClass(tree, 'tl-waiver-drop-option')).includes('Est. pts left') && text(byClass(tree, 'tl-waiver-drop-option')).includes('W3'), 'Drop choices carry remaining points and weekly outlook');
    assert(text(claimDialog).includes('Vault W3 vs'), 'The claim includes the actual current Vault opponent');
    const roomySettings = league.settings;
    league = { ...league, settings: { ...league.settings, rosterSlots: { QB: 1, WR: 1, BN: 4 } } };
    tree = render({ section: 'waivers' });
    assert(button(tree, 'Drop Steve Young').props.disabled, 'A full roster cannot trade its only QB slot for a WR');
    assert(!button(tree, 'Drop Joe Montana').props.disabled, 'A bench drop remains eligible on a full roster');
    button(tree, 'Drop Joe Montana').props.onClick(); tree = render({ section: 'waivers' });
    assert(button(tree, 'Drop Joe Montana').props['aria-pressed']);
    saveResult = false;
    const file = page => walk(page).find(node => node.type === 'button' && text(node.children).includes('FILE CLAIM'));
    await file(tree).props.onClick(); tree = render({ section: 'waivers' });
    assert(text(tree).includes('Claim was not saved'));
    assert(button(tree, 'Drop Joe Montana').props['aria-pressed'], 'Failed saves retain the selected drop');
    assert.equal(applied.at(-1).action.dropEntryId, 'montana');
    claimDialog.props.onCancel({ preventDefault() {} });
    button(render({ section: 'waivers' }), 'Claim Free WR').props.onClick(); tree = render({ section: 'waivers' });
    assert(button(tree, 'Drop Joe Montana').props['aria-pressed'], 'Reopening the same claim retains the comparison');
    saveResult = true;
    league = { ...league, settings: roomySettings };
    const legacyLeague = league;
    const legacyPreview = E.waiverPreview;
    E.waiverPreview = (state, ...args) => ({ ...legacyPreview({ ...state, settings: { ...state.settings, gameDeckVersion: 0 } }, ...args), estimated: true });
    league = { ...league, settings: { ...league.settings, gameDeckVersion: 1 } };
    tree = render({ section: 'waivers' });
    assert(text(byClass(tree, 'tl-waiver-table')).includes('EST. PTS LEFT'));
    assert(text(byClass(tree, 'tl-waiver-preview')).includes('Estimated points left') && text(byClass(tree, 'tl-waiver-preview')).includes('Recorded season total'), 'New deck estimates are not represented as guaranteed future points');
    league = legacyLeague; E.waiverPreview = legacyPreview;
    tree = render({ section: 'waivers', logIndex: null });
    assert(byClass(tree, 'tl-waiver-score').filter(node => node.type === 'td').every(node => node.children[0] === '—'), 'Missing scoring data stays unknown rather than showing career-best points');
    reset(); tree = render({ section: 'waivers', waiverSlot: 'SUPER_FLEX' });
    wire = byClass(tree, 'tl-waiver-table')[0];
    assert(text(wire).includes('Free QB'));
    assert(!text(wire).includes('Free K') && !text(wire).includes('Free DEF'));
    league = { ...league, settings: { ...league.settings, tradesEnabled: true }, trades: [{ tradeId: 'offer-1', status: 'pending', fromTeamId: league.teams[1].teamId, toTeamId: league.teams[0].teamId, giveEntryIds: ['foreign'], receiveEntryIds: ['young'], week: league.currentWeek }] };
    reset(); tree = render({ section: 'trades' });
    const tradeTab = (tree, title) => walk(tree).find(node => node.type === 'button' && node.props['aria-pressed'] !== undefined && text(node.children).includes(title));
    assert(tradeTab(tree, 'Inbox').props['aria-pressed'], 'Opening Trades with an incoming offer lands directly in Inbox');
    assert(!byClass(tree, 'tl-trade-builder').length);
    tradeTab(tree, 'Trade builder').props.onClick();
    assert(tradeTab(render({ section: 'trades' }), 'Trade builder').props['aria-pressed'], 'The owner can still choose to compose an offer');
    league = { ...league, trades: league.trades.map(trade => ({ ...trade, deferredUntilWeek: league.currentWeek + 1 })) };
    reset(); tree = render({ section: 'trades' });
    assert(tradeTab(tree, 'Trade builder').props['aria-pressed'], 'A delayed offer does not take over the next visit');
    league = { ...league, weekStage: 'claims', trades: [{ tradeId: 'outgoing-ai', status: 'pending', fromTeamId: league.teams[0].teamId,
        toTeamId: league.teams[2].teamId, giveEntryIds: ['young'], receiveEntryIds: ['foreign'], week: league.currentWeek }] };
    reset(); tree = render({ section: 'trades' });
    const ping = page => walk(page).find(node => node.type === 'button' && text(node.children).includes('PING THE GM'));
    assert(text(tree).includes('The GM will respond after the waiver batch runs, during Decisions & lineup.'), 'An outgoing AI offer explains when its response will arrive');
    assert(!text(tree).includes('THE GM IS CONSIDERING') && !ping(tree), 'Claims do not imply active review or show a disabled ping');
    league = { ...league, weekStage: 'lineup' };
    tree = render({ section: 'trades' });
    assert(ping(tree) && !ping(tree).props.disabled, 'The existing ping action remains available during the response gate');
    league = { ...league, trades: league.trades.map(trade => ({ ...trade, deferredUntilWeek: league.currentWeek + 1 })) };
    tree = render({ section: 'trades' });
    assert(!ping(tree) && text(tree).includes(`Delayed until Week ${league.currentWeek + 1}`), 'Deferred AI offers keep their actual review week and cannot be pinged early');

    // The player card must honor the same viewer boundary and public archive
    // references as its compact roster metrics.
    const visibleText = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
        : Array.isArray(node) ? node.map(visibleText).join(' ') : visibleText(node.children);
    const scoutEntry = entry('scout', 'Scouting Quarterback', 'QB', 'QB');
    const scoutSource = [1000, 900, 800, 300, 200, 100].map((passYd, i) => ({ identity: scoutEntry.identity, season: 1994, week: i + 1,
        stats: { ...S.emptyStatLine(), passYd } }));
    const scoutLogs = S.buildGameLogIndex(scoutSource);
    const scoutCard = { identity: scoutEntry.identity, name: scoutEntry.name, position: 'QB', peak: 132,
        seasons: [{ season: 1994, games: 6, recordedGames: 6, points: 132, sourceWeekKind: 'nfl-week' }] };
    const scoutCards = new Map([[scoutEntry.identity, scoutCard]]);
    const scoutLeague = { ...league, settings: { ...league.settings, gameDeckVersion: 1, regularSeasonWeeks: 6, playoffTeams: 0, hiddenYears: false },
        currentWeek: 4, weekStage: 'lineup', teams: league.teams.map((team, i) => ({ ...team, roster: i ? [] : [scoutEntry] })),
        privateGameDecks: { [S.editionKey(scoutEntry)]: [1, 2, 3, 4, 5, 6, ...Array(8).fill(null)] },
        finalizedWeeks: [1, 2, 3].map(week => ({ week, results: [], matchups: [], playerProduction: [
            { ...scoutEntry, points: [40, 36, 32][week - 1], stats: scoutSource[week - 1].stats },
        ] })) };
    const scoutRender = extra => render({ league: scoutLeague, cards: scoutCards, logIndex: scoutLogs, activeTeamId: scoutLeague.teams[0].teamId, ...extra });
    reset(); tree = scoutRender({ throughWeek: 1 });
    button(tree, "Explore Scouting Quarterback's history").props.onClick();
    tree = scoutRender({ throughWeek: 1 });
    assert(visibleText(byClass(tree, 'tl-dossier-signals')).includes('Awaiting next week'));
    assert(!visibleText(byClass(tree, 'tl-roster-dossier')).includes('Archive ceiling:'), 'Player background cannot reveal a pool ceiling reduced by unwatched games');
    tree = scoutRender({ throughWeek: 3 });
    assert(visibleText(byClass(tree, 'tl-roster-dossier')).includes('Archive ceiling: 1 stars'), 'The same ceiling becomes visible after its completed games have been reached');
    assert.equal(S.weeklyStarOutlook(scoutEntry, 2, 6, scoutLogs, scoutLeague.settings.scoring, null, { ...scoutLeague, currentWeek: 2 }).maxRemainingStars, 5,
        'The replay fixture has five-star games before its two unseen draws, so the cap protects meaningful information');

    const publicLeague = { ...scoutLeague, publicSnapshotVersion: 1,
        finalizedWeeks: [1, 2, 3].map(week => ({ week, results: [], matchups: [] })),
        playerReports: { [S.editionKey(scoutEntry)]: { week: 4, currentAvailable: true, currentStars: 1, maxRemainingStars: 1,
            completed: [1, 2, 3].map(week => ({ week, sourceWeek: week, points: [39.5, 35.5, 31.5][week - 1] })) } } };
    reset(); tree = scoutRender({ league: publicLeague });
    button(tree, "Explore Scouting Quarterback's history").props.onClick();
    tree = scoutRender({ league: publicLeague });
    walk(tree).find(node => node.type === 'button' && visibleText(node) === 'Vault games').props.onClick();
    tree = scoutRender({ league: publicLeague });
    const publicGameTable = byClass(tree, 'tl-season-game-table')[0];
    const publicGameRows = walk(publicGameTable).filter(node => node.type === 'tr' && walk(node).some(cell => cell.type === 'td'));
    assert.equal(publicGameRows.length, 3);
    assert.deepEqual(publicGameRows.map(row => walk(row).filter(cell => cell.type === 'td').slice(0, 2).map(visibleText)),
        [['39.5', '1000'], ['35.5', '900'], ['31.5', '800']], 'Source-reference-only public reports resolve completed-game stats while preserving saved points');
    assert(!visibleText(publicGameTable).includes('W4'), 'Resolving source references cannot add the current or future Vault result');

    const publicHiddenEntry = { ...scoutEntry, editionId: 'e1' };
    Object.defineProperty(publicHiddenEntry, 'drawnSeason', { get() { throw new Error('The player card read a private year'); } });
    const fullLegacyCards = new Map(scoutCards);
    fullLegacyCards.legacyCards = new Map([[scoutEntry.identity, { ...scoutCard, seasons: [{ season: 1994, games: 3, points: 108 }] }]]);
    const fullLegacyLogs = new Map(scoutLogs);
    fullLegacyLogs.legacyIndex = S.buildGameLogIndex(scoutSource.slice(0, 3));
    const hiddenLegacyLeague = { ...scoutLeague, publicSnapshotVersion: 1, currentWeek: 2,
        settings: { ...scoutLeague.settings, gameDeckVersion: 0, hiddenYears: true }, yearsRevealed: false,
        hiddenYearCandidates: { [scoutEntry.identity]: [1994] }, hiddenYearDecades: { [scoutEntry.identity]: '1990s' }, finalizedWeeks: [],
        teams: scoutLeague.teams.map((team, i) => ({ ...team, roster: i ? [] : [publicHiddenEntry] })),
        playerReports: { e1: { week: 2, currentAvailable: true, currentStars: 3, completed: [] } } };
    const hiddenLegacyRender = () => scoutRender({ league: hiddenLegacyLeague, cards: fullLegacyCards, logIndex: fullLegacyLogs });
    reset(); tree = hiddenLegacyRender();
    button(tree, "Explore Scouting Quarterback's history").props.onClick();
    assert.doesNotThrow(() => { tree = hiddenLegacyRender(); }, 'An identified legacy card must use its public candidate year even in background totals');
    const hiddenLegacyScope = visibleText(byClass(tree, 'tl-archive-season-scope'));
    assert(hiddenLegacyScope.includes('Full NFL season 132.0 pts') && hiddenLegacyScope.includes('Legacy Vault · W1–14 108.0 pts'),
        'A publicly identified legacy card keeps the full-season reference and original scoring archive separate');
    assert.equal(visibleText(byClass(tree, 'tl-scouting-year')[0]), '1994', 'The public singleton supplies the bold year without reading the private edition');

    for (const fixture of [
        { position: 'K', extra: { fgm: 3, fgmiss: 1, xpm: 4, xpmiss: 2, fgm_50p: 3 },
            headings: ['FG made', 'FG missed', 'XP made', 'XP missed'], values: ['3', '1', '4', '2'] },
        { position: 'DEF', extra: { sack: 4, int: 2, fr: 3, def_td: 1, def_st_td: 2, safe: 1 },
            headings: ['Sacks', 'INT', 'Fum rec', 'Def TD', 'ST TD', 'Safety'], values: ['4', '2', '3', '1', '2', '1'] },
    ]) {
        const specialist = entry('specialist', `Scouting ${fixture.position}`, fixture.position, fixture.position);
        const specialistStats = { ...S.emptyStatLine(), extra: fixture.extra };
        const specialistCards = new Map([[specialist.identity, { identity: specialist.identity, name: specialist.name, position: specialist.position,
            seasons: [{ season: 1994, games: 1, points: S.scoreStatLine(specialistStats, scoutLeague.settings.scoring) }] }]]);
        const specialistLogs = S.buildGameLogIndex([{ identity: specialist.identity, season: 1994, week: 1, stats: specialistStats }]);
        const specialistLeague = { ...scoutLeague, publicSnapshotVersion: 1, currentWeek: 1, finalizedWeeks: [],
            settings: { ...scoutLeague.settings, rosterSlots: { [fixture.position]: 1, BN: 1 } },
            teams: scoutLeague.teams.map((team, i) => ({ ...team, roster: i ? [] : [specialist] })),
            playerReports: { [S.editionKey(specialist)]: { week: 1, currentAvailable: true, currentStars: 5, completed: [] } } };
        const specialistRender = () => scoutRender({ league: specialistLeague, cards: specialistCards, logIndex: specialistLogs });
        reset(); tree = specialistRender();
        button(tree, `Explore ${specialist.name}'s history`).props.onClick();
        tree = specialistRender();
        const table = byClass(tree, 'tl-season-game-table')[0];
        const headings = walk(table).filter(node => node.type === 'th' && node.props.scope === 'col').map(visibleText);
        assert.deepEqual(headings, ['NFL Wk', 'Points', ...fixture.headings], `${fixture.position} season games display scoring-specific columns instead of receiving statistics`);
        assert.deepEqual(walk(table).filter(node => node.type === 'td').slice(1).map(visibleText), fixture.values,
            `${fixture.position} season game values come from stats.extra`);
    }
    console.log('PASS: empty-slot fills preserve starters, handle save failures and repeat taps, explain unavailable actions, and connect current warnings to real replacement choices');
    console.log('PASS: own-roster focus, named atomic full-bench swaps, all eligible open-slot choices, mobile sheet, stars, sealed archive, locks, hotseat/online seat ownership, filtered free agents, failed-save recovery and viewer-safe public scouting cards');
})().catch(error => { console.error(error); process.exitCode = 1; });
