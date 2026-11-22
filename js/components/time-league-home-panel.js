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

    function wireStoriesFor(league, teamId, throughWeek) {
        const teams = new Map(league.teams.map(team => [team.teamId, team.name]));
        const name = id => teams.get(id) || 'A league team';
        const actionWeek = Math.max(1, league.currentWeek - (league.weekStage === 'postgame' ? 1 : 0));
        const planningHorizon = Number.isInteger(throughWeek) ? Math.min(actionWeek, throughWeek + 1) : actionWeek;
        const finals = (league.finalizedWeeks || []).filter(week => !Number.isInteger(throughWeek) || week.week <= throughWeek);
        const latest = finals[finals.length - 1];
        const stories = [];
        if (latest) {
            const match = (latest.matchups || []).find(row => row.home === teamId || row.away === teamId) || latest.matchups?.[0];
            const result = (latest.results || []).find(row => row.teamId === teamId);
            if (match) {
                const margin = Math.abs(Math.round(match.homePoints * 100) - Math.round(match.awayPoints * 100)) / 100;
                stories.push({ id: `final:${latest.week}`, week: latest.week, priority: 8, kicker: 'VAULT RESULT', title: match.winner ? `${name(match.winner)} takes Week ${latest.week}` : `Week ${latest.week} ends level`,
                    detail: `${name(match.home)} ${match.homePoints.toFixed(2)}–${match.awayPoints.toFixed(2)} ${name(match.away)}. ${margin ? `${margin.toFixed(2)} points made the difference.` : match.winner ? 'The saved tiebreaker decides it.' : 'The tied result stands.'}`, tab: 'gameday', scoreWeek: latest.week });
            } else if (result) stories.push({ id: `final:${latest.week}`, week: latest.week, priority: 8, kicker: 'VAULT RESULT', title: `${name(teamId)} banks ${result.total.toFixed(2)} lineup points`, detail: `Week ${latest.week} is saved. Inspect the starting lineup and how its points were calculated.`, tab: 'gameday', scoreWeek: latest.week });
        }
        (league.trades || []).forEach((trade, index) => {
            const own = trade.fromTeamId === teamId || trade.toTeamId === teamId;
            const week = trade.respondedWeek || trade.week || 1;
            if (week > planningHorizon || (!own && trade.status !== 'accepted') || !['pending', 'accepted'].includes(trade.status)) return;
            const pending = trade.status === 'pending';
            stories.push({ id: `trade:${trade.tradeId}`, week, priority: pending && trade.toTeamId === teamId ? 10 : 6, index,
                kicker: pending ? 'YOUR TRADE DESK' : 'SAVED TRADE', title: pending ? trade.fromTeamId === teamId ? `${name(trade.toTeamId)} has your proposal` : `${name(trade.fromTeamId)} sent you an offer` : `${name(trade.fromTeamId)} and ${name(trade.toTeamId)} make a deal`,
                detail: `${(trade.giveEntryIds || []).length}-for-${(trade.receiveEntryIds || []).length} player exchange. ${pending ? trade.deferredUntilWeek > planningHorizon ? `Deferred until Week ${trade.deferredUntilWeek}.` : 'Review the packages at the trade desk.' : 'The accepted packages are saved in trade history.'}`, tab: 'trades' });
        });
        const awards = (league.waiverResults || []).filter(award => award.week <= planningHorizon);
        const seenAwards = new Set();
        [...awards].reverse().forEach((award, index) => {
            const key = `${award.week}:${award.identity}:${award.winnerTeamId}`;
            if (seenAwards.has(key)) return;
            seenAwards.add(key);
            stories.push({ id: `waiver:${key}`, week: award.week, priority: award.winnerTeamId === teamId ? 7 : 4, index, kicker: 'WAIVER RESULT', title: `${name(award.winnerTeamId)} adds ${award.name || 'a player'}`, detail: `Week ${award.week} award saved${award.contenderTeamIds?.length > 1 ? ` after ${award.contenderTeamIds.length} teams filed a claim` : ''}. Review the recorded waiver activity.`, tab: 'waivers' });
        });
        // Draft records contain public selections; no assigned season or hidden
        // report is needed to describe what actually happened in this room.
        const picks = league.draftPicks || [];
        const lastPick = picks[picks.length - 1];
        if (lastPick?.name) stories.push({ id: 'draft:last', week: 0, priority: 3, kicker: 'DRAFT ARCHIVE', title: `${name(lastPick.teamId)} selected ${lastPick.name}`, detail: `${lastPick.position ? `${lastPick.position} · ` : ''}${picks.length} selections are saved. Revisit the room and the choices that built these teams.`, tab: 'draft' });
        if (!latest) stories.push({ id: 'draft:rosters', week: 0, priority: 2, kicker: 'THE FIELD IS SET', title: `${league.teams.length} teams. Your next chapter starts here.`, detail: picks.length ? `${picks.length} draft ${picks.length === 1 ? 'pick is' : 'picks are'} saved. Your starting lineup determines which players count in the next game.` : 'Your roster is saved. Review the players who will count in the next game.', tab: 'roster' });
        if (league.phase === 'complete' && league.championTeamId && latest && latest.week === Engine.seasonEndWeek(league)) stories.push({ id: 'champion', week: latest.week, priority: 11, kicker: 'SEASON MILESTONE', title: `${name(league.championTeamId)} claims the title`, detail: 'The final result is saved. Revisit the season record and your earned achievements.', tab: 'achievements' });
        return stories.sort((a, b) => b.week - a.week || b.priority - a.priority || (b.index || 0) - (a.index || 0)).slice(0, 3);
    }

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
        const visibleLeague = useMemo(() => Number.isInteger(throughWeek) ? { ...league, finalizedWeeks: league.finalizedWeeks.filter(week => week.week <= throughWeek) } : league, [league, throughWeek]);
        const standings = useMemo(() => Engine.computeStandings(visibleLeague), [visibleLeague]);
        const teamOf = (teamId) => league.teams.find((team) => team.teamId === teamId);
        const teamName = (teamId) => teamOf(teamId)?.name ?? teamId;
        const standingOf = (teamId) => standings.find((row) => row.teamId === teamId);
        const myTeam = league.teams.find((team) => seatTeamId ? team.teamId === seatTeamId : team.manager === 'human') ?? league.teams[0];
        const myStanding = standingOf(myTeam.teamId);
        const currentSchedule = league.currentWeek > league.settings.regularSeasonWeeks ? { pairs: Engine.playoffPairs(league, league.currentWeek) } : league.schedule.find((item) => item.week === league.currentWeek);
        const participation = Engine.weekParticipation(league, myTeam.teamId);
        const postgame = league.weekStage === 'postgame';
        const justFinished = postgame ? visibleLeague.finalizedWeeks[visibleLeague.finalizedWeeks.length - 1] : null;
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
        const lastFinalized = visibleLeague.finalizedWeeks[visibleLeague.finalizedWeeks.length - 1] ?? null;
        const lastMatchup = lastFinalized?.matchups.find((matchup) => matchup.home === myTeam.teamId || matchup.away === myTeam.teamId) ?? null;
        const lastResult = lastMatchup ? (lastMatchup.winner === null ? 'T' : lastMatchup.winner === myTeam.teamId ? 'W' : 'L') : null;
        const wireStories = wireStoriesFor(league, myTeam.teamId, throughWeek);
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
        const desk = useMemo(() => window.App.TimeLeaguePostseasonDesk?.buildDesk(league, myTeam.teamId, throughWeek), [league, myTeam.teamId, throughWeek]);
        const postseasonDesk = desk && h(window.WrTimeLeaguePostseasonDesk, { desk, onNavigate, onInspectScore, showEntry: true });

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
                h('div', { className: 'tl-recap-dashboard' },
                h('div', { className: 'tl-recap-decision-column' },
                    h(SavedResultExplanation, { league, week: justFinished, team: myTeam, onNavigate, onInspectScore }),
                    h('section', { className: 'tl-card tl-recap-next' }, h('span', { className: 'tl-eyebrow' }, `UP NEXT · WEEK ${league.currentWeek}`),
                        h('h2', null, nextOpponent ? `${myTeam.name} vs. ${nextOpponent.name}` : playoffObserver ? 'Follow the championship' : 'No matchup scheduled'),
                        h('p', null, playoffObserver ? 'Your playoff run is complete. End week when you are ready, then follow the remaining games from game day.' : league.settings.waiversEnabled ? 'End week opens the next waiver window. Submit claims, resolve waivers, then set your lineup for kickoff.' : 'End week opens the next planning window. Review trades and set your lineup for kickoff.'))),
                h('div', { className: 'tl-recap-league-column' },
                h('section', { className: 'tl-card tl-league-update' },
                    h('h2', null, 'Around the league'),
                    weeklyLeaders && h('div', { className: 'tl-update-highlights' },
                        weeklyLeaders.topTeam && h('div', null, h('small', null, 'High score'), h('strong', null, `${weeklyLeaders.topTeam.total.toFixed(1)} pts`), h('span', null, teamName(weeklyLeaders.topTeam.teamId))),
                        weeklyLeaders.topPlayer && h('div', null, h('small', null, 'Player of the week'), h('strong', null, weeklyLeaders.topPlayer.name), h('span', null, `${weeklyLeaders.topPlayer.points.toFixed(1)} pts · ${teamName(weeklyLeaders.topPlayer.teamId)}`))),
                    h('div', { className: 'tl-update-results', 'aria-label': `Week ${justFinished.week} results` }, justFinished.matchups.map(match =>
                        h('div', { key: `${match.home}:${match.away}`, className: 'tl-update-match' }, h('small', null, 'FINAL'),
                            [[match.home, match.homePoints], [match.away, match.awayPoints]].map(([id, points]) => h('div', { key: id, className: match.winner === id ? 'winner' : '' }, h('span', null, teamName(id)), h('strong', null, points.toFixed(2)))))))),
                postseasonDesk,
                h('details', { className: 'tl-home-secondary' }, h('summary', null, 'Updated standings & team profiles'), h(window.WrTimeLeagueStandingsPanel, { league, embedded: true })))));
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
            h('div', { className: 'tl-home-standings-workspace' }, postseasonDesk,
                (desk || phone) ? h('details', { className: 'tl-home-secondary' }, h('summary', null, 'Full standings & team details'), h(window.WrTimeLeagueStandingsPanel, { league: visibleLeague, onNavigate, embedded: true })) : h(window.WrTimeLeagueStandingsPanel, { league: visibleLeague, onNavigate, embedded: true })),
            h('section', { className: 'tl-home-recap-grid' },
                h('article', { className: 'tl-card tl-league-update' },
                    h('header', { className: 'tl-league-update-heading' }, h('div', null, h('small', { className: 'tl-home-wire-masthead' }, 'THE VAULT WIRE'), h('h2', null, 'League update')),
                        h('span', { className: 'tl-pill info' }, 'From your league')),
                    h('ol', { className: 'tl-home-wire', 'aria-label': 'Vault league stories' }, wireStories.map((story, index) => h('li', { key: story.id }, h('button', { type: 'button', className: 'tl-home-wire-story', onClick: () => story.scoreWeek && onInspectScore ? onInspectScore(story.scoreWeek) : onNavigate(story.tab) },
                        h('small', null, story.kicker, story.week ? ` · WEEK ${story.week}` : ''), h('strong', null, story.title), index === 0 ? h('span', null, story.detail) : null, h('b', { 'aria-hidden': true }, '↗'))))),
                    lastFinalized && h('details', { className: 'tl-home-wire-finals' }, h('summary', null, `Week ${lastFinalized.week} finals & leaders`),
                    weeklyLeaders && h('div', { className: 'tl-update-highlights' },
                        weeklyLeaders.topTeam && h('div', null, h('small', null, 'High score'), h('strong', null, `${weeklyLeaders.topTeam.total.toFixed(1)} pts`), h('span', null, teamName(weeklyLeaders.topTeam.teamId))),
                        weeklyLeaders.topPlayer && h('div', null, h('small', null, 'Top performer'), h('strong', null, weeklyLeaders.topPlayer.name), h('span', null, `${league.settings.hiddenYears && !league.yearsRevealed ? (window.WrTimeLeagueYearLabel?.(league, weeklyLeaders.topPlayer, cards, logIndex, eraFactors, throughWeek) || window.App.TimeLeagueHiddenYears.label(league, weeklyLeaders.topPlayer)) : weeklyLeaders.topPlayer.drawnSeason} · ${weeklyLeaders.topPlayer.points.toFixed(1)} pts · ${teamName(weeklyLeaders.topPlayer.teamId)}`)),
                        weeklyLeaders.closest && h('div', null, h('small', null, 'Closest game'), h('strong', null, weeklyLeaders.closest.homePoints === weeklyLeaders.closest.awayPoints ? 'Tie game' : `${(Math.abs(Math.round(weeklyLeaders.closest.homePoints * 100) - Math.round(weeklyLeaders.closest.awayPoints * 100)) / 100).toFixed(2)}-point margin`), h('span', null, `${teamName(weeklyLeaders.closest.home)} vs. ${teamName(weeklyLeaders.closest.away)}`))),
                    h('div', { className: 'tl-update-results', 'aria-label': `Week ${lastFinalized.week} results` },
                        lastFinalized.matchups.map(match => h('div', { key: `${match.home}:${match.away}`, className: 'tl-update-match' },
                            h('small', null, 'FINAL'),
                            [[match.home,match.homePoints],[match.away,match.awayPoints]].map(([id,points]) => h('div', { key: id, className: match.winner === id ? 'winner' : '' },
                                h('span', null, teamName(id)), h('strong', null, points.toFixed(2)))))))),
                    h('footer', { className: 'tl-update-links' },
                        lastFinalized && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('gameday') }, 'Replays & box scores →'),
                        !lastFinalized && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('draft') }, 'Review draft →'),
                        h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('activity') }, 'All activity →'),
                        h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('achievements') }, 'Trophy case →'))))));
    }

    window.WrTimeLeagueHomePanel = WrTimeLeagueHomePanel;
    window.App.TimeLeagueHomeWire = { storiesFor: wireStoriesFor };
})();
