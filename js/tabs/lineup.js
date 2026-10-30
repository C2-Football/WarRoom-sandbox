// ══════════════════════════════════════════════════════════════════
// js/tabs/lineup.js — LineupTab: weekly Start/Sit Command Center.
// Interactive lineup builder: one unified table where each starting slot
// is a row (assigned player + projection + matchup + rolling form), and
// tapping a slot reveals every eligible roster player so you can set it.
// Working totals + optimal delta update live. League-scored via
// App.WeeklyProj / App.StartSit; auto-fill ranks the selected rolling PPG window.
// NOTE: builds/compares your lineup IN-APP. MFL leagues can push the working
// lineup straight to MyFantasyLeague ("Submit to MFL"); Sleeper has no public
// lineup-write API, so Sleeper lineups are still set on the platform.
// ══════════════════════════════════════════════════════════════════

// Text + color communicate risk without relying on color alone.
function LineupInjuryBadge({ status }) {
    const code = String(status || '').trim().toUpperCase();
    if (!code) return null;
    const label = ({ D: 'Doubtful', DOUBTFUL: 'Doubtful', Q: 'Questionable', QUESTIONABLE: 'Questionable', O: 'Out', OUT: 'Out' })[code] || status;
    const tone = ['D', 'DOUBTFUL', 'O', 'OUT', 'IR', 'PUP', 'SUS', 'DNP', 'COV'].includes(code) ? 'danger' : ['Q', 'QUESTIONABLE'].includes(code) ? 'caution' : 'muted';
    return <span className={'lineup-injury is-' + tone}>{label}</span>;
}

// Stable component identity keeps the player button available for sheet focus return.
const MobilePlayerRow = ({ pos, name, tag, slots, accent, injuryStatus, onClick, delta, disabled, actualScore }) => (
    <button type="button" className={'gd-plan-player' + (accent === 'risk' ? ' is-risk' : '') + (actualScore ? ' has-actual-score' : '')} onClick={onClick} disabled={disabled}>
        <span className={'gd-player-initial gd-pos-' + String(pos || '').toLowerCase().replace(/[^a-z]/g, '')}
            style={window.App?.idpPositionFamily?.(pos) ? { '--gd-position-ink': window.App.positionColor(pos), '--gd-position-fill': 'color-mix(in srgb, ' + window.App.positionColor(pos) + ' 16%, transparent)' } : undefined}
            aria-hidden="true">{pos}</span>
        <span className="gd-player-main"><strong>{name}</strong><LineupInjuryBadge status={injuryStatus} /><span>{tag}</span></span>
        {actualScore ? <span className={'gd-player-actual is-' + actualScore.tone} title={actualScore.comparison || (actualScore.label + ' actual points · no pregame comparison')}><strong>{Number.isFinite(actualScore.points) ? actualScore.points.toFixed(2) : '—'}</strong><small>{actualScore.label} pts</small></span> : null}
        <span className="gd-plan-stats" style={{ '--mc-columns': (slots || []).length }}>{(slots || []).map(stat => <span key={stat.label}><strong>{stat.value}</strong><small>{stat.label === 'PROJ' ? 'Proj' : stat.label}</small></span>)}</span>
        {actualScore?.comparison ? <span className={'gd-score-comparison is-' + actualScore.tone}>{actualScore.comparison}</span> : null}
        <span className="gd-row-chevron" aria-hidden="true">›</span>
        {delta != null && <span className={'mc-swap-delta ' + (delta < 0 ? 'is-loss' : 'is-gain')}>{delta > 0 ? '+' : ''}{delta.toFixed(1)} projected pts</span>}
    </button>
);

// Final scores may be compared only with a forecast captured before kickoff.
// In-progress scores and first-view snapshots never acquire a quality color.
function lineupScorePresentation({ tracking, submitted, state, gamesFresh, actual, forecast, scoreStatus, scoreError, scoresSupported }) {
    if (!tracking || !submitted || state === 'upcoming') return null;
    // The fantasy feed retains previous rows on failed refresh. Fresh NFL
    // finality alone cannot turn a previously seen midgame score into a grade.
    const scoresReady = scoresSupported === true && scoreStatus === 'ready' && !scoreError;
    const label = !scoresReady ? (Number.isFinite(actual) ? 'Last available' : 'Awaiting score')
        : state === 'final' ? 'Final' : state === 'live' ? 'Live' : state === 'locked' ? 'Kickoff' : 'Unverified';
    const comparable = scoresReady && gamesFresh && state === 'final' && Number.isFinite(actual)
        && forecast?.kind === 'pregame' && Number.isFinite(forecast.points);
    const grade = comparable ? window.App?.ScoringVisuals?.compare?.(actual, forecast.points, { complete: true }) : null;
    const tone = ['strong', 'typical', 'quiet'].includes(grade?.tone) ? grade.tone : 'neutral';
    const gradeLabel = { strong: 'Above forecast', typical: 'Near forecast', quiet: 'Below forecast' }[tone];
    return { points: Number.isFinite(actual) ? actual : null, label, tone,
        comparison: comparable && gradeLabel ? gradeLabel + ' · vs saved pregame ' + forecast.points.toFixed(1) : null };
}

// Position totals and their player comparisons share one disclosure. Flexes
// stay in their actual lineup slot instead of duplicating cross-position pairs.
function MatchupBreakdown({ matchup, comparison, week, pro, pmeta, upgrade, compact = false, reviewControls, benchmarkContext }) {
    const [expanded, setExpanded] = React.useState({ scope: '', groups: [] });
    const [benchmarkChoice, setBenchmarkChoice] = React.useState({ scope: '', basis: 'projected' });
    const [benchmarkLoad, setBenchmarkLoad] = React.useState({ key: '', options: null, players: null, stats: null });
    const benchmarkSequence = React.useRef(0);
    const benchmarkLive = React.useRef('');
    const fmt = value => Number.isFinite(value) ? value.toFixed(1) : '—';
    const actualFmt = value => Number.isFinite(value) ? value.toFixed(2) : '—';
    const gap = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) * 10) / 10 : null;
    const tone = delta => delta == null || delta === 0 ? 'even' : delta > 0 ? 'ahead' : 'behind';
    const edge = delta => delta == null ? 'Unavailable' : delta === 0 ? 'Even' : (delta > 0 ? 'You +' : 'Them +') + fmt(Math.abs(delta));
    const oppName = comparison?.oppName || matchup?.oppName || 'Opponent';
    const benchmarkLeague = benchmarkContext?.league || {};
    const benchmarkLeagueId = String(benchmarkLeague.league_id || benchmarkLeague.id || '');
    const benchmarkAccount = () => window.WR?.WaiverPlans?.account?.()
        || (window.App?.OD || window.OD)?.getCurrentUserId?.() || benchmarkContext?.userId || '';
    const accountKey = String(benchmarkAccount());
    const scope = [accountKey, benchmarkLeague._platform || window.S?.platform || '', benchmarkLeagueId, benchmarkLeague.season || '', week, oppName, comparison?.matchupId || ''].join('|');
    const reviewing = !!comparison?.available && (!!comparison.hasStarted || comparison.phase === 'past');
    const actualMode = reviewing;
    const Basis = window.App?.RosterLensBasis;
    const selectedBasis = benchmarkChoice.scope === scope ? benchmarkChoice.basis : 'projected';
    const basis = pro && !actualMode && benchmarkContext && Basis?.comparison && ['average', 'idp-average'].includes(selectedBasis) ? selectedBasis : 'projected';
    const empirical = basis !== 'projected';
    const basisLabel = basis === 'average' ? String(benchmarkLeague.season || '') + ' average points' : 'IDP averages + projections';
    const nativeAverages = !!benchmarkLeague._mfl || benchmarkLeague._platform === 'mfl' || benchmarkLeagueId.startsWith('mfl_');
    const benchmarkKey = JSON.stringify([scope, basis, benchmarkContext?.revision || 0, benchmarkContext?.statsSeason, benchmarkLeague.scoring_settings]);
    benchmarkLive.current = benchmarkKey;
    const benchmarkOptions = { ...benchmarkContext, league: benchmarkLeague, week, basis, players: benchmarkContext?.players || {} };
    const prepared = !nativeAverages ? benchmarkOptions : benchmarkLoad.key === benchmarkKey
        && benchmarkLoad.players === benchmarkContext?.players && benchmarkLoad.stats === benchmarkContext?.statsData ? benchmarkLoad.options : null;
    React.useEffect(() => {
        const request = ++benchmarkSequence.current;
        let cancelled = false;
        if (!empirical || !nativeAverages || !Basis?.prepare) return () => { cancelled = true; };
        const playerSnapshot = benchmarkContext?.players, statSnapshot = benchmarkContext?.statsData;
        setBenchmarkLoad({ key: benchmarkKey, options: null, players: playerSnapshot, stats: statSnapshot });
        Promise.resolve().then(() => Basis.prepare(benchmarkOptions)).then(options => {
            if (cancelled || request !== benchmarkSequence.current || benchmarkLive.current !== benchmarkKey || String(benchmarkAccount()) !== accountKey
                || window.S?.currentLeagueId != null && String(window.S.currentLeagueId) !== benchmarkLeagueId) return;
            setBenchmarkLoad({ key: benchmarkKey, options: options || benchmarkOptions, players: playerSnapshot, stats: statSnapshot });
        }).catch(() => {
            if (!cancelled && request === benchmarkSequence.current && benchmarkLive.current === benchmarkKey && String(benchmarkAccount()) === accountKey
                && (window.S?.currentLeagueId == null || String(window.S.currentLeagueId) === benchmarkLeagueId))
                setBenchmarkLoad({ key: benchmarkKey, options: benchmarkOptions, players: playerSnapshot, stats: statSnapshot });
        });
        return () => { cancelled = true; };
    }, [benchmarkKey, empirical, nativeAverages, benchmarkContext?.players, benchmarkContext?.statsData, Basis]);
    if (!matchup && !comparison?.available) return null;
    const sourceRows = reviewing ? comparison.h2h.map(row => ({ ...row, myMed: actualMode ? row.myActual : row.myProjection, theirMed: actualMode ? row.theirActual : row.theirProjection })) : matchup?.h2h || [];
    const benchmarkFor = (row, side) => {
        if (row[side + 'Reported'] === false) return { points: { median: null }, comparisonBasis: 'unavailable' };
        const pid = row[side + 'Pid'];
        if (!pid) return { available: true, points: { median: 0 }, comparisonBasis: 'empty' };
        if (!prepared) return { points: { median: null }, comparisonBasis: basis === 'average' || ['DL', 'LB', 'DB'].includes(Basis.position?.(benchmarkContext?.players?.[pid]?.position)) ? 'average' : 'projected' };
        try { return Basis.comparison(pid, { ...prepared, basis, week, projected: { available: Number.isFinite(row[side + 'Med']), points: { median: row[side + 'Med'] } } }); }
        catch (_) { return { points: { median: null }, comparisonBasis: 'unavailable' }; }
    };
    const rows = sourceRows.map((row, index) => {
        if (!empirical) return { ...row, slot: row.slot || 'START', index, delta: gap(row.myMed, row.theirMed) };
        const mine = benchmarkFor(row, 'my'), theirs = benchmarkFor(row, 'their');
        const myMed = mine.available === true && Number.isFinite(mine.points?.median) ? mine.points.median : null;
        const theirMed = theirs.available === true && Number.isFinite(theirs.points?.median) ? theirs.points.median : null;
        return { ...row, slot: row.slot || 'START', index, myMed, theirMed, myBenchmark: mine, theirBenchmark: theirs, delta: gap(myMed, theirMed) };
    });
    const shortSlot = slot => ({ SUPER_FLEX: 'SFLX', WRTQ: 'SFLX', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', IDP_FLEX: 'IDP' })[slot] || slot;
    const grouped = new Map();
    rows.forEach(row => { const key = row.slot || 'START'; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row); });
    const sum = (group, key) => group.every(row => Number.isFinite(row[key])) ? group.reduce((total, row) => total + row[key], 0) : null;
    const actualSum = (group, side) => sum(group.map(row => ({ value: row[side + 'Reported'] === false ? null : row[side + 'Pid'] == null || row[side + 'State'] === 'upcoming' ? 0 : row[side + 'Actual'] })), 'value');
    const positions = rows.length ? [...grouped].map(([key, players]) => {
        const mine = actualMode ? actualSum(players, 'my') : sum(players, 'myMed'), theirs = actualMode ? actualSum(players, 'their') : sum(players, 'theirMed');
        return { key, pos: shortSlot(key), mine, theirs, projectedMine: sum(players, 'myProjection'), projectedTheirs: sum(players, 'theirProjection'), players, delta: gap(mine, theirs) };
    }) : empirical ? [] : (matchup?.posStrength || []).map(row => ({ ...row, key: row.pos, players: [], delta: gap(row.mine, row.theirs) }));
    const openGroups = expanded.scope === scope ? expanded.groups : [];
    const expandable = positions.filter(row => row.players.length);
    const allOpen = expandable.length > 0 && expandable.every(row => openGroups.includes(row.key));
    const listId = 'gd-position-comparison-' + week;
    const toggleGroup = key => setExpanded(previous => {
        const current = previous.scope === scope ? previous.groups : [];
        return { scope, groups: current.includes(key) ? current.filter(value => value !== key) : [...current, key] };
    });
    const incomplete = empirical && !rows.length || positions.some(row => row.delta == null);
    const best = positions.filter(row => row.delta > 0).sort((a, b) => b.delta - a.delta)[0];
    const toughest = positions.filter(row => row.delta != null && row.delta < 0).sort((a, b) => a.delta - b.delta)[0];
    const close = rows.filter(row => row.delta != null && Math.abs(row.delta) <= 2);
    const leads = rows.filter(row => row.delta > 0).length;
    const largest = Math.max(0, ...rows.map(row => Math.abs(row.delta || 0)));
    const maxPosition = Math.max(1, ...positions.flatMap(row => [row.mine || 0, row.theirs || 0]));
    const fc = matchup?.fc || {};
    const margin = actualMode ? gap(comparison.totalMine, comparison.totalTheirs) : empirical ? gap(sum(rows, 'myMed'), sum(rows, 'theirMed')) : reviewing ? gap(comparison.projectedMine, comparison.projectedTheirs) : fc.margin;
    const myTotal = actualMode ? comparison.totalMine : empirical ? rows.length ? sum(rows, 'myMed') : null : reviewing ? comparison.projectedMine : fc.projMe;
    const theirTotal = actualMode ? comparison.totalTheirs : empirical ? rows.length ? sum(rows, 'theirMed') : null : reviewing ? comparison.projectedTheirs : pro ? fc.projOpp : matchup?.oppCurTotal;
    const projectionLabel = kind => kind === 'pregame' ? 'Pregame' : kind === 'first-view' ? 'First view' : kind === 'current' ? 'Est.' : 'Projection';
    const playerStateLabel = (row, side) => !comparison?.ready ? Number.isFinite(row[side + 'Actual']) ? 'Last seen' : 'Awaiting' : row[side + 'State'] === 'final' ? row[side + 'Complete'] ? 'Final' : 'Awaiting score' : ({ upcoming: 'Yet to play', live: 'Live', locked: 'Kickoff', bye: 'Bye' })[row[side + 'State']] || 'Unverified';
    const playerNumber = (row, side) => empirical ? <span className="gd-benchmark-player-points"><strong>{fmt(row[side + 'Med'])}</strong><small>{row[side + 'Benchmark']?.comparisonBasis === 'average' ? 'Avg' : row[side + 'Benchmark']?.comparisonBasis === 'empty' ? 'Empty slot' : 'Proj'}{Number.isFinite(row[side + 'Benchmark']?.averageGames) ? ' · ' + row[side + 'Benchmark'].averageGames + ' games' : ''}</small></span> : actualMode ? <span className={'gd-review-player-points' + (row[side + 'Comparable'] ? ' is-' + row[side + 'Tone'] : '')}><strong aria-label={'Actual points ' + actualFmt(row[side + 'Actual'])}>{actualFmt(row[side + 'Actual'])}</strong><small><span>{projectionLabel(row[side + 'ProjectionKind'])}</span> <strong>{fmt(row[side + 'Projection'])}</strong></small>{row[side + 'Comparable'] ? <em>{row[side + 'Delta'] > 0 ? '+' : ''}{fmt(row[side + 'Delta'])} vs pregame</em> : null}</span> : reviewing ? <span className="gd-review-player-points"><strong>{fmt(row[side + 'Med'])}</strong><small>{projectionLabel(row[side + 'ProjectionKind'])}</small></span> : <strong>{fmt(row[side + 'Med'])}</strong>;
    return <section className={'gd-matchup' + (compact ? ' gd-matchup-compact' : '') + (reviewing ? ' gd-matchup-review' : '')} data-score-view={actualMode ? 'actual' : empirical ? basis : reviewing ? 'projection' : 'outlook'} aria-label="Weekly matchup breakdown">
        {reviewControls}
        {pro && !actualMode && benchmarkContext && Basis?.comparison && <div className="gd-matchup-benchmark-tools"><select aria-label="Matchup point comparison basis" value={basis} onChange={event => setBenchmarkChoice({ scope, basis: ['average', 'idp-average'].includes(event.target.value) ? event.target.value : 'projected' })}><option value="projected">Projected</option><option value="average">Avg points</option><option value="idp-average">IDP avg</option></select>{empirical && nativeAverages && !prepared && <span role="status">Loading averages…</span>}</div>}
        <div className="gd-matchup-heading">
            <div><div className="gd-matchup-eyebrow">Week {week} · {actualMode ? comparison.headerLabel : empirical ? basisLabel : reviewing ? 'Submitted lineup projections' : 'Matchup outlook'}</div><h2>vs {oppName}</h2>
                {!compact && !empirical && <p>{reviewing ? 'Submitted starters · actual points against their saved projections' : 'Projected points · your lineup plan vs their ' + (pro ? 'optimal' : 'current') + ' lineup'}</p>}
                <div className="gd-matchup-totals"><span><strong>{actualMode ? actualFmt(myTotal) : fmt(myTotal)}</strong><small>You</small>{actualMode && <small>Proj {fmt(comparison.projectedMine)}</small>}</span><span className="gd-matchup-versus">vs</span><span><strong>{actualMode ? actualFmt(theirTotal) : fmt(theirTotal)}</strong><small>Them</small>{actualMode && <small>Proj {fmt(comparison.projectedTheirs)}</small>}</span></div>
            </div>
            {pro && !reviewing && !empirical ? <div className={'gd-matchup-odds is-' + tone(margin)}><strong>{fc.winPct == null ? '—' : fc.winPct + '%'}</strong><span>Win probability</span><small>{margin == null ? 'Forecast unavailable' : margin === 0 ? 'Even projection' : fmt(Math.abs(margin)) + ' pts ' + (margin > 0 ? 'ahead' : 'behind')}</small></div> : null}
        </div>
        {reviewing && !empirical && <p className={'gd-review-status' + (!comparison.ready ? ' is-stale' : '')} role="status">{!comparison.ready ? comparison.status === 'stale' ? 'Refresh failed · last available scores. ' : 'Score or game status updating. ' : ''}{comparison.sourceNote}{comparison.updatedAt ? ' · Updated ' + new Date(comparison.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</p>}
        {pro ? <React.Fragment>
            {!compact && !reviewing && !empirical && <p className="gd-matchup-context">Their current lineup: {fmt(matchup?.oppCurTotal)} · Optimal: {fmt(matchup?.oppIdealTotal)}{Number.isFinite(matchup?.oppCurTotal) && matchup.oppIdealTotal - matchup.oppCurTotal > 0.5 ? <span> · {fmt(matchup.oppIdealTotal - matchup.oppCurTotal)} projected points on their bench</span> : null}</p>}
            <div className="gd-matchup-focus" aria-label="Matchup key edges">
                <div className="is-ahead"><small>{actualMode ? 'Actual edge' : 'Your biggest edge'}</small><strong>{best ? best.pos + ' +' + fmt(best.delta) : incomplete ? 'Incomplete data' : actualMode ? 'No lead yet' : empirical ? 'No benchmark edge' : 'No projected edge'}</strong><span>{actualMode ? 'Points scored so far' : best ? 'Your strongest position advantage' : 'Look for gains in the close slots'}</span></div>
                <div className="is-behind"><small>{actualMode ? 'Actual gap' : 'Biggest gap'}</small><strong>{toughest ? toughest.pos + ' −' + fmt(Math.abs(toughest.delta)) : incomplete ? 'Incomplete data' : actualMode ? 'No deficit' : empirical ? 'No benchmark deficit' : 'No projected deficit'}</strong><span>{actualMode ? 'Points scored so far' : toughest ? 'Their strongest position advantage' : incomplete ? empirical ? 'Some benchmarks are unavailable' : 'Some projections are unavailable' : 'No position group trails'}</span></div>
                <div className="is-close"><small>{actualMode ? 'Final vs pregame' : 'Close contests'}</small><strong>{actualMode ? comparison.myDelta == null ? comparison.allFinal ? 'No baseline' : 'In progress' : (comparison.myDelta > 0 ? '+' : '') + fmt(comparison.myDelta) : close.length + ' ' + (close.length === 1 ? 'slot' : 'slots')}</strong><span>{actualMode ? comparison.myDelta == null ? 'Player results below' : 'Your submitted lineup' : empirical ? 'Within 2 benchmark points' : 'Within 2 projected points'}</span></div>
            </div>
            <div className="gd-matchup-section-heading"><h3>Position strength</h3><button type="button" className="gd-matchup-show-all" aria-pressed={allOpen} aria-controls={listId} disabled={!expandable.length} onClick={() => setExpanded({ scope, groups: allOpen ? [] : expandable.map(row => row.key) })}>{allOpen ? 'Hide all players' : 'Show all players'}</button></div>
            <p className="gd-matchup-position-help">{actualMode ? 'Actual and projection side by side · tap a row for players.' : 'By lineup slot · tap a row for players. You lead ' + leads + ' of ' + rows.length + ' slots.'}</p>
            <div className="gd-position-legend"><span>You ◀</span><span>▶ Opponent</span></div>
            <div className="gd-position-list" id={listId}>{positions.map((position, groupIndex) => {
                const open = openGroups.includes(position.key), detailId = listId + '-group-' + groupIndex;
                return <div key={position.key} className={'gd-position-group is-' + tone(position.delta)} data-position={position.key}>
                    <button type="button" className={'gd-position-row is-' + tone(position.delta) + (actualMode ? ' is-actual' : '')} aria-expanded={open} aria-controls={detailId} aria-label={(open ? 'Hide ' : 'Show ') + position.key.replace(/_/g, ' ') + ' player comparisons. ' + edge(position.delta)} disabled={!position.players.length} onClick={() => toggleGroup(position.key)}>
                        <strong title={position.key.replace(/_/g, ' ')}>{position.pos}</strong><span className="gd-position-value">{fmt(position.mine)}{actualMode && <small>P {fmt(position.projectedMine)}</small>}</span>
                        <span className="gd-position-bars" role="img" aria-label={position.pos + ': you ' + fmt(position.mine) + ', opponent ' + fmt(position.theirs)}><span><i style={{ width: Math.min(100, Math.max(0, position.mine || 0) / maxPosition * 100) + '%' }} /></span><span><i style={{ width: Math.min(100, Math.max(0, position.theirs || 0) / maxPosition * 100) + '%' }} /></span></span>
                        <span className="gd-position-value">{fmt(position.theirs)}{actualMode && <small>P {fmt(position.projectedTheirs)}</small>}</span><span className={'gd-matchup-edge is-' + tone(position.delta)}>{edge(position.delta)}</span><span className="gd-position-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
                    </button>
                    <div className="gd-position-players" id={detailId} hidden={!open}>
                        {open && position.players.map((row, index) => <div key={row.index} data-slot-index={row.index} data-slot={row.slot} className={'gd-matchup-slot is-' + tone(row.delta) + (row.delta != null && Math.abs(row.delta) <= 2 ? ' is-close' : '') + (largest > 0 && Math.abs(row.delta) === largest ? ' is-key' : '')}>
                            <strong className="gd-matchup-slot-label">{row.slot.replace(/_/g, ' ')}{position.players.length > 1 ? ' ' + (index + 1) : ''}</strong>
                            <div className="gd-matchup-player gd-matchup-you"><small>You{actualMode && <em>{playerStateLabel(row, 'my')}</em>}</small><span>{row.myReported === false ? 'Not reported' : row.myPid ? pmeta(row.myPid).name : 'Empty slot'}</span>{playerNumber(row, 'my')}</div>
                            <span className={'gd-matchup-edge is-' + tone(row.delta)}>{edge(row.delta)}</span>
                            <div className="gd-matchup-player gd-matchup-them"><small>Opponent{actualMode && <em>{playerStateLabel(row, 'their')}</em>}</small><span>{row.theirReported === false ? 'Not reported' : row.theirPid ? pmeta(row.theirPid).name : 'Empty slot'}</span>{playerNumber(row, 'their')}</div>
                        </div>)}
                    </div>
                </div>;
            })}</div>
            {!compact && <p className="gd-matchup-key">Green: your edge · Red: their edge · Gold outline: within 2 pts{rows.some(row => row.delta == null) ? empirical ? ' · Some benchmarks unavailable' : ' · Some projections unavailable' : ''}</p>}
        </React.Fragment> : upgrade}
    </section>;
}

// Viewing another game never mounts the planner or changes the managed roster.
function LineupTab(props) {
    return props.matchupTarget
        ? <window.LeagueMatchupView {...props} key={[props.matchupTarget.leagueId, props.matchupTarget.season, props.matchupTarget.week, ...(Array.isArray(props.matchupTarget.rosterIds) ? props.matchupTarget.rosterIds : [])].join('|')} />
        : <MyLineupTab {...props} />;
}

function MyLineupTab({
    myRoster, currentLeague, leagueSkin, playersData, statsData, stats2025Data, statsSeason,
    sleeperUserId, gmStrategy, setActiveTab, timeRecomputeTs, rosterView = false, initialView = 'week',
}) {
    const metricPreference = window.WR?.PlayerMetrics?.useMetrics(sleeperUserId, currentLeague?.league_id || currentLeague?.id);
    const WP = window.App && window.App.WeeklyProj;
    const SS = window.App && window.App.StartSit;
    const normPos = (window.App && window.App.normPos) || (p => p);
    // Partial free/Pro gate (owner ruling 2026-07-05): FREE keeps the manual
    // builder, raw per-player projections, bye listing and the MFL push
    // (incl. pre-season building). PRO = the optimizer layer: optimal
    // hero/delta, floor–ceiling bands, matchup grades, win %, opponent
    // strength, bye recs, the Alex note. Supersedes the old whole-tab
    // STARTSIT_DEPTH gate.
    const pro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
    // This context is display-only. It never changes the planner's projections,
    // working assignments, submission payload or captured pregame forecasts.
    const matchupBenchmarkContext = { league: currentLeague, players: playersData, statsData,
        statsSeason: statsSeason ?? currentLeague?.season, revision: timeRecomputeTs, userId: sleeperUserId };
    const GatedRow = window.WrGatedMoreRow;
    const STARTSIT_FEAT = (window.FEATURES && window.FEATURES.STARTSIT_DEPTH) || 'startsit_depth';
    const [ctxTick, setCtxTick] = React.useState(0); // bumps when NFL matchup context (opponent/weather/odds) loads
    const Live = window.App && window.App.LeagueLiveScores;
    const liveWeek = Math.max(1, Math.min(18, Number(Live?.currentWeek?.(currentLeague) || WP?.currentWeek?.() || 1)));
    const leagueScope = [currentLeague?.league_id || currentLeague?.id || '', currentLeague?.season || '', myRoster?.roster_id || ''].join('|');
    const [weekChoice, setWeekChoice] = React.useState({ scope: leagueScope, week: liveWeek });
    const planningWeek = weekChoice.scope === leagueScope ? Math.max(liveWeek, Math.min(18, Number(weekChoice.week) || liveWeek)) : liveWeek;
    const isFutureWeek = planningWeek > liveWeek;
    const planKey = 'wr-lineup-plan-v1|' + leagueScope + '|' + planningWeek;
    const [draftPlans, setDraftPlans] = React.useState({});
    const readSavedPlan = () => {
        try {
            const saved = JSON.parse(window.localStorage?.getItem(planKey) || 'null');
            return saved && !Array.isArray(saved) && typeof saved === 'object' ? saved : null;
        } catch (_) { return null; }
    };

    React.useEffect(() => {
        const refreshForm = event => {
            const id = currentLeague?.id || currentLeague?.league_id;
            if (event.detail?.leagueId != null && String(event.detail.leagueId) !== String(id)) return;
            setCtxTick(tick => tick + 1);
        };
        window.addEventListener('wr:weekly-points-loaded', refreshForm);
        const refreshProjections = event => {
            if (event.detail?.week != null && Number(event.detail.week) !== planningWeek) return;
            if (event.detail?.season != null && String(event.detail.season) !== String(currentLeague?.season)) return;
            setCtxTick(tick => tick + 1);
        };
        window.addEventListener('wr:projections-loaded', refreshProjections);
        return () => {
            window.removeEventListener('wr:weekly-points-loaded', refreshForm);
            window.removeEventListener('wr:projections-loaded', refreshProjections);
        };
    }, [currentLeague?.id, currentLeague?.league_id, currentLeague?.season, planningWeek]);

    const result = React.useMemo(() => {
        if (!WP || !myRoster || !currentLeague) return null;
        try {
            return WP.optimalForRoster(myRoster, currentLeague, {
                playersData, statsData, priorData: stats2025Data, week: planningWeek,
            });
        } catch (e) { if (window.wrLog) window.wrLog('lineup.compute', e); return null; }
    }, [myRoster, currentLeague, playersData, statsData, timeRecomputeTs, ctxTick, planningWeek]);

    const liveScores = Live ? Live.useScores({ league: currentLeague, week: planningWeek }) : { rows: [], status: 'unavailable', supported: false };
    const liveRow = (liveScores.rows || []).find(r => String(r.roster_id) === String(myRoster && myRoster.roster_id));
    const platformStarters = liveRow && Array.isArray(liveRow.starters) ? liveRow.starters : ((myRoster && myRoster.starters) || []);
    const [nflGames, setNflGames] = React.useState({ key: '', games: [], updatedAt: 0 });
    const liveKey = leagueScope + '|' + planningWeek;
    React.useEffect(() => {
        let alive = true, busy = false;
        const NC = window.App && window.App.NflContext;
        const refresh = async () => {
            if (busy || !NC || !NC.loadScores || document.hidden) return;
            busy = true;
            try {
                const games = await NC.loadScores(planningWeek, currentLeague && currentLeague.season, 2);
                if (alive && games && games.length) setNflGames({ key: liveKey, games, updatedAt: Date.now() });
            } finally { busy = false; }
        };
        refresh();
        const timer = setInterval(refresh, 30000);
        document.addEventListener('visibilitychange', refresh);
        return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [liveKey]);
    const games = nflGames.key === liveKey ? nflGames.games : [];
    const statusOfGame = game => window.App?.NflContext?.gameStatus?.(game) || 'unknown';
    const gameFor = pid => {
        const aliases = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
        const raw = String(playersData?.[pid]?.team || '').toUpperCase();
        const team = aliases[raw] || raw;
        return games.find(g => g.home === team || g.away === team);
    };
    const gameState = pid => statusOfGame(gameFor(pid));
    const gameKickoffLabel = game => {
        const kickoff = Date.parse(game?.kickoff || '');
        if (!Number.isFinite(kickoff)) return null;
        return new Date(kickoff).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    };
    const gamesFresh = nflGames.key === liveKey && Date.now() - nflGames.updatedAt < 90000;
    const weekStarted = games.some(g => ['live', 'final', 'locked'].includes(statusOfGame(g)));
    const optimizerAvailable = gamesFresh && games.length > 0 && !weekStarted
        && games.every(g => statusOfGame(g) === 'upcoming')
        && ((myRoster && myRoster.players) || []).filter(pid => result?.projections?.[pid]?.available !== false).every(pid => gameState(pid) === 'upcoming');
    const isByePlayer = pid => result?.projections?.[pid]?.injuryStatus === 'BYE'
        || Number(window.App?.NFLByes?.weekForPlayer?.(playersData?.[pid], currentLeague?.season) || playersData?.[pid]?.bye_week) === planningWeek;
    const canChangePlayer = pid => !pid || (isFutureWeek
        ? !['live', 'final', 'locked'].includes(gameState(pid))
        : gamesFresh && (gameState(pid) === 'upcoming' || isByePlayer(pid)));

    const [formWindow, setFormWindow] = React.useState(5); // rolling-PPG window: 3 | 5 | 8 | 'season'
    const [openSlot, setOpenSlot] = React.useState(null);  // slot idx whose picker is expanded
    const [applyOpen, setApplyOpen] = React.useState(false);      // phone-only: WR.ActionBar apply/push sheet (inert off-phone)
    const [phoneView, setPhoneView] = React.useState(initialView === 'matchup' ? 'matchup' : 'week');
    const [phoneSortChoice, setPhoneSortChoice] = React.useState({ scope: '', key: null, dir: -1 });
    const [pickerSortChoice, setPickerSortChoice] = React.useState({ scope: '', key: null, dir: -1 });
    const [appliedMoves, setAppliedMoves] = React.useState(null); // phone: swap list shown after Apply Optimal ({sl,cur,opt,gain}[])
    const [explainPid, setExplainPid] = React.useState(null);     // "why this number" ledger target (Pro; tap a projection)
    // Game Day view (owner ruling 2026-07-30: Season Odds belongs here, not in
    // Analytics). Phone: This Week | Season | Odds. Desktop already shows the
    // season rail alongside the lineup, so it only needs This Week | Odds.
    const [gdView, setGdView] = React.useState('week');           // 'week' | 'odds' (desktop) — phone adds 'season' via phoneView
    React.useEffect(() => {
        setPhoneView(initialView === 'matchup' ? 'matchup' : 'week');
        setGdView('week');
        if (initialView === 'matchup') window.scrollTo?.({ top: 0, left: 0, behavior: 'instant' });
    }, [initialView, leagueScope]);
    // Projected record from the Season Odds simulation, when it has run. The
    // rail prefers this over schedule-engine's per-week sum so Game Day never
    // prints two different projected records on one screen.
    const [simSummary, setSimSummary] = React.useState(null);
    const onSimSummary = React.useCallback(s => setSimSummary(s), []);

    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)', AMBER = 'var(--k-f0a500, #f0a500)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    // Shared viewport seam (js/shared/viewport.js). isNarrow (≤900, threshold
    // unchanged) collapses the right rail below the main column; isPhone (<768)
    // drives the phone column-set + touch sizing — the tablet (768–1023) and
    // desktop (≥1024) tiers render exactly as before.
    const _vp = window.WR.useViewport();
    const isNarrow = _vp.width <= 900;
    const isPhone = !!_vp.isPhone;
    // Phone micro-type floor (plan D7): sub-0.65rem labels read at ~9px — lift
    // them to 0.7rem at the phone tier only; other tiers get the exact literal.
    const fz = s => (isPhone && parseFloat(s) < 0.65 ? '0.7rem' : s);
    // Free drops the Mtch column (A–F matchup grade is a Pro interpretation).
    // Phone drops the Form/Hi/Lo columns so rows fit 375px with no horizontal
    // scroll — form stats resurface inside the row-tap expand instead.
    const GRID = isPhone
        ? (pro ? '50px minmax(0,1fr) 54px 34px' : '50px minmax(0,1fr) 54px')
        : (pro ? '50px minmax(0,1fr) 58px 50px 48px 38px 38px' : '50px minmax(0,1fr) 58px 48px 38px 38px');
    const SLOT_DISPLAY_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, REC_FLEX: 5, FLEX: 6, WRTQ: 7, SUPER_FLEX: 8, K: 20, DEF: 21, IDP_FLEX: 30, DL: 31, LB: 32, DB: 33, WILDCARD: 40 };
    const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);

    function pmeta(pid) {
        const p = (playersData && playersData[pid]) || {};
        const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(pid);
        return { name, pos: normPos(p.position) || p.position || '',
            positionLabel: window.App?.idpPositionFamily?.(p.position) ? String(p.position).toUpperCase() : null, team: p.team || '' };
    }
    const weekNavigator = <div className="gd-week-nav" aria-label="Lineup week navigation">
        <button type="button" aria-label="Previous lineup week" disabled={planningWeek <= liveWeek} onClick={() => setWeekChoice({ scope: leagueScope, week: planningWeek - 1 })}>‹</button>
        <label><span>Lineup week</span><select aria-label="Lineup week" aria-describedby="gd-lineup-week-context" value={planningWeek} onChange={event => setWeekChoice({ scope: leagueScope, week: Number(event.target.value) })}>
            {Array.from({ length: 19 - liveWeek }, (_, index) => liveWeek + index).map(week => <option key={week} value={week}>{isPhone ? 'Wk ' : 'Week '}{week}{week === liveWeek ? (isPhone ? ' · Current' : ' · This week') : ''}</option>)}
        </select><small id="gd-lineup-week-context">{isFutureWeek ? 'Future lineup · saved on this device' : 'This week’s lineup'}</small></label>
        <button type="button" aria-label="Next lineup week" disabled={planningWeek >= 18} onClick={() => setWeekChoice({ scope: leagueScope, week: planningWeek + 1 })}>›</button>
    </div>;
    const gradeColor = g => (g === 'A' ? GREEN : g === 'B' ? GOLD : g === 'C' ? SILVER : g === 'D' ? AMBER : RED);

    // ── Starting slots (aligned with roster.starters order) + display order ──
    const startingSlots = React.useMemo(() => {
        if (!SS) return [];
        const out = [];
        let k = 0;
        (currentLeague && currentLeague.roster_positions || []).forEach(raw => {
            const s = SS.normSlot(raw);
            if (BENCH.has(s)) return;
            const elig = SS.FLEX_ALLOWED[s] || (SS.BASE_POSITIONS.has(s) ? [s] : null);
            if (!elig) { k++; return; } // unknown starting slot — keep starters[] alignment
            out.push({ idx: k, slotName: s, elig });
            k++;
        });
        return out;
    }, [currentLeague]);

    // Current lineup from the platform (roster.starters aligns with non-bench slots).
    const currentAssign = React.useMemo(() => {
        const arr = platformStarters;
        const cur = {};
        startingSlots.forEach(sl => { const pid = arr[sl.idx]; if (pid && String(pid) !== '0') cur[sl.idx] = String(pid); });
        return cur;
    }, [platformStarters.join(','), startingSlots]);

    // Plans belong to a league, roster and week. A future plan starts with the
    // available submitted lineup, then survives week switches and page reloads.
    // Drop stale roster members/invalid slots instead of resurrecting an old move.
    const cleanPlan = plan => {
        const next = {}, seen = new Set();
        const active = new Set((myRoster?.players || []).map(String));
        const reserves = new Set([...(myRoster?.reserve || []), ...(myRoster?.taxi || [])].map(String));
        startingSlots.forEach(sl => {
            const pid = plan?.[sl.idx] == null ? '' : String(plan[sl.idx]);
            if (!pid || !active.has(pid) || reserves.has(pid) || seen.has(pid)) return;
            if (!sl.elig.includes(pmeta(pid).pos)) return;
            next[sl.idx] = pid; seen.add(pid);
        });
        return next;
    };
    const draftAssign = cleanPlan(draftPlans[planKey] ?? readSavedPlan() ?? currentAssign);
    function setWorkingAssign(update) {
        setDraftPlans(plans => {
            const before = cleanPlan(plans[planKey] ?? readSavedPlan() ?? currentAssign);
            const next = cleanPlan(typeof update === 'function' ? update(before) : update);
            try { window.localStorage?.setItem(planKey, JSON.stringify(next)); } catch (_) { /* The in-memory plan remains usable. */ }
            return { ...plans, [planKey]: next };
        });
    }

    // Submitted slots win at kickoff, even if a local draft benched or moved
    // that player earlier. Never treat an unsubmitted draft as live scoring.
    const workingAssign = { ...draftAssign };
    const lockedSubmitted = new Set(Object.values(currentAssign).filter(pid => !canChangePlayer(pid)));
    startingSlots.forEach(sl => {
        const submitted = currentAssign[sl.idx];
        const planned = workingAssign[sl.idx];
        if (submitted && lockedSubmitted.has(submitted)) workingAssign[sl.idx] = submitted;
        else if (planned && (!canChangePlayer(planned) || lockedSubmitted.has(planned))) {
            if (submitted) workingAssign[sl.idx] = submitted;
            else delete workingAssign[sl.idx];
        }
    });

    const formWinLabel = formWindow === 'season' ? 'SZN' : 'L' + formWindow;
    const formOf = pid => WP?.formStats?.(pid, formWindow);
    const formPts = pid => {
        const value = formOf(pid)?.rollingPPG;
        return Number.isFinite(value) ? value : null;
    };
    const injuryOf = pid => result?.projections?.[pid]?.injuryStatus || playersData?.[pid]?.injury_status || '';
    const byForm = (a, b) => (formPts(b) ?? -Infinity) - (formPts(a) ?? -Infinity);
    // Use actual league-scored history directly. Projection injury discounts,
    // matchup multipliers, and GM strategy must not reorder rolling averages.
    const formOptimal = React.useMemo(() => {
        if (!SS?.optimalLineupWeekly) return { starters: [], total: 0 };
        const reserves = new Set([...(myRoster?.reserve || []), ...(myRoster?.taxi || [])].map(String));
        const pool = (myRoster?.players || []).map(String).filter(pid => !reserves.has(pid)).map(pid => ({
            pid, pos: pmeta(pid).pos, pts: formPts(pid),
            available: result?.projections?.[pid]?.available !== false && SS.availability(injuryOf(pid)).available && gameState(pid) === 'upcoming',
        }));
        return SS.optimalLineupWeekly(pool, currentLeague?.roster_positions || []);
    }, [myRoster, currentLeague, playersData, result, formWindow, ctxTick, nflGames]);
    const formComplete = startingSlots.length > 0 && formOptimal.starters.length === startingSlots.length;
    const canOptimize = optimizerAvailable && formComplete;
    const missingPlanForm = startingSlots.some(sl => formPts(workingAssign[sl.idx]) == null);
    const objPts = pid => formPts(pid) ?? 0;
    const workingTotal = Object.values(workingAssign).filter(Boolean).reduce((sum, pid) => sum + objPts(pid), 0);
    const optimalTotal = formOptimal.total;
    const benchPts = Math.round((optimalTotal - workingTotal) * 10) / 10;
    const planUnavailable = Object.values(workingAssign).some(pid => result?.projections?.[pid]?.available === false || SS?.availability?.(injuryOf(pid))?.available === false);
    const isOptimal = formComplete && !missingPlanForm && benchPts <= 0.05
        && !planUnavailable;
    const formHelp = !optimizerAvailable ? 'Auto-fill is paused while games are underway or kickoff status is unverified.'
        : !formComplete ? 'More eligible players with game history are needed to auto-fill every slot. You can still set slots manually.'
        : 'Auto-fill and replacements use ' + formWinLabel + ' PPG. Doubtful and questionable players stay ranked by average; review their injury flags.';
    function applyOptimal() {
        if (!pro || !canOptimize) return;
        const byName = {};
        formOptimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
        const next = {};
        startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) next[sl.idx] = String(arr.shift()); });
        setWorkingAssign(next); setOpenSlot(null);
    }

    // Provider refreshes must not wipe a saved plan. Submitted-player locks are
    // reconciled above; changing the week only closes the old week's picker.
    const lineupKey = liveKey + '|' + platformStarters.join(',');
    React.useEffect(() => { setOpenSlot(null); setApplyOpen(false); setAppliedMoves(null); }, [planKey]);

    // Load real NFL matchup context (opponent + Vegas implied total/spread +
    // weather) for the selected week, then recompute projections once it lands.
    React.useEffect(() => {
        const NC = window.App && window.App.NflContext;
        if (!NC || (!NC.load && !NC.loadCurrent)) return;
        let alive = true;
        const load = NC.load ? NC.load([planningWeek], currentLeague && currentLeague.season) : !isFutureWeek ? NC.loadCurrent(currentLeague && currentLeague.season) : Promise.resolve({});
        Promise.resolve(load).then(map => {
            if (alive && map && Object.keys(map).length) setCtxTick(t => t + 1);
        }).catch(() => {});
        return () => { alive = false; };
    }, [lineupKey]);

    // ── Weekly opponent (head-to-head): resolve, project, forecast ──
    const [oppRosterId, setOppRosterId] = React.useState(null);
    React.useEffect(() => {
        const M = window.App && window.App.Matchup;
        if (!M || !myRoster || !currentLeague) return;
        let alive = true; setOppRosterId(null);
        M.resolveOpponentRosterId({ league: currentLeague, myRosterId: myRoster.roster_id, week: planningWeek })
            .then(id => { if (alive) setOppRosterId(id != null ? String(id) : null); })
            .catch(() => {});
        return () => { alive = false; };
    }, [lineupKey]);
    const oppResult = React.useMemo(() => {
        if (!WP || !oppRosterId || !currentLeague) return null;
        const oppRoster = (currentLeague.rosters || []).find(r => String(r.roster_id) === String(oppRosterId));
        if (!oppRoster) return null;
        try { return { roster: oppRoster, res: WP.optimalForRoster(oppRoster, currentLeague, { playersData, statsData, priorData: stats2025Data, objective: 'median', week: planningWeek }) }; }
        catch (e) { if (window.wrLog) window.wrLog('lineup.oppProject', e); return null; }
    }, [oppRosterId, currentLeague, playersData, statsData, timeRecomputeTs, ctxTick, planningWeek]);

    // ── Game Day Central: DvP, season schedule rail, Alex note, MFL push ──
    const [seasonData, setSeasonData] = React.useState(null);
    const [note, setNote] = React.useState('');
    // Game-plan expansion — one-shot follow-up on the ambient note (replaced
    // the old "ASK" chat handoff). Reuses the same AlexVoice.enhance()
    // template-first pattern the note itself already uses.
    const [gameplanTake, setGameplanTake] = React.useState(null); // null | {loading} | {text}
    async function askGameplanTake() {
        if (!optimizerAvailable || typeof window.AlexVoice?.enhance !== 'function') return;
        setGameplanTake({ loading: true });
        const facts = buildNoteFacts();
        if (!facts) { setGameplanTake(null); return; }
        const text = await window.AlexVoice.enhance({
            type: 'start-sit',
            message: 'Give me a fuller game-plan for this week in 3-4 sentences — the start/sit calls worth a second look, where I can attack this matchup, and what would change your read before kickoff. Natural prose, no lists, no sign-off.',
            context: JSON.stringify(facts.ctx),
            fallback: null,
            cacheKey: 'gd-plan-v1-' + lineupKey + '-w' + facts.week,
        });
        setGameplanTake(text ? { text } : null);
    }
    const [submit, setSubmit] = React.useState({ status: 'idle', msg: '' });
    // Real DvP: spin up the SOS engine (18-week defense-vs-position rankings),
    // then bump ctxTick so projections recompute with matchup context applied.
    React.useEffect(() => {
        const SOS = window.App && window.App.SOS;
        if (!SOS || !SOS.initialize) return;
        let alive = true;
        SOS.initialize(currentLeague && currentLeague.season, playersData, () => { if (alive) setCtxTick(t => t + 1); });
        return () => { alive = false; };
    }, [lineupKey]);

    // Full-season schedule + win projection for the right rail. Wait until the
    // main projection is ready (non-zero) before building/caching — otherwise an
    // early run (stats prop not yet populated) would cache an all-zero season.
    const _projReady = !!(result && result.optimal && result.optimal.total > 0);
    React.useEffect(() => {
        const Sch = window.App && window.App.Schedule;
        if (!Sch || !Sch.buildSeason || !myRoster || !currentLeague || !_projReady) return;
        let alive = true;
        Sch.buildSeason({ league: currentLeague, myRoster, playersData, statsData, stats2025Data })
            .then(d => { if (alive && d) setSeasonData(d); })
            .catch(() => {});
        return () => { alive = false; };
    }, [lineupKey, ctxTick, _projReady]);

    // Alex's game-day note: a stable weekly briefing off the CURRENT lineup +
    // matchup (not the working edits). Seeded template renders instantly; AI
    // upgrades it in the background when reachable (falls back to the template).
    function buildNoteFacts() {
        if (!result || !result.optimal) return null;
        const proj = result.projections;
        const curIds = Object.values(currentAssign).filter(Boolean);
        // MFL never exposes platform starters (starters:[]) — fall back to the
        // optimal lineup so the note forecasts the same lineup as the hero.
        // With the fallback there IS no visible bench gap: benchPts reads 0 and
        // no upgrade is pitched (a delta vs an empty platform lineup would
        // claim the whole optimal total is "stranded on the bench").
        const noPlatformLineup = !curIds.length;
        const noteIds = noPlatformLineup ? formOptimal.starters.map(s => String(s.pid)) : curIds;
        const curTotal = noteIds.reduce((s, pid) => s + objPts(pid), 0);
        const benchPts = noPlatformLineup || !formComplete || noteIds.some(pid => formPts(pid) == null) ? 0 : Math.round((formOptimal.total - curTotal) * 10) / 10;
        let topStart = null;
        if (!noPlatformLineup) formOptimal.starters.filter(s => !curIds.includes(String(s.pid))).forEach(s => { if (!topStart || s.pts > topStart.pts) topStart = s; });
        let winPct = null, oppName = null, margin = null;
        const M = window.App && window.App.Matchup;
        if (M && oppResult && oppResult.res) {
            const oppOpt = oppResult.res.optimal.starters.map(s => s.pid);
            const fc = M.forecast(M.dist(noteIds, proj, 'median'), M.dist(oppOpt, oppResult.res.projections, 'median'));
            winPct = fc.winPct; margin = fc.margin;
            const users = (currentLeague && currentLeague.users) || [];
            const u = users.find(x => String(x.user_id) === String(oppResult.roster.owner_id));
            oppName = (oppResult.roster.metadata && oppResult.roster.metadata.team_name) || (u && u.display_name) || ('Team ' + oppResult.roster.roster_id);
        }
        const injuries = noteIds.map(pid => { const p = proj[pid]; const st = p && p.injuryStatus; return st ? { name: pmeta(pid).name, status: st } : null; }).filter(Boolean);
        const topName = topStart ? pmeta(topStart.pid).name : null;
        const byeWatch = (seasonData && seasonData.byeWatch) || [];
        const topBye = byeWatch.length ? byeWatch[0] : null;   // worst upcoming bye week
        return {
            week: result.week, benchPts, topStart, topName, winPct, oppName, margin, injuries, mode: result.mode, topBye,
            ctx: { week: result.week, winPct, margin, opponent: oppName, pointsLeftOnBench: benchPts, topUpgrade: topName, topUpgradeSlot: topStart ? topStart.slot : null, injuries: injuries.map(i => i.name + ' (' + i.status + ')'), byeWatch: byeWatch.slice(0, 3).map(b => ({ week: b.week, count: b.count, unfilled: b.unfilled, reason: b.reason, positions: b.positions })), objective: formWinLabel + ' rolling PPG (not weekly projections)', mode: result.mode },
        };
    }
    function seededNote(f) {
        const AV = window.AlexVoice;
        if (!AV) return '';
        const seed = (currentLeague && (currentLeague.league_id || currentLeague.id) || '') + '|w' + f.week;
        let lead;
        if (f.winPct != null && f.oppName) {
            // Thresholds match the hero's win% coloring: ≥55 favored, ≤45 uphill.
            if (f.winPct >= 55) lead = AV.pick(seed + 'a', ['You’re favored this week', 'The numbers like your side', 'You’ve got the edge this week']) + ' — about ' + f.winPct + '% to beat ' + f.oppName + '.';
            else if (f.winPct > 45) lead = AV.pick(seed + 'a', ['Coin-flip week', 'This one’s tight', 'Dead heat']) + ' against ' + f.oppName + ' (~' + f.winPct + '%).';
            else lead = AV.pick(seed + 'a', ['Uphill week', 'You’re the underdog', 'Tough draw']) + ' vs ' + f.oppName + ' (~' + f.winPct + '%) — chase ceiling.';
        } else {
            lead = AV.pick(seed + 'a', ['Let’s set the week', 'Here’s your week', 'Locking in the lineup']) + '.';
        }
        let mid;
        if (f.benchPts >= 1 && f.topName) mid = ' ' + AV.pick(seed + 'b', ['You’re leaving ' + f.benchPts + ' ' + formWinLabel + ' PPG on the bench', 'There’s ' + f.benchPts + ' ' + formWinLabel + ' PPG sitting on your bench', f.benchPts + ' ' + formWinLabel + ' PPG are on the bench']) + ' — ' + f.topName + (f.topStart && f.topStart.slot ? ' into your ' + String(f.topStart.slot).replace('_', ' ') : '') + ' is the move.';
        else mid = ' ' + AV.pick(seed + 'b', ['Lineup’s optimal', 'Nothing left on the table', 'Your best is already in']) + ' — no changes needed.';
        let tail = '';
        if (f.injuries && f.injuries.length) tail = ' ' + AV.pick(seed + 'c', ['Keep an eye on', 'Watch', 'Monitor']) + ' ' + AV.joinNatural(f.injuries.map(i => i.name)) + '.';
        let byeTail = '';
        if (f.topBye && (f.topBye.unfilled || f.topBye.count >= 2)) {
            const b = f.topBye;
            // Only blame byes when bye starters actually drive the hole —
            // count===0 means a roster gap (position unrostered / players OUT).
            const byeDriven = b.reason ? b.reason === 'bye' : b.count > 0;
            if (byeDriven) {
                const c = {}; (b.positions || []).forEach(p => { c[p] = (c[p] || 0) + 1; });
                const posLabel = Object.keys(c).map(p => c[p] > 1 ? c[p] + ' ' + p + 's' : p).join(' + ');
                byeTail = ' ' + AV.pick(seed + 'd', ['Bye watch —', 'Plan ahead —', 'Down the road —']) + ' Week ' + b.week + (b.unfilled ? ' leaves a hole' : ' you’re thin') + (posLabel ? ' at ' + posLabel : '') + ', so line up cover.';
            } else if (b.unfilled) {
                byeTail = ' ' + AV.pick(seed + 'd', ['Plan ahead —', 'Heads up —', 'Down the road —']) + ' Week ' + b.week + ' you can’t field a full lineup as rostered, so line up cover.';
            }
        }
        return (lead + mid + tail + byeTail).trim();
    }
    React.useEffect(() => {
        // Composed note guard: the seeded copy is itself a rec ("X is the
        // move"), so the whole note is Pro-only — free renders no note (and
        // never builds facts, so no optimizer output is computed for free).
        // Future format carve-outs (cross-track C5) compose in here, e.g.
        // `pro && isDynastyFormat`. The AV.enhance AI upgrade below is
        // additionally behind hasAmbientAI() (ambient-AI policy seam) — a Pro
        // user without AI still keeps the seeded template.
        const noteAllowed = pro && optimizerAvailable && !rosterView;
        if (!noteAllowed) { setNote(''); return; }
        if (!_projReady) return;                 // wait for real projections (avoid a stale AI-note cache)
        const facts = buildNoteFacts();
        if (!facts) { setNote(''); return; }
        const seeded = seededNote(facts);
        setNote(seeded);
        let alive = true;
        const AV = window.AlexVoice;
        if (AV && AV.enhance && (typeof AV.hasAmbientAI !== 'function' || AV.hasAmbientAI())) {
            // Bucket win% into the cache key so a materially different matchup
            // outlook re-generates rather than reusing an early note. v2: the
            // facts source changed to rolling PPG — don't let notes
            // cached off the old empty-lineup facts survive the fix.
            const wpBucket = facts.winPct == null ? 'na' : Math.round(facts.winPct / 10);
            AV.enhance({
                type: 'start-sit',
                message: 'Give me a punchy 1-2 sentence game-day coaching note for my fantasy team this week. Are we favored? Any must-start upgrade sitting on the bench? Any injuries to watch, or an upcoming bye-week hole to plan for? Natural prose, no lists, no sign-off.',
                context: JSON.stringify(facts.ctx),
                fallback: seeded,
                cacheKey: 'gd-note-form-' + formWinLabel + '-' + ctxTick + '-' + lineupKey + '-w' + facts.week + '-' + wpBucket + (facts.topBye ? '-b' + facts.topBye.week + (facts.topBye.unfilled ? 'x' : '') : ''),
            }).then(txt => { if (alive && txt && typeof txt === 'string') setNote(txt); }).catch(() => {});
        }
        return () => { alive = false; };
    }, [lineupKey, ctxTick, oppRosterId, _projReady, seasonData, optimizerAvailable, formWindow, formComplete]);

    // Invalidate the game-plan expansion on the same signals the note above
    // regenerates on — otherwise a stale plan for last week or a different
    // league keeps showing, with the trigger button permanently hidden and
    // no way to refresh it.
    React.useEffect(() => { setGameplanTake(null); }, [lineupKey, ctxTick, oppRosterId, _projReady, seasonData, optimizerAvailable, formWindow, formComplete]);

    // MFL is the only platform with a public lineup-write API (Sleeper has none).
    const _plat = (window.App && window.App.Matchup && window.App.Matchup._platform) ? window.App.Matchup._platform(currentLeague) : 'sleeper';
    const isMfl = _plat === 'mfl';
    const mflApiKey = (window.S && window.S._mflApiKey) || (function () { try { return sessionStorage.getItem('mfl_api_key') || localStorage.getItem('mfl_api_key'); } catch (e) { return null; } })();

    // MFL requires a login COOKIE (not the API key) to set a lineup. Keep only the
    // session token (sessionStorage, cleared on tab close); the password is used
    // once to obtain it and never stored.
    const [mflCookie, setMflCookie] = React.useState(() => { try { return sessionStorage.getItem('mfl_write_cookie') || ''; } catch (e) { return ''; } });
    const [mflHost, setMflHost] = React.useState(() => { try { return sessionStorage.getItem('mfl_write_host') || ''; } catch (e) { return ''; } });
    const [mflUser, setMflUser] = React.useState('');
    const [mflPass, setMflPass] = React.useState('');
    const [mflAuthBusy, setMflAuthBusy] = React.useState(false);
    const [mflAuthErr, setMflAuthErr] = React.useState('');
    async function doMflLogin() {
        if (!window.MFL || !window.MFL.mflLogin) { setMflAuthErr('MFL connector unavailable.'); return; }
        if (!mflUser || !mflPass) { setMflAuthErr('Enter your MFL username and password.'); return; }
        setMflAuthBusy(true); setMflAuthErr('');
        try {
            const yr = currentLeague.season || (window.S && window.S.mflYear);
            const out = await window.MFL.mflLogin({ username: mflUser, password: mflPass, year: yr });
            try { sessionStorage.setItem('mfl_write_cookie', out.cookie); if (out.host) sessionStorage.setItem('mfl_write_host', out.host); } catch (e) {}
            setMflCookie(out.cookie); setMflHost(out.host || ''); setMflPass('');
        } catch (e) { setMflAuthErr((e && e.message) || 'MFL login failed.'); }
        finally { setMflAuthBusy(false); }
    }
    function mflDisconnect() {
        try { sessionStorage.removeItem('mfl_write_cookie'); sessionStorage.removeItem('mfl_write_host'); } catch (e) {}
        setMflCookie(''); setMflHost(''); setSubmit({ status: 'idle', msg: '' });
    }
    async function pushToMfl() {
        if (!optimizerAvailable) { setSubmit({ status: 'error', msg: 'Set game-day changes on MFL directly so its lineup locks are enforced.' }); return; }
        const MFL = window.MFL;
        if (!MFL || !MFL.submitLineup) { setSubmit({ status: 'error', msg: 'MFL connector unavailable.' }); return; }
        // Fail closed: if any starting slot TYPE wasn't recognized (so it was
        // dropped from startingSlots), we'd under-submit and MFL's replace-all
        // would bench it. Block rather than silently overwrite.
        const trueStartCount = (currentLeague.roster_positions || []).filter(p => { const s = SS.normSlot(p); return s && !BENCH.has(s); }).length;
        if (startingSlots.length < trueStartCount) {
            setSubmit({ status: 'error', msg: 'Your lineup has a slot type we don’t fully support yet — set this lineup on MFL directly to be safe.' });
            return;
        }
        // MFL's lineup import is REPLACE-ALL: any starting slot we omit gets
        // benched. Refuse to push unless every starting slot is filled.
        const emptySlots = startingSlots.filter(sl => !workingAssign[sl.idx]);
        if (emptySlots.length) {
            // Free has no "Apply Optimal" button — don't reference it.
            setSubmit({ status: 'error', msg: 'Fill all ' + startingSlots.length + ' starting slots first — ' + emptySlots.map(s => s.slotName.replace('_', ' ')).join(', ') + ' empty. ' + (pro ? 'Tap “Apply Optimal” to fill them. ' : '') + 'MFL benches anyone left out.' });
            return;
        }
        const starterIds = startingSlots.map(sl => workingAssign[sl.idx]).filter(Boolean);
        setSubmit({ status: 'submitting', msg: '' });
        try {
            await MFL.submitLineup({
                // Prefer the league being VIEWED (session globals reflect only the
                // last-connected MFL league — matches league-detail/draft-room).
                leagueId: currentLeague._mflLeagueId || String(currentLeague.id || '').replace(/^mfl_/, '').replace(/_\d+$/, '') || (window.S && window.S.mflLeagueId),
                year: currentLeague.season || (window.S && window.S.mflYear),
                week: result.week,
                franchiseId: myRoster.roster_id,
                starterIds,
                mflByPid: myRoster._mflPlayerIds || null,
                cookie: mflCookie || undefined,
                host: mflHost || undefined,
                apiKey: mflApiKey,
            });
            setSubmit({ status: 'done', msg: 'Lineup submitted to MFL for Week ' + result.week + '.' });
        } catch (e) {
            const msg = (e && e.message) || 'MFL rejected the lineup — set it on MFL directly.';
            // If the session expired, drop the cookie so the UI prompts a reconnect.
            if (/authoriz|expired|not\s*log|logg?ed?[\s-]?in|session/i.test(msg)) mflDisconnect();
            setSubmit({ status: 'error', msg });
        }
    }

    // MFL rosters don't expose current starters (starters:[]), so the builder
    // would start all-empty. Seed the working lineup from the optimal build once
    // rolling history and kickoff status are ready, so the table starts full and the completeness guard
    // is satisfiable. (We can't show MFL's actual current starters — the rosters
    // export doesn't include them.)
    const _optReady = canOptimize;
    React.useEffect(() => {
        // Pro only: the seed IS the optimizer's optimal lineup. Free MFL
        // users start from an empty table and set slots manually (the free
        // builder experience); the push guard message tells them to fill all.
        if (!pro) return;
        if (!isMfl || !_optReady) return;
        if (Object.keys(currentAssign).length || Object.keys(workingAssign).length) return; // platform starters, or user already editing
        const byName = {};
        formOptimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
        const next = {};
        startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) next[sl.idx] = String(arr.shift()); });
        if (Object.keys(next).length) setWorkingAssign(next);
    }, [lineupKey, isMfl, _optReady]);

    const projectedPoints = pid => {
        // The existing engine recomputes as data arrives; never call this an archived pregame forecast.
        const projectionSeason = window.S?.nflState?.season || new Date().getFullYear();
        if (!result || Number(result.week) !== planningWeek || Number(currentLeague?.season) !== Number(projectionSeason) || result.projections?.[pid]?.available === false) return null;
        const value = result.projections?.[pid]?.points?.median;
        return Number.isFinite(value) ? value : null;
    };
    const Forecasts = window.App && window.App.LineupForecastSnapshots;
    const liveOpponent = liveRow?.matchup_id == null ? null : (liveScores.rows || []).find(row =>
        String(row.roster_id) !== String(liveRow.roster_id) && String(row.matchup_id) === String(liveRow.matchup_id));
    const matchedOpponentProjections = liveOpponent && String(oppResult?.roster?.roster_id) === String(liveOpponent.roster_id) ? oppResult.res?.projections : {};
    const forecastContextKey = liveKey + '|' + JSON.stringify(Object.entries(currentLeague?.scoring_settings || {}).sort(([a], [b]) => a.localeCompare(b)));
    const [forecastState, setForecastState] = React.useState(() => ({ key: forecastContextKey, data: Forecasts ? Forecasts.read(currentLeague, planningWeek) : { players: {}, persistent: false } }));
    React.useEffect(() => {
        if (!Forecasts) return;
        const projections = {}, statuses = {};
        if (gamesFresh) {
            platformStarters.forEach(pid => { projections[pid] = projectedPoints(pid); statuses[pid] = gameState(pid); });
            if (Number(currentLeague?.season) === Number(window.S?.nflState?.season || new Date().getFullYear())) (liveOpponent?.starters || []).forEach(pid => {
                const projection = matchedOpponentProjections?.[pid];
                projections[pid] = projection?.available !== false && Number.isFinite(projection?.points?.median) ? projection.points.median : null;
                statuses[pid] = gameState(pid);
            });
        }
        const data = Forecasts.capture({ league: currentLeague, week: planningWeek, projections, statuses });
        setForecastState(previous => previous.key === forecastContextKey && previous.data === data ? previous : { key: forecastContextKey, data });
    }, [forecastContextKey, result, nflGames, platformStarters.join(','), (liveOpponent?.starters || []).join(','), oppResult]);
    const savedForecasts = forecastState.key === forecastContextKey ? forecastState.data : { players: {}, persistent: true };
    const liveTotal = Live && liveRow ? Live.rosterPoints(liveRow) : null;
    // Phone scores come from the submitted matchup feed, including zero and
    // negative totals. A matchup ID is required: unrelated bye rows must never
    // become an invented opponent.
    const liveOpponentTotal = Live && liveOpponent ? Live.rosterPoints(liveOpponent) : null;
    const opponentRoster = liveOpponent && (currentLeague?.rosters || []).find(row => String(row.roster_id) === String(liveOpponent.roster_id));
    const opponentUser = opponentRoster && (currentLeague?.users || []).find(user => String(user.user_id) === String(opponentRoster.owner_id));
    const liveOpponentName = opponentRoster?.metadata?.team_name || opponentUser?.metadata?.team_name || opponentUser?.display_name || (liveOpponent ? 'Team ' + liveOpponent.roster_id : 'Opponent');
    // Review is independent from planning. Earlier weeks only read submitted
    // score rows and archived baselines; they never edit an old lineup plan.
    const [reviewChoice, setReviewChoice] = React.useState({ scope: forecastContextKey, week: planningWeek });
    const reviewWeek = reviewChoice.scope === forecastContextKey ? Math.max(1, Math.min(planningWeek, Number(reviewChoice.week) || planningWeek)) : planningWeek;
    const historicalReview = reviewWeek < liveWeek;
    const reviewKey = leagueScope + '|review|' + reviewWeek;
    const historicalScores = Live ? Live.useScores({ league: currentLeague, week: reviewWeek, enabled: reviewWeek !== planningWeek }) : { rows: [], status: 'unavailable', supported: false };
    const reviewScores = reviewWeek === planningWeek ? liveScores : historicalScores;
    const [reviewNfl, setReviewNfl] = React.useState({ key: '', games: [], updatedAt: 0 });
    React.useEffect(() => {
        if (reviewWeek === planningWeek) return undefined;
        let active = true, pending = false;
        const refresh = async () => {
            if (pending || document.hidden || !window.App?.NflContext?.loadScores) return;
            pending = true;
            try {
                const loaded = await window.App.NflContext.loadScores(reviewWeek, currentLeague?.season, 2);
                if (active && loaded?.length) setReviewNfl({ key: reviewKey, games: loaded, updatedAt: Date.now() });
            } catch (_) { /* A failed refresh cannot promote old scores to final. */ }
            finally { pending = false; }
        };
        refresh();
        const timer = setInterval(refresh, 30000);
        document.addEventListener('visibilitychange', refresh);
        return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [reviewKey, planningWeek]);
    const reviewGames = reviewWeek === planningWeek ? games : reviewNfl.key === reviewKey ? reviewNfl.games : [];
    const reviewGamesFresh = reviewWeek === planningWeek ? gamesFresh : reviewNfl.key === reviewKey && Date.now() - reviewNfl.updatedAt < 90000;
    const reviewGameState = pid => {
        const alias = team => ({ WSH: 'WAS', JAC: 'JAX', LA: 'LAR', AZ: 'ARI', OAK: 'LV', SD: 'LAC' })[String(team || '').toUpperCase()] || String(team || '').toUpperCase();
        const team = alias(playersData?.[pid]?.team);
        const game = reviewGames.find(game => alias(game.home) === team || alias(game.away) === team);
        return !game && Number(window.App?.NFLByes?.weekForPlayer?.(playersData?.[pid], currentLeague?.season)) === reviewWeek ? 'bye' : statusOfGame(game);
    };
    const reviewProjectionValues = {};
    if (reviewWeek === planningWeek && !historicalReview && Number(currentLeague?.season) === Number(window.S?.nflState?.season || new Date().getFullYear())) {
        Object.entries({ ...result?.projections, ...matchedOpponentProjections }).forEach(([pid, value]) => {
            if (value?.available !== false && Number.isFinite(value?.points?.median)) reviewProjectionValues[pid] = value.points.median;
        });
    }
    const reviewForecasts = reviewWeek === planningWeek ? savedForecasts : Forecasts?.read(currentLeague, reviewWeek) || { players: {}, persistent: false };
    const reviewComparison = window.App?.MatchupScoreComparison?.build({ league: currentLeague, week: reviewWeek, myRosterId: myRoster?.roster_id,
        rows: reviewScores.rows, scoreStatus: reviewScores.status, scoreError: reviewScores.error, scoresSupported: reviewScores.supported,
        scope: { leagueId: currentLeague?.league_id || currentLeague?.id, season: currentLeague?.season, week: reviewScores.week ?? reviewWeek },
        gamesFresh: reviewGamesFresh, gameState: reviewGameState, forecasts: reviewForecasts, projections: reviewProjectionValues,
        slots: [...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50)),
        currentWeek: liveWeek, currentSeason: window.S?.nflState?.season || new Date().getFullYear() });
    if (reviewComparison?.available) {
        const roster = (currentLeague?.rosters || []).find(row => String(row.roster_id) === String(reviewComparison.rosterIds[1]));
        const user = (currentLeague?.users || []).find(row => String(row.user_id) === String(roster?.owner_id));
        reviewComparison.oppName = roster?.metadata?.team_name || user?.metadata?.team_name || user?.display_name || (reviewWeek === planningWeek ? liveOpponentName : 'Team ' + reviewComparison.rosterIds[1]);
        reviewComparison.updatedAt = reviewScores.updatedAt;
    }
    const reviewNavigator = <div className="gd-review-navigation"><label>Matchup week<select aria-label="Matchup week" value={reviewWeek} onChange={event => setReviewChoice({ scope: forecastContextKey, week: Number(event.target.value) })}>{Array.from({ length: planningWeek }, (_, i) => i + 1).map(value => <option key={value} value={value}>Week {value}{value === liveWeek ? ' · Current' : value < liveWeek ? ' · Review' : ''}</option>)}</select></label><button type="button" disabled={!reviewScores.supported || ['loading', 'refreshing'].includes(reviewScores.status)} onClick={() => reviewScores.refresh?.()}>Refresh scores</button></div>;
    const mobileScoreStatus = liveScores.error ? 'Last available scores'
        : liveScores.status === 'loading' ? 'Loading scores'
        : !liveScores.supported ? 'Scoring unavailable'
        : weekStarted ? 'Actual points' : 'Submitted lineup · actual points';
    const trackingLineup = !isFutureWeek && (weekStarted || (liveTotal != null && liveTotal !== 0));
    // The existing Game Day lineup is the single home for planning and scores.
    function LineupLiveStatus({ pid, scoreVisible = false }) {
        if (!pid) return null;
        const game = gameFor(pid);
        const state = gameState(pid);
        if (state === 'upcoming') {
            const kickoff = gameKickoffLabel(game);
            return kickoff ? <span style={{ display: 'block', color: SILVER, fontSize: '0.75rem', marginTop: '4px' }}>{kickoff}</span> : null;
        }
        if (!trackingLineup) return null;
        const started = ['live', 'final', 'locked'].includes(state);
        const submitted = platformStarters.map(String).includes(String(pid));
        const actual = submitted && Live && liveRow ? Live.playerPoints(liveRow, pid) : null;
        const label = state === 'final' ? 'Final' : state === 'live' ? 'Live' : state === 'locked' ? 'Kickoff' : 'Status unverified';
        return <span style={{ display: 'block', color: state === 'live' ? GREEN : SILVER, fontSize: '0.75rem', marginTop: '4px' }}>
            {scoreVisible ? (started ? 'Locked' : 'Game status unverified') : <>{label}{started && submitted ? ' · ' + (Number.isFinite(actual) ? actual.toFixed(2) : '—') + ' pts' : ''}{started ? ' · Locked' : ''}</>}
        </span>;
    }
    const mobileScoreboard = (
        <section className="gd-scoreboard" aria-label="Week matchup score">
            <div className="gd-eyebrow">Week {liveWeek} · {mobileScoreStatus}</div>
            <div className="gd-scoreboard-sides">
                <div><span className="gd-team-name">Your team</span><strong>{liveTotal == null ? '—' : liveTotal.toFixed(2)}</strong></div>
                {liveOpponent ? <React.Fragment><span className="gd-versus" aria-hidden="true">vs</span><div><span className="gd-team-name">{liveOpponentName}</span><strong>{liveOpponentTotal == null ? '—' : liveOpponentTotal.toFixed(2)}</strong></div></React.Fragment> : null}
            </div>
            <div className="gd-score-update">
                <span>{liveScores.error ? 'Refresh failed · check your platform.' : liveScores.updatedAt ? 'Updated ' + new Date(liveScores.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : liveScores.supported ? 'Waiting for this week’s scoring.' : 'Follow scoring on your league platform.'}</span>
                {liveScores.supported && liveScores.refresh ? <button type="button" onClick={() => liveScores.refresh()} aria-label="Refresh scores">Refresh</button> : null}
            </div>
        </section>
    );
    const mobileScoreHelp = (
        <details className="gd-disclosure">
            <summary>Scoring &amp; lineup rules</summary>
            <div className="gd-disclosure-body">
                <p>Actual points follow your submitted lineup. Weekly projections remain estimates. A dash means unavailable.</p>
                <p>Scores refresh every 30 seconds while open; provider updates can lag. Injury tags are periodic updates, not instant alerts.</p>
                <p>A player whose game has started cannot normally be replaced. Check unstarted bench options and confirm eligibility on your league platform.</p>
                {!savedForecasts.persistent && Object.keys(savedForecasts.players).length ? <p>Browser storage is unavailable; projections are saved for this visit only.</p> : null}
            </div>
        </details>
    );
    if (rosterView) {
        const tracking = weekStarted || (liveTotal != null && liveTotal !== 0);
        const formLabel = (formWindow === 'season' ? 'SZN' : 'L' + formWindow) + ' PPG';
        const slots = startingSlots.length ? startingSlots : platformStarters.map((pid, idx) => ({ idx, slotName: 'START', elig: [] }));
        const assigned = startingSlots.length ? workingAssign : Object.fromEntries(platformStarters.map((pid, idx) => [idx, pid]));
        const used = new Set(Object.values(assigned).map(String));
        const reserves = new Set([...(myRoster?.reserve || []), ...(myRoster?.taxi || [])].map(String));
        const fmt = (value, places = 1) => Number.isFinite(value) ? value.toFixed(places) : '—';
        const statusLabel = pid => {
            const game = gameFor(pid), state = gameState(pid);
            if (state === 'final') return 'Final · Locked';
            if (state === 'live') return (game.shortDetail || 'Live') + ' · Locked';
            if (state === 'locked') return 'Kickoff · Locked';
            if (state === 'upcoming') return gameKickoffLabel(game) || 'Schedule unverified';
            return 'Game status unverified';
        };
        const selectPlayer = (slot, pid) => {
            if (!canChangePlayer(assigned[slot.idx]) || !canChangePlayer(pid)) return;
            setWorkingAssign(previous => ({ ...previous, [slot.idx]: pid }));
            setOpenSlot(null);
        };
        const metrics = (pid, submitted) => {
            const started = ['live', 'final', 'locked'].includes(gameState(pid));
            const forecast = savedForecasts.players[pid];
            const form = WP?.formStats?.(pid, formWindow);
            return <span className="roster-lineup-metrics">
                {tracking ? <span className={gameState(pid) === 'live' ? 'is-live' : ''}><strong>{fmt(submitted && gameState(pid) !== 'upcoming' && Live && liveRow ? Live.playerPoints(liveRow, pid) : null, 2)}</strong><small>Actual</small></span> : null}
                <span title={started ? forecast ? (forecast.kind === 'pregame' ? 'Pregame projection' : 'First-view projection') + ' · ' + new Date(forecast.capturedAt).toLocaleString() : 'No saved projection' : 'Weekly projection'}><strong>{fmt(started ? forecast?.points : projectedPoints(pid))}</strong><small>{started ? 'Saved proj' : 'Proj'}</small></span>
                <span><strong>{fmt(form?.rollingPPG)}</strong><small>{formLabel}</small></span>
                {!isPhone ? <React.Fragment><span><strong>{fmt(form?.high)}</strong><small>Hi</small></span><span><strong>{fmt(form?.low)}</strong><small>Lo</small></span></React.Fragment> : null}
            </span>;
        };
        return <section className="roster-lineup" aria-label="Roster starting lineup">
            <div className="roster-lineup-heading"><div><div className="gd-eyebrow">Week {liveWeek}</div><h2>Starting lineup</h2></div>
                <div className="roster-lineup-form" aria-label="Player form window">{[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(([label, value]) => <button type="button" key={label} aria-pressed={formWindow === value} onClick={() => setFormWindow(value)}>{label}</button>)}</div>
            </div>
            <p className="roster-lineup-hint">{tracking ? 'Started players are locked. You can still plan changes for later games.' : 'Plan your starters here. Live scores appear when games begin.'} {isMfl ? 'Set your final lineup on MFL.' : 'Set your final lineup on your league platform.'}</p>
            <div className="roster-lineup-actions">
                {pro ? <button type="button" className="gd-primary" disabled={!canOptimize} onClick={applyOptimal}>Apply Optimal</button> : null}
                <span>{formWinLabel} PPG · {workingTotal.toFixed(1)} lineup total{missingPlanForm ? ' · partial' : ''}</span>
            </div>
            <p className="roster-lineup-hint">{formHelp}</p>
            {tracking ? mobileScoreboard : null}
            <div className="roster-lineup-players">{[...slots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50)).map(sl => {
                const pid = assigned[sl.idx] || null;
                const meta = pid ? pmeta(pid) : { name: 'Empty slot', pos: '', team: '' };
                const editable = canChangePlayer(pid) && sl.elig.length > 0;
                const submitted = String(platformStarters[sl.idx] || '') === String(pid || '');
                const open = openSlot === sl.idx && editable;
                const options = open ? (myRoster?.players || []).map(String).filter(id => !reserves.has(id) && (!used.has(id) || id === pid) && sl.elig.includes(pmeta(id).pos) && canChangePlayer(id)).sort(byForm) : [];
                return <div className="roster-lineup-slot" key={sl.idx}>
                    <button type="button" className="roster-lineup-row" disabled={!editable} aria-expanded={open} onClick={() => setOpenSlot(open ? null : sl.idx)}>
                        <span className="roster-lineup-position">{sl.slotName.replace('_', ' ')}</span>
                        <span className="roster-lineup-player"><strong>{meta.name}</strong><LineupInjuryBadge status={injuryOf(pid)} /><small>{[meta.pos, meta.team, pid ? statusLabel(pid) : 'Choose a starter', !submitted ? 'Local plan' : null].filter(Boolean).join(' · ')}</small></span>
                        {metrics(pid, submitted)}
                        <span className="roster-lineup-edit">{editable ? '⌄' : ['live', 'final', 'locked'].includes(gameState(pid)) ? 'Locked' : 'Check'}</span>
                    </button>
                    {open ? <div className="roster-lineup-picker"><p>Eligible for {sl.slotName.replace('_', ' ')} · highest {formWinLabel} PPG first</p>{options.map(id => <button type="button" key={id} className="roster-lineup-row" onClick={() => selectPlayer(sl, id)}><span className="roster-lineup-player"><strong>{pmeta(id).name}</strong><LineupInjuryBadge status={injuryOf(id)} /><small>{pmeta(id).team} · {statusLabel(id)}</small></span>{metrics(id, false)}</button>)}
                        {pid ? <button type="button" className="roster-lineup-clear" onClick={() => selectPlayer(sl, null)}>Empty this slot</button> : null}
                        {!options.length ? <p>No eligible players with an upcoming game.</p> : null}
                    </div> : null}
                </div>;
            })}</div>
            {!slots.length ? <p className="roster-lineup-hint">Your starters will appear when your roster syncs.</p> : null}
            {tracking ? mobileScoreHelp : null}
        </section>;
    }

    // No whole-tab gate: the partial free/Pro split above (`pro`) supersedes
    // the old STARTSIT_DEPTH block — free users enter and use the manual
    // builder; only the optimizer layer is locked inline.

    if (!WP || !SS) {
        return <div style={{ padding: '24px', color: SILVER }}>Start/Sit engine not loaded.</div>;
    }
    if (!result || !result.optimal || !result.optimal.starters.length) {
        const scoreReview = reviewComparison?.available && (reviewComparison.hasStarted || reviewComparison.phase === 'past') ? <MatchupBreakdown matchup={null} comparison={reviewComparison} week={reviewWeek} pro={pro} pmeta={pmeta} compact={isPhone} reviewControls={reviewNavigator} benchmarkContext={matchupBenchmarkContext} /> : <>{reviewNavigator}<p className="gd-muted">Submitted matchup scores are unavailable for this week.</p></>;
        return (
            <div className={isPhone ? 'gd-mobile' : ''} style={{ padding: isPhone ? '14px 12px' : '20px 16px', color: SILVER, maxWidth: '1240px', margin: '0 auto' }}>
                {isPhone && <div className="wr-seg gd-view-nav" aria-label="Game Day views"><button type="button" aria-pressed={phoneView !== 'matchup'} onClick={() => setPhoneView('week')}>Lineup</button><button type="button" aria-pressed={phoneView === 'matchup'} onClick={() => setPhoneView('matchup')}>Matchup</button></div>}
                {isPhone && phoneView === 'matchup' ? scoreReview : <>
                {weekNavigator}
                {trackingLineup ? mobileScoreboard : null}
                <div style={{ padding: '32px 12px', textAlign: 'center', maxWidth: '520px', margin: '0 auto' }}>
                <div style={{ fontSize: '1.1rem', color: GOLD, fontWeight: 600, marginBottom: '10px', letterSpacing: '0.04em' }}>{isPhone ? 'Projections unavailable' : 'LINEUP COMMAND CENTER'}</div>
                <div>{isPhone ? 'Lineup planning will appear when weekly projections load.' : "No weekly projections yet. This lights up in-season once roster and stat data are synced — start/sit guidance is built from each player's role, recent form, and matchup, scored through your league's exact settings."}</div>
                </div>
                {!isPhone && scoreReview}
                </>}
            </div>
        );
    }

    const objective = result.objective;
    const projOf = pid => (pid && result.projections[pid]) || null;

    // Roster pools.
    const resSet = new Set((myRoster && myRoster.reserve) || []);
    const taxiSet = new Set((myRoster && myRoster.taxi) || []);
    const activeIds = ((myRoster && myRoster.players) || []).filter(id => id && !resSet.has(id) && !taxiSet.has(id)).map(String);
    const usedPids = new Set(Object.values(workingAssign).filter(Boolean).map(String));

    function eligibleFor(slot) {
        return activeIds
            .filter(pid => slot.elig.includes(normPos((playersData[pid] || {}).position) || (playersData[pid] || {}).position))
            .filter(pid => !usedPids.has(pid) || String(workingAssign[slot.idx]) === pid)
            .filter(pid => String(workingAssign[slot.idx]) === pid || (canChangePlayer(workingAssign[slot.idx]) && canChangePlayer(pid)))
            .sort(byForm);
    }

    // Phone: hit-padding, not bigger glyphs (plan D7) — action buttons hit 44px.
    const winBtn = active => ({ padding: isPhone ? '9px 12px' : '3px 8px', fontSize: fz('0.64rem'), fontWeight: 700, letterSpacing: '0.03em', cursor: 'pointer', borderRadius: 'var(--card-radius-xs, 5px)', border: `1px solid ${active ? GOLD : LINE}`, background: active ? 'rgba(212,175,55,0.14)' : 'transparent', color: active ? GOLD : SILVER });
    const actBtn = { padding: isPhone ? '11px 16px' : '5px 12px', minHeight: isPhone ? '44px' : undefined, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: 'var(--card-radius-xs, 5px)', border: `1px solid ${LINE}`, background: 'transparent', color: SILVER };

    function wxTag(weather) {
        if (!weather) return null;
        if (weather.indoor) return <span style={{ color: SILVER, opacity: 0.5, fontSize: fz('0.6rem'), marginLeft: '6px' }}>dome</span>;
        const d = String(weather.display || '').toLowerCase();
        let tag = null;
        if (/wind/.test(d)) tag = 'WIND';
        else if (/snow|sleet|flurr/.test(d)) tag = 'SNOW';
        else if (/rain|shower|storm/.test(d)) tag = 'RAIN';
        else if (Number.isFinite(Number(weather.temp)) && Number(weather.temp) <= 20) tag = 'COLD';
        if (!tag) return null;
        const tip = (weather.display || '') + (weather.temp != null ? ' · ' + Math.round(weather.temp) + '°' : '');
        return <span title={tip} style={{ color: AMBER, fontSize: fz('0.56rem'), fontWeight: 700, marginLeft: '6px', letterSpacing: '0.03em' }}>{tag}</span>;
    }

    // ── Player field cells (shared by slot rows, picker rows, bench rows) ──
    function PlayerCells({ pid }) {
        if (!pid) {
            return (<React.Fragment>
                <span style={{ color: SILVER, opacity: 0.6, fontStyle: 'italic' }}>Empty — tap to set</span>
                <span />{pro ? <span /> : null}{!isPhone ? <React.Fragment><span /><span /><span /></React.Fragment> : null}
            </React.Fragment>);
        }
        const meta = pmeta(pid);
        const proj = projOf(pid);
        const pts = proj && proj.points;
        const grade = (proj && proj.matchupGrade) || '—';
        const opp = proj && proj.opponent;
        const status = injuryOf(pid);
        const unavail = proj && proj.available === false;
        const fs = isPhone ? null : formOf(pid); // phone drops the form cells (shown on row-tap expand)
        const weather = proj && proj.weather;
        const num = (v, c) => <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: c || SILVER }}>{v}</span>;
        return (<React.Fragment>
            <span style={{ minWidth: 0, overflow: 'hidden' }}>
                <span style={{ color: unavail ? SILVER : TEXT, fontWeight: 500, textDecoration: unavail ? 'line-through' : 'none' }}>{meta.name}</span>
                <span style={{ color: SILVER, fontSize: '0.7rem', marginLeft: '6px' }}>{meta.pos}{meta.team ? ' · ' + meta.team : ''} · {window.App?.NFLByes?.label(playersData?.[pid], window.App.NFLByes.seasonFor(currentLeague)) || 'Bye —'}</span>
                {opp && opp.abbr ? <span style={{ color: SILVER, fontSize: '0.66rem', marginLeft: '6px', opacity: 0.85 }}>{opp.home ? 'vs ' : '@ '}{opp.abbr}</span> : null}
                {wxTag(weather)}
                <LineupInjuryBadge status={status} />
                <LineupLiveStatus pid={pid} />
            </span>
            <span style={{ textAlign: 'right', ...(pro && pts ? { cursor: 'pointer' } : {}) }}
                title={pro && pts ? 'Why this number — tap for the projection ledger' : undefined}
                onClick={pro && pts ? (e => { e.stopPropagation(); setExplainPid(pid); }) : undefined}>
                <span style={{ color: TEXT, fontWeight: 700, fontVariantNumeric: 'tabular-nums', ...(pro && pts ? { borderBottom: '1px dotted rgba(212,175,55,0.5)' } : {}) }}>{pts ? (pts[objective] || 0).toFixed(1) : '—'}</span>
                {pro && pts ? <span style={{ display: 'block', color: SILVER, opacity: 0.6, fontSize: fz('0.56rem'), fontVariantNumeric: 'tabular-nums' }}>{pts.floor.toFixed(0)}–{pts.ceiling.toFixed(0)}</span> : null}
            </span>
            {pro ? <span style={{ textAlign: 'center' }}><span title={opp && opp.abbr ? ('vs ' + opp.abbr) : ('Matchup ' + grade)} style={{ fontWeight: 700, color: gradeColor(grade), fontSize: '0.78rem' }}>{grade}</span></span> : null}
            {!isPhone ? (<React.Fragment>
                {num(Number.isFinite(fs?.rollingPPG) ? fs.rollingPPG.toFixed(1) : '—', TEXT)}
                {num(Number.isFinite(fs?.high) ? fs.high.toFixed(1) : '—', GREEN)}
                {num(Number.isFinite(fs?.low) ? fs.low.toFixed(1) : '—', SILVER)}
            </React.Fragment>) : null}
        </React.Fragment>);
    }

    // ── "Why this number" — projection ledger (Pro; tap any Proj cell) ──
    // Re-derives the projection stage by stage via WeeklyProj.explainPlayer:
    // baseline → DvP → Vegas → weather → availability — then scores the same
    // stat line under a neutral 0.5-PPR baseline. The closing line is the
    // league-scoring edge: identical stat line, your rules vs generic.
    const ledgerNode = (() => {
        if (!explainPid || !pro) return null;
        const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
        const close = () => setExplainPid(null);
        const ex = WP.explainPlayer
            ? WP.explainPlayer(explainPid, { playersData, statsData, priorData: stats2025Data, scoring: result.scoring, week: result.week })
            : null;
        const meta = pmeta(explainPid);
        const proj = projOf(explainPid);
        const pts = proj && proj.points;
        const num = v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));
        const deltaCol = d => d > 0.05 ? GREEN : d < -0.05 ? RED : SILVER;
        const band = pts && pts.ceiling > pts.floor ? Math.max(0, Math.min(1, (pts.median - pts.floor) / (pts.ceiling - pts.floor))) : 0.5;
        const content = (
            <div style={{ fontFamily: 'var(--font-body)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: TEXT, fontSize: fz('0.95rem') }}>{meta.name}</span>
                    <span style={{ color: SILVER, fontSize: fz('0.7rem') }}>{meta.pos}{meta.team ? ' · ' + meta.team : ''}{ex && ex.opponent ? ' · vs ' + ex.opponent : ''} · Wk {result.week}</span>
                </div>
                {!ex ? (
                    <div style={{ color: SILVER, fontSize: fz('0.78rem') }}>No ledger for this player yet — it needs a stat baseline or a published analyst line.</div>
                ) : (
                    <React.Fragment>
                        {ex.stages.map((s, i) => (
                            <div key={s.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 52px 52px', gap: '8px', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${LINE}` }}>
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ display: 'block', color: TEXT, fontWeight: 600, fontSize: fz('0.76rem') }}>{s.label}</span>
                                    <span style={{ display: 'block', color: SILVER, opacity: 0.75, fontSize: fz('0.62rem'), fontFamily: MONO }}>{s.detail}</span>
                                </span>
                                <span style={{ textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: deltaCol(s.delta || 0), fontSize: fz('0.72rem') }}>
                                    {i === 0 ? '' : (s.delta > 0 ? '+' : '') + num(s.delta)}
                                </span>
                                <span style={{ textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: TEXT, fontWeight: i === ex.stages.length - 1 ? 700 : 400, fontSize: fz('0.74rem') }}>{num(s.pts)}</span>
                            </div>
                        ))}
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 104px', gap: '8px', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${LINE}` }}>
                            <span>
                                <span style={{ display: 'block', color: GOLD, fontWeight: 700, fontSize: fz('0.76rem') }}>Your league's scoring</span>
                                <span style={{ display: 'block', color: SILVER, opacity: 0.75, fontSize: fz('0.62rem'), fontFamily: MONO }}>same stat line · 0.5-PPR baseline scores it {num(ex.standardPts)}</span>
                            </span>
                            <span style={{ textAlign: 'right', fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: GOLD, fontWeight: 700, fontSize: fz('0.85rem') }}>
                                {num(ex.leaguePts)} <span style={{ fontSize: fz('0.66rem'), color: ex.scoringEdge >= 0 ? GREEN : RED }}>({ex.scoringEdge > 0 ? '+' : ''}{num(ex.scoringEdge)})</span>
                            </span>
                        </div>
                        {pts ? (
                            <div style={{ marginTop: '10px' }}>
                                <div style={{ position: 'relative', height: '8px', background: '#0C0E13', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '3px' }}>
                                    <i style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, background: 'rgba(93,173,226,0.16)', borderRadius: '3px' }} />
                                    <b style={{ position: 'absolute', top: '-3px', bottom: '-3px', width: '2px', left: 'calc(' + Math.round(band * 100) + '% - 1px)', background: GOLD }} />
                                </div>
                                <div style={{ fontFamily: MONO, fontSize: fz('0.62rem'), color: SILVER, marginTop: '5px', fontVariantNumeric: 'tabular-nums' }}>
                                    {pts.floor.toFixed(1)} floor — <span style={{ color: GOLD }}>{pts.median.toFixed(1)} proj</span> — {pts.ceiling.toFixed(1)} ceiling
                                </div>
                            </div>
                        ) : null}
                        {ex.provider ? (
                            <div style={{ color: SILVER, opacity: 0.7, fontSize: fz('0.62rem'), fontFamily: MONO, marginTop: '8px' }}>
                                Anchored to the published analyst line, which already prices the matchup — DvP is not double-counted.
                            </div>
                        ) : null}
                        {/* Usage context — not part of the point ledger above, just the
                            opportunity signal (targets, red zone looks, snap share) behind
                            it, from window.App.StatCatalog off this season's raw stat line. */}
                        {(() => {
                            const SC = window.App?.StatCatalog;
                            const st = statsData[explainPid] || {};
                            if (!SC || !(st.gp > 0)) return null;
                            const pos = meta.pos;
                            const items = [];
                            const push = (key, opts) => { const v = SC.computeStat(key, st, opts); if (v != null) items.push({ stat: SC.statByKey(key), v }); };
                            if (['RB', 'WR', 'TE'].includes(pos)) { push('targets', { perGame: true }); push('rzTouches', { perGame: true }); push('snapPct'); }
                            else if (pos === 'QB') { push('rushAtt', { perGame: true }); push('cmpPct'); push('rzPassAtt', { perGame: true }); }
                            else if (['DL', 'LB', 'DB'].includes(pos)) { push('tackles', { perGame: true }); push('defSnapPct'); }
                            if (!items.length) return null;
                            return (
                                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${LINE}` }}>
                                    <div style={{ fontFamily: MONO, fontSize: fz('0.62rem'), letterSpacing: '0.06em', textTransform: 'uppercase', color: SILVER, marginBottom: '6px' }}>Usage this season</div>
                                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                                        {items.map(({ stat, v }) => (
                                            <div key={stat.key} style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontFamily: MONO, fontSize: fz('0.9rem'), fontWeight: 700, color: GOLD }}>{SC.formatStat(v, stat.format)}</span>
                                                <span style={{ fontSize: fz('0.6rem'), color: SILVER, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.short}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}
                    </React.Fragment>
                )}
            </div>
        );
        const overlay = (
            <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                <div onClick={e => e.stopPropagation()} style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '16px 18px', maxWidth: '480px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontFamily: MONO, fontSize: fz('0.66rem'), fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GOLD }}>Why this number</span>
                        <button onClick={close} style={{ marginLeft: 'auto', background: 'none', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: SILVER, cursor: 'pointer', padding: '3px 9px', fontSize: fz('0.7rem') }}>✕</button>
                    </div>
                    {content}
                </div>
            </div>
        );
        const Sheet = window.WR && window.WR.Sheet;
        return Sheet
            ? <Sheet open onClose={close} title="Why this number" desktop={overlay}>{content}</Sheet>
            : overlay;
    })();

    const projTip = 'Weekly projection using your ' + (objective === 'ceiling' ? 'ceiling (upside)' : objective === 'floor' ? 'floor (safe)' : 'median (balanced)') + ' strategy';
    const headerRow = (
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: '7px 14px', borderBottom: `1px solid ${LINE}`, fontSize: fz('0.58rem'), letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>
            <span title="Roster slot">Slot</span>
            <span title="Player · position · NFL team · this week's opponent">Player</span>
            <span title={projTip} style={{ textAlign: 'right' }}>Proj</span>
            {pro ? <span title="Matchup grade A (great) → F (tough), from the opponent's Vegas implied total" style={{ textAlign: 'center' }}>Mtch</span> : null}
            {!isPhone ? (<React.Fragment>
                <span title={'Rolling average over the last ' + (formWindow === 'season' ? 'full season' : formWindow + ' weeks') + ' (actual points)'} style={{ textAlign: 'right' }}>{formWinLabel}</span>
                <span title="Season high — most fantasy points in a week" style={{ textAlign: 'right' }}>Hi</span>
                <span title="Season low — fewest points in a played week" style={{ textAlign: 'right' }}>Lo</span>
            </React.Fragment>) : null}
        </div>
    );

    // ── Matchup forecast: your WORKING lineup vs the opponent's ideal ──
    let matchup = null;
    {
        const M = window.App && window.App.Matchup;
        // No matchup card without at least one working starter — forecasting an
        // empty lineup would read as a confident 1% off a zero-point side.
        const myStarters = Object.values(workingAssign).filter(Boolean);
        if (M && oppResult && oppResult.res && myStarters.length) {
            const oppProj = oppResult.res.projections;
            const oppOpt = oppResult.res.optimal.starters;
            const myDist = M.dist(myStarters, result.projections, 'median');
            const oppDist = M.dist(oppOpt.map(s => s.pid), oppProj, 'median');
            const fc = M.forecast(myDist, oppDist);
            const oppCurTotal = M.dist((oppResult.roster.starters || []).filter(Boolean), oppProj, 'median').mean;
            const users = (currentLeague && currentLeague.users) || [];
            const u = users.find(x => String(x.user_id) === String(oppResult.roster.owner_id));
            const oppName = (oppResult.roster.metadata && oppResult.roster.metadata.team_name) || (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || ('Team ' + oppResult.roster.roster_id);
            const medOf = (pid, proj) => !pid ? 0 : proj[pid]?.available !== false && Number.isFinite(proj[pid]?.points?.median) ? proj[pid].points.median : null;

            // Slot-by-slot head-to-head: my WORKING player vs their IDEAL player,
            // aligned by slot-name occurrence (rosters share roster_positions).
            const theirByName = {}; oppOpt.forEach(s => { (theirByName[s.slot] = theirByName[s.slot] || []).push(s.pid); });
            const cursor = {};
            const dispSlots = [...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50));
            let myEdges = 0;
            const h2h = dispSlots.map(sl => {
                const myPid = workingAssign[sl.idx] || null;
                cursor[sl.slotName] = cursor[sl.slotName] || 0;
                const theirPid = (theirByName[sl.slotName] || [])[cursor[sl.slotName]++] || null;
                const myMed = medOf(myPid, result.projections), theirMed = medOf(theirPid, oppProj);
                if (myMed != null && theirMed != null && myMed > theirMed) myEdges++;
                return { slot: sl.slotName, myPid, myMed, theirPid, theirMed };
            });
            // Position-group strength (each starter's projected pts summed by position).
            const myByPos = {}, theirByPos = {};
            myStarters.forEach(pid => { const p = normPos((playersData[pid] || {}).position) || '?'; const value = medOf(pid, result.projections); myByPos[p] = value == null || myByPos[p] === null ? null : (myByPos[p] || 0) + value; });
            oppOpt.forEach(s => { const p = normPos((playersData[s.pid] || {}).position) || '?'; const value = medOf(s.pid, oppProj); theirByPos[p] = value == null || theirByPos[p] === null ? null : (theirByPos[p] || 0) + value; });
            const posStrength = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(p => p in myByPos || p in theirByPos).map(p => ({ pos: p, mine: p in myByPos ? myByPos[p] : 0, theirs: p in theirByPos ? theirByPos[p] : 0 }));

            matchup = { fc, oppName, oppCurTotal, oppIdealTotal: oppResult.res.optimal.total, oppProj, h2h, posStrength, myEdges, slotCount: h2h.length };
        }
    }

    const matchupPanel = (reviewWeek === planningWeek && matchup || reviewComparison?.available) ? <MatchupBreakdown matchup={reviewWeek === planningWeek ? matchup : null} comparison={reviewComparison} week={reviewWeek} pro={pro} pmeta={pmeta} compact={isPhone} reviewControls={reviewNavigator} benchmarkContext={matchupBenchmarkContext}
        upgrade={GatedRow ? <GatedRow title="Win probability + matchup breakdown" sub="Projected margin, slot-by-slot edges and position-strength bars" feature={STARTSIT_FEAT} /> : null} /> : <section className="gd-matchup gd-matchup-empty">{reviewNavigator}<p className="gd-muted">{historicalReview ? 'Submitted matchup scores are unavailable for this week.' : 'The matchup appears when an opponent and projections are available.'}</p></section>;

    // ── MFL lineup push card (write to MyFantasyLeague) ──
    function renderMflPush() {
        if (!isMfl) return null;
        const s = submit.status;
        // Phone: 16px input font (iOS Safari zooms on focus below 16px) + 44px height.
        const inputStyle = { flex: '1 1 130px', minWidth: 0, padding: isPhone ? '10px 12px' : '7px 10px', minHeight: isPhone ? '44px' : undefined, background: 'var(--charcoal, #0e0e12)', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-xs, 5px)', color: TEXT, fontSize: isPhone ? '16px' : '0.8rem' };
        return (
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 16px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.66rem', letterSpacing: '0.07em', color: GOLD, fontWeight: 700 }}>PUSH LINEUP TO MFL</div>
                    {mflCookie ? <span onClick={mflDisconnect} style={{ fontSize: fz('0.62rem'), color: SILVER, cursor: 'pointer', padding: isPhone ? '12px 0 12px 12px' : 0 }}>● connected · disconnect</span> : null}
                </div>
                {!mflCookie ? (
                    <div style={{ marginTop: '8px' }}>
                        <div style={{ fontSize: '0.72rem', color: SILVER, marginBottom: '8px', lineHeight: 1.5 }}>MFL requires your login to set a lineup (the API key can’t). Your password is used once to get a session token — only the token is kept (this tab), never the password.</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <input value={mflUser} onChange={e => setMflUser(e.target.value)} placeholder="MFL username" autoComplete="off" style={inputStyle} />
                            <input value={mflPass} onChange={e => setMflPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doMflLogin(); }} placeholder="MFL password" type="password" autoComplete="off" style={inputStyle} />
                            <button onClick={doMflLogin} disabled={mflAuthBusy} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.10)', opacity: mflAuthBusy ? 0.6 : 1 }}>{mflAuthBusy ? 'Connecting…' : 'Connect'}</button>
                        </div>
                        {mflAuthErr ? <div style={{ fontSize: '0.7rem', color: RED, marginTop: '6px' }}>{mflAuthErr}</div> : null}
                    </div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                        <div style={{ fontSize: '0.72rem', color: SILVER, minWidth: 0 }}>
                            {s === 'done' ? <span style={{ color: GREEN }}>{submit.msg}</span>
                                : s === 'error' ? <span style={{ color: RED }}>{submit.msg}</span>
                                    : 'Sets your working lineup as this week’s starters on MyFantasyLeague.'}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {s === 'confirm' ? (
                                <React.Fragment>
                                    <span style={{ fontSize: '0.7rem', color: AMBER }}>Overwrite Week {result.week} starters?</span>
                                    <button onClick={pushToMfl} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Confirm</button>
                                    <button onClick={() => setSubmit({ status: 'idle', msg: '' })} style={actBtn}>Cancel</button>
                                </React.Fragment>
                            ) : (
                                <button disabled={s === 'submitting'} onClick={() => setSubmit({ status: 'confirm', msg: '' })}
                                    style={{ ...actBtn, opacity: s === 'submitting' ? 0.5 : 1, cursor: s === 'submitting' ? 'not-allowed' : 'pointer', color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.10)' }}>
                                    {s === 'submitting' ? 'Submitting…' : s === 'done' ? 'Re-submit' : 'Submit to MFL'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Season schedule rail: outlook + week-by-week ──
    function renderRail() {
        const d = seasonData;
        const scheduleUnset = !!(d && d.scheduleUnset);
        const byeWatch = _vp.isPhone ? [...((d && d.byeWatch) || [])].sort((a, b) => a.week - b.week) : (d && d.byeWatch) || [];
        const byeLabel = (bw) => {
            const c = {}; (bw.positions || []).forEach(p => { c[p] = (c[p] || 0) + 1; });
            // count===0 = a roster-gap hole, not a bye week — never say "0 on bye".
            return Object.keys(c).map(p => c[p] > 1 ? c[p] + ' ' + p + 's' : p).join(', ') || (bw.count > 0 ? bw.count + ' on bye' : 'lineup hole');
        };
        return (
            <div className="gd-season-rail" style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: isNarrow ? 'static' : 'sticky', top: '16px' }}>
                {/* Season outlook (or a pre-season placeholder when no schedule yet) */}
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '14px 16px' }}>
                    <div style={{ fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600 }}>SEASON OUTLOOK</div>
                    {!pro ? (
                        // Free: raw current record only — proj record / PF / win% are
                        // season-sim (optimizer) outputs.
                        <React.Fragment>
                            {d && d.summary && d.summary.record ? (
                                <div style={{ display: 'flex', gap: '16px', margin: '8px 0 10px' }}>
                                    <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>NOW</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.record}</div></div>
                                </div>
                            ) : <div style={{ height: '8px' }} />}
                            {GatedRow ? <GatedRow title="Season projection" sub="Projected record, points-for and weekly win odds" feature={STARTSIT_FEAT} /> : null}
                        </React.Fragment>
                    ) : scheduleUnset ? (
                        <div style={{ color: SILVER, fontSize: '0.74rem', marginTop: '8px', lineHeight: 1.5 }}>Schedule posts closer to Week 1. Building your <span style={{ color: TEXT, fontWeight: 600 }}>Week 1</span> lineup now — record + win% light up once matchups are set.</div>
                    ) : d && d.summary ? (
                        <React.Fragment>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
                                {/* Prefer the Season Odds simulation's projected record when it
                                    has run: schedule-engine sums per-week win probabilities while
                                    the sim models real scoring distributions and seeding, and two
                                    different projected records on one screen reads as a bug. */}
                                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: GOLD, fontVariantNumeric: 'tabular-nums' }}>
                                    {simSummary ? simSummary.projWins + '-' + simSummary.projLosses : d.summary.projRecord}
                                </span>
                                <span style={{ fontSize: fz('0.64rem'), color: SILVER }}>proj record</span>
                                {simSummary ? <span style={{ fontSize: fz('0.64rem'), color: GOLD, fontWeight: 700 }}>· {simSummary.playoffPct}% playoffs</span> : null}
                            </div>
                            <div style={{ display: 'flex', gap: '16px', marginTop: '9px' }}>
                                <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>NOW</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.record}</div></div>
                                <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>PROJ PF</div><div style={{ fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{d.summary.projPF}</div></div>
                                {d.summary.winPct != null ? <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>WIN%</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.winPct}%</div></div> : null}
                            </div>
                        </React.Fragment>
                    ) : <div style={{ color: SILVER, fontSize: '0.74rem', marginTop: '8px', opacity: 0.7 }}>Projecting your season…</div>}
                </div>

                {/* Bye watch — the weeks you're thinnest (works with or without a schedule) */}
                {byeWatch.length ? (
                    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 16px' }}>
                        <div style={{ fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600, marginBottom: '6px' }}>BYE WATCH</div>
                        {byeWatch.map(bw => (
                            <div key={bw.week} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px', padding: '6px 0', fontSize: '0.74rem' }}>
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ color: bw.unfilled ? RED : AMBER, fontWeight: 700 }}>Wk {bw.week}</span>
                                    <span style={{ color: SILVER, marginLeft: '6px' }}>{byeLabel(bw)}{bw.unfilled && bw.count > 0 ? ' · no cover' : ''}</span>
                                </span>
                                <span style={{ color: bw.unfilled ? RED : AMBER, fontWeight: 800 }}>{bw.unfilled ? '⚠' : bw.count}</span>
                                <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    {(bw.positions?.length ? [...new Set(bw.positions)] : [null]).map(position => <button key={position || 'cover'} type="button" onClick={() => {
                                        const dropPid = (myRoster?.players || []).find(pid => window._playerTags?.[pid] === 'cut');
                                        const context = {
                                            position: position || undefined,
                                            week: bw.week,
                                            dropPid: dropPid || undefined,
                                            reason: 'Week ' + bw.week + (position ? ' ' + position : '') + (bw.reason === 'gap' ? ' lineup coverage' : ' bye coverage') + (bw.unfilled ? ' · No cover on your roster.' : ' · Add depth before this week.'),
                                            source: 'game-day-bye-watch',
                                            leagueId: currentLeague?.league_id || currentLeague?.id,
                                        };
                                        if (typeof window.WR?.openAcquisition === 'function') window.WR.openAcquisition(context);
                                        else setActiveTab?.('fa');
                                    }} style={{ background: 'transparent', border: '1px solid ' + LINE, borderRadius: 'var(--card-radius-sm, 8px)', padding: '5px 8px', minHeight: '36px', color: GOLD, fontSize: '.7rem', cursor: 'pointer' }}>Find {position ? position + ' ' : ''}cover →</button>)}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : null}

                {/* Week-by-week schedule */}
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden' }}>
                    <div style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600 }}>SCHEDULE</div>
                    {scheduleUnset ? (
                        <div style={{ padding: '10px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.8, lineHeight: 1.5 }}>{pro ? 'Opponents + weekly win% appear here once your league posts the schedule.' : 'Opponents appear here once your league posts the schedule.'}</div>
                    ) : d && d.weeks ? d.weeks.map(w => {
                        const wp = pro ? w.winPct : null; // weekly win% is a Pro likelihood read
                        const color = w.result ? (w.result === 'W' ? GREEN : w.result === 'L' ? RED : SILVER) : (wp == null ? SILVER : wp >= 55 ? GREEN : wp <= 45 ? RED : GOLD);
                        const bye = w.byes || {};
                        return (
                            <div key={w.week} style={{ display: 'grid', gridTemplateColumns: '26px 1fr 52px', gap: '8px', alignItems: 'center', padding: '6px 14px', borderBottom: `1px solid ${LINE}`, background: w.isCurrent ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent' }}>
                                <span style={{ fontSize: fz('0.62rem'), color: w.isCurrent ? GOLD : SILVER, fontWeight: 700 }}>W{w.week}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '0.74rem', color: (w.isPast && !w.result) ? SILVER : TEXT }}>{w.bye ? <span style={{ color: SILVER, opacity: 0.6 }}>bye</span> : w.oppName}</span>
                                    {bye.count ? <span title={bye.unfilled ? "You can't field a full lineup this week" : bye.count + ' of your starters on bye'} style={{ flex: '0 0 auto', fontSize: fz('0.56rem'), fontWeight: 700, color: bye.thin ? (bye.unfilled ? RED : AMBER) : SILVER }}>{bye.unfilled ? '⚠' : bye.count + '·b'}</span> : null}
                                </span>
                                <span style={{ textAlign: 'right', fontSize: '0.68rem', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                                    {w.result ? (w.result + (w.myProj != null ? ' ' + Math.round(w.myProj) : '')) : (wp != null ? wp + '%' : w.bye ? '—' : '·')}
                                </span>
                            </div>
                        );
                    }) : <div style={{ padding: '10px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>Loading schedule…</div>}
                </div>
            </div>
        );
    }

    // ══ PHONE (<768) — Game Day Central phone branch (iPhone program Phase 1).
    // EARLY RETURN: everything below the closing brace renders only off-phone,
    // so the desktop/tablet return underneath stays byte-identical. Kit
    // presence (wr-primitives.js loads earlier in the babel chain) is fixed
    // for the page's lifetime, so gating the return on it has no hook hazard.
    // Free/Pro: every phone surface re-pours gated content at the EXACT
    // existing `pro` boundaries — optimal hero/delta, matchup grades, win%,
    // breakdown and the Alex note stay Pro; the manual builder, raw
    // projections, bye listing and the MFL push stay free.
    const _kitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList && window.WR.Sheet && window.WR.ActionBar);
    if (isPhone && _kitReady) {
        const Sheet = window.WR.Sheet, ActionBar = window.WR.ActionBar;
        const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
        const MICRO = '0.875rem';
        const SLOT_SHORT = { SUPER_FLEX: 'SF', REC_FLEX: 'RF', FLEX: 'FLX', WRTQ: 'WRT', IDP_FLEX: 'IDP', WILDCARD: 'WC' };
        const dispSlots = [...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50));

        // Working-vs-platform dirtiness drives the ActionBar (P6). MFL rosters
        // never expose platform starters (currentAssign = {}), so any set slot
        // reads as "unpushed" — exactly when the push path matters.
        const dirty = startingSlots.some(sl => String(workingAssign[sl.idx] || '') !== String(currentAssign[sl.idx] || ''));

        // Optimal swap summary for the hero facts — the same per-slot
        // assignment walk as applyOptimal(), diffed against the working
        // lineup. Pro only (the optimizer layer).
        let swaps = [];
        if (pro && canOptimize) {
            const byName = {};
            formOptimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
            const optAssign = {};
            startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) optAssign[sl.idx] = String(arr.shift()); });
            startingSlots.forEach(sl => {
                const cur = String(workingAssign[sl.idx] || ''), opt = String(optAssign[sl.idx] || '');
                if (cur === opt) return;
                const sw = { sl, cur, opt, gain: formPts(opt) != null && (!cur || formPts(cur) != null) ? objPts(opt) - objPts(cur) : null };
                swaps.push(sw);
            });
        }
        // Apply Optimal, then show the moves it made as a list (owner ask).
        // Capture the swaps BEFORE applying (post-apply they recompute to []).
        const applyOptimalWithSummary = () => {
            const moves = swaps.slice();
            applyOptimal();
            if (moves.length) setAppliedMoves(moves);
        };



        const playerMetricValues = pid => {
            if (!pid) return {};
            const projection = projOf(pid), player = playersData?.[pid];
            return {
                proj: projection?.available !== false ? projection?.points?.[objective] : null,
                ppg: WP?.formStats?.(pid, 5)?.rollingPPG,
                dhq: window.App?.PlayerValue?.getValue?.(pid) ?? window.App?.LI?.playerScores?.[pid],
                age: player?.age, season: WP?.formStats?.(pid, 'season')?.rollingPPG,
                bye: window.App?.NFLByes?.weekForPlayer?.(player, window.App?.NFLByes?.seasonFor?.(currentLeague)),
                matchup: pro ? projection?.matchupGrade : null,
            };
        };
        const playerMetricSlots = pid => {
            const projection = projOf(pid);
            return metricPreference ? window.WR.PlayerMetrics.slots(metricPreference.selected, playerMetricValues(pid))
                : [{ label: 'PROJ', value: projection?.available !== false && Number.isFinite(projection?.points?.[objective]) ? projection.points[objective].toFixed(1) : '—' }, { label: formWinLabel + ' PPG', value: Number.isFinite(formOf(pid)?.rollingPPG) ? formOf(pid).rollingPPG.toFixed(1) : '—' }];
        };
        const metricKeys = metricPreference?.selected || ['proj', 'ppg'];
        const metricsApi = window.WR?.PlayerMetrics;
        const sortColumns = metricKeys.map(key => {
            const definition = metricsApi?.definitions?.find(item => item.key === key);
            return { key, label: definition?.label || key.toUpperCase(), title: definition?.name || key };
        });
        const scopedSort = choice => choice.scope === leagueScope && (choice.key === 'name' || metricKeys.includes(choice.key)) ? choice : { key: null, dir: -1 };
        const phoneSort = scopedSort(phoneSortChoice), pickerSort = scopedSort(pickerSortChoice);
        const changePlayerSort = (key, picker = false) => {
            const update = picker ? setPickerSortChoice : setPhoneSortChoice;
            update(previous => ({ scope: leagueScope, key,
                dir: previous.scope === leagueScope && previous.key === key ? previous.dir * -1 : metricsApi?.defaultDirection?.(key) ?? (['name', 'age', 'bye'].includes(key) ? 1 : -1) }));
        };
        const comparePlayerIds = (a, b, sort) => {
            const value = pid => !pid ? null : sort.key === 'name' ? pmeta(pid).name : metricPreference ? playerMetricValues(pid)[sort.key]
                : sort.key === 'proj' ? playerMetricValues(pid).proj : formOf(pid)?.rollingPPG;
            return metricsApi?.compareValues?.(value(a), value(b), sort.dir, { text: sort.key === 'name', type: sort.key === 'matchup' ? 'grade' : undefined }) || 0;
        };
        // Sorting reorders copied display records only; every action retains its
        // original slot index and the saved/submitted assignments stay intact.
        const sortedDispSlots = phoneSort.key ? [...dispSlots].sort((a, b) => comparePlayerIds(workingAssign[a.idx], workingAssign[b.idx], phoneSort)) : dispSlots;
        const SortHeader = metricsApi?.SortHeader;
        const sortHeader = picker => SortHeader ? <SortHeader groupMetrics columns={sortColumns} sort={picker ? pickerSort : phoneSort}
            onSort={key => changePlayerSort(key, picker)} className={picker ? 'gd-picker-sort-heading' : 'gd-player-sort-heading'}
            style={{ gridTemplateColumns: 'minmax(105px,1fr) repeat(' + metricKeys.length + ',minmax(33px,.44fr))' }} /> : null;

        // Phone rows keep the projection and selected-window PPG visible together.
        // A tap opens eligible replacements and deeper matchup/form context.
        const slotRow = (sl) => {
            const pid = workingAssign[sl.idx] || null;
            const slotLabel = sl.slotName.replace('_', ' ');
            const open = openSlot === sl.idx;
            if (!pid) {
                return <MobilePlayerRow key={sl.idx} pos={SLOT_SHORT[sl.slotName] || sl.slotName} name="Empty — tap to set" tag={slotLabel}
                    slots={playerMetricSlots(null)} accent={open ? 'gold' : undefined}
                    onClick={() => setOpenSlot(open ? null : sl.idx)} />;
            }
            const meta = pmeta(pid), proj = projOf(pid), pts = proj && proj.points;
            const status = injuryOf(pid);
            const opp = proj && proj.opponent;
            const tag = [slotLabel, meta.team || 'FA', opp && opp.abbr ? (opp.home ? 'vs ' : '@ ') + opp.abbr : null].filter(Boolean).join(' · ');
            const fs = formOf(pid);
            const atRisk = !!status || (proj && proj.available === false);
            const submitted = platformStarters.map(String).includes(String(pid));
            const actualScore = lineupScorePresentation({ tracking: trackingLineup, submitted,
                state: gameState(pid), gamesFresh, actual: submitted && Live && liveRow ? Live.playerPoints(liveRow, pid) : null,
                forecast: savedForecasts.players[pid], scoreStatus: liveScores.status, scoreError: liveScores.error,
                scoresSupported: liveScores.supported });
            return <MobilePlayerRow key={sl.idx} pos={meta.positionLabel || meta.pos || '?'} name={meta.name} injuryStatus={status} tag={<>{tag}<LineupLiveStatus pid={pid} scoreVisible={!!actualScore} /></>}
                slots={playerMetricSlots(pid)}
                actualScore={actualScore}
                accent={open ? 'gold' : atRisk ? 'risk' : undefined}
                onClick={() => setOpenSlot(open ? null : sl.idx)} />;
        };

        // Eligible-player picker (openSlot) — a WR.Sheet instead of the
        // desktop inline expansion; rows drive the EXACT same assign/empty
        // setters. Form stats + the L3/L5/L8/SZN window ride here (the
        // Hi/Lo columns stay in the picker).
        const openSl = openSlot != null ? startingSlots.find(sl => sl.idx === openSlot) : null;
        const openPid = openSl ? (workingAssign[openSl.idx] || null) : null;
        const eligiblePlayers = openSl ? eligibleFor(openSl) : [];
        const openElig = pickerSort.key ? [...eligiblePlayers].sort((a, b) => comparePlayerIds(a, b, pickerSort)) : eligiblePlayers;
        const openFs = openPid ? formOf(openPid) : null;
        const pickRow = (epid) => {
            const isCur = String(openPid) === String(epid);
            const meta = pmeta(epid), proj = projOf(epid), pts = proj && proj.points;
            const status = injuryOf(epid);
            const opp = proj && proj.opponent;
            const fs = formOf(epid);
            return <MobilePlayerRow key={epid} pos={meta.positionLabel || meta.pos || '?'} name={meta.name} injuryStatus={status}
                tag={[isCur ? 'CURRENT STARTER' : 'START', meta.team || 'FA', opp && opp.abbr ? (opp.home ? 'vs ' : '@ ') + opp.abbr : null, pro ? 'Matchup ' + (proj?.matchupGrade || '—') : null].filter(Boolean).join(' · ')}
                slots={playerMetricSlots(epid)}
                delta={!isCur && proj?.available !== false && Number.isFinite(pts?.[objective]) && (!openPid || (projOf(openPid)?.available !== false && Number.isFinite(projOf(openPid)?.points?.[objective]))) ? pts[objective] - (openPid ? projOf(openPid).points[objective] : 0) : null}
                disabled={!canChangePlayer(openPid) || !canChangePlayer(epid)}
                accent={isCur ? 'gold' : undefined}
                onClick={() => { canChangePlayer(openPid) && canChangePlayer(epid) && setWorkingAssign(w => ({ ...w, [openSl.idx]: epid })); setOpenSlot(null); }} />;
        };

        return (
            <div className="gd-mobile">
                {ledgerNode}
                {/* This Week ⇄ Season toggle (owner ask) — week = matchup +
                    lineup; season = outlook + schedule. */}
                <div className="wr-seg gd-view-nav" aria-label="Game Day views">
                    <button aria-pressed={phoneView === 'week'} className={phoneView === 'week' ? 'is-on' : ''} onClick={() => setPhoneView('week')}>Lineup</button>
                    <button aria-pressed={phoneView === 'matchup'} className={phoneView === 'matchup' ? 'is-on' : ''} onClick={() => setPhoneView('matchup')}>Matchup</button>
                    <button aria-pressed={phoneView === 'season'} className={phoneView === 'season' ? 'is-on' : ''} onClick={() => setPhoneView('season')}>Season</button>
                    <button aria-pressed={phoneView === 'odds'} className={phoneView === 'odds' ? 'is-on' : ''} onClick={() => setPhoneView('odds')}>Odds</button>
                </div>

                {(phoneView === 'week' || phoneView === 'matchup') ? <div className={'gd-lineup-controls' + (phoneView === 'matchup' ? ' is-matchup' : '')}>
                    {phoneView === 'week' && weekNavigator}
                    {phoneView === 'week' && metricPreference && <div className="gd-lineup-columns"><window.WR.PlayerMetrics.Picker preference={metricPreference} /></div>}
                    {phoneView === 'week' && <div className="roster-lineup-form" aria-label="Optimizer form window"><span className="gd-form-label">Average</span>{[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(([label, value]) => <button type="button" key={label} aria-pressed={formWindow === value} onClick={() => setFormWindow(value)}>{label}</button>)}</div>}
                </div> : null}

                {phoneView === 'odds' ? (
                    // No bracket in a chopped league — survival IS the odds view.
                    leagueSkin?.features?.showPlayoffOdds === false
                        ? (window.WrChopBlock ? <window.WrChopBlock active currentLeague={currentLeague} myRoster={myRoster} /> : null)
                    : window.WrSeasonOdds
                        ? <window.WrSeasonOdds active currentLeague={currentLeague} myRoster={myRoster}
                            playersData={playersData} statsData={statsData} stats2025Data={stats2025Data}
                            leagueSkin={leagueSkin} pro={pro} onSummary={onSimSummary} />
                        : null
                ) : phoneView === 'matchup' ? matchupPanel : phoneView === 'week' ? (<React.Fragment>
                <section id="gameday-starting-lineup" className="gd-working-lineup" aria-label="Local lineup plan">
                    <div className="gd-list-heading mc-lineup-heading"><h2>Starting lineup</h2><span className="mc-lineup-total">{workingTotal.toFixed(1)} {formWinLabel} PPG{missingPlanForm ? ' · partial' : ''}</span></div>
                    {pro && canOptimize && !isOptimal ? <button type="button" className="gd-secondary" onClick={applyOptimalWithSummary}>Use optimal in my plan</button> : null}
                    {trackingLineup ? mobileScoreboard : null}
                    <div className="gd-player-list">{sortHeader(false)}{sortedDispSlots.map(slotRow)}</div>
                    <details className="mc-lineup-rules"><summary>How lineup suggestions work</summary><p className="gd-muted">{formHelp}</p></details>
                    {trackingLineup ? mobileScoreHelp : null}
                    {dirty || isMfl ? <button type="button" className="gd-secondary" onClick={() => setApplyOpen(true)}>Review planned changes</button> : null}
                </section>
                </React.Fragment>) : (<React.Fragment>
                {/* Season view — outlook + week-by-week schedule (renderRail
                    carries every existing free/Pro gate). */}
                {renderRail()}
                </React.Fragment>)}

                {/* P3-style picker sheet — bench players for the open slot */}
                <Sheet open={!!openSl} onClose={() => setOpenSlot(null)} title={openSl ? 'Set ' + openSl.slotName.replace('_', ' ') : ''} desktop={null}>
                    {openSl ? (
                        <div className="gd-mobile-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 14px 4px' }}>
                            <div className="mc-swap-summary"><span>SIT</span><strong>{openPid ? pmeta(openPid).name : 'Empty slot'}</strong><small>Choose the player to START below</small></div>
                            {metricPreference && <window.WR.PlayerMetrics.Picker preference={metricPreference} />}
                            <div className="wr-seg">
                                {[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(opt => (
                                    <button key={opt[0]} className={formWindow === opt[1] ? 'is-on' : ''} onClick={() => setFormWindow(opt[1])}>{opt[0]}</button>
                                ))}
                            </div>
                            {openPid && pro ? <p className="gd-muted">Matchup grade: {projOf(openPid)?.matchupGrade || '—'} · {canChangePlayer(openPid) ? 'Upcoming game' : 'Changes locked or game status unverified'}</p> : null}
                            {openPid && openFs ? (
                                <div style={{ fontSize: '0.74rem', color: SILVER, fontVariantNumeric: 'tabular-nums' }}>
                                    {pmeta(openPid).name} · {formWinLabel} <span style={{ color: TEXT, fontWeight: 700 }}>{openFs.rollingPPG.toFixed(1)}</span>
                                    {' · Hi '}<span style={{ color: GREEN, fontWeight: 700 }}>{openFs.high.toFixed(1)}</span>
                                    {' · Lo '}<span style={{ color: SILVER, fontWeight: 700 }}>{openFs.low.toFixed(1)}</span>
                                </div>
                            ) : null}
                            <div style={{ fontFamily: MONO, fontSize: MICRO, letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>Eligible for {openSl.slotName.replace('_', ' ')} — tap to start</div>
                            {sortHeader(true)}
                            {openElig.map(pickRow)}
                            {!openElig.length ? <div style={{ color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>No eligible bench players.</div> : null}
                            {openPid ? (
                                <button type="button" disabled={!canChangePlayer(openPid)} onClick={() => { canChangePlayer(openPid) && setWorkingAssign(w => { const n = { ...w }; delete n[openSl.idx]; return n; }); setOpenSlot(null); }}
                                    style={{ padding: '13px 0', cursor: 'pointer', color: RED, fontSize: '0.74rem', fontWeight: 600 }}>Empty this slot</button>
                            ) : null}
                        </div>
                    ) : null}
                </Sheet>

                {/* P6 apply/push sheet — the MFL push card re-homes here on
                    phone (never inline); same handlers, same submit machine. */}
                <Sheet open={applyOpen} onClose={() => setApplyOpen(false)} title="Working lineup" desktop={null}>
                    <div className="gd-mobile-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px 14px 4px' }}>
                        <div style={{ fontSize: '0.82rem', color: TEXT }}>
                            {!optimizerAvailable ? <span style={{ fontWeight: 700 }}>Lineup planning · {formWinLabel} PPG</span> : pro ? (!formComplete || missingPlanForm || planUnavailable ? <span>Review your lineup · {formWinLabel} PPG</span> : isOptimal ? <span style={{ color: GREEN, fontWeight: 700 }}>Lineup is optimal for {formWinLabel} PPG</span> : <span style={{ color: GOLD, fontWeight: 700 }}>{benchPts.toFixed(1)} {formWinLabel} PPG below optimal</span>) : <span style={{ fontWeight: 700 }}>Your lineup {workingTotal.toFixed(1)} {formWinLabel} PPG</span>}
                            {pro ? <span style={{ color: SILVER, fontSize: '0.76rem' }}> · yours {workingTotal.toFixed(1)}{missingPlanForm ? ' (partial)' : ''} · optimal {formComplete ? optimalTotal.toFixed(1) : '—'}</span> : null}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {pro ? <button className="lineup-apply" disabled={!canOptimize} onClick={applyOptimal} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Apply Optimal</button> : null}
                            <button onClick={() => { setWorkingAssign(currentAssign); setOpenSlot(null); }} style={actBtn}>Reset</button>
                        </div>
                        {renderMflPush()}
                        {!isMfl ? <div style={{ fontSize: '0.72rem', color: SILVER, lineHeight: 1.5 }}>Your platform has no public lineup-write API — build and compare here, then set the final lineup on your platform.</div> : null}
                    </div>
                </Sheet>

                {/* Apply-Optimal results — the moves it just made (owner ask). */}
                <Sheet open={!!appliedMoves} onClose={() => setAppliedMoves(null)} title={(appliedMoves ? appliedMoves.length : 0) + ' move' + ((appliedMoves && appliedMoves.length === 1) ? '' : 's') + ' planned'} desktop={null}>
                    {appliedMoves ? (() => {
                        const totalGain = appliedMoves.every(m => m.gain != null) ? appliedMoves.reduce((s, m) => s + m.gain, 0) : null;
                        return (
                        <div className="gd-mobile-sheet" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px 14px 4px' }}>
                            <div style={{ fontSize: '0.8rem', color: SILVER, lineHeight: 1.45 }}>Local plan updated{totalGain != null ? <> · <span style={{ color: totalGain >= 0 ? GREEN : SILVER, fontWeight: 700 }}>{totalGain > 0 ? '+' : ''}{totalGain.toFixed(1)}</span> {formWinLabel} PPG</> : null}. Here's what changed:</div>
                            {appliedMoves.map((m, i) => {
                                const outN = m.cur ? pmeta(m.cur).name : 'Empty';
                                const inN = m.opt ? pmeta(m.opt).name : 'Empty';
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)' }}>
                                        <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 700, color: GOLD, minWidth: '44px', whiteSpace: 'nowrap' }}>{m.sl.slotName.replace('_', ' ')}</span>
                                        <span style={{ flex: 1, minWidth: 0, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                            <span style={{ color: m.cur ? SILVER : 'var(--text-muted, #8B8B96)', textDecoration: m.cur ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{outN}</span>
                                            <span style={{ color: SILVER, flexShrink: 0 }}>→</span>
                                            <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{inN}</span>
                                        </span>
                                        <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 700, color: m.gain >= 0 ? GREEN : SILVER, whiteSpace: 'nowrap' }}>{m.gain == null ? '—' : (m.gain > 0 ? '+' : '') + m.gain.toFixed(1)}</span>
                                    </div>
                                );
                            })}
                            <button onClick={() => setAppliedMoves(null)} style={{ ...actBtn, marginTop: '4px', minHeight: '44px' }}>Done</button>
                        </div>
                        );
                    })() : null}
                </Sheet>

                {/* P6 action bar — live while the working lineup differs from
                    the platform lineup. APPLY = the same applyOptimal path
                    (Pro); bar tap opens the apply/push sheet. */}
                <ActionBar visible={dirty && phoneView === 'week'} label="LOCAL LINEUP PLAN"
                    value={workingTotal.toFixed(1) + ' ' + formWinLabel + ' PPG' + (missingPlanForm ? ' · partial' : '')}
                    tone="good" actionLabel="REVIEW"
                    onAction={() => setApplyOpen(true)}
                    onOpen={() => setApplyOpen(true)} />
            </div>
        );
    }

    // Desktop This Week ⇄ Odds toggle. Desktop already shows the season rail
    // beside the lineup, so it needs no separate "Season" view — only a way
    // to reach the odds. Rendered in both desktop branches below.
    const gdSeg = (
        <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden', marginBottom: '14px' }}>
            {[['week', 'This Week'], ['odds', 'Season Odds']].map(([k, label]) => (
                <button key={k} onClick={() => setGdView(k)}
                    style={{ padding: '7px 15px', cursor: 'pointer', border: 'none', background: gdView === k ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent', color: gdView === k ? GOLD : SILVER, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'var(--font-mono, monospace)' }}>
                    {label}
                </button>
            ))}
        </div>
    );

    if (gdView === 'odds') {
        return (
            <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px 16px 60px' }}>
                {gdSeg}
                {leagueSkin?.features?.showPlayoffOdds === false
                    ? (window.WrChopBlock
                        ? <window.WrChopBlock active currentLeague={currentLeague} myRoster={myRoster} />
                        : <div style={{ color: SILVER, fontSize: '0.8rem' }}>Chopping Block module not loaded.</div>)
                    : window.WrSeasonOdds
                    ? <window.WrSeasonOdds active currentLeague={currentLeague} myRoster={myRoster}
                        playersData={playersData} statsData={statsData} stats2025Data={stats2025Data}
                        leagueSkin={leagueSkin} pro={pro} onSummary={onSimSummary} />
                    : <div style={{ color: SILVER, fontSize: '0.8rem' }}>Season odds module not loaded.</div>}
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px 16px 60px' }}>
            {ledgerNode}
            {gdSeg}
            {weekNavigator}

            {/* Alex's game-day note */}
            {note && optimizerAvailable ? (
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px 16px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: fz('0.6rem'), fontWeight: 800, letterSpacing: '0.08em', color: GOLD, marginTop: '3px', whiteSpace: 'nowrap' }}>ALEX ·</span>
                        <span style={{ fontSize: '0.86rem', color: TEXT, lineHeight: 1.5 }}>{note}</span>
                        {/* Game-plan expansion — one-shot, ask once (chat retired). */}
                        {!gameplanTake?.text && (
                            <button onClick={askGameplanTake} disabled={gameplanTake?.loading}
                                style={{ flexShrink: 0, alignSelf: 'flex-start', background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.35)', borderRadius: 'var(--card-radius-xs, 5px)', color: GOLD, fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em', padding: '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                {gameplanTake?.loading ? '…' : '✨ MORE FROM ALEX'}
                            </button>
                        )}
                    </div>
                    {gameplanTake?.text && (
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${LINE}`, fontSize: '0.86rem', color: TEXT, opacity: 0.9, lineHeight: 1.5 }}>{gameplanTake.text}</div>
                    )}
                </div>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 300px', gap: '16px', alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                    {renderMflPush()}
                    {/* Hero — Pro: Your lineup vs Optimal. Free: raw working total
                        (sum of the slots the user set) + optimizer teaser; the
                        optimal total / bench delta are optimizer outputs. */}
                    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', padding: '18px 20px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>WEEK {result.week} · GAME DAY CENTRAL</div>
                        {pro ? (
                            <React.Fragment>
                                <div style={{ fontSize: '1.45rem', fontWeight: 700, color: isOptimal ? GREEN : GOLD, marginTop: '6px' }}>
                                    {!optimizerAvailable ? 'Lineup planning · ' + formWinLabel + ' PPG' : !formComplete ? 'More game history needed' : missingPlanForm ? 'Some averages are missing' : planUnavailable ? 'Replace unavailable starters' : isOptimal ? 'Lineup is optimal' : `${benchPts.toFixed(1)} ${formWinLabel} PPG below optimal`}
                                </div>
                                <div style={{ color: SILVER, fontSize: '0.82rem', marginTop: '4px' }}>
                                    Your lineup {workingTotal.toFixed(1)}{missingPlanForm ? ' (partial)' : ''} · Optimal {formComplete ? optimalTotal.toFixed(1) : '—'} {formWinLabel} PPG
                                </div>
                            </React.Fragment>
                        ) : (
                            <React.Fragment>
                                <div style={{ fontSize: '1.45rem', fontWeight: 700, color: GOLD, marginTop: '6px' }}>
                                    Your lineup {workingTotal.toFixed(1)} {formWinLabel} PPG
                                </div>
                                <div style={{ color: SILVER, fontSize: '0.82rem', marginTop: '4px' }}>
                                    Tap a slot below to set your starters — the total updates live.
                                </div>
                            </React.Fragment>
                        )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        {pro ? (
                            <React.Fragment>
                                <div style={{ fontSize: '0.66rem', color: SILVER, letterSpacing: '0.06em' }}>OPTIMIZING FOR</div>
                                <div style={{ fontSize: '0.82rem', color: GOLD, fontWeight: 600, marginTop: '3px' }}>{formWinLabel} · Rolling average</div>
                            </React.Fragment>
                        ) : null}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', justifyContent: 'flex-end' }}>
                            {pro ? <button className="lineup-apply" disabled={!canOptimize} onClick={applyOptimal} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Apply Optimal</button> : null}
                            <button onClick={() => { setWorkingAssign(currentAssign); setOpenSlot(null); }} style={actBtn}>Reset</button>
                        </div>
                    </div>
                </div>
                <p className="roster-lineup-hint">{formHelp}</p>
                {!pro && GatedRow ? (
                    <div style={{ marginTop: '12px' }}>
                        <GatedRow title="Lineup optimizer" sub="Optimal lineup + points left on bench, floor–ceiling bands, matchup grades and win odds" feature={STARTSIT_FEAT} />
                    </div>
                ) : null}
            </div>

            {matchupPanel}

            {/* Unified interactive lineup table */}
            <div id="gameday-starting-lineup" style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>STARTING LINEUP · tap a slot to set it</span>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: fz('0.58rem'), color: SILVER, letterSpacing: '0.05em', marginRight: '2px' }}>FORM</span>
                        {[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(opt => (
                            <button key={opt[0]} onClick={() => setFormWindow(opt[1])} style={winBtn(formWindow === opt[1])}>{opt[0]}</button>
                        ))}
                    </div>
                </div>
                {trackingLineup ? mobileScoreboard : null}
                {headerRow}
                {[...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50)).map(sl => {
                    const pid = workingAssign[sl.idx] || null;
                    const open = openSlot === sl.idx;
                    const elig = open ? eligibleFor(sl) : [];
                    return (
                        <div key={sl.idx} style={{ borderBottom: `1px solid ${LINE}` }}>
                            <div onClick={() => setOpenSlot(open ? null : sl.idx)}
                                style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: isPhone ? '11px 14px' : '9px 14px', minHeight: isPhone ? '44px' : undefined, alignItems: 'center', cursor: 'pointer', background: open ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: GOLD, letterSpacing: '0.04em' }}>{sl.slotName.replace('_', ' ')}<span style={{ color: SILVER, marginLeft: '4px', fontSize: fz('0.6rem') }}>{open ? '▾' : '▸'}</span></span>
                                <PlayerCells pid={pid} />
                            </div>
                            {open ? (
                                <div style={{ background: 'var(--ov-2, rgba(255,255,255,0.03))', borderTop: `1px solid ${LINE}`, padding: '4px 0' }}>
                                    {/* Phone: the Form/Hi/Lo columns are dropped from the grid —
                                        surface the assigned starter's form here on expand. */}
                                    {isPhone && pid ? (() => {
                                        const fs = formOf(pid);
                                        return fs ? (
                                            <div style={{ padding: '6px 14px 2px', fontSize: '0.7rem', color: SILVER, fontVariantNumeric: 'tabular-nums' }}>
                                                {formWinLabel} <span style={{ color: TEXT, fontWeight: 700 }}>{fs.rollingPPG.toFixed(1)}</span>
                                                {' · Hi '}<span style={{ color: GREEN, fontWeight: 700 }}>{fs.high.toFixed(1)}</span>
                                                {' · Lo '}<span style={{ color: SILVER, fontWeight: 700 }}>{fs.low.toFixed(1)}</span>
                                            </div>
                                        ) : null;
                                    })() : null}
                                    <div style={{ padding: '5px 14px', fontSize: fz('0.58rem'), letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>Eligible for {sl.slotName.replace('_', ' ')} — tap to start</div>
                                    {elig.map(epid => {
                                        const isCur = String(pid) === String(epid);
                                        return (
                                            <div key={epid} onClick={() => { canChangePlayer(pid) && canChangePlayer(epid) && setWorkingAssign(w => ({ ...w, [sl.idx]: epid })); setOpenSlot(null); }}
                                                style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: isPhone ? '10px 14px' : '7px 14px', minHeight: isPhone ? '44px' : undefined, alignItems: 'center', cursor: 'pointer', background: isCur ? 'rgba(212,175,55,0.10)' : 'transparent', borderLeft: isCur ? `3px solid ${GOLD}` : '3px solid transparent' }}>
                                                <span style={{ fontSize: fz('0.6rem'), color: isCur ? GOLD : SILVER, fontWeight: 700 }}>{isCur ? 'IN' : ''}</span>
                                                <PlayerCells pid={epid} />
                                            </div>
                                        );
                                    })}
                                    {pid ? (
                                        <div onClick={() => { canChangePlayer(pid) && setWorkingAssign(w => { const n = { ...w }; delete n[sl.idx]; return n; }); setOpenSlot(null); }}
                                            style={{ padding: isPhone ? '13px 14px' : '7px 14px', cursor: 'pointer', color: RED, fontSize: '0.7rem', fontWeight: 600 }}>✕ Empty this slot</div>
                                    ) : null}
                                    {!elig.length ? <div style={{ padding: '7px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>No eligible bench players.</div> : null}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            <div style={{ color: SILVER, fontSize: '0.66rem', marginTop: '10px', lineHeight: 1.6, opacity: 0.9 }}>
                <strong style={{ color: TEXT }}>Proj</strong> projected pts (your {objective} strategy){pro ? <React.Fragment> · <strong style={{ color: TEXT }}>Mtch</strong> matchup grade A–F (opponent's implied total)</React.Fragment> : null} · <strong style={{ color: TEXT }}>{formWinLabel}</strong> rolling avg of actual pts · <strong style={{ color: TEXT }}>Hi/Lo</strong> season best/worst week
            </div>
            <div style={{ color: SILVER, fontSize: '0.72rem', marginTop: '8px', lineHeight: 1.5 }}>
                Projections are league-scored from role, recent form{objective !== 'median' ? `, your ${result.mode.replace('_', '-')} strategy` : ''}, matchup and defense-vs-position; form columns are actual weekly points over the chosen window. Build and compare here{isMfl ? ' — then push straight to MFL above' : ' — set the final lineup on your platform'}.
            </div>
                </div>
                <div style={{ order: isNarrow ? 3 : 0 }}>{renderRail()}</div>
            </div>
        </div>
    );
}

window.LineupTab = LineupTab;
