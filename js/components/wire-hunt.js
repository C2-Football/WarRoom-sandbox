window.WrWireHuntDesk = function WireHuntDesk({league, weeks, race, seasons, postseason, refresh, openStudio, teamFilter}) {
    const api = window.WrWireHunt, odds = window.App.PlayoffOdds;
    const through = race.throughWeek, left = race.remainingWeeks;
    const [schedule, setSchedule] = React.useState(null);
    const [bracket, setBracket] = React.useState(null);
    const [priorBracket, setPriorBracket] = React.useState(null);
    const priorLeague = seasons.filter(s => Number(s.league.season) < Number(league.season) && s.league.status === 'complete')
        .sort((a,b) => Number(b.league.season) - Number(a.league.season))[0]?.league;
    const needHistory = postseason || race.rows.some(team => team.status === 'Eliminated');
    React.useEffect(() => {
        if (!needHistory || !priorLeague) return;
        const controller = new AbortController();
        window.WrWirePlayoffs.load({league:priorLeague, signal:controller.signal}).then(result => {
            if (!controller.signal.aborted && !result.provisional) setPriorBracket(result);
        }).catch(() => {});
        return () => controller.abort();
    }, [needHistory, priorLeague?.league_id, priorLeague?.season]);
    const [showField, setShowField] = React.useState(false);
    const data = React.useMemo(() => api.ledger(league, weeks, through), [league, weeks, through]);
    const archive = React.useMemo(() => api.history(league, through, seasons), [league, through, seasons]);
    React.useEffect(() => {
        let active = true;
        if (data && odds && race.supported && left && !postseason) {
            odds.fetchFuturePairs({league, fromWeek:through+1, toWeek:through+left})
                .then(result => { if (active) setSchedule(result); }).catch(() => { if (active) setSchedule({}); });
        }
        return () => { active = false; };
    }, [league, through, left, postseason, race.supported, refresh, odds, !!data]);
    React.useEffect(() => {
        if (!postseason) return;
        const controller = new AbortController();
        const update = () => window.WrWirePlayoffs.load({league, signal:controller.signal, force:!!refresh})
            .then(result => { if (!controller.signal.aborted) setBracket(result); }).catch(() => {});
        update();
        const timer = setInterval(update, 60000);
        return () => { clearInterval(timer); controller.abort(); };
    }, [league, postseason, refresh]);
    const forecast = React.useMemo(() => data && odds && race.supported && left && !postseason && api.fullSchedule(schedule, race)
        ? odds.simulate({league, ledger:data, futurePairs:schedule, sims:2000, weeklyExit:true}) : null,
        [data, odds, league, race.supported, left, through, schedule, postseason]);
    const projections = new Map((forecast?.rows || []).map(t => [String(t.rosterId), t]));
    const ranks = race.rows, inside = ranks[race.slots-1], outside = ranks[race.slots];
    const selected = ranks.find(t => t.id === String(teamFilter));
    const scores = new Map(data?.rows.map(t => [t.rosterId, t]) || []);
    const historyLine = team => {
        const owner = league.rosters.find(r => String(r.roster_id) === team.id)?.owner_id;
        const old = archive.get(owner);
        const path = owner && priorBracket?.season === String(priorLeague?.season) ? priorBracket.paths.find(p => String(p.team.ownerId) === String(owner)) : null;
        const lastLoss = path?.rounds.find(r => r.outcome === 'eliminated');
        const postseasonLine = path?.champion ? ' This owner won the '+priorBracket.season+' championship.' : lastLoss ? ' Their '+priorBracket.season+' playoff run ended in the '+lastLoss.label.toLowerCase()+'.' : '';
        if (!old) return postseasonLine.trim();
        const standing = old.status === 'Clinched' ? ', already safely in' : old.status === 'Eliminated' ? ', already out by record' : '';
        return 'At the same point in ' + old.season + ', this owner was ' + old.record + standing + '.' + postseasonLine;
    };
    const games = bracket?.provisional ? [] : bracket?.rounds || [];
    const round = games.find(r => r.games.some(g => !g.winnerId)) || games.at(-1);
    const champ = bracket?.paths?.find(p => p.champion)?.team;
    const bubble = selected || outside;
    const gap = inside.wins + inside.ties/2 - outside.wins - outside.ties/2;
    const p = projections.get(bubble.id);
    const roundGames = round?.games.filter(g => !selected || g.teams.some(t => t.id === selected.id)) || [];
    const risk = ranks.filter(t => t.status === 'In the race' && projections.get(t.id)?.weeklyExitPct > 0)
        .sort((a,b) => projections.get(b.id).weeklyExitPct - projections.get(a.id).weeklyExitPct)[0];
    const headline = postseason ? champ ? champ.name + ' takes the title' : round ? round.label + ' watch' : 'The field goes to the bracket'
        : selected ? selected.name + ' · ' + selected.record : !race.supported ? 'Where the field stands'
        : !left ? 'The regular season is in the books' : gap === 0 ? inside.name + ' and ' + outside.name + ' are level at the cut'
        : outside.name + ' trails the final spot by ' + gap + (gap === 1 ? ' game' : ' games');
    const scoringOrder = [...(data?.rows || [])].sort((a,b) => b.pf-a.pf);
    const scoringRank = team => scoringOrder.findIndex(t => t.rosterId === team.id) + 1;
    const profile = team => {
        const t = scores.get(team.id);
        if (!t?.weekly.length) return '';
        const recent = t.weekly.slice(-3);
        const recentAvg = recent.reduce((sum,g) => sum + g.pts, 0) / recent.length;
        const draw = projections.get(team.id)?.firstOpponent;
        const opponent = ranks.find(r => r.id === draw?.id);
        const meeting = opponent ? ' Most frequent first-round opponent: '+opponent.name+' ('+draw.pct+'% of all simulations).' : '';
        return 'No. ' + scoringRank(team) + ' in points. ' + (t.pf/t.weekly.length).toFixed(1) + ' per week across the season, ' + recentAvg.toFixed(1) + ' over the last ' + recent.length + '.' + meeting;
    };
    const exit = (selected ? [selected] : [...ranks].reverse()).find(t => t.status === 'Eliminated' && historyLine(t));
    const recentExits = !bracket?.provisional && (bracket?.paths || []).flatMap(path => {
        const loss = path.rounds.find(r => r.outcome === 'eliminated');
        if (!loss || selected && selected.id !== path.team.id) return [];
        return [{team:path.team, loss}];
    });
    const verdict = !race.supported && !postseason ? 'I can read the records. For the invitation list, I will need the division rules as well.'
        : champ ? 'The trophy settles the argument. Everyone else has an offseason to prepare a rebuttal.'
        : postseason ? 'Regular-season credentials have served their purpose. They got you through the door.'
        : bubble.status === 'Eliminated' ? 'Winning out would look lovely in the season recap. The invitation list is already closed.'
        : bubble.status === 'Clinched' ? 'A seat at the table, duly earned. Nobody has served the silverware yet.'
        : !postseason && scoringRank(bubble) > 0 && scoringRank(bubble) <= 3 && ranks.indexOf(bubble) >= race.slots ? bubble.name + ' ranks No. ' + scoringRank(bubble) + ' in points and still needs a chair. I would like a word with the seating committee.'
        : p && p.playoffPct < 25 ? bubble.name + ' made the field in ' + p.playoffPct + '% of our simulations. A route, yes. A travel plan, hardly.'
        : gap === 0 ? 'Matching the record is a fine opening argument. Bring points to the hearing.'
        : 'There is a perfectly good way to stop refreshing the standings. Win the game.';
    const showGame = (a,b, official, winner) => {
        const edge = Number(league.settings?.playoff_round_type ?? -1) === 0 ? api.advantage(scores.get(a.id), scores.get(b.id)) : null;
        const favorite = edge >= 50 ? a : b;
        return <li key={a.id + '-' + b.id}><strong>{a.name} vs. {b.name}</strong><span>{winner ? (winner === a.id ? a.name : b.name) + ' wins' + ([a.points,b.points].every(Number.isFinite) ? ' · '+a.points.toFixed(2)+'–'+b.points.toFixed(2) : '') : edge == null ? 'Round odds unavailable' : edge === 50 ? 'Even on season scoring form' : favorite.name + ' · ' + Math.max(edge,100-edge) + '% to advance' + (official ? '' : ' if paired')}</span></li>;
    };
    const field = ranks.slice(0,race.slots);
    const byes = 2 ** Math.ceil(Math.log2(field.length)) - field.length;
    const pairs = field.slice(byes);
    const phase = postseason ? 'Postseason edition' : left === 0 ? 'Selection week' : left <= 3 ? 'The playoff push' : 'The playoff hunt';
    const leverage = t => {
        const next = projections.get(t.id)?.nextGame;
        return next ? next.ifWin - next.ifLoss : 0;
    };
    const swing = ranks.filter(t => !selected || selected.id === t.id).slice().sort((a,b) => leverage(b)-leverage(a))[0];
    const swingGame = swing && schedule?.[through+1]?.find(pair => pair.map(String).includes(swing.id));
    const opponent = swingGame && ranks.find(t => swingGame.map(String).includes(t.id) && t.id !== swing.id);
    const conditional = swing && projections.get(swing.id)?.nextGame;
    const nextPair = risk && schedule?.[through+1]?.find(pair => pair.map(String).includes(risk.id));
    const rival = nextPair && ranks.find(t => nextPair.map(String).includes(t.id) && t.id !== risk.id);
    return <section className="wr-hunt" aria-label={phase}>
        <header><small>{phase} · {league.season}</small><h3>{headline}</h3>
        <p>{postseason ? champ ? 'Sleeper has recorded the championship result.' : round ? 'Official championship bracket' : bracket?.message || 'Checking the championship bracket…'
            : !race.supported ? race.reason : selected ? selected.needed : inside.name + ' holds position ' + race.slots + ' at ' + inside.record + '. ' + outside.name + ' is first outside at ' + outside.record + '.'}</p></header>
        {postseason && round && <ul className="wr-hunt-games">{roundGames.map(g => g.teams.every(t => t.id) ? showGame(...g.teams,true,g.winnerId) : <li key={g.id}>{g.teams.map(t => t.name).join(' vs. ')}</li>)}{round.byes.filter(t => !selected || selected.id === t.id).map(t => <li key={t.id}>{t.name} · first-round bye</li>)}</ul>}
        {!postseason && opponent && leverage(swing) >= 5 && <div className="wr-hunt-fixture"><small>Game of the week · Wk {through+1}</small><h4>{swing.name} vs. {opponent.name}</h4><p>{swing.name} makes the field in <b>{conditional.ifWin}%</b> of simulations with a win here. With a loss, that falls to <b>{conditional.ifLoss}%</b>.</p></div>}
        {!postseason && risk && (!selected || selected.id === risk.id) && <p className="wr-hunt-stakes"><b>Elimination watch</b> {risk.name}{rival ? ' faces ' + rival.name : ''} with a {projections.get(risk.id).weeklyExitPct}% chance of falling out by the end of Week {through+1}.</p>}
        {!postseason && exit && <p className="wr-hunt-stakes"><b>Exit interview</b> {exit.name} is out at {exit.record}. {historyLine(exit)}</p>}
        {postseason && recentExits.length > 0 && <details><summary>Elimination notebook</summary>{recentExits.map(({team,loss}) => <p key={team.id}><b>{team.name}</b> went out in the {loss.label.toLowerCase()}{loss.opponent ? ' against '+loss.opponent.name : ''}. {loss.points.every(Number.isFinite) ? loss.points.map(x => x.toFixed(2)).join('–')+'. ' : ''}{historyLine(team)}</p>)}</details>}
        <blockquote><small>The Verdict · Vera Slate</small><p>{verdict}</p></blockquote>
        {!postseason && <><div className="wr-hunt-board"><h4>Race board</h4><small>Through Wk {through} · {left} {left === 1 ? 'week' : 'weeks'} left</small></div>
        <div className="wr-hunt-table"><div className="wr-hunt-row wr-hunt-labels"><span>Team / record</span><span>Make field</span><span>{left ? 'Out W'+(through+1) : 'Exit risk'}</span></div>
        {ranks.filter((t,i) => selected ? t.id === selected.id : showField || Math.abs(i-race.slots+0.5) < 2).map(t => {
            const index = ranks.indexOf(t), projection = projections.get(t.id);
            return <details key={t.id} className={index === race.slots ? 'wr-hunt-cut' : ''}><summary className="wr-hunt-row"><span><strong>{index+1}. {t.name}</strong><small>{t.record} · {t.status}</small></span><b>{projection ? projection.playoffPct+'%' : '—'}</b><b>{projection && t.status === 'In the race' ? projection.weeklyExitPct+'%' : '—'}</b></summary><p>{profile(t)} {t.needed} {historyLine(t)}</p></details>;
        })}</div>
        {!selected && <button type="button" aria-expanded={showField} onClick={() => setShowField(!showField)}>{showField ? 'Show the bubble' : 'All '+ranks.length+' teams'}</button>}
        {left > 0 && race.supported && !forecast && <p>{schedule === null && data ? 'Checking remaining matchups…' : 'Odds need a complete schedule and scoring history.'}</p>}
        {race.supported && pairs.length >= 2 && <details className="wr-hunt-draw"><summary>If the playoffs started here</summary><ul className="wr-hunt-games">{field.slice(0,byes).map(t => <li key={t.id}>{t.name} · projected bye</li>)}{pairs.slice(0,pairs.length/2).map((a,i) => showGame(a,pairs[pairs.length-1-i],false,null))}</ul></details>}</>}
        {postseason && <button type="button" onClick={openStudio}>Full bracket &amp; team paths →</button>}
        <details className="wr-hunt-method"><summary>How the odds work</summary><p>Field odds simulate the remaining schedule 2,000 times using each team’s season scoring, weighted toward recent weeks. Weekly exit counts finishes that put the cutline beyond a team’s remaining wins. In the last week, points break record ties. Earlier exits are conservative. Round odds compare every regular-season score for one opponent with every score for the other, splitting ties. They describe a single game before kickoff.</p></details>
    </section>;
};
