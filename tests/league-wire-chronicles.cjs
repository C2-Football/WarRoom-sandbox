'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = { console }; root.window = root;
vm.createContext(root);
for (const file of ['league-live-scores', 'league-live-table', 'league-wire-chronicles-data', 'league-wire-chronicles', 'league-wire-journal']) vm.runInContext(fs.readFileSync(`js/shared/${file}.js`, 'utf8'), root);
const one = { league_id: '1356311207652360192', season: '2026', settings: { playoff_week_start: 15 }, rosters: [{ roster_id: 1, owner_id: '510866780064288768' }, { roster_id: 2, owner_id: '511343705642745856' }] };
const make = (league = one, extra = {}) => root.WrWireStories.build({ league, weeks: [], end: 0, nameFor: rid => `Current ${rid}`, ...extra });
const book = make();
assert(book.chronicle);
assert.equal(book.high, null, 'documentary scores do not change regular-season highs');
assert.equal(book.rivals.length, 0, 'championships are not regular-season rivalry wins');
assert(book.stories.some(s => /back-to-back titles/.test(s.text) && /Malcolm/.test(s.text)));
assert(book.stories.some(s => /Spencer.*2012 title/.test(s.text)));
assert(!book.stories.some(s => /Chelsea.*2015 title/.test(s.text)), 'uncertain winner withheld');
assert(book.stories.every(s => s.sources.length && s.eventSeason < 2026));
const old = make({ ...one, season: '2023' });
assert(old.stories.every(s => s.eventSeason < 2023), 'no later or same-season title/award leaks');
assert(!old.stories.some(s => /Malcolm Wohler’s back-to-back/.test(s.text)));
const renamed = make({ ...one, league_id: 'new-league', previous_league_id: one.league_id });
assert(renamed.chronicle, 'verified direct renewal inherits archive');
const other = make({ ...one, league_id: 'unrelated', name: 'CTB The One - Year 15' });
assert(!other.chronicle, 'name spoof does not select an archive');
const board = { week: 1, rows: [{ roster_id: 1, points: 0, matchup_id: 1 }, { roster_id: 2, points: 0, matchup_id: 1 }] };
const matchup = make(one, { board });
const rematch = matchup.previews.find(s => s.id.startsWith('title-rematch:'));
assert(rematch && /2024 final/.test(rematch.body));
assert(rematch.related.some(r => /2023 final/.test(r.text)), 'earlier finals remain available as context');
assert(!/Source:|winners_bracket|separate from/.test(rematch.body), 'provenance stays out of the story prose');
assert(rematch.sources.length && rematch.related.some(r => /separate from the regular-season/.test(r.text)), 'sources and scope remain attached');
const replacement = make({ ...one, rosters: [{ roster_id: 1, owner_id: 'replacement' }, one.rosters[1]] }, { board });
assert(!replacement.previews.some(s => s.id.startsWith('title-rematch:')), 'slot replacement never inherits titles');
const played = make(one, { end: 1, weeks: [{ week: 1, rows: [{ roster_id: 1, points: 100, matchup_id: 1 }, { roster_id: 2, points: 90, matchup_id: 1 }] }] });
assert(played.stories.find(s => s.kind === 'recap').related.some(r => r.label === 'Championship history'));
assert.equal(played.high, 100);
assert.equal(played.table[0].wins, 1);
const psycho = { ...one, league_id: '1312100327931019264', rosters: [{ roster_id: 1, owner_id: '540392203863576576' }, { roster_id: 2, owner_id: '919791788930527232' }] };
const pb = make(psycho);
assert(pb.stories.some(s => /TWhy123.*2025 title/.test(s.text)), 'missing Psycho title filled from bracket');
assert(!pb.stories.some(s => /Steve Crusinberry/.test(s.text)), 'same account remains league-scoped');
const corrected = pb.chronicle.finals.find(f => f.season === 2023);
assert.equal(corrected.scores[0], 222.14);
assert.equal(corrected.originalScores[0], 222.18);
assert.equal(corrected.reconciliation, 'score-correction');
assert(pb.stories.some(s => s.related.some(r => /workbook recorded/.test(r.text))));
assert.equal(pb.chronicle.records.length, 10);
assert.equal(pb.chronicle.records.find(f => f.season === 2025 && f.award === 'SEASON POINTS LEADER').observed.value, 3233.56);
assert(pb.stories.some(s => s.text.includes('2025 manager of the year') && s.rosterIds.includes(1)), 'same-season explicit award alias maps manager honors');
assert(!make({ ...psycho, season: '2025' }).chronicle.finals.some(f => f.season === 2025));
assert(!make({ ...psycho, season: '2025' }).chronicle.records.some(f => f.season === 2025));
const input = JSON.stringify(root.WrWireChroniclesData);
make(one); make(psycho); make({ ...one, season: '2021' });
assert.equal(JSON.stringify(root.WrWireChroniclesData), input, 'editions do not mutate shared facts');
assert(fs.readFileSync('index.html', 'utf8').indexOf('league-wire-chronicles.js') < fs.readFileSync('index.html', 'utf8').indexOf('league-wire-journal.js'));
console.log('PASS Wire chronicles: league identity, owner replacement, overlap, original scores, title supplements, episode cutoffs, rematches and recap context');

const current = make(one, { end: 2, weeks: [1, 2].map(week => ({ week, rows: [{ roster_id: 1, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 1, points: 100 }] })) });
const titleWatch = current.stories.find(s => s.contextual);
assert(titleWatch && !titleWatch.documentary && /get back to championship form/.test(titleWatch.text));
assert.match(titleWatch.body, /0–2 through Week 2/);
assert.match(titleWatch.body, /2024.*2023/);
assert.equal(titleWatch.week, 2);
assert(titleWatch.sources.length > 0 && titleWatch.rosterIds.includes(1));
assert(!make(one).stories.some(s => s.contextual), 'no current record means no form-based title story');
const gap = make(one, { end: 2, weeks: [{ week: 1, rows: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 90 }] }] });
assert(!gap.stories.some(s => s.contextual), 'missing weeks cannot be presented as current form');
const defense = make({ ...one, season: '2025' }, { end: 1, weeks: [{ week: 1, rows: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 90 }] }] });
assert(defense.stories.some(s => s.contextual && /3 titles in a row/.test(s.text)));
assert(!defense.stories.some(s => s.contextual && /2025 title/.test(s.body)), 'the title defense does not know future honors');
const replacementCurrent = make({ ...one, rosters: [{ roster_id: 1, owner_id: 'replacement' }, one.rosters[1]] }, { end: 1, weeks: [{ week: 1, rows: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 90 }] }] });
assert(!replacementCurrent.stories.some(s => s.contextual && s.rosterIds.includes(1)), 'replacement owners do not inherit a title pedigree');
assert(root.WrWireStories.frontPage(current.stories).every(s => !s.documentary));
assert(root.WrWireStories.weeklyLookback(current.stories, '2026:2').documentary);
console.log('PASS current title context: season cutoff, current results, title defense, missing weeks and owner continuity');

const contextualRematch = make(one, {
    end: 2,
    weeks: [1, 2].map(week => ({ week, rows: [{ roster_id: 1, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 1, points: 100 }] })),
    board: { ...board, week: 3 },
    rivalries: [{ owners: one.rosters.map(r => r.owner_id), name: 'The Finals Feud' }],
});
assert.equal(contextualRematch.previews.length, 1, 'current rivalry and historical final produce one story, not two headlines for the same matchup');
assert.match(contextualRematch.previews[0].text, /^The Finals Feud:/, 'championship enrichment preserves a personally named rivalry');
assert.match(contextualRematch.previews[0].body.split('\n\n')[0], /Through Week 2, Current 1 are 0–2 and Current 2 are 2–0/);
assert.equal(contextualRematch.previews[0].formThrough, 2);
assert(contextualRematch.previews[0].related.some(r => r.label === 'Championship history' && /2024 final/.test(r.text)));
assert.match(titleWatch.body.split('\n\n')[0], /Current 1 are 0–2/);
assert(!/2024|2023/.test(titleWatch.body.split('\n\n')[0]), 'current title-watch deck leads with this season, with championship history in a separate paragraph');
const medianTitle = make({ ...one, settings: { ...one.settings, league_average_match: 1 } }, {
    end: 1, weeks: [{ week: 1, rows: [{ roster_id: 1, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 1, points: 100 }] }],
}).stories.find(s => s.contextual && s.rosterIds.includes(1));
assert.match(medianTitle.body, /0–2 through Week 1, including median results/);
console.log('PASS championship newsroom context: present-first paragraphs, median scope and one preview per matchup');
