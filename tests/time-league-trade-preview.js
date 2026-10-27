'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years', 'strategy', 'rivals', 'ai']) require(`../js/shared/time-league-${name}.js`);
const { TimeLeagueEngine: E, TimeLeagueAI: AI } = App;
const stamp = '2026-10-27T12:00:00Z';
const scoring = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
function fixture({ persona = 'steward', difficulty = 'veteran', value = 100, hidden = false } = {}) {
    const initial = E.createTimeLeague({ name: 'Preview fixture', seed: 'trade-preview', createdAt: stamp,
        seats: [{ name: 'Owner', manager: 'human' }, { name: 'Rival', manager: 'ai', aiPersona: persona }],
        settings: { hiddenYears: hidden, gameDeckVersion: hidden ? 1 : 0, aiDifficulty: difficulty, maxQuarterbacks: 1,
            rosterSlots: { RB: 1, WR: 1, BN: 1 }, regularSeasonWeeks: 12, playoffTeams: 0,
            tradesEnabled: true, scoring, eraRules: { mode: 'any-era', decades: [] } } });
    const make = (id, position, slot = position) => ({ entryId: id, editionId: `edition-${id}`, identity: id, name: id,
        position, slot, drawnSeason: 2000, hiddenDecade: '2000s', acquiredVia: 'draft', acquiredWeek: 1 });
    const state = { ...initial, phase: 'season', weekStage: 'claims', seasonsRevealed: true, yearsRevealed: !hidden,
        teams: initial.teams.map((team, i) => ({ ...team, roster: [make(`${i}-rb`, 'RB'), make(`${i}-wr`, 'WR'), make(`${i}-depth`, 'WR', 'BN')] })) };
    const cards = new Map(state.teams.flatMap(team => team.roster).map(entry => [entry.identity, { identity: entry.identity,
        name: entry.name, position: entry.position, peak: entry.entryId === '0-rb' ? value : 100,
        seasons: [2000, 2001].map(season => ({ season, games: 16, points: entry.entryId === '0-rb' ? value : 100 })) }]));
    const offer = { fromTeamId: 't1', toTeamId: 't2', giveEntryIds: ['0-rb'], receiveEntryIds: ['1-rb'] };
    return { state, cards, offer };
}
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('ok ' + name); };

test('current acceptance read matches real responses for every persona and difficulty; old outcomes stay identical', () => {
    const outcomes = [];
    for (const persona of E.AI_PERSONA_IDS) for (const difficulty of ['rookie', 'veteran', 'allpro']) for (const value of [50, 100, 160]) {
        const { state, cards, offer } = fixture({ persona, difficulty, value });
        const before = JSON.stringify(state), read = AI.previewTrade(state, offer, cards);
        assert([0, 100].includes(read.percent));
        assert.equal(JSON.stringify(state), before, 'Browsing cannot file or resolve an offer');
        const proposed = E.proposeTrade(state, offer, stamp);
        const actual = AI.aiRespondToTrades(proposed, cards, stamp);
        assert.equal(actual.trades[0].status, read.percent === 100 ? 'accepted' : 'rejected');
        outcomes.push(JSON.stringify(actual));
    }
    assert.equal(outcomes.length, 108);
    // Captured by running this exact fixture matrix against 279131f's AI
    // (source SHA256 5e88ee8663d7a49cb265874d89506f6dbfcafa23060330992202b1431ab5b68d).
    // Pin complete response/note/roster/activity bytes without requiring Git
    // history in a shallow CI checkout or shipping a second AI implementation.
    assert.equal(createHash('sha256').update(outcomes.join('\n')).digest('hex'),
        '232f89e0a681603382cd42b9d7030af0599ec5fd218f9f28a24183865dbeb3ce', 'Saved trade behavior changed from the established rule');
});

test('invalid, missing, closed, human and deferred packages do not invent an acceptance percentage', () => {
    const { state, cards, offer } = fixture();
    const noRead = (game, row, data = cards) => assert.equal(AI.previewTrade(game, row, data).percent, null);
    noRead(state, { ...offer, giveEntryIds: [] });
    noRead(state, { ...offer, giveEntryIds: ['0-rb', '0-rb'], receiveEntryIds: ['1-rb', '1-rb'] });
    noRead(state, { ...offer, giveEntryIds: ['gone'] });
    noRead(state, { ...offer, receiveEntryIds: ['1-wr'] });
    noRead(state, { ...offer, deferredUntilWeek: 2 });
    noRead(state, { ...offer, status: 'accepted' });
    noRead({ ...state, weekStage: 'ready' }, offer);
    noRead({ ...state, weekStage: 'postgame' }, offer);
    noRead({ ...state, phase: 'complete' }, offer);
    noRead({ ...state, settings: { ...state.settings, tradesEnabled: false } }, offer);
    noRead({ ...state, teams: state.teams.map(team => ({ ...team, manager: 'human' })) }, offer);
    noRead(state, offer, new Map());
    noRead(state, offer, new Map([...cards].map(([id, card]) => [id, { ...card, seasons: card.seasons.map(season => ({ ...season, points: null })) }])));
});

test('hidden-year acceptance reads only known archive/observations, never the assigned edition or future deck', () => {
    const { state, cards, offer } = fixture({ hidden: true, value: 160 });
    const before = AI.previewTrade(state, offer, cards);
    let reads = 0;
    const fail = () => { reads++; throw Error('Sealed field read by acceptance preview'); };
    for (const team of state.teams) for (const entry of team.roster) {
        for (const key of ['drawnSeason', 'gameDeck', 'gameRefs', 'futureGames']) Object.defineProperty(entry, key, { enumerable: true, get: fail });
    }
    for (const key of ['seed', 'gameDecks', 'futureResults']) Object.defineProperty(state, key, { enumerable: false, get: fail });
    assert.deepEqual(AI.previewTrade(state, offer, cards), before);
    assert.equal(reads, 0);
    const publicState = { ...state, teams: state.teams.map(team => ({ ...team, roster: team.roster.map(entry => ({
        entryId: entry.entryId, editionId: entry.editionId, identity: entry.identity, name: entry.name,
        position: entry.position, slot: entry.slot, hiddenDecade: entry.hiddenDecade,
    })) })) };
    assert.deepEqual(AI.previewTrade(publicState, offer, cards), before);
    assert.equal(reads, 0);
});

test('preview observes the same difficulty, rivalry and current public production as the actual rule', () => {
    const { state, cards, offer } = fixture({ hidden: true, value: 100 });
    let changed = state;
    for (let i = 0; i < 3; i++) changed = App.TimeLeagueRivals.sendMessage(changed, {
        teamId: 't1', toTeamId: 't2', text: 'A competitive message', tone: 'competitive', messageId: `preview-message-${i}`,
    }, stamp);
    assert.equal(AI.previewTrade(changed, offer, cards).percent, AI.aiRespondToTrades(E.proposeTrade(changed, offer, stamp), cards, stamp).trades[0].status === 'accepted' ? 100 : 0);
    const observed = { ...changed, currentWeek: 2, finalizedWeeks: [{ week: 1, results: [], matchups: [],
        playerProduction: changed.teams.flatMap(team => team.roster).map(entry => ({ editionId: entry.editionId, entryId: entry.entryId,
            points: entry.entryId === '0-rb' ? 20 : 5, stats: { rushYd: entry.entryId === '0-rb' ? 200 : 50 } })) }] };
    const read = AI.previewTrade(observed, offer, cards), resolved = AI.aiRespondToTrades(E.proposeTrade(observed, offer, stamp), cards, stamp);
    assert.equal(read.percent, resolved.trades[0].status === 'accepted' ? 100 : 0);
});
console.log(`PASS ${passed} trade-preview integrity groups; 108 old/new response parity fixtures`);
