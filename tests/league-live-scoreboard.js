'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const Babel = require('@babel/standalone');
let hooks = [], index = 0, board, tab, tabOptions, effects = [];
const React = {
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
    useEffect(fn) { effects.push(fn); },
    createElement(type, props, ...children) { return { type, props: props || {}, children }; }
};
const App = { LeagueLiveScores: {
    currentWeek: () => 2, useScores: () => board,
    rosterPoints: row => row.points ?? null,
    playerPoints: (row, pid) => row.players_points?.[pid] ?? null
}, Chopped: { isChopped: league => league.settings?.type === 3, isAliveInWeek: (row, week) => !row.settings?.eliminated || week <= row.settings.eliminated } };
const scope = { React, window: { App, S: { nflState: { season: 2026 } } } };
vm.createContext(scope);
const scoreStubs = App.LeagueLiveScores;
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../js/shared/league-live-scores.js'), 'utf8'), scope);
Object.assign(App.LeagueLiveScores, scoreStubs);
vm.runInContext(Babel.transform(fs.readFileSync(require('path').join(__dirname, '../js/components/league-live-scoreboard.js'), 'utf8'), { presets: ['react'] }).code, scope);
const rows = [
    { roster_id: 1, matchup_id: 1, points: 0, starters: ['p1'], players_points: { p1: 0 } },
    { roster_id: 2, matchup_id: 1, points: -2, starters: ['p2'], players_points: { p2: -2 } },
    { roster_id: 3, matchup_id: 2, points: null, starters: ['p3'] },
];
const props = { currentLeague: { league_id: 'A', season: '2026', rosters: rows }, myRoster: rows[2], getOwnerName: id => `Owner ${id}`, getPlayerName: id => id, setActiveTab: (key, options) => { tab = key; tabOptions = options; } };
function nodes(tree) { return tree == null || typeof tree === 'boolean' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [tree] : [tree, ...nodes(tree.children)]; }
function text(tree) { return nodes(tree).filter(n => typeof n !== 'object').join(''); }
function render(extra = {}) { index = 0; effects = []; return scope.window.LeagueLiveScoreboard({ ...props, ...extra }); }
board = { status: 'ready', supported: true, rows, groups: [{ matchupId: 1, teams: rows.slice(0, 2) }, { matchupId: 2, teams: [rows[2]] }], updatedAt: Date.now() };
let tree = render();
let cards = nodes(tree).filter(n => n.type === 'article');
assert(text(cards[0]).includes('Owner 3'), 'Own matchup sorts first');
assert(text(tree).includes('0.00') && text(tree).includes('-2.00'), 'Zero and negative scores remain actual values');
assert(text(cards[0]).includes('—'), 'Missing score stays missing');
assert(text(cards[0]).includes('No opponent reported'), 'Unpaired team does not invent opponent');
nodes(tree).find(n => n.type === 'button' && text(n).includes('My Game Plan')).props.onClick();
assert.equal(tab, 'lineup');
assert.equal(tabOptions, undefined, 'My Game Plan retains ordinary lineup entry');
nodes(tree).find(n => n.type === 'select').props.onChange({ target: { value: '7' } });
assert.equal(nodes(render()).find(n => n.type === 'select').props.value, 7);
assert.equal(nodes(render({ currentLeague: { ...props.currentLeague, league_id: 'B' } })).find(n => n.type === 'select').props.value, 2, 'Switching league resets week');
board = { ...board, status: 'stale', error: new Error('offline') };
assert(text(render()).includes('last successful update'), 'Stale scores are disclosed');
board = { ...board, status: 'ready', error: null };
hooks = [];
tree = render({ currentLeague: { ...props.currentLeague, settings: { type: 3 }, rosters: rows.map(r => ({ ...r, settings: r.roster_id === 3 ? { eliminated: 1 } : {} })) } });
assert(text(tree).includes('Weekly scoring race'));
assert.equal(nodes(tree).filter(n => n.type === 'article').length, 2, 'Previously chopped team excluded');
assert(!text(tree).includes('No opponent reported'), 'Chopped does not show head-to-head');
const desktopChopped = render({ currentLeague: { ...props.currentLeague, settings: { type: 3 } }, myRoster: rows[1] });
assert(text(nodes(desktopChopped).find(n => n.type === 'article')).includes('Owner 1'), 'Desktop Chopped order remains score-ranked even when a lower-scoring team is mine');
// Phone initially shows the user's game, with all league scores reachable.
scope.window.WR = { useViewport: () => ({ isPhone: true }) };
hooks = [];
tree = render();
assert.equal(nodes(tree).filter(n => n.type === 'article').length, 1);
assert(text(nodes(tree).find(n => n.type === 'article')).includes('Owner 3'));
nodes(tree).find(n => n.type === 'button' && text(n) === 'All 2 games').props.onClick();
tree = render();
assert.equal(nodes(tree).filter(n => n.type === 'article').length, 2);
assert(text(tree).includes('0.00') && text(tree).includes('-2.00'));
// Full Overview/League board shows every matchup immediately and gives each a real destination.
hooks = [];
let teamTarget = null;
tree = render({ fullBoard: true, overview: true, onOpenTeam: id => { teamTarget = id; } });
assert.equal(nodes(tree).filter(n => n.type === 'article').length, 2);
assert(tree.props.className.includes('lls-expanded') && !tree.props.className.includes('lls-compact'), 'Full board must not use the compact horizontal scroller');
assert(!nodes(tree).some(n => n.type === 'button' && text(n).startsWith('All ')));
assert(text(tree).includes('League scoreboard'));
nodes(tree).find(n => n.props?.['aria-label'] === 'Open your matchup in Game Day').props.onClick();
assert.equal(tab, 'lineup');
assert.equal(tabOptions?.view, 'matchup', 'Overview matchup cards request the Matchup view');
const rival = nodes(tree).find(n => n.props?.['aria-label'] === 'Open Owner 1 vs Owner 2 matchup in Game Day');
assert(rival && text(rival).includes('0.00') && text(rival).includes('-2.00'), 'Rival card retains actual score evidence');
rival.props.onClick();
assert.equal(tab, 'lineup');
assert.deepEqual(JSON.parse(JSON.stringify(tabOptions)), { view: 'matchup', matchup: { leagueId: 'A', season: '2026', week: 2, rosterIds: ['1', '2'] } }, 'Rival entry carries the exact displayed pair and scoring context');
// Past weeks and archived seasons stay in the selected score context, even for our own game.
for (const extra of [
    { selectedWeek: 1 },
    { selectedWeek: 2, currentLeague: { ...props.currentLeague, season: '2025' } },
]) {
    hooks = []; tab = null;
    const historic = render({ fullBoard: true, onOpenTeam: id => { teamTarget = id; }, ...extra });
    assert(!nodes(historic).some(n => n.props?.['aria-label'] === 'Open your matchup in Game Day'), 'Historical own matchup does not jump to current lineup');
    const ownCard = nodes(historic).find(n => n.type === 'article' && n.props.className.includes('lls-card-own'));
    const ownDetails = nodes(ownCard).find(n => n.type === 'details' && n.props.className === 'mc-matchup-details');
    assert(ownDetails && text(ownDetails).includes('p3'), 'Historical own matchup exposes the selected week starter details');
    const rivalDetails = nodes(historic).find(n => n.type === 'details' && text(n).includes('Owner 1'));
    assert(rivalDetails && text(rivalDetails).includes('p1'), 'Historical rival matchup retains the selected week details');
    nodes(rivalDetails).find(n => n.type === 'button' && text(n) === 'Owner 2 →').props.onClick();
    assert.equal(teamTarget, 2, 'Historical team action retains its selected roster');
    assert.equal(tab, null);
}
hooks = [];
const current = render({ fullBoard: true, selectedWeek: 2 });
nodes(current).find(n => n.props?.['aria-label'] === 'Open your matchup in Game Day').props.onClick();
assert.equal(tab, 'lineup', 'Current-season current-week own matchup retains Game Day shortcut');
// Real NFL states contextualize partial fantasy scores; totals never infer completion.
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../js/shared/nfl-context.js'), 'utf8'), scope);
App.NFLByes = { seasonFor: league => Number(league.season), weekForPlayer: player => player?.team === 'CHI' ? 2 : null };
const progressPlayers = { done: { team: 'BUF' }, alias: { team: 'WSH' }, live: { team: 'GB' }, later: { team: 'NYG' }, bye: { team: 'CHI' }, postponed: { team: 'LV' } };
const progressGames = [
    { home: 'BUF', away: 'WAS', completed: true, state: 'post' },
    { home: 'GB', away: 'MIN', completed: false, state: 'in' },
    { home: 'NYG', away: 'DAL', completed: false, state: 'pre', kickoff: '2099-10-07T20:00:00Z' },
    { home: 'LV', away: 'KC', completed: false, state: 'pre', statusName: 'STATUS_POSTPONED' },
];
const count = scope.leagueScoreboardStarterProgress({ starters: ['done', 'alias', 'live', 'later', 'bye', 'postponed', 'missing', '0'], points: -50 }, progressPlayers, progressGames, props.currentLeague, 2);
assert.equal(count.finished, 2); assert.equal(count.remaining, 2); assert.equal(count.bye, 1); assert.equal(count.unknown, 2); assert.equal(count.empty, 1);
assert.equal(count.text, '2 final · 2 left · 1 bye · 2 unknown · 1 empty', 'Final/live/scheduled/bye/postponed/unknown/empty stay distinct');
assert.equal(scope.leagueScoreboardStarterProgress({ starters: ['missing'], points: 250 }, progressPlayers, progressGames, props.currentLeague, 2).text, 'Game status unavailable', 'Large earned scores cannot imply all players finished');
assert.equal(scope.leagueScoreboardStarterProgress({ starters: ['done'] }, progressPlayers, [], props.currentLeague, 2).text, 'Game status unavailable', 'Absent schedule never claims progress');
assert.equal(scope.leagueScoreboardStarterProgress({ starters: ['done'] }, progressPlayers, [{ home: 'BUF', away: 'WAS', state: 'post', completed: false }], props.currentLeague, 2).text, 'Game status unavailable', 'Unconfirmed post state is not a final');
hooks = [];
let progressTree = render({ fullBoard: true, selectedWeek: 2, playersData: { p1: progressPlayers.done, p2: progressPlayers.live } });
assert(text(progressTree).includes('Game status unavailable'));
const nflStateIndex = hooks.findIndex(value => value && Array.isArray(value.games));
hooks[nflStateIndex] = { key: '2026|2', games: progressGames };
progressTree = render({ fullBoard: true, selectedWeek: 2, playersData: { p1: progressPlayers.done, p2: progressPlayers.live } });
assert(text(progressTree).includes('1 final · 0 left') && text(progressTree).includes('0 final · 1 left'), 'Loaded schedule progress renders beside each team score');
assert(text(progressTree).includes('0.00') && text(progressTree).includes('-2.00'), 'Progress leaves zero and negative actual points intact');
assert(!text(progressTree).includes('NFL game scores'), 'Mobile excludes the NFL scoreboard');
scope.window.WR.useViewport=()=>({isPhone:false});
assert(text(render({fullBoard:true,selectedWeek:2})).includes('NFL game scores'), 'Desktop retains NFL scores');
scope.window.WR.useViewport=()=>({isPhone:true});
const finish=scope.leagueScoreboardProjectedFinish, service=App.LeagueLiveScores;
const estimates={live:{statLine:{median:{rush_yd:100}},points:{median:10}},later:{statLine:{median:{pass_yd:200}},points:{median:20}}};
assert.equal(finish({points:40,starters:['done','later'],players_points:{done:40,later:0}},progressPlayers,progressGames,props.currentLeague,2,estimates,service),60,'Completed points plus remaining estimate avoids double counting');
assert.equal(finish({points:45,starters:['done','live'],players_points:{done:40,live:5}},progressPlayers,progressGames,props.currentLeague,2,estimates,service),50,'Live earned points are replaced by their full-game estimate');
assert.equal(finish({points:55,starters:['done','live'],players_points:{done:40,live:15}},progressPlayers,progressGames,props.currentLeague,2,estimates,service),55,'Live projection cannot remove points already earned');
assert.equal(finish({points:-2,starters:['done','bye','0']},progressPlayers,progressGames,props.currentLeague,2,{},service),-2,'Completed signed actual total is preserved');
assert.equal(finish({points:0,starters:['later']},progressPlayers,progressGames,props.currentLeague,2,{later:{statLine:{median:{pass_yd:0,pass_td:0}},points:{median:0}}},service),0,'A genuine zero projection remains zero');
for (const median of [{},{gp:1},{season:2026,week:2}]) assert.equal(finish({points:0,starters:['later']},progressPlayers,progressGames,props.currentLeague,2,{later:{statLine:{median},points:{median:0}}},service),null,'Metadata-only projections stay unavailable');
for (const row of [{points:null,starters:['done']},{points:40,starters:['postponed']},{points:40,starters:['missing']},{points:40,starters:['live']},{points:40,starters:['later']}]) assert.equal(finish(row,progressPlayers,progressGames,props.currentLeague,2,{},service),null,'Required missing data stays unavailable');
let projectionOptions;
App.WeeklyProj={projectRoster:(_ids,options)=>{projectionOptions=options;return {p2:estimates.live};}};
progressTree=render({fullBoard:true,selectedWeek:2,playersData:{p1:progressPlayers.done,p2:progressPlayers.live}});
assert(nodes(progressTree).some(n=>n.props?.className==='mc-score-projection'&&/Proj\. finish.*10\.00/.test(text(n))),'Projected finish renders alongside actual score');
const scopedStats={p2:{gp:1,rush_yd:100}}, scopedPrior={p2:{gp:1,rush_yd:80}};
render({fullBoard:true,selectedWeek:2,statsData:scopedStats,priorData:scopedPrior});
assert.strictEqual(projectionOptions.statsData,scopedStats,'The scoreboard uses current league stats directly, without waiting for the global bridge');
assert.strictEqual(projectionOptions.priorData,scopedPrior);

const pastProgress = render({ fullBoard: true, selectedWeek: 1, playersData: { p1: progressPlayers.done, p2: progressPlayers.live } });
assert(!nodes(pastProgress).some(n => n.props?.className === 'mc-score-progress'), 'Current player team metadata cannot invent historical progress');
assert(!nodes(pastProgress).some(n=>n.props?.className==='mc-score-projection'),'Current projections cannot invent historical finishes');
// Actual score and projected finish are separate comparisons, including when
// they point in opposite directions. NFL state only resolves a zero-zero start.
{
    const savedBoard = board, savedHooks = hooks, savedProjections = App.WeeklyProj;
    const pairPlayers = { p1: { team: 'BUF' }, p2: { team: 'GB' } };
    const pairGames = (left = 'in', right = 'in') => [
        { home: 'BUF', away: 'MIA', state: left, completed: left === 'post', kickoff: '2099-10-07T20:00:00Z' },
        { home: 'GB', away: 'MIN', state: right, completed: right === 'post', kickoff: '2099-10-07T20:00:00Z' },
    ];
    const renderPair = ({ scores = [0, 28], estimates = [130, 120], games = pairGames(), status = 'ready', selectedWeek = 2, fullBoard = true } = {}) => {
        const pairRows = scores.map((points, i) => ({ roster_id: i + 1, matchup_id: 1, points, starters: ['p' + (i + 1)], players_points: { ['p' + (i + 1)]: points } }));
        board = { status, supported: true, rows: pairRows, groups: [{ matchupId: 1, teams: pairRows.slice().reverse() }], updatedAt: Date.now(), error: status === 'stale' ? new Error('offline') : null };
        App.WeeklyProj = { projectRoster: () => Object.fromEntries(estimates.flatMap((estimate, i) => estimate == null ? [] : [['p' + (i + 1), { statLine: { median: { pass_yd: estimate * 25 } }, points: { median: estimate } }]])) };
        const extra = { fullBoard, selectedWeek, currentLeague: { ...props.currentLeague, rosters: pairRows }, myRoster: pairRows[0], playersData: pairPlayers };
        hooks = []; render(extra);
        hooks[hooks.findIndex(value => value && Array.isArray(value.games))] = { key: '2026|' + selectedWeek, games };
        return render(extra);
    };
    const sides = view => nodes(view).filter(n => n.props?.['data-score-state']);
    const projection = side => nodes(side).find(n => n.props?.className === 'mc-score-projection');
    const actual = side => text(nodes(side).find(n => n.props?.className === 'lls-score'));
    const ariaHidden = node => node.props?.['aria-hidden'] === true || node.props?.['aria-hidden'] === 'true';
    const assertStates = (view, scoreStates, projectionStates) => {
        assert.deepEqual(sides(view).map(side => side.props['data-score-state']), scoreStates);
        assert.deepEqual(sides(view).map(side => projection(side)?.props['data-projection-state']), projectionStates);
        assert(!nodes(view).some(n => typeof n === 'object' && n.type !== 'style' && /^(Live|Won|Lost|Final)$/.test(text(n))), 'Relative score cues never declare a live state or final result');
    };
    let pair = renderPair();
    assertStates(pair, ['trailing', 'leading'], ['leading', 'trailing']);
    assert(text(nodes(sides(pair)[0]).find(n => n.props?.className === 'lls-owner')).includes('Owner 1'), 'Own identity sorts left even when provider pair order is reversed');
    assert(sides(pair)[0].props.className.includes('lls-own'));
    assert.deepEqual(sides(pair).map(actual), ['0.00', '28.00'], 'Lead cues do not substitute projections for actual totals');
    assert(text(sides(pair)[0]).includes('Behind') && text(sides(pair)[1]).includes('Leading'));
    assert(/projected finish.*130\.00.*ahead/i.test(projection(sides(pair)[0]).props['aria-label']));
    assert(/projected finish.*120\.00.*behind/i.test(projection(sides(pair)[1]).props['aria-label']));
    for (const [side, glyph] of [[sides(pair)[0], '↑'], [sides(pair)[1], '↓']]) {
        assert(nodes(projection(side)).some(n => ariaHidden(n) && text(n) === glyph), 'A nonverbal glyph reinforces the accessible projection comparison');
    }
    assert(nodes(sides(pair)[0]).some(n => typeof n === 'object' && text(n) === 'You'), 'Full-board own-team cue is explicit');
    pair = renderPair({ scores: [28, 0], estimates: [100, 120] });
    assertStates(pair, ['leading', 'trailing'], ['trailing', 'leading']);
    assert(text(sides(pair)[0]).includes('Leading') && text(sides(pair)[1]).includes('Behind'));
    pair = renderPair({ estimates: [120, 120] });
    assertStates(pair, ['trailing', 'leading'], ['tied', 'tied']);
    assert(sides(pair).every(side => /projected even/i.test(projection(side).props['aria-label'])));
    assert(sides(pair).every(side => nodes(projection(side)).some(n => ariaHidden(n) && text(n) === '=')));
    pair = renderPair({ scores: [0, 0], games: pairGames('pre', 'pre') });
    assertStates(pair, ['pending', 'pending'], ['leading', 'trailing']);
    assert(!sides(pair).some(side => nodes(side).some(n => typeof n === 'object' && text(n) === 'Tied')), 'Pregame zeroes do not imply an active tie');
    pair = renderPair({ scores: [0, 0], games: [...pairGames('pre', 'pre'), { home: 'KC', away: 'DEN', state: 'in', completed: false }] });
    assertStates(pair, ['pending', 'pending'], ['leading', 'trailing']);
    pair = renderPair({ scores: [0, 0], games: pairGames('in', 'pre') });
    assertStates(pair, ['tied', 'tied'], ['leading', 'trailing']);
    assert(sides(pair).every(side => nodes(side).some(n => typeof n === 'object' && text(n) === 'Tied')), 'A confirmed reported starter start permits a genuine zero-score tie');
    pair = renderPair({ scores: [0, 0], games: [] });
    assertStates(pair, ['pending', 'pending'], ['unavailable', 'unavailable']);
    pair = renderPair({ scores: [-2, 0], games: [] });
    assertStates(pair, ['trailing', 'leading'], ['unavailable', 'unavailable']);
    assert.deepEqual(sides(pair).map(actual), ['-2.00', '0.00'], 'Unequal known signed totals compare without inventing NFL progress');
    pair = renderPair({ scores: [null, 28] });
    assertStates(pair, ['unavailable', 'unavailable'], ['unavailable', 'unavailable']);
    assert.deepEqual(sides(pair).map(actual), ['—', '28.00'], 'An absent actual remains unknown instead of becoming zero');
    pair = renderPair({ estimates: [null, 120] });
    assertStates(pair, ['trailing', 'leading'], ['unavailable', 'unavailable']);
    assert(text(projection(sides(pair)[0])).includes('—') && text(projection(sides(pair)[1])).includes('120.00'), 'One missing estimate does not remove the other reported finish');
    assert(sides(pair).every(side => !nodes(projection(side)).some(n => ariaHidden(n) && /[↑↓=]/.test(text(n)))), 'An incomplete projected pair cannot declare a relative lead');
    pair = renderPair({ status: 'stale' });
    assertStates(pair, ['trailing', 'leading'], ['leading', 'trailing']);
    assert(text(pair).includes('last successful update'), 'Retained relative scores keep their stale-update disclosure');
    pair = renderPair({ scores: [28, 0], games: pairGames('post', 'post') });
    assertStates(pair, ['leading', 'trailing'], ['leading', 'trailing']);
    assert(sides(pair).every(side => text(side).includes('1 final · 0 left')), 'Confirmed starter progress stays visible without a new winner claim');
    pair = renderPair({ scores: [0, 0], selectedWeek: 1 });
    assert.deepEqual(sides(pair).map(side => side.props['data-score-state']), ['pending', 'pending'], 'Historical zeroes never borrow the current player directory to confirm a tie');
    assert(sides(pair).every(side => !projection(side)));
    pair = renderPair({ fullBoard: false });
    assert(!sides(pair).some(side => nodes(side).some(n => typeof n === 'object' && /^(You|Leading|Behind|Tied)$/.test(text(n)))), 'The compact board does not add full-board focus labels');
    board = savedBoard; hooks = savedHooks; App.WeeklyProj = savedProjections;
}
// Chopped's phone overview is one survival race, using the selected week's
// actual field and provider totals rather than per-team starter cards.
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../js/shared/chopped.js'), 'utf8'), scope);
const raceRosters = [1, 2, 3, 4, 5].map(roster_id => ({ roster_id, settings: roster_id === 4 ? { eliminated: 1 } : roster_id === 5 ? { eliminated: 2 } : {} }));
const raceWeekRows = [0, -2, -2, -50, 10].map((points, i) => ({ roster_id: i + 1, points, starters: [i === 1 ? 'p2' : 'p1'], players_points: i === 1 ? { p2: points } : { p1: points } }));
const raceProps = { fullBoard: true, overview: true, selectedWeek: 2, currentLeague: { ...props.currentLeague, settings: { type: 3, last_chopped_leg: 1 }, rosters: raceRosters }, myRoster: raceRosters[0], playersData: { p1: progressPlayers.done, p2: progressPlayers.live }, onOpenTeam: id => { teamTarget = id; } };
const raceTable = tree => nodes(tree).find(n => n.type === 'table' && n.props.className === 'mc-chop-race-table');
const raceBodyRows = tree => nodes(nodes(raceTable(tree)).find(n => n.type === 'tbody')).filter(n => n.type === 'tr');
const raceSummary = tree => nodes(tree).find(n => n.props?.className === 'mc-chop-race-summary');
board = { status: 'ready', supported: true, rows: raceWeekRows, groups: [], updatedAt: Date.now() };
hooks = []; render(raceProps);
hooks[hooks.findIndex(value => value && Array.isArray(value.games))] = { key: '2026|2', games: progressGames };
tree = render(raceProps);
assert.equal(nodes(tree).filter(n => n.type === 'article' || n.type === 'details').length, 0, 'Overview avoids oversized team and starter disclosures');
assert.deepEqual(raceBodyRows(tree).map(row => nodes(row).find(n => n.type === 'button').props['aria-label'].match(/^Open Owner \d+ team profile/)[0]), ['Open Owner 5 team profile', 'Open Owner 1 team profile', 'Open Owner 2 team profile', 'Open Owner 3 team profile'], 'Highest actual scores sort first; teams chopped before the selected week stay out');
assert.equal(raceBodyRows(tree).filter(row => row.props.className.includes('is-risk')).length, 2, 'Every team tied at the lowest actual score is provisionally at risk');
assert(raceBodyRows(tree).filter(row => row.props.className.includes('is-risk')).every(row => nodes(row).find(n => n.type === 'button').props['aria-label'].includes('Tied low · at risk; provisional')), 'Team actions retain risk evidence for assistive technology');
assert(text(tree).includes('Tied low · at risk') && text(tree).includes('Lowest score is provisionally at risk; official results decide the chop.'));
assert.equal(text(nodes(raceBodyRows(tree)[2]).filter(n => n.type === 'td')[2]), '10.00', 'Race reuses projected finish for unfinished starters');
assert.equal(text(nodes(raceBodyRows(tree)[3]).filter(n => n.type === 'td')[2]), '-2.00', 'Completed negative projected finish stays signed');
assert(text(raceSummary(tree)).includes('0.00') && text(raceSummary(tree)).includes('+2.00 pts'), 'Your genuine zero score and signed gap remain visible');
assert(raceBodyRows(tree)[1].props.className.includes('is-own'));
assert(nodes(raceBodyRows(tree)[1]).find(n => n.type === 'button').props['aria-label'].includes('Your team'));
nodes(raceBodyRows(tree)[2]).find(n => n.type === 'button').props.onClick(); assert.equal(teamTarget, 2, 'Dense team rows retain their profile action');
tree = render({ ...raceProps, overview: false });
assert(raceTable(tree), 'League Scores uses the same dense survival table as Overview');
assert.equal(nodes(tree).filter(n => n.type === 'article' || n.type === 'details').length, 0, 'League Scores does not restore tall per-team cards');
nodes(tree).find(n => n.props?.['aria-label']?.startsWith('View Owner 2 Week 2 starter scores')).props.onClick();
tree = render({ ...raceProps, overview: false });
const weeklyStarters = nodes(tree).find(n => n.props?.['aria-label'] === 'Owner 2 Week 2 starter scores');
assert(weeklyStarters && text(weeklyStarters).includes('-2.00'), 'A dense score row still opens the reported selected-week starter points');
assert(!nodes(render({ ...raceProps, overview: false, selectedWeek: 1 })).some(n => n.props?.className === 'mc-chop-race-detail'), 'Changing week closes a starter expansion from the previous week');
tree = render({ ...raceProps, myRoster: raceRosters[1] });
assert(text(raceSummary(tree)).includes('Tied at lowest · in danger') && text(raceSummary(tree)).includes('0.00 pts'));
tree = render({ ...raceProps, selectedWeek: 1 });
assert.equal(raceBodyRows(tree).length, 5, 'A team chopped in the selected week was still in that week’s field');
assert(text(raceBodyRows(tree).at(-1)).includes('Owner 4'));
assert(raceBodyRows(tree).every(row => text(nodes(row).filter(n => n.type === 'td')[2]) === '—'), 'Historical field never borrows current projections');
tree = render({ ...raceProps, selectedWeek: 3 });
assert.equal(raceBodyRows(tree).length, 3, 'Later fields exclude both completed eliminations');
tree = render({ ...raceProps, myRoster: raceRosters[3] });
assert(text(raceSummary(tree)).includes('Not in this week’s field'), 'Eliminated manager is not assigned a survival margin');
const missingRoster = { roster_id: 6, settings: {} };
tree = render({ ...raceProps, currentLeague: { ...raceProps.currentLeague, rosters: [...raceRosters, missingRoster] } });
assert.equal(raceBodyRows(tree).length, 5, 'Every alive roster remains visible when its weekly row is missing');
assert(text(raceBodyRows(tree).at(-1)).includes('Awaiting score'));
assert(text(raceSummary(tree)).includes('Gap unavailable') && !text(raceSummary(tree)).includes('+2.00 pts'), 'Incomplete field cannot imply a known cushion');
tree = render({ ...raceProps, currentLeague: { ...raceProps.currentLeague, rosters: [...raceRosters, missingRoster] }, myRoster: missingRoster });
assert(!text(raceSummary(tree)).includes('0.00') && text(raceSummary(tree)).includes('Gap unavailable'), 'Missing own actual stays unknown, not zero');
const allRaceProps = { ...raceProps, currentLeague: { ...raceProps.currentLeague, rosters: [...raceRosters, missingRoster] } };
const sortButton = (tree, name) => nodes(raceTable(tree)).find(n => n.type === 'button' && n.props['aria-label'] === name);
const order = tree => raceBodyRows(tree).map(row => Number(nodes(row).find(n => n.type === 'button').props['aria-label'].match(/Owner (\d+)/)[1]));
sortButton(tree, 'Actual').props.onClick();
tree = render(allRaceProps);
assert.deepEqual(order(tree), [2, 3, 1, 5, 6], 'Actual flips to low first, with missing scores last');
assert(nodes(raceTable(tree)).some(n => n.type === 'th' && n.props['aria-sort'] === 'ascending'));
sortButton(tree, 'Projected finish').props.onClick();
tree = render(allRaceProps);
assert.deepEqual(order(tree), [2, 5, 1, 3, 6], 'Projection sorts independently of actual');
assert.deepEqual(order(tree).filter((_, i) => raceBodyRows(tree)[i].props.className.includes('is-risk')), [2, 3], 'Projected order does not change actual survival risk');
sortButton(tree, 'Projected finish').props.onClick();
tree = render(allRaceProps);
assert.deepEqual(order(tree), [3, 1, 2, 5, 6], 'Projected finish reverses while unknown stays last');
tree = render({ ...allRaceProps, selectedWeek: 1 });
assert(sortButton(tree, 'Projected finish').props.disabled);
assert.deepEqual(order(tree), [5, 1, 2, 3, 4, 6], 'Historical week falls back to actuals');
board = { ...board, status: 'stale', error: new Error('offline') };
tree = render(raceProps);
assert(text(tree).includes('last successful update') && text(raceSummary(tree)).includes('+2.00 pts'), 'Retained stale race scores keep their freshness boundary');
board = { status: 'loading', supported: true, rows: [], groups: [] };
tree = render(raceProps);
assert(text(tree).includes('Loading this week') && text(tree).includes('Scores and risk are unavailable; official results decide the chop.'));
assert(raceBodyRows(tree).every(row => !row.props.className.includes('is-risk')), 'Unreported scores cannot nominate a lowest team');
board = { supported: false, status: 'unsupported', rows: [], groups: [] };
assert(!raceTable(render(raceProps)), 'Unsupported providers do not acquire an invented survival race');
assert(text(render()).includes('connected Sleeper leagues'));
console.log('League scoreboard render checks passed.');

(async () => {
    const calls=[];
    scope.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
    scope.setInterval=()=>1; scope.clearInterval=()=>{};
    App.NflContext.loadScores=async (...args)=>{calls.push(['scores',...args]);return progressGames;};
    App.NflContext.load=async (...args)=>{calls.push(['context',...args]);return {};};
    hooks=[]; render({fullBoard:true,selectedWeek:2});
    const cleanup=effects[0]();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['scores',2,'2026',2],['context',[2],'2026']],'Current scoreboard loads the same week and season matchup context as Game Day');
    assert(hooks.some(value=>value?.key==='2026|2'&&value.games?.length),'NFL progress updates after context is ready');
    cleanup();
    // Optional matchup/weather context must never hold a usable schedule hostage.
    App.NflContext.load=()=>new Promise(()=>{});
    hooks=[];render({fullBoard:true,selectedWeek:2});
    const release=effects[0]();await new Promise(resolve=>setImmediate(resolve));
    assert(hooks.some(value=>value?.key==='2026|2'&&value.games?.length),'A pending optional context request cannot hide projected finishes');
    release();
    console.log('League scoreboard projection context checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
