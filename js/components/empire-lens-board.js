function EmpireLensBoard({ leagues, players, sleeperUserId, view, onView, onOpenLeague, cache }) {
    const { modes, list, load, ownerKey } = window.App.EmpireLenses;
    const { mode, basis, expanded, scroll } = view;
    const accountKey = ownerKey(sleeperUserId);
    const entries = React.useMemo(() => list(leagues, sleeperUserId), [leagues, sleeperUserId]);
    const context = JSON.stringify([accountKey, mode, basis]);
    const [results, setResults] = React.useState(() => cache.current);
    const [refresh, setRefresh] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    React.useLayoutEffect(() => {
        if (scroll > 0) window.scrollTo({ top: scroll, behavior: 'instant' });
    }, []);
    React.useEffect(() => {
        if (!accountKey || !entries.length || !Object.keys(players || {}).length) return;
        const controller = new AbortController();
        const isCurrent = () => !controller.signal.aborted && ownerKey(sleeperUserId) === accountKey && window.App.AccountSession?.isCurrent?.() !== false;
        const old = cache.current.context === context ? cache.current.rows : {};
        const rows = Object.fromEntries(entries.filter(entry => old[entry.key]?.league === entry.league)
            .map(entry => [entry.key, old[entry.key]]));
        const publish = () => {
            if (!isCurrent()) return;
            const next = { context, rows: { ...rows } };
            cache.current = next;
            setResults(next);
        };
        setError('');
        setLoading(true);
        publish();
        async function read() {
            const { nfl } = await window.WrWireCalendar.load({ signal: controller.signal, force: refresh > 0 });
            if (!isCurrent()) return;
            const currentSeason = String(nfl.season);
            const optional = (fetch, season) => Promise.resolve().then(() => fetch?.(season)).catch(() => null);
            const [statsData, priorData, projectionsData] = await Promise.all([
                optional(window.fetchSeasonStats, currentSeason),
                optional(window.fetchSeasonStats, String(Number(currentSeason) - 1)),
                optional(window.fetchSeasonProjections, currentSeason),
            ]);
            if (!isCurrent()) return;
            // Share the league-independent NFL inputs. Each comparison gets
            // its own league scoring, settings, player ownership and GM plan.
            const loadEntry = async entry => {
                if (!isCurrent()) return;
                let result;
                try {
                    result = await load(entry, { mode, basis, players, accountKey, nfl, isCurrent,
                        statsData: statsData || {}, priorData: priorData || {}, projectionsData: projectionsData || {} });
                } catch (_) {
                    result = { status: 'unavailable', reason: 'The league comparison could not load.', candidates: [], total: 0 };
                }
                if (!isCurrent()) return;
                rows[entry.key] = { league: entry.league, result };
                publish();
            };
            for (let i = 0; i < entries.length && isCurrent(); i += 3) {
                await Promise.all(entries.slice(i, i + 3).map(loadEntry));
            }
        }
        read().catch(() => {
            if (isCurrent()) {
                Object.keys(rows).forEach(key => delete rows[key]);
                publish();
                setError('Could not verify the NFL week. Try again.');
            }
        }).finally(() => { if (isCurrent()) setLoading(false); });
        return () => controller.abort();
    }, [entries, accountKey, mode, basis, players, refresh]);

    const rows = results.context === context ? results.rows : {};
    const names = assets => (assets || []).map(asset => asset.name || asset.player?.full_name || 'Player').join(' + ');
    const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
    return <section className="empire-lens-board" aria-labelledby="empire-lenses-title">
        <div className="empire-lens-heading">
            <h1 id="empire-lenses-title">Lenses</h1>
            <button type="button" className="empire-action" onClick={() => setRefresh(value => value + 1)}>Refresh lenses</button>
        </div>
        <nav className="empire-lens-modes" aria-label="Roster lenses">
            {Object.entries(modes).map(([key, descriptor]) => <button type="button" key={key} aria-pressed={mode === key}
                onClick={() => onView({ mode: key, scroll: 0 })}>{descriptor.label}</button>)}
        </nav>
        <label className="empire-lens-basis">Compare by
            <select value={basis} onChange={event => onView({ basis: event.target.value, scroll: 0 })}>
                <option value="projected">Weekly projections</option>
                <option value="average">Season averages</option>
            </select>
        </label>
        {error && <p role="alert" className="empire-lens-status">{error}</p>}
        {!accountKey && <p role="status" className="empire-lens-status">Sign in to compare your leagues.</p>}
        {accountKey && !entries.length && <p role="status" className="empire-lens-status">Connect a league to see its roster recommendations.</p>}
        <div className="empire-lens-cards" aria-label="Recommendations by league">
            {entries.map(entry => {
                const { league, key } = entry;
                const result = rows[key]?.league === league ? rows[key].result : null;
                const open = expanded[key] !== false;
                const canDrillDown = entry.roster && result?.status !== 'disabled';
                return <article key={key} className="empire-lens-card">
                    <div className="empire-lens-card-head">
                        <button type="button" aria-expanded={open} onClick={() => onView({ expanded: { ...expanded, [key]: !open } })}>
                            <strong>{league.name || 'League'}</strong>
                            <small>{entry.provider === 'mfl' ? 'MFL' : entry.provider === 'espn' ? 'ESPN' : entry.provider === 'yahoo' ? 'Yahoo' : 'Sleeper'}{result?.week ? ' · Week ' + result.week : ''}</small>
                        </button>
                        <button className="empire-action" type="button" onClick={() => onOpenLeague(league, canDrillDown ? modes[mode].tab : undefined)}
                            aria-label={(canDrillDown ? 'Open ' + modes[mode].label + ' in ' : 'Open ') + (league.name || 'league')}>Open league <span aria-hidden="true">›</span></button>
                    </div>
                    {open && <div className="empire-lens-card-body">
                        {!result ? <p>{error || (loading ? 'Checking this league…' : 'No verified comparison.')}</p> : <>
                            {result.participationNotice && <p>{result.participationNotice}</p>}
                            {!result.candidates.length && <p>{result.reason || 'No improving moves found for this league.'}</p>}
                            {result.candidates.map(candidate => <div className="empire-lens-move" key={candidate.id}>
                                <div><strong>{names(candidate.incoming)}</strong>
                                    <small>{candidate.slotName ? candidate.slotName + ' · ' : ''}{names(candidate.outgoing) ? 'For ' + names(candidate.outgoing) : mode === 'lineup' ? 'Fill open slot' : ''}</small></div>
                                {Number.isFinite(candidate.weekly?.delta) && <span data-positive={candidate.weekly.delta > 0}>{fmt.format(candidate.weekly.delta)} pts</span>}
                            </div>)}
                            {result.total > result.candidates.length && <p>{result.total - result.candidates.length} more in {modes[mode].label}</p>}
                        </>}
                    </div>}
                </article>;
            })}
        </div>
    </section>;
}
window.EmpireLensBoard = EmpireLensBoard;
