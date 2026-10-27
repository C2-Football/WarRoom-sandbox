// ══════════════════════════════════════════════════════════════════
// js/components/time-league-home-panel.js — window.WrTimeLeagueHomePanel
// Matchup-first league home. The most important player decisions lead the
// page; recent results and league moves share the same compact visual language.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo } = React;
    const h = React.createElement;

    const Engine = window.App.TimeLeagueEngine;

    function TeamLockup({ team, standing, side, score, scoreDigits = 1, emptyLabel = 'No matchup' }) {
        if (!team) return h('div', { className: `tl-home-team ${side}` }, h('div', { className: 'tl-home-bye' }, emptyLabel));
        return h('div', { className: `tl-home-team ${side}` },
            h('span', { className: `tl-matchup-helmet${side === 'mine' ? ' is-left' : ''}` },
                h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 86 })),
            h('strong', null, team.name),
            Number.isFinite(score) && h('strong', { className: 'tabular', style: { fontSize: 28 } }, score.toFixed(scoreDigits)),
            h('span', null, standing ? `${standing.wins}-${standing.losses}${standing.ties ? `-${standing.ties}` : ''} · ${standing.pointsFor.toFixed(1)} PF` : '0-0 · SEASON OPENER'));
    }

    function ActionCard({ icon, kicker, title, detail, tone, onClick }) {
        return h('button', { type: 'button', className: `tl-home-action ${tone || ''}`, onClick },
            h('span', { className: 'tl-home-action-icon' }, icon),
            h('span', { className: 'tl-home-action-copy' }, h('small', null, kicker), h('strong', null, title), h('span', null, detail)),
            h('span', { className: 'tl-home-action-go', 'aria-hidden': true }, '↗'));
    }

    function SavedResultExplanation({ league, week, team, onNavigate, onInspectScore }) {
        const match = week?.matchups.find(row => row.home === team.teamId || row.away === team.teamId);
        const result = week?.results.find(row => row.teamId === team.teamId);
        if (!result) return null;
        const bye = !match && Engine.weekParticipation(league, team.teamId, week.week).kind === 'bye';
        const margin = match ? Math.abs(Math.round(match.homePoints * 100) - Math.round(match.awayPoints * 100)) / 100 : null;
        const won = match?.winner === team.teamId;
        const top = [...(result.starters || [])].filter(entry => Number.isFinite(entry.points)).sort((left, right) => right.points - left.points)[0];
        const missing = (result.starters || []).filter(entry => entry.availability === 'no-record').length;
        const outcome = !match ? `${result.total.toFixed(2)} saved lineup points` : match.winner === null ? 'Tied game' : margin === 0 ? won ? 'Won on the tiebreaker' : 'Lost on the tiebreaker' : `${won ? 'Won' : 'Lost'} by ${margin.toFixed(2)} points`;
        const tieNote = bye ? 'These points count toward points for and all-play. No head-to-head win, loss or tie is added.'
            : margin === 0 ? match.winner === null ? 'A tied score. Regular-season ties stand.' : week.week > league.settings.regularSeasonWeeks ? 'The higher seed wins the playoff tiebreaker.' : 'The saved result determines the winner.' : null;
        return h('section', { className: 'tl-card tl-home-result-explainer', 'aria-label': `What decided Week ${week.week}` },
            h('h2', null, match ? 'What decided the game' : 'What counted this week'),
            h('div', { className: 'tl-update-highlights' },
                h('div', null, h('small', null, 'Your result'), h('strong', null, outcome), h('span', null, tieNote || 'Final scores include starting players only.')),
                top && h('div', null, h('small', null, 'Your top starter'), h('strong', null, top.name), h('span', null, `${top.points.toFixed(2)} points${top.position ? ` · ${top.position}` : ''}`))),
            h('p', { className: 'tl-hint' }, 'Recorded historical game statistics are converted into fantasy points using this league’s scoring.', league.settings.eraAdjusted ? ' Era adjustments are included.' : '', ' Each player’s points and the lineup total are rounded to two decimals.', missing ? ` ${missing} starter${missing === 1 ? ' had' : 's had'} no recorded game and scored zero.` : ''),
            h('button', { type: 'button', className: 'tl-btn', onClick: () => onInspectScore ? onInspectScore(week.week) : onNavigate('gameday') }, 'Scoring & box scores →'));
    }

    function WrTimeLeagueHomePanel({ league, onNavigate, onInspectScore, seatTeamId, cards, logIndex, eraFactors, throughWeek }) {
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : false;
        const standings = useMemo(() => Engine.computeStandings(league), [league]);
        const teamOf = (teamId) => league.teams.find((team) => team.teamId === teamId);
        const teamName = (teamId) => teamOf(teamId)?.name ?? teamId;
        const standingOf = (teamId) => standings.find((row) => row.teamId === teamId);
        const myTeam = league.teams.find((team) => seatTeamId ? team.teamId === seatTeamId : team.manager === 'human') ?? league.teams[0];
        const myStanding = standingOf(myTeam.teamId);
        const currentSchedule = league.currentWeek > league.settings.regularSeasonWeeks ? { pairs: Engine.playoffPairs(league, league.currentWeek) } : league.schedule.find((item) => item.week === league.currentWeek);
        const participation = Engine.weekParticipation(league, myTeam.teamId);
        const postgame = league.weekStage === 'postgame';
        const justFinished = postgame ? league.finalizedWeeks[league.finalizedWeeks.length - 1] : null;
        const finishedMatch = justFinished?.matchups.find(match => match.home === myTeam.teamId || match.away === myTeam.teamId);
        const currentPair = postgame ? (finishedMatch ? [finishedMatch.home, finishedMatch.away] : null) : participation.pair;
        const opponentId = currentPair?.find((teamId) => teamId !== myTeam.teamId) ?? null;
        const opponent = opponentId ? teamOf(opponentId) : null;
        const opponentStanding = opponent ? standingOf(opponent.teamId) : null;
        const lineupProblems = Engine.lineupProblems(league, myTeam.teamId);
        const recovery = Engine.planningRecovery(league);
        const needsRosterChanges = recovery.teams.some(team => team.teamId === myTeam.teamId);
        const recoveryDetail = recovery.available
            ? 'This roster cannot fill every required slot. Review its roster recovery notice for planning options before kickoff.'
            : `This roster cannot fill every required slot. ${recovery.reason}`;
        const pendingWaivers = league.pendingClaims.filter((claim) => claim.teamId === myTeam.teamId).length;
        const openTrades = league.trades.filter((trade) => trade.status === 'pending' && trade.toTeamId === myTeam.teamId && !(trade.deferredUntilWeek > league.currentWeek)).length;
        const lastFinalized = league.finalizedWeeks[league.finalizedWeeks.length - 1] ?? null;
        const lastMatchup = lastFinalized?.matchups.find((matchup) => matchup.home === myTeam.teamId || matchup.away === myTeam.teamId) ?? null;
        const lastResult = lastMatchup ? (lastMatchup.winner === null ? 'T' : lastMatchup.winner === myTeam.teamId ? 'W' : 'L') : null;
        const recentActivity = [...league.activity].reverse().filter(event => event.week >= (lastFinalized?.week ?? league.currentWeek) && event.kind !== 'draft' && event.kind !== 'reveal').slice(0, 3);
        const recentMoves = recentActivity.filter(event => event.kind === 'waiver' || event.kind === 'trade').slice(0, 2);
        const champion = league.championTeamId ? teamOf(league.championTeamId) : null;

        const weeklyLeaders = useMemo(() => {
            if (!lastFinalized) return null;
            const topTeam = [...lastFinalized.results].sort((left, right) => right.total - left.total)[0];
            const topPlayer = lastFinalized.results.flatMap(result => result.starters.map(player => ({ ...player, teamId: result.teamId }))).sort((left, right) => right.points - left.points)[0];
            const closest = [...lastFinalized.matchups].sort((left, right) => Math.abs(left.homePoints-left.awayPoints) - Math.abs(right.homePoints-right.awayPoints))[0];
            return { topTeam, topPlayer, closest };
        }, [lastFinalized]);

        const heroStatus = league.phase === 'complete'
            ? 'SEASON COMPLETE'
            : lastResult
                ? `${lastResult === 'W' ? 'WIN' : lastResult === 'L' ? 'LOSS' : 'TIE'} IN WEEK ${lastFinalized?.week ?? league.currentWeek - 1}`
                : lastFinalized ? `WEEK ${lastFinalized.week} COMPLETE` : `WEEK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)} · SEASON OPENER`;
        const ready = lineupProblems.length === 0;
        const stage = league.weekStage || 'ready';
        const watchingPlayoffs = league.phase === 'season' && participation.kind === 'observer';
        const byeNote = 'No head-to-head matchup. Set a legal lineup: its points still count toward points for and all-play. No win, loss or tie is added.';
        const nextAction = watchingPlayoffs
            ? { tab: 'gameday', label: 'Follow the playoffs →', detail: 'Your team is out of this playoff round. Follow the remaining matchups and the road to the title.' }
            : stage === 'claims'
                ? league.settings.waiversEnabled
                    ? { tab: 'waivers', label: 'Review waiver claims →', detail: pendingWaivers ? `${pendingWaivers} claim${pendingWaivers === 1 ? ' is' : 's are'} pending. Review your claims before the waiver window closes.` : 'Add a player or keep your roster. Review waiver claims before moving to final lineup decisions.' }
                    : league.settings.tradesEnabled
                        ? { tab: 'trades', label: 'Review trades →', detail: openTrades ? `${openTrades} trade offer${openTrades === 1 ? ' is' : 's are'} waiting. Review your trades before final lineup decisions.` : 'Explore a trade or keep your team. Continue to final lineup decisions when you are ready.' }
                        : { tab: 'roster', label: 'Review lineup →', detail: 'Your roster is ready to review. Continue to the lineup stage with the week actions below.' }
                : needsRosterChanges && ['lineup', 'ready'].includes(stage)
                    ? { tab: 'roster', label: 'Review roster needs →', detail: recoveryDetail }
                : stage === 'lineup'
                    ? { tab: 'roster', label: ready ? 'Review lineup →' : `Fix lineup (${lineupProblems.length}) →`, detail: ready ? 'Your lineup is legal. Make any final changes, then use Lock lineup when you are ready.' : `${lineupProblems.length} lineup ${lineupProblems.length === 1 ? 'decision needs' : 'decisions need'} your attention before you can lock the lineup.` }
                    : { tab: ready ? 'gameday' : 'roster', label: ready ? 'Go to game day →' : 'Review lineup issue →', detail: ready ? 'Lineup locked. Review the matchup, then start game day with the week actions below.' : 'The locked lineup needs attention. Lineups must reopen before you can make changes.' };
        const showWaiverDecision = !watchingPlayoffs && league.settings.waiversEnabled && stage === 'claims';
        const showTradeDecision = !watchingPlayoffs && league.settings.tradesEnabled && (stage === 'claims' || (stage === 'lineup' && openTrades > 0));
        const playoffCount = Engine.playoffCount(league);
        const showHunt = playoffCount > 0 && league.currentWeek > Math.floor(league.settings.regularSeasonWeeks / 2);
        const remaining = Math.max(0, league.settings.regularSeasonWeeks - league.finalizedWeeks.filter(week => week.week <= league.settings.regularSeasonWeeks).length);
        const playoffHunt = showHunt && h('section', { className: 'tl-card tl-playoff-hunt' },
            h('div', { className: 'tl-card-title' }, h('span', null, '🏆 Playoff Hunt'), h('small', null, remaining ? `${remaining} regular-season games left · Top ${playoffCount} advance` : 'Postseason field')),
            h('p', { className: 'tl-hint' }, remaining ? 'The field if the season ended today. The line separates playoff seeds from the chase; standings can still change.' : champion ? `${champion.name} is your champion.` : 'The regular season is settled. Follow the bracket through game day.'),
            h('div', { className: 'tl-hunt-field' }, standings.map((row, index) => h('div', { key: row.teamId, className: 'tl-hunt-team' + (index < playoffCount ? ' in-field' : '') + (index === playoffCount ? ' cut-line' : '') },
                h('span', { className: 'tl-hunt-seed' }, index < playoffCount ? `#${index+1}` : 'Chasing'),
                h('strong', null, teamName(row.teamId)), h('span', null, `${row.wins}–${row.losses}${row.ties ? '–'+row.ties : ''}`), h('small', null, `${row.pointsFor.toFixed(1)} PF`)))),
            !remaining && league.currentWeek <= Engine.seasonEndWeek(league) && h('div', { className: 'tl-hunt-bracket' }, Engine.playoffPairs(league, league.currentWeek).map((pair, index) => h('div', { key: index }, h('small', null, `WEEK ${league.currentWeek}`), h('strong', null, pair.map(teamName).join(' vs. '))))));

        if (postgame && league.phase === 'season' && justFinished) {
            const finishedKind = Engine.weekParticipation(league, myTeam.teamId, justFinished.week).kind;
            const nextPair = currentSchedule?.pairs.find(pair => pair.includes(myTeam.teamId));
            const nextOpponent = nextPair ? teamOf(nextPair.find(id => id !== myTeam.teamId)) : null;
            const playoffObserver = league.currentWeek > league.settings.regularSeasonWeeks && !nextPair;
            const myScore = justFinished.results.find(result => result.teamId === myTeam.teamId)?.total;
            return h('section', { className: 'tl-home tl-week-recap', 'aria-label': `Week ${justFinished.week} recap` },
                h('header', { className: 'tl-recap-heading' },
                    h('span', { className: 'tl-eyebrow' }, 'FINAL WHISTLE'), h('h1', null, `Week ${justFinished.week} recap`),
                    h('p', null, 'The scores are final. Review the week, then select End week to open the next planning window.')),
                h('section', { className: 'tl-home-hero tl-recap-result' },
                    h('div', { className: 'tl-home-hero-copy' }, h('span', { className: 'tl-eyebrow' }, 'YOUR RESULT'),
                        h('h2', null, lastResult === 'W' ? 'A win in the books.' : lastResult === 'L' ? 'A tough week. A fresh start ahead.' : lastResult === 'T' ? 'All square at the final whistle.' : finishedKind === 'bye' ? 'Your bye week is complete.' : finishedKind === 'observer' ? 'Your team did not play this round.' : 'The week is complete.'),
                        h('p', null, `${myTeam.name} · ${myStanding.wins}–${myStanding.losses}${myStanding.ties ? '–' + myStanding.ties : ''} regular-season record · ${myStanding.pointsFor.toFixed(1)} regular-season points`)),
                    h('div', { className: 'tl-home-matchup' },
                        h(TeamLockup, { team: myTeam, standing: myStanding, side: 'mine', score: myScore, scoreDigits: 2 }),
                        h('div', { className: 'tl-home-vs' }, h('span', null, `WEEK ${justFinished.week}`), h('strong', null, 'FINAL')),
                        h(TeamLockup, { team: opponent, standing: opponentStanding, side: 'opponent', score: opponent && justFinished.results.find(result => result.teamId === opponent.teamId)?.total, scoreDigits: 2, emptyLabel: finishedKind === 'bye' ? 'BYE' : finishedKind === 'observer' ? 'Not in this round' : 'No matchup' }))),
                h(SavedResultExplanation, { league, week: justFinished, team: myTeam, onNavigate, onInspectScore }),
                h('section', { className: 'tl-card tl-league-update' },
                    h('h2', null, 'Around the league'),
                    weeklyLeaders && h('div', { className: 'tl-update-highlights' },
                        weeklyLeaders.topTeam && h('div', null, h('small', null, 'High score'), h('strong', null, `${weeklyLeaders.topTeam.total.toFixed(1)} pts`), h('span', null, teamName(weeklyLeaders.topTeam.teamId))),
                        weeklyLeaders.topPlayer && h('div', null, h('small', null, 'Player of the week'), h('strong', null, weeklyLeaders.topPlayer.name), h('span', null, `${weeklyLeaders.topPlayer.points.toFixed(1)} pts · ${teamName(weeklyLeaders.topPlayer.teamId)}`))),
                    h('div', { className: 'tl-update-results', 'aria-label': `Week ${justFinished.week} results` }, justFinished.matchups.map(match =>
                        h('div', { key: `${match.home}:${match.away}`, className: 'tl-update-match' }, h('small', null, 'FINAL'),
                            [[match.home, match.homePoints], [match.away, match.awayPoints]].map(([id, points]) => h('div', { key: id, className: match.winner === id ? 'winner' : '' }, h('span', null, teamName(id)), h('strong', null, points.toFixed(2)))))))),
                h('details', { className: 'tl-home-secondary' }, h('summary', null, 'Updated standings & team profiles'), h(window.WrTimeLeagueStandingsPanel, { league, embedded: true })),
                h('section', { className: 'tl-card tl-recap-next' }, h('span', { className: 'tl-eyebrow' }, `UP NEXT · WEEK ${league.currentWeek}`),
                    h('h2', null, nextOpponent ? `${myTeam.name} vs. ${nextOpponent.name}` : playoffObserver ? 'Follow the championship' : 'No matchup scheduled'),
                    h('p', null, playoffObserver ? 'Your playoff run is complete. End week when you are ready, then follow the remaining games from game day.' : league.settings.waiversEnabled ? 'End week opens the next waiver window. Submit claims, resolve waivers, then set your lineup for kickoff.' : 'End week opens the next planning window. Review trades and set your lineup for kickoff.')));
        }

        return h('div', { className: `tl-home${league.phase === 'season' ? ' tl-home-dashboard' : ''}` },
            league.phase === 'complete' && window.WrTimeLeagueCeremony && h(window.WrTimeLeagueCeremony, { key: league.leagueId || league.id || league.name, league, onNavigate, cards, logIndex, eraFactors, throughWeek }),
            (league.phase !== 'complete' || !window.WrTimeLeagueCeremony) && h('section', { className: `tl-home-hero${league.phase === 'complete' ? ' champion' : ''}` },
                h('div', { className: 'tl-home-hero-copy' },
                    h('span', { className: 'tl-eyebrow' }, heroStatus),
                    league.phase === 'complete'
                        ? h('h1', null, champion?.teamId === myTeam.teamId ? 'Your championship season.' : `${champion?.name ?? 'Your champion'} takes the title.`)
                        : h('h1', { className: 'tl-home-matchup-heading' }, opponent ? `${myTeam.name} vs. ${opponent.name}` : watchingPlayoffs ? `${myTeam.name} is following the playoffs` : participation.kind === 'bye' ? `${myTeam.name} has a bye this week` : `Week ${league.currentWeek} · ${myTeam.name}`),
                    h('p', null, league.phase === 'complete' ? `${champion?.name ?? 'The champion'} wins ${league.name}.` : nextAction.detail),
                    league.phase === 'season' && participation.kind === 'bye' && h('p', { className: 'tl-hint' }, byeNote),
                    league.phase !== 'complete' && !postgame && h('div', { className: 'tl-home-hero-actions' },
                        h('button', { type: 'button', className: 'tl-btn primary', onClick: () => onNavigate(nextAction.tab) }, nextAction.label),
                        nextAction.tab !== 'roster' && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('roster') }, stage === 'ready' || watchingPlayoffs ? 'View lineup' : 'Review lineup'))),
                h('div', { className: 'tl-home-matchup' },
                    league.phase === 'complete'
                        ? h('div', { className: 'tl-home-trophy' }, h('span', null, '♛'), h('strong', null, 'VAULT CHAMPION'), h('small', null, champion?.name ?? 'Season complete'))
                        : h(React.Fragment, null,
                            h(TeamLockup, { team: myTeam, standing: myStanding, side: 'mine', score: finishedMatch ? (finishedMatch.home === myTeam.teamId ? finishedMatch.homePoints : finishedMatch.awayPoints) : undefined }),
                            h('div', { className: 'tl-home-vs' }, h('span', null, `WK ${justFinished?.week ?? league.currentWeek}`), h('strong', null, opponent ? 'VS' : '·'), h('small', null, postgame ? 'FINAL' : 'UPCOMING')),
                            h(TeamLockup, { team: opponent, standing: opponentStanding, side: 'opponent', score: finishedMatch ? (finishedMatch.home === opponentId ? finishedMatch.homePoints : finishedMatch.awayPoints) : undefined, emptyLabel: participation.kind === 'bye' ? 'BYE' : watchingPlayoffs ? 'Not in this round' : 'No matchup' }))),
                h('div', { className: 'tl-home-yardline one' }),
                h('div', { className: 'tl-home-yardline two' })),

            league.phase === 'complete' && h('section', { className: 'tl-card tl-recap-next', 'aria-label': 'Your completed season' },
                h('span', { className: 'tl-eyebrow' }, myTeam.name), h('h2', null, 'Your season is saved.'),
                h('p', null, `${myStanding.wins}–${myStanding.losses}${myStanding.ties ? `–${myStanding.ties}` : ''} regular-season record · ${myStanding.pointsFor.toFixed(2)} regular-season points. Your results, roster and discovered seasons remain available here.`),
                h('div', { className: 'tl-home-hero-actions' },
                    h('button', { type: 'button', className: 'tl-btn primary', onClick: () => onNavigate('career') }, 'My career →'),
                    h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('roster') }, 'Review my team')),
                h('p', { className: 'tl-hint' }, 'For another season, open League options, then Switch league.')),
            league.phase === 'complete' && h(SavedResultExplanation, { league, week: lastFinalized, team: myTeam, onNavigate, onInspectScore }),

            league.phase !== 'complete' && !postgame && (showWaiverDecision || showTradeDecision) && h('section', { className: 'tl-home-action-grid' },
                showWaiverDecision && h(ActionCard, {
                    icon: '+', kicker: 'WAIVER WIRE', tone: pendingWaivers ? 'info' : '',
                    title: 'Players',
                    detail: pendingWaivers ? `${pendingWaivers} claim${pendingWaivers === 1 ? '' : 's'} pending` : 'Find your next addition',
                    onClick: () => onNavigate('waivers'),
                }),
                showTradeDecision && h(ActionCard, {
                    icon: '⇄', kicker: 'TRADE BLOCK', tone: openTrades ? 'gold' : '',
                    title: 'Trades',
                    detail: openTrades ? `${openTrades} offer${openTrades === 1 ? '' : 's'} waiting` : 'Make your next deal',
                    onClick: () => onNavigate('trades'),
                })),

            h('div', { className: 'tl-home-dashboard-grid' },
            h('div', { className: 'tl-home-standings-workspace' }, playoffHunt,
                (showHunt || phone) ? h('details', { className: 'tl-home-secondary' }, h('summary', null, 'Full standings & team details'), h(window.WrTimeLeagueStandingsPanel, { league, onNavigate, embedded: true })) : h(window.WrTimeLeagueStandingsPanel, { league, onNavigate, embedded: true })),
            h('section', { className: 'tl-home-recap-grid' },
                h('article', { className: 'tl-card tl-league-update' },
                    h('header', { className: 'tl-league-update-heading' }, h('h2', null, 'League update'),
                        h('span', { className: 'tl-pill info' }, lastFinalized ? `Week ${lastFinalized.week} final` : 'Season opener')),
                    weeklyLeaders && h('div', { className: 'tl-update-highlights' },
                        weeklyLeaders.topTeam && h('div', null, h('small', null, 'High score'), h('strong', null, `${weeklyLeaders.topTeam.total.toFixed(1)} pts`), h('span', null, teamName(weeklyLeaders.topTeam.teamId))),
                        weeklyLeaders.topPlayer && h('div', null, h('small', null, 'Top performer'), h('strong', null, weeklyLeaders.topPlayer.name), h('span', null, `${league.settings.hiddenYears && !league.yearsRevealed ? (window.WrTimeLeagueYearLabel?.(league, weeklyLeaders.topPlayer, cards, logIndex, eraFactors, throughWeek) || window.App.TimeLeagueHiddenYears.label(league, weeklyLeaders.topPlayer)) : weeklyLeaders.topPlayer.drawnSeason} · ${weeklyLeaders.topPlayer.points.toFixed(1)} pts · ${teamName(weeklyLeaders.topPlayer.teamId)}`)),
                        weeklyLeaders.closest && h('div', null, h('small', null, 'Closest game'), h('strong', null, weeklyLeaders.closest.homePoints === weeklyLeaders.closest.awayPoints ? 'Tie game' : `${(Math.abs(Math.round(weeklyLeaders.closest.homePoints * 100) - Math.round(weeklyLeaders.closest.awayPoints * 100)) / 100).toFixed(2)}-point margin`), h('span', null, `${teamName(weeklyLeaders.closest.home)} vs. ${teamName(weeklyLeaders.closest.away)}`))),
                    lastFinalized ? h('div', { className: 'tl-update-results', 'aria-label': `Week ${lastFinalized.week} results` },
                        lastFinalized.matchups.map(match => h('div', { key: `${match.home}:${match.away}`, className: 'tl-update-match' },
                            h('small', null, 'FINAL'),
                            [[match.home,match.homePoints],[match.away,match.awayPoints]].map(([id,points]) => h('div', { key: id, className: match.winner === id ? 'winner' : '' },
                                h('span', null, teamName(id)), h('strong', null, points.toFixed(2)))))))
                        : h('div', { className: 'tl-home-opener-update' },
                            h('h3', null, 'Your draft is saved.'),
                            h('p', null, `${league.teams.length} teams · ${league.draftPicks.length} draft picks saved. Your next result comes from the starting lineup you choose.`),
                            h('dl', { className: 'tl-home-readiness' },
                                h('div', null, h('dt', null, 'Your roster'), h('dd', null, `${myTeam.roster.length} player${myTeam.roster.length === 1 ? '' : 's'}`)),
                                h('div', null, h('dt', null, 'Starting lineup'), h('dd', null, ready ? 'Legal' : `${lineupProblems.length} issue${lineupProblems.length === 1 ? '' : 's'}`)),
                                h('div', null, h('dt', null, 'Your desk'), h('dd', null, `${pendingWaivers} claim${pendingWaivers === 1 ? '' : 's'} · ${openTrades} offer${openTrades === 1 ? '' : 's'}`))),
                            recentMoves.length > 0 && h('div', { className: 'tl-home-recent-moves', 'aria-label': 'Recent activity' },
                                recentMoves.map(event => h('p', { key: event.id }, event.message)))),
                    lastFinalized && recentActivity.length > 0 && h('details', { className: 'tl-update-activity' }, h('summary', null, 'Recent league activity'),
                        recentActivity.map(event => h('div', { key: event.id }, h('span', null, `W${event.week}`), h('p', null, event.message)))),
                    h('footer', { className: 'tl-update-links' },
                        lastFinalized && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('gameday') }, 'Replays & box scores →'),
                        !lastFinalized && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('draft') }, 'Review draft →'),
                        h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('activity') }, 'All activity →'),
                        h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('achievements') }, 'Trophy case →'))))));
    }

    window.WrTimeLeagueHomePanel = WrTimeLeagueHomePanel;
})();
