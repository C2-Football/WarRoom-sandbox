(function () {
    'use strict';

    const h = React.createElement;
    const Engine = window.App.TimeLeagueEngine;
    const roundName = (week, end) => ['Championship', 'Semifinals', 'Quarterfinals'][end - week];
    const score = points => points.toFixed(2);
    const record = row => [row.wins, row.losses, ...(row.ties ? [row.ties] : [])].join('–');
    const marginInCents = match => Math.abs(Math.round(match.homePoints * 100) - Math.round(match.awayPoints * 100));

    const canShowDesk = (league, week = league.currentWeek) =>
        Boolean(Engine.playoffCount(league) && league.phase !== 'draft' && week > Math.floor(league.settings.regularSeasonWeeks / 2));

    function recentProduction(weeks, teamId) {
        const results = weeks.flatMap(week => (week.results || [])
            .filter(result => result.teamId === teamId && Number.isFinite(result.total))).slice(-3);
        if (!results.length) return null;
        const points = results.reduce((sum, result) => sum + result.total, 0);
        return { results, average: points / results.length };
    }

    function positionEdge(home, away, homeName, awayName) {
        if (!home || !away) return null;
        const averages = recent => {
            const totals = new Map();
            for (const result of recent.results) {
                for (const player of result.starters || []) {
                    if (!player.position || !Number.isFinite(player.points)) continue;
                    totals.set(player.position, (totals.get(player.position) || 0) + player.points);
                }
            }
            return totals;
        };
        const homeTotals = averages(home);
        const awayTotals = averages(away);
        const edges = [...homeTotals].filter(([position]) => awayTotals.has(position)).map(([position, total]) => ({
            position, difference: total / home.results.length - awayTotals.get(position) / away.results.length,
        })).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
        const edge = edges[0];
        return edge && Math.abs(edge.difference) >= 0.01
            ? { position: edge.position, points: Math.abs(edge.difference), team: edge.difference > 0 ? homeName : awayName } : null;
    }

    function fixtureNote(weeks, home, away, club) {
        const meeting = weeks.flatMap(week => (week.matchups || []).filter(match =>
            [match.home, match.away].includes(home) && [match.home, match.away].includes(away)).map(match => ({ week: week.week, match }))).at(-1);
        if (!meeting || !Number.isFinite(meeting.match.homePoints) || !Number.isFinite(meeting.match.awayPoints)) return null;
        const { match } = meeting;
        return `Last meeting (Week ${meeting.week}): ${club(match.home)} ${score(match.homePoints)}–${score(match.awayPoints)} ${club(match.away)}.`;
    }

    function buildDesk(league, teamId, throughWeek) {
        const regular = league.settings.regularSeasonWeeks;
        const lastComplete = league.currentWeek - 1;
        const horizon = Number.isInteger(throughWeek) ? Math.min(lastComplete, throughWeek) : lastComplete;
        const next = horizon + 1;
        if (!canShowDesk(league, next)) return null;

        const count = Engine.playoffCount(league);
        const weeks = (league.finalizedWeeks || []).filter(row => row.week <= horizon).sort((a, b) => a.week - b.week);
        const standings = Engine.computeStandings({ ...league, finalizedWeeks: weeks });
        const standingOf = new Map(standings.map(row => [row.teamId, row]));
        const seedOf = new Map(standings.slice(0, count).map((row, index) => [row.teamId, index + 1]));
        const names = new Map(league.teams.map(team => [team.teamId, team.name]));
        const club = id => names.get(id) ?? 'Team';
        const regularWeeks = weeks.filter(week => week.week > 0 && week.week <= regular);
        const played = new Set(regularWeeks.map(week => week.week));
        const remaining = regular - played.size;
        const remainingSchedule = (league.schedule || []).filter(week => week.week <= regular && !played.has(week.week));
        const scheduleCoversRemaining = remainingSchedule.length === remaining && new Set(remainingSchedule.map(week => week.week)).size === remaining;
        const ceilings = new Map(standings.map(row => [row.teamId,
            row.wins + remainingSchedule.filter(week => (week.pairs || []).some(pair => pair.includes(row.teamId))).length]));
        const statusOf = row => {
            if (!remaining) return seedOf.has(row.teamId) ? 'Clinched' : 'Eliminated';
            if (!scheduleCoversRemaining) return null;
            const others = standings.filter(other => other.teamId !== row.teamId);
            if (others.filter(other => ceilings.get(other.teamId) >= row.wins).length < count) return 'Clinched';
            if (others.filter(other => other.wins > ceilings.get(row.teamId)).length >= count) return 'Eliminated';
            return null;
        };
        const regularMatches = regularWeeks.flatMap(week => week.matchups || []);
        const opponentWinRate = id => {
            const opponents = regularMatches.filter(match => match.home === id || match.away === id)
                .map(match => standingOf.get(match.home === id ? match.away : match.home)).filter(Boolean);
            const games = opponents.reduce((sum, row) => sum + row.wins + row.losses + row.ties, 0);
            return games ? opponents.reduce((sum, row) => sum + row.wins + row.ties * 0.5, 0) / games : null;
        };
        const field = standings.map(row => ({
            teamId: row.teamId, name: club(row.teamId), seed: seedOf.get(row.teamId),
            record: record(row), points: row.pointsFor, status: statusOf(row),
        }));
        const finalWeek = Engine.seasonEndWeek(league);
        const rounds = [];
        for (let week = regular + 1; !remaining && week <= finalWeek && week <= next; week++) {
            const saved = weeks.find(row => row.week === week);
            const past = week <= horizon;
            const matches = past ? (saved?.matchups || []) : Engine.playoffPairs({ ...league, finalizedWeeks: weeks }, week)
                .map(([home, away]) => ({ home, away }));
            if (!matches.length) continue;
            rounds.push({ week, name: roundName(week, finalWeek), past,
                matches: matches.map(match => {
                    const winner = match.winner;
                    const loser = winner === match.home ? match.away : match.home;
                    const margin = past ? marginInCents(match) : null;
                    const upset = seedOf.get(winner) > seedOf.get(loser);
                    const players = (saved?.results || []).filter(row => row.teamId === match.home || row.teamId === match.away)
                        .flatMap(row => (row.starters || []).filter(starter => starter.name && Number.isFinite(starter.points))
                            .map(starter => ({ name: starter.name, points: starter.points, club: club(row.teamId) })));
                    const top = players.sort((a, b) => b.points - a.points)[0];
                    const homeRecent = past ? null : recentProduction(weeks, match.home);
                    const awayRecent = past ? null : recentProduction(weeks, match.away);
                    const homeName = club(match.home);
                    const awayName = club(match.away);
                    const form = recent => recent && { average: recent.average, games: recent.results.length };
                    const side = (id, points, recent) => past
                        ? { name: club(id), seed: seedOf.get(id), points, winner: winner === id }
                        : { name: club(id), seed: seedOf.get(id), recent: form(recent) };
                    return {
                        home: side(match.home, match.homePoints, homeRecent), away: side(match.away, match.awayPoints, awayRecent),
                        includesUser: [match.home, match.away].includes(teamId),
                        winner: winner ? club(winner) : null, upset, margin, top,
                        positionEdge: positionEdge(homeRecent, awayRecent, homeName, awayName),
                        lastMeeting: past ? null : fixtureNote(weeks, match.home, match.away, club),
                        opponentRates: past ? null : [opponentWinRate(match.home), opponentWinRate(match.away)],
                    };
                }),
            });
        }

        const latest = rounds.at(-1);
        const champion = latest?.past && latest.week === finalWeek ? latest.matches[0]?.winner : null;
        return { count, field, remaining, rounds, champion, teamId, finalWeek };
    }

    function raceHeadline(desk) {
        const line = desk.field[desk.count - 1];
        const chasing = desk.field[desk.count];
        if (desk.field.slice(0, desk.count).every(row => row.status === 'Clinched')) return 'The tickets are punched. The last games decide who plays whom.';
        if (!chasing) return `Everybody's in the picture. ${line.name} holds the last seed for now.`;
        if (line.record === chasing.record) {
            const difference = score(Math.abs(line.points - chasing.points));
            return line.points === chasing.points
                ? `${line.name} and ${chasing.name} are level on record and points. The league tiebreakers put ${line.name} above the cut.`
                : `${line.name} has the last ticket. ${difference} points separate them from ${chasing.name} on the same record.`;
        }
        return `${line.name} has the final spot at ${line.record}. ${chasing.name} sits just below the cut at ${chasing.record}.`;
    }

    function Field({ desk }) {
        return h('ul', { className: 'tl-desk-field', 'aria-label': desk.remaining ? 'Current playoff standings' : 'Final playoff seedings' },
            desk.field.filter(row => desk.remaining || row.seed).map((row, index) =>
                h('li', { key: row.teamId, className: [row.teamId === desk.teamId && 'is-mine', index === desk.count && 'at-cut'].filter(Boolean).join(' ') },
                    h('span', { className: 'tl-desk-seed' }, row.seed ? `#${row.seed}` : '–'),
                    h('strong', null, row.name, row.teamId === desk.teamId ? ' · You' : '',
                        row.status && desk.remaining > 0 && h('small', { className: 'tl-desk-status' }, row.status)),
                    h('span', null, row.record), h('span', null, `${score(row.points)} PF`))));
    }

    function Match({ match, past }) {
        const { home, away, winner, margin, upset, top, lastMeeting, positionEdge, opponentRates } = match;
        const tag = !past ? (match.includesUser ? 'Your matchup' : 'Upcoming')
            : margin === 0 ? 'Seed tiebreaker' : upset ? 'Upset' : margin < 500 ? 'Photo finish' : 'Final';
        return h('article', { className: 'tl-desk-match' },
            h('span', { className: 'tl-desk-tag' }, tag),
            [home, away].map((side, index) => h('div', { key: index, className: side.winner ? 'is-winner' : undefined },
                h('strong', null, side.seed ? `#${side.seed} ` : '', side.name),
                past && Number.isFinite(side.points) ? h('span', null, score(side.points))
                    : side.recent && h('span', null, `${score(side.recent.average)} avg · ${side.recent.games} GP`))),
            past && winner && h('p', null, margin === 0 ? `${winner} advances on the higher seed.`
                : `${winner} wins by ${score(margin / 100)}.`,
            top && ` Top starter: ${top.name}, ${score(top.points)} points for ${top.club}.`),
            lastMeeting && h('p', null, lastMeeting),
            opponentRates?.every(Number.isFinite) && h('p', null,
                `Regular-season opponent win rate: ${home.name} ${(opponentRates[0] * 100).toFixed(1)}% · ${away.name} ${(opponentRates[1] * 100).toFixed(1)}%.`),
            positionEdge && h('p', null, `Recent ${positionEdge.position} edge: ${positionEdge.team} by ${score(positionEdge.points)} points per game.`));
    }

    function RoundContents({ round, onNavigate, onInspectScore }) {
        return h(React.Fragment, null,
            h('div', { className: 'tl-desk-matchups' }, round.matches.map((match, index) => h(Match, { key: index, match, past: round.past }))),
            (round.past ? onInspectScore : onNavigate) && h('button', { type: 'button', className: 'tl-btn',
                onClick: () => round.past ? onInspectScore(round.week) : onNavigate('gameday') },
            round.past ? `Week ${round.week} box scores →` : 'Follow on Game Day →'));
    }

    function WrTimeLeaguePostseasonDesk({ desk, onNavigate, onInspectScore, showEntry = false }) {
        if (!desk) return null;
        const activeRound = desk.rounds.at(-1);
        const headline = desk.remaining ? raceHeadline(desk)
            : desk.champion ? `${desk.champion} takes the Vault title.`
            : activeRound && !activeRound.past && activeRound.week === desk.finalWeek ? 'Two teams. One last argument.'
                : activeRound?.matches.some(match => match.includesUser) ? 'The bracket is set. Reputation gets no bye.'
                    : 'The bracket moves on. Pick a game to follow.';
        return h('section', { className: 'tl-card tl-postseason-desk', 'aria-label': 'The Desk' },
            h('header', null, h('span', { className: 'tl-eyebrow' }, 'THE DESK'),
                h('h2', null, desk.remaining ? 'Playoff Hunt' : activeRound?.name || 'Playoff field'),
                h('p', null, headline)),
            desk.remaining > 0
                ? h(React.Fragment, null, h('p', { className: 'tl-desk-context' },
                    `${desk.remaining} regular-season ${desk.remaining === 1 ? 'week' : 'weeks'} left · Top ${desk.count} advance`), h(Field, { desk }))
                : h(React.Fragment, null,
                    activeRound && h(RoundContents, { round: activeRound, onNavigate, onInspectScore }),
                    [...desk.rounds.slice(0, -1)].reverse().map(round => h('details', { key: round.week },
                        h('summary', null, `${round.name} · Week ${round.week}`),
                        h(RoundContents, { round, onNavigate, onInspectScore }))),
                    h('details', { open: !activeRound || undefined }, h('summary', null, 'Playoff seeds'), h(Field, { desk }))),
            showEntry && onNavigate && h('button', { type: 'button', className: 'tl-btn', onClick: () => onNavigate('desk') }, 'Open The Desk →'));
    }

    window.App.TimeLeaguePostseasonDesk = { buildDesk, canShowDesk };
    window.WrTimeLeaguePostseasonDesk = WrTimeLeaguePostseasonDesk;
})();
