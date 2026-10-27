// ══════════════════════════════════════════════════════════════════
// js/components/time-league-team-panel.js — window.WrTimeLeagueTeamPanel
// Personal roster/lineup, waivers, and trades sections. Ported from
// The Duat's app/TimeLeagueTeamCenter.tsx.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo, useState } = React;
    const h = React.createElement;

    const Roster = window.App.TimeLeagueRoster;
    const AI = window.App.TimeLeagueAI;
    const Engine = window.App.TimeLeagueEngine;
    const Season = window.App.TimeLeagueSeason;
    const UI = window.App.TimeLeagueUI;

    const STARTER_SLOTS = Roster.ROSTER_SLOT_IDS.filter((slot) => Season.isStarterSlot(slot));
    const RESERVE_SLOTS = ['IR'];
    const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const WIRE_ROW_CAP = 60;

    const fmt1 = (value) => value.toFixed(1);
    const nowIso = () => new Date().toISOString();
    const cardSeasonPoints = (cards, entry) => cards.get(entry.identity)?.seasons.find((s) => s.season === entry.drawnSeason)?.points ?? 0;

    // Identification uses the same public, viewer-capped candidate list as the
    // research drawer. Missing records cannot eliminate candidates; an empty
    // match never falls back to the original pool, even if that pool was singular.
    const identifiedYearFromRead = (league, read) => league?.settings?.hiddenYears && league.seasonsRevealed && !league.yearsRevealed
        && read?.candidateYears?.length === 1 && Number.isInteger(read.candidateYears[0]) ? read.candidateYears[0] : null;
    function identifiedYear(league, entry, cards, logIndex, eraFactors, throughWeek) {
        if (!league?.settings?.hiddenYears || !league.seasonsRevealed || league.yearsRevealed || !entry?.identity) return null;
        return identifiedYearFromRead(league, window.App.TimeLeagueHiddenYears?.read(league, entry, cards, logIndex, throughWeek, eraFactors));
    }
    function yearLabel(league, entry, cards, logIndex, eraFactors, throughWeek) {
        const year = identifiedYear(league, entry, cards, logIndex, eraFactors, throughWeek);
        return year == null ? window.App.TimeLeagueHiddenYears?.label(league, entry, cards) ?? 'Hidden year' : String(year);
    }
    window.WrTimeLeagueIdentifiedYear = identifiedYear;
    window.WrTimeLeagueYearLabel = yearLabel;

    const scoutingRead = (league, entry, cards, logIndex, eraFactors, throughWeek) =>
        window.App.TimeLeaguePlayerStats?.scouting?.(league, entry, cards, logIndex, eraFactors, throughWeek)
        || window.App.TimeLeaguePlayerStats?.signals?.(league, entry, logIndex, eraFactors, throughWeek)
        || { average: null, games: null, currentStars: null, currentAvailable: null, status: league.seasonsRevealed ? 'unavailable' : 'sealed' };
    const remainingLabel = read => read.remainingEstimated ? 'Est. pts left' : 'Pts left';
    const remainingTitle = read => read.remainingEstimated
        ? 'Estimated points left, based on the available archive or completed-game pace. Future game assignments remain sealed.'
        : 'Points in the unused historical game pool, using league scoring. The Vault draws without repeats; some games may fall outside this Vault season.';

    // The same completed-game denominator and current-week clue travel with a
    // player through the roster, replacement chooser, and free-agent wire.
    function PlayerSignals({ league, entry, cards, logIndex, eraFactors, throughWeek, className = '', read: suppliedRead, omitRemaining = false }) {
        const read = suppliedRead || scoutingRead(league, entry, cards, logIndex, eraFactors, throughWeek);
        const research = league.settings.hiddenYears && !league.yearsRevealed ? window.App.TimeLeagueHiddenYears?.read(league, entry, cards, logIndex, throughWeek, eraFactors) : null;
        const year = identifiedYearFromRead(league, research);
        const estimated = read.average == null && Number.isFinite(research?.estimatedAverage);
        const average = Number.isFinite(read.average) ? fmt1(read.average) : estimated ? fmt1(research.estimatedAverage) : '—';
        const averageLabel = estimated ? year == null ? 'Across possible years' : `${year} archive` : read.status === 'sealed' ? 'Sealed edition' : read.games === 0 ? 'No games yet' : read.games == null ? 'Stats unavailable' : `${read.games} game${read.games === 1 ? '' : 's'}`;
        const averageTitle = estimated
            ? `Archive estimate ${year == null ? 'across the possible years' : `for the identified ${year} season`}. ${research.candidates.every(row => row.basis === 'league scoring') ? 'Your league scoring' : 'Reference scoring'}; no completed Vault games yet.`
            : `Average points per recorded completed Vault game in your league scoring, including bench games and observed games before acquisition. ${averageLabel}.`;
        const averageBasis = estimated ? `Archive estimate · ${research.candidates.every(row => row.basis === 'league scoring') ? 'League scoring' : research.candidates.every(row => row.basis === 'reference scoring') ? 'Reference scoring' : 'Mixed scoring'}` : 'Completed games · League scoring';
        let outlook = 'Unavailable', outlookLabel = `W${league.currentWeek} game rating`, outlookTitle = 'The current game report is unavailable.';
        if (read.status === 'sealed') { outlook = 'Sealed'; outlookTitle = 'Game ratings open after the season reveal.'; }
        else if (read.status === 'complete') { outlook = 'Complete'; outlookLabel = 'Vault season'; outlookTitle = 'This Vault season is complete.'; }
        else if (read.status === 'awaiting-week') { outlook = 'Awaiting next week'; outlookTitle = 'Advance the week to reveal its availability and game rating.'; }
        else if (read.currentAvailable === false) { outlook = 'No recorded game'; outlookLabel = `W${league.currentWeek} · 0 pts`; outlookTitle = 'No recorded game this Vault week: zero points. Later weeks remain sealed.'; }
        else if (read.currentStars != null) {
            outlook = '★'.repeat(read.currentStars) + '☆'.repeat(5 - read.currentStars);
            outlookTitle = `${read.currentStars} of 5 stars this week. Stars rank this game within the player’s historical season; they are not a probability.`;
        } else if (read.currentAvailable === true) { outlook = 'Game available'; outlookTitle = 'A recorded game is available this week; its rating is unavailable.'; }
        return h('span', { className: `tl-player-signals ${className}`.trim(), 'data-signal-kind': estimated ? 'estimate' : 'observed' },
            h('span', { className: 'tl-player-average', title: averageTitle },
                h('small', { className: 'tl-signal-label-full' }, estimated ? 'Archive est. / game' : 'Avg pts / game'),
                h('strong', { className: 'tabular' }, average),
                h('small', { className: 'tl-signal-label-compact' }, estimated ? 'Est. PPG' : 'PPG'),
                h('small', { className: `tl-player-signal-context${estimated ? ' is-estimate-context' : ''}` }, averageLabel),
                (Number.isFinite(read.average) || estimated) && h('small', { className: 'tl-decision-basis' }, averageBasis)),
            h('span', { className: `tl-player-outlook${read.currentAvailable === false ? ' no-game' : ''}`, title: outlookTitle },
                h('small', { className: 'tl-outlook-label' }, outlookLabel), h('strong', { className: 'tl-week-stars', 'aria-label': outlookTitle }, outlook),
                read.currentStars != null && read.currentAvailable === true && h('small', { className: 'tl-player-signal-context' }, `${read.currentStars}/5 · this week`),
                research && year == null && h('small', { className: 'tl-player-signal-context tl-signal-candidates' }, `${research.candidateYears.length} possible years`)),
            !omitRemaining && h('span', { className: 'tl-player-remaining', title: remainingTitle(read) },
                h('small', { className: 'tl-signal-label-full' }, read.remainingEstimated ? remainingLabel(read) : 'Unused archive pts'),
                h('strong', null, Number.isFinite(read.remainingPoints) ? fmt1(read.remainingPoints) : '—'),
                h('small', { className: 'tl-signal-label-compact' }, read.remainingEstimated ? remainingLabel(read) : 'Unused archive pts')));
    }

    function SeasonGameTable({ entry, rows, label = 'Historical season games', historical = true }) {
        const keys = entry.position === 'QB' ? [['passYd','Pass yd'],['passTd','Pass TD'],['passInt','INT'],['rushYd','Rush yd'],['rushTd','Rush TD']]
            : entry.position === 'RB' ? [['rushYd','Rush yd'],['rushTd','Rush TD'],['rec','Rec'],['recYd','Rec yd'],['recTd','Rec TD']]
                : entry.position === 'K' ? [['fgm','FG made'],['fgmiss','FG missed'],['xpm','XP made'],['xpmiss','XP missed']]
                    : ['DEF', 'DST'].includes(entry.position) ? [['sack','Sacks'],['int','INT'],['fr','Fum rec'],['def_td','Def TD'],['def_st_td','ST TD'],['safe','Safety']]
                : [['rec','Rec'],['recYd','Rec yd'],['recTd','Rec TD'],['rushYd','Rush yd'],['rushTd','Rush TD']];
        const opponents = rows.some(row => row.opponent);
        return h('div', { className: 'tl-season-game-scroll', role: 'region', tabIndex: 0, 'aria-label': label },
            h('table', { className: 'tl-season-game-table' },
                h('caption', null, label),
                h('thead', null, h('tr', null, [historical ? 'NFL Wk' : 'Vault Wk','Points',...(opponents ? ['Opp'] : []),...keys.map(([, title]) => title)].map(title => h('th', { key: title, scope: 'col' }, title)))),
                h('tbody', null, rows.map((row, i) => {
                    const stats = { ...row.stats, ...row.stats?.extra };
                    return h('tr', { key: row.historicalWeek ?? row.week ?? i, className: row.observed ? 'is-observed' : '' },
                        h('th', { scope: 'row' }, `W${row.historicalWeek ?? row.week}`, row.observed && h('small', null, 'Matched')),
                        h('td', { className: 'tl-season-game-points' }, Number.isFinite(row.points) ? fmt1(row.points) : '—'),
                        opponents && h('td', null, row.opponent || '—'),
                        keys.map(([key]) => h('td', { key }, Number.isFinite(stats[key]) ? stats[key] : '—')));
                }))));
    }

    function HiddenYearResearch({ league, entry, cards, logIndex, eraFactors, throughWeek }) {
        const H = window.App.TimeLeagueHiddenYears;
        if (!H) return null;
        const read = H.read(league, entry, cards, logIndex, throughWeek, eraFactors);
        const year = identifiedYearFromRead(league, read);
        const fields = entry.position === 'QB' ? [['passYd', 'Pass yd'], ['passTd', 'Pass TD'], ['passInt', 'INT'], ['rushYd', 'Rush yd']]
            : [['rushYd', 'Rush yd'], ['rushTd', 'Rush TD'], ['rec', 'Rec'], ['recYd', 'Rec yd'], ['recTd', 'Rec TD']];
        const statGrid = stats => h('div', { className: 'tl-archive-stats' },
            Object.entries({ ...stats, ...stats?.extra }).filter(([key, value]) => key !== 'extra' && typeof value === 'number').map(([key, value]) =>
                h('div', { className: 'tl-archive-stat', key }, h('small', null, fields.find(([id]) => id === key)?.[1] || key), h('strong', null, value))));
        return h('section', { className: 'tl-hidden-year-research', 'aria-label': `${entry.name || 'Player'} hidden-year research` },
            h('h3', null, year == null ? `${read.decade || 'Eligible'} archive · ${read.candidateYears.length} possible year${read.candidateYears.length === 1 ? '' : 's'}` : String(year)),
            h('p', { className: 'tl-hint' }, year == null ? 'Your player has one fixed year. Its games are shuffled without repeats. Compare the completed stat lines with the candidate seasons; an exact match can identify a year early.'
                : `${year} is the only year matching the public archive and visible completed games. Games are still shuffled without repeats; their future order remains sealed.`),
            !read.evidenceComplete && h('p', { className: 'tl-hint' }, 'Complete game records are not available for every candidate. Missing records never rule a year out.'),
            !read.candidates.length && h('p', { role: 'status', className: 'tl-hint' }, 'No candidate in the loaded archive matches every recorded game. The evidence may be incomplete; no replacement year has been invented.'),
            h('div', { className: 'tl-hidden-year-candidates' }, read.candidates.map(row => {
                const archive = logIndex ? Season.sourceGames({ identity: entry.identity, drawnSeason: row.season }, Season.dataIndexFor(league, logIndex)) : [];
                return h('details', { key: row.season },
                h('summary', null, `${row.season} · ${row.average == null ? '—' : fmt1(row.average)} pts/game · ${row.games ?? '—'} recorded games`),
                h('p', { className: 'tl-hint' }, `${Number.isFinite(row.points) ? fmt1(row.points) : 'Unavailable'} season points · ${row.basis}. ${year == null ? 'This is a possible historical season, not your confirmed year.' : 'This is your identified historical season; future Vault game assignments remain sealed.'}`),
                h('div', { className: 'tl-archive-stats' }, fields.filter(([key]) => row[key] != null).map(([key, label]) => h('div', { className: 'tl-archive-stat', key }, h('small', null, label), h('strong', null, row[key])))),
                archive.length > 0 && h('details', { className: 'tl-candidate-game-archive', open: year === row.season }, h('summary', null, `${row.season} game archive · ${archive.length} records`),
                    h('p', { className: 'tl-hint' }, 'Historical NFL weeks for this candidate season. They do not disclose your shuffled Vault order.'),
                    h(SeasonGameTable, { entry, label: `${row.season} NFL game log`, rows: archive.map(game => ({ ...game, points: row.basis === 'league scoring' ? Math.round(Season.scoreStatLine(game.stats, league.settings.scoring, Season.REFERENCE_EXTENDED_SCORING) * (league.settings.eraAdjusted ? Season.eraFactorFor(eraFactors, row.season, entry.position) : 1) * 100) / 100 : null })) })));
            })),
            h('h3', null, 'Completed game log'),
            !read.observed.length ? h('p', { className: 'tl-hint' }, 'The first completed game begins your trail of evidence.') :
                h('div', { className: 'tl-hidden-year-game-log' }, read.observed.map(row => h('details', { key: row.week },
                    h('summary', null, `Vault W${row.week} · ${fmt1(row.points)} pts${row.available ? '' : ' · No recorded game'}`),
                    row.available ? statGrid(row.stats)
                        : h('p', { className: 'tl-hint' }, 'No recorded game scored zero. This does not establish an injury or a historical calendar date.')))));
    }
    window.WrTimeLeagueHiddenYearResearch = HiddenYearResearch;

    function PlayerScoutingCard({ league, entry, cards, archiveCards, logIndex, eraFactors, throughWeek, onClose, onMove }) {
        const [chosenTab, setChosenTab] = useState(null);
        const read = scoutingRead(league, entry, cards, logIndex, eraFactors, throughWeek);
        const weeklyAdvice = read.status === 'ready' && read.currentAvailable === false
            ? { title: 'Bench this week', detail: `No recorded game in Vault W${league.currentWeek}: this player will score zero. Use an eligible alternative with a game.`, basis: 'Confirmed current-week availability' }
            : read.status === 'ready' && read.currentAvailable === true
                ? { title: read.currentStars >= 4 ? 'Strong game clue' : read.currentStars != null && read.currentStars <= 2 ? 'Check your alternatives' : read.currentStars === 3 ? 'Mid-range game clue' : 'Game available',
                    detail: read.currentStars != null ? `${read.currentStars}/5 ranks this game within the player’s own historical season. Compare completed-game PPG with your other starters; stars do not compare player strength.` : 'A recorded game is available. Its rating is unavailable, so compare completed-game PPG and your legal lineup options.',
                    basis: `Vault W${league.currentWeek} · current public game report` }
                : { title: read.status === 'complete' ? 'Season complete' : read.status === 'sealed' ? 'Game clue sealed' : 'Awaiting a current game clue',
                    detail: read.status === 'complete' ? 'There are no remaining lineup decisions in this Vault season.' : 'A start or bench recommendation needs this week’s public availability report. Completed-game averages remain historical evidence.',
                    basis: 'No current-week recommendation' };
        const concealed = league.settings.hiddenYears && !league.yearsRevealed;
        const year = league.seasonsRevealed ? concealed ? read.identifiedYear ?? identifiedYear(league, entry, cards, logIndex, eraFactors, throughWeek) : entry.drawnSeason : null;
        const tab = chosenTab || (year == null ? 'research' : 'season');
        const card = (archiveCards || cards)?.get(entry.identity);
        const selectedSeason = year != null ? card?.seasons.find(row => row.season === year) : null;
        const legacyReference = league.settings.gameDeckVersion !== 1 && selectedSeason?.sourceWeekKind;
        const archive = legacyReference && logIndex ? Season.sourceGames({ identity: entry.identity, drawnSeason: year }, logIndex).map(game => ({ ...game,
            points: league.settings.eraAdjusted && !eraFactors?.size ? null : Math.round(Season.scoreStatLine(game.stats, league.settings.scoring, Season.REFERENCE_EXTENDED_SCORING) * (league.settings.eraAdjusted ? Season.eraFactorFor(eraFactors, year, entry.position) : 1) * 100) / 100 })) : read.archive || [];
        const rating = !concealed && year != null && read.status === 'ready' ? Season.weeklyStarOutlook(entry, league.currentWeek, Engine.seasonEndWeek(league), logIndex, league.settings.scoring, league.settings.eraAdjusted ? eraFactors : null, league) : null;
        const stat = (label, value) => h('div', { className: 'tl-archive-stat', key: label }, h('small', null, label), h('strong', null, value));
        const completed = concealed ? window.App.TimeLeagueHiddenYears?.observationRows(league, entry, throughWeek) || []
            : (window.App.TimeLeaguePlayerStats?.completedWeeks(league, throughWeek) || []).filter(week => week < league.currentWeek).map(week => {
                const saved = Season.completedProduction(league, entry, week);
                const game = (!saved || !Object.hasOwn(saved, 'stats')) && logIndex ? Season.resolveGameLog(league, entry, week, logIndex, Engine.seasonEndWeek(league)) : null;
                return { week, stats: saved?.stats ?? game?.stats, points: saved ? Number.isFinite(saved.points) ? saved.points : null : game ? Season.gamePoints(league, entry, game, league.settings.scoring, league.settings.eraAdjusted ? eraFactors : null) : null };
            });
        const history = Number.isInteger(year) && card ? window.App.TimeLeaguePlayerCards.beforeSeason(card, year) : null;
        const fields = [['College', card?.bio?.college], ['Born', card?.bio?.birthDate], ['Size', [card?.bio?.height, card?.bio?.weight].filter(Boolean).join(' · ')], ['NFL draft', [card?.bio?.draftYear, card?.bio?.draftTeam].filter(Boolean).join(' · ')]].filter(([, value]) => value);
        return h(React.Fragment, null,
            h('div', { className: 'tl-dossier-kicker' }, 'THE VAULT · SCOUTING REPORT'),
            h('div', { className: 'tl-dossier-title' }, h('span', { className: `tl-pos-badge tl-pos-${entry.position}` }, entry.position),
                h('div', null, h('h2', null, entry.name), h('strong', { className: `tl-scouting-year${year != null ? ' is-known' : ''}` }, year ?? (league.seasonsRevealed ? yearLabel(league, entry, cards, logIndex, eraFactors, throughWeek) : 'Sealed edition'))),
                h('button', { type: 'button', className: 'tl-btn', onClick: onClose, 'aria-label': 'Close player history' }, 'Close')),
            h(PlayerSignals, { league, entry, cards, logIndex, eraFactors, throughWeek, className: 'tl-dossier-signals' }),
            h('section', { className: 'tl-lineup-guidance', 'aria-label': 'Start or bench guidance' },
                h('strong', null, weeklyAdvice.title), h('p', null, weeklyAdvice.detail), h('small', null, weeklyAdvice.basis),
                onMove && read.status === 'ready' && (read.currentAvailable === false || read.currentStars != null && read.currentStars <= 2) && h('button', {
                    type: 'button', className: 'tl-btn', 'aria-label': `Review lineup options for ${entry.name}`, onClick: onMove,
                }, 'Compare replacements')),
            h('div', { className: 'tl-scouting-season-meta' },
                h('span', null, `${Number.isFinite(read.points) ? fmt1(read.points) : '—'} YTD pts`),
                h('span', null, `${Math.max(0, Engine.seasonEndWeek(league) - league.currentWeek + 1)} Vault weeks left`),
                Number.isFinite(read.remainingGames) && h('span', null, `${read.remainingGames} archive games left`)),
            h('nav', { className: 'tl-player-card-tabs', 'aria-label': 'Player report views' },
                [['season', 'Season games'], ['vault', 'Vault games'], ...(concealed ? [['research', 'Year clues']] : [])].map(([id, label]) => h('button', { key: id, type: 'button', disabled: !league.seasonsRevealed, 'aria-pressed': tab === id, onClick: () => setChosenTab(id) }, label))),
            !league.seasonsRevealed && h('p', { className: 'tl-hint' }, 'Your edition is sealed. Season-specific history unlocks at the reveal.'),
            league.seasonsRevealed && tab === 'season' && h('section', { className: 'tl-player-card-section', 'aria-label': 'Season games' },
                year == null ? h('p', { className: 'tl-hint' }, 'The year is still hidden. Open Year clues to compare the possible seasons.')
                    : h(React.Fragment, null,
                        h('div', { className: 'tl-player-card-section-heading' }, h('h3', null, `${year} season`), h('span', null, `${archive.length} recorded games`)),
                        h('p', { className: 'tl-hint' }, league.settings.gameDeckVersion === 1 ? 'Historical NFL weeks · league scoring. Your Vault draws these games in a shuffled order.' : 'Historical game archive · league scoring. This saved league plays its original weeks 1–14.'),
                        archive.length ? h(SeasonGameTable, { entry, rows: archive, label: `${entry.name} · ${year} NFL season games` }) : h('p', { role: 'status', className: 'tl-hint' }, 'Season game records are not available yet.'),
                        h('p', { className: 'tl-hint tl-scouting-pool-note' }, remainingTitle(read)),
                        read.playableRemainingEstimated && Number.isFinite(read.playableRemaining) && h('p', { className: 'tl-hint' }, `Estimated return over the remaining ${read.remainingWeeks} Vault weeks: ${fmt1(read.playableRemaining)} points.`))),
            league.seasonsRevealed && tab === 'vault' && h('section', { className: 'tl-player-card-section', 'aria-label': 'Completed Vault games' },
                h('h3', null, 'Completed Vault games'),
                h('p', { className: 'tl-hint' }, 'Only games you have reached are shown. Future weeks stay sealed.'),
                completed.length ? h(SeasonGameTable, { entry, rows: completed, historical: false, label: 'Completed Vault game log' }) : h('p', { className: 'tl-hint' }, 'No completed games yet.')),
            league.seasonsRevealed && tab === 'research' && h(HiddenYearResearch, { league, entry, cards, logIndex, eraFactors, throughWeek }),
            (fields.length > 0 || history?.seasons.length > 0 || selectedSeason) && h('details', { className: 'tl-player-background' }, h('summary', null, 'Player background & earlier seasons'),
                selectedSeason && h('div', { className: 'tl-archive-stats tl-archive-season-scope' },
                    stat(selectedSeason.sourceWeekKind ? 'Recorded GP' : 'Archive GP · W1–14', selectedSeason.recordedGames ?? selectedSeason.games),
                    Number.isFinite(selectedSeason.scheduledGames) && stat('NFL schedule', `${selectedSeason.scheduledGames} games`),
                    legacyReference && stat('Full NFL season', `${fmt1(selectedSeason.points)} pts`),
                    legacyReference && stat('Legacy Vault · W1–14', Number.isFinite(cards.get(entry.identity)?.seasons.find(row => row.season === year)?.points) ? `${fmt1(cards.get(entry.identity).seasons.find(row => row.season === year).points)} pts` : 'Unavailable'),
                    stat('Vault season', `${Engine.seasonEndWeek(league)} weeks`)),
                rating?.maxRemainingStars != null && h('p', { className: 'tl-hint' }, `Archive ceiling: ${rating.maxRemainingStars} stars. Best unused archived game; it may fall outside this Vault season.`),
                fields.length > 0 && h('dl', { className: 'tl-player-bio-list' }, fields.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value)))),
                history?.seasons.length > 0 && h('div', { className: 'tl-season-game-scroll', role: 'region', tabIndex: 0, 'aria-label': 'Earlier seasons' },
                    h('table', { className: 'tl-season-game-table' }, h('caption', null, 'Earlier seasons · reference scoring'),
                        h('thead', null, h('tr', null, ['Year', 'Games', 'Points', 'PPG'].map(label => h('th', { key: label, scope: 'col' }, label)))),
                        h('tbody', null, history.seasons.slice().reverse().map(row => h('tr', { key: row.season }, h('th', { scope: 'row' }, row.season), h('td', null, row.games ?? '—'), h('td', null, Number.isFinite(row.points) ? fmt1(row.points) : '—'), h('td', null, row.games > 0 && Number.isFinite(row.points) ? fmt1(row.points / row.games) : '—'))))))));
    }

    /** Mirrors War Room's real trade-engine.js fairnessGrade thresholds (reconai-shared/trade-engine.js:171-181). */
    function fairnessGrade(giveValue, receiveValue) {
        if (giveValue <= 0 && receiveValue <= 0) return { grade: '—', label: 'Build an offer', tone: '' };
        if (giveValue <= 0) return { grade: 'A+', label: 'Steal', tone: 'good' };
        const ratio = receiveValue / giveValue;
        if (ratio >= 1.30) return { grade: 'A+', label: 'Steal', tone: 'good' };
        if (ratio >= 1.15) return { grade: 'A', label: 'Clear Win', tone: 'good' };
        if (ratio >= 1.05) return { grade: 'B+', label: 'Slight Win', tone: 'gold' };
        if (ratio >= 0.95) return { grade: 'B', label: 'Fair', tone: 'gold' };
        if (ratio >= 0.85) return { grade: 'C', label: 'Slight Loss', tone: 'warn' };
        if (ratio >= 0.75) return { grade: 'D', label: 'Overpay', tone: 'warn' };
        return { grade: 'F', label: 'Bad Trade', tone: 'bad' };
    }

    function GmProfile({ team, title }) {
        const persona = team.aiPersona ? AI.AI_PERSONAS[team.aiPersona] : undefined;
        if (!persona) return null;
        const meters = [['Aggression', persona.aggression], ['Patience', persona.patience], ['Risk tol', persona.riskTolerance]];
        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, `🧠 ${title}`), h('small', null, `${team.name} — ${persona.label.toUpperCase()}`)),
            meters.map(([label, value]) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 6 } },
                h('span', { className: 'tl-label', style: { width: 62, flex: 'none' } }, label),
                h('span', { style: { flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 100, overflow: 'hidden' } },
                    h('span', { style: { display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, value))}%`, background: 'var(--gold)' } })),
                h('span', { className: 'tabular', style: { width: 24, textAlign: 'right', color: 'var(--text-muted)' } }, value))),
            h('p', { className: 'tl-hint' }, persona.tell));
    }

    /** Slot | Player | Pts | Move — mirrors the column rhythm of War Room's real
     * Game Day Central lineup table (js/tabs/lineup.js), minus the projection/
     * matchup/form columns that don't apply to fixed historical stat lines. */
    const LINEUP_GRID = '42px minmax(0,1fr) 62px 62px 66px';
    const slotName = slot => ({ BN: 'Bench', SUPER_FLEX: 'Super flex', FLEX: 'Flex', DEF: 'D/ST' }[slot] || slot);

    function WaiverBatchReceipt({ league, team, onNavigate, compact = false }) {
        const currentRecovery = league.planningRecoveryWeek === league.currentWeek;
        const week = currentRecovery ? league.currentWeek : ['claims', 'postgame'].includes(league.weekStage) ? league.currentWeek - 1 : league.currentWeek;
        const recoveryWeek = league.planningRecoveryWeek === week;
        const label = recoveryWeek ? `Week ${week} waiver results` : 'Latest waiver batch';
        const awards = (league.waiverResults || []).filter(row => row.week === week);
        const ownAwards = awards.filter(row => row.winnerTeamId === team.teamId);
        const contested = awards.filter(row => row.winnerTeamId !== team.teamId && row.contenderTeamIds.includes(team.teamId));
        const record = (league.activity || []).filter(event => event.kind === 'waiver' && event.week === week);
        if (week < 1 || (!awards.length && !record.length)) return null;
        return h('section', { className: `tl-card tl-waiver-receipt${compact ? ' is-compact' : ''}`, 'aria-label': label },
            h('div', { className: 'tl-card-title' }, h('span', null, label), h('small', null, `W${week}`)),
            ownAwards.length ? h('p', { className: 'tl-acq-help' }, `Added ${ownAwards.map(row => row.name).join(', ')}.`) : h('p', { className: 'tl-acq-help' }, recoveryWeek ? 'No additions recorded for your team this week.' : 'No additions recorded for your team in this batch.'),
            contested.map(row => h('p', { key: row.identity, className: 'tl-acq-help' }, `${row.name} went to ${league.teams.find(item => item.teamId === row.winnerTeamId)?.name || 'another manager'}.`)),
            !compact && record.length > 0 && h('details', null, h('summary', null, 'Recorded league waiver activity'),
                h('ul', { className: 'tl-waiver-record', tabIndex: 0, 'aria-label': 'Recorded waiver activity' }, record.map(event => h('li', { key: event.id }, event.message)))),
            onNavigate && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate(compact ? 'waivers' : 'roster') }, compact ? 'View waiver activity' : 'View lineup'));
    }

    function RosterPlanningRecovery({ league, team, onlineMeta, onReopenPlanning }) {
        const [working, setWorking] = useState(false);
        const [notice, setNotice] = useState('');
        const inFlight = React.useRef(false);
        const recovery = Engine.planningRecovery(league);
        const need = recovery.teams.find(row => row.teamId === team.teamId);
        if (!need || !['lineup', 'ready'].includes(league.weekStage) || league.phase !== 'season') return null;
        const host = !onlineMeta || onlineMeta.role === 'commissioner';
        const close = event => { const details = event.currentTarget.closest('details'); details.open = false; details.querySelector('summary')?.focus(); };
        const reopen = async () => {
            if (inFlight.current || !host || !recovery.available || !onReopenPlanning) return;
            inFlight.current = true; setWorking(true); setNotice('');
            try {
                const saved = await onReopenPlanning(team.teamId);
                if (saved === false) setNotice('Planning was not reopened. Resolve the save or review the current room, then try again.');
            } catch (_error) { setNotice('Planning could not be reopened. Review the current room and try again.'); }
            finally { inFlight.current = false; setWorking(false); }
        };
        return h('section', { className: 'tl-card tl-roster-recovery', 'aria-label': 'Roster recovery required', tabIndex: -1 },
            h('h3', null, 'Roster changes needed'),
            h('p', null, `${team.name} cannot fill every required slot with this roster. Moving the current players cannot solve these needs:`),
            h('ul', null, need.problems.map(problem => h('li', { key: problem }, problem))),
            !recovery.available ? h('p', { className: 'tl-acq-help' }, recovery.reason)
                : !host ? h('p', { className: 'tl-acq-help' }, `Ask your commissioner to reopen planning for Week ${league.currentWeek}. Only the commissioner can open this recovery window.`)
                    : onReopenPlanning && h('details', { className: 'tl-roster-recovery-confirm', onKeyDown: event => { if (event.key === 'Escape' && event.currentTarget.open && !working) { event.preventDefault(); event.stopPropagation(); close(event); } } },
                        h('summary', null, 'Reopen planning'),
                        h('div', { className: 'tl-planning-confirm-body' },
                            h('p', null, `Reopen Week ${league.currentWeek} for human managers to ${league.settings.waiversEnabled ? 'file new waiver claims' : 'propose compatible trades'}. Existing waiver awards, settled trades, spent FAAB and completed games stay saved.`),
                            h('p', null, 'This returns the league to planning. Computer managers will not file another automatic waiver batch; existing trade offers can still receive answers.'),
                            h('div', { className: 'tl-planning-confirm-actions' },
                                h('button', { type: 'button', className: 'tl-btn', disabled: working, onClick: close }, 'Keep current stage'),
                                h('button', { type: 'button', className: 'tl-btn primary', disabled: working, onClick: reopen }, working ? 'Reopening…' : 'Confirm reopen planning')))),
            notice && h('p', { className: 'tl-acq-notice', role: 'status', 'aria-atomic': true }, notice));
    }

    function RosterSection({ league, cards, archiveCards, team, apply, logIndex, eraFactors, onBrowseWaivers, throughWeek, onStats, onNavigate, onlineMeta, onReopenPlanning }) {
        const [selectedId,setSelectedId]=useState(null);
        const [draggedId, setDraggedId] = useState(null);
        const [moveNotice, setMoveNotice] = useState('');
        const [moveChoice, setMoveChoice] = useState(null);
        const [moving, setMoving] = useState(false);
        const [comparisonOpen, setComparisonOpen] = useState(false);
        const fillInFlightRef = React.useRef(false);
        const moveRef = React.useRef(null);
        const moveTrigger = React.useRef(null);
        const dossierRef=React.useRef(null);
        React.useEffect(()=>{if(selectedId&&dossierRef.current){dossierRef.current.focus({preventScroll:true});dossierRef.current.scrollIntoView?.({block:'start',behavior:'auto'});}},[selectedId]);
        const concealed = league.settings.hiddenYears && !league.yearsRevealed;
        const revealed = league.seasonsRevealed && !concealed;
        const editable = team.manager === 'human' && league.phase === 'season' && ['claims', 'lineup'].includes(league.weekStage);
        const participation = Engine.weekParticipation(league, team.teamId);
        const recoveryNeed = Engine.planningRecovery(league).teams.find(row => row.teamId === team.teamId);
        const emptyStarterSlots = currentTeam => STARTER_SLOTS.reduce((total, slot) => total + Math.max(0,
            (league.settings.rosterSlots[slot] || 0) - currentTeam.roster.filter(entry => entry.slot === slot).length), 0);
        const emptyCount = emptyStarterSlots(team);
        const fillPlan = useMemo(() => {
            if (!editable || !emptyCount) return null;
            const next = Engine.autoFillLineup(league, team.teamId, cards);
            if (next === league) return null;
            const before = new Map(team.roster.map(entry => [entry.entryId, entry.slot]));
            const nextTeam = next.teams.find(candidate => candidate.teamId === team.teamId);
            const moved = nextTeam.roster.filter(entry => before.get(entry.entryId) !== entry.slot);
            return moved.length ? { next, moved, remaining: emptyStarterSlots(nextTeam) } : null;
        }, [league, team, cards, editable, emptyCount]);
        const fillHelpId = `vault-fill-help-${league.leagueId}-${team.teamId}`;
        const fillHelp = league.phase === 'complete' ? 'This season is complete. Your saved lineup can be reviewed here.'
            : participation.kind === 'observer' ? 'Your team is not in this playoff round. Its lineup does not block kickoff; you can review your roster here.'
            : recoveryNeed && ['lineup', 'ready'].includes(league.weekStage) && !fillPlan ? `${!editable ? 'Lineups are locked. This roster needs changes before kickoff.' : emptyCount ? `No eligible bench player can fill ${emptyCount === 1 ? 'the empty starting slot' : `these ${emptyCount} empty starting slots`}.` : 'This roster needs changes before kickoff.'} Review the roster recovery notice above; moving the current players cannot fill every required slot.`
            : !editable ? 'Lineups are locked. Empty slots can be filled during the next planning gate.'
            : !emptyCount ? 'Every starting slot is occupied. Use Move to compare and swap players.'
                : !fillPlan ? `No eligible bench player can fill ${emptyCount === 1 ? 'the empty starting slot' : `these ${emptyCount} empty starting slots`}. Select + Add player in an empty slot to review your roster options.`
                    : `Fill ${fillPlan.moved.length} empty starting slot${fillPlan.moved.length === 1 ? '' : 's'} from your bench. Existing starters stay in place.${fillPlan.remaining ? ` ${fillPlan.remaining} other slot${fillPlan.remaining === 1 ? ' needs' : 's need'} an eligible player.` : ''}`;
        const fillEmptySlots = async () => {
            if (!editable || moving || fillInFlightRef.current) return;
            if (!fillPlan) { setMoveNotice(fillHelp); return; }
            fillInFlightRef.current = true;
            setMoving(true);
            setMoveNotice('');
            try {
                const saved = await apply(fillPlan.next, { type: 'auto-lineup', teamId: team.teamId });
                const moves = fillPlan.moved.slice(0, 3).map(entry => `${entry.name} → ${slotName(entry.slot)}`).join('; ');
                const more = fillPlan.moved.length > 3 ? `; ${fillPlan.moved.length - 3} more` : '';
                setMoveNotice(saved === false ? 'The filled lineup was not saved. Review your current lineup and try again.'
                    : `Filled ${fillPlan.moved.length} empty starting slot${fillPlan.moved.length === 1 ? '' : 's'}: ${moves}${more}. Existing starters stayed in place.${fillPlan.remaining ? ` ${fillPlan.remaining} starting slot${fillPlan.remaining === 1 ? ' remains' : 's remain'} open.` : ''}`);
            } catch { setMoveNotice('The filled lineup could not be saved. Review your current lineup and try again.'); }
            finally { fillInFlightRef.current = false; setMoving(false); }
        };
        React.useEffect(() => {
            if (moveChoice?.entryId && !team.roster.some(entry => entry.entryId === moveChoice.entryId)) setMoveChoice(null);
        }, [team.roster, moveChoice?.entryId]);
        React.useEffect(() => {
            if (!moveChoice || typeof document === 'undefined') return undefined;
            const previous = document.activeElement;
            const oldOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            moveRef.current?.focus();
            return () => {
                document.body.style.overflow = oldOverflow;
                (moveTrigger.current?.isConnected ? moveTrigger.current : previous)?.focus?.();
            };
        }, [Boolean(moveChoice)]);
        const openMove = (choice, event) => {
            if (!editable || moving) return;
            moveTrigger.current = event?.currentTarget || null;
            setMoveNotice('');
            setMoveChoice(choice);
        };
        const closeMove = () => { if (!moving) setMoveChoice(null); };
        const onMoveKeys = event => {
            if (event.key === 'Escape') { event.preventDefault(); closeMove(); }
            if (event.key !== 'Tab') return;
            const controls = [...(moveRef.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]') || [])];
            if (!controls.length) { event.preventDefault(); return; }
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === moveRef.current)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === moveRef.current)) { event.preventDefault(); first.focus(); }
        };
        const ytd = useMemo(() => {
            const Stats = window.App.TimeLeaguePlayerStats;
            return new Map(team.roster.map(entry => [entry.entryId, league.seasonsRevealed && Stats ? Stats.totals(league, entry, logIndex, eraFactors, Stats.completedWeeks(league, throughWeek)).points : null]));
        }, [team.roster, revealed, league, throughWeek, logIndex, eraFactors]);
        const capacity = Engine.rosterCapacity(league.settings);
        const PlayerComparison = window.App.GamePlayerComparison;
        const comparisonRows = comparisonOpen ? team.roster.map(entry => {
            const read = scoutingRead(league, entry, cards, logIndex, eraFactors, throughWeek);
            const outlook = read.status === 'ready' ? read.currentAvailable === false ? 'No game · 0 pts'
                : read.currentAvailable ? read.currentStars == null ? 'Game available' : `${read.currentStars}/5 stars` : 'Unavailable'
                : read.status === 'sealed' ? 'Sealed' : read.status === 'complete' ? 'Season complete' : 'Awaiting report';
            return { id: entry.entryId, name: entry.name, position: entry.position, slot: entry.slot, read, outlook };
        }) : [];
        const comparisonColumns = [
            { key: 'outlook', label: `Vault W${league.currentWeek} outlook`, getValue: row => row.outlook },
            { key: 'average', label: 'Completed-game PPG', getValue: row => row.read.average, render: row => Number.isFinite(row.read.average) ? fmt1(row.read.average) : '—' },
            { key: 'games', label: 'Completed games', getValue: row => row.read.games },
            { key: 'remaining', label: 'Points left', getValue: row => row.read.remainingPoints,
                render: row => Number.isFinite(row.read.remainingPoints) ? `${row.read.remainingEstimated ? 'Est. ' : ''}${fmt1(row.read.remainingPoints)}` : '—' },
        ];
        const comparisonScouting = row => {
            const eligible = STARTER_SLOTS.filter(slot => Number(league.settings.rosterSlots[slot]) > 0 && Roster.SLOT_ELIGIBILITY[slot]?.includes(row.position)).map(slotName);
            return {
                subtitle: `${row.position} · ${slotName(row.slot)} · Vault W${league.currentWeek}`,
                summary: row.read.currentAvailable === false && row.read.status === 'ready' ? 'Bench this week: the current public report confirms no recorded game and zero points.'
                    : row.read.status === 'ready' ? 'Stars rate the current game within this player’s season; compare PPG separately across players.' : 'This week’s game clue is not available. A historical average is not a weekly projection.',
                reason: `${row.slot === 'BN' ? 'On your bench' : `Currently in ${slotName(row.slot)}`}. Eligible starting slots: ${eligible.join(', ') || 'none configured'}.`,
                confidence: `${row.read.games == null ? 'Completed-game records unavailable.' : `${row.read.games} recorded completed Vault game${row.read.games === 1 ? '' : 's'} in league scoring.`} ${remainingTitle(row.read)}`,
            };
        };
        const weeksRemaining = Math.max(0, Engine.seasonEndWeek(league) - league.currentWeek + 1);
        const problems = Engine.lineupProblems(league, team.teamId);
        const noGameStarters = useMemo(() => {
            if (!participation.requiresLineup || !['claims', 'lineup', 'ready'].includes(league.weekStage)) return [];
            return team.roster.filter(entry => {
                if (!Season.isStarterSlot(entry.slot)) return false;
                const read = scoutingRead(league, entry, cards, logIndex, eraFactors, throughWeek);
                return read.status === 'ready' && read.currentAvailable === false;
            });
        }, [league, team.roster, cards, logIndex, eraFactors, throughWeek, participation.requiresLineup]);
        const moveEntry = async (entryId, slot, targetEntryId) => {
            if (!editable || moving) { setMoveNotice('Lineups open during the waiver and roster gates.'); return; }
            const next = Engine.setEntrySlot(league, team.teamId, entryId, slot, targetEntryId);
            if (next === league) { setMoveNotice('That player cannot move into this slot. Choose a compatible position.'); return; }
            setMoving(true);
            try {
                const saved = await apply(next, { type: 'lineup', teamId: team.teamId, entryId, slot, targetEntryId });
                const player = team.roster.find(entry => entry.entryId === entryId);
                const target = team.roster.find(entry => entry.entryId === targetEntryId);
                setMoveNotice(saved === false ? 'Move was not saved. Review the current lineup and try again.' : target ? `${player.name} and ${target.name} swapped places.` : `${player.name} moved to ${slotName(slot)}.`);
                if (saved !== false) setMoveChoice(null);
            } catch { setMoveNotice('Move could not be saved. Please try again.'); }
            finally { setMoving(false); }
        };
        const dropProps = (slot, targetEntryId) => ({
            onDragOver: (event) => { if (editable && draggedId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } },
            onDrop: (event) => { event.preventDefault(); const id = draggedId; setDraggedId(null); if (id) moveEntry(id, slot, targetEntryId); },
        });
        const entryRow = (entry, slotLabel) => {
            const scouting = scoutingRead(league, entry, cards, logIndex, eraFactors, throughWeek);
            const knownYear = concealed ? scouting.identifiedYear ?? identifiedYear(league, entry, cards, logIndex, eraFactors, throughWeek) : revealed ? entry.drawnSeason : null;
            const unresolved = concealed && knownYear == null;
            const fullEdition = knownYear ?? yearLabel(league, entry, cards, logIndex, eraFactors, throughWeek);
            const edition = unresolved ? window.App.TimeLeagueHiddenYears?.decadeFor(league, entry, cards) || 'Unknown decade' : fullEdition;
            const editionId = `vault-roster-edition-${league.leagueId}-${team.teamId}-${entry.entryId}`;
            const editionDescription = `${fullEdition}${unresolved && Number.isInteger(scouting.candidateCount) ? ` · ${scouting.candidateCount} possible years` : ''}`;
            return h('div', { key: entry.entryId, className: 'tl-lineup-row tl-decision-row' + (draggedId === entry.entryId ? ' is-dragging' : ''), draggable: editable, onDragStart: (event) => { setDraggedId(entry.entryId); event.dataTransfer.setData('text/plain', entry.entryId); event.dataTransfer.effectAllowed = 'move'; }, onDragEnd: () => setDraggedId(null), ...dropProps(entry.slot, entry.entryId), style: { gridTemplateColumns: LINEUP_GRID } },
                h('span', { className: 'tl-lineup-slot', title: slotName(slotLabel) }, slotLabel === 'SUPER_FLEX' ? 'SFLX' : slotLabel),
                h('button', { type:'button', className: 'tl-lineup-player tl-roster-player-link', onClick:()=>setSelectedId(entry.entryId), 'aria-label':`Explore ${entry.name}'s history`, 'aria-describedby': league.seasonsRevealed ? editionId : undefined, 'aria-pressed':selectedId===entry.entryId },
                    h('span', { className: 'name' }, entry.name),
                    h('span', { className: `tl-pos-badge tl-pos-${entry.position}${slotLabel === entry.position ? ' is-slot-position' : ''}`, style: { marginLeft: 6 } }, entry.position),
                    league.seasonsRevealed
                        ? h('span', { className: `meta tl-roster-edition${knownYear != null ? ' is-known' : ''}`, id: editionId, title: editionDescription, 'aria-label': editionDescription }, edition,
                            knownYear == null && Number.isInteger(scouting.candidateCount) && h('span', { className: 'tl-roster-clue-count' }, ` · ${scouting.candidateCount} possible years`))
                        : h('span', { className: 'tl-pill warn', style: { marginLeft: 6 } }, 'SEALED')),
                h('span', { className: 'tl-lineup-pts tl-lineup-remaining tabular', title: remainingTitle(scouting) },
                    Number.isFinite(scouting.remainingPoints) ? fmt1(scouting.remainingPoints) : '—', h('small', null, remainingLabel(scouting))),
                h('span', { className: 'tl-lineup-pts tl-lineup-ytd tabular', title: 'Player points through completed Vault weeks, including bench games' }, ytd.get(entry.entryId) == null ? '—' : fmt1(ytd.get(entry.entryId)), h('small', null, 'YTD PTS')),
                h('button', { type: 'button', className: 'tl-btn tl-roster-move', 'aria-label': `Move ${entry.name}`, disabled: !editable || moving,
                    onClick: event => openMove({ entryId: entry.entryId }, event) }, 'Move'),
                h(PlayerSignals, { league, cards, entry, logIndex, eraFactors, throughWeek, className: 'tl-roster-signals' }));
        };
        const openRow = (slotLabel, key) => h('div', { key, className: 'tl-lineup-row open-slot', ...dropProps(slotLabel), style: { gridTemplateColumns: LINEUP_GRID } },
            h('span', { className: 'tl-lineup-slot', title: slotName(slotLabel) }, slotLabel === 'SUPER_FLEX' ? 'SFLX' : slotLabel),
            h('button', { type: 'button', className: 'tl-roster-open-slot', disabled: !editable || moving, 'aria-label': `Fill open ${slotName(slotLabel)} slot`, onClick: event => openMove({ slot: slotLabel }, event) },
                h('span', null, '+ Add player'), h('small', null, Roster.SLOT_ELIGIBILITY[slotLabel].join(' · '))), h('span', null), h('span', null), h('span', null));

        const starterRows = [];
        for (const slot of STARTER_SLOTS) {
            const count = league.settings.rosterSlots[slot] ?? 0;
            if (count <= 0) continue;
            const occupants = team.roster.filter((e) => e.slot === slot);
            occupants.forEach((entry) => starterRows.push(entryRow(entry, slot)));
            for (let i = occupants.length; i < count; i += 1) starterRows.push(openRow(slot, `${slot}-open-${i}`));
        }
        const bench = team.roster.filter((e) => e.slot === 'BN').sort((l, r) => (revealed ? cardSeasonPoints(cards, r) - cardSeasonPoints(cards, l) || l.entryId.localeCompare(r.entryId) : l.entryId.localeCompare(r.entryId)));
        const reserves = RESERVE_SLOTS.filter((slot) => (league.settings.rosterSlots[slot] ?? 0) > 0);

        const optimal = league.phase !== 'draft' && problems.length === 0;
        const headline = league.phase === 'draft' ? 'DRAFT IN PROGRESS' : participation.kind === 'observer' ? 'ROSTER DETAILS · NOT REQUIRED THIS ROUND' : optimal ? 'LINEUP IS VALID' : `${problems.length} ISSUE${problems.length === 1 ? '' : 'S'} TO FIX`;

        const selected=team.roster.find(e=>e.entryId===selectedId);
        const dossier = selected && h('aside', { className: 'tl-roster-dossier tl-scouting-card', ref: dossierRef, tabIndex: -1, 'aria-label': 'Historical player dossier' },
            h(PlayerScoutingCard, { key: selected.entryId, league, entry: selected, cards, archiveCards, logIndex, eraFactors, throughWeek,
                onClose: () => setSelectedId(null), onMove: editable ? event => openMove({ entryId: selected.entryId }, event) : null }));
        const movingEntry = team.roster.find(entry => entry.entryId === moveChoice?.entryId);
        const sortCandidates = (a, b) => (a.slot === 'BN' ? 0 : 1) - (b.slot === 'BN' ? 0 : 1) || a.name.localeCompare(b.name);
        // Exact target IDs make swaps atomic even with a full bench or several occupants in one slot.
        const replacements = movingEntry ? team.roster.filter(candidate => candidate.entryId !== movingEntry.entryId &&
            Engine.setEntrySlot(league, team.teamId, movingEntry.entryId, candidate.slot, candidate.entryId) !== league).sort(sortCandidates) : [];
        const openCandidates = moveChoice?.slot ? team.roster.filter(candidate =>
            Roster.SLOT_ELIGIBILITY[moveChoice.slot]?.includes(candidate.position) &&
            Engine.setEntrySlot(league, team.teamId, candidate.entryId, moveChoice.slot) !== league).sort(sortCandidates) : [];
        const emptyTargets = movingEntry ? Roster.ROSTER_SLOT_IDS.filter(slot => slot !== movingEntry.slot &&
            (league.settings.rosterSlots[slot] ?? 0) > team.roster.filter(entry => entry.slot === slot).length &&
            Engine.setEntrySlot(league, team.teamId, movingEntry.entryId, slot) !== league) : [];
        const candidateButton = (candidate, isSwap) => {
            const destination = isSwap ? movingEntry.slot : moveChoice.slot;
            return h('button', { type: 'button', key: candidate.entryId, className: 'tl-roster-candidate', disabled: !editable || moving,
                'aria-label': isSwap ? `Swap ${movingEntry.name} with ${candidate.name}` : `Start ${candidate.name} at ${slotName(destination)}`,
                onClick: () => isSwap ? moveEntry(movingEntry.entryId, candidate.slot, candidate.entryId) : moveEntry(candidate.entryId, destination) },
                h('span', { className: `tl-pos-badge tl-pos-${candidate.position}` }, candidate.position),
                h('span', { className: 'tl-roster-candidate-player' }, h('strong', null, candidate.name),
                    h('small', null, `${concealed ? `${yearLabel(league, candidate, cards, logIndex, eraFactors, throughWeek)} · ` : revealed ? `${candidate.drawnSeason} · ` : 'Sealed edition · '}${slotName(candidate.slot)} → ${slotName(destination)}`),
                    isSwap && h('small', null, `${movingEntry.name} → ${slotName(candidate.slot)}`)),
                h('span', { className: 'tl-roster-candidate-action' }, isSwap ? 'Swap ↔' : 'Start →'),
                h(PlayerSignals, { league, cards, entry: candidate, logIndex, eraFactors, throughWeek, className: 'tl-candidate-signals' }));
        };
        const moveSheet = moveChoice && (movingEntry || moveChoice.slot) && h('div', { className: 'tl-roster-move-backdrop', onClick: event => { if (event.target === event.currentTarget) closeMove(); } },
            h('section', { className: 'tl-roster-move-sheet', role: 'dialog', 'aria-modal': true, 'aria-label': movingEntry ? `Move ${movingEntry.name}` : `Fill ${slotName(moveChoice.slot)}`, ref: moveRef, tabIndex: -1, onKeyDown: onMoveKeys },
                h('header', null, h('div', null, h('small', { className: 'tl-label' }, 'YOUR LINEUP'), h('h2', null, movingEntry ? `Move ${movingEntry.name}` : `Fill ${slotName(moveChoice.slot)}`)),
                    h('button', { type: 'button', className: 'tl-btn', onClick: closeMove, disabled: moving, 'aria-label': 'Close lineup choices' }, 'Close')),
                !editable ? h('p', { className: 'tl-hint' }, 'Lineups are locked until the next roster gate.') :
                    h(React.Fragment, null,
                        h('p', { className: 'tl-hint' }, movingEntry ? `Choose a player to swap with ${movingEntry.name}. Both moves happen together.` : 'Choose an eligible player from your roster. Their current slot is shown below.'),
                        movingEntry && h('div', { className: 'tl-roster-current-player' }, h('small', null, 'CURRENT PLAYER'), h('strong', null, `${movingEntry.name} · ${slotName(movingEntry.slot)}`),
                            h(PlayerSignals, { league, cards, entry: movingEntry, logIndex, eraFactors, throughWeek })),
                        h('div', { className: 'tl-roster-candidates' }, (movingEntry ? replacements : openCandidates).map(candidate => candidateButton(candidate, Boolean(movingEntry)))),
                        (movingEntry ? !replacements.length : !openCandidates.length) && h('p', { className: 'tl-empty' }, movingEntry ? 'No compatible players to swap with.' : 'No eligible players on your roster for this slot.'),
                        emptyTargets.length > 0 && h('div', { className: 'tl-roster-empty-targets' }, h('h3', null, 'Move into an open slot'), emptyTargets.map(slot => h('button', {
                            type: 'button', key: slot, className: 'tl-btn', disabled: moving, onClick: () => moveEntry(movingEntry.entryId, slot),
                        }, `${slotName(slot)}${Season.isStarterSlot(movingEntry.slot) && slot === 'BN' ? ` · leaves ${slotName(movingEntry.slot)} open` : ''}`))),
                        recoveryNeed && league.weekStage !== 'claims' ? h('p', { className: 'tl-hint' }, 'Acquisitions are closed. Close these choices and review the roster recovery notice to reopen planning before finding a replacement.')
                            : onBrowseWaivers && league.settings.waiversEnabled && (moveChoice.slot || (movingEntry && Season.isStarterSlot(movingEntry.slot))) && h('button', { type: 'button', className: 'tl-btn tl-roster-find-player', disabled: moving, onClick: () => { setMoveChoice(null); onBrowseWaivers(moveChoice.slot || movingEntry.slot, movingEntry?.entryId || null); } }, `Find eligible ${slotName(moveChoice.slot || movingEntry.slot)} free agents →`)),
                moveNotice && h('p', { className: 'tl-hint', role: 'status' }, moveNotice)));
        return h('div', { className: 'tl-roster-layout'+(selected?' has-selection':'') },
            h('div', { className: 'tl-roster-main' },
                h(RosterPlanningRecovery, { league, team, onlineMeta, onReopenPlanning }),
                league.weekStage === 'lineup' && h(WaiverBatchReceipt, { league, team, onNavigate, compact: true }),
                h('div', { className: 'tl-roster-toolbar' },
                    h('div', null, h('h2', null, 'My Roster'), h('p', null, `${team.name} · Week ${league.currentWeek} · ${team.roster.length}/${capacity} players · ${weeksRemaining} weeks left`)),
                    h('div', { className: 'tl-roster-toolbar-actions' }, h('span', { className: `tl-roster-lineup-status ${optimal || participation.kind === 'observer' ? 'good' : 'warn'}` }, participation.kind === 'observer' ? 'No lineup required this round' : editable ? optimal ? 'Lineup legal' : `${problems.length} lineup issue${problems.length === 1 ? '' : 's'}` : league.phase === 'complete' ? 'Season complete' : 'Lineup locked'),
                        PlayerComparison && h('button', { type: 'button', className: 'tl-btn', 'aria-expanded': comparisonOpen, onClick: () => setComparisonOpen(value => !value) }, comparisonOpen ? 'Hide comparison' : 'Compare players'),
                        onStats && h('button', { type: 'button', className: 'tl-btn', onClick: onStats }, 'Player stats'),
                        h('button', { type: 'button', className: 'tl-btn', 'aria-label': 'Fill empty slots', 'aria-describedby': emptyCount > 0 || !editable ? fillHelpId : undefined, title: !emptyCount && editable ? fillHelp : undefined,
                            disabled: !editable || moving || !fillPlan, onClick: fillEmptySlots }, moving && fillInFlightRef.current ? 'Filling slots…' : 'Fill empty slots'))),
                (emptyCount > 0 || !editable) && h('p', { className: 'tl-roster-fill-help', id: fillHelpId }, fillHelp),
                noGameStarters.length > 0 && h('section', { className: 'tl-roster-game-warning', 'aria-label': 'Current no-game starters' },
                    h('h3', null, `W${league.currentWeek} · ${noGameStarters.length} starter${noGameStarters.length === 1 ? '' : 's'} with no game · 0 pts`),
                    h('ul', null, noGameStarters.map(entry => h('li', { key: entry.entryId },
                        h('span', null, `${entry.name} · ${slotName(entry.slot)}`),
                        editable && h('button', { type: 'button', className: 'tl-btn', disabled: moving, 'aria-label': `Compare replacements for ${entry.name}`, onClick: event => openMove({ entryId: entry.entryId }, event) }, 'Compare replacements'))))),
                comparisonOpen && PlayerComparison && h('div', { className: 'tl-roster-comparison' }, h(PlayerComparison, {
                    rows: comparisonRows, columns: comparisonColumns, scoutingForRow: comparisonScouting,
                    workspaceKey: `vault-lineup:${league.leagueId}:${team.teamId}`, title: 'Compare lineup options', onSelect: row => setSelectedId(row.id),
                })),
                moveNotice && !moveChoice && h('p', { className: 'tl-roster-notice', role: 'status', 'aria-live': 'polite', 'aria-atomic': true }, moveNotice),
                !optimal && problems.length > 0 && h('details', { className: 'tl-roster-help tl-roster-problems' }, h('summary', null, headline), problems.map((problem, i) => h('p', { key: i }, problem))),
                h('div', { className: 'tl-lineup-table' },
                    h('div', { className: 'tl-lineup-table-title' }, 'Starting Lineup'),
                    h('div', { className: 'tl-lineup-head', style: { gridTemplateColumns: LINEUP_GRID } },
                        h('span', null, 'Slot'), h('span', null, 'Player'), h('span', { style: { textAlign: 'right' } }, 'LEFT'), h('span', { style: { textAlign: 'right' } }, 'YTD'), h('span', null)),
                    starterRows),
                league.settings.rosterSlots.BN > 0 && h('div', { className: 'tl-lineup-table' },
                    h('div', { className: 'tl-lineup-table-title', ...dropProps('BN') }, editable ? 'Bench · drop here' : 'Bench'),
                    bench.length
                        ? bench.map((entry) => entryRow(entry, 'BN'))
                        : h('p', { className: 'tl-empty', style: { padding: '10px 14px' } }, 'Bench is empty.')),
                reserves.map((slot) => {
                    const occupants = team.roster.filter((e) => e.slot === slot);
                    return h('div', { key: slot, className: 'tl-lineup-table' },
                        h('div', { className: 'tl-lineup-table-title' }, slot === 'IR' ? 'Injured Reserve' : 'Taxi Squad'),
                        occupants.length ? occupants.map((entry) => entryRow(entry, slot)) : h('p', { className: 'tl-empty', style: { padding: '10px 14px' } }, `No entries stashed at ${slot}.`));
                })),
            dossier,
            moveSheet);
    }

    function WaiversSection({ league, cards, team, standings, apply, waiverSlot, waiverContext, onClearWaiverContext, logIndex, eraFactors, throughWeek, onNavigate }) {
        const concealed = league.settings.hiddenYears && !league.yearsRevealed;
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : false;
        const rowCap = phone ? 20 : WIRE_ROW_CAP;
        const [clearedContext, setClearedContext] = useState('');
        const contextKey = waiverContext ? JSON.stringify([waiverContext.leagueId, waiverContext.teamId, waiverContext.week, waiverContext.slot, waiverContext.replacementEntryId, waiverContext.requestId]) : '';
        const context = waiverContext && clearedContext !== contextKey ? waiverContext : null;
        const contextProblem = !context ? null : context.leagueId !== league.leagueId ? 'This replacement context belongs to another Vault. Choose your current roster need.'
            : context.teamId !== team.teamId ? 'This replacement context belongs to another team. Choose your current roster need.'
                : context.week !== league.currentWeek ? 'This replacement context has expired. Choose your current roster need.'
                    : !Roster.SLOT_ELIGIBILITY[context.slot] || !(league.settings.rosterSlots[context.slot] > 0) ? 'That lineup slot is not configured in this Vault. Choose your current roster need.' : null;
        const validContext = context && !contextProblem ? context : null;
        const contextDrop = validContext?.replacementEntryId ? team.roster.find(entry => entry.entryId === validContext.replacementEntryId) : null;
        const requestedSlot = waiverContext ? validContext?.slot : waiverSlot;
        const [query, setQuery] = useState('');
        const [pos, setPos] = useState(requestedSlot && Roster.SLOT_ELIGIBILITY[requestedSlot] ? requestedSlot : 'ALL');
        const [visibleCount, setVisibleCount] = useState(rowCap);
        const [targetIdentity, setTargetIdentity] = useState('');
        const [dropEntryId, setDropEntryId] = useState('');
        const [bidAmount, setBidAmount] = useState(0);
        const [filing, setFiling] = useState(false);
        const [claimMessage, setClaimMessage] = useState('');
        const [claimOpen, setClaimOpen] = useState(false);
        const [cancelling, setCancelling] = useState('');
        const claimBusy = React.useRef(false);
        const lastFiled = React.useRef('');
        const pendingRef = React.useRef(null);
        const returnToPending = React.useRef(false);
        const claimDialog = React.useRef(null);
        const claimTrigger = React.useRef(null);
        const searchInput = React.useRef(null);
        const selectionScope = React.useRef('');
        const automaticDrop = React.useRef(null);
        const latestClaimForm = React.useRef(null);
        const currentClaimScope = `${league.leagueId}:${team.teamId}:${league.currentWeek}`;
        latestClaimForm.current = null;
        if (automaticDrop.current && automaticDrop.current.scope !== currentClaimScope) automaticDrop.current.invalid = true;
        React.useEffect(() => {
            const dialog = claimDialog.current;
            if (claimOpen && dialog && !dialog.open) dialog.showModal?.();
            if (!claimOpen && dialog?.open) dialog.close?.();
            if (!claimOpen || !document.body) return;
            const overflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = overflow; };
        }, [claimOpen]);
        const focusClosedClaim = () => {
            const target = returnToPending.current ? pendingRef.current : claimTrigger.current;
            if (returnToPending.current) target?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
            target?.focus?.({ preventScroll: true });
        };
        const closeClaim = () => {
            if (claimBusy.current) return;
            setClaimOpen(false); claimDialog.current?.close?.(); focusClosedClaim();
        };

        const pool = useMemo(() => Engine.freeAgents(league, cards), [league, cards]);
        const previews = useMemo(() => new Map(pool.map(card => [card.identity, Engine.waiverPreview(league, card, logIndex, eraFactors, league.currentWeek, throughWeek)])), [pool, league, logIndex, eraFactors, throughWeek]);
        const estimatedPreviews = league.settings.gameDeckVersion === 1;
        React.useEffect(() => {
            if (requestedSlot && Roster.SLOT_ELIGIBILITY[requestedSlot]) { setPos(requestedSlot); setVisibleCount(rowCap); }
        }, [requestedSlot, contextKey]);
        const faab = league.settings.waiverMode === 'faab';
        const chooseTarget = (identity, event) => {
            if (claimBusy.current) return;
            returnToPending.current = false;
            if (event?.currentTarget) claimTrigger.current = event.currentTarget;
            const pending = league.pendingClaims.find(claim => claim.teamId === team.teamId && claim.addIdentity === identity);
            const scope = currentClaimScope;
            const newTarget = identity !== targetIdentity || selectionScope.current !== scope;
            const card = pool.find(candidate => candidate.identity === identity);
            const suggestedDrop = contextDrop && card && Engine.waiverLandingSlot(league, team, card.position, contextDrop.entryId) ? contextDrop.entryId : '';
            if (pending || newTarget) {
                setDropEntryId(pending?.dropEntryId || (pending ? '' : suggestedDrop)); setBidAmount(pending?.bidAmount || 0);
                automaticDrop.current = !pending && suggestedDrop ? { identity, entryId: suggestedDrop, scope } : null;
            }
            selectionScope.current = scope;
            setTargetIdentity(identity);
            setClaimMessage('');
            setClaimOpen(Boolean(identity));
        };
        const chooseDrop = entryId => { automaticDrop.current = null; setDropEntryId(entryId); };
        const clearContext = () => {
            const preset = automaticDrop.current;
            const pending = league.pendingClaims.some(claim => claim.teamId === team.teamId && claim.addIdentity === targetIdentity);
            if (!pending && preset?.identity === targetIdentity && preset.entryId === dropEntryId) setDropEntryId('');
            automaticDrop.current = null;
            setClearedContext(contextKey); onClearWaiverContext?.();
            searchInput.current?.focus?.({ preventScroll: true });
        };

        if (!league.settings.waiversEnabled) {
            return h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Free agent wire'), h('small', null, 'OFFLINE')),
                h('span', { className: 'tl-pill bad' }, 'DISABLED'),
                h('p', { style: { marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)' } }, "Waivers are switched off in this league's settings. The wire stays dark all season."));
        }
        const wireOpen = league.phase === 'season' && league.weekStage === 'claims';
        const positions = [...POSITION_ORDER.filter((p) => pool.some((c) => c.position === p)), ...['FLEX', 'SUPER_FLEX'].filter(slot => league.settings.rosterSlots[slot] > 0)];
        const filtered = pool.filter((c) => (pos === 'ALL' || Roster.SLOT_ELIGIBILITY[pos]?.includes(c.position)) && (!query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase())))
            .sort((a, b) => (previews.get(b.identity)?.remainingPoints ?? -Infinity) - (previews.get(a.identity)?.remainingPoints ?? -Infinity) || a.name.localeCompare(b.name));
        const shown = filtered.slice(0, visibleCount);
        const target = targetIdentity ? cards.get(targetIdentity) : undefined;
        const targetPreview = previews.get(targetIdentity);
        const waiverEntry = card => ({ identity: card.identity, name: card.name, position: card.position, drawnSeason: previews.get(card.identity)?.drawnSeason,
            ...(concealed ? { editionId: previews.get(card.identity)?.editionId || `mystery:${card.identity}`, hiddenDecade: previews.get(card.identity)?.hiddenDecade } : {}) });
        const previewPoints = value => value == null ? '—' : fmt1(value);
        const pendingTarget = league.pendingClaims.find(claim => claim.teamId === team.teamId && claim.addIdentity === targetIdentity);
        const alreadyClaimed = Boolean(pendingTarget);
        const staleAutomaticDrop = !alreadyClaimed && automaticDrop.current?.identity === targetIdentity
            && automaticDrop.current.entryId === dropEntryId && automaticDrop.current.invalid;
        const currentDropEntryId = staleAutomaticDrop ? '' : dropEntryId;
        const contextMessage = contextProblem || (validContext?.replacementEntryId && !contextDrop ? 'The player you meant to replace is no longer on this roster. Choose a drop after selecting a free agent.'
            : contextDrop ? `Replacing ${contextDrop.name} · ${slotName(validContext.slot)}. A compatible claim starts with this suggested drop; review it before filing.`
                : validContext ? `Finding ${slotName(validContext.slot)}-eligible free agents. Choose a player, then review whether a drop is needed.` : '');
        const claimContextMessage = !validContext || !target ? contextMessage : alreadyClaimed ? 'This claim is already filed. Its saved drop and bid are shown; replacement context does not edit it.'
            : validContext.replacementEntryId && !contextDrop ? contextMessage
                : contextDrop && !Engine.waiverLandingSlot(league, team, target.position, contextDrop.entryId) ? `${contextDrop.name} cannot be the drop for this player: it does not open an eligible slot. Choose another drop.`
                    : contextDrop && currentDropEntryId !== contextDrop.entryId ? `Your current drop choice is kept. ${contextDrop.name} was the original replacement need.` : contextMessage;
        const benchCap = league.settings.rosterSlots.BN ?? 0;
        const mustDrop = Boolean(target) && !Engine.waiverLandingSlot(league, team, target.position, '');
        const dropEntry = team.roster.find((e) => e.entryId === currentDropEntryId);
        const landingSlot = target ? Engine.waiverLandingSlot(league, team, target.position, currentDropEntryId) : null;
        const dropBlocks = Boolean(target) && !landingSlot;
        const dropOptions = [...team.roster].sort((l, r) => (l.slot === 'BN' ? 0 : 1) - (r.slot === 'BN' ? 0 : 1) || l.name.localeCompare(r.name));
        const endWeek = Engine.seasonEndWeek(league);
        const factors = league.settings.eraAdjusted ? eraFactors : null;
        const matchup = (league.schedule || []).find(row => row.week === league.currentWeek)?.pairs?.find(pair => pair.includes(team.teamId));
        const opponent = matchup && league.teams.find(item => item.teamId === matchup.find(id => id !== team.teamId));
        const matchupLabel = opponent ? 'Vault W' + league.currentWeek + ' vs ' + opponent.name : 'Vault W' + league.currentWeek + ' · Matchup not scheduled';
        const dropRead = entry => {
            if (concealed) {
                const read = window.App.TimeLeagueHiddenYears?.read(league, entry, cards, logIndex, throughWeek, eraFactors);
                return { remaining: read?.estimatedAverage == null ? null : read.estimatedAverage * Math.max(0, endWeek - league.currentWeek + 1) };
            }
            const outlook = Season.rosterOutlook(entry, league.currentWeek, endWeek, logIndex, league.settings.scoring, factors, league);
            return { remaining: outlook?.estimatedRemaining };
        };

        const mine = league.pendingClaims.filter((c) => c.teamId === team.teamId).slice().sort((a, b) =>
            (faab ? (b.bidAmount ?? 0) - (a.bidAmount ?? 0) : 0) || Number(a.claimId.replace(/^w/, '')) - Number(b.claimId.replace(/^w/, '')));
        const priority = standings.map((s) => s.teamId).reverse();
        const myPriority = priority.indexOf(team.teamId) + 1;
        const budgetRemaining = team.faabRemaining ?? 0;
        const budgetReserved = mine.reduce((sum, c) => sum + (c.bidAmount ?? 0), 0);
        const budgetAvailable = Math.max(0, budgetRemaining - budgetReserved);
        const claimInput = { teamId: team.teamId, addIdentity: targetIdentity, addPosition: target?.position, dropEntryId: currentDropEntryId, bidAmount };
        const claimProblem = target ? staleAutomaticDrop ? 'The suggested drop was for another Vault, manager, or week. Review a current drop before filing.'
            : !pool.some(card => card.identity === targetIdentity) ? 'This player is no longer a free agent.'
            : Engine.waiverClaimProblem(league, claimInput) || (dropBlocks ? 'Choose a drop that opens an eligible slot for this player.' : null) : null;
        const filedKey = `${league.currentWeek}:${targetIdentity}`;
        const canFile = !filing && !cancelling && wireOpen && Boolean(target) && !claimProblem && lastFiled.current !== filedKey;
        const claimForm = { league, team, targetIdentity, dropEntryId: currentDropEntryId, bidAmount };
        latestClaimForm.current = claimForm;
        const reviewPending = () => {
            if (claimBusy.current) return;
            returnToPending.current = true;
            closeClaim();
        };
        const cancelClaim = async claim => {
            if (claimBusy.current) return;
            const next = Engine.cancelWaiverClaim(league, claim.claimId);
            if (next === league) { setClaimMessage('This claim is no longer pending. Review the updated list.'); return; }
            claimBusy.current = true; setCancelling(claim.claimId); setClaimMessage('');
            try {
                const saved = await apply(next, { type: 'cancel-claim', claimId: claim.claimId });
                if (saved) { lastFiled.current = ''; setClaimMessage(`Cancelled the claim for ${claim.addName}. No player moved${faab ? '; its reserved bid is available again' : ''}.`); }
                else setClaimMessage('Cancellation was not saved. Your claim remains on file; try again after resolving the save.');
            } catch (_error) { setClaimMessage('Cancellation could not be saved. Your claim remains on file; please try again.'); }
            finally { claimBusy.current = false; setCancelling(''); }
        };
        const fileClaim = async () => {
            if (latestClaimForm.current !== claimForm || claimBusy.current || !canFile || staleAutomaticDrop) return;
            const currentTarget = Engine.freeAgents(league, cards).find(card => card.identity === targetIdentity);
            const problem = !currentTarget ? 'This player is no longer a free agent.' : Engine.waiverClaimProblem(league, { ...claimInput, addPosition: currentTarget.position })
                || (!Engine.waiverLandingSlot(league, team, currentTarget.position, currentDropEntryId) ? 'Choose a drop that opens an eligible slot for this player.' : null);
            if (problem) { setClaimMessage(problem); return; }
            claimBusy.current = true; setFiling(true); setClaimMessage('');
            try {
                const next = Engine.submitWaiverClaim(league, {
                    teamId: team.teamId, addIdentity: currentTarget.identity, addName: currentTarget.name, addPosition: currentTarget.position,
                    dropEntryId: dropEntry ? dropEntry.entryId : '', ...(faab ? { bidAmount } : {}),
                }, nowIso());
                if (next === league) { setClaimMessage(Engine.waiverClaimProblem(league, claimInput) || 'This claim is no longer available. Review the player and roster before trying again.'); return; }
                const saved = await apply(next, { type: 'claim', teamId: team.teamId, identity: target.identity, dropEntryId: dropEntry?.entryId || '', bidAmount });
                if (saved) {
                    lastFiled.current = filedKey;
                    setClaimMessage(`Claim filed for ${target.name}${faab ? ` at $${bidAmount}` : ''}. ${dropEntry ? `${dropEntry.name} stays on your roster unless this claim wins.` : 'Your roster is unchanged until the batch runs.'}`);
                } else setClaimMessage('Claim was not saved. Review your selection and try again.');
            } catch (_error) { setClaimMessage('Claim could not be saved. Please try again.'); }
            finally { claimBusy.current = false; setFiling(false); }
        };

        return h('div', { className: 'tl-waiver-desk' },
            h('header', { className: 'tl-waiver-heading' },
                h('h2', null, 'Free agents'),
                h('span', { className: 'tl-pill' }, wireOpen ? `W${league.currentWeek} · CLAIMS OPEN` : league.phase === 'draft' ? 'OPENS AFTER DRAFT' : league.phase === 'season' ? `W${league.currentWeek} · CLAIMS CLOSED` : 'SEASON COMPLETE')),
            context && h('aside', { className: 'tl-waiver-context', 'aria-label': 'Replacement context' },
                h('div', null, h('strong', null, contextDrop ? `Replacing ${contextDrop.name}` : validContext ? `Need ${slotName(validContext.slot)}` : 'Replacement context unavailable'), h('p', null, contextMessage)),
                h('button', { type: 'button', className: 'tl-btn', onClick: clearContext }, 'Clear replacement context')),
            h('div', { className: 'tl-waiver-summary', 'aria-label': 'Waiver desk status' },
                h('div', { className: 'tl-waiver-summary-item' }, h('span', { className: 'tl-label' }, 'Priority'), h('strong', null, myPriority ? `#${myPriority}` : '—')),
                h('div', { className: 'tl-waiver-summary-item' }, h('span', { className: 'tl-label' }, 'Pending'), h('strong', null, mine.length)),
                faab && h('div', { className: 'tl-waiver-summary-item' }, h('span', { className: 'tl-label' }, 'FAAB available'), h('strong', { className: 'tabular' }, `$${budgetAvailable}`))),
            h('div', { className: 'tl-waiver-layout' },
            h('section', { className: 'tl-card tl-waiver-market' },
                h('p', { className: 'tl-waiver-list-count' }, `${filtered.length} players · ${estimatedPreviews ? 'Est. points left' : 'Points left'} ↓`),
                h('div', { className: 'tl-waiver-search' },
                    h('input', { ref: searchInput, className: 'tl-input', placeholder: 'Search player name…', 'aria-label': 'Search free agents', value: query, onChange: e => { setQuery(e.target.value); setVisibleCount(rowCap); } })),
                h('nav', { className: 'tl-waiver-filters', 'aria-label': 'Free agent positions' },
                    ['ALL', ...positions].map(position => h('button', { key: position, className: `tl-btn${pos === position ? ' primary' : ''}`, 'aria-pressed': pos === position, onClick: () => { setPos(position); setVisibleCount(rowCap); } }, slotName(position)))),
                h('p', { className: 'tl-waiver-reference' }, league.phase === 'complete' ? 'Season complete. No points remain to play.' : concealed ? 'Compare possible years and completed games · each awarded player keeps one fixed year' : `Avg pts per completed game · W${league.currentWeek} game rating`),
                (!logIndex || (league.settings.eraAdjusted && !eraFactors?.size)) && h('p', { className: 'tl-hint', role: 'status' }, 'Scoring data is unavailable. Point totals will appear when it loads.'),
                shown.length === 0 ? h('p', { className: 'tl-empty' }, 'No players match these filters.') :
                    h('div', { className: 'tl-waiver-table-scroll' }, h('table', { className: 'tl-waiver-table' },
                        h('thead', null, h('tr', null, [
                            ['#', 'tl-waiver-rank'], ['PLAYER', 'tl-waiver-player'], ['POS', 'tl-waiver-position'],
                            ['PTS', 'tl-waiver-points'], [estimatedPreviews ? 'EST. PTS LEFT' : 'PTS LEFT', 'tl-waiver-score'], ['', 'tl-waiver-action'],
                        ].map(([label, className]) => h('th', { key: className, scope: 'col', className, title: className === 'tl-waiver-points' ? 'Points scored through visible completed Vault weeks, using league scoring; includes bench games and games before acquisition' : undefined }, label)))),
                        h('tbody', null, shown.map((card, index) => {
                            const preview = previews.get(card.identity);
                            const selected = card.identity === targetIdentity;
                            const entry = waiverEntry(card);
                            const read = scoutingRead(league, entry, cards, logIndex, eraFactors, throughWeek);
                            const repeatedEstimate = preview?.hiddenYear && preview.estimated && read.remainingEstimated
                                && Number.isFinite(read.remainingPoints) && Number.isFinite(preview.remainingPoints) && fmt1(read.remainingPoints) === fmt1(preview.remainingPoints);
                            return h('tr', { key: card.identity, className: `tl-decision-row${selected ? ' is-selected' : ''}` },
                                h('td', { className: 'tl-waiver-rank' }, index + 1),
                                h('td', { className: 'tl-waiver-player' }, h('strong', null, card.name), h('small', { className: 'tl-waiver-edition' }, `${card.position} · ${concealed ? yearLabel(league, waiverEntry(card), cards, logIndex, eraFactors, throughWeek) : `${preview?.drawnSeason ?? '—'} season`}`),
                                    h(PlayerSignals, { league, cards, entry, logIndex, eraFactors, throughWeek, read, omitRemaining: repeatedEstimate }),
                                    h('div', { className: 'tl-waiver-mobile-totals' },
                                        h('span', { className: 'tl-waiver-mobile-scored', title: 'Visible completed Vault points · league scoring' }, h('b', null, previewPoints(read.points)), h('small', null, 'PTS')),
                                        h('small', { className: 'tl-waiver-mobile-points' }, previewPoints(preview?.remainingPoints) + (preview?.estimated ? ' est. pts left' : ' pts left')))),
                                h('td', { className: 'tl-waiver-position' }, h('span', { className: `tl-pos-badge tl-pos-${card.position}` }, card.position)),
                                h('td', { className: 'tl-waiver-points tabular', title: 'Visible completed Vault points · league scoring' }, previewPoints(read.points)),
                                h('td', { className: 'tl-waiver-score tabular' }, previewPoints(preview?.remainingPoints), !concealed && h('small', null, `${previewPoints(preview?.totalPoints)} total`)),
                                h('td', { className: 'tl-waiver-action' }, h('button', { className: `tl-btn${selected ? ' primary' : ''}`, disabled: !wireOpen || filing || Boolean(cancelling), 'aria-label': `${mine.some(claim => claim.addIdentity === card.identity) ? 'Review pending claim for' : 'Claim'} ${card.name}`, 'aria-pressed': selected, onClick: event => chooseTarget(card.identity, event) }, mine.some(claim => claim.addIdentity === card.identity) ? 'Pending' : '+ Claim')));
                        })))),
                h('div', { className: 'tl-waiver-market-foot' }, h('span', null, `${shown.length} of ${filtered.length} shown`),
                    filtered.length > shown.length && h('button', { className: 'tl-btn', onClick: () => setVisibleCount(count => count + rowCap) }, 'Show more')),
                h('details', { className: 'tl-waiver-scoring-help' }, h('summary', null, 'How player scores work'),
                    h('p', null, concealed ? 'Avg pts / game uses completed games observed for this edition. Before an edition plays, the candidate-year archive provides a comparison. When only one year remains, it is identified.' : 'Avg pts / game uses completed Vault games in your league scoring, including games before acquisition. Stars rate the current game against that player’s historical season; they are not a probability.'),
                    h('p', null, concealed ? 'Estimates use the visible game average or all possible years in the archive. Before any recorded games, the archive comparison uses reference scoring if league-scoring data is unavailable. Future games and availability remain unknown.' : estimatedPreviews
                        ? `Estimated points left use the recorded-season average across W${league.currentWeek}–W${Engine.seasonEndWeek(league)}. Future weekly scores and availability stay sealed. Totals use your league scoring.`
                        : `Points left cover W${league.currentWeek}–W${Engine.seasonEndWeek(league)}, if started each week. Totals use your league scoring${Engine.playoffCount(league) ? ' and include playoff weeks' : ''}.`))),
            h('aside', { className: 'tl-waiver-command' },
                h('dialog', { ref: claimDialog, className: 'tl-action-dialog tl-waiver-claim', 'aria-label': 'Waiver claim', onCancel: event => { event.preventDefault(); closeClaim(); }, onClose: () => { setClaimOpen(false); focusClosedClaim(); } },
                    h('header', { className: 'tl-action-dialog-head' }, h('h2', null, target ? 'Claim ' + target.name : 'Waiver claim'), h('button', { type: 'button', className: 'tl-btn', disabled: filing, onClick: closeClaim }, 'Close')),

                    claimMessage ? h('p', { className: 'tl-acq-notice', role: 'status', 'aria-atomic': true }, claimMessage) : null,
                    context && h('p', { className: 'tl-waiver-context tl-waiver-claim-context', role: 'status' }, claimContextMessage),
                    h('p',{className:'tl-hint'},concealed ? 'A winning claim fixes one year from the displayed decade. If only one year remains, it is identified. The year stays with the player for the rest of this season.' : 'The displayed season is the one you receive if your claim wins. Editions refresh each waiver week.'),
                    !wireOpen && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'HOLD'), h('p', null, league.phase === 'draft' ? 'The wire opens after the first game day.' : league.phase === 'complete' ? 'Season complete — no more claims.' : 'Advance from the postgame recap to open waiver planning.')),
                    benchCap <= 0 && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'WARN'), h('p', null, 'No bench configured — choose a drop that opens an eligible starting slot.')),
                    target ? h(React.Fragment, null,
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' } },
                            h('span', { className: `tl-pos-badge tl-pos-${target.position}` }, target.position),
                            h('span', { style: { flex: 1 } }, h('strong', { style: { display: 'block', fontSize: 12.5 } }, target.name), h('small', { style: { color: 'var(--text-muted)' } }, concealed ? yearLabel(league, waiverEntry(target), cards, logIndex, eraFactors, throughWeek) : `${targetPreview?.drawnSeason ?? '—'} SEASON`))),
                        h(PlayerSignals, { league, cards, entry: waiverEntry(target), logIndex, eraFactors, throughWeek, className: 'tl-waiver-target-signals' }),
                        concealed && h(HiddenYearResearch, { league, entry: waiverEntry(target), cards, logIndex, eraFactors, throughWeek }),
                        h('div', { className: 'tl-waiver-preview' },
                            h('div', null, h('small', null, targetPreview?.estimated ? 'Estimated points left · Vault season' : 'Points left · Vault season'), h('strong', null, previewPoints(targetPreview?.remainingPoints))),
                            !concealed && h('div', null, h('small', null, league.settings.gameDeckVersion === 1 ? 'Recorded season total' : `W1–${Engine.seasonEndWeek(league)} total`), h('strong', null, previewPoints(targetPreview?.totalPoints))),
                            h('div', null, h('small', null, 'Vault weeks left'), h('strong', null, Math.max(0, Engine.seasonEndWeek(league) - league.currentWeek + 1)))),
                        h('p', { className: 'tl-hint' }, matchupLabel),
                        h('fieldset', { className: 'tl-waiver-drop-list', disabled: filing || Boolean(cancelling) || alreadyClaimed },
                            h('legend', null, mustDrop ? 'Choose a player to drop' : 'Choose a drop (optional)'),
                            !mustDrop && h('button', { type: 'button', className: 'tl-waiver-drop-option', 'aria-pressed': !currentDropEntryId, onClick: () => chooseDrop('') }, 'Keep everyone · open slot'),
                            dropOptions.map(entry => {
                                const read = dropRead(entry);
                                const eligible = Boolean(Engine.waiverLandingSlot(league, team, target.position, entry.entryId));
                                return h('button', { key: entry.entryId, type: 'button', className: 'tl-waiver-drop-option' + (entry.entryId === currentDropEntryId ? ' is-selected' : ''),
                                    'aria-label': 'Drop ' + entry.name, 'aria-pressed': entry.entryId === currentDropEntryId, disabled: !eligible, onClick: () => chooseDrop(entry.entryId) },
                                    h('span', null, h('strong', null, entry.name), h('small', null, entry.position + ' · ' + (concealed ? yearLabel(league, entry, cards, logIndex, eraFactors, throughWeek) : entry.drawnSeason) + ' · ' + entry.slot)),
                                    h('span', null, h('b', null, previewPoints(read.remaining)), h('small', null, 'Est. pts left · recent pace')),
                                    h(PlayerSignals, { league, cards, entry, logIndex, eraFactors, throughWeek }),
                                    !eligible && h('small', { className: 'tl-waiver-drop-ineligible' }, 'Does not open a matching slot'));
                            })),
                        h('p', { className: 'tl-hint' }, estimatedPreviews ? 'Roster estimates use completed-game pace; free-agent estimates use recorded-season average. Future NFL game assignments stay sealed.' : 'Roster estimates use completed-game pace. Free-agent points left use the remaining archive weeks.'),
                        faab && h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 } },
                            h('span', { className: 'tl-label' }, 'Bid'),
                            h('span', { style: { color: 'var(--text-muted)' } }, '$'),
                            h('input', {
                                className: 'tl-input', type: 'number', 'aria-label': 'FAAB bid', min: 0, max: budgetAvailable, style: { width: 90 }, value: bidAmount, disabled: filing || Boolean(cancelling) || alreadyClaimed,
                                onChange: (e) => setBidAmount(Math.max(0, Math.round(Number(e.target.value)) || 0)),
                            }),
                            h('span', { className: 'tabular', style: { color: 'var(--text-muted)', fontSize: 11 } }, `of $${budgetAvailable} available`)),
                        target && landingSlot && h('p',{className:'tl-hint'},`If awarded: ${target.name} enters ${landingSlot}${dropEntry ? ', replacing '+dropEntry.name : ''}.`),
                        alreadyClaimed && h('div', { className: 'tl-acq-problem' }, h('p', null, 'This claim is pending. To change its drop or bid, cancel it and file a new claim; the new claim receives a new filing position.'),
                            h('button', { type: 'button', className: 'tl-btn', disabled: filing || Boolean(cancelling), onClick: () => cancelClaim(pendingTarget) }, cancelling === pendingTarget.claimId ? 'Cancelling…' : 'Cancel pending claim')),
                        h('div', { className: 'tl-waiver-submit' },
                            !alreadyClaimed && claimProblem && h('p', { className: 'tl-acq-problem tl-claim-submit-problem', id: 'vault-claim-problem', role: 'status' }, claimProblem),
                            h('small', { role: 'status' }, dropEntry ? 'Add ' + target.name + ' · Drop ' + dropEntry.name : mustDrop ? 'Choose a compatible player to drop' : 'Add ' + target.name + ' · Keep your roster'),
                            lastFiled.current === filedKey || alreadyClaimed
                                ? h('button', { type: 'button', className: 'tl-btn primary', disabled: filing || Boolean(cancelling), onClick: reviewPending }, 'Review pending claims')
                                : h('button', { className: 'tl-btn primary', disabled: !canFile, 'aria-describedby': claimProblem ? 'vault-claim-problem' : undefined, onClick: fileClaim }, filing ? 'FILING…' : '⚖ FILE CLAIM')))
                        : !claimMessage && h('p', { className: 'tl-empty' }, 'Pick a target from the wire to build a claim.'),
                    h('p', { className: 'tl-hint', style: { marginTop: 8 } }, faab ? 'Blind bid — highest offer wins; ties break by worst record.' : 'Processing order: reverse standings — worst record first.')),
                h('section', { className: 'tl-card tl-pending-claims', ref: pendingRef, tabIndex: -1, 'aria-label': 'Your pending claims' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Pending claims'), h('small', null, mine.length ? `${mine.length} pending · Your desk` : 'Your desk')),
                    !claimOpen && claimMessage && h('p', { className: 'tl-acq-notice', role: 'status', 'aria-atomic': true }, claimMessage),
                    mine.length ? h(React.Fragment, null,
                        h('p', { className: 'tl-acq-help' }, faab ? `Your claims run by highest bid, then filing order. $${budgetReserved} reserved · $${budgetAvailable} available. Ties between managers use reverse standings.` : 'Your claims run in filing order within your reverse-standings priority.'),
                        h('ol', { className: 'tl-pending-claim-list' }, mine.map((claim, index) => {
                            const drop = team.roster.find((e) => e.entryId === claim.dropEntryId);
                            const sharesDrop = claim.dropEntryId && mine.some(other => other.claimId !== claim.claimId && other.dropEntryId === claim.dropEntryId);
                            const destination = Engine.waiverLandingSlot(league, team, claim.addPosition, claim.dropEntryId);
                            return h('li', { key: claim.claimId, className: 'tl-pending-claim' },
                                h('div', null, h('small', null, `${index + 1} · W${claim.week}${faab ? ` · $${claim.bidAmount ?? 0} reserved` : ''}`), h('strong', null, `Add ${claim.addName} · ${claim.addPosition}`),
                                    h('span', null, claim.dropEntryId ? `Drop ${drop?.name || 'player no longer on roster'}` : 'Keep everyone'),
                                    destination && h('span', null, `If awarded now: enters ${slotName(destination)}`),
                                    sharesDrop && h('p', { className: 'tl-acq-help' }, 'Shared drop: only the first successful claim using this player can land. Later claims need that player to remain on your roster.')),
                                h('div', { className: 'tl-pending-claim-actions' },
                                    h('button', { type: 'button', className: 'tl-btn', disabled: filing || Boolean(cancelling), onClick: event => chooseTarget(claim.addIdentity, event) }, 'Review pending claim'),
                                    h('button', { type: 'button', className: 'tl-btn', disabled: filing || Boolean(cancelling), 'aria-label': `Cancel claim for ${claim.addName}`, onClick: () => cancelClaim(claim) }, cancelling === claim.claimId ? 'Cancelling…' : 'Cancel')));
                        })), h('p', { className: 'tl-acq-help' }, 'Players and open slots are checked again as each claim runs. A filed claim is not a guaranteed addition.'))
                        : h('p', { className: 'tl-empty' }, 'No claims on file from your desk.')),
                h(WaiverBatchReceipt, { league, team, onNavigate }),
                team.manager === 'ai' && h(GmProfile, { team, title: 'GM profile' }))));
    }

    function TradesSection({ league, cards, team, apply, logIndex, eraFactors, throughWeek, onNavigate, tradeRequest }) {
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : false;
        const others = league.teams.filter((t) => t.teamId !== team.teamId);
        const [counterpartyId, setCounterpartyId] = useState(others.length ? others[0].teamId : '');
        const [giveIds, setGiveIds] = useState([]);
        const [receiveIds, setReceiveIds] = useState([]);
        const [note, setNote] = useState('');
        const [deskView, setDeskView] = useState(() => league.phase === 'season' && league.trades.some(trade =>
            trade.status === 'pending' && trade.toTeamId === team.teamId && !(trade.deferredUntilWeek > league.currentWeek)) ? 'inbox' : 'builder');
        const [search, setSearch] = useState('');
        const [position, setPosition] = useState('ALL');
        const [sending, setSending] = useState(false);
        const [message, setMessage] = useState('');
        const [receiptId, setReceiptId] = useState('');
        const tradeBusy = React.useRef(false);
        const requestedTradeRef = React.useRef(null);
        const handledTradeRequest = React.useRef('');
        const requestedTrade = tradeRequest?.leagueId === league.leagueId && tradeRequest.teamId === team.teamId && team.manager === 'human'
            && (typeof tradeRequest.requestId === 'string' || Number.isFinite(tradeRequest.requestId))
            ? league.trades.find(trade => trade.tradeId === tradeRequest.tradeId && [trade.fromTeamId, trade.toTeamId].includes(team.teamId)) : null;
        const tradeRequestKey = requestedTrade ? JSON.stringify([league.leagueId, team.teamId, requestedTrade.tradeId, tradeRequest.requestId]) : '';
        React.useEffect(() => {
            if (!requestedTrade || handledTradeRequest.current === tradeRequestKey) return;
            const nextView = requestedTrade.status === 'pending' ? 'inbox' : 'history';
            if (deskView !== nextView) { setDeskView(nextView); return; }
            const row = requestedTradeRef.current;
            if (!row) return;
            handledTradeRequest.current = tradeRequestKey;
            const focus = () => { row.focus?.({ preventScroll: true }); row.scrollIntoView?.({ block: 'center', behavior: 'auto' }); };
            if (typeof window.requestAnimationFrame !== 'function') { focus(); return; }
            let second;
            const first = window.requestAnimationFrame(() => { second = window.requestAnimationFrame(focus); });
            return () => { window.cancelAnimationFrame?.(first); if (second != null) window.cancelAnimationFrame?.(second); };
        }, [tradeRequestKey, requestedTrade, deskView]);
        const entryById = useMemo(() => {
            const map = new Map();
            for (const item of league.teams) for (const entry of item.roster) map.set(entry.entryId, entry);
            return map;
        }, [league.teams]);
        const recordedNames = useMemo(() => {
            const names = new Map();
            const record = entry => { if (entry?.entryId && typeof entry.name === 'string' && entry.name) names.set(entry.entryId, entry.name); };
            (league.draftPicks || []).forEach(record);
            for (const week of league.finalizedWeeks || []) {
                for (const result of week.results || []) for (const entry of [...(result.starters || []), ...(result.bench || [])]) record(entry);
                (week.playerProduction || []).forEach(record);
            }
            return names;
        }, [league.draftPicks, league.finalizedWeeks]);

        if (!league.settings.tradesEnabled) {
            return h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Trade center'), h('small', null, 'OFFLINE')),
                h('span', { className: 'tl-pill bad' }, 'DISABLED'),
                h('p', { style: { marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)' } }, "Trades are switched off in this league's settings. The desk never opens."));
        }
        const revealed = league.seasonsRevealed;
        const concealed = league.settings.hiddenYears && !league.yearsRevealed;
        const deskOpen = league.phase === 'season' && league.weekStage === 'claims';
        const responseOpen = league.phase === 'season' && league.weekStage === 'lineup';
        const lineupOpen = league.phase === 'season' && ['claims', 'lineup'].includes(league.weekStage);
        const counterparty = league.teams.find((t) => t.teamId === counterpartyId);
        const valueRead = entry => {
            if (concealed) {
                const read = window.App.TimeLeagueHiddenYears?.read(league, entry, cards, logIndex, throughWeek, eraFactors);
                const observed = read?.estimateBasis === 'completed Vault games';
                return { value: Number.isFinite(read?.estimatedAverage) ? read.estimatedAverage : null,
                    evidence: observed ? 'Completed Vault games' : 'Candidate archive',
                    basis: observed ? 'League scoring' : read?.candidates?.length ? read.candidates.every(row => row.basis === 'league scoring') ? 'League scoring' : read.candidates.every(row => row.basis === 'reference scoring') ? 'Reference scoring' : 'Mixed scoring' : 'Public archive' };
            }
            const card = cards.get(entry.identity);
            const value = revealed ? card?.seasons?.find(row => row.season === entry.drawnSeason)?.points : card?.peak;
            return { value: Number.isFinite(value) ? value : null, basis: 'Reference scoring' };
        };
        const valueOf = entry => valueRead(entry).value;
        const points = value => Number.isFinite(value) ? fmt1(value) : '—';
        const give = giveIds.filter((id) => team.roster.some((e) => e.entryId === id));
        const receive = counterparty ? receiveIds.filter((id) => counterparty.roster.some((e) => e.entryId === id)) : [];
        const packageValue = ids => ids.every(id => entryById.has(id) && Number.isFinite(valueOf(entryById.get(id)))) ? ids.reduce((sum, id) => sum + valueOf(entryById.get(id)), 0) : null;
        const giveValue = packageValue(give), receiveValue = packageValue(receive);
        const balanced = give.length > 0 && give.length === receive.length;
        const bases = new Set([...give, ...receive].map(id => valueRead(entryById.get(id)).basis));
        const comparable = Number.isFinite(giveValue) && Number.isFinite(receiveValue) && bases.size <= 1 && !bases.has('Mixed scoring');
        const grade = comparable ? fairnessGrade(giveValue, receiveValue) : null;
        const offer = { fromTeamId: team.teamId, toTeamId: counterpartyId, giveEntryIds: give, receiveEntryIds: receive };
        const acceptanceProblem = balanced ? Engine.tradeProblem(league, offer) : null;
        const aiPreview = counterparty?.manager === 'ai' && balanced && typeof AI.previewTrade === 'function' ? AI.previewTrade(league, offer, cards) : null;
        const acceptancePercent = aiPreview && [0, 100].includes(aiPreview.percent) ? aiPreview.percent : null;
        const toggle = (ids, id) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
        const sortByValue = (roster) => [...roster].sort((l, r) => {
            const left = valueOf(l), right = valueOf(r);
            return (left == null || right == null ? left == null && right == null ? 0 : left == null ? 1 : -1 : right - left) || l.entryId.localeCompare(r.entryId);
        });
        const visibleRoster = roster => sortByValue(roster).filter(entry =>
            (position === 'ALL' || entry.position === position) && entry.name.toLowerCase().includes(search.trim().toLowerCase()));
        const pickRow = (entry, checked, onToggle) => h('label', { key: entry.entryId, className: `tl-trade-player tl-decision-row${checked ? ' is-selected' : ''}` },
            h('input', { type: 'checkbox', checked, onChange: onToggle, disabled: !deskOpen || sending, 'aria-label': `Select ${entry.name}` }),
            h('span', { className: `tl-pos ${entry.position}` }, entry.position),
            h('span', { className: 'tl-trade-player-name' }, h('strong', null, entry.name),
                h('small', null, `${concealed ? yearLabel(league, entry, cards, logIndex, eraFactors, throughWeek) : revealed ? entry.drawnSeason + ' season' : 'Sealed season'} · ${entry.slot}`),
                concealed && h('small', null, `${valueRead(entry).evidence} · ${valueRead(entry).basis}`)),
            h('span', { className: 'tabular' }, points(valueOf(entry))));
        const teamById = (id) => league.teams.find((t) => t.teamId === id);
        const names = (ids) => ids.map((id) => entryById.get(id)?.name || recordedNames.get(id) || 'Unavailable player').join(', ') || '—';
        const pending = league.trades.filter((t) => t.status === 'pending' && (t.fromTeamId === team.teamId || t.toTeamId === team.teamId));
        const settled = league.trades.filter((t) => t.status !== 'pending').slice().reverse();
        const receipt = league.trades.find(trade => trade.tradeId === receiptId) || (!pending.length && settled.find(trade => trade.fromTeamId === team.teamId || trade.toTeamId === team.teamId));
        const receivedNames = receipt ? names(receipt.toTeamId === team.teamId ? receipt.giveEntryIds : receipt.receiveEntryIds) : '';
        const sentNames = receipt ? names(receipt.toTeamId === team.teamId ? receipt.receiveEntryIds : receipt.giveEntryIds) : '';
        const response = async (trade, decision) => {
            if (tradeBusy.current || !responseOpen || trade.deferredUntilWeek > league.currentWeek) return;
            const current = league.trades.find(row => row.tradeId === trade.tradeId && row.status === 'pending');
            if (!current) { setMessage('This offer is no longer pending. Review the trade log for its saved outcome.'); return; }
            const problem = decision === 'accept' ? Engine.tradeProblem(league, current) : null;
            if (problem) { setMessage(`Cannot accept this offer: ${problem}`); return; }
            tradeBusy.current = true; setSending(true); setMessage('');
            try {
                const next = decision === 'delay' ? Engine.deferTrade(league, trade.tradeId)
                    : decision === 'ping' ? AI.aiRespondToTrades(league, cards, nowIso())
                        : Engine.respondToTrade(league, trade.tradeId, decision === 'accept', '', nowIso());
                if (next === league) { setMessage(decision === 'ping' ? 'The GM has not changed this offer. Its current status is still shown in the inbox.' : 'This offer could not be changed. Review its current ownership and status.'); return; }
                const saved = await apply(next, decision === 'ping' ? { type: 'ping-ai' } : { type: 'respond-trade', tradeId: trade.tradeId, ...(decision === 'delay' ? { decision: 'delay' } : { accept: decision === 'accept' }) });
                if (saved) setReceiptId(trade.tradeId);
                else setMessage('Your response was not saved. The offer remains available; resolve the save and try again.');
            } catch (_error) { setMessage('Your response could not be saved. Review the current offer and try again.'); }
            finally { tradeBusy.current = false; setSending(false); }
        };
        const send = async () => {
            if (!counterparty || !balanced || tradeBusy.current || !deskOpen) return;
            tradeBusy.current = true; setSending(true); setMessage('');
            try {
                const next = Engine.proposeTrade(league, { ...offer, note }, nowIso());
                if (next === league) { setMessage('This offer cannot be submitted. Check that both teams still own their selected players.'); return; }
                const saved = await apply(next, { type: 'trade', teamId: team.teamId, toTeamId: counterparty.teamId, giveEntryIds: give, receiveEntryIds: receive, note });
                if (saved) { setGiveIds([]); setReceiveIds([]); setNote(''); setReceiptId(''); setMessage('Offer sent. Follow the response in your inbox.'); setDeskView('inbox'); }
                else setMessage('Offer was not saved. Your selections are still here to try again.');
            } catch (_error) { setMessage('Offer could not be saved. Please try again.'); }
            finally { tradeBusy.current = false; setSending(false); }
        };
        const tradePackage = (label, owner, ids, total, onToggle, direction) => {
            const scoringBases = new Set(ids.map(id => valueRead(entryById.get(id)).basis));
            const basis = scoringBases.size > 1 ? 'Mixed scoring' : [...scoringBases][0] || (concealed ? 'Public averages' : 'Reference scoring');
            return h('section', { className: 'tl-trade-package', 'aria-label': `Selected ${direction} package` },
            h('header', null, h('div', null, h('strong', null, label), h('small', null, owner?.name || 'Choose a partner')),
                h('div', { className: 'tl-trade-package-total' }, h('strong', { className: 'tabular' }, ids.length ? points(total) : '—'), h('small', null, concealed ? `Est. pts/game · ${basis}` : 'Reference points'))),
            ids.length ? ids.map(id => h('button', { key: id, type: 'button', className: 'tl-trade-chip tl-trade-package-player', disabled: sending,
                onClick: () => onToggle(id), 'aria-label': `Remove ${entryById.get(id)?.name} from ${direction} package` },
                h('span', null, entryById.get(id)?.name), h('small', null, entryById.get(id)?.position), h('span', { 'aria-hidden': true }, '×')))
                : null);
        };
        const comparisonLabel = balanced ? comparable ? grade.label : 'Comparison unavailable' : 'Build both sides';
        const pointDelta = balanced && comparable ? Math.round((receiveValue - giveValue) * 10) / 10 : null;
        const deltaLabel = pointDelta == null ? '—' : `${pointDelta >= 0 ? '+' : ''}${fmt1(pointDelta)}`;
        const comparisonDelta = `${give.length} for ${receive.length} · ${balanced && comparable ? `${receiveValue - giveValue >= 0 ? '+' : ''}${fmt1(receiveValue - giveValue)} ${concealed ? 'estimated points/game' : 'reference points'} to your side` : balanced ? 'Missing values or different scoring bases cannot be graded.' : 'Equal-count swaps keep roster sizes fixed.'}`;
        const comparisonBasis = concealed ? 'Completed Vault averages or public candidate-archive averages, as shown with each player’s scoring basis. The comparison does not consult a hidden year or guarantee acceptance.'
            : 'Archived season totals use reference scoring, which can differ from your league. This comparison is not a forecast or acceptance guarantee.';
        const side = (label, owner, ids, onToggle) => h('section', { className: 'tl-trade-side' },
            h('div', { className: 'tl-trade-side-head' }, h('div', null, h('small', null, label), h('h3', null, owner?.name || 'Choose a partner')),
                h('span', null, `${ids.length} selected`)),
            h('div', { className: 'tl-trade-list-label' }, h('span', null, `ROSTER · ${owner?.roster.length || 0} PLAYERS`), h('span', null, concealed ? 'EST. PTS / GAME' : 'REFERENCE PTS')),
            h('div', { className: 'tl-trade-player-list' }, owner && visibleRoster(owner.roster).map(entry => pickRow(entry, ids.includes(entry.entryId), () => onToggle(entry.entryId))),
                (!owner || !visibleRoster(owner.roster).length) && h('p', { className: 'tl-empty' }, 'No players match these filters.')));

        return h('div', { className: 'tl-trade-desk' },
            h('div', { className: 'tl-trade-toolbar' },
                h('div', null, h('span', { className: 'tl-label' }, 'TRADE CENTER'), h('strong', null, 'Build your next move')),
                h('nav', { className: 'tl-trade-tabs', 'aria-label': 'Trade center views' },
                    [['builder', 'Trade builder'], ['inbox', `Inbox · ${pending.length}`], ['history', 'Trade log']].map(([id, label]) => h('button', { key: id, className: `tl-btn${deskView === id ? ' primary' : ''}`, 'aria-pressed': deskView === id, onClick: () => setDeskView(id) }, label)))),
            message && h('p', { className: 'tl-trade-notice', role: 'status' }, message),
            receipt && h('section', { className: 'tl-acq-notice tl-trade-receipt', role: 'status', 'aria-label': 'Saved trade outcome', 'aria-atomic': true },
                h('small', { className: 'tl-label' }, `SAVED · W${receipt.respondedWeek || receipt.week} · ${teamById(receipt.fromTeamId)?.name || 'Manager'} ↔ ${teamById(receipt.toTeamId)?.name || 'Manager'}`),
                h('strong', null, receipt.status === 'accepted' ? 'Trade accepted' : receipt.status === 'rejected' ? 'Offer rejected' : receipt.status === 'withdrawn' ? 'Offer withdrawn' : receipt.deferredUntilWeek > league.currentWeek ? `Offer delayed until Week ${receipt.deferredUntilWeek}` : 'Response saved · updating offer'),
                receipt.status === 'accepted' ? h('p', null, `You received ${receivedNames} and sent ${sentNames}. ${lineupOpen ? 'Received players enter the bench; set your starting lineup before locking it.' : 'Received players entered the bench when this trade settled.'}`)
                    : h('p', null, receipt.status === 'pending' && !(receipt.deferredUntilWeek > league.currentWeek) ? 'The latest saved status will appear here when the room updates.' : 'No players moved.'),
                receipt.note && ['rejected', 'withdrawn'].includes(receipt.status) && h('p', null, receipt.note),
                receipt.status === 'accepted' && onNavigate && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('roster') }, lineupOpen ? 'Set lineup' : 'View lineup')),
            deskView === 'builder' && h('div', { className: `tl-trade-builder-layout${counterparty?.manager === 'ai' ? ' has-owner' : ''}` },
            h('div', { className: 'tl-card tl-trade-builder' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Trade builder'), h('small', null, deskOpen ? `W${league.currentWeek} · DESK OPEN` : 'DESK CLOSED')),
                h('div', { className: 'tl-trade-controls' },
                    h('label', null, h('span', { className: 'tl-label' }, 'PARTNER'),
                        h('select', { className: 'tl-select', value: counterpartyId, disabled: sending, onChange: e => { setCounterpartyId(e.target.value); setReceiveIds([]); } },
                            others.map(item => h('option', { key: item.teamId, value: item.teamId }, item.name)))),
                    h('input', { className: 'tl-input', placeholder: 'Search either roster…', 'aria-label': 'Search trade players', value: search, onChange: e => setSearch(e.target.value) }),
                    h('select', { className: 'tl-select', 'aria-label': 'Filter trade position', value: position, onChange: e => setPosition(e.target.value) },
                        ['ALL', ...POSITION_ORDER.filter(pos => [...team.roster, ...(counterparty?.roster || [])].some(entry => entry.position === pos))].map(pos => h('option', { key: pos, value: pos }, pos === 'ALL' ? 'All positions' : pos)))),
                h('section', { className: 'tl-trade-brief', 'aria-label': 'Trade summary', 'aria-live': 'polite', 'aria-atomic': true },
                    h('div', { className: 'tl-trade-brief-metrics' },
                        h('div', { className: `tl-trade-value-grade${grade?.tone ? ` is-${grade.tone}` : ''}`, title: comparisonBasis },
                            h('small', null, 'Value grade'), h('strong', null, balanced && comparable ? grade.grade : '—'), h('span', null, comparisonLabel)),
                        h('div', { className: `tl-trade-point-delta${pointDelta > 0 ? ' is-positive' : pointDelta < 0 ? ' is-negative' : ''}` },
                            h('small', null, 'To your side'), h('strong', { className: 'tabular' }, deltaLabel), h('span', null, concealed ? 'est. pts/game' : 'reference pts')),
                        counterparty?.manager === 'ai' && h('div', { className: 'tl-trade-ai-preview', title: 'Current terms: 100% means this GM would accept now; 0% means reject. This is a deterministic rule check, not a calibrated forecast. Roster moves can change it.' },
                            h('small', null, 'AI acceptance'), h('strong', { className: 'tabular' }, acceptancePercent == null ? '—' : `${acceptancePercent}%`),
                            acceptancePercent != null && h('span', { className: 'tl-trade-acceptance-track', role: 'progressbar', 'aria-label': 'AI acceptance for current terms', 'aria-valuenow': acceptancePercent, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: `${acceptancePercent}%` } })),
                            h('span', null, aiPreview?.label || 'Complete a legal offer'))),
                    h('span', { className: 'tl-trade-counts', title: comparisonDelta }, `${give.length} for ${receive.length}`),
                    acceptanceProblem ? h('p', { className: 'tl-acq-problem' }, `Cannot accept this package with the current rosters: ${acceptanceProblem} You may propose it during planning; rosters are checked again after waivers.`)
                        : balanced && h('p', { className: 'tl-acq-help' }, 'Current roster checks pass. Both rosters are checked again when the offer is accepted.')),
                h('div', { className: 'tl-trade-packages', 'aria-label': 'Selected trade packages' },
                    tradePackage('YOU SEND', team, give, giveValue, id => setGiveIds(toggle(giveIds, id)), 'send'),
                    tradePackage('YOU RECEIVE', counterparty, receive, receiveValue, id => setReceiveIds(toggle(receiveIds, id)), 'receive')),
                h('div', { className: 'tl-trade-sides' },
                    side('YOUR ROSTER', team, give, id => setGiveIds(toggle(giveIds, id))),
                    side('PARTNER ROSTER', counterparty, receive, id => setReceiveIds(toggle(receiveIds, id)))),
                h('details', { className: 'tl-trade-comparison-details' }, h('summary', null, 'Comparison details'),
                    h('div', { className: 'tl-trade-verdict' },
                        h('strong', null, comparisonLabel),
                        h('span', null, `You send ${points(giveValue)} · You receive ${points(receiveValue)} ${concealed ? 'estimated points/game' : 'reference points'}`),
                        h('small', null, comparisonBasis),
                        counterparty?.manager === 'ai' && h('p', null, 'AI acceptance checks the current terms with this GM’s deterministic rules: 100% means accept now; 0% means reject. It is not a calibrated forecast, and roster moves can change the decision.'),
                        aiPreview?.reason && h('p', null, aiPreview.reason))),
                h('div', { className: 'tl-trade-submit' },
                    h('input', { className: 'tl-input', 'aria-label': 'Trade offer note', placeholder: 'Add a note to your offer…', value: note, disabled: sending, onChange: e => setNote(e.target.value) }),
                    h('button', { className: 'tl-btn', disabled: sending || (!give.length && !receive.length), onClick: () => { setGiveIds([]); setReceiveIds([]); } }, 'Clear'),
                    h('button', { className: 'tl-btn primary', disabled: sending || !deskOpen || !balanced || !counterparty, onClick: send }, sending ? 'Sending…' : 'Send offer')),
                ),
                counterparty?.manager === 'ai' && h('aside', { className: 'tl-trade-owner-panel', 'aria-label': 'Owner DNA' },
                    h('details', { className: 'tl-trade-gm', open: !phone }, h('summary', null, `Owner DNA · ${counterparty.name}`), h(GmProfile, { team: counterparty, title: 'GM profile' })))),
            h('div', { className: 'tl-trade-records', hidden: deskView === 'builder' },
                h('div', { className: 'tl-card', hidden: deskView !== 'inbox' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Inbox'), h('small', null, pending.length ? `${pending.length} PENDING` : 'DESK CLEAR')),
                    pending.map((trade) => {
                        const from = teamById(trade.fromTeamId); const to = teamById(trade.toTeamId);
                        const incoming = trade.toTeamId === team.teamId;
                        const toAi = to?.manager === 'ai';
                        const deferred = trade.deferredUntilWeek > league.currentWeek;
                        const canRespond = responseOpen && !deferred;
                        const problem = Engine.tradeProblem(league, trade);
                        return h('div', { key: trade.tradeId, 'data-trade-id': trade.tradeId, tabIndex: -1, ref: requestedTrade?.tradeId === trade.tradeId ? requestedTradeRef : null, style: { padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' } },
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                                h('span', { className: `tl-pill ${incoming ? 'gold' : 'info'}` }, incoming ? 'INCOMING' : 'OUTGOING'),
                                h('span', { className: 'tl-label' }, `W${trade.week} · ${from?.name ?? trade.fromTeamId} → ${to?.name ?? trade.toTeamId}`)),
                            h('p', { style: { fontSize: 12, margin: '2px 0', color: 'var(--text-secondary)' } }, h('b', { style: { color: 'var(--white)' } }, from?.name ?? trade.fromTeamId), ` sends ${names(trade.giveEntryIds)}`),
                            h('p', { style: { fontSize: 12, margin: '2px 0 6px', color: 'var(--text-secondary)' } }, h('b', { style: { color: 'var(--white)' } }, to?.name ?? trade.toTeamId), ` sends ${names(trade.receiveEntryIds)}`),
                            trade.deferredUntilWeek > league.currentWeek && h('p', { className: 'tl-hint' }, `Delayed until Week ${trade.deferredUntilWeek}`),
                            trade.note && h('p', { className: 'tl-trade-offer-reason' }, trade.note),
                            problem && h('p', { className: 'tl-acq-problem' }, `Cannot accept now: ${problem}`),
                            incoming && deskOpen && !canRespond && !deferred && h('p', { className: 'tl-hint' }, 'Trade decisions open after waivers settle.'),
                            toAi && !canRespond && !deferred && h('p', { className: 'tl-hint' }, deskOpen
                                ? 'The GM will respond after the waiver batch runs, during Decisions & lineup.'
                                : 'Trade responses are closed at this stage.'),
                            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                                incoming && !toAi && h(React.Fragment, null,
                                    h('button', { className: 'tl-btn', disabled: sending || !canRespond || Boolean(problem), onClick: () => response(trade, 'accept') }, '✓ ACCEPT'),
                                    h('button', { className: 'tl-btn', disabled: sending || !canRespond, onClick: () => response(trade, 'reject') }, '✕ REJECT'),
                                    h('button', { className: 'tl-btn', disabled: sending || !canRespond, onClick: () => response(trade, 'delay') }, 'DELAY TO NEXT WEEK')),
                                toAi && h(React.Fragment, null,
                                    h('span', { className: 'tl-pill info' }, canRespond ? 'THE GM IS CONSIDERING' : deferred ? 'DELAYED' : 'QUEUED FOR REVIEW'),
                                    canRespond && h('button', { className: 'tl-btn', disabled: sending, onClick: () => response(trade, 'ping') }, '📡 PING THE GM')),
                                !incoming && !toAi && h('span', { className: 'tl-pill info' }, 'AWAITING RESPONSE')));
                    }),
                    !pending.length && h('p', { className: 'tl-empty' }, others.some(item => item.manager === 'ai')
                        ? 'No pending offers. Rival GMs look for fair roster fits each week; a new offer appears here when they find one.'
                        : 'No pending offers on the desk.')),
                h('div', { className: 'tl-card', hidden: deskView !== 'history' },
                    h('div', { className: 'tl-card-title' }, h('span', null, 'Trade history'), h('small', null, 'league-wide')),
                    settled.map((trade) => {
                        const from = teamById(trade.fromTeamId); const to = teamById(trade.toTeamId);
                        const accepted = trade.status === 'accepted';
                        return h('div', { key: trade.tradeId, className: `tl-feedrow${accepted ? '' : ' caution'}`, 'data-trade-id': trade.tradeId, tabIndex: -1, ref: requestedTrade?.tradeId === trade.tradeId ? requestedTradeRef : null },
                            h('time', null, `W${trade.week}`),
                            h('div', null, h('p', { style: { margin: 0 } },
                                h('span', { className: `tl-pill ${accepted ? 'good' : trade.status === 'rejected' ? 'bad' : 'warn'}` }, trade.status.toUpperCase()),
                                ` ${from?.name ?? trade.fromTeamId} ${accepted ? 'sent' : 'offered'} ${names(trade.giveEntryIds)} for ${names(trade.receiveEntryIds)} from ${to?.name ?? trade.toTeamId}`),
                                trade.note && h('p', { style: { fontSize: 11, fontStyle: 'italic', color: 'var(--text-faint, rgba(189,184,173,0.6))', margin: '4px 0 0' } }, `"${trade.note}"`)));
                    }),
                    !settled.length && h('div', { className: 'tl-feedrow' }, h('time', null, 'NONE'), h('p', null, 'No trades settled yet this season.')))));
    }

    const BADGE_TIERS = ['season', 'performance', 'roster', 'desk'];

    /** Mirrors War Room's real achievements.js chip grid (js/tabs/trophy-room.js
     * renderAchievementsCard) — tier-tinted, earned/unearned styling handled by
     * .tl-badge-chip.earned in CSS, grouped by tier with a progress bar for what's
     * still open. See js/shared/time-league-achievements.js for the catalog. */
    function AchievementsSection({ league, team }) {
        const Achievements = window.App.TimeLeagueAchievements;
        const stats = useMemo(() => Achievements.computeStats(league, team.teamId), [league, team.teamId]);
        const { earned, unearned } = useMemo(() => Achievements.evaluate(stats), [stats]);
        const all = [...earned, ...unearned];
        const badgeChip = (badge) => {
            const isEarned = badge.progress >= 1;
            return h('div', { key: badge.id, className: `tl-badge-chip${isEarned ? ' earned' : ''}`, style: { '--tier-color': Achievements.tierColor(badge.tier) } },
                h('span', { className: 'tl-badge-icon' }, badge.icon),
                h('div', { className: 'tl-badge-body' },
                    h('div', { className: 'tl-badge-label' }, badge.label, isEarned && h('span', { className: 'tl-pill gold' }, 'EARNED')),
                    h('div', { className: 'tl-badge-desc' }, badge.description),
                    !isEarned && h('div', { className: 'tl-badge-progress' }, h('div', { className: 'tl-badge-progress-fill', style: { width: `${Math.round(badge.progress * 100)}%` } })),
                    !isEarned && h('div', { className: 'tl-badge-desc' }, `${Math.round(badge.value * 10) / 10} / ${badge.target}`)));
        };
        return h('div', { className: 'tl-card' },
            h('div', { className: 'tl-card-title' }, h('span', null, 'Trophy Case'), h('small', null, `${earned.length}/${all.length} earned — ${team.name}`)),
            BADGE_TIERS.map((tierId) => {
                const tierBadges = all.filter((b) => b.tier === tierId).sort((a, b) => b.progress - a.progress);
                if (!tierBadges.length) return null;
                return h(React.Fragment, { key: tierId },
                    h('div', { className: 'tl-badge-tier-label' }, Achievements.tierLabel(tierId)),
                    h('div', { className: 'tl-badge-grid' }, tierBadges.map(badgeChip)));
            }));
    }

    function WrTimeLeagueTeamPanel({ league, cards, section, activeTeamId, onSelectTeam, onUpdate, onlineMeta, logIndex, eraFactors, onBrowseWaivers, waiverSlot, waiverContext, onClearWaiverContext, throughWeek, onStats, onNavigate, onReopenPlanning, tradeRequest }) {
        const archiveCards = cards;
        cards = Engine.cardsFor(league, cards);
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const humanTeams = league.teams.filter(item => item.manager === 'human');
        const requestedTeam = league.teams.find(item => item.teamId === (onlineMeta?.seatTeamId || activeTeamId));
        const team = onlineMeta ? requestedTeam : requestedTeam?.manager === 'human' ? requestedTeam : humanTeams[0];
        const recovery = Engine.planningRecovery(league);
        const apply = (next, action) => {
            if (next === league || !team || team.manager !== 'human' || (onlineMeta && team.teamId !== onlineMeta.seatTeamId)) return false;
            return onUpdate(next, action);
        };
        return h('div', { className: 'tl-team-workspace' },
            recovery.active && ['roster', 'waivers', 'trades'].includes(section) && h('section', { className: 'tl-card tl-planning-recovery-window', 'aria-label': 'Reopened planning window' },
                h('h3', null, `Planning reopened · Week ${league.currentWeek}`),
                h('p', null, 'Extra planning for human managers. Earlier waiver awards, settled trades and spent FAAB stay final. Computer managers will not file another automatic waiver batch; existing trade offers can still receive answers.'),
                onNavigate && (league.settings.waiversEnabled && section !== 'waivers' ? h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('waivers') }, 'Open free agents')
                    : !league.settings.waiversEnabled && league.settings.tradesEnabled && section !== 'trades' ? h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('trades') }, 'Open trades') : null)),
            !onlineMeta && humanTeams.length > 1 && h('label', { className: 'tl-hotseat-manager' }, 'Managing',
                h('select', { className: 'tl-select', value: team?.teamId || '', 'aria-label': 'Hotseat manager', onChange: event => onSelectTeam(event.target.value) },
                    humanTeams.map(item => h('option', { key: item.teamId, value: item.teamId }, item.name)))),
            !team
                ? h('div', { className: 'tl-card' }, h('p', { className: 'tl-empty' }, 'Join a manager seat to open your roster.'))
                : section === 'roster' ? h(RosterSection, { key: team.teamId, league, cards, archiveCards, team, apply, logIndex, eraFactors, onBrowseWaivers, throughWeek, onStats, onNavigate, onlineMeta, onReopenPlanning })
                    : section === 'waivers' ? h(WaiversSection, { key: team.teamId, league, cards, team, standings, apply, waiverSlot, waiverContext, onClearWaiverContext, logIndex, eraFactors, throughWeek, onNavigate })
                        : section === 'trades' ? h(TradesSection, { key: team.teamId, league, cards, team, apply, logIndex, eraFactors, throughWeek, onNavigate, tradeRequest })
                            : h(AchievementsSection, { key: team.teamId, league, team }));
    }

    window.WrTimeLeagueTeamPanel = WrTimeLeagueTeamPanel;
})();
