// Read-only Game Day entry for a selected league game. This component never
// mounts the lineup planner or substitutes a different roster for myRoster.
function LeagueMatchupView({ matchupTarget, currentLeague, myRoster, playersData, statsData, stats2025Data, setActiveTab, getOwnerName }) {
    const App = window.App || {};
    const Live = App.LeagueLiveScores;
    const leagueId = String(currentLeague?.league_id || currentLeague?.id || '');
    const season = Number(currentLeague?.season);
    const liveSeason = Number(window.S?.nflState?.season) || new Date().getFullYear();
    const week = Number(matchupTarget?.week);
    const rosterIds = Array.isArray(matchupTarget?.rosterIds) ? matchupTarget.rosterIds.map(String) : [];
    const rosters = currentLeague?.rosters || [];
    const validTarget = !!Live && !!leagueId
        && String(matchupTarget?.leagueId || '') === leagueId
        && Number(matchupTarget?.season) === season && season === liveSeason
        && Number.isInteger(week) && week >= 1 && week <= 18 && week === Number(Live.currentWeek?.(currentLeague))
        && rosterIds.length === 2 && rosterIds[0] !== rosterIds[1]
        && rosterIds.every(id => rosters.some(roster => String(roster.roster_id) === id))
        && !App.Chopped?.isChopped?.(currentLeague);
    const targetKey = [leagueId, season, week, ...rosterIds].join('|');
    const board = Live?.useScores({ league: currentLeague, week: validTarget ? week : undefined, enabled: validTarget })
        || { rows: [], status: 'unavailable', supported: false };
    const [nfl, setNfl] = React.useState({ key: '', games: [] });
    const [contextRefresh, setContextRefresh] = React.useState(0);
    const [projectionRevision, setProjectionRevision] = React.useState(0);
    React.useEffect(() => { window.scrollTo?.({ top: 0, left: 0, behavior: 'instant' }); }, [targetKey]);

    React.useEffect(() => {
        if (!validTarget) return undefined;
        const context = App.NflContext;
        if (!context?.loadScores) return undefined;
        let active = true, fetching = false;
        const refresh = async () => {
            if (!active || fetching || document.hidden) return;
            fetching = true;
            try {
                const [games] = await Promise.all([
                    context.loadScores(week, season, 2),
                    typeof context.load === 'function' ? Promise.resolve(context.load([week], season)).catch(() => null) : null,
                ]);
                if (active) setNfl({ key: targetKey, games: Array.isArray(games) ? games : [] });
            } catch (_) {
                if (active) setNfl({ key: targetKey, games: [] });
            } finally { fetching = false; }
        };
        refresh();
        const timer = setInterval(refresh, 60000);
        document.addEventListener('visibilitychange', refresh);
        return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [validTarget, targetKey, contextRefresh]);

    React.useEffect(() => {
        if (!validTarget) return undefined;
        const refresh = event => {
            if (Number(event.detail?.week) === week && Number(event.detail?.season) === season) setProjectionRevision(value => value + 1);
        };
        window.addEventListener('wr:projections-loaded', refresh);
        App.WeeklyProj?.ensureWeekProjections?.(week);
        return () => window.removeEventListener('wr:projections-loaded', refresh);
    }, [validTarget, targetKey]);

    const rows = rosterIds.map(id => (board.rows || []).find(row => String(row.roster_id) === id));
    const [left, right] = rows;
    const pairReady = validTarget && !!left && !!right && left.matchup_id != null && right.matchup_id != null
        && String(left.matchup_id) === String(right.matchup_id)
        && (board.rows || []).filter(row => row.matchup_id != null && String(row.matchup_id) === String(left.matchup_id)).length === 2;
    const games = validTarget && nfl.key === targetKey ? nfl.games : [];
    const projections = React.useMemo(() => {
        if (!pairReady || !games.length || !App.WeeklyProj?.projectRoster) return {};
        try {
            const ids = [...new Set(rows.flatMap(row => row.starters || []).filter(pid => pid && String(pid) !== '0'))];
            return App.WeeklyProj.projectRoster(ids, {
                playersData, statsData: statsData || {}, priorData: stats2025Data || {},
                scoring: currentLeague?.scoring_settings || {}, week,
            }) || {};
        } catch (_) { return {}; }
    }, [pairReady, targetKey, left, right, games, playersData, statsData, stats2025Data, currentLeague?.scoring_settings, projectionRevision]);

    const navigation = <nav className="wr-seg gd-view-nav gd-league-matchup-nav" aria-label="Game Day views">
        <button type="button" aria-pressed={false} onClick={() => setActiveTab?.('lineup')}>My lineup</button>
        <button type="button" aria-pressed={true} className="is-on">Matchup</button>
        <button type="button" aria-pressed={false} onClick={() => setActiveTab?.('dashboard')}>All games</button>
    </nav>;
    if (!validTarget) return <div className="gd-league-matchup">{navigation}<p className="gd-muted" role="status">This game is no longer available in the current week. Choose a game from Overview.</p></div>;
    if (!pairReady) return <div className="gd-league-matchup">{navigation}<p className="gd-muted" role="status">{['idle', 'loading', 'refreshing'].includes(board.status) && !(board.rows || []).length ? 'Loading this matchup…' : board.error || board.supported === false ? 'Scores are unavailable for this matchup. Try refreshing or choose a game from Overview.' : 'This matchup is unavailable. Choose a game from Overview.'}</p><button type="button" className="gd-secondary" onClick={() => board.refresh?.()}>Refresh scores</button></div>;

    const fmt = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2);
    const nameFor = row => {
        const roster = rosters.find(item => String(item.roster_id) === String(row.roster_id));
        const user = (currentLeague?.users || []).find(item => String(item.user_id) === String(roster?.owner_id));
        return getOwnerName?.(row.roster_id) || user?.display_name || roster?.ownerName || user?.metadata?.team_name || roster?.metadata?.team_name || roster?.name || ('Team ' + row.roster_id);
    };
    const names = rows.map(nameFor);
    const projectedFinish = row => Live.projectedFinish?.(row, playersData, games, currentLeague, week, projections) ?? null;
    const normalize = team => ({ WSH: 'WAS', JAC: 'JAX', LA: 'LAR', AZ: 'ARI', OAK: 'LV', SD: 'LAC' })[String(team || '').toUpperCase()] || String(team || '').toUpperCase();
    const gameFor = pid => games.find(game => normalize(game.home) === normalize(playersData?.[pid]?.team) || normalize(game.away) === normalize(playersData?.[pid]?.team));
    const statusFor = pid => {
        const game = gameFor(pid), status = App.NflContext?.gameStatus?.(game) || 'unknown';
        if (status === 'final') return 'Final';
        if (status === 'live') return 'Live';
        const byeWeek = Number(App.NFLByes?.weekForPlayer?.(playersData?.[pid], season));
        if (!game && byeWeek === week) return 'Bye';
        const kickoff = Date.parse(game?.kickoff || '');
        return status === 'upcoming' && Number.isFinite(kickoff) ? new Date(kickoff).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Status unavailable';
    };
    const playerFinish = (row, pid) => {
        const actual = Live.playerPoints(row, pid);
        if (App.NflContext?.gameStatus?.(gameFor(pid)) === 'final' && actual == null) return null;
        return projectedFinish({ starters: [pid], points: actual == null ? 0 : actual, players_points: actual == null ? {} : { [pid]: actual } });
    };
    const slots = (currentLeague?.roster_positions || []).filter(slot => !['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES', 'RESERVE'].includes(String(slot).toUpperCase()));
    const count = Math.max(left.starters?.length || 0, right.starters?.length || 0);
    const slotLabel = slot => ({ REC_FLEX: 'FLEX', SUPER_FLEX: 'SFLEX', WRTQ: 'SFLEX', DEF: 'D/ST' })[slot] || String(slot || 'Slot').replace(/_/g, ' ');
    const playerRow = (row, side, index) => {
        const reported = Array.isArray(row.starters) && index < row.starters.length;
        const pid = row.starters?.[index], empty = !pid || String(pid) === '0';
        const player = playersData?.[pid];
        const name = !reported ? 'Not reported' : empty ? 'Empty slot' : player?.full_name || [player?.first_name, player?.last_name].filter(Boolean).join(' ') || ('Player ' + pid);
        return <div className={'gd-league-starter is-' + (side ? 'right' : 'left')} key={side}>
            <div className="gd-league-starter-person"><small title={names[side]}>{names[side]}</small><strong>{name}</strong><span>{!reported ? 'Starter not reported' : empty ? 'No player submitted' : [player?.position, player?.team, statusFor(pid)].filter(Boolean).join(' · ')}</span></div>
            <div className="gd-league-starter-points"><strong>{fmt(empty ? null : Live.playerPoints(row, pid))}</strong><small>Actual</small></div>
            <div className="gd-league-starter-points is-finish"><strong>{fmt(empty ? null : playerFinish(row, pid))}</strong><small>Finish</small></div>
        </div>;
    };
    const loading = ['idle', 'loading', 'refreshing'].includes(board.status);
    const updated = board.updatedAt ? new Date(board.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    return <div className="gd-league-matchup">{navigation}
        <section className="gd-matchup gd-league-game" aria-label={names[0] + ' versus ' + names[1] + ' matchup'}>
            <div className="gd-league-game-heading"><span className="gd-matchup-eyebrow">Week {week} · League matchup</span><button type="button" disabled={loading} onClick={() => { board.refresh?.(); setContextRefresh(value => value + 1); }}>{loading ? 'Updating…' : 'Refresh scores'}</button></div>
            <div className="gd-league-game-scores">{rows.map((row, side) => <React.Fragment key={row.roster_id}>{side ? <span className="gd-league-game-versus">VS</span> : null}<div className={'gd-league-game-side is-' + (side ? 'right' : 'left')}>
                <h2>{names[side]}</h2><strong className="gd-league-game-total">{fmt(Live.rosterPoints(row))}</strong><span className="gd-league-game-actual">Actual points</span>
                <span className="gd-league-game-finish">Proj. finish <strong>{fmt(projectedFinish(row))}</strong>{projectedFinish(row) != null && Live.finishAssumption?.(row, projections) && <small> · if they play</small>}</span>
                <small>{Live.starterProgress?.(row, playersData, games, currentLeague, week)?.text || 'Game status unavailable'}</small>
            </div></React.Fragment>)}</div>
            <p className={'gd-league-game-update' + (board.error || board.status === 'stale' ? ' is-stale' : '')} role="status">{board.error || board.status === 'stale' ? 'Scores could not refresh. Showing the last successful update.' : updated ? 'Updated ' + updated : 'Submitted lineups · League scoring'}</p>
            <div className="gd-matchup-section-heading"><h3>Slot by slot</h3><span>Submitted starters</span></div>
            <div className="gd-league-slots">{count ? Array.from({ length: count }, (_, index) => <div className="gd-league-slot" key={index}><strong className="gd-league-slot-label">{slotLabel(slots[index])}</strong><div>{playerRow(left, 0, index)}{playerRow(right, 1, index)}</div></div>) : <p className="gd-muted">Starter details have not been reported.</p>}</div>
            <p className="gd-league-game-help">Finish combines points already earned with estimates for unfinished games. A dash means required data is unavailable.</p>
        </section>
    </div>;
}
window.LeagueMatchupView = LeagueMatchupView;
