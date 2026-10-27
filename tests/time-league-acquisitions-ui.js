#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'ai', 'ui', 'hidden-years', 'player-stats']) require(`../js/shared/time-league-${name}.js`);
let states = [], refs = [], cursor = 0, refCursor = 0, effects = [];
global.React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useMemo: fn => fn(), useRef: initial => { const index = refCursor++; return refs[index] ||= { current: initial }; }, useEffect: effect => { effects.push(effect); },
};
require('../js/components/time-league-team-panel.js');
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason, stamp = '2026-10-21T00:00:00Z';
const entry = (id, position, slot = position) => ({ entryId: id, identity: `player:${id}`, name: id.replaceAll('-', ' '), position, slot, drawnSeason: 2000 });
function create(settings = {}) {
    const state = E.createTimeLeague({ name: 'Acquisition decisions', seed: 'acq-ui', createdAt: stamp,
        settings: { gameDeckVersion: 0, hiddenYears: false, eraRules: { mode: 'any-era', decades: [] }, rosterSlots: { QB: 1, RB: 1, WR: 1, BN: 2 }, maxQuarterbacks: 2, regularSeasonWeeks: 2, playoffTeams: 0,
            waiversEnabled: true, tradesEnabled: true, scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 }, ...settings },
        seats: [{ name: 'Atlas', manager: 'human' }, { name: 'Morgan', manager: 'human' }] });
    return { ...state, phase: 'season', weekStage: 'claims', seasonsRevealed: true, teams: state.teams.map((team, i) => ({ ...team, roster: [entry(`${i}-QB`, 'QB'), entry(`${i}-RB`, 'RB'), entry(`${i}-WR`, 'WR'), entry(`${i}-Reserve`, 'WR', 'BN')] })) };
}
function cardsFor(league) {
    const entries = [...league.teams.flatMap(team => team.roster), entry('Free-Passer', 'QB'), entry('Free-Backup', 'QB'), entry('Free-Runner', 'RB')];
    return new Map(entries.map(player => [player.identity, { identity: player.identity, name: player.name, position: player.position, peak: 100, seasons: [{ season: 2000, games: 14, points: 100 }] }]));
}
let league, cards, writes, saved = true, navigate;
const reset = (next = create()) => { league = next; cards = cardsFor(next); writes = []; saved = true; navigate = null; states = []; refs = []; };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node.children) === label));
const region = (tree, label) => walk(tree).find(node => node.props['aria-label'] === label);
const render = (section = 'waivers', props = {}) => {
    cursor = 0; refCursor = 0; effects = [];
    return WrTimeLeagueTeamPanel({ league, cards, section, activeTeamId: 't1', onSelectTeam() {}, logIndex: new Map(),
        onNavigate: tab => { navigate = tab; }, onUpdate: async (next, action) => { writes.push({ next, action }); if (saved) league = next; return saved; }, ...props });
};
const claim = (identity, dropEntryId = '', bidAmount = 0, teamId = 't1') => {
    const card = cards.get(identity);
    league = E.submitWaiverClaim(league, { teamId, addIdentity: identity, addName: card.name, addPosition: card.position, dropEntryId, bidAmount }, stamp);
};
function offer(give = '0-QB', receive = '1-QB') {
    league = E.proposeTrade(league, { fromTeamId: 't2', toTeamId: 't1', giveEntryIds: [receive], receiveEntryIds: [give], note: 'Recorded offer' }, stamp);
    league = { ...league, weekStage: 'lineup' };
}
let count = 0;
async function test(name, fn) { reset(); await fn(); count++; console.log(`  ok ${name}`); }
(async () => {
    await test('QB cap is a visible legal reason; a compatible QB drop makes one durable claim', async () => {
        league = { ...league, settings: { ...league.settings, maxQuarterbacks: 1 } };
        button(render(), 'Claim Free Passer').props.onClick();
        let tree = render(), dialog = region(tree, 'Waiver claim');
        assert(button(dialog, '⚖ FILE CLAIM').props.disabled);
        assert(text(dialog).includes(E.waiverClaimProblem(league, { teamId: 't1', addIdentity: 'player:Free-Passer', addPosition: 'QB', dropEntryId: '' })));
        button(dialog, 'Drop 0 QB').props.onClick(); tree = render(); dialog = region(tree, 'Waiver claim');
        const file = button(dialog, '⚖ FILE CLAIM'); assert(!file.props.disabled);
        await Promise.all([file.props.onClick(), file.props.onClick()]);
        assert.equal(writes.length, 1); assert.equal(league.pendingClaims.length, 1);
        assert(text(region(render(), 'Waiver claim')).includes('0 QB stays on your roster unless this claim wins.'));
        assert(button(render(), 'Review pending claim for Free Passer'));
        assert(button(region(render(), 'Waiver claim'), 'Review pending claims'));
    });
    await test('failed filing retains drop and labeled bid for a real retry', async () => {
        reset(create({ waiverMode: 'faab', faabBudget: 100 }));
        button(render(), 'Claim Free Passer').props.onClick();
        button(region(render(), 'Waiver claim'), 'Drop 0 Reserve').props.onClick();
        walk(region(render(), 'Waiver claim')).find(node => node.props['aria-label'] === 'FAAB bid').props.onChange({ target: { value: '17' } });
        saved = false;
        await button(region(render(), 'Waiver claim'), '⚖ FILE CLAIM').props.onClick();
        let dialog = region(render(), 'Waiver claim');
        assert(text(dialog).includes('Claim was not saved'));
        assert(button(dialog, 'Drop 0 Reserve').props['aria-pressed']);
        assert.equal(walk(dialog).find(node => node.props['aria-label'] === 'FAAB bid').props.value, 17);
        assert(!button(dialog, '⚖ FILE CLAIM').props.disabled);
        saved = true; await button(dialog, '⚖ FILE CLAIM').props.onClick(); assert.equal(league.pendingClaims[0].bidAmount, 17);
    });
    await test('native close honors the chosen pending-list destination while Escape restores its trigger', async () => {
        let focused;
        const trigger = { focus: () => { focused = 'trigger'; } };
        button(render(), 'Claim Free Passer').props.onClick({ currentTarget: trigger });
        await button(region(render(), 'Waiver claim'), '⚖ FILE CLAIM').props.onClick();
        let tree = render(), dialog = region(tree, 'Waiver claim');
        region(tree, 'Your pending claims').props.ref.current = { focus: () => { focused = 'pending'; }, scrollIntoView() {} };
        dialog.props.ref.current = { open: true, close() { this.open = false; } };
        button(dialog, 'Review pending claims').props.onClick();
        dialog.props.onClose(); assert.equal(focused, 'pending', 'The native close event cannot override the explicit review destination');
        button(render(), 'Review pending claim for Free Passer').props.onClick({ currentTarget: trigger });
        dialog = region(render(), 'Waiver claim'); dialog.props.onCancel({ preventDefault() {} }); dialog.props.onClose();
        assert.equal(focused, 'trigger', 'A fresh modal resets its destination for normal Escape/Close');
    });
    await test('FAAB own queue is ordered by bid and filing, with honest shared-drop reservations', async () => {
        reset(create({ waiverMode: 'faab', faabBudget: 100 }));
        claim('player:Free-Passer', '0-Reserve', 5); claim('player:Free-Backup', '0-Reserve', 15);
        claim('player:Free-Runner', '1-Reserve', 40, 't2');
        const queue = region(render(), 'Your pending claims');
        const rows = walk(queue).filter(node => node.props.className === 'tl-pending-claim');
        assert.equal(rows.length, 2); assert(text(rows[0]).includes('Free Backup')); assert(text(rows[1]).includes('Free Passer'));
        assert(text(queue).includes('$20 reserved · $80 available'));
        assert(text(queue).includes('Shared drop: only the first successful claim'));
        assert(!text(queue).includes('$40'), 'Rival bids are never listed in the own queue');
        button(queue, 'Review pending claim').props.onClick();
        const dialog = region(render(), 'Waiver claim'); assert(text(dialog).includes('new filing position')); assert(!button(dialog, '⚖ FILE CLAIM'));
        const cancel = button(dialog, 'Cancel pending claim');
        await Promise.all([cancel.props.onClick(), cancel.props.onClick()]);
        assert.equal(writes.length, 1); assert.equal(league.pendingClaims.filter(row => row.teamId === 't1').length, 1);
        assert(text(region(render(), 'Waiver claim')).includes('reserved bid is available again'));
    });
    await test('priority own queue stays in filing order and cancellation failure keeps the claim', async () => {
        claim('player:Free-Passer', '0-QB'); claim('player:Free-Backup', '0-QB');
        let queue = region(render(), 'Your pending claims');
        assert(text(walk(queue).filter(node => node.props.className === 'tl-pending-claim')[0]).includes('Free Passer'));
        saved = false;
        await button(queue, 'Cancel claim for Free Passer').props.onClick();
        queue = region(render(), 'Your pending claims');
        assert.equal(league.pendingClaims.length, 2); assert(text(queue).includes('Cancellation was not saved'));
        assert(!button(queue, 'Cancel claim for Free Passer').props.disabled);
        const onlineDesk = region(render('waivers', { onlineMeta: { seatTeamId: 't1', role: 'member' } }), 'Your pending claims');
        assert(text(onlineDesk).includes('2 pending · Your desk')); assert(!text(onlineDesk).includes('league quiet'), 'An own-only snapshot makes no claim about rival activity');
    });
    await test('settled receipt uses saved awards and verbatim activity, with a real lineup route', () => {
        league = { ...league, weekStage: 'lineup', waiverResults: [{ week: 1, identity: 'player:Free-Passer', name: 'Free Passer', winnerTeamId: 't1', contenderTeamIds: ['t1'] },
            { week: 1, identity: 'player:Free-Backup', name: 'Free Backup', winnerTeamId: 't2', contenderTeamIds: ['t1', 't2'] }],
            activity: [{ id: 'record-1', week: 1, kind: 'waiver', message: 'Saved settlement detail: roster no longer has the named drop.' }] };
        const receipt = region(render(), 'Latest waiver batch');
        assert(text(receipt).includes('Added Free Passer')); assert(text(receipt).includes('Free Backup went to Morgan.'));
        assert(text(receipt).includes('Saved settlement detail: roster no longer has the named drop.'));
        assert(!text(receipt).includes('outbid'), 'The UI does not invent a personal failure reason from the award record');
        button(receipt, 'View lineup').props.onClick(); assert.equal(navigate, 'roster');
        const immediate = region(render('roster'), 'Latest waiver batch');
        assert(text(immediate).includes('Added Free Passer')); assert(text(immediate).includes('Free Backup went to Morgan.'));
        assert(!button(immediate, 'View lineup'), 'The actual roster landing does not link back to itself');
        button(immediate, 'View waiver activity').props.onClick(); assert.equal(navigate, 'waivers');
    });
    await test('accepted trade is saved once, explains bench arrivals and opens lineup repair', async () => {
        offer();
        const accept = button(render('trades'), '✓ ACCEPT'); assert(!accept.props.disabled);
        await Promise.all([accept.props.onClick(), accept.props.onClick()]);
        assert.equal(writes.length, 1); assert.equal(league.trades[0].status, 'accepted');
        const receipt = region(render('trades'), 'Saved trade outcome');
        assert(text(receipt).includes('Trade accepted')); assert(text(receipt).includes('You received 1 QB and sent 0 QB'));
        assert(text(receipt).includes('Received players enter the bench'));
        assert(E.lineupProblems(league, 't1').includes('QB slot is empty'));
        button(receipt, 'Set lineup').props.onClick(); assert.equal(navigate, 'roster');
        for (const phase of ['season', 'complete']) {
            const editable = league;
            league = { ...league, phase, weekStage: 'ready' };
            const historical = region(render('trades'), 'Saved trade outcome');
            assert(button(historical, 'View lineup')); assert(!button(historical, 'Set lineup'));
            assert(text(historical).includes('entered the bench when this trade settled')); assert(!text(historical).includes('before locking'));
            league = editable;
        }
        league = { ...league, weekStage: 'claims' };
        button(render('trades'), 'Trade builder').props.onClick();
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 1 QB').props.onChange();
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 0 QB').props.onChange();
        await button(render('trades'), 'Send offer').props.onClick();
        assert(!region(render('trades'), 'Saved trade outcome'), 'The older accepted receipt cannot appear to accept the new pending offer');
    });
    await test('failed trade response leaves controls available; canonical withdrawal never claims acceptance', async () => {
        offer(); saved = false;
        await button(render('trades'), '✓ ACCEPT').props.onClick();
        assert(text(render('trades')).includes('response was not saved')); assert.equal(league.trades[0].status, 'pending');
        assert(!button(render('trades'), '✓ ACCEPT').props.disabled);
        const original = league;
        await button(render('trades', { onUpdate: async (next, action) => { writes.push({ next, action }); league = { ...original, trades: original.trades.map(trade => ({ ...trade, status: 'withdrawn', note: 'Saved ownership changed.' })) }; return true; } }), '✓ ACCEPT').props.onClick();
        const receipt = region(render('trades'), 'Saved trade outcome');
        assert(text(receipt).includes('Offer withdrawn')); assert(text(receipt).includes('Saved ownership changed.')); assert(!text(receipt).includes('Trade accepted'));
    });
    await test('an infeasible package may be proposed during claims but cannot be accepted unchanged', async () => {
        button(render('trades'), 'Trade builder').props.onClick();
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 0 RB').props.onChange();
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 1 WR').props.onChange();
        let tree = render('trades'); assert(text(tree).includes('Cannot accept this package with the current rosters'));
        assert(!button(tree, 'Send offer').props.disabled, 'Planning may repair the roster before the recipient decides');
        await Promise.all([button(tree, 'Send offer').props.onClick(), button(tree, 'Send offer').props.onClick()]); assert.equal(league.trades.length, 1); assert.equal(writes.length, 1);
        league = { ...league, weekStage: 'lineup' }; states = []; refs = [];
        tree = render('trades', { activeTeamId: 't2' });
        assert(button(tree, '✓ ACCEPT').props.disabled); assert(text(tree).includes('Cannot accept now:'));
        assert(!button(tree, '✕ REJECT').props.disabled); assert(!button(tree, 'DELAY TO NEXT WEEK').props.disabled);
        await button(tree, 'DELAY TO NEXT WEEK').props.onClick(); assert.equal(league.trades[0].deferredUntilWeek, 2);
    });
    await test('unavailable trade values stay unknown and cannot produce a grade', () => {
        cards.delete('player:0-QB');
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 0 QB').props.onChange();
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 1 QB').props.onChange();
        const tree = render('trades');
        assert(text(tree).includes('Comparison unavailable')); assert(text(tree).includes('reference scoring, which can differ from your league'));
        const row = walk(tree).find(node => node.props.className?.includes('tl-trade-player') && text(node).includes('0 QB'));
        assert(text(row).includes('—')); assert(!text(tree).includes('Steal'));
    });
    await test('hidden trade averages disclose observed league scoring and candidate reference scoring without reading a secret year', () => {
        league = { ...league, currentWeek: 2, settings: { ...league.settings, hiddenYears: true }, finalizedWeeks: [{ week: 1, results: [], matchups: [],
            playerProduction: [{ entryId: '0-QB', identity: 'player:0-QB', name: '0 QB', points: 12, stats: { ...S.emptyStatLine(), passYd: 300 } }] }] };
        for (const team of league.teams) for (const player of team.roster) {
            delete player.drawnSeason; player.hiddenDecade = '2000s';
            Object.defineProperty(player, 'drawnSeason', { get() { throw new Error('A hidden assigned year was read'); } });
        }
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 0 QB').props.onChange();
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 1 QB').props.onChange();
        const tree = render('trades');
        assert(text(tree).includes('Completed Vault games · League scoring'));
        assert(text(tree).includes('Candidate archive · Reference scoring'));
        assert(text(tree).includes('Comparison unavailable'), 'Different scoring bases are not silently graded');
    });
    await test('trade names survive a later release using existing saved records, with no invented fallback identity', () => {
        league = { ...league, weekStage: 'lineup', teams: league.teams.map(team => ({ ...team, roster: team.roster.filter(player => player.entryId !== '0-QB') })),
            draftPicks: [{ entryId: '0-QB', name: 'Remembered Passer' }], trades: [{ tradeId: 'old', fromTeamId: 't1', toTeamId: 't2', status: 'accepted', week: 1,
                giveEntryIds: ['0-QB'], receiveEntryIds: ['missing-entry'], note: '' }] };
        const receipt = region(render('trades'), 'Saved trade outcome');
        assert(text(receipt).includes('Remembered Passer')); assert(text(receipt).includes('Unavailable player')); assert(!text(receipt).includes('missing-entry'));
    });
    await test('wire PTS uses committed visible Vault points, preserving zero, missing data and the playback horizon', () => {
        league = { ...league, currentWeek: 2, finalizedWeeks: [{ week: 1, matchups: [], results: [], playerProduction: [{ identity: 'player:Free-Runner', drawnSeason: 2000,
            points: 12.34, stats: { ...S.emptyStatLine(), rushYd: 123.4 } }] }] };
        const rowFor = tree => walk(tree).find(node => node.type === 'tr' && text(node).includes('Free Runner'));
        const pts = tree => walk(rowFor(tree)).find(node => node.type === 'td' && node.props.className === 'tl-waiver-points tabular');
        assert(text(pts(render())).includes('12.3'));
        assert.equal(App.TimeLeaguePlayerStats.totals(league, { identity: 'player:Free-Runner', position: 'RB', drawnSeason: 2000 }, new Map(), null, [1]).points, 12.34);
        assert(text(pts(render('waivers', { throughWeek: 0 }))).includes('0.0'), 'An unwatched saved final cannot add points to the visible column');
        league.finalizedWeeks[0].playerProduction[0].points = 0;
        assert(text(pts(render())).includes('0.0'), 'A recorded zero remains zero');
        league = { ...league, finalizedWeeks: [{ week: 1, matchups: [], results: [] }] };
        assert.equal(text(pts(render('waivers', { logIndex: null }))), '—', 'Missing past records are not presented as zero');
        assert.equal(writes.length, 0);
    });
    await test('hidden wire PTS reads public completed production without the assigned year or deck', () => {
        league = { ...league, currentWeek: 2, publicSnapshotVersion: 1, settings: { ...league.settings, hiddenYears: true }, finalizedWeeks: [{ week: 1, results: [], matchups: [],
            playerProduction: [{ editionId: 'mystery:player:Free-Runner', identity: 'player:Free-Runner', points: 9, stats: { ...S.emptyStatLine(), rushYd: 90 } }] }] };
        for (const team of league.teams) for (const player of team.roster) {
            delete player.drawnSeason; player.hiddenDecade = '2000s'; Object.defineProperty(player, 'drawnSeason', { get() { throw new Error('Private year was read for wire PTS'); } });
        }
        for (const field of ['seed', 'gameAssignments']) { delete league[field]; Object.defineProperty(league, field, { get() { throw new Error('Private deck was read for wire PTS'); } }); }
        const row = walk(render()).find(node => node.type === 'tr' && text(node).includes('Free Runner'));
        assert.equal(text(walk(row).find(node => node.type === 'td' && node.props.className === 'tl-waiver-points tabular')), '9.0'); assert.equal(writes.length, 0);
    });
    await test('trade summary shows its existing grade and signed public delta without the removed filler', () => {
        cards.get('player:0-QB').seasons[0].points = 50;
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 0 QB').props.onChange();
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 1 QB').props.onChange();
        const summary = region(render('trades'), 'Trade summary');
        const grade = walk(summary).find(node => node.props.className?.startsWith('tl-trade-value-grade'));
        const delta = walk(summary).find(node => node.props.className?.startsWith('tl-trade-point-delta'));
        assert(text(grade).includes('Value grade')); assert(text(grade).includes('A+')); assert(text(delta).includes('+50.0')); assert(text(delta).includes('reference pts'));
        assert(!text(summary).includes('If accepted')); assert(!text(render('trades')).includes('Select players below.'));
        assert(!walk(summary).some(node => node.props.role === 'progressbar'), 'Human managers do not receive an invented acceptance probability');
        assert.equal(writes.length, 0);
    });
    await test('AI acceptance bar shows only the shared deterministic current decision', () => {
        league = { ...league, teams: league.teams.map(team => team.teamId === 't2' ? { ...team, manager: 'ai', aiPersona: 'steward' } : team) };
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 0 QB').props.onChange();
        walk(render('trades')).find(node => node.props['aria-label'] === 'Select 1 QB').props.onChange();
        const before = JSON.stringify(league), expected = App.TimeLeagueAI.previewTrade(league, { fromTeamId: 't1', toTeamId: 't2', giveEntryIds: ['0-QB'], receiveEntryIds: ['1-QB'] }, cards);
        assert([0, 100].includes(expected.percent));
        const tree = render('trades'), bar = region(tree, 'AI acceptance for current terms');
        assert.equal(bar.props['aria-valuenow'], expected.percent); assert(text(tree).includes(`${expected.percent}%`)); assert(text(tree).includes('deterministic rules'));
        assert(region(tree, 'Owner DNA')); assert.equal(JSON.stringify(league), before); assert.equal(writes.length, 0);
        cards.delete('player:1-QB'); const missing = render('trades');
        assert(!region(missing, 'AI acceptance for current terms'), 'Unavailable evidence cannot become a numeric probability');
    });
    await test('an owned trade request opens and focuses the exact saved offer once without responding', () => {
        offer(); let tree = render('trades'); button(tree, 'Trade builder').props.onClick();
        const request = { leagueId: league.leagueId, teamId: 't1', tradeId: league.trades[0].tradeId, requestId: 1 };
        tree = render('trades', { tradeRequest: request }); effects.forEach(effect => effect());
        tree = render('trades', { tradeRequest: request });
        const row = walk(tree).find(node => node.props['data-trade-id'] === request.tradeId); let focused = 0;
        row.props.ref.current = { focus() { focused++; }, scrollIntoView() {} }; effects.forEach(effect => effect());
        assert.equal(focused, 1); assert(button(tree, 'Inbox · 1').props['aria-pressed']); assert.equal(writes.length, 0); assert.equal(league.trades[0].status, 'pending');
        button(tree, 'Trade builder').props.onClick(); tree = render('trades', { tradeRequest: request }); effects.forEach(effect => effect());
        assert(button(tree, 'Trade builder').props['aria-pressed'], 'A handled request cannot reopen the inbox after manual navigation');
        for (const invalid of [{ ...request, leagueId: 'wrong' }, { ...request, teamId: 't2' }, { ...request, tradeId: 'missing' }]) {
            tree = render('trades', { tradeRequest: { ...invalid, requestId: 2 } }); effects.forEach(effect => effect()); assert(button(tree, 'Trade builder').props['aria-pressed']);
        }
        league = { ...league, trades: league.trades.map(trade => ({ ...trade, status: 'rejected', note: 'Saved decision' })) };
        const settledRequest = { ...request, requestId: 3 };
        render('trades', { tradeRequest: settledRequest }); effects.forEach(effect => effect());
        tree = render('trades', { tradeRequest: settledRequest });
        walk(tree).find(node => node.props['data-trade-id'] === request.tradeId).props.ref.current = { focus() { focused++; }, scrollIntoView() {} };
        effects.forEach(effect => effect());
        assert(button(tree, 'Trade log').props['aria-pressed']); assert.equal(focused, 2, 'A new explicit request follows a settled offer into its saved history');
        assert.equal(writes.length, 0);
    });
    console.log(`PASS: ${count} acquisition UI cases; legal preflight, serial saves, queue order/fallbacks, canonical receipts, proposal/acceptance boundaries, unknown values and hidden-data independence.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
