'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const source = fs.readFileSync('js/trade-calc.js', 'utf8');
const ast = Babel.packages.parser.parse(source, { plugins: ['jsx'] });
let component;
let picksInitializer;
let inputKeyFunction;
let verdictComponent;
Babel.packages.traverse.default(ast, { FunctionDeclaration(path) {
  if (path.node.id?.name === 'TcSeasonImpact') component = path.node;
  if (path.node.id?.name === 'tcSeasonInputKey') inputKeyFunction = path.node;
  if (path.node.id?.name === 'TcVerdictPanel') verdictComponent = path.node;
}, VariableDeclarator(path) {
  if (path.node.id?.name === 'picksByOwner' && path.node.init?.type === 'CallExpression') picksInitializer = path.node.init.arguments[0];
} });
assert(component, 'The live trade surface must provide the season-impact component');
assert(picksInitializer, 'Use the real trade-inventory initializer for the redraft regression');
const inventoryContext = vm.createContext({ seasonalEnabled: true, allRosters: [{ roster_id: 1 }] });
vm.runInContext('var inventory = (' + source.slice(picksInitializer.start, picksInitializer.end) + ')();', inventoryContext);
assert.equal(Object.keys(inventoryContext.inventory).length, 0, 'In-season redraft offers cannot invent already-used or future dynasty draft picks');
assert(inputKeyFunction);
const keyContext = vm.createContext({});
vm.runInContext(source.slice(inputKeyFunction.start, inputKeyFunction.end), keyContext);
const input = { league: { league_id: 'fixture', season: '2026', settings: { playoff_week_start: 15 }, scoring_settings: { rec: 1 }, roster_positions: ['RB', 'BN'], rosters: [{ roster_id: 1, players: ['p1'], settings: { wins: 3 } }] },
  currentWeek: 7, nflSeason: '2026', playersData: { p1: { position: 'RB', team: 'BUF', injury_status: '' } }, statsData: { p1: { gp: 6, rush_yd: 400 } }, priorData: { p1: { gp: 17, rush_yd: 1000 } }, projectionsData: { p1: { gp: 17, rush_yd: 1100 } },
  weeklyPlayerPoints: { p1: { 6: 0 } }, nflContext: { 'BUF|8': { opp: 'KC', vegas: { impliedTotal: 24 } } }, nflSchedule: { 8: { BUF: 'KC' } }, defenseRankings: { KC: { vsRB: 16 } } };
const clone = value => JSON.parse(JSON.stringify(value));
const originalKey = keyContext.tcSeasonInputKey(input);
assert.equal(keyContext.tcSeasonInputKey(clone(input)), originalKey, 'New React object references with identical facts must not refetch projections');
const irrelevant = clone(input); irrelevant.timeRecomputeTs = Date.now(); irrelevant.playersData.unrostered = { position: 'QB', team: 'KC' };
assert.equal(keyContext.tcSeasonInputKey(irrelevant), originalKey, 'Unrelated heartbeat and unrostered players must not restart the comparison');
for (const change of [
  value => value.league.scoring_settings.rec = 2,
  value => value.league.rosters[0].players.push('p2'),
  value => value.playersData.p1.injury_status = 'OUT',
  value => value.statsData.p1.rush_yd = 500,
  value => value.priorData.p1.rush_yd = 900,
  value => value.projectionsData.p1.rush_yd = 1200,
  value => value.weeklyPlayerPoints.p1[6] = 10,
  value => value.nflContext['BUF|8'].vegas.impliedTotal = 30,
  value => value.nflSchedule[8].BUF = 'DAL',
  value => value.defenseRankings.KC.vsRB = 1,
  value => value.currentWeek = 8,
]) { const changed = clone(input); change(changed); assert.notEqual(keyContext.tcSeasonInputKey(changed), originalKey, 'Changed season evidence must invalidate the comparison'); }
const compiled = Babel.transform(source.slice(component.start, component.end), { presets: ['react'] }).code;
assert(verdictComponent);
const verdictCompiled = Babel.transform(source.slice(verdictComponent.start, verdictComponent.end), { presets: ['react'] }).code;
const walk = node => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const copy = node => (node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (Array.isArray(node) ? node : node.children || []).map(copy).join(' ')).replace(/\s+/g, ' ');
const visibleCopy = node => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(visibleCopy).join(' ').replace(/\s+/g,' ');
  if (node.type === 'details' && !node.props.open) return visibleCopy((node.children || []).flat(Infinity).find(child => child?.type === 'summary'));
  return (node.children || []).map(visibleCopy).join(' ').replace(/\s+/g,' ');
};
const turn = () => new Promise(resolve => setTimeout(resolve, 8));

function harness(options = {}) {
  const states = [], refs = [], dependencies = [], cleanups = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, effects = [];
  const context = vm.createContext({ Tip: () => null, window: { setTimeout, clearTimeout, wrIsPro: () => options.pro !== false }, React: {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: initial => refs[refIndex++] || (refs[refIndex - 1] = { current: initial }),
    useState: initial => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useEffect: (callback, deps) => {
      const index = effectIndex++, previous = dependencies[index];
      if (!previous || deps.some((value, i) => value !== previous[i])) {
        dependencies[index] = deps;
        effects.push(() => { cleanups[index]?.(); cleanups[index] = callback(); });
      }
    },
  } });
  vm.runInContext(compiled, context);
  vm.runInContext(verdictCompiled, context);
  const expand = node => {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children.length === 1 ? node.children[0] : node.children }));
    return { ...node, children: (node.children || []).map(expand) };
  };
  return { render(props) {
    stateIndex = 0; refIndex = 0; effectIndex = 0; effects = [];
    const tree = expand(context[options.root || 'TcSeasonImpact'](props)); effects.forEach(run => run()); return tree;
  }, dispose() { cleanups.forEach(cleanup => cleanup?.()); } };
}

const result = {
  status: 'ready', effectiveWeek: 7, remainingWeeks: 2,
  coverage: { projected: 2, total: 2 },
  powerRank: { before: 4, after: 2, total: 6, beforePoints: 99, afterPoints: 106 },
  wins: { beforeRemaining: 0.9, afterRemaining: 1.3, delta: 0.4 },
  playoffs: { available: true, beforePct: 40, afterPct: 55, delta: 15, simCount: 3000 },
  weeks: [{ week: 7, opponentName: 'Future rival', beforePoints: 99, afterPoints: 106,
    opponentBeforePoints: 100, opponentAfterPoints: 93, beforeWinPct: 48, afterWinPct: 66,
    pointsDelta: 7, winDelta: 18, beforeStarters: [{ pid: 'sent' }], afterStarters: [{ pid: 'received' }], unfilledAfter: 0 }],
  assumptions: ['Current injury status held fixed.'], warnings: [],
};
const deal = { myRosterId: 1, partnerRosterId: 2, givePlayerIds: ['sent'], receivePlayerIds: ['received'] };
const controller = data => ({ enabled: true, key: '2026-league-a', status: 'ready', fromWeek: 7,
  analyze: () => data, playerName: pid => ({ sent: 'Outgoing starter', received: 'Incoming starter' }[pid] || pid) });

(async () => {
  let ui = harness(), props = { controller: controller(result), deal, detailed: true };
  assert.match(copy(ui.render(props)), /Calculating/); await turn();
  let tree = ui.render(props), text = copy(tree);
  for (const label of ['Helps your season', 'Projected power rank', 'Remaining wins', 'Playoff chance', 'Future rival', 'Outgoing starter', 'Incoming starter', 'Model estimate', "this week's roster unchanged", 'Current injury status held fixed.']) assert(text.includes(label), label);
  assert.match(text, /100\.0 → 93\.0 pts/, 'A trade partner changes in the opponent projection too');
  assert.match(text, /0\.4 expected wins/);
  assert.equal(walk(tree).find(node => node.type === 'table').props.className, 'tc-season-weeks');
  ui.dispose();

  ui = harness(); props = { controller: controller({ ...result, wins: { beforeRemaining: 1, afterRemaining: 1, delta: 0 }, playoffs: { available: true, beforePct: 0, afterPct: 0, delta: 0 } }), deal };
  ui.render(props); ui.render(props); await turn(); text = copy(ui.render(props));
  assert.match(text, /No clear gain/); assert.match(text, /0\.0 expected wins/); assert.match(text, /0%/);
  assert(!text.includes('Remaining games'), 'Compact finder cards keep the full table for the expanded view'); ui.dispose();

  ui = harness(); props = { controller: controller({ ...result, status: 'limited', wins: { delta: null }, playoffs: { available: false, reason: 'The remaining schedule is incomplete.' } }), deal, detailed: true };
  ui.render(props); await turn(); text = copy(ui.render(props));
  assert.match(text, /Impact incomplete/); assert.match(text, /Partial evidence/); assert.match(text, /Playoff odds unavailable: The remaining schedule is incomplete/); ui.dispose();

  ui = harness(); props = { controller: controller({ ...result, wins: { ...result.wins, decisionsPerWeek: 2, beforeFinal: 8, afterFinal: 9 }, playoffs: { ...result.playoffs, byeBeforePct: 10, byeAfterPct: 20 } }), deal, detailed: true };
  ui.render(props); await turn(); text = copy(ui.render(props));
  assert.match(text, /Standings wins/); assert.match(text, /extra league-median result/); assert.match(text, /Expected final standings wins/); assert.match(text, /First-round bye chance: 10% → 20%/); ui.dispose();

  ui = harness(); props = { controller: controller({ ...result, playoffs: { ...result.playoffs, beforePct: 40.1, afterPct: 55.9, delta: 15.8 }, weeks: [{ ...result.weeks[0], beforeWinPct: 48.2, afterWinPct: 65.8, winDelta: 17.6 }] }), deal, detailed: true };
  ui.render(props); await turn(); text = copy(ui.render(props));
  assert.match(text, /\+16 percentage points/, 'The displayed playoff delta reconciles with the displayed 40% to 56% pair');
  assert.match(text, /\+18 pp/, 'The displayed matchup delta reconciles with the displayed 48% to 66% pair'); ui.dispose();

  ui = harness(); props = { controller: { enabled: true, key: 'missing', status: 'unavailable', reason: 'Season data unavailable.' }, deal };
  text = copy(ui.render(props)); assert.match(text, /Season data unavailable/); assert(!text.includes('0%')); ui.dispose();
  ui = harness(); assert.equal(ui.render({ controller: { enabled: false }, deal }), null); ui.dispose();

  let finishOld;
  ui = harness(); props = { controller: { ...controller(result), analyze: () => new Promise(resolve => { finishOld = resolve; }) }, deal, detailed: true };
  ui.render(props); await turn();
  props = { ...props, controller: { ...controller({ ...result, wins: { delta: -0.4 } }), key: '2026-league-b' } };
  ui.render(props); await turn(); assert.match(copy(ui.render(props)), /Costs projected wins/);
  finishOld(result); await turn(); assert.match(copy(ui.render(props)), /Costs projected wins/, 'Late previous league results cannot overwrite the active estimate'); ui.dispose();

  // Phone-only detail uses one fold. Timing, signed outlook, incomplete
  // evidence and unknown values remain readable before it is expanded.
  for (const compactResult of [result,
    {...result,wins:{...result.wins,delta:-.4}},
    {...result,wins:{beforeRemaining:0,afterRemaining:0,delta:0},playoffs:{available:true,beforePct:0,afterPct:0}},
    {...result,status:'limited',wins:{delta:null},playoffs:{available:false,reason:'The remaining schedule is incomplete.'},warnings:['Some games lack projections.']},
  ]) {
    ui=harness();props={controller:controller(compactResult),deal,detailed:true,compact:true};ui.render(props);await turn();tree=ui.render(props);
    assert(tree.props.className.includes('is-compact'));
    const fold=walk(tree).find(node=>node.props.className==='tc-season-detail');assert.equal(fold.type,'details');assert(!fold.props.open,'Phone model detail starts closed');
    assert.match(visibleCopy(fold),/Remaining games.*model details/i);
    assert(!visibleCopy(tree).includes('Future rival'),'Remaining-game rows wait inside the phone disclosure');
    assert(copy(fold).includes('Future rival'));assert(copy(fold).includes('Outgoing starter'));assert(copy(fold).includes('Current injury status held fixed.'));
    assert(!walk(fold).some(node=>node!==fold&&node.type==='details'),'Starter changes and assumptions do not require nested phone folds');
    assert.match(visibleCopy(tree),/Starts Week 7/);assert.match(visibleCopy(tree),/roster unchanged/);
    if(compactResult.status==='limited'){assert.match(visibleCopy(tree),/Partial evidence/);assert.match(visibleCopy(tree),/Some games lack projections/);assert.match(visibleCopy(tree),/Playoff odds unavailable/);}
    else if(compactResult.wins.delta===0){assert.match(visibleCopy(tree),/No clear gain/);assert.match(visibleCopy(tree),/0\.0 expected wins/);assert.match(visibleCopy(tree),/0%/);}
    else assert.match(visibleCopy(tree),compactResult.wins.delta<0?/Costs projected wins/:/Helps your season/);
    ui.dispose();
  }
  ui=harness();tree=ui.render({controller:{enabled:true,key:'missing-mobile',status:'unavailable',reason:'Season data unavailable.'},deal,detailed:true,compact:true});assert.match(visibleCopy(tree),/Season data unavailable/);assert(!walk(tree).some(node=>node.type==='table'));assert(!visibleCopy(tree).includes('0%'));ui.dispose();

  const verdictProps = {
    totalA: 1000, totalB: 1100, diffDisplay: '+100', grade: { grade: 'B', label: 'Fair' },
    verdictColor: 'gold', rosterImpactLabel: '+RB / -WR', starterValueDelta: 100,
    pickCapitalDelta: 0, pickQuantityDelta: 0, faabDelta: 0, FAAB_RATE: 2,
    likelihood: 67, likelihoodColor: 'green', netTaxTotal: 0, otherOwnerId: null,
    otherDnaKey: 'NONE', otherDna: {}, psychTaxes: [], grudgeTax: { total: 0, entries: [] },
    gmWarnings: [{ text: 'Review your untouchable player.' }],
    seasonImpactController: controller(result), seasonImpactDeal: deal,
    secondOpinion: { type: 'p', props: {}, children: ['Alex second opinion fixture'] },
  };
  ui = harness({ root: 'TcVerdictPanel' });
  tree = ui.render(verdictProps); text = copy(tree);
  assert.match(text, /Calculating/); assert.match(text, /Deal value/); assert.match(text, /67\s*\/100 score/, 'The deal price and acceptance remain available while season data loads');
  await turn(); tree = ui.render(verdictProps); text = copy(tree);
  assert.equal(tree.props.id, 'wr-export-trade');
  assert.equal(tree.children[0].props.className, 'tc-section-hdr', 'Trade Analysis is the first content in the unified card');
  assert.equal(walk(tree).filter(node => node.props.id === 'wr-export-trade').length, 1);
  assert.equal(walk(tree).filter(node => node.props.className?.includes('tc-season-impact')).length, 1);
  assert(walk(tree).find(node => node.props.className?.includes('tc-season-impact')).props.className.includes('is-embedded'), 'The season body shares the analysis card');
  assert.equal(walk(tree).filter(node => node.props.className === 'tc-ta-impact-grid').length, 0, 'No redundant legacy grid in seasonal analysis');
  assert(!text.includes('Pick Capital')); assert(!text.includes('Roster Impact'));
  assert(text.indexOf('TRADE ANALYSIS') < text.indexOf('Helps your season'));
  assert(text.indexOf('Deal value') < text.indexOf('Remaining games'));
  assert(text.indexOf('Negotiation context') < text.indexOf('Remaining games'));
  assert.match(text, /Review your untouchable player/);
  assert.equal(walk(tree).filter(node => node.props.className === 'tc-trade-second-opinion').length, 1);
  assert.match(copy(walk(tree).find(node => node.props.className === 'tc-trade-second-opinion')), /Alex second opinion fixture/); ui.dispose();

  ui = harness({ root: 'TcVerdictPanel', pro: false });
  tree = ui.render(verdictProps); text = copy(tree);
  assert.match(text, /Deal value/); assert.match(text, /B value grade/); assert.match(text, /Negotiation context Pro/);
  assert(!/67\s*\/100/.test(text), 'Negotiation context stays gated on the free seasonal card');
  assert.match(text, /Review your untouchable player/, 'Free strategy warnings remain visible'); ui.dispose();

  ui = harness({ root: 'TcVerdictPanel' });
  tree = ui.render({ ...verdictProps, seasonImpactController: { enabled: true, key: 'missing', status: 'unavailable', reason: 'Season data unavailable.' } });
  text = copy(tree); assert.match(text, /Season data unavailable/); assert.match(text, /B value grade/); assert.match(text, /67\s*\/100 score/); assert(!text.includes('Remaining games')); ui.dispose();

  for (const pro of [false, true]) {
    ui = harness({ root: 'TcVerdictPanel', pro });
    tree = ui.render({ ...verdictProps, seasonImpactController: { enabled: false } }); text = copy(tree);
    assert.match(text, /Roster Impact/); assert.match(text, /Pick Capital/); assert.match(text, /FAAB/);
    assert.equal(walk(tree).filter(node => node.props.className === 'tc-ta-impact-grid').length, 1);
    assert(!text.includes('Projected power rank')); assert(!text.includes('Helps your season'));
    assert.equal(/67\s*\/100/.test(text), pro, 'Legacy acceptance gating remains unchanged'); ui.dispose();
  }

  console.log('PASS season-impact UI: season estimates, unified Trade Analysis composition, price/acceptance ordering, free/Pro gates, legacy layout, cache identity and stale-response isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
