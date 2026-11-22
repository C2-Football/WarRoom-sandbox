const empireLensName = asset => asset?.name || asset?.player?.full_name || 'Player';
const empireLensInitials = name => name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
const empireLensGain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const empireLensPoints = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function EmpireLensLeagueMark({ league }) {
    const name = league.name || 'League';
    const avatar = league.avatar;
    return <span className="empire-lens-league-mark" aria-hidden="true">
        {empireLensInitials(name)}
        {typeof avatar === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(avatar) &&
            <img src={'https://sleepercdn.com/avatars/thumbs/' + avatar} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} />}
    </span>;
}

function EmpireLensPlayer({ player, open, onToggle, onOpenLeague, mode, tab }) {
    const { pid, name, position, team, leagues, bestDelta } = player;
    const posColor = window.App.positionColor?.(position);
    const detailId = 'empire-lens-player-' + encodeURIComponent(pid);
    return <li className="wr-roster-mobile-player empire-lens-player" data-wr-lens-state={open ? 'active' : undefined}>
        <button type="button" className="wr-roster-mobile-player-trigger" onClick={onToggle} aria-expanded={open} aria-controls={open ? detailId : undefined}>
            <span className="wr-roster-mobile-player-identity">
                <span className="wr-roster-position-icon" style={{ '--wr-position-color': posColor || 'var(--silver)' }}>{position}</span>
                <span className="wr-roster-identity-copy"><strong>{name}</strong>{team && <span>{team}</span>}</span>
            </span>
            <span className="empire-lens-appearances" title={leagues.map(item => item.entry.league.name || 'League').join(', ')}>
                <span className="empire-lens-league-icons">{leagues.slice(0, 3).map(({ entry }) => <EmpireLensLeagueMark key={entry.key} league={entry.league} />)}</span>
                <small>{leagues.length} {leagues.length === 1 ? 'league' : 'leagues'}</small>
            </span>
            <span className="wr-roster-mobile-player-value empire-lens-row-gain" data-positive={bestDelta > 0}>
                {Number.isFinite(bestDelta) ? <><strong>{empireLensGain.format(bestDelta)} pts</strong><small>{leagues.length > 1 ? 'Best gain' : 'Gain'}</small></> : <strong>—</strong>}
            </span>
            <span className="wr-roster-mobile-player-chevron" aria-hidden="true">{open ? '⌄' : '›'}</span>
        </button>
        {open && <div className="empire-lens-player-detail" id={detailId}>
            {leagues.map(({ entry, candidates }) => <section className="empire-lens-league-detail" key={entry.key}>
                <button type="button" className="empire-lens-drill" onClick={() => onOpenLeague(entry.league, tab)}>
                    <EmpireLensLeagueMark league={entry.league} />
                    <strong>{entry.league.name || 'League'}</strong>
                    <span aria-hidden="true">›</span>
                </button>
                {candidates.map(candidate => {
                    const incoming = candidate.incoming?.find(asset => String(asset.pid ?? asset.id) === pid);
                    const outgoing = (candidate.outgoing || []).map(empireLensName).join(' + ');
                    const move = mode === 'lineup' ? [candidate.slotName, outgoing ? 'Replace ' + outgoing : 'Fill open slot'].filter(Boolean).join(' · ')
                        : mode === 'waivers' ? (outgoing ? 'Drop ' + outgoing : 'Open roster spot')
                            : [outgoing ? 'Send ' + outgoing : null, candidate.partner?.name || candidate.partner?.ownerName].filter(Boolean).join(' · ');
                    const delta = candidate.weekly?.delta;
                    return <div className="empire-lens-scenario" key={candidate.id}>
                        <span>{move || (mode === 'trades' ? 'Trade proposal' : 'Lineup upgrade')}
                            {Number.isFinite(incoming?.projection) && <small>{incoming.comparisonBasis === 'average' ? 'Avg' : 'Proj'} {empireLensPoints.format(incoming.projection)}</small>}
                        </span>
                        {Number.isFinite(delta) && <span><b data-positive={delta > 0}>{empireLensGain.format(delta)} pts</b>{candidate.weekly?.partial && <small>Compared slots</small>}</span>}
                    </div>;
                })}
            </section>)}
        </div>}
    </li>;
}

function EmpireLensBoard({ leagues, players, playersLoaded, sleeperUserId, view, onView, onOpenLeague, cache, priceCache }) {
    const { modes, list, load, ownerKey, groupPlayers, elimination } = window.App.EmpireLenses;
    const { mode, basis, scroll } = view;
    const accountKey = ownerKey(sleeperUserId);
    const entries = React.useMemo(() => list(leagues, sleeperUserId), [leagues, sleeperUserId]);
    const hasPlayers = Object.keys(players || {}).length > 0;
    const context = JSON.stringify([accountKey, mode, basis]);
    const [results, setResults] = React.useState(() => cache.current);
    const [eligibility, setEligibility] = React.useState(() => cache.current.eligibility);
    const [refresh, setRefresh] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    React.useLayoutEffect(() => {
        if (scroll > 0) window.scrollTo({ top: scroll, behavior: 'instant' });
    }, []);
    React.useEffect(() => {
        if (!accountKey || !entries.length || !hasPlayers) return;
        const controller = new AbortController();
        const isCurrent = () => !controller.signal.aborted && ownerKey(sleeperUserId) === accountKey && window.App.AccountSession?.isCurrent?.() !== false;
        const old = cache.current.context === context ? cache.current.rows : {};
        const rows = Object.fromEntries(entries.filter(entry => old[entry.key]?.league === entry.league)
            .map(entry => [entry.key, old[entry.key]]));
        const publish = () => {
            if (!isCurrent()) return;
            const next = { ...cache.current, context, rows: { ...rows } };
            cache.current = next;
            setResults(next);
        };
        setError('');
        setLoading(true);
        publish();
        async function read() {
            const { nfl } = await window.WrWireCalendar.load({ signal: controller.signal, force: refresh > 0 });
            if (!isCurrent()) return;
            const evidenceWeek = JSON.stringify([accountKey, nfl?.season, nfl?.season_type, nfl?.display_week || nfl?.week]);
            const lastEvidence = cache.current.eligibility;
            const verified = lastEvidence?.week === evidenceWeek ? { ...lastEvidence.verified } : {};
            const publishEligibility = () => {
                const evidence = { accountKey, nfl, week: evidenceWeek, verified: { ...verified } };
                cache.current = { ...cache.current, eligibility: evidence };
                setEligibility(evidence);
            };
            publishEligibility();
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
                    result = await load(entry, { mode, basis, players, accountKey, nfl, isCurrent, signal: controller.signal, priceCache,
                        statsData: statsData || {}, priorData: priorData || {}, projectionsData: projectionsData || {} });
                } catch (_) {
                    result = { status: 'unavailable', reason: 'The league comparison could not load.', candidates: [], total: 0 };
                }
                if (!isCurrent()) return;
                rows[entry.key] = { league: entry.league, result };
                if (result.elimination) {
                    verified[entry.key] = { league: entry.league, reason: result.elimination };
                    publishEligibility();
                }
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
    }, [entries, accountKey, mode, basis, players, refresh, priceCache]);

    const rows = results.context === context ? results.rows : {};
    const resultFor = entry => rows[entry.key]?.league === entry.league ? rows[entry.key].result : null;
    const overrides = view.leagueScope === accountKey ? view.leagueOverrides || {} : {};
    const expanded = view.playerScope === context ? view.expandedPlayer : null;
    const choices = entries.map(entry => {
        const verified = eligibility?.accountKey === accountKey ? eligibility.verified?.[entry.key] : null;
        const eliminated = resultFor(entry)?.elimination
            || (verified?.league === entry.league && verified.reason)
            || (eligibility?.accountKey === accountKey && elimination(entry, eligibility.nfl));
        const included = overrides[entry.key] ?? !eliminated;
        return { entry, eliminated, included };
    });
    const selected = choices.filter(choice => choice.included).map(choice => choice.entry);
    const groups = groupPlayers(selected, rows, players);
    const unavailable = selected.filter(entry => {
        const result = resultFor(entry);
        return ['unavailable', 'disabled'].includes(result?.status)
            || (result?.status === 'eliminated' && !result.candidates.length);
    });
    const caption = !accountKey ? 'Sign in to compare your leagues.'
        : !entries.length ? 'Connect a league to see recommendations.'
            : !selected.length ? 'Select a league.'
                : playersLoaded && !hasPlayers ? 'Player data is unavailable.'
                    : loading ? 'Checking leagues…'
                        : 'No recommendations in the selected leagues.';
    const changeLeague = (entry, enabled) => onView({ leagueScope: accountKey, leagueOverrides: { ...overrides, [entry.key]: enabled } });
    return <section className="empire-lens-board" aria-labelledby="empire-lenses-title">
        <div className="empire-lens-heading">
            <h1 id="empire-lenses-title">Lenses</h1>
            <button type="button" className="empire-action" onClick={() => setRefresh(value => value + 1)}>Refresh lenses</button>
        </div>
        <nav className="empire-lens-modes" aria-label="Roster lenses">
            {Object.entries(modes).map(([key, descriptor]) => <button type="button" key={key} aria-pressed={mode === key}
                onClick={() => onView({ mode: key, scroll: 0 })}>{descriptor.label}</button>)}
        </nav>
        <div className="empire-lens-controls">
            {entries.length > 0 && <details className="empire-lens-filters">
                <summary>Leagues <b>{selected.length}/{entries.length}</b></summary>
                <div className="empire-lens-filter-list">
                    {choices.map(({ entry, eliminated, included }) => <label key={entry.key}>
                        <input type="checkbox" checked={included} onChange={event => changeLeague(entry, event.target.checked)} />
                        <EmpireLensLeagueMark league={entry.league} />
                        <span>{entry.league.name || 'League'}{eliminated && <small>Eliminated</small>}</span>
                    </label>)}
                    {Object.keys(overrides).length > 0 && <button type="button" className="empire-action" onClick={() => onView({ leagueScope: accountKey, leagueOverrides: {} })}>Reset league filters</button>}
                </div>
            </details>}
            <label className="empire-lens-basis">
                <select aria-label="Compare by" value={basis} onChange={event => onView({ basis: event.target.value, scroll: 0 })}>
                    <option value="projected">Weekly projections</option>
                    <option value="average">Season averages</option>
                </select>
            </label>
        </div>
        {error && <p role="alert" className="empire-lens-status">{error}</p>}
        {!groups.length && !error && <p role="status" className="empire-lens-status">{caption}</p>}
        {groups.length > 0 && <div className="wr-roster-mobile-player-list empire-lens-roster" aria-label="Players across leagues" aria-busy={loading}>
            {groups.map(group => <section key={group.position} className="wr-roster-mobile-player-group">
                <h2 className="wr-roster-mobile-group-heading"><strong>{group.position}</strong><span>{group.players.length}</span></h2>
                <ul className="wr-roster-mobile-player-rows">
                    {group.players.map(player => <EmpireLensPlayer key={player.pid} player={player} mode={mode} tab={modes[mode].tab}
                        open={expanded === player.pid} onToggle={() => onView({ playerScope: context, expandedPlayer: expanded === player.pid ? null : player.pid })}
                        onOpenLeague={onOpenLeague} />)}
                </ul>
            </section>)}
        </div>}
        {unavailable.length > 0 && <details className="empire-lens-unavailable">
            <summary>{unavailable.length} {unavailable.length === 1 ? 'league' : 'leagues'} unavailable</summary>
            <ul>{unavailable.map(entry => <li key={entry.key}>
                <button type="button" className="empire-lens-drill" onClick={() => onOpenLeague(entry.league, resultFor(entry).status === 'disabled' ? undefined : modes[mode].tab)}>
                    <EmpireLensLeagueMark league={entry.league} /><strong>{entry.league.name || 'League'}</strong><span aria-hidden="true">›</span>
                </button>
                <small>{resultFor(entry).reason || 'Comparison unavailable'}</small>
            </li>)}</ul>
        </details>}
    </section>;
}
window.EmpireLensBoard = EmpireLensBoard;
