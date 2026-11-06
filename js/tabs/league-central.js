// ══════════════════════════════════════════════════════════════════
// js/tabs/league-central.js — LeagueCentralTab
// The league's two substantive reads, side by side and nothing else:
//
//   Standings — W-L / PF / PA / streak plus a soccer-style last-5 form guide,
//               with a Table <-> Playoff Picture toggle. The playoff view
//               carries the Monte Carlo odds that used to be a separate slab.
//   Stats     — real position columns (CMP%/YDS/TD/INT for a QB, TGT/REC for
//               a WR, TKL/SACK for IDP) via App.StatCatalog, week or season.
//
// A live matchup board anchors this page. Transactions and trending panels
// also remain in the always-on league wire across tabs.
//
// Home carries compact personal summaries. League keeps the full competition
// record, including the Chopped risk table. Legacy merged-home callers can
// still supply a briefing and KPI slot.
//
// Reuses existing engines rather than building new ones:
//   App.Luck + App.PlayoffOdds   — same wiring recipe as season-odds-panel.js
//   App.SOS.getWeekStats + calcFantasyPts — same recipe as gamelog-engine.js
//   window.fetchMatchups         — same grouping recipe as playoff-odds.js
//
// Deliberately shows playoff odds as a percentage + bar, never a discrete
// "Clinched"/"Eliminated" tag — the sim is probabilistic, not a math-clinch
// solver, and this app's own ethos (see season-odds-panel.js's noPlayoffs
// messaging) is to not fabricate certainty a compute pass can't back up.
//
// Exposes: window.LeagueCentralTab
// ══════════════════════════════════════════════════════════════════
const overviewNflTeam = team => {
    const key = String(team || '').trim().toUpperCase();
    return ({ WSH: 'WAS', JAC: 'JAX', LA: 'LAR', AZ: 'ARI', OAK: 'LV', SD: 'LAC' })[key] || key;
};

// Compare the reported score with the player's league-scored average entering
// the week. Prior games and the current result use the same scoring rules.
function buildLeagueOverviewForm({ board, roster, week, finalTeams, playersData = {}, playedStats = {}, historyFor }) {
    if (board?.week !== week || board.error || !['ready', 'refreshing'].includes(board.status) || !finalTeams.size) return [];
    if (roster?.roster_id == null || !Array.isArray(roster.players)) return [];
    const ownScores = (board.rows || []).find(row => String(row.roster_id) === String(roster.roster_id))?.players_points;
    const owned = new Set([...roster.players, ...(roster.reserve || []), ...(roster.taxi || [])].map(String));
    const notes = [];
    for (const [pid, points] of Object.entries(ownScores || {})) {
        const player = playersData[pid];
        if (!owned.has(pid) || !Number.isFinite(points) || !finalTeams.has(overviewNflTeam(player?.team))) continue;
        const name = player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ');
        if (!name) continue;
        // Sleeper can report zero for someone who did not get into the game.
        const raw = playedStats[pid];
        if (points === 0 && !['gp', 'off_snp', 'def_snp', 'st_snp', 'pass_att', 'rush_att', 'rec_tgt', 'fga', 'xpa'].some(key => Number(raw?.[key]) > 0)) continue;
        const prior = historyFor(pid).filter(game => game.week < week);
        if (prior.length < 3) continue;
        const average = prior.reduce((sum, game) => sum + game.pts, 0) / prior.length;
        const delta = points - average, direction = Math.sign(delta);
        let streak = 0;
        if (Math.abs(delta) >= 1) {
            streak = 1;
            for (let i = prior.length - 1; i >= 0 && (prior[i].pts - average) * direction >= 1; i--) streak++;
        }
        if (Math.abs(delta) < Math.max(5, Math.abs(average) * 0.35) && streak < 3) continue;
        notes.push({ pid, name, points, average, delta, streak });
    }
    return notes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.streak - a.streak || a.name.localeCompare(b.name)).slice(0, 3);
}

// Proactive overview uses reported starters and the current NFL schedule. It never
// treats a missing feed as a healthy lineup, or a schedule time as a league lock rule.
function buildLeagueOverviewDecision({ league, roster, playersData = {}, skin, week, games = [], now = Date.now() }) {
    const positions = (league?.roster_positions || []).filter(pos => !['BN', 'IR', 'TAXI', 'RESERVE'].includes(String(pos).toUpperCase()));
    const automatic = skin?.type === 'best_ball' || Number(league?.settings?.best_ball) === 1;
    const known = !!roster && Array.isArray(roster.starters);
    const gameStatus = game => {
        if (!game || /POSTPONED|CANCEL|SUSPEND|DELAY/i.test(game.statusName || '')) return 'unknown';
        if (game.completed || game.state === 'final') return 'final';
        if (['in', 'live'].includes(game.state)) return 'live';
        const start = Date.parse(game.kickoff || '');
        if (Number.isFinite(start) && start <= now) return 'locked';
        return ['pre', 'upcoming'].includes(game.state) && Number.isFinite(start) ? 'upcoming' : 'unknown';
    };
    const byTeam = new Map();
    games.forEach(game => { byTeam.set(overviewNflTeam(game.home), game); byTeam.set(overviewNflTeam(game.away), game); });
    const complete = games.length > 0 && games.every(game => gameStatus(game) === 'final');
    const flags = [], lockedFlags = [];
    const addFlag = (flag, player) => {
        const status = gameStatus(byTeam.get(overviewNflTeam(player?.team)));
        const check = { ...flag, gameStatus: status };
        if (complete || ['final', 'live', 'locked'].includes(status)) lockedFlags.push(check);
        else flags.push(check);
    };
    if (known && !automatic) {
        const slots = Math.max(positions.length, roster.starters.length);
        for (let index = 0; index < slots; index++) {
            const pid = roster.starters[index], player = playersData[pid];
            const slot = positions[index] || 'Starter';
            if (!pid || String(pid) === '0') { if (!games.length || games.some(game => gameStatus(game) === 'upcoming')) flags.push({ pid: null, name: slot + ' slot', reason: 'Empty starter', kind: 'empty', gameStatus: 'unknown' }); continue; }
            if (!player) continue;
            const name = player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ') || 'Player ' + pid;
            const injury = String(player.injury_status || '').toLowerCase();
            let bye = null;
            try { bye = window.App?.NFLByes?.weekForPlayer?.(player, league?.season); } catch (_) { /* unavailable */ }
            if (Number(bye) > 0 && Number(bye) === Number(week)) addFlag({ pid, name, reason: 'Bye this week', kind: 'bye' }, player);
            else if (['out', 'ir', 'injured reserve', 'suspended', 'pup'].includes(injury)) addFlag({ pid, name, reason: 'Listed ' + player.injury_status, kind: 'out' }, player);
            else if (['doubtful', 'questionable'].includes(injury)) addFlag({ pid, name, reason: 'Monitor · ' + player.injury_status, kind: 'monitor' }, player);
            else if (Object.prototype.hasOwnProperty.call(player, 'team') && (!player.team || ['FA', 'FA*'].includes(String(player.team).toUpperCase()))) addFlag({ pid, name, reason: 'No NFL team listed', kind: 'unsigned' }, player);
        }
    }
    const upcoming = games.filter(game => gameStatus(game) === 'upcoming').sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
    const next = upcoming[0] || null;
    const starterTeams = known ? roster.starters.filter(pid => pid && String(pid) !== '0').map(pid => overviewNflTeam(playersData[pid]?.team)).filter(Boolean) : [];
    const countStarters = game => {
        const teams = [overviewNflTeam(game?.home), overviewNflTeam(game?.away)].filter(Boolean);
        return starterTeams.filter(team => teams.includes(team)).length;
    };
    const nextStarterGame = upcoming.find(game => countStarters(game) > 0) || null;
    const finalTeams = new Set([...byTeam].filter(([team, game]) => team && gameStatus(game) === 'final').map(([team]) => team));
    return { week, known, automatic, flags, lockedFlags, next, finalTeams, startersInNext: countStarters(next),
        nextStarterGame, startersInNextStarterGame: countStarters(nextStarterGame), live: games.some(game => ['live', 'locked'].includes(gameStatus(game))), complete };
}

function LeagueOverviewDecisions({ currentLeague, leagueSkin, myRoster, playersData, scoreBoard, setActiveTab }) {
    // This is always the current week, independent of the scoreboard's history picker.
    const week = window.App.LeagueLiveScores.currentWeek(currentLeague);
    const season = Number(currentLeague?.season);
    const liveSeason = Number(window.S?.nflState?.season) || new Date().getFullYear();
    const key = [currentLeague?.league_id || currentLeague?.id, season, week].join('|');
    const [schedule, setSchedule] = React.useState({ key: '', status: 'loading', games: [], now: Date.now() });
    React.useEffect(() => {
        let alive = true, pending = false;
        const context = window.App?.NflContext;
        if (!context?.loadScoreboard || season !== liveSeason || !(week >= 1 && week <= 18)) {
            setSchedule({ key, status: 'unavailable', games: [], now: Date.now() }); return;
        }
        const refresh = async () => {
            if (!alive || pending || document.visibilityState === 'hidden') return;
            pending = true;
            try {
                const games = await context.loadScoreboard(week, season, 2);
                if (alive) setSchedule({ key, status: Array.isArray(games) && games.length ? 'ready' : 'unavailable', games: Array.isArray(games) ? games : [], now: Date.now() });
            } catch (_) { if (alive) setSchedule({ key, status: 'unavailable', games: [], now: Date.now() }); }
            finally { pending = false; }
        };
        refresh();
        const timer = setInterval(refresh, 60000);
        document.addEventListener('visibilitychange', refresh);
        return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [key, liveSeason]);
    const current = schedule.key === key ? schedule : { status: 'loading', games: [], now: Date.now() };
    const decision = buildLeagueOverviewDecision({ league: currentLeague, roster: myRoster, playersData, skin: leagueSkin, week, games: current.games, now: current.now });
    const [, refreshHistory] = React.useState(0);
    React.useEffect(() => {
        const refresh = () => refreshHistory(value => value + 1);
        window.addEventListener('wr:weekly-points-loaded', refresh);
        return () => window.removeEventListener('wr:weekly-points-loaded', refresh);
    }, []);
    const wp = window.App.WeeklyProj, state = window.S;
    const historyScope = wp?.weeklyPointsScope?.(currentLeague?.league_id || currentLeague?.id, season, currentLeague?.scoring_settings);
    const historyReady = season === liveSeason && (!state?.nflState?.season_type || state.nflState.season_type === 'regular')
        && scoreBoard?.supported && week >= 4 && historyScope
        && state?.weeklyPlayerPointsScope === historyScope && state.weeklyPlayerPointsComplete === true
        && Number(state.weeklyPlayerPointsThroughWeek) >= week - 1;
    const finishedKey = historyReady && decision.finalTeams.size ? key + '|' + [...decision.finalTeams].sort().join(',') : '';
    const [played, setPlayed] = React.useState({ key: '', stats: {} });
    React.useEffect(() => {
        const sos = window.App?.SOS;
        if (!finishedKey || !sos?.getWeekStats) return;
        let active = true;
        Promise.resolve(sos.getWeekStats(season, week, 'regular')).then(stats => {
            if (active && stats) setPlayed({ key, stats });
        }).catch(() => {});
        return () => { active = false; };
    }, [finishedKey]);
    const form = historyReady ? buildLeagueOverviewForm({
        board: scoreBoard, roster: myRoster, week, finalTeams: decision.finalTeams, playersData, historyFor: wp.weeklyHistory,
        playedStats: played.key === key ? played.stats : {},
    }) : [];
    const nextGame = decision.nextStarterGame || decision.next;
    const nextStarters = decision.nextStarterGame ? decision.startersInNextStarterGame : decision.startersInNext;
    const nextLabel = nextGame ? new Date(nextGame.kickoff).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : null;
    const scheduleLabel = nextLabel ? (decision.nextStarterGame ? 'Your next kickoff · ' : 'Next NFL kickoff · ') + nextLabel
        : decision.live ? 'NFL games are underway' : decision.complete ? 'This week’s NFL games are complete' : current.status === 'loading' ? 'Checking kickoff times…' : 'Kickoff times unavailable';
    const actionableFlags = current.status === 'ready' ? decision.flags.filter(flag => flag.gameStatus === 'upcoming' || (decision.next && ['bye', 'empty', 'unsigned'].includes(flag.kind))) : [];
    const ask = () => window.dispatchEvent(new CustomEvent('wr:mission-alex-open', { detail: { title: 'Your next move', prompt: 'Help me prioritize my next move in this league. Use these current roster checks and schedule facts: ' + JSON.stringify({ leagueId: currentLeague?.league_id || currentLeague?.id, week, rosterKnown: decision.known, automaticLineup: decision.automatic, starterChecks: actionableFlags, unverifiedStarterChecks: decision.flags.filter(flag => !actionableFlags.includes(flag)), lockedStarterChecks: decision.lockedFlags, nextKickoff: nextGame ? { home: nextGame.home, away: nextGame.away, kickoff: nextGame.kickoff, startersInGame: nextStarters, scope: decision.nextStarterGame ? 'your starters' : 'NFL' } : null, scheduleStatus: current.status, finishedPlayerForm: form }) + '. Listed injury statuses may be stale. Do not recommend replacing players whose games are live, locked, final, or unverified. Confirm current player availability and league lock rules before suggesting a change. Do not invent a waiver deadline, projections, or odds; no move has been submitted.' } }));
    const primaryFlag = actionableFlags[0];
    const primaryMove = (() => {
        if (decision.automatic) return { message: 'Review your roster depth.', detail: 'Your league sets the scoring lineup automatically.', action: 'Roster', tab: 'myteam' };
        if (!decision.known) return { message: 'Review your starting lineup.', detail: 'Starter details have not loaded yet.', action: 'Game Day', tab: 'lineup' };
        if (!primaryFlag) {
            if (current.status === 'loading') return { message: 'Review your starting lineup.', action: 'Game Day', tab: 'lineup' };
            if (current.status !== 'ready') return { message: 'Review your starting lineup.', detail: 'Verify kickoff times before changing a starter.', action: 'Game Day', tab: 'lineup' };
            if (decision.live) return { message: 'Follow your remaining starters.', action: 'Game Day', tab: 'lineup' };
            if (decision.complete) return { message: 'See how the week finished.', action: 'Results', tab: 'central' };
            return { message: 'Review your starters and bench.', action: 'Game Day', tab: 'lineup' };
        }
        if (primaryFlag.kind === 'empty') return { message: 'Fill your ' + primaryFlag.name + '.', detail: 'Your starting lineup has an open spot.', action: 'Game Day', tab: 'lineup' };
        if (primaryFlag.kind === 'bye') return { message: 'Replace ' + primaryFlag.name + '.', detail: 'Bye this week.', action: 'Game Day', tab: 'lineup' };
        if (primaryFlag.kind === 'out') return { message: (primaryFlag.gameStatus === 'upcoming' ? 'Replace ' : 'Check availability for ') + primaryFlag.name + '.', detail: 'Listed unavailable for an upcoming game.', action: 'Game Day', tab: 'lineup' };
        if (primaryFlag.kind === 'unsigned') return { message: 'Replace ' + primaryFlag.name + '.', detail: 'No NFL team is listed.', action: 'Game Day', tab: 'lineup' };
        const status = String(primaryFlag.reason || 'needs monitoring').replace(/^Monitor\s*·\s*/i, '');
        return { message: 'Have a backup for ' + primaryFlag.name + '.', detail: 'Listed ' + status + '.', action: 'Game Day', tab: 'lineup' };
    })();
    return <section className="mc-overview-decisions" aria-label="Alex Insights">
        <header><span>Alex Insights</span><small>{week ? 'Week ' + week : 'Your roster'}</small></header>
        <div className="mc-primary-move">
            <div><h3>{primaryMove.message}</h3>{primaryMove.detail && <p className="mc-next-note">{primaryMove.detail}</p>}</div>
            <button type="button" onClick={() => setActiveTab?.(primaryMove.tab)}>{primaryMove.action} →</button>
        </div>
        <p className="mc-next-kickoff">{scheduleLabel}{nextStarters > 0 ? ' · ' + nextStarters + (nextStarters === 1 ? ' starter' : ' starters') : ''}</p>
        {actionableFlags.length > 1 && <p className="mc-next-more">+{actionableFlags.length - 1} more lineup {actionableFlags.length === 2 ? 'issue' : 'issues'} to review in Game Day</p>}
        {form.length > 0 && <div className="mc-overview-form">
            <p id="mc-overview-form-heading">Your roster’s standouts</p>
            <ul aria-labelledby="mc-overview-form-heading">{form.map(player => {
                const direction = player.delta > 0 ? 'above' : 'below';
                return <li key={player.pid} data-trend={direction}>
                    <div><strong>{player.name}</strong><small>{player.points.toFixed(1)} pts · {player.average.toFixed(1)} season avg</small></div>
                    <span><strong>{Math.abs(player.delta).toFixed(1)} pts {direction}</strong>{player.streak >= 2 && <small>{player.streak} straight {direction} avg</small>}</span>
                </li>;
            })}</ul>
        </div>}
        <div className="mc-next-actions"><button type="button" onClick={() => setActiveTab?.('fa')}>Explore waivers</button><button type="button" onClick={ask}>Ask Alex</button></div>
    </section>;
}

function LeagueCentralTab({
    currentLeague,
    leagueSkin,
    myRoster,
    playersData,
    standings,
    transactions,
    getOwnerName,
    getPlayerName,
    setActiveTab,
    onOpenTeam,
    overview = false,
    // Merged-home mode (redraft / chopped): this tab IS the landing page, so
    // it also carries the intelligence briefing and the Home widget grid.
    // Both arrive as ready-built elements from league-detail.js rather than as
    // prop bundles — this component owns the layout, not the wiring.
    homeMerged,
    briefSlot,
    kpiSlot,
    renderSeasonView,
}) {
    const GOLD = 'var(--gold, #d4af37)';
    const SILVER = 'var(--silver, #bdb8ad)';
    const WHITE = 'var(--white, #f5f2ea)';
    const MUTED = 'var(--text-muted, #8d887e)';
    const FAINT = 'var(--text-faint, rgba(189,184,173,0.62))';
    const GOOD = 'var(--good, #2ecc71)';
    const BAD = 'var(--bad, #e74c3c)';
    const INFO = 'var(--info, #5dade2)';
    const PANEL = 'var(--off-black, #1b1b22)';
    const WELL = 'var(--black, #121217)';
    const LINE = 'rgba(212,175,55,0.16)';
    const RAJ = 'var(--font-title, "Rajdhani", sans-serif)';
    const DM = 'var(--font-body, "DM Sans", sans-serif)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { fontFamily: MONO, fontSize: '0.6875rem', fontWeight: 600, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' };
    const sameId = (a, b) => String(a) === String(b);

    const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
    const isChopped = window.App?.Chopped?.isChopped?.(currentLeague) || resolvedLeagueSkin?.type === 'chopped';
    const vp = window.WR?.useViewport?.() || {};
    const isPhone = !!vp.isPhone;

    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const season = currentLeague?.season || '';
    const playoffTeams = Math.max(2, Number(currentLeague?.settings?.playoff_teams) || 6);
    const noPlayoffs = resolvedLeagueSkin?.features?.showPlayoffOdds === false;

    const _getPlayerName = getPlayerName || (pid => playersData?.[pid]?.full_name || ('Player ' + pid));
    const _getOwnerName = getOwnerName || (rosterId => {
        const r = currentLeague?.rosters?.find(x => x.roster_id === rosterId);
        const u = currentLeague?.users?.find(x => x.user_id === r?.owner_id);
        return u?.display_name || u?.username || 'Unknown';
    });

    // ── Playoff odds + weekly-score ledger (season-odds-panel.js's exact recipe) ──
    const [odds, setOdds] = React.useState({ status: 'idle' });
    const runRef = React.useRef({ key: null });
    React.useEffect(() => {
        if (noPlayoffs) return;
        if (odds.status !== 'idle') return;
        if (runRef.current.key === leagueId) return;
        const Luck = window.App?.Luck, PO = window.App?.PlayoffOdds, WP = window.App?.WeeklyProj;
        if (!Luck || !PO || !WP || !currentLeague) { setOdds({ status: 'unavailable' }); return; }
        const runKey = leagueId;
        runRef.current.key = runKey;
        const live = () => runRef.current.key === runKey;
        setOdds({ status: 'loading' });
        (async () => {
            try {
                const curWk = WP.currentWeek();
                const pws = Number(currentLeague.settings?.playoff_week_start) || 15;
                const lastReg = Math.max(1, Math.min(18, pws - 1));
                const seasonOver = resolvedLeagueSkin?.phase === 'complete' || resolvedLeagueSkin?.phase === 'offseason';
                const ledger = await Luck.build({ league: currentLeague, throughWeek: seasonOver ? lastReg : undefined });
                const playedWeeks = ledger.weeks.length;
                let sim = null;
                if (!seasonOver && playedWeeks >= 2 && curWk <= lastReg) {
                    const futurePairs = await PO.fetchFuturePairs({ league: currentLeague, fromWeek: curWk, toWeek: lastReg });
                    sim = PO.simulate({ league: currentLeague, ledger, futurePairs, myRosterId: myRoster?.roster_id, sims: 10000 });
                }
                if (live()) setOdds({ status: 'ready', ledger, sim, curWk, lastReg });
            } catch (e) {
                window.wrLog?.('leagueCentral.odds', e);
                if (live()) setOdds({ status: 'error' });
            }
        })();
    }, [odds.status, leagueId, noPlayoffs]);

    // ── This week's scoreboard ──
    const [scoreSelection, setScoreSelection] = React.useState(null);
    const scoreWeek = scoreSelection?.key === `${leagueId}|${season}` ? scoreSelection.week : window.App.LeagueLiveScores.currentWeek(currentLeague);
    const board = window.App.LeagueLiveScores.useScores({ league: currentLeague, week: scoreWeek });
    const liveContext = window.App.LeagueLiveTable?.useContext({ league: currentLeague, board, playersData });
    // Browsing past scores must not turn the automatic home board historical.
    // Share the existing current-week subscriptions unless a history view needs
    // a separate current feed; disabled hooks create no additional requests.
    const currentWeek = window.App.LeagueLiveScores.currentWeek(currentLeague);
    const separateOverviewFeed = overview && isPhone && Number(scoreWeek) !== Number(currentWeek);
    const overviewBoardFeed = window.App.LeagueLiveScores.useScores({ league: currentLeague, week: currentWeek, enabled: separateOverviewFeed });
    const overviewContextFeed = window.App.LeagueLiveTable?.useContext({ league: currentLeague, board: overviewBoardFeed, playersData, enabled: separateOverviewFeed && !isChopped });
    const overviewBoard = separateOverviewFeed ? overviewBoardFeed : board;
    const overviewContext = separateOverviewFeed ? overviewContextFeed : liveContext;
    const [tableSource, setTableSource] = React.useState('live');

    const weekHasScores = board.rows.filter(r => Number(r.points) > 0).length >= 2;
    const statWeek = board.week ? Math.max(1, weekHasScores ? board.week : board.week - 1) : null;

    // ── Stat leaders — week AND season, keeping the RAW stat line ──
    // The raw line is what lets the Stats panel render real position columns
    // (CMP%/YPA for a QB, TGT/REC for a WR, TKL/SACK for IDP) through
    // App.StatCatalog rather than points-only. Same field vocabulary either
    // way: SOS.getWeekStats for a week, fetchSeasonStats for the season
    // aggregate (see js/shared/stat-catalog.js's header note).
    const [statScope, setStatScope] = React.useState('week'); // 'week' | 'season'
    const [leaders, setLeaders] = React.useState({ status: 'idle', week: null, rows: [] });
    const [seasonLeaders, setSeasonLeaders] = React.useState({ status: 'idle', rows: [] });

    // Shared: raw {pid: statLine} -> scored, sorted rows for every rostered player.
    const buildLeaderRows = React.useCallback((statsByPid) => {
        const scoring = currentLeague?.scoring_settings || {};
        const seen = new Set();
        const rows = [];
        (currentLeague?.rosters || []).forEach(r => {
            (r.players || []).forEach(pid => {
                if (seen.has(pid)) return;
                seen.add(pid);
                const raw = statsByPid[pid];
                if (!raw) return;
                const pts = window.calcFantasyPts(raw, scoring);
                if (!(pts > 0)) return;
                const player = playersData?.[pid] || {};
                rows.push({
                    pid, raw, pts: Math.round(pts * 10) / 10,
                    pos: window.App?.normPos?.(player.position) || player.position || '??',
                    name: _getPlayerName(pid), team: player.team || '', rosterId: r.roster_id,
                });
            });
        });
        rows.sort((a, b) => b.pts - a.pts);
        return rows;
    }, [currentLeague, playersData]);

    React.useEffect(() => {
        const SOS = window.App?.SOS;
        if (!SOS?.getWeekStats || typeof window.calcFantasyPts !== 'function' || !currentLeague || !statWeek) return undefined;
        let alive = true;
        setLeaders(s => ({ ...s, status: 'loading', week: statWeek }));
        Promise.resolve(SOS.getWeekStats(season, statWeek)).then(weekStats => {
            if (!alive) return;
            setLeaders({ status: 'ready', week: statWeek, rows: buildLeaderRows(weekStats || {}) });
        }).catch(e => { window.wrLog?.('leagueCentral.leaders', e); if (alive) setLeaders({ status: 'error', week: statWeek, rows: [] }); });
        return () => { alive = false; };
    }, [leagueId, statWeek, season, buildLeaderRows]);

    // Season aggregate — lazy, only once the user actually asks for it.
    React.useEffect(() => {
        if (statScope !== 'season' || seasonLeaders.status !== 'idle') return;
        if (typeof window.fetchSeasonStats !== 'function' || typeof window.calcFantasyPts !== 'function' || !currentLeague) {
            setSeasonLeaders({ status: 'unavailable', rows: [] });
            return;
        }
        let alive = true;
        setSeasonLeaders({ status: 'loading', rows: [] });
        Promise.resolve(window.fetchSeasonStats(Number(season) || new Date().getFullYear()))
            .then(data => { if (alive) setSeasonLeaders({ status: 'ready', rows: buildLeaderRows(data || {}) }); })
            .catch(e => { window.wrLog?.('leagueCentral.seasonLeaders', e); if (alive) setSeasonLeaders({ status: 'error', rows: [] }); });
        return () => { alive = false; };
    }, [statScope, seasonLeaders.status, season, currentLeague, buildLeaderRows]);

    // Reset the season cache when the league changes.
    React.useEffect(() => { setSeasonLeaders({ status: 'idle', rows: [] }); }, [leagueId]);

    // ── Divisions ──
    const metadata = currentLeague?.metadata || {};
    const getDivisionKey = (rosterId) => {
        const r = currentLeague?.rosters?.find(x => sameId(x.roster_id, rosterId));
        return String(r?.settings?.division ?? 0);
    };
    const getDivisionName = (key) => metadata['division_' + key + '_name'] || metadata['division_' + key] || ('Division ' + key);
    const declaredDivisionKeys = (currentLeague?.rosters || []).map(roster => roster.settings?.division);
    const hasDivisions = (Number(currentLeague?.settings?.divisions) || 0) >= 2
        && (currentLeague?.rosters || []).length > 0
        && declaredDivisionKeys.every(key => key != null && String(key).trim() !== '')
        && new Set(declaredDivisionKeys.map(String)).size === Number(currentLeague.settings.divisions);
    const [standingsView, setStandingsView] = React.useState('overall');

    // ── Merge standings + playoff sim + PA + streak ──
    const enrichedStandings = React.useMemo(() => {
        return (standings || []).map(team => {
            const roster = currentLeague?.rosters?.find(r => sameId(r.roster_id, team.rosterId));
            const pf = (roster?.settings?.fpts || 0) + ((roster?.settings?.fpts_decimal || 0) / 100);
            const pa = (roster?.settings?.fpts_against || 0) + ((roster?.settings?.fpts_against_decimal || 0) / 100);
            const simRow = odds.sim?.rows?.find(r => sameId(r.rosterId, team.rosterId));
            const luckRow = odds.ledger?.rows?.find(r => sameId(r.rosterId, team.rosterId));
            let streak = null;
            // Soccer-style form guide: the last 5 results oldest -> newest.
            // Same weekly ledger the streak is derived from, so the two can
            // never disagree.
            let form = [];
            if (luckRow?.weekly?.length) {
                const played = [...luckRow.weekly].filter(g => g.result).sort((a, b) => b.week - a.week);
                if (played.length) {
                    const r = played[0].result;
                    let n = 0;
                    for (const g of played) { if (g.result === r) n++; else break; }
                    streak = r + n;
                    form = played.slice(0, 5).reverse().map(g => ({ week: g.week, result: g.result, pts: g.pts }));
                }
            }
            return {
                ...team,
                pointsFor: pf || team.pointsFor || 0,
                pointsAgainst: pa,
                division: getDivisionKey(team.rosterId),
                streak,
                form,
                playoffPct: simRow ? simRow.playoffPct : null,
                byePct: simRow ? simRow.byePct : null,
                titlePct: simRow ? simRow.titlePct : null,
                projWins: simRow ? simRow.projWins : null,
                projLosses: simRow ? simRow.projLosses : null,
            };
        });
    }, [standings, currentLeague, odds.sim, odds.ledger]);

    const liveTable = React.useMemo(() => {
        if (!liveContext?.enabled || !window.App.LeagueLiveStandings) return null;
        if (!['ready', 'refreshing', 'stale'].includes(liveContext.history.status) || !liveContext.history.updatedAt) return null;
        return window.App.LeagueLiveStandings.compute({
            league: currentLeague, standings: enrichedStandings, priorWeeks: liveContext.history.priorWeeks,
            board, week: board.week, currentWeek: liveContext.currentWeek, started: false,
            startedRosterIds: liveContext.startedRosterIds,
        });
    }, [currentLeague, enrichedStandings, board, liveContext?.history, liveContext?.startedRosterIds]);
    const showLive = tableSource === 'live' && !!liveContext?.enabled;
    const liveReady = showLive && liveTable && liveTable.status !== 'official' && board.updatedAt != null && board.rows.length > 0;
    const tableTeams = liveReady ? liveTable.rows : enrichedStandings;
    const standingsPicture = !isChopped && window.App.LeagueLiveStandings?.playoffPicture?.({ league: currentLeague, rows: tableTeams, baselineRows: liveReady ? liveTable.baselineRows : [] });
    const standingsTeams = standingsPicture?.leagueRows || tableTeams;
    const divisionGroups = React.useMemo(() => {
        if (!hasDivisions) return [];
        if (standingsPicture?.divisions?.length) return standingsPicture.divisions.map(group => ({ ...group, teams: group.rows }));
        const byKey = {};
        tableTeams.forEach(t => { (byKey[t.division] = byKey[t.division] || []).push(t); });
        return Object.keys(byKey).sort((a, b) => Number(a) - Number(b)).map(key => ({
            key, name: getDivisionName(key), teams: byKey[key],
        }));
    }, [tableTeams, hasDivisions, standingsPicture]);

    // Hook-free render helpers keep native details mounted across live score refreshes.
    // ── Shells ──
    const renderPanel = ({ title, meta, right, children }) => (
        <div className="mc-league-panel" style={{ minWidth: 0, background: PANEL, border: '1px solid ' + LINE, borderRadius: 'var(--card-radius, 10px)', padding: isPhone ? '12px 10px' : '14px 16px', marginBottom: '16px' }}>
            <div className="mc-league-panel-head" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span className="mc-league-panel-title" style={{ fontFamily: RAJ, fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.03em', color: WHITE }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
                {right ? <div className="mc-league-panel-tools" style={{ marginLeft: 'auto' }}>{right}</div> : null}
            </div>
            {children}
        </div>
    );
    // ── Render ──
    const teamCount = currentLeague?.rosters?.length || 0;
    const leaguePositions = (window.getLeaguePositions ? window.getLeaguePositions({ league: currentLeague }) : ['QB', 'RB', 'WR', 'TE']) || ['QB', 'RB', 'WR', 'TE'];
    const [leaderPos, setLeaderPos] = React.useState('Overall');
    const [stMode, setStMode] = React.useState('table'); // 'table' | 'odds'
    // Merged-home inner tabs + briefing collapse. The collapse sticks, because
    // the briefing is a once-a-visit read, not something to re-dismiss on every
    // page load. Chopped leagues lead with KPIs (weekly scoring is the whole
    // game — standings/W-L barely mean anything with the field shrinking
    // every week), matching Chopped's survival framing elsewhere in the app.
    const cupEnabled = true;
    // The Cup is optional personal navigation. It remains available to every
    // league, but a manager can remove it from their phone's League tab strip
    // without changing the shared competition for anyone else.
    const cupVisibilityKey = 'wr_league_cup_hidden_' + (leagueId || 'default');
    const [phoneCupHidden, setPhoneCupHidden] = React.useState(() => {
        try { return window.App?.WrStorage?.get?.(cupVisibilityKey, false) === true; } catch (_) { return false; }
    });
    const [leagueViewMenuOpen, setLeagueViewMenuOpen] = React.useState(false);
    const cupVisible = cupEnabled && (!isPhone || !phoneCupHidden);
    const setCupVisible = visible => {
        const hidden = !visible;
        setPhoneCupHidden(hidden);
        try { window.App?.WrStorage?.set?.(cupVisibilityKey, hidden); } catch (_) { /* browsing still works without local storage */ }
        if (hidden && innerTab === 'cup') {
            setInnerTab('league');
            setPhoneLeagueView('standings');
        }
    };
    const dashboardNav = window.App.DashboardLeagueLayout;
    const navigationLeagueId = dashboardNav.leagueId(currentLeague);
    const centralRef = React.useRef(null);
    const [innerTab, setInnerTab] = React.useState(() => dashboardNav.peek(navigationLeagueId)?.section || (homeMerged && isChopped ? 'kpis' : 'league'));
    const [phoneLeagueView, setPhoneLeagueView] = React.useState('standings');
    React.useEffect(() => {
        let hidden = false;
        try { hidden = window.App?.WrStorage?.get?.(cupVisibilityKey, false) === true; } catch (_) { /* use the default view */ }
        setPhoneCupHidden(hidden);
        setLeagueViewMenuOpen(false);
        if (isPhone && hidden) { setInnerTab('league'); setPhoneLeagueView('standings'); }
    }, [cupVisibilityKey, isPhone]);
    const [navigationIntent, setNavigationIntent] = React.useState(null);
    React.useEffect(() => {
        const apply = () => {
            const intent = dashboardNav.consume(navigationLeagueId);
            if (!intent) return;
            setInnerTab(intent.section);
            if (intent.anchor === 'scoreboard') setPhoneLeagueView('scores');
            if (intent.anchor === 'standings') setPhoneLeagueView('standings');
            setNavigationIntent(intent);
        };
        apply();
        window.addEventListener('wr:league-central-nav', apply);
        return () => window.removeEventListener('wr:league-central-nav', apply);
    }, [navigationLeagueId]);
    React.useEffect(() => {
        if (!navigationIntent) return;
        const frame = requestAnimationFrame(() => {
            const selector = { scoreboard: '.lls', standings: isPhone && isChopped ? '.mc-chop-panel' : '#league-central-standings', cup: '.cup-panel' }[navigationIntent.anchor];
            const target = centralRef.current?.querySelector(selector);
            if (target) {
                target.style.scrollMarginTop = isPhone ? '150px' : '115px';
                target.scrollIntoView({ block: 'start', behavior: 'instant' });
            }
            setNavigationIntent(null);
        });
        return () => cancelAnimationFrame(frame);
    }, [navigationIntent, innerTab, isPhone, isChopped]);
    const BRIEF_KEY = 'wr_cc_brief_collapsed';
    const [briefCollapsed, setBriefCollapsed] = React.useState(
        () => window.App?.WrStorage?.get?.(BRIEF_KEY, false) === true
    );
    const toggleBrief = () => setBriefCollapsed(v => {
        const next = !v;
        try { window.App?.WrStorage?.set?.(BRIEF_KEY, next); } catch (e) { /* private mode */ }
        return next;
    });

    const activeLeaders = statScope === 'season' ? seasonLeaders : leaders;
    const leaderRows = (leaderPos === 'Overall'
        ? activeLeaders.rows
        : activeLeaders.rows.filter(r => r.pos === leaderPos)).slice(0, 10);

    // Per-position stat columns, defined as App.StatCatalog keys so the
    // catalog stays the single source of truth for how each stat is derived
    // and formatted (see js/shared/stat-catalog.js). 'Overall' is the
    // cross-position points board and has no stat columns.
    const STAT_COLS = {
        QB: ['cmpPct', 'passYd', 'passTd', 'ints'],
        RB: ['rushAtt', 'rushYd', 'rushTd', 'receptions'],
        WR: ['targets', 'receptions', 'recYd', 'recTd'],
        TE: ['targets', 'receptions', 'recYd', 'recTd'],
        K: ['fgPct', 'fg50', 'xpm'],
        DL: ['tackles', 'sacks', 'qbHits'],
        LB: ['tackles', 'tfl', 'sacks'],
        DB: ['tackles', 'passDef', 'idpInts'],
    };
    const SC = window.App?.StatCatalog;
    const statCols = (leaderPos !== 'Overall' && SC ? (STAT_COLS[leaderPos] || []) : [])
        .map(k => SC.statByKey ? SC.statByKey(k) : null).filter(Boolean);


    // Standings row shells — the table view (form guide) and the odds view
    // (playoff picture) are two reads of the same enriched rows, so a team
    // can never rank differently between them.
    const FormGuide = ({ form }) => {
        if (!form || !form.length) return <span style={{ color: FAINT, fontFamily: MONO, fontSize: '0.65rem' }}>—</span>;
        return (
            <span style={{ display: 'inline-flex', gap: '3px' }}>
                {form.map((g, i) => (
                    <i key={i} title={'Week ' + g.week + (g.pts != null ? ' · ' + Number(g.pts).toFixed(1) : '')}
                        style={{
                            width: '16px', height: '16px', borderRadius: 'var(--card-radius-xs, 5px)',
                            display: 'grid', placeItems: 'center', fontFamily: MONO, fontSize: '0.5rem',
                            fontWeight: 800, fontStyle: 'normal',
                            background: g.result === 'W' ? 'rgba(46,204,113,0.16)' : 'rgba(231,76,60,0.14)',
                            color: g.result === 'W' ? GOOD : BAD,
                            border: '1px solid ' + (g.result === 'W' ? 'rgba(46,204,113,0.34)' : 'rgba(231,76,60,0.3)'),
                        }}>{g.result}</i>
                ))}
            </span>
        );
    };

    const th = { fontFamily: MONO, fontSize: '0.6rem', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', padding: '6px 7px', borderBottom: '1px solid ' + LINE, whiteSpace: 'nowrap' };
    const thNum = { ...th, textAlign: 'right' };
    const td = { padding: '7px', borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap', fontFamily: DM, fontSize: '0.78rem' };
    const tdNum = { ...td, textAlign: 'right', ...mono };

    const teamCell = (team, rank) => {
        const isMe = sameId(team.rosterId, myRoster?.roster_id);
        return (
            <React.Fragment>
                <td style={{ ...td, ...mono, color: MUTED, width: '22px', boxShadow: isMe ? 'inset 3px 0 0 ' + GOLD : 'none' }}>{rank}</td>
                <td style={{ ...td, fontWeight: isMe ? 700 : 600, color: isMe ? GOLD : WHITE, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {team.teamName || team.displayName || _getOwnerName(team.rosterId)}
                </td>
            </React.Fragment>
        );
    };

    const score = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2);
    const cutlineBefore = (teams, index, enabled) => {
        if (!enabled || !standingsPicture || standingsPicture.mode === 'none') return null;
        const state = teams[index]?.playoffState, previous = teams[index - 1]?.playoffState;
        const suffix = standingsView === 'division' ? ' · League-wide field' : '';
        if (state === 'tied' && previous !== 'tied') return (standingsPicture.mode === 'standard' ? 'Tied at cutline' : 'Tied at record cutoff') + suffix;
        if (state === 'outside' && ['division', 'wildcard', 'field'].includes(previous)) return standingsPicture.cutlineLabel + suffix;
        return null;
    };
    const qualificationLabel = team => standingsPicture?.mode !== 'standard' ? null : ({ division: 'Division lead', wildcard: 'Wild card' })[team.playoffState];
    const seededStandings = standingsPicture?.mode === 'standard' && standingsView !== 'division';
    const rankHeading = seededStandings ? 'Seed' : '#';
    const teamName = team => team.teamName || team.displayName || _getOwnerName(team.rosterId);
    const teamRecord = team => `${team.wins}-${team.losses}-${team.ties || 0}`;
    const rankDescription = seededStandings ? 'Provisional playoff seed' : standingsView === 'division' ? 'Division rank' : 'Rank';
    const renderStandingsTable = ({ teams, showCutline }) => isPhone ? <div className="la-standings" aria-label={liveReady ? `Week ${board.week} live standings` : 'Official standings'}><div className="la-standings-columns" aria-hidden="true"><span>{rankHeading}</span><span>Team</span><span>W–L–T</span><span>PF</span></div>{teams.map((team, index) => {
        const divisionView = hasDivisions && standingsView === 'division';
        const rank = Object.hasOwn(team, 'displayRank') ? team.displayRank : liveReady ? (team.rank == null ? null : divisionView ? teams.findIndex(t => t.rank === team.rank) + 1 : team.rank) : index + 1;
        const baseline = divisionView ? liveTable?.baselineRows.filter(t => t.division === team.division) : null;
        const before = Object.hasOwn(team, 'displayBaselineRank') ? team.displayBaselineRank : divisionView && team.baselineRank != null ? baseline.findIndex(t => t.rank === team.baselineRank) + 1 : team.baselineRank;
        const movement = liveReady && before != null && rank != null ? before - rank : null;
        const result = team.currentResult;
        const cutline = cutlineBefore(teams, index, showCutline);
        const form = window.MobileLiveStandingsData?.lastFive?.(team, liveTable?.baselineRows || [], Number(board.week)) || [];
        const formLabel = form.length ? 'Last ' + form.length + ' completed head-to-head games, oldest to newest: ' + form.join(', ') : 'Last 5 completed head-to-head games: form unavailable';
        const name = teamName(team), record = teamRecord(team), qualification = qualificationLabel(team);
        return <React.Fragment key={team.rosterId}>
            {cutline && <p className="la-cutline">{cutline}</p>}
            <details className={'la-report-row' + (sameId(team.rosterId, myRoster?.roster_id) ? ' la-own' : '')}>
                <summary aria-label={`${rank ?? 'Unranked'}. ${name}, ${record}, ${score(team.pointsFor)} fantasy points for. ${qualification ? qualification + '. ' : ''}${formLabel}. Show details`}>
                    <span className="la-standing-rank">{rank ?? '—'}</span>
                    <span className="la-standing-team">
                        <span className="mc-league-team-line">
                            <strong title={name}>{name}</strong>
                            {qualification && <small className="mc-league-qualifier" title={qualification}>{team.playoffState === 'division' ? 'DIV' : 'WC'}</small>}
                            {movement ? <small>{movement > 0 ? '↑' : '↓'}{Math.abs(movement)}</small> : null}
                        </span>
                        <span className="mc-league-form" role="group" aria-label={formLabel} title={formLabel}>
                            <span className="mc-league-form-label" aria-hidden="true">Last 5</span>
                            {form.length ? form.map((game, gameIndex) => <span key={gameIndex} className="mc-league-form-pill" data-result={game} aria-hidden="true">{game}</span>)
                                : <span className="mc-league-form-empty" aria-hidden="true">—</span>}
                        </span>
                    </span>
                    <span className="la-standing-record">{record}</span>
                    <span className="la-standing-points">{score(team.pointsFor)}</span>
                </summary>
                <dl className="la-fields">
                    <div><dt>Fantasy points for</dt><dd>{score(team.pointsFor)}</dd></div>
                    <div><dt>Points against</dt><dd>{score(team.pointsAgainst)}</dd></div>
                    {liveReady ? <>
                        <div><dt>Week {board.week}</dt><dd>{result ? (liveContext.historical ? result : { W:'Leading', L:'Trailing', T:'Tied' }[result]) : team.opponentRosterId == null && team.currentPoints != null ? 'Bye' : 'Pending'}</dd></div>
                        <div><dt>Current points</dt><dd>{score(team.currentPoints)}{team.opponentRosterId != null && `–${score(team.opponentPoints)}`}</dd></div>
                        {team.medianResult && <div><dt>Median result</dt><dd>{team.medianResult}</dd></div>}
                        <div><dt>Rank movement</dt><dd>{movement == null ? 'No prior rank' : movement ? `${movement > 0 ? 'Up' : 'Down'} ${Math.abs(movement)} since entering Week ${board.week}` : 'Unchanged'}</dd></div>
                    </> : <div><dt>Form</dt><dd>{team.streak || '—'}{team.form?.length > 0 && <span className="la-form-history">{team.form.map(game => `Week ${game.week}: ${game.result}${game.pts != null ? ' · ' + Number(game.pts).toFixed(1) : ''}`).join('; ')}</span>}</dd></div>}
                    {team.projWins != null && <div><dt>Projected record</dt><dd>{Number(team.projWins).toFixed(1)}–{Number(team.projLosses || 0).toFixed(1)}</dd></div>}
                    {team.playoffPct != null && <div><dt>Playoff chance</dt><dd>{team.playoffPct}%</dd></div>}
                </dl>
                {onOpenTeam && <button type="button" className="mc-team-link" onClick={() => onOpenTeam(team.rosterId, team)}>Roster &amp; team profile →</button>}
            </details>
        </React.Fragment>;
    })}</div> : <div className="lct-table-wrap">
        <table className="lct-table" aria-label={liveReady ? `Week ${board.week} live standings` : 'Official standings'}>
            <thead><tr>
                <th scope="col" className="lct-rank-col" aria-label={rankDescription}>{rankHeading}</th><th scope="col" className="lct-team-col">Team</th>
                <th scope="col" className="lct-record">W-L-T</th>
                <th scope="col" className="lct-desktop" title="Points for">PF</th><th scope="col" className="lct-desktop" title="Head-to-head points against">PA</th>
                <th scope="col" className="lct-week">{liveReady ? `Week ${board.week}` : 'Form'}</th>
            </tr></thead>
            <tbody>{teams.map((team, idx) => {
                const divisionView = hasDivisions && standingsView === 'division';
                const rank = Object.hasOwn(team, 'displayRank') ? team.displayRank : liveReady ? (team.rank == null ? null : divisionView ? teams.findIndex(t => t.rank === team.rank) + 1 : team.rank) : idx + 1;
                const baseline = divisionView ? liveTable?.baselineRows.filter(t => t.division === team.division) : null;
                const before = Object.hasOwn(team, 'displayBaselineRank') ? team.displayBaselineRank : divisionView && team.baselineRank != null ? baseline.findIndex(t => t.rank === team.baselineRank) + 1 : team.baselineRank;
                const change = liveReady && before != null && rank != null ? before - rank : null;
                const outcome = team.currentResult;
                const own = sameId(team.rosterId, myRoster?.roster_id);
                const cutline = cutlineBefore(teams, idx, showCutline);
                return <React.Fragment key={team.rosterId}>{cutline && <tr className="lct-cutline-label"><td colSpan={6}>{cutline}</td></tr>}<tr className={own ? 'lct-own' : ''}>
                    <td className="lct-rank-col"><span className="lct-rank-number">{rank ?? '—'}{liveReady && <span className="lct-movement" data-direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'} aria-label={change == null ? 'No prior rank' : change ? `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)} since entering Week ${board.week}` : 'Rank unchanged'}>{change ? `${change > 0 ? '↑' : '↓'}${Math.abs(change)}` : '—'}</span>}</span></td>
                    <td className="lct-team-col"><span className="lct-team-name">{team.teamName || team.displayName || _getOwnerName(team.rosterId)}</span>{qualificationLabel(team) && <small className="lct-qualification">{qualificationLabel(team)}</small>}<span className="lct-team-meta lct-phone">{score(team.pointsFor)} PF</span></td>
                    <td className="lct-record">{team.wins}-{team.losses}-{team.ties || 0}</td>
                    <td className="lct-desktop">{score(team.pointsFor)}</td><td className="lct-desktop">{score(team.pointsAgainst)}</td>
                    <td className="lct-week">{liveReady ? <>
                        <span className="lct-result" data-result={outcome || 'none'}>{outcome ? (liveContext.historical ? outcome : { W: 'Leading', L: 'Trailing', T: 'Tied' }[outcome]) : team.opponentRosterId == null && team.currentPoints != null ? 'Bye' : 'Pending'}</span>
                        <span className="lct-week-score">{score(team.currentPoints)}{team.opponentRosterId != null && `–${score(team.opponentPoints)}`}</span>
                        {team.medianResult && <small className="lct-team-meta">Median {team.medianResult}</small>}
                    </> : <><strong style={{ color: team.streak?.[0] === 'W' ? GOOD : MUTED }}>{team.streak || '—'}</strong><span className="lct-form lct-desktop"><FormGuide form={team.form} /></span></>}</td>
                </tr></React.Fragment>;
            })}</tbody>
        </table>
    </div>;

    const oddsMetrics = [
        { key: 'playoffPct', short: 'Playoffs', label: 'Make playoffs', color: GOOD },
        { key: 'byePct', short: 'Bye', label: 'First-round bye', color: INFO },
        { key: 'titlePct', short: 'Title', label: 'Win title', color: GOLD },
    ];
    const percent = value => value == null ? '—' : value + '%';
    const renderOddsTable = ({ teams }) => isPhone ? (
        <table className="mc-league-odds-table" aria-label="Playoff picture">
            <thead><tr>
                <th scope="col">#</th><th scope="col">Team</th>
                {oddsMetrics.map(metric => <th scope="col" key={metric.key} aria-label={metric.label}>{metric.short}</th>)}
            </tr></thead>
            <tbody>{teams.map((team, index) => {
                const name = teamName(team);
                const identity = <><strong title={name}>{name}</strong><small>{teamRecord(team)}</small></>;
                return <tr key={team.rosterId} className={sameId(team.rosterId, myRoster?.roster_id) ? 'la-own' : undefined}>
                    <td>{index + 1}</td>
                    <td>{onOpenTeam ? <button className="mc-league-odds-team" type="button" aria-label={name + ', ' + teamRecord(team) + ', team profile'} onClick={() => onOpenTeam(team.rosterId, team)}>{identity}</button>
                        : <span className="mc-league-odds-team">{identity}</span>}</td>
                    {oddsMetrics.map(metric => <td key={metric.key}>{percent(team[metric.key])}</td>)}
                </tr>;
            })}</tbody>
        </table>
    ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr>
                    <th style={th}></th><th style={th}>Team</th>
                    <th style={thNum}>W-L</th>
                    <th style={thNum}>Playoff</th>
                    {!isPhone && <th style={thNum}>Bye</th>}
                    <th style={thNum}>Title</th>
                </tr>
            </thead>
            <tbody>
                {teams.map((team, idx) => (
                    <tr key={team.rosterId} style={idx === playoffTeams - 1 && idx < teams.length - 1
                        ? { boxShadow: 'inset 0 -1px 0 rgba(212,175,55,0.45)' } : null}>
                        {teamCell(team, idx + 1)}
                        <td style={tdNum}>{team.wins}-{team.losses}</td>
                        <td style={tdNum}>
                            {team.playoffPct == null ? <span style={{ color: MUTED }}>—</span> : (
                                <React.Fragment>
                                    <span style={{ width: '42px', height: '5px', background: 'rgba(255,255,255,0.06)', borderRadius: 'var(--card-radius-xs, 5px)', display: 'inline-block', overflow: 'hidden', verticalAlign: 'middle', marginRight: '7px' }}>
                                        <i style={{ display: 'block', height: '100%', width: Math.max(0, Math.min(100, team.playoffPct)) + '%', background: GOOD, borderRadius: 'var(--card-radius-xs, 5px)' }} />
                                    </span>{team.playoffPct}%
                                </React.Fragment>
                            )}
                        </td>
                        {!isPhone && <td style={{ ...tdNum, color: SILVER }}>{team.byePct == null ? '—' : team.byePct + '%'}</td>}
                        <td style={{ ...tdNum, color: GOLD }}>{team.titlePct == null ? '—' : team.titlePct + '%'}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );

    const segBtn = (on) => ({
        fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.05em', textTransform: 'uppercase',
        padding: '5px 9px', borderRadius: 'var(--card-radius-xs, 5px)', border: 'none', cursor: 'pointer',
        whiteSpace: 'nowrap',
        background: on ? 'rgba(212,175,55,0.16)' : 'transparent', color: on ? GOLD : MUTED,
    });
    const segWrap = { display: 'flex', gap: '2px', background: WELL, borderRadius: 'var(--card-radius-sm, 8px)', padding: '2px', border: '1px solid ' + LINE };

    const me = enrichedStandings.find(t => sameId(t.rosterId, myRoster?.roster_id));
    const oddsReady = odds.status === 'ready' && odds.sim;

    const renderScoreboard = () => window.LeagueLiveScoreboard && React.createElement(window.LeagueLiveScoreboard, {
        key: leagueId + ':' + season,
        currentLeague, myRoster, playersData, onOpenTeam,
        getOwnerName: _getOwnerName, getPlayerName: _getPlayerName, setActiveTab,
        selectedWeek: scoreWeek, onWeekChange: week => setScoreSelection({ key: `${leagueId}|${season}`, week }),
        onRefresh: liveContext?.refresh, fullBoard: isPhone, overview,
    });
    let overviewHealth = null;
    if (overview && isPhone && myRoster && typeof window.assessTeamFromGlobal === 'function') {
        try { overviewHealth = window.assessTeamFromGlobal(myRoster.roster_id)?.healthScore ?? null; } catch (_) { /* unavailable read stays empty */ }
    }
    const showOverviewStandings = overview && isPhone && !isChopped && overviewContext?.enabled
        && window.App.LeagueLiveStandings?.overviewWindow({ league: currentLeague, nflState: window.S?.nflState,
            week: Number(overviewBoard.week), currentWeek: Number(currentWeek), games: overviewContext.games || [] });
    const overviewStandings = showOverviewStandings && overviewContext.history?.updatedAt
        && ['ready', 'refreshing', 'stale'].includes(overviewContext.history.status)
        ? window.App.LeagueLiveStandings.compute({ league: currentLeague, standings: enrichedStandings,
            priorWeeks: overviewContext.history.priorWeeks, board: overviewBoard, week: overviewBoard.week,
            currentWeek, startedRosterIds: overviewContext.startedRosterIds }) : null;
    const overviewHasLive = overviewStandings && overviewStandings.status !== 'official' && overviewBoard.updatedAt != null && overviewBoard.rows.length > 0;
    const overviewStandingsStatus = overviewHasLive ? (overviewStandings.status === 'baseline' ? 'baseline' : 'live')
        : overviewBoard.status === 'loading' && !overviewBoard.updatedAt ? 'loading' : 'official';
    const overviewSummaryTeams = showOverviewStandings ? (overviewHasLive ? overviewStandings.rows : enrichedStandings) : tableTeams;
    const overviewSummaryLive = showOverviewStandings ? overviewHasLive : liveReady;
    const overviewTeam = overviewSummaryTeams.find(team => sameId(team.rosterId, myRoster?.roster_id));
    const overviewRank = overviewTeam ? (overviewSummaryLive ? overviewTeam.rank : overviewSummaryTeams.indexOf(overviewTeam) + 1) : null;
    if (overview && isPhone) return <div ref={centralRef} className="la-mobile la-central mc-league-overview">
        <LeagueOverviewDecisions currentLeague={currentLeague} leagueSkin={resolvedLeagueSkin} myRoster={myRoster} playersData={playersData} scoreBoard={overviewBoard} setActiveTab={setActiveTab} />
        {isChopped && window.WrChopBlock && <window.WrChopBlock active compact phone currentLeague={currentLeague} myRoster={myRoster} onOpenLeague={() => setActiveTab?.('central')} />}
        {!isChopped && overviewTeam && <button type="button" className="mc-overview-summary" aria-label="Open your league standing and season outlook" onClick={() => setActiveTab?.('central')}>
            <span><small>{overviewSummaryLive ? 'Live record' : 'Record'}</small><strong>{overviewTeam.wins}–{overviewTeam.losses}{overviewTeam.ties ? '–' + overviewTeam.ties : ''}</strong></span>
            <span><small>Standing</small><strong>{overviewRank != null ? '#' + overviewRank : '—'}<em> / {overviewSummaryTeams.length}</em></strong></span>
            <span><small>{overviewHealth != null ? 'Roster health' : 'Points for'}</small><strong>{overviewHealth != null ? overviewHealth : score(overviewTeam.pointsFor)}</strong></span>
        </button>}
        {showOverviewStandings && window.MobileLiveStandings && <window.MobileLiveStandings
            league={currentLeague} grouping={standingsView} onGroupingChange={setStandingsView}
            teams={(overviewHasLive ? overviewStandings.rows : enrichedStandings.map((team, index) => ({ ...team, rank: team.rank ?? index + 1 }))).map(team => ({ ...team, teamName: team.teamName || team.displayName || _getOwnerName(team.rosterId) }))} baselineRows={overviewStandings?.baselineRows || []}
            myRosterId={myRoster?.roster_id} week={currentWeek} status={overviewStandingsStatus}
            stale={!!overviewBoard.error || ['stale', 'error', 'refreshing'].includes(overviewBoard.status) || ['stale', 'error'].includes(overviewContext.history?.status)}
            updatedAt={overviewBoard.updatedAt} onOpenLeague={() => setActiveTab?.('central')} onOpenTeam={onOpenTeam}
            onRefresh={() => { overviewBoard.refresh?.(); overviewContext.refresh?.(); }} />}
        {renderScoreboard()}
        {(!showOverviewStandings || !window.MobileLiveStandings) && <div className="mc-context-actions"><button type="button" onClick={() => setActiveTab?.(isChopped ? 'fa' : 'central')}>{isChopped ? 'Explore waivers →' : 'Full standings →'}</button><button type="button" onClick={() => setActiveTab?.('lineup')}>Game Day →</button></div>}
    </div>;

    const providerKey = String(currentLeague?._platform || currentLeague?.platform || currentLeague?.provider || window.S?.platform || 'sleeper').toLowerCase();
    const providerName = currentLeague?._mfl || currentLeague?._mflLeagueId ? 'MFL' : ({ sleeper: 'Sleeper', mfl: 'MFL', espn: 'ESPN', yahoo: 'Yahoo' })[providerKey] || 'your league platform';
    const standingsWarning = showLive && (['error', 'stale'].includes(board.status) || ['error', 'stale'].includes(liveContext.history.status) || liveTable?.status === 'partial');
    const standingsNotice = showLive ? board.status === 'error' ? 'Weekly scores could not load. Showing official records; refresh scores to retry.'
        : liveContext.history.status === 'error' ? 'Past scores could not load. Showing official records; refresh scores to retry.'
        : board.status === 'stale' || liveContext.history.status === 'stale' ? 'Refresh interrupted. Showing the last available scores; updates will retry automatically.'
        : board.status === 'ready' && !board.rows.length ? `Matchups for Week ${board.week} have not been reported. Showing official records.`
        : board.updatedAt == null ? 'Loading weekly scores. Official records are shown while they load.'
        : !liveTable ? 'Loading the weekly table. Official records are shown while it loads.'
        : liveTable.status === 'official' ? liveTable.message
        : liveContext.historical && liveTable.status === 'live' ? `Weekly results through Week ${board.week}. Movement from the start of that week.`
        : liveTable.message
        : isPhone ? 'Official record from ' + providerName + '.' : 'Sleeper’s posted record. Live results appear here once Sleeper adds them to the standings.';
    const phoneStandingsNotice = isPhone && liveReady && !standingsWarning ? liveTable.status === 'baseline'
        ? 'Live results begin when matchups start.' : liveContext.historical ? `Results through Week ${board.week} · movement from the start of that week.` : 'Provisional records · official standings may differ.' : standingsNotice;

    return (
        <div ref={centralRef} className={isPhone ? 'la-mobile la-central mc-league' : undefined} style={{ padding: isPhone ? '0' : '20px 24px', maxWidth: '1500px', margin: '0 auto', paddingBottom: '54px' }}>
            {!isPhone && <div style={{ marginBottom: '14px' }}>
                <div style={{ fontFamily: RAJ, fontWeight: 700, fontSize: isPhone ? '1.3rem' : '1.6rem', color: WHITE, letterSpacing: '0.02em' }}>
                    {homeMerged ? 'Command Center' : 'League Central'}
                </div>
                <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED, marginTop: '2px' }}>
                    {currentLeague?.name || 'League'} · {season} · {teamCount} Teams
                    {board.week ? <> · Week {board.week}</> : null}
                </div>
            </div>}

            {isPhone && <React.Fragment>
                <nav className={'mc-section-tabs' + (renderSeasonView ? ' mc-league-season-tabs' : '')} aria-label="League views">
                    {[['standings', isChopped ? 'Survival' : 'Standings'], ['scores', 'Scores'], ...(renderSeasonView ? [['season', 'Season'], ['odds', 'Odds']] : [])].map(([key, label]) => <button type="button" key={key} aria-pressed={phoneLeagueView === key && innerTab === 'league'} onClick={() => { setPhoneLeagueView(key); setInnerTab('league'); setLeagueViewMenuOpen(false); }}>{label}</button>)}
                    {cupVisible && <button type="button" aria-pressed={innerTab === 'cup'} onClick={() => { setInnerTab('cup'); setLeagueViewMenuOpen(false); }}>Cup</button>}
                    <button type="button" className="mc-league-view-menu" aria-label="Customize League views" aria-expanded={leagueViewMenuOpen} onClick={() => setLeagueViewMenuOpen(open => !open)}>•••</button>
                </nav>
                {leagueViewMenuOpen && <div className="mc-league-view-options" role="group" aria-label="Customize League views">
                    <span>League views</span>
                    <label><input type="checkbox" checked={cupVisible} onChange={event => setCupVisible(event.target.checked)} /> Show Cup on this device</label>
                </div>}
            </React.Fragment>}
            {(!isPhone || (innerTab === 'league' && phoneLeagueView === 'scores')) && renderScoreboard()}

            {/* Briefing — always the first thing you see on entry, collapsible
                to a one-line bar once you've read it. */}
            {homeMerged && innerTab !== 'cup' && briefSlot && (
                <div style={{ border: '1px solid rgba(155,138,251,0.28)', borderRadius: 'var(--card-radius-lg, 14px)', background: 'linear-gradient(135deg, rgba(155,138,251,0.09), rgba(212,175,55,0.03))', marginBottom: '14px', overflow: 'hidden' }}>
                    <button
                        type="button"
                        onClick={toggleBrief}
                        aria-expanded={!briefCollapsed}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: briefCollapsed ? '11px 14px' : '11px 14px 4px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}
                    >
                        <span style={{ ...microHdr, color: 'var(--purple, #9b8afb)' }}>Intelligence Briefing</span>
                        {briefCollapsed && (
                            <span style={{ fontFamily: DM, fontSize: '0.78rem', color: SILVER, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                tap to expand
                            </span>
                        )}
                        <span style={{ marginLeft: 'auto', color: MUTED, fontSize: '0.7rem', transform: briefCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                    </button>
                    {!briefCollapsed && <div style={{ padding: '0 4px 4px' }}>{briefSlot}</div>}
                </div>
            )}

            {/* League / KPIs */}
            {(!isPhone && (homeMerged || cupEnabled)) && (
                <div style={{ display: 'flex', gap: '22px', borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: '14px' }}>
                    {[...(homeMerged ? (isChopped ? [['kpis', 'KPIs'], ['league', 'League']] : [['league', 'League'], ['kpis', 'KPIs']]) : [['league', 'League']]), ...(cupEnabled ? [['cup', 'In-season Cup']] : [])].map(([k, label]) => (
                        <button key={k} type="button" onClick={() => setInnerTab(k)} style={{
                            fontFamily: RAJ, fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.04em',
                            textTransform: 'uppercase', padding: '10px 2px', background: 'transparent',
                            border: 'none', borderBottom: '2px solid ' + (innerTab === k ? GOLD : 'transparent'),
                            color: innerTab === k ? GOLD : MUTED, cursor: 'pointer', position: 'relative', top: '1px',
                        }}>{label}</button>
                    ))}
                </div>
            )}

            {isPhone && innerTab === 'league' && ['season', 'odds'].includes(phoneLeagueView) && renderSeasonView ? renderSeasonView(phoneLeagueView) : cupVisible && innerTab === 'cup' ? <React.Fragment>
                {React.createElement(window.WoeppelCupPanel, { key: leagueId + ':' + season, league: currentLeague, getOwnerName: _getOwnerName, myRoster })}
            </React.Fragment> : homeMerged && innerTab === 'kpis' ? (
                <div style={{ margin: isPhone ? '0 -14px' : '0 -24px' }}>{kpiSlot}</div>
            ) : (
            <React.Fragment>
            {isChopped && (!isPhone || phoneLeagueView === 'standings') && window.WrChopBlock && <window.WrChopBlock active phone={isPhone} currentLeague={currentLeague} myRoster={myRoster} />}
            {/* The two things that matter: Standings | Stats */}
            <div id="league-central-standings" className={isPhone ? `mc-league-content mc-league-${phoneLeagueView}` : undefined} style={{ scrollMarginTop: '100px', display: 'grid', gridTemplateColumns: isPhone ? 'minmax(0,1fr)' : 'minmax(0,1.32fr) minmax(0,1fr)', gap: '14px', alignItems: 'start' }}>

                {(!isPhone || (!isChopped && phoneLeagueView === 'standings')) && renderPanel({ title: isPhone && stMode === 'odds' ? 'Playoff picture' : 'Standings', meta: stMode === 'odds' && !isPhone ? '10,000-sim monte carlo' : null, right: isPhone ? <div className="la-tools mc-league-controls">
                        {!noPlayoffs && <div className="mc-league-control">
                            <select aria-label="Standings view" value={stMode} onChange={event => setStMode(event.target.value)}>
                                <option value="table">Standings</option><option value="odds">Playoff picture</option>
                            </select>
                        </div>}
                        {hasDivisions && stMode === 'table' && <div className="mc-league-control">
                            <select aria-label="Standings grouping" value={standingsView} onChange={event => setStandingsView(event.target.value)}>
                                <option value="overall">League-wide</option><option value="division">Divisions</option>
                            </select>
                        </div>}
                    </div> :
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {hasDivisions && stMode === 'table' && (
                                <div style={segWrap} role="group" aria-label="Standings grouping">
                                    {['overall', 'division'].map(v => (
                                        <button key={v} onClick={() => setStandingsView(v)} style={segBtn(standingsView === v)}>
                                            {v === 'division' ? 'Divisions' : 'League-wide'}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!noPlayoffs && (
                                <div style={segWrap}>
                                    <button onClick={() => setStMode('table')} style={segBtn(stMode === 'table')}>Table</button>
                                    <button onClick={() => setStMode('odds')} style={segBtn(stMode === 'odds')}>Playoff Picture</button>
                                </div>
                            )}
                        </div>, children: <>
                    <div className="lct-live-panel">
                    {stMode === 'table' && <>
                        <div className="lct-status">
                            <div className="lct-status-copy" role="status">
                                <strong>{liveReady && liveTable.status !== 'baseline' && board.status !== 'stale' && <i className="lct-live-dot" aria-hidden="true" />}{liveReady ? liveTable.status === 'baseline' ? `Entering Week ${board.week}` : liveContext.historical ? `${liveTable.status === 'partial' ? 'Partial results ·' : 'Through'} Week ${board.week}` : `As it stands · Week ${board.week}` : 'Official record'}</strong>
                                <small>{showLive && board.updatedAt ? `${isPhone ? 'Updated' : 'Scores updated'} ${new Date(board.updatedAt).toLocaleTimeString([], isPhone ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit', second: '2-digit' })} · ${isPhone ? 'Auto' : 'Every 30s'}` : 'Posted by ' + (isPhone ? providerName : 'Sleeper')}</small>
                            </div>
                            {liveContext?.enabled && <div className="lct-mode-toggle" role="group" aria-label="Standings source"><button type="button" aria-pressed={tableSource === 'live'} onClick={() => setTableSource('live')}>{liveContext.historical ? `Week ${board.week}` : 'Live'}</button><button type="button" aria-pressed={tableSource === 'official'} onClick={() => setTableSource('official')}>Official</button></div>}
                        </div>
                        <p className={'lct-note mc-league-notice' + (standingsWarning ? ' is-warning' : '')}>{phoneStandingsNotice}</p>
                    </>}
                    {/* Your own odds lead the playoff view — the season-odds read,
                        folded into standings instead of a separate slab. */}
                    {stMode === 'odds' && oddsReady && me && (isPhone ? (
                        <section className="mc-league-own-odds" aria-label="Your playoff odds">
                            <strong>Your odds</strong>
                            <dl>{oddsMetrics.map(metric => <div key={metric.key}><dt aria-label={metric.label}>{metric.short}</dt><dd>{percent(me[metric.key])}</dd></div>)}</dl>
                        </section>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(160px,100%),1fr))', gap: '9px', marginBottom: '11px' }}>
                            {oddsMetrics.map(o => (
                                <div key={o.key} style={{ background: WELL, border: '1px solid ' + LINE, borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px' }}>
                                    <div style={microHdr}>{o.label}</div>
                                    <div style={{ ...mono, fontSize: '1.7rem', fontWeight: 700, color: o.color, marginTop: '3px', lineHeight: 1 }}>
                                        {percent(me[o.key])}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}
                    {stMode === 'odds' && !oddsReady && (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED, marginBottom: '10px' }}>
                            {odds.status === 'loading' ? 'Simulating the rest of the season…'
                                : 'Not enough games played to simulate the playoff picture yet.'}
                        </div>
                    )}

                    {!enrichedStandings.length ? (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>No standings yet.</div>
                    ) : stMode === 'odds' ? (
                        renderOddsTable({ teams: enrichedStandings })
                    ) : (hasDivisions && standingsView === 'division') ? (
                        <div>
                            {divisionGroups.map(group => (
                                <div key={group.key} style={{ marginBottom: '12px' }}>
                                    <div style={{ ...microHdr, color: GOLD, padding: '6px', background: 'rgba(212,175,55,0.06)', borderRadius: 'var(--card-radius-xs, 5px)', marginBottom: '2px' }}>
                                        {group.name} <span style={{ color: MUTED, textTransform: 'none', letterSpacing: 0 }}>· {group.teams.length} teams</span>
                                    </div>
                                    {renderStandingsTable({ teams: group.teams, showCutline: true })}
                                </div>
                            ))}
                        </div>
                    ) : (
                        renderStandingsTable({ teams: standingsTeams, showCutline: true })
                    )}
                    {stMode === 'table' && standingsPicture?.note && <p className="lct-note lct-playoff-note">{standingsPicture.note}</p>}
                    {stMode === 'table' && liveReady && <details style={{ marginTop: 12 }}><summary style={{ fontSize: '.75rem', color: SILVER, cursor: 'pointer', padding: '8px 0' }}>How the live table works</summary><p className="lct-note">Current scores are treated as results, then added once to all earlier regular-season weeks. Playoff order follows record, points for and points against when standard seeding is verified; division leaders come first. Unresolved ties share a rank. Arrows show movement {standingsView === 'division' && hasDivisions ? 'within the division' : 'in the league-wide order'} since entering Week {board.week}. This table does not apply custom playoff seeding or change your league’s official record. {Number(currentLeague?.settings?.league_average_match) === 1 && 'Median results add a second decision once every matchup has started and all scores are available. Points for count once; points against show head-to-head opponents only.'}</p></details>}
                    </div>
                </> })}

                {!isPhone && <div className="mc-league-leaders">
                {renderPanel({ title: "Stat leaders", right: <div style={segWrap}>
                            <button aria-pressed={statScope === 'week'} onClick={() => setStatScope('week')} style={segBtn(statScope === 'week')}>
                                {leaders.week ? 'Week ' + leaders.week : 'Week'}
                            </button>
                            <button aria-pressed={statScope === 'season'} onClick={() => setStatScope('season')} style={segBtn(statScope === 'season')}>Season</button>
                        </div>, children: <>
                    <button type="button" onClick={() => setActiveTab?.('stats')} style={{ ...segBtn(false), color: GOLD, padding: '5px 0', marginBottom: '8px', textTransform: 'none', fontSize: '0.75rem' }}>Explore all player stats →</button>
                    <div className="wr-hscroll" style={{ display: 'flex', gap: '3px', overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '8px', marginBottom: '9px' }}>
                        {['Overall', ...leaguePositions].map(p => (
                            <button key={p} aria-pressed={leaderPos === p} onClick={() => setLeaderPos(p)} style={{ ...segBtn(leaderPos === p), fontWeight: 700 }}>{p}</button>
                        ))}
                    </div>
                    {activeLeaders.status === 'loading' ? (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>Loading {statScope === 'season' ? 'season' : 'week'} stats…</div>
                    ) : activeLeaders.status === 'unavailable' ? (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>Season totals aren't available for this league.</div>
                    ) : !leaderRows.length ? (
                        <div style={{ fontFamily: DM, fontSize: '0.8rem', color: MUTED }}>No stats reported yet.</div>
                    ) : isPhone ? (
                        <div>{leaderRows.map((row, index) => <details className="la-report-row" key={row.pid}><summary><span><strong>{index + 1}. {row.name}</strong><small>{row.pos} · {row.team}</small></span><span className="la-main-value"><strong>{row.pts.toFixed(1)}</strong><small>Points</small></span><span className="la-detail-cue" aria-hidden="true">+</span></summary><dl className="la-fields"><div><dt>Owner</dt><dd>{_getOwnerName(row.rosterId)}</dd></div>{statCols.map(col => <div key={col.key}><dt>{col.label}</dt><dd>{SC.formatStat(SC.computeStat(col.key, row.raw), col.format)}</dd></div>)}</dl><button type="button" onClick={() => window.WR?.openPlayerCard?.(row.pid)}>Open player card</button></details>)}</div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={th}></th>
                                        <th style={th}>{leaderPos === 'Overall' ? 'Player' : 'Player'}</th>
                                        {leaderPos === 'Overall' && !isPhone && <th style={th}>Owner</th>}
                                        {statCols.map(c => <th key={c.key} style={thNum} title={c.label}>{c.short}</th>)}
                                        <th style={thNum}>PTS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {leaderRows.map((r, i) => (
                                        <tr key={r.pid}>
                                            <td style={{ ...td, ...mono, color: MUTED, width: '18px' }}>{i + 1}</td>
                                            <td style={{ ...td, maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                <div style={{ fontWeight: 600, color: WHITE }}>{r.name}</div>
                                                <div style={{ fontFamily: MONO, fontSize: '0.62rem', color: MUTED }}>{r.pos} · {r.team}</div>
                                            </td>
                                            {leaderPos === 'Overall' && !isPhone && (
                                                <td style={{ ...td, color: SILVER, fontSize: '0.72rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{_getOwnerName(r.rosterId)}</td>
                                            )}
                                            {statCols.map(c => (
                                                <td key={c.key} style={{ ...tdNum, color: SILVER }}>
                                                    {SC.formatStat(SC.computeStat(c.key, r.raw), c.format)}
                                                </td>
                                            ))}
                                            <td style={{ ...tdNum, fontWeight: 700, color: GOLD }}>{r.pts.toFixed(1)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </> })}
                </div>}
            </div>
            </React.Fragment>
            )}

        </div>
    );
}

window.LeagueCentralTab = LeagueCentralTab;
window.LeagueOverviewDecisions = LeagueOverviewDecisions;
window.buildLeagueOverviewDecision = buildLeagueOverviewDecision;
