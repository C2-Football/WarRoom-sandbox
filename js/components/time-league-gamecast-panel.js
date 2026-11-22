// ══════════════════════════════════════════════════════════════════
// js/components/time-league-gamecast-panel.js — window.WrTimeLeagueGamecastPanel
// The Gameday tab: a scoreboard strip (every matchup, ESPN-style) and a
// hero matchup card for the human team (Sleeper-style live score bar +
// win probability), then the pre-run week command panel or the live/replay
// gamecast player (owns the autoplay timer), box scores, and the week
// archive. Ported from the GamedayPanel/BoxScores portion of The Duat's
// app/TimeLeagueView.tsx, with the scoreboard strip/hero card added.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useState, useEffect, useCallback, useMemo, useRef } = React;
    const h = React.createElement;

    const Engine = window.App.TimeLeagueEngine;
    const AI = window.App.TimeLeagueAI;
    const Gamecast = window.App.TimeLeagueGamecast;

    const GAMECAST_END = Gamecast.GAMECAST_END;
    /** Playback durations are wall-clock seconds, excluding pauses. */
    const CAST_DURATIONS = [300, 180, 60];

    // Use the lineup that played this week, including during archived replays.
    // Saved results are deliberately hidden until their scoring moments arrive.
    function LiveLineups({ league, row, singleTeamId, teams, rosterSlots, weekData, landed, final, currentPlay, identifiedYears }) {
        const ids = row ? row.mineIsHome ? [row.home, row.away] : [row.away, row.home] : singleTeamId ? [singleTeamId] : [];
        if (!ids.length) return null;
        const unpaired = ids.length === 1;
        const sides = ids.map(teamId => {
            const team = teams.find(item => item.teamId === teamId);
            const starters = weekData ? weekData.results.find(result => result.teamId === teamId)?.starters || []
                : (team?.roster || []).filter(entry => !['BN', 'IR', 'TAXI'].includes(entry.slot));
            const moments = new Map();
            for (const event of landed) {
                if (event.teamId !== teamId) continue;
                const value = moments.get(event.entryId) || { cents: 0, stats: {} };
                value.cents += Math.round(event.points * 100);
                Gamecast.addStats(value.stats, event.stats || {});
                if (event.kind === 'availability') value.availability = event;
                moments.set(event.entryId, value);
            }
            return { team, starters: starters.map(entry => ({ ...entry,
                points: final ? entry.points || 0 : (moments.get(entry.entryId)?.cents || 0) / 100,
                stats: final ? entry.stats : moments.get(entry.entryId)?.stats,
                availabilityUpdate: moments.get(entry.entryId)?.availability,
                scoring: !final && currentPlay?.teamId === teamId && currentPlay.entryId === entry.entryId,
            })) };
        });
        const slots = window.App.TimeLeagueRoster.ROSTER_SLOT_IDS.filter(slot => !['BN', 'IR', 'TAXI'].includes(slot));
        const rows = slots.flatMap(slot => {
            const entries = sides.map(side => side.starters.filter(entry => entry.slot === slot));
            const count = Math.max(rosterSlots[slot] || 0, ...entries.map(list => list.length));
            return Array.from({ length: count }, (_, index) => ({ slot, index, entries: entries.map(list => list[index]) }));
        });
        const concealed = league.settings.hiddenYears && !league.yearsRevealed;
        const player = (entry, side) => {
            const identified = entry && identifiedYears?.get(entry.editionId || entry.entryId);
            return h('div', { className: `tl-live-player is-${side}${entry?.scoring ? ' is-scoring' : ''}`, 'data-entry-id': entry?.entryId },
            h('div', { className: 'tl-live-player-name' },
                h('strong', null, entry?.name || 'Empty slot'),
                entry && h('small', { className: 'tl-live-player-edition' },
                    h('span', { className: 'tl-live-edition-full' }, h('span', { className: identified || !concealed ? 'tl-scouting-year-inline' : undefined }, concealed ? identified || window.App.TimeLeagueHiddenYears.label(league, entry) : entry.drawnSeason), ` · ${entry.position}`),
                    h('span', { className: 'tl-live-edition-compact', 'aria-label': identified ? `Identified season: ${identified}` : undefined }, h('span', { className: identified || !concealed ? 'tl-scouting-year-inline' : undefined }, concealed ? identified || window.App.TimeLeagueHiddenYears.decadeFor(league, entry) || 'Hidden' : entry.drawnSeason),
                        entry.slot !== entry.position ? ` · ${entry.position}` : '')),
                entry?.availabilityUpdate && h('small', { className: 'tl-live-availability', role: 'status' },
                    entry.availabilityUpdate.status === 'out' ? 'OUT · VAULT SIMULATION' : 'NO RECORDED APPEARANCE')),
            h('strong', { className: 'tl-live-player-points tabular' }, entry ? entry.points.toFixed(2) : '—'),
            entry && h('span', { className: `tl-live-player-stats${!weekData && !final ? ' is-pregame' : ''}${final && !entry.stats && !entry.availabilityUpdate ? ' is-no-game' : ''}` }, Gamecast.describeStats(entry.stats || {}, 2) || (final ? entry.stats ? 'No scoring stats' : 'No game recorded' : weekData ? 'No scoring yet' : 'Awaiting kickoff')));
        };
        return h('section', { className: `tl-live-lineups${unpaired ? ' is-unpaired' : ''}`, 'aria-label': unpaired ? 'Starting lineup on a regular-season bye' : 'Head-to-head starting lineups' },
            h('div', { className: 'tl-live-lineups-title' },
                h('h3', null, unpaired ? 'Your scoring lineup' : 'Lineup matchup'), h('small', null, final ? 'FINAL POINTS' : weekData ? 'LIVE POINTS' : 'STARTERS'),
                h('label', { className: 'tl-coach-details' }, h('input', { type: 'checkbox' }), 'Full stats')),
            h('p', { className: 'tl-live-phone-context' }, [!weekData && !final ? 'Awaiting kickoff' : null, concealed ? 'Hidden-year mode' : null].filter(Boolean).join(' · ')),
            h('div', { className: 'tl-live-lineups-head' }, h('strong', null, sides[0].team?.name || ids[0]), h('span', null, unpaired ? 'NO HEAD-TO-HEAD' : 'VS'), !unpaired && h('strong', null, sides[1].team?.name || ids[1])),
            rows.map(item => h('div', { key: `${item.slot}:${item.index}`, className: 'tl-live-lineup-row' },
                player(item.entries[0], 'left'),
                h('span', { className: 'tl-live-lineup-slot', title: item.slot.replaceAll('_', ' ') }, item.slot === 'SUPER_FLEX' ? 'SFLEX' : item.slot),
                !unpaired && player(item.entries[1], 'right'))));
    }

    function ScoringReceipt({ starter, scoring, eraAdjusted }) {
        const saved = Number.isFinite(starter.points) ? starter.points : null;
        const receipt = window.App.TimeLeagueSeason.scoringBreakdown(starter.stats, scoring);
        const factor = Number.isFinite(starter.factor) ? starter.factor : eraAdjusted ? null : 1;
        const calculated = receipt && factor !== null ? Math.round(receipt.total * factor * 100) / 100 : null;
        const matches = saved !== null && calculated !== null && Math.round(saved * 100) === Math.round(calculated * 100);
        const points = value => Number.isFinite(value) ? value.toFixed(2) : '—';
        return h('div', { className: 'tl-score-calculation', 'aria-label': `${starter.name} scoring calculation` },
            receipt ? h(React.Fragment, null,
                h('table', { className: 'tl-score-ledger' },
                    h('caption', null, 'Recorded statistics · league scoring'),
                    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Recorded stat'), h('th', { scope: 'col' }, 'Rate'), h('th', { scope: 'col' }, 'Points'))),
                    h('tbody', null, receipt.rows.map(row => h('tr', { key: row.id },
                        h('th', { scope: 'row' }, row.group === 'bonus' ? `${row.threshold}+ ${Gamecast.statLabel(row.stat)} bonus` : `${row.value} ${Gamecast.statLabel(row.stat, row.group)}`),
                        h('td', null, row.group === 'bonus' ? 'Met' : String(row.weight)), h('td', null, points(row.points)))),
                        receipt.rounding !== 0 && h('tr', null, h('th', { scope: 'row' }, 'Scoring rounding'), h('td', null, 'Cents'), h('td', null, points(receipt.rounding))))),
                !receipt.rows.length && h('p', null, 'No nonzero statistics were recorded in this saved game.'),
                factor !== 1 && h('dl', { className: 'tl-score-adjustment' },
                    h('dt', null, 'Base fantasy points'), h('dd', null, points(receipt.total)),
                    h('dt', null, 'Saved era factor'), h('dd', null, factor === null ? 'Unavailable' : `× ${factor}`),
                    calculated !== null && h(React.Fragment, null, h('dt', null, 'After era adjustment'), h('dd', null, points(calculated)))),
                !matches && h('p', { className: 'tl-score-context-note', role: 'note' }, 'The original scoring context does not reconcile with this saved total. The saved result is kept; this calculation does not change it.'),
                h('p', { className: 'tl-score-context-note' }, 'Zero-count fields are omitted. Rates use this league’s rules. Core statistics and bonuses form one rounded subtotal; other scoring fields form a second. They are added before the saved era adjustment.'),
                starter.coverage === 'regular-season-missing-stats' && h('p', { className: 'tl-score-context-note' }, 'This historical source does not include fumbles lost or two-point conversions.'))
                : h('p', null, starter.stats === null || starter.availability === 'no-record'
                    ? 'No recorded game is saved for this Vault week. No injury or NFL bye is inferred.'
                    : 'Recorded statistics are unavailable in this saved result. Its points remain saved.'),
            h('div', { className: 'tl-score-saved-total' }, h('strong', null, 'Saved fantasy points'), h('strong', { className: 'tabular' }, points(saved))));
    }

    function BoxScores({ league, week, teamName, identifiedYears, myTeamId }) {
        const resultOf = new Map(week.results.map((r) => [r.teamId, r]));
        const paired = new Set(week.matchups.flatMap(match => [match.home, match.away]));
        const groups = [
            ...week.matchups.map(match => ({ key: `${match.home}:${match.away}`, ids: [match.home, match.away], winner: match.winner })),
            ...week.results.filter(result => !paired.has(result.teamId)).map(result => ({ key: `unpaired:${result.teamId}`, ids: [result.teamId], unpaired: true,
                note: Engine.weekParticipation(league, result.teamId, week.week).kind === 'bye'
                    ? 'Regular-season bye · these points count toward points for and all-play. No head-to-head win, loss or tie is added.'
                    : 'Saved lineup result · no head-to-head matchup is recorded for this team.' })),
        ].sort((a, b) => Number(b.ids.includes(myTeamId)) - Number(a.ids.includes(myTeamId)));
        return h('div', { className: 'tl-box-scores' },
            groups.map(group => h('div', { key: group.key, className: `tl-box-matchup${group.unpaired ? ' is-unpaired' : ''}` },
                group.note && h('p', { className: 'tl-box-unpaired-note' }, group.note),
                [...group.ids].sort((a, b) => Number(b === myTeamId) - Number(a === myTeamId)).map((teamId) => {
                    const result = resultOf.get(teamId);
                    return h('div', { key: teamId, className: 'tl-box-team', role: 'region', 'aria-label': `${teamName(teamId)} box score` }, h('table', { className: 'tl-tbl' },
                        h('thead', null, h('tr', null,
                            h('th', null, teamName(teamId) + (group.winner === teamId ? ' ◆' : '')), h('th', { className: 'num' }, 'YEAR'), h('th', { className: 'num' }, (result?.total ?? 0).toFixed(2)))),
                        h('tbody', null, (result?.starters ?? []).map((starter) => h('tr', { key: starter.entryId }, h('td', { colSpan: 3 },
                            h('details', { className: 'tl-score-player-receipt' },
                                h('summary', { 'aria-label': `Explain ${starter.name}'s ${starter.points.toFixed(2)} points` },
                                    h('span', { className: 'tl-score-player-name' }, `${starter.slot} · ${starter.name}`, h('small', null, 'How points add up')),
                                    h('span', { className: 'tl-score-player-edition' }, league.settings.hiddenYears && !league.yearsRevealed ? identifiedYears?.get(starter.editionId || starter.entryId) || starter.hiddenDecade || 'Hidden' : starter.drawnSeason),
                                    h('strong', { className: 'tabular' }, starter.points.toFixed(2))),
                                h(ScoringReceipt, { starter, scoring: league.settings.scoring, eraAdjusted: league.settings.eraAdjusted }))))))));
                }))));
    }

    const matchupKey = row => `${row.home}:${row.away}`;
    function ScoreboardStrip({ rows, teams, myTeamId, selectedKey, onSelect, statusLabel, live, leaders = [], showLeaders = false }) {
        if (!rows.length) return null;
        return h('div', { className: 'tl-scoreboard-strip' }, rows.map((row) => {
            const homeTeam = teams.find((t) => t.teamId === row.home);
            const awayTeam = teams.find((t) => t.teamId === row.away);
            const mine = row.home === myTeamId || row.away === myTeamId;
            const homeLeading = row.homePoints > row.awayPoints;
            const awayLeading = row.awayPoints > row.homePoints;
            const leader = leaders.find(player => player.teamId === row.home || player.teamId === row.away);
            const selected = selectedKey === matchupKey(row);
            return h('div', { key: matchupKey(row), className: `tl-score-chip${mine ? ' mine' : ''}${live ? ' live' : ''}${selected ? ' is-selected' : ''}` },
                h('div', { className: 'tl-sc-tag' }, live ? h('span', { className: 'tl-sc-dot' }) : null, mine ? `${statusLabel} · YOUR MATCHUP` : statusLabel,
                    selected && h('span', { className: 'tl-sc-viewing' }, 'Viewing')),
                h('button', { type: 'button', className: 'tl-score-chip-select', 'aria-pressed': selected,
                    'aria-label': `Inspect ${homeTeam?.name || row.home} vs. ${awayTeam?.name || row.away} · ${statusLabel}`, onClick: () => onSelect(row) },
                h('span', { className: `tl-sc-row${homeLeading ? ' winning' : ''}` },
                    h('span', { className: 'tl-sc-team' }, h(window.TimeLeagueHelmetIcon, { helmet: homeTeam?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(homeTeam?.name || row.home), size: 20 }), h('span', null, homeTeam?.name ?? row.home)),
                    h('span', { className: 'tl-sc-pts tabular' }, row.homePoints.toFixed(statusLabel === 'FINAL' ? 2 : 1))),
                h('span', { className: `tl-sc-row${awayLeading ? ' winning' : ''}` },
                    h('span', { className: 'tl-sc-team' }, h(window.TimeLeagueHelmetIcon, { helmet: awayTeam?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(awayTeam?.name || row.away), size: 20 }), h('span', null, awayTeam?.name ?? row.away)),
                    h('span', { className: 'tl-sc-pts tabular' }, row.awayPoints.toFixed(statusLabel === 'FINAL' ? 2 : 1)))),
                showLeaders && leader && h('details', { className: 'tl-sc-leader' },
                    h('summary', null, 'Leading scorer'),
                    h('span', null, h('b', null, leader.name), ` · ${leader.points.toFixed(1)} pts`, h('small', null, Gamecast.describeStats(leader.stats, 2)))));
        }));
    }

    function QuarterScore({ row, teams, timeline, landed, clock }) {
        const ids = row.mineIsHome ? [row.home, row.away] : [row.away, row.home];
        const totals = new Map(ids.map(id => [id, [0, 0, 0, 0]]));
        for (const event of landed) if (totals.has(event.teamId)) totals.get(event.teamId)[event.quarter - 1] += Math.round(event.points * 100);
        return h('div', { className: 'tl-quarter-score' }, h('table', { 'aria-label': 'Score by simulated quarter' },
            h('thead', null, h('tr', null, h('th', null, 'BY QUARTER'), timeline.quarters.map(q => h('th', { key: q.quarter, className: Gamecast.quarterAt(clock) === q.quarter ? 'current' : '' }, `Q${q.quarter}`)))),
            h('tbody', null, ids.map(id => h('tr', { key: id }, h('th', { scope: 'row' }, teams.find(team => team.teamId === id)?.name || id),
                timeline.quarters.map(q => h('td', { key: q.quarter, className: Gamecast.quarterAt(clock) === q.quarter ? 'current' : '' }, clock > q.start ? (totals.get(id)[q.quarter - 1] / 100).toFixed(1) : '—')))))));
    }

    function HeroMatchup({ row, teams, week, statusLabel, clockLabel, progress = 0, records = [], spotlight, quarterScore, phone = false, hasCurrentPlay = false }) {
        if (!row) return null;
        const homeTeam = teams.find((t) => t.teamId === row.home);
        const awayTeam = teams.find((t) => t.teamId === row.away);
        const mine = row.mineIsHome ? homeTeam : awayTeam;
        const opp = row.mineIsHome ? awayTeam : homeTeam;
        const minePts = row.mineIsHome ? row.homePoints : row.awayPoints;
        const oppPts = row.mineIsHome ? row.awayPoints : row.homePoints;
        const minePct = statusLabel === 'FINAL' ? (minePts === oppPts ? 50 : minePts > oppPts ? 100 : 0)
            : Math.max(1, Math.min(99, 100 / (1 + Math.exp(-(minePts - oppPts) / Math.max(3, 24 * Math.sqrt(1 - Math.min(1, progress)))))));
        const record = team => { const row = records.find(r => r.teamId === team.teamId); return row ? `${row.wins}–${row.losses}${row.ties ? '–'+row.ties : ''}` : '0–0'; };
        const analysis = h(React.Fragment, null,
            h('div', { className: 'tl-win-prob' }, h('span', null, statusLabel === 'FINAL' ? 'FINAL RESULT' : 'ESTIMATED WIN CHANCE'), h('strong', null, `${minePct.toFixed(0)}% — ${(100 - minePct).toFixed(0)}%`)),
            h('div', { className: 'tl-score-bar' }, h('div', { className: 'tl-fill', style: { width: `${minePct}%` } }), h('div', { className: 'tl-fill against', style: { width: `${100 - minePct}%` } })),
            statusLabel !== 'FINAL' && h('small', { className: 'tl-live-model-note' }, 'Illustrative estimate from score gap and time remaining; not a calibrated prediction.'), quarterScore);
        return h('div', { className: 'tl-hero-matchup' },
            h('div', { className: 'tl-hero-top' },
                h('div', { className: 'tl-hero-side' },
                    h('span', { className: 'tl-matchup-helmet is-left' }, h(window.TimeLeagueHelmetIcon, { helmet: mine.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(mine.name), size: 52 })),
                    h('div', { className: `tl-h-name${minePts >= oppPts ? ' leading' : ''}` }, mine.name), h('small', { className: 'tl-live-record' }, record(mine)),
                    h('div', { className: `tl-h-pts tabular${minePts >= oppPts ? ' leading' : ''}` }, minePts.toFixed(statusLabel === 'FINAL' ? 2 : 1))),
                h('div', { className: 'tl-hero-mid' }, h('div', { className: 'tl-h-vs' }, `WEEK ${week}`), h('div', { className: 'tl-h-clock' }, phone && statusLabel === 'UPCOMING' ? 'UPCOMING' : clockLabel)),
                h('div', { className: 'tl-hero-side' },
                    h('span', { className: 'tl-matchup-helmet' }, h(window.TimeLeagueHelmetIcon, { helmet: opp.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(opp.name), size: 52 })),
                    h('div', { className: `tl-h-name${oppPts > minePts ? ' leading' : ''}` }, opp.name), h('small', { className: 'tl-live-record' }, record(opp)),
                    h('div', { className: `tl-h-pts tabular${oppPts > minePts ? ' leading' : ''}` }, oppPts.toFixed(statusLabel === 'FINAL' ? 2 : 1)))),
            h('details', { className: 'tl-gamecast-details tl-matchup-analysis' }, h('summary', null, 'Matchup details'), analysis, phone && !hasCurrentPlay && spotlight),
            (!phone || hasCurrentPlay) && spotlight);

    }

    function WrTimeLeagueGamecastPanel({ league, cards, logIndex, logsMissing, eraFactors, onUpdate, onGoRoster, onlineMeta, autoPlayWeek, scoreRequest, onGoCeremony, active = true, onPlaybackChange, seatTeamId, mailNotice, throughWeek }) {
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : false;
        const [playback, setPlayback] = useState(null);
        const [clock, setClock] = useState(0);
        const [playing, setPlaying] = useState(false);
        const [speed, setSpeed] = useState(300);
        const [followMine,setFollowMine]=useState(true);
        const [warnings, setWarnings] = useState(null);
        const [boxWeek, setBoxWeek] = useState(null);
        const [selectedMatchup, setSelectedMatchup] = useState(null);
        const clockRef = useRef(0);
        const autoPlayed = useRef(null);
        const previousStage = useRef(league.weekStage);
        const archiveRef = useRef(null);
        const inspectedRequest = useRef(null);
        const pendingScoreFocus = useRef(false);
        const primaryRef = useRef(null);
        const pendingPlaybackFocus = useRef(false);
        const pendingMatchupFocus = useRef(false);
        const activeRef = useRef(active);
        activeRef.current = active;
        const playbackLoop = useRef({ running: false, speed, epoch: 0 });
        const running = playing && active;
        // A queued frame can outlive its effect cleanup. Invalidate it during
        // render so a paused or hidden game stops before another frame lands.
        if (playbackLoop.current.running !== running || playbackLoop.current.speed !== speed) {
            playbackLoop.current = { running, speed, epoch: playbackLoop.current.epoch + 1 };
        }
        useEffect(() => {
            if (!autoPlayWeek || autoPlayed.current === autoPlayWeek) return;
            const weekData = league.finalizedWeeks.find(week => week.week === autoPlayWeek);
            if (!weekData) return;
            autoPlayed.current = autoPlayWeek;
            setPlayback({ timeline: Gamecast.buildGamecast({ week: weekData.week, results: weekData.results, matchups: weekData.matchups, seed: league.seed || league.leagueId, scoring: league.settings.scoring, simulatedAvailability: league.settings.gameDeckVersion === 1 }), weekData, finalized: league, live: true });
            setBoxWeek(null); clockRef.current = 0; setClock(0); setSpeed(300); setPlaying(active);
        }, [autoPlayWeek, league.finalizedWeeks, league.seed, league.leagueId, league.settings.scoring]);

        const myTeamId = (league.teams.find((t) => onlineMeta || seatTeamId ? t.teamId === (onlineMeta?.seatTeamId || seatTeamId) : t.manager === 'human') ?? league.teams[0])?.teamId;

        const teamName = useMemo(() => {
            const names = new Map(league.teams.map((t) => [t.teamId, t.name]));
            return (teamId) => names.get(teamId) ?? teamId;
        }, [league.teams]);

        const finishPlayback = useCallback(() => { setPlaying(false); }, []);

        useEffect(() => {
            if (!playing || !active) return;
            const epoch = ++playbackLoop.current.epoch;
            let raf = 0;
            let last = performance.now();
            const step = (now) => {
                if (!playbackLoop.current.running || playbackLoop.current.epoch !== epoch) return;
                const dt = Math.min(0.1, (now - last) / 1000);
                last = now;
                clockRef.current = Math.min(GAMECAST_END, clockRef.current + dt * GAMECAST_END / speed);
                setClock(clockRef.current);
                if (clockRef.current >= GAMECAST_END) { finishPlayback(); return; }
                raf = window.requestAnimationFrame(step);
            };
            raf = window.requestAnimationFrame(step);
            return () => {
                window.cancelAnimationFrame(raf);
                if (playbackLoop.current.epoch === epoch) playbackLoop.current.epoch += 1;
            };
        }, [playing, speed, finishPlayback, active]);

        // Keep this panel mounted across tabs, but pause its clock while away.
        useEffect(() => { if (!active) setPlaying(false); }, [active]);
        useEffect(() => {
            const advanced = previousStage.current === 'postgame' && league.weekStage !== 'postgame';
            previousStage.current = league.weekStage;
            if (playback && (advanced || (playback.live && league.weekStage !== 'postgame' && league.currentWeek > playback.weekData.week))) {
                pendingPlaybackFocus.current = false;
                setPlayback(null); setPlaying(false); clockRef.current = 0; setClock(0);
            }
        }, [league.weekStage, league.currentWeek, playback]);

        const skipToEnd = event => {
            event?.currentTarget?.blur?.();
            pendingPlaybackFocus.current = true;
            clockRef.current = GAMECAST_END; setClock(GAMECAST_END); if (playing) finishPlayback();
        };
        const canRun = league.weekStage === 'ready' && (!onlineMeta || onlineMeta.role === 'commissioner') && league.phase === 'season' && cards !== null && cards.size > 0 && logIndex !== null && (!league.settings.eraAdjusted || Boolean(eraFactors?.size));

        const runGameDay = async (force) => {
            if (!canRun || !cards || !logIndex) return;
            const prepared = onlineMeta ? league : AI.aiPrepareWeek(league, cards, logIndex, eraFactors);
            if (!force) {
                const problems = Engine.lineupReadiness(prepared).blockers.flatMap(team => team.problems.map(problem => `${team.name} — ${problem}`));
                if (problems.length) { setWarnings(problems); return; }
            }
            setWarnings(null);
            // An online client has current-week hints, not the private draw.
            // Let the server score it; only saved results may start playback.
            let settled = league;
            if (!onlineMeta) {
                const finalized = Engine.finalizeCurrentWeek(prepared, logIndex, eraFactors, new Date().toISOString());
                if (!finalized.finalizedWeeks.some(item => item.week === league.currentWeek)) return;
                settled = { ...finalized, weekStage: 'postgame' };
            }
            const saved = await onUpdate(settled, { type: 'week', force });
            if (saved === false) return;
            const canonical = saved && typeof saved === 'object' ? saved : settled;
            const savedWeek = canonical.finalizedWeeks.find(item => item.week === league.currentWeek);
            if (!savedWeek) return;
            pendingPlaybackFocus.current = false;
            setPlayback({ timeline: Gamecast.buildGamecast({ week: savedWeek.week, results: savedWeek.results, matchups: savedWeek.matchups, seed: canonical.seed || canonical.leagueId, scoring: canonical.settings.scoring, simulatedAvailability: canonical.settings.gameDeckVersion === 1 }), weekData: savedWeek, finalized: canonical, live: true });
            setBoxWeek(null); clockRef.current = 0; setClock(0); setSpeed(300); setPlaying(true);
        };

        const replayWeek = (week) => {
            pendingPlaybackFocus.current = false;
            setPlayback({ timeline: Gamecast.buildGamecast({ week: week.week, results: week.results, matchups: week.matchups, seed: league.seed || league.leagueId, scoring: league.settings.scoring, simulatedAvailability: league.settings.gameDeckVersion === 1 }), weekData: week, finalized: league, live: false });
            setBoxWeek(null); clockRef.current = 0; setClock(0); setSpeed(300); setPlaying(true);
        };

        const done = playback !== null && clock >= GAMECAST_END;
        const quarter = Gamecast.quarterAt(clock);
        const togglePlayback = useCallback(() => setPlaying(value => !value), []);
        const nextQuarter = useCallback(() => { setPlaying(false); clockRef.current = Gamecast.nextQuarterEnd(clockRef.current); setClock(clockRef.current); }, []);
        useEffect(() => {
            onPlaybackChange?.(playback ? { leagueId: league.leagueId, week: playback.weekData.week, done, playing: playing && active, quarter, replay: !playback.live, toggle: togglePlayback, nextQuarter } : null);
        }, [onPlaybackChange, league.leagueId, playback, done, playing, active, quarter, togglePlayback, nextQuarter]);
        const landed = useMemo(() => (playback ? playback.timeline.events.filter((e) => e.t <= clock) : []), [playback, clock]);
        const liveTotals = useMemo(() => {
            const totals = new Map();
            if (!playback) return totals;
            if (done) { for (const [teamId, total] of Object.entries(playback.timeline.finals)) totals.set(teamId, total); return totals; }
            const cents = new Map();
            for (const event of landed) cents.set(event.teamId, (cents.get(event.teamId) ?? 0) + Math.round(event.points * 100));
            for (const [teamId, value] of cents) totals.set(teamId, value / 100);
            return totals;
        }, [playback, landed, done]);

        const pairs = league.currentWeek > league.settings.regularSeasonWeeks ? Engine.playoffPairs(league, league.currentWeek) : league.schedule.find((item) => item.week === league.currentWeek)?.pairs ?? [];
        const boxWeekData = boxWeek === null ? null : league.finalizedWeeks.find((item) => item.week === boxWeek) ?? null;
        const champion = league.championTeamId ? teamName(league.championTeamId) : null;

        // Normalize this week's matchups into one shape whether we're pre-run
        // (0-0, from the schedule) or mid/post-gamecast (from the playback timeline),
        // so the scoreboard strip and hero card render identically either way.
        // An unwatched saved result must not solve a year before its first playback.
        // Replays retain the evidence the player has already seen.
        const pendingWeek = autoPlayWeek && autoPlayed.current !== autoPlayWeek && league.finalizedWeeks.some(week => week.week === autoPlayWeek) ? autoPlayWeek : null;
        const savedFinal = !playback && !pendingWeek && (league.weekStage === 'postgame' || league.phase === 'complete') ? league.finalizedWeeks[league.finalizedWeeks.length - 1] : null;
        const visibleThroughWeek = Math.min(
            throughWeek === undefined ? Infinity : Number.isInteger(throughWeek) ? Math.max(0, throughWeek) : 0,
            playback?.live && !done ? playback.weekData.week - 1 : pendingWeek ? pendingWeek - 1 : Infinity);
        const displayedWeek = playback?.weekData || savedFinal;
        const identifiedYears = useMemo(() => {
            const years = new Map();
            if (!league.settings.hiddenYears || league.yearsRevealed || !window.WrTimeLeagueIdentifiedYear) return years;
            const entries = [...league.teams.flatMap(team => team.roster || []),
                ...(displayedWeek?.results || []).flatMap(result => result.starters || []),
                ...(boxWeekData?.results || []).flatMap(result => result.starters || [])];
            const unique = new Map(entries.map(entry => [entry.editionId || entry.entryId, entry]));
            for (const [id, entry] of unique) {
                const year = window.WrTimeLeagueIdentifiedYear(league, entry, cards, logIndex, eraFactors, visibleThroughWeek);
                if (year !== null) years.set(id, year);
            }
            return years;
        }, [league, cards, logIndex, eraFactors, visibleThroughWeek, displayedWeek, boxWeekData]);
        useEffect(() => {
            if (!active || !scoreRequest || scoreRequest.leagueId !== league.leagueId || inspectedRequest.current === scoreRequest
                || !Number.isInteger(scoreRequest.week) || pendingWeek || playback?.live && !done
                || scoreRequest.week > visibleThroughWeek || !league.finalizedWeeks.some(week => week.week === scoreRequest.week)) return;
            inspectedRequest.current = scoreRequest;
            pendingScoreFocus.current = true;
            setPlaying(false);
            setPlayback(null);
            setBoxWeek(scoreRequest.week);
        }, [active, scoreRequest, league.leagueId, league.finalizedWeeks, pendingWeek, playback, done, visibleThroughWeek]);
        useEffect(() => {
            if (!active || !pendingScoreFocus.current || playback || !boxWeekData || !archiveRef.current) return;
            pendingScoreFocus.current = false;
            archiveRef.current.scrollIntoView?.({ block: 'start', behavior: 'auto' });
            archiveRef.current.focus?.({ preventScroll: true });
        }, [active, boxWeekData, playback, scoreRequest]);
        useEffect(() => {
            if (!active || !done || !pendingPlaybackFocus.current) return;
            const frame = window.requestAnimationFrame(() => {
                const target = primaryRef.current;
                if (!activeRef.current || clockRef.current < GAMECAST_END || !target || target.closest?.('[hidden]')) return;
                pendingPlaybackFocus.current = false;
                // Match normal Vault navigation so the league header retains
                // its top padding below the shared development banner.
                (target.closest?.('.tl-root') || target).scrollIntoView?.({ block: 'start', behavior: 'auto' });
                target.focus?.({ preventScroll: true });
            });
            return () => window.cancelAnimationFrame(frame);
        }, [active, done]);
        useEffect(() => {
            if (!active || !pendingMatchupFocus.current || !primaryRef.current) return;
            pendingMatchupFocus.current = false;
            const target = primaryRef.current;
            (target.closest?.('.tl-root') || target).scrollIntoView?.({ block: 'start', behavior: 'auto' });
            target.focus?.({ preventScroll: true });
        }, [active, selectedMatchup]);
        // Effects start playback after the first render. Keep the saved final
        // out of that intervening frame, including its accessible box scores.
        if (pendingWeek) return h('section', { className: 'tl-card', role: 'status' },
            h('h2', null, `Opening Week ${pendingWeek} gamecast`),
            h('p', null, 'The result is saved. Preparing its scoring moments…'));
        const matchupRows = playback
            ? playback.weekData.matchups.map((m) => ({ home: m.home, away: m.away, homePoints: liveTotals.get(m.home) ?? 0, awayPoints: liveTotals.get(m.away) ?? 0 }))
            : savedFinal ? savedFinal.matchups.map(match => ({ home: match.home, away: match.away, homePoints: match.homePoints, awayPoints: match.awayPoints })) : pairs.map(([home, away]) => ({ home, away, homePoints: 0, awayPoints: 0 }));
        const myRow = (() => {
            const row = matchupRows.find((m) => m.home === myTeamId || m.away === myTeamId);
            return row ? { ...row, mineIsHome: row.home === myTeamId } : null;
        })();
        const weekLabel = playback ? playback.weekData.week : savedFinal ? savedFinal.week : league.currentWeek;
        const participation = Engine.weekParticipation(league, myTeamId, weekLabel);
        const selectedRow = selectedMatchup?.leagueId === league.leagueId && selectedMatchup.week === weekLabel
            ? matchupRows.find(row => matchupKey(row) === selectedMatchup.key) : null;
        const viewRow = selectedRow ? { ...selectedRow, mineIsHome: selectedRow.home === myTeamId || selectedRow.away !== myTeamId } : myRow;
        const viewingOther = Boolean(viewRow) && (!myRow || matchupKey(viewRow) !== matchupKey(myRow));
        const selectMatchup = row => {
            pendingMatchupFocus.current = true;
            setSelectedMatchup({ leagueId: league.leagueId, week: weekLabel, key: matchupKey(row) });
            setFollowMine(true);
        };
        const returnToOwn = viewingOther && h('button', { type: 'button', className: 'tl-btn tl-gameday-return', onClick: () => { pendingMatchupFocus.current = true; setSelectedMatchup(null); setFollowMine(true); } },
            myRow ? 'Your matchup →' : participation.kind === 'bye' ? 'Your lineup →' : 'Your team →');
        const leaders = new Map();
        for (const event of landed) {
            const key = `${event.teamId}:${event.entryId}`;
            const row = leaders.get(key) || { name: event.playerName, teamId: event.teamId, points: 0, stats: {} };
            row.points += event.points; Gamecast.addStats(row.stats, event.stats); leaders.set(key, row);
        }
        const leagueLeaders = [...leaders.values()].sort((a,b) => b.points-a.points);
        const strip = league.phase !== 'draft' && matchupRows.length
            ? h(ScoreboardStrip, { rows: matchupRows, teams: league.teams, myTeamId, selectedKey: viewRow ? matchupKey(viewRow) : null, onSelect: selectMatchup, leaders: leagueLeaders, showLeaders: Boolean(playback) && speed === 300, live: Boolean(playback) && !done, statusLabel: playback ? (done ? 'FINAL' : `Q${Gamecast.quarterAt(clock)} · ${playing ? 'PLAYING' : 'PAUSED'}`) : savedFinal ? 'FINAL' : 'UPCOMING' })
            : null;
        const followsOwn = followMine && (Boolean(viewRow) || participation.kind === 'bye');
        const ownEvent = event => viewRow ? event.teamId === viewRow.home || event.teamId === viewRow.away : event.teamId === myTeamId;
        const visibleEvents = followsOwn ? landed.filter(ownEvent) : landed;
        const currentPlay=visibleEvents[visibleEvents.length-1];
        const nextPlay=()=>{setPlaying(false);const next=playback.timeline.events.find(e=>e.t>clockRef.current && (!followsOwn||ownEvent(e)));clockRef.current=next?next.t:GAMECAST_END;setClock(clockRef.current);};
        const spotlight = h('div', { className: 'tl-current-play tl-live-spotlight' },
            h('span', { className: 'tl-label' }, currentPlay ? `${teamName(currentPlay.teamId)} · ${Gamecast.clockLabel(currentPlay.t)}` : savedFinal ? `FINAL · WEEK ${weekLabel}` : playback && clock > 0 ? `${Gamecast.clockLabel(clock)} · ${viewRow ? 'MATCHUP' : 'LINEUP'}` : 'READY FOR KICKOFF'),
            h('h3', null, currentPlay?.description || (savedFinal ? 'The final is in. View the lineup results below or replay the game from the Week Archive.' : playback ? 'No scoring moment for this matchup yet.' : 'The scores and win estimate update as scoring moments arrive.')),
            currentPlay && h('strong', null, currentPlay.kind === 'availability' ? 'AVAILABILITY UPDATE' : `${currentPlay.points >= 0 ? '+' : ''}${currentPlay.points.toFixed(2)} fantasy points`));
        const records = Engine.computeStandings({ ...league, finalizedWeeks: league.finalizedWeeks.filter(week => week.week < weekLabel) });
        const unpairedContext = participation.kind === 'bye' || participation.kind === 'observer' ? h('section', { className: 'tl-card tl-week-participation', 'aria-label': participation.kind === 'bye' ? 'Regular-season bye' : 'Following the playoffs' },
            h('span', { className: 'tl-label' }, `WEEK ${weekLabel} · ${participation.kind === 'bye' ? 'REGULAR-SEASON BYE' : 'PLAYOFF OBSERVER'}`),
            h('h2', null, participation.kind === 'bye' ? `${teamName(myTeamId)} still scores this week` : 'Follow the remaining playoff matchups'),
            h('p', null, participation.kind === 'bye' ? 'Set a legal lineup. Your points count toward points for and all-play; no head-to-head win, loss or tie is added.' : 'Your team is not in this round. Its lineup does not block kickoff and it has no matchup result this week.'),
            participation.kind === 'bye' && (playback || savedFinal) && h('p', { className: 'tabular' }, `${done || savedFinal ? 'Final lineup points' : 'Lineup points so far'}: ${(playback ? liveTotals.get(myTeamId) ?? 0 : savedFinal.results.find(result => result.teamId === myTeamId)?.total ?? 0).toFixed(2)}`),
            spotlight) : spotlight;
        const hero = viewRow ? h(HeroMatchup, { row: viewRow, teams: league.teams, week: weekLabel, records, spotlight, phone, hasCurrentPlay: Boolean(currentPlay),
            quarterScore: playback ? h(QuarterScore, { row: viewRow, teams: league.teams, timeline: playback.timeline, landed, clock }) : null,
            progress: clock / GAMECAST_END, statusLabel: playback ? (done ? 'FINAL' : playing ? 'SIMULATION' : 'PAUSED') : savedFinal ? 'FINAL' : 'UPCOMING',
            clockLabel: playback ? Gamecast.clockLabel(clock) : savedFinal ? 'FINAL' : `WK ${weekLabel}` }) : unpairedContext;
        const lineups = h(LiveLineups, { league, row: viewRow, singleTeamId: !viewRow && participation.kind === 'bye' ? myTeamId : null, teams: league.teams, rosterSlots: league.settings.rosterSlots,
            weekData: playback?.weekData || savedFinal, landed, final: done || Boolean(savedFinal), currentPlay, identifiedYears });
        if (playback) {
            const controls = h('section', { className: 'tl-card tl-gameday-controls', 'aria-label': 'Game playback controls' },
                    h('div', { className: 'tl-card-title' }, h('span', null, `Week ${playback.weekData.week} — ${done ? 'Final' : playing ? 'Playing' : 'Paused'}`), h('small', null, `${landed.length}/${playback.timeline.events.length} game moments`)),
                    !done && h('div', { className: 'tl-cast-controls' },
                        h('span', { style: { color: playing ? 'var(--gold)' : 'var(--text-muted)' } }, '📡'),
                        h('span', { className: 'tabular tl-cast-clock' }, Gamecast.clockLabel(clock)),
                        h('span', { className: 'tl-cast-progress', role: 'progressbar', 'aria-label': 'Game playback', 'aria-valuenow': Math.round(clock / GAMECAST_END * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
                            h('span', { style: { display: 'block', height: '100%', width: `${(clock / GAMECAST_END) * 100}%`, background: 'var(--gold)' } })),
                        !onPlaybackChange && h('button',{className:'tl-btn primary',disabled:done,onClick:togglePlayback},playing?'PAUSE':'RESUME'),
                        !onPlaybackChange && h('button',{className:'tl-btn primary',disabled:done,onClick:nextQuarter},'NEXT QUARTER'),
                        h('button',{className:'tl-btn',disabled:done,onClick:nextPlay},'NEXT PLAY'),
                        (viewRow || participation.kind === 'bye') && h('button',{className:'tl-btn','aria-pressed':followMine,onClick:()=>setFollowMine(v=>!v)},followMine?viewRow?viewingOther?'SELECTED MATCHUP':'MY MATCHUP':'MY LINEUP':'ALL MATCHUPS'),
                        CAST_DURATIONS.map(duration => h('button', { key: duration, className: `tl-btn${speed === duration ? ' primary' : ''}`, 'aria-pressed': speed === duration, onClick: () => setSpeed(duration) }, `${duration / 60} MIN`)),
                        h('button', { className: 'tl-btn icon', disabled: done, onClick: skipToEnd }, 'INSTANT')),
                    !done && h('p', { className: 'tl-cast-pace' }, `${speed / 60}-minute game · ${speed / 4} seconds per quarter. Next quarter skips to the break and pauses.`),
                    done && h('div', { className: 'tl-cast-finish-actions' },
                        h('button', { className: 'tl-btn primary', onClick: () => { pendingPlaybackFocus.current = false; clockRef.current = 0; setClock(0); setPlaying(false); } }, 'REPLAY FROM START'),
                        league.phase === 'complete' && onGoCeremony && h('button', { className: 'tl-btn primary', onClick: onGoCeremony }, 'CHAMPIONSHIP CEREMONY'),
                        h('button', { className: 'tl-btn', onClick: () => { pendingPlaybackFocus.current = false; setPlayback(null); clockRef.current = 0; setClock(0); } }, 'CLOSE GAMECAST')));
            return h('div', { className: 'tl-gameday-panel is-playback', 'data-participation': viewRow ? 'matchup' : participation.kind },
                !phone && strip,
                h('div', { className: 'tl-gameday-primary', ref: primaryRef, tabIndex: -1, role: 'region', 'aria-label': `Week ${weekLabel} matchup` },
                    h('div', { className: 'tl-gameday-score-rail' }, returnToOwn, hero, controls,
                        h('p', { className: 'tl-hint tl-gameday-playback-note' }, 'Historical totals, reconstructed across four quarters. Quarter timing is simulated. Playback controls do not change the saved result.')),
                    lineups),
                done && mailNotice,
                phone && strip && h('details', { className: 'tl-gamecast-details' }, h('summary', null, 'All matchups'), strip));
        }

        return h('div', { className: 'tl-gameday-panel', 'data-participation': viewRow ? 'matchup' : participation.kind },
            !phone && strip,
            h('div', { className: 'tl-gameday-primary', ref: primaryRef, tabIndex: -1, role: 'region', 'aria-label': `Week ${weekLabel} matchup` },
            h('div', { className: 'tl-gameday-score-rail' }, returnToOwn, hero,
            h('p', { className: 'tl-hint tl-gameday-playback-note' }, 'Fantasy points use recorded historical games. Quarter timing in the gamecast is simulated.'),
            league.phase === 'season' && league.weekStage === 'ready' && (!onPlaybackChange || warnings || logsMissing || !logIndex || !cards?.size || (league.settings.eraAdjusted && !eraFactors?.size)) && h('div', { className: 'tl-card tl-gameday-command' },
                h('div', { className: 'tl-card-title' }, h('span', null, `Week ${league.currentWeek} Command`), h('small', null, `${pairs.length} matchups · ${league.settings.eraAdjusted ? 'era-adjusted' : 'raw scoring'}`)),
                logsMissing && h('div', { className: 'tl-feedrow urgent' }, h('time', null, 'DATA'), h('p', null, 'Weekly game data has not loaded. Use Retry loading above.')),
                !logsMissing && !logIndex && h('div', { className: 'tl-feedrow' }, h('time', null, 'DATA'), h('p', null, 'Loading historical games…')),
                cards !== null && cards.size === 0 && h('div', { className: 'tl-feedrow urgent' }, h('time', null, 'DATA'), h('p', null, 'The player archive has not loaded. Use Retry loading above.')),
                league.settings.eraAdjusted && !eraFactors?.size && h('div', { className: 'tl-feedrow caution' }, h('time', null, 'DATA'), h('p', null, 'Era scoring must load before game day. If loading fails, use Retry loading above.')),
                warnings && h('div', { style: { marginBottom: 10 } },
                    warnings.map((problem, i) => h('div', { key: i, className: 'tl-feedrow caution' }, h('time', null, 'LINEUP'), h('p', null, problem))),
                    h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
                        h('button', { className: 'tl-btn', onClick: onGoRoster }, 'FIX LINEUPS'),
                        h('button', { className: 'tl-btn', onClick: () => runGameDay(true) }, 'RUN ANYWAY'))),
                !onPlaybackChange && h('button', { className: 'tl-btn primary', disabled: !canRun, onClick: () => runGameDay(false), style: { width: '100%', justifyContent: 'center', padding: '10px', marginTop: 4 } }, onlineMeta && onlineMeta.role !== 'commissioner' ? 'WAITING FOR COMMISSIONER' : '▶ RUN GAME DAY'))), lineups),
            savedFinal && mailNotice,
            phone && strip && h('details', { className: 'tl-gamecast-details' }, h('summary', null, 'All matchups'), strip),
            league.phase === 'complete' && h('div', { className: 'tl-card tl-gamecast-champion', style: { display: 'flex', alignItems: 'center', gap: 12 } },
                h('span', { style: { fontSize: 24 } }, '🏆'),
                h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Season Complete — Champion'), h('strong', { style: { fontFamily: 'var(--font-title)', fontSize: 18 } }, champion ?? 'Unknown')), onGoCeremony && h('button', { className: 'tl-btn primary', onClick: onGoCeremony }, 'CHAMPIONSHIP CEREMONY')),
            league.finalizedWeeks.length > 0 && h('div', { ref: archiveRef, tabIndex: -1, role: 'region', 'aria-label': 'Saved week archive', className: 'tl-card tl-gamecast-archive', style: { marginTop: 14 } },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Week Archive'), h('small', null, 'replay any gamecast or audit the box scores')),
                league.finalizedWeeks.map((week) => h('div', { key: week.week, className: 'tl-gamecast-archive-row', style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' } },
                    h('span', { className: 'tl-label', style: { flex: 'none' } }, `WK ${String(week.week).padStart(2, '0')}`),
                    h('span', { style: { flex: 1, fontSize: 12, color: 'var(--text-secondary)' } }, week.headlines[0] ?? ''),
                    h('button', { className: 'tl-btn icon', onClick: () => replayWeek(week) }, 'REPLAY'),
                    h('button', { className: 'tl-btn icon', onClick: () => setBoxWeek(boxWeek === week.week ? null : week.week) }, boxWeek === week.week ? 'HIDE BOX' : 'BOX SCORE'))),
                boxWeekData && h(BoxScores, { league, week: boxWeekData, teamName, identifiedYears, myTeamId })));
    }

    window.WrTimeLeagueGamecastPanel = WrTimeLeagueGamecastPanel;
    window.WrTimeLeagueScoringReceipt = ScoringReceipt;
})();
