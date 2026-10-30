// Command Center's weekly Sleeper scoreboard. Scores are provider snapshots,
// never inferred game completion or recomputed from a league's current roster.
// Progress describes NFL games for the reported starters, never fantasy-point totals.
// Caller limits this to the current week because the player directory has current NFL teams.
function leagueScoreboardStarterProgress(...args) {
    return window.App.LeagueLiveScores.starterProgress(...args);
}
function leagueScoreboardProjectedFinish(...args) {
    return window.App.LeagueLiveScores.projectedFinish(...args);
}

function LeagueLiveScoreboard({ currentLeague, myRoster, playersData, getOwnerName, getPlayerName, setActiveTab, selectedWeek, onWeekChange, onRefresh, onOpenTeam, fullBoard = false, overview = false }) {
    const service = window.App.LeagueLiveScores;
    const isPhone = !!window.WR?.useViewport?.().isPhone;
    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const defaultWeek = service.currentWeek(currentLeague);
    const [selection, setSelection] = React.useState(null);
    const [expanded, setExpanded] = React.useState(false);
    const [starterSelection, setStarterSelection] = React.useState(null);
    const week = selectedWeek != null ? selectedWeek : selection?.leagueId === leagueId ? selection.week : defaultWeek;
    const liveSeason = Number(window.S?.nflState?.season) || new Date().getFullYear();
    const canOpenGameDay = Number(week) === Number(defaultWeek) && (!Number(currentLeague?.season) || Number(currentLeague.season) === liveSeason);
    const board = service.useScores({ league: currentLeague, week });
    const [nfl, setNfl] = React.useState({ key: '', games: [] });
    const [, setProjectionRevision] = React.useState(0);
    const nflKey = `${currentLeague?.season || ''}|${week}`;
    React.useEffect(() => {
        const context = window.App?.NflContext;
        if (!context?.loadScores || !/^\d{4}$/.test(String(currentLeague?.season || ''))) return;
        let alive = true, fetching = false;
        const refresh = async () => {
            if (!alive || fetching || document.visibilityState === 'hidden') return;
            fetching = true;
            try {
                // Use the same opponent/venue context as Game Day so the two
                // surfaces do not show different fallback projections.
                const [games] = await Promise.all([
                    context.loadScores(week, currentLeague.season, 2),
                    canOpenGameDay && typeof context.load === 'function' ? Promise.resolve(context.load([Number(week)], currentLeague.season)).catch(() => null) : null,
                ]);
                if (alive) setNfl({ key: nflKey, games: games || [] });
            } catch (_) {
                if (alive) setNfl({ key: nflKey, games: [] });
            } finally { fetching = false; }
        };
        refresh();
        const timer = setInterval(refresh, 60000);
        document.addEventListener('visibilitychange', refresh);
        return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [nflKey]);
    React.useEffect(() => {
        if (!canOpenGameDay) return;
        const refresh = event => { if (Number(event.detail?.week) === Number(week) && Number(event.detail?.season) === Number(currentLeague?.season)) setProjectionRevision(value => value + 1); };
        window.addEventListener('wr:projections-loaded', refresh);
        window.App?.WeeklyProj?.ensureWeekProjections?.(week);
        return () => window.removeEventListener('wr:projections-loaded', refresh);
    }, [nflKey, canOpenGameDay]);
    const nflGames = nfl.key === nflKey ? nfl.games.slice().sort((a, b) => (new Date(a.kickoff).getTime() || 0) - (new Date(b.kickoff).getTime() || 0)) : [];
    const chopped = !!window.App?.Chopped?.isChopped?.(currentLeague);
    const own = row => myRoster?.roster_id != null && String(row.roster_id) === String(myRoster.roster_id);
    const rosterFor = row => (currentLeague?.rosters || []).find(r => String(r.roster_id) === String(row.roster_id));
    const ownerName = row => {
        const roster = rosterFor(row);
        const user = (currentLeague?.users || []).find(u => u.user_id === roster?.owner_id);
        return getOwnerName?.(row.roster_id) || user?.metadata?.team_name || user?.display_name || `Team ${row.roster_id}`;
    };
    const points = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2);
    const teamPoints = row => service.rosterPoints(row);
    let projections = {};
    if (canOpenGameDay && nflGames.length && window.App?.WeeklyProj?.projectRoster) {
        try { projections = window.App.WeeklyProj.projectRoster([...new Set((board.rows || []).flatMap(row => row.starters || []).filter(pid => pid && String(pid) !== '0'))], {
            playersData, statsData: window._wrStatsData || {}, priorData: window.S?.priorData || {}, scoring: currentLeague?.scoring_settings || {}, week,
        }); } catch (_) { /* Unavailable projections stay a dash. */ }
    }
    const projectedFinish = row => leagueScoreboardProjectedFinish(row, playersData, nflGames, currentLeague, week, projections, service);
    const compareScores = (value, opponent) => {
        const known = number => number != null && String(number).trim() !== '' && Number.isFinite(Number(number));
        if (!known(value) || !known(opponent)) return { state: 'unavailable', delta: null };
        const delta = Number(value) - Number(opponent);
        return { state: delta > 0 ? 'leading' : delta < 0 ? 'trailing' : 'tied', delta };
    };
    const projectionLine = (row, opponent) => {
        if (!canOpenGameDay) return null;
        const finish = projectedFinish(row), comparison = compareScores(finish, opponent ? projectedFinish(opponent) : null);
        const cue = comparison.state === 'leading' ? 'projected ahead' : comparison.state === 'trailing' ? 'projected behind' : comparison.state === 'tied' ? 'projected even' : '';
        return <span className="mc-score-projection" data-projection-state={comparison.state} aria-label={`Projected finish ${points(finish)}${cue ? '; ' + cue + (comparison.delta ? ' by ' + points(Math.abs(comparison.delta)) : '') : ''}`} title="Projected finish: earned points from completed games plus full-game estimates for unfinished starters. Live estimates are at least points already earned; a dash means required data is unavailable.">Proj. finish <strong>{points(finish)}{cue && <span className="mc-score-projection-cue" aria-hidden="true">{comparison.state === 'leading' ? '↑' : comparison.state === 'trailing' ? '↓' : '='}</span>}</strong>{finish != null && service.finishAssumption?.(row, projections) && <small className="mc-score-finish-assumption"> · if they play</small>}</span>;
    };
    const groups = (board.groups || []).slice().sort((a, b) => Number(b.teams.some(own)) - Number(a.teams.some(own)));
    const ladder = (board.rows || []).filter(row => {
        const roster = rosterFor(row);
        return !roster || !window.App?.Chopped?.isAliveInWeek || window.App.Chopped.isAliveInWeek(roster, week);
    }).sort((a, b) => (teamPoints(b) ?? -Infinity) - (teamPoints(a) ?? -Infinity));
    const compactChop = chopped && isPhone;
    // A missing weekly row stays unknown; current roster contents cannot stand
    // in for the provider's selected-week score or starters.
    const raceRows = compactChop ? [
        ...(currentLeague?.rosters || []).filter(roster => !window.App?.Chopped?.isAliveInWeek || window.App.Chopped.isAliveInWeek(roster, week)).map(roster =>
            (board.rows || []).find(row => String(row.roster_id) === String(roster.roster_id)) || { roster_id: roster.roster_id, points: null }),
        ...ladder.filter(row => !rosterFor(row)),
    ] : [];
    const racePoints = row => {
        const value = row && teamPoints(row);
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };
    raceRows.sort((a, b) => {
        const left = racePoints(a), right = racePoints(b);
        return left == null ? right == null ? 0 : 1 : right == null ? -1 : right - left;
    });
    const scoredRaceRows = raceRows.filter(row => racePoints(row) != null);
    const lowestRaceScore = scoredRaceRows.length ? racePoints(scoredRaceRows[scoredRaceRows.length - 1]) : null;
    const lowestRaceCount = scoredRaceRows.filter(row => racePoints(row) === lowestRaceScore).length;
    const raceScoresComplete = raceRows.length > 0 && scoredRaceRows.length === raceRows.length;
    const ownRaceRow = raceRows.find(own);
    const ownRaceScore = racePoints(ownRaceRow);
    const ownRaceGap = raceScoresComplete && ownRaceScore != null ? ownRaceScore - lowestRaceScore : null;
    const updated = board.updatedAt ? new Date(board.updatedAt) : null;
    const loading = ['loading', 'idle', 'refreshing'].includes(board.status);
    const hasRows = (board.rows || []).length > 0;
    const visibleLadder = isPhone && !expanded && !fullBoard ? ladder.slice().sort((a, b) => Number(own(b)) - Number(own(a))).slice(0, 3) : ladder;
    const visibleGroups = isPhone && !expanded && !fullBoard ? groups.slice(0, 1) : groups;
    const boardId = `lls-board-${leagueId}`;
    const starters = row => <div className="lls-starters">
        <div className="lls-starter-head"><span>{ownerName(row)}</span><span>Actual</span></div>
        {(row.starters || []).length ? row.starters.map((pid, index) => {
            const empty = !pid || String(pid) === '0';
            const player = playersData?.[pid];
            return <div className="lls-starter" key={`${pid}-${index}`}>
                <span>{empty ? 'Empty starter slot' : (getPlayerName?.(pid) || player?.full_name || `Player ${pid}`)}
                    {!empty && player?.position && <small> {player.position}{player.team ? ` · ${player.team}` : ''}</small>}
                </span>
                <strong>{empty ? '—' : points(service.playerPoints(row, pid))}</strong>
            </div>;
        }) : <p className="lls-note">Starter details have not been reported.</p>}
    </div>;
    const team = row => <div className={`lls-team${own(row) ? ' lls-own' : ''}`} key={row.roster_id}>
        <span className="lls-team-name">{ownerName(row)}{own(row) && <small>YOU</small>}</span>
        <div className="lls-team-total"><strong className="lls-score">{points(teamPoints(row))}</strong>{projectionLine(row)}</div>
    </div>;
    const matchupTeams = rows => rows.slice().sort((a, b) => Number(own(b)) - Number(own(a)));
    const matchupHeader = rows => {
        const [left, right] = matchupTeams(rows);
        const normTeam = team => ({ WSH: 'WAS', JAC: 'JAX', LA: 'LAR', AZ: 'ARI', OAK: 'LV', SD: 'LAC' })[String(team || '').toUpperCase()] || String(team || '').toUpperCase();
        const starterTeams = new Set(rows.flatMap(row => (row.starters || []).map(pid => normTeam(playersData?.[pid]?.team))).filter(Boolean));
        const started = canOpenGameDay && nflGames.some(game => ['live', 'final'].includes(window.App?.NflContext?.gameStatus?.(game)) && (starterTeams.has(normTeam(game.home)) || starterTeams.has(normTeam(game.away))));
        return <div className="lls-versus">
            {[left, right].map((row, index) => {
                const opponent = index ? left : right;
                const comparison = compareScores(teamPoints(row), teamPoints(opponent));
                const state = comparison.state === 'tied' && Number(teamPoints(row)) === 0 && !started ? 'pending' : comparison.state;
                const label = state === 'leading' ? 'Leading' : state === 'trailing' ? 'Behind' : state === 'tied' ? 'Tied' : null;
                return <React.Fragment key={row.roster_id}>
                {index === 1 && <span className="lls-vs" aria-hidden="true">VS</span>}
                <div className={`lls-side${index ? ' lls-side-right' : ''}${own(row) ? ' lls-own' : ''}`} data-score-state={state}>
                    <span className="lls-owner-line"><span className="lls-owner" title={ownerName(row)}>{ownerName(row)}</span>{fullBoard && own(row) && <small className="lls-you">You</small>}</span>
                    {!fullBoard && <span className="lls-side-label">{own(row) ? 'Your team' : 'Points'}</span>}
                    <span className="lls-score-line"><strong className="lls-score">{points(teamPoints(row))}</strong>{fullBoard && label && <small className="lls-score-cue">{label}</small>}</span>
                    {projectionLine(row, opponent)}
                    {fullBoard && canOpenGameDay && <span className="mc-score-progress" title="NFL game progress for reported starters. Left includes live and scheduled games; scores may still be corrected.">{leagueScoreboardStarterProgress(row, playersData, nflGames, currentLeague, week).text}</span>}
                </div>
            </React.Fragment>;
            })}
        </div>;
    };
    const matchupStarters = rows => {
        if (isPhone) return <div className="la-score-starters">{matchupTeams(rows).map(row => fullBoard ? <section key={row.roster_id}>{starters(row)}</section> : <details key={row.roster_id}><summary>{ownerName(row)}</summary>{starters(row)}</details>)}</div>;
        const [left, right] = matchupTeams(rows);
        const leftPids = left.starters || [], rightPids = right.starters || [];
        const count = Math.max(leftPids.length, rightPids.length);
        const slots = (currentLeague?.roster_positions || []).filter(slot => !['BN', 'BENCH', 'IR', 'RESERVE', 'TAXI'].includes(String(slot).toUpperCase()));
        const slotLabels = { SUPER_FLEX: 'SFLX', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', IDP_FLEX: 'IDP' };
        const playerCell = (row, pids, index, side) => {
            const pid = pids[index], reported = index < pids.length;
            const empty = !pid || String(pid) === '0';
            const player = !empty && playersData?.[pid];
            const name = !reported ? 'Not reported' : empty ? 'Empty slot' : (getPlayerName?.(pid) || player?.full_name || `Player ${pid}`);
            const actual = reported && !empty ? service.playerPoints(row, pid) : null;
            const person = <div role="cell" className={`lls-player lls-player-${side}`} title={name}><strong>{name}</strong><small>{player ? [player.position, player.team].filter(Boolean).join(' · ') : '—'}</small></div>;
            const score = <strong role="cell" className="lls-player-points">{points(actual)}</strong>;
            return side === 'left' ? <>{person}{score}</> : <>{score}{person}</>;
        };
        if (!count) return <p className="lls-note">Starter details have not been reported.</p>;
        return <div className="lls-comparison" role="table" aria-label={`${ownerName(left)} versus ${ownerName(right)} starter scores`}>
            <div className="lls-comparison-row lls-comparison-head" role="row">
                <span role="columnheader">{ownerName(left)}</span><span role="columnheader">PTS</span><span role="columnheader">SLOT</span><span role="columnheader">PTS</span><span role="columnheader">{ownerName(right)}</span>
            </div>
            {Array.from({ length: count }, (_, index) => <div className="lls-comparison-row" role="row" key={index}>
                {playerCell(left, leftPids, index, 'left')}
                <span role="cell" className="lls-slot" title={slots[index] || 'Starter slot'}>{slotLabels[slots[index]] || slots[index] || index + 1}</span>
                {playerCell(right, rightPids, index, 'right')}
            </div>)}
        </div>;
    };
    return <section className={`lls${expanded || fullBoard ? ' lls-expanded' : ' lls-compact'}${isPhone ? ' la-mobile la-league-score' : ''}${fullBoard ? ' mc-scoreboard' : ''}${compactChop ? ' mc-chop-race' : ''}`}  aria-label={compactChop ? 'Weekly survival race' : 'League scoreboard'}>
        <style>{`
            .lls{border:1px solid rgba(212,175,55,.2);border-radius:var(--card-radius, 10px);background:var(--off-black,#1b1b22);padding:12px 14px;color:var(--white,#f5f2ea);margin-bottom:14px}
            .lls-header,.lls-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.lls h3{margin:0;font-family:var(--font-title,'Rajdhani',sans-serif);font-size:1.5rem}.lls-note{font-size:.75rem;line-height:1.6;color:var(--text-muted,#8d887e);margin:6px 0 12px}.lls-controls label{font-size:.75rem;color:var(--silver,#bdb8ad)}
            .lls button,.lls select{border:1px solid rgba(212,175,55,.25);border-radius:var(--card-radius-sm, 8px);background:var(--black,#121217);color:var(--white,#f5f2ea);min-height:36px;padding:6px 10px;font:inherit;font-size:.75rem}.lls button{cursor:pointer}.lls button:disabled{opacity:.55;cursor:wait}.lls button:focus-visible,.lls select:focus-visible,.lls summary:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:3px}
            .lls-grid{display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}.lls-card{border:1px solid rgba(189,184,173,.15);border-radius:var(--card-radius-sm, 8px);background:var(--black,#121217);padding:14px;min-width:0}.lls-card-own{border-color:rgba(212,175,55,.55)}.lls-team{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:8px 0}.lls-team-name{min-width:0;overflow-wrap:anywhere;font-size:.875rem}.lls-team-name small{display:inline-block;margin-left:7px;font-size:.5625rem;letter-spacing:.08em;color:var(--gold,#d4af37)}.lls-score{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;font-size:1.35rem;white-space:nowrap}.lls-own .lls-score{color:var(--gold,#d4af37)}
            .lls summary{cursor:pointer;font-size:.75rem;color:var(--silver,#bdb8ad);padding:10px 0 0;border-top:1px solid rgba(189,184,173,.12);margin-top:8px}.lls-starters{margin-top:12px}.lls-starter-head,.lls-starter{display:flex;justify-content:space-between;gap:12px;padding:7px 0;font-size:.75rem}.lls-starter-head{color:var(--gold,#d4af37);border-bottom:1px solid rgba(189,184,173,.12)}.lls-starter>span{min-width:0;overflow-wrap:anywhere}.lls-starter small{color:var(--text-muted,#8d887e);font-size:.625rem}.lls-starter strong{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;white-space:nowrap}.lls-rank{font-size:.625rem;color:var(--text-muted,#8d887e);text-transform:uppercase;letter-spacing:.08em}.lls-error{color:var(--gold,#d4af37)}.lls-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px}.lls-footer p{margin:0;flex:1;min-width:180px}@media(max-width:480px){.lls{padding:14px}.lls-controls{width:100%}.lls-score{font-size:1.15rem}}
        `}</style>
        <style>{`
            .lls-versus{display:grid;grid-template-columns:minmax(0,1fr) 26px minmax(0,1fr);gap:8px;align-items:stretch}.lls-side{display:grid;grid-template-rows:1fr auto auto;min-width:0;gap:3px}.lls-side-right{text-align:right}.lls-owner{font-size:.82rem;font-weight:600;overflow-wrap:anywhere;line-height:1.4}.lls-side-label{font-size:.53rem;letter-spacing:.06em;color:var(--text-muted,#8d887e)}.lls-own .lls-side-label{color:var(--gold,#d4af37)}.lls-side .lls-score{font-size:1.55rem;margin-top:2px}.lls-vs{align-self:center;text-align:center;color:var(--text-muted,#8d887e);font-size:.6rem;font-weight:600}
            .mc-score-projection{font:inherit;font-size:.75rem;line-height:1.4;color:var(--text-muted,#aebed3);font-variant-numeric:tabular-nums}.mc-score-projection strong{font:inherit;font-weight:600;color:var(--text-secondary,#c7d6ed)}.lls-team-total{display:grid;gap:3px;text-align:right}
            .lls-expanded .lls-matchups{grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))}.lls-expanded .lls-pair:has(details[open]){grid-column:1/-1}.lls-expanded .lls-pair:has(details[open]) .lls-versus{padding:3px 4px 10px}.lls-compact .lls-matchups>.lls-pair{flex-basis:270px}.lls-compact .lls-owner{font-size:.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lls-compact .lls-side .lls-score{font-size:1.12rem}.lls-compact .lls-side-label{font-size:.48rem}
            .lls-comparison{margin-top:14px}.lls-comparison-row{display:grid;grid-template-columns:minmax(0,1fr) 58px 50px 58px minmax(0,1fr);gap:8px;align-items:center;padding:10px 4px;border-top:1px solid rgba(189,184,173,.1)}.lls-comparison-row:nth-child(even){background:rgba(255,255,255,.018)}.lls-comparison-head{font-size:.62rem;color:var(--text-muted,#8d887e);padding-top:8px;padding-bottom:8px}.lls-comparison-head>span{overflow-wrap:anywhere}.lls-comparison-head>span:not(:first-child):not(:last-child){text-align:center}.lls-comparison-head>span:last-child{text-align:right}.lls-player{min-width:0;display:flex;flex-direction:column;gap:4px}.lls-player strong{font-size:.8rem;line-height:1.35;overflow-wrap:anywhere}.lls-player small{font-size:.62rem;color:var(--text-muted,#8d887e)}.lls-player-right{text-align:right}.lls-player-points{text-align:center;font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;font-size:.87rem}.lls-slot{justify-self:center;max-width:100%;box-sizing:border-box;padding:4px;font-size:.58rem;font-weight:600;text-align:center;color:var(--gold,#d4af37);background:rgba(212,175,55,.09);border-radius:var(--card-radius-xs, 5px);overflow-wrap:anywhere}
            @media(max-width:540px){.lls-comparison-row{grid-template-columns:minmax(0,1fr) 39px 34px 39px minmax(0,1fr);gap:4px;padding:9px 0}.lls-player strong{font-size:.69rem}.lls-player-points{font-size:.69rem}.lls-player small{font-size:.55rem}.lls-comparison-head{font-size:.54rem}.lls-slot{font-size:.5rem;padding:3px}.lls-side .lls-score{font-size:1.3rem}}
        `}</style>
        <style>{`
            .lls h3{font-size:1.05rem}.lls-header{margin-bottom:10px}.lls-controls{gap:8px}.lls button,.lls select{min-height:30px;padding:4px 8px;font-size:.7rem}.lls-heading{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.lls-heading .lls-note{margin:0;font-size:.68rem}
            .lls-compact .lls-matchups{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:4px;scrollbar-width:thin}.lls-compact .lls-matchups>.lls-card{flex:0 0 218px;scroll-snap-align:start;padding:8px 10px;box-sizing:border-box}.lls-compact .lls-team{padding:3px 0;gap:8px}.lls-compact .lls-team-name{font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lls-compact .lls-score{font-size:1rem}.lls-compact .lls-card .lls-note{margin:4px 0 0;font-size:.65rem}.lls-compact .lls-footer{margin-top:7px}.lls-compact .lls-footer .lls-note{font-size:.65rem}.lls-compact .lls-footer button{border:0;background:transparent;padding:2px 0;min-height:24px}
            .lls-matchups:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:3px}@media(max-width:480px){.lls{padding:10px}.lls-controls{width:auto}.lls-header{gap:8px}.lls-heading{width:100%}.lls-compact .lls-matchups>.lls-card{flex-basis:230px}}
        `}</style>
        {compactChop && <style>{`
            .mc-chop-race .lls-controls :is(button,select){min-height:44px}.mc-chop-race .lls-heading .lls-note{display:none}.mc-chop-race .lls-controls{width:auto;margin-left:auto}.mc-chop-race .lls-header{align-items:center}
            .mc-chop-race-summary{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 0;border-top:1px solid var(--gx-edge,rgba(183,206,255,.2));border-bottom:1px solid var(--gx-edge,rgba(183,206,255,.2))}.mc-chop-race-summary>div{display:grid;gap:3px;min-width:0}.mc-chop-race-summary>div+div{text-align:right}.mc-chop-race-summary span{font-size:11px;line-height:1.35;color:var(--silver)}.mc-chop-race-summary strong{font:650 22px/1.2 var(--font-mono,monospace);font-variant-numeric:tabular-nums;color:var(--gold)}.mc-chop-race-summary>div+div>strong{font-size:clamp(16px,4.7vw,22px)}.mc-chop-race-summary .is-danger strong{color:var(--warn,#efbe72)}
            .mc-chop-race-note{font-size:11px;line-height:1.45;margin:8px 0;color:var(--silver)}.mc-chop-race-table{width:100%;border-collapse:collapse;table-layout:fixed}.mc-chop-race-table th{padding:7px 5px;font-size:10px;font-weight:600;color:var(--silver);text-align:right;border-bottom:1px solid var(--gx-edge,rgba(183,206,255,.2))}.mc-chop-race-table th:first-child{text-align:left;width:auto}.mc-chop-race-table th:not(:first-child){width:63px}.mc-chop-race-table td{padding:0 5px;border-bottom:1px solid rgba(183,206,255,.12)}.mc-chop-race-table td:not(:first-child){text-align:right;font:500 12px var(--font-mono,monospace);font-variant-numeric:tabular-nums;white-space:nowrap}.mc-chop-race-table .is-own{background:rgba(183,206,255,.1)}.mc-chop-race-table .is-risk td:first-child{box-shadow:inset 3px 0 var(--warn,#efbe72)}.mc-chop-race .mc-chop-race-team{display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:44px;min-width:0;width:100%;box-sizing:border-box;padding:6px 2px;border:0;background:transparent;color:var(--white);text-align:left;font:600 12px/1.3 var(--font-body,system-ui,sans-serif)}.mc-chop-race-team>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%}.mc-chop-race-team>small{font-size:10px;line-height:1.2;color:var(--silver)}.mc-chop-race-team .mc-chop-risk-label{color:var(--warn,#efbe72)}.mc-chop-race-table caption{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
        `}</style>}
        <div className="lls-header">
            <div className="lls-heading" hidden={isPhone && !expanded && !chopped && hasRows && !fullBoard}><h3>{compactChop ? 'Weekly survival race' : chopped ? 'Weekly scoring race' : overview ? 'League scoreboard' : 'Around the league'}</h3><span className="lls-note">{currentLeague?.season} · Actual points</span></div>
            <div className="lls-controls">
                <label>Week <select aria-label="Scoreboard week" value={week} onChange={event => { const value = Number(event.target.value); if (onWeekChange) onWeekChange(value); else setSelection({ leagueId, week: value }); }}>
                    {Array.from({ length: 18 }, (_, i) => i + 1).map(w => <option key={w} value={w}>{w}</option>)}
                </select></label>
                {(compactChop || !isPhone || expanded || fullBoard || !hasRows || board.error) && <button type="button" disabled={loading || board.supported === false} onClick={() => { board.refresh?.(); onRefresh?.(); }}>{loading ? 'Updating…' : 'Refresh scores'}</button>}
                {hasRows && !fullBoard && !compactChop && <button type="button" aria-expanded={expanded} aria-controls={boardId} onClick={() => setExpanded(!expanded)}>{expanded ? (isPhone ? 'Show less' : 'Collapse') : `All ${chopped ? ladder.length + ' teams' : groups.length + (isPhone ? ' games' : ' matchups')}${isPhone ? '' : ' ↓'}`}</button>}
            </div>
        </div>
        <div role="status" aria-live="polite">
            {board.supported === false ? <p className="lls-note">Live scores are available for connected Sleeper leagues.</p>
                : board.error || board.status === 'error' ? <p className="lls-note lls-error">{hasRows ? 'Scores could not refresh. Showing the last successful update.' : 'Scores are temporarily unavailable. Try refreshing.'}</p>
                : loading && !hasRows ? <p className="lls-note">Loading this week’s league scores…</p>
                : !hasRows ? <p className="lls-note">Sleeper has not reported {compactChop ? 'team scores' : 'matchups'} for this week yet.</p> : null}
        </div>
        {compactChop && board.supported !== false && raceRows.length > 0 && <div id={boardId}>
            <div className="mc-chop-race-summary" aria-label={`Your Week ${week} score and gap`}>
                <div><span>Your actual · Week {week}</span><strong>{points(ownRaceScore)}</strong></div>
                <div className={ownRaceGap === 0 ? 'is-danger' : undefined}><strong>{ownRaceGap == null ? '—' : `${ownRaceGap > 0 ? '+' : ''}${points(ownRaceGap)} pts`}</strong><span>{!ownRaceRow ? 'Not in this week’s field' : ownRaceGap == null ? 'Gap unavailable' : ownRaceGap === 0 ? lowestRaceCount > 1 ? 'Tied at lowest · in danger' : 'Lowest · in danger' : 'Above the current lowest'}</span></div>
            </div>
            <p className="mc-chop-race-note">{lowestRaceScore == null ? 'Scores and risk are unavailable; official results decide the chop.' : raceScoresComplete ? 'Lowest score is provisionally at risk; official results decide the chop.' : 'Scores are missing; lowest reported is provisionally at risk, pending official results.'}</p>
            <table className="mc-chop-race-table">
                <caption>Week {week} survival race, highest actual scores first. Projected finish uses earned points and estimates for unfinished starters; a dash means data is unavailable.</caption>
                <thead><tr><th scope="col">Team · {raceRows.length} alive · High to low</th><th scope="col">Actual</th><th scope="col">Proj.<br />finish</th></tr></thead>
                <tbody>{raceRows.map(row => {
                    const score = racePoints(row), atRisk = score != null && score === lowestRaceScore;
                    const riskLabel = !raceScoresComplete ? 'Lowest reported' : lowestRaceCount > 1 ? 'Tied low · at risk' : 'At risk';
                    const identity = <><span title={ownerName(row)}>{ownerName(row)}</span><small>{own(row) && <span>You{atRisk || score == null ? ' · ' : ''}</span>}{atRisk ? <span className="mc-chop-risk-label" title="Provisional; official league results determine eliminations">{riskLabel} · provisional</span> : score == null ? 'Awaiting score' : null}</small></>;
                    const detailKey = `${leagueId}|${week}|${row.roster_id}`;
                    const showStarters = !overview && starterSelection === detailKey;
                    const detailId = `${boardId}-starters-${row.roster_id}`;
                    const teamActionLabel = `${overview ? 'Open ' + ownerName(row) + ' team profile' : 'View ' + ownerName(row) + ' Week ' + week + ' starter scores'}${own(row) ? '. Your team' : ''}${atRisk ? '. ' + riskLabel + '; provisional' : score == null ? '. Awaiting score' : ''}`;
                    return <React.Fragment key={row.roster_id}><tr className={`${own(row) ? 'is-own' : ''}${atRisk ? ' is-risk' : ''}`}><td>{!overview || onOpenTeam ? <button type="button" className="mc-chop-race-team" aria-label={teamActionLabel} aria-expanded={overview ? undefined : showStarters} aria-controls={overview ? undefined : detailId} onClick={() => overview ? onOpenTeam(row.roster_id) : setStarterSelection(showStarters ? null : detailKey)}>{identity}</button> : <div className="mc-chop-race-team">{identity}</div>}</td><td>{points(score)}</td><td>{points(canOpenGameDay ? projectedFinish(row) : null)}</td></tr>{showStarters && <tr className="mc-chop-race-detail"><td colSpan={3}><div id={detailId} role="region" aria-label={`${ownerName(row)} Week ${week} starter scores`}>{starters(row)}{onOpenTeam && <button type="button" onClick={() => onOpenTeam(row.roster_id)}>Team profile →</button>}</div></td></tr>}</React.Fragment>;
                })}</tbody>
            </table>
        </div>}
        {hasRows && !compactChop && <div id={boardId} className="lls-grid lls-matchups" tabIndex={expanded || fullBoard ? undefined : 0} role="region" aria-label={chopped ? 'Weekly team scores' : 'Weekly matchups'}>
            {chopped ? visibleLadder.map(row => <article className={`lls-card${own(row) ? ' lls-card-own' : ''}`} key={row.roster_id}>
                <div className="lls-rank">{teamPoints(row) == null ? 'Awaiting score' : `Position ${ladder.findIndex(r => teamPoints(r) === teamPoints(row)) + 1}`}</div>
                {team(row)}{(expanded || fullBoard) && <details><summary>Starter scores</summary>{starters(row)}{onOpenTeam && <button type="button" onClick={() => onOpenTeam(row.roster_id)}>Team profile →</button>}</details>}
            </article>) : visibleGroups.map((group, i) => <article className={`lls-card${group.teams.length === 2 ? ' lls-pair' : ''}${group.teams.some(own) ? ' lls-card-own' : ''}`} key={`${group.matchupId ?? 'unpaired'}-${i}`}>
                {fullBoard && canOpenGameDay && (group.teams.some(own) || (group.teams.length === 2 && group.matchupId != null)) && setActiveTab ? <button type="button" className="mc-score-open" onClick={() => setActiveTab('lineup', { view: 'matchup', ...(group.teams.some(own) ? {} : { matchup: { leagueId: String(leagueId), season: String(currentLeague.season), week: Number(week), rosterIds: matchupTeams(group.teams).map(row => String(row.roster_id)) } }) })} aria-label={group.teams.some(own) ? 'Open your matchup in Game Day' : `Open ${matchupTeams(group.teams).map(ownerName).join(' vs ')} matchup in Game Day`}>{group.teams.length === 2 ? matchupHeader(group.teams) : group.teams.map(team)}<span className="mc-score-destination">Matchup →</span></button> : fullBoard ? <details className="mc-matchup-details"><summary>{group.teams.length === 2 ? matchupHeader(group.teams) : group.teams.map(team)}<span className="mc-score-destination">Players &amp; teams <span aria-hidden="true">⌄</span></span></summary>{group.teams.length === 2 ? matchupStarters(group.teams) : group.teams.map(row => <div key={row.roster_id}>{starters(row)}</div>)}{onOpenTeam && <div className="mc-context-actions">{group.teams.map(row => <button type="button" key={row.roster_id} onClick={() => onOpenTeam(row.roster_id)}>{ownerName(row)} →</button>)}</div>}</details> : group.teams.length === 2 ? matchupHeader(group.teams) : group.teams.map(team)}
                {group.teams.length === 1 && <p className="lls-note">No opponent reported this week.</p>}
                {expanded && !fullBoard && <details><summary>{group.teams.length === 2 ? 'Matchup breakdown' : 'Starter scores'}</summary>{group.teams.length === 2 ? matchupStarters(group.teams) : group.teams.map(row => <div key={row.roster_id}>{starters(row)}</div>)}</details>}
            </article>)}
        </div>}
        {!isPhone && (expanded || fullBoard) && nflGames.length > 0 && <details style={{ marginTop: 16 }}>
            <summary>NFL game scores · Week {week}</summary>
            <p className="lls-note">NFL scoreboard · Refreshes every minute. Kickoff times are shown in your local time.</p>
            <div className="lls-grid">{nflGames.map((game, index) => {
                const state = window.App.NflContext.gameStatus?.(game) || 'unknown';
                const kickoff = game.kickoff ? new Date(game.kickoff) : null;
                const detail = state === 'final' ? 'Final' : game.shortDetail || (state === 'live' ? 'In progress' : 'Status unavailable');
                return <div className="lls-card" key={`${game.away}-${game.home}-${index}`}>
                    <div className="lls-rank">{detail}{state === 'upcoming' && kickoff && !Number.isNaN(kickoff.getTime()) ? ` · ${kickoff.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</div>
                    <div className="lls-team"><span>{game.away}</span><strong>{state === 'upcoming' ? '—' : game.awayScore ?? '—'}</strong></div>
                    <div className="lls-team"><span>{game.home}</span><strong>{state === 'upcoming' ? '—' : game.homeScore ?? '—'}</strong></div>
                </div>;
            })}</div>
        </details>}
        <div className="lls-footer">
            <p className="lls-note">{updated && !Number.isNaN(updated.getTime()) ? `${isPhone && !expanded ? '' : 'Updated '}${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ` : ''}{expanded || compactChop ? 'Sleeper scores refresh every 30 seconds while visible. Scoring may be delayed or corrected. A dash means no score was reported.' : isPhone ? 'Sleeper' : 'Sleeper · Refreshes every 30s'}{expanded && chopped && !compactChop ? ' Positions are provisional; eliminations follow league results.' : ''}</p>
            {setActiveTab && !fullBoard && <button type="button" onClick={() => setActiveTab('lineup')}>My Game Plan →</button>}
        </div>
    </section>;
}
window.LeagueLiveScoreboard = LeagueLiveScoreboard;
