// Acquisition previews on the existing roster. Turning a lens off never changes
// roster ownership, lineup selections, list filters, sorting or the saved GM plan.
(function (root) {
    'use strict';
    const WR = root.WR = root.WR || {};
    const text = value => String(value == null ? '' : value);
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const number = value => finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—';
    const signed = value => finite(value) ? (value > 0 ? '+' : '') + number(value) : '—';
    const compactNumber = value => finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
    const pidOf = asset => text(asset?.pid || asset?.id);
    const nameOf = asset => asset?.name || asset?.player?.full_name || 'Player';
    const metricOf = (candidate, horizon) => candidate?.[horizon === 'season' ? 'season' : 'weekly'];
    const normalizeBasis = basis => ['average', 'idp-average'].includes(basis) ? basis : 'projected';
    const dynastyOf = input => ['dynasty', 'keeper', 'empire'].includes(input.skin?.type);
    const futureView = lens => lens.mode === 'trades' && lens.input.skin?.type !== 'redraft' && lens.ui.horizon === 'season';
    const deltaOf = (candidate, horizon) => {
        const metric = metricOf(candidate, horizon);
        return finite(metric?.delta) ? metric.delta : finite(metric?.gain) ? metric.gain : null;
    };
    function account(input) {
        return WR.WaiverPlans?.account?.() || ((root.App?.OD || root.OD)?.getCurrentUserId?.()
            ? 'account:' + (root.App?.OD || root.OD).getCurrentUserId() : input.userId ? 'viewer:' + text(input.userId) : '');
    }
    function identity(input) {
        const league = input.league || {};
        return JSON.stringify([account(input), league._platform || root.S?.platform || 'sleeper',
            text(league.league_id || league.id), text(league.season), text(input.roster?.roster_id)]);
    }
    function signature(input) {
        return JSON.stringify({
            week: root.App?.WeeklyProj?.currentWeek?.() || root.S?.nflState?.week || null,
            revision: input.revision || 0,
            statsSeason: input.statsSeason,
            rosters: (input.league?.rosters || []).map(r => [text(r.roster_id), text(r.owner_id), r.players, r.reserve, r.taxi, r.keepers, r.locked_players, r.settings]),
            roster: [input.roster?.players, input.roster?.reserve, input.roster?.taxi, input.roster?.keepers, input.roster?.locked_players],
            scoring: input.league?.scoring_settings, settings: input.league?.settings, slots: input.league?.roster_positions,
            gm: { mode: input.gm?.mode, saved: input.gm?.hasStrategy, untouchable: [...(input.gm?.untouchable || [])].map(text).sort(),
                targets: [...(input.gm?.targetPositions || [])].map(text).sort(), sell: [...(input.gm?.sellPositions || [])].map(text).sort(), rules: input.gm?.sellRules },
        });
    }
    const initial = scope => ({ scope, mode: 'off', horizon: 'week', basis: 'projected', selected: null, exploreMode: null, review: false, bid: '', notice: '', error: false });
    function ranked(candidates, horizon) {
        return (candidates || []).slice().sort((a, b) => {
            const av = deltaOf(a, horizon), bv = deltaOf(b, horizon);
            return (bv == null ? -Infinity : bv) - (av == null ? -Infinity : av);
        });
    }
    function budget(input) {
        const configured = input.league?.settings?.waiver_budget, spent = input.roster?.settings?.waiver_budget_used;
        const known = value => value != null && text(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
        return known(configured) && known(spent) ? Math.max(0, Number(configured) - Number(spent)) : null;
    }
    const usesBids = input => input.league?.settings?.waiver_budget != null && Number(input.league.settings.waiver_budget) > 0;
    function recentForm(input, pid) {
        const WP = root.App?.WeeklyProj, league = input.league || {};
        const expected = WP?.weeklyPointsScope?.(league.league_id || league.id, league.season, league.scoring_settings);
        return expected && root.S?.weeklyPlayerPointsScope === expected ? WP.formStats?.(pid, 5)?.rollingPPG : null;
    }
    function useLens(input) {
        const scope = identity(input), dataSignature = signature(input);
        const [state, setState] = React.useState(() => initial(scope));
        const [load, setLoad] = React.useState({ key: '', value: null });
        const [seasonLoad, setSeasonLoad] = React.useState({ key: '', value: null });
        const [tick, refresh] = React.useState(0);
        const [retry, setRetry] = React.useState(0);
        const sequence = React.useRef(0);
        const seasonSequence = React.useRef(0);
        const seasonCache = React.useRef(new Map());
        const references = React.useRef({ values: null, revision: 0 });
        const values = [input.players, input.statsData, input.priorData, input.league?.rosters];
        if (!references.current.values || values.some((value, index) => value !== references.current.values[index])) {
            references.current = { values, revision: references.current.revision + 1 };
        }
        // Scope is checked during render too, so old recommendations never flash
        // for a newly selected account or league before its reset effect runs.
        const scopedUi = state.scope === scope ? state : initial(scope);
        const basis = normalizeBasis(scopedUi.basis);
        const allowSeasonView = input.skin?.type !== 'chopped' && (basis === 'projected' || scopedUi.mode === 'trades' && dynastyOf(input));
        const ui = { ...scopedUi, basis, horizon: allowSeasonView ? scopedUi.horizon : 'week' };
        const allowed = !!input.isPro && !!input.roster && !!account(input);
        const canTrade = input.skin?.features?.showTrades !== false && input.skin?.type !== 'chopped' && Number(input.league?.settings?.disable_trades || 0) !== 1;
        const mode = allowed && (ui.mode !== 'trades' || canTrade) ? ui.mode : 'off';
        const key = JSON.stringify([scope, dataSignature, references.current.revision, tick, retry, mode, ui.exploreMode, basis]);
        const live = React.useRef(null);
        live.current = { key, scope, input, ui, mode };
        const result = load.key === key ? load.value : null;
        const options = mode === 'trades' && ui.horizon === 'week' ? (result?.candidates || []) : ranked(result?.candidates, ui.horizon);
        const baseSelected = options.find(candidate => candidate.id === ui.selected) || null;
        const seasonKey = JSON.stringify([key, baseSelected?.id]);
        const lazySeason = seasonLoad.key === seasonKey ? seasonLoad.value?.season : null;
        const seasonNeeded = mode === 'trades' && basis === 'projected' && input.skin?.type === 'redraft' && ui.horizon === 'season' && !!baseSelected;
        const selected = baseSelected && seasonNeeded ? { ...baseSelected, season: lazySeason || { status: 'loading', reason: 'Comparing the remaining season…' } } : baseSelected;
        const update = patch => setState(previous => ({ ...(previous.scope === scope ? previous : initial(scope)), ...patch }));
        function isCurrent(candidate) {
            const current = live.current;
            const activeLeagueId = root.S?.currentLeagueId;
            return current?.key === key && current.scope === identity(current.input) && signature(current.input) === dataSignature && current.mode === mode && mode !== 'off'
                && (!activeLeagueId || text(activeLeagueId) === text(input.league?.league_id || input.league?.id))
                && !!result && load.key === key && result.candidates?.some(item => item.id === candidate?.id);
        }
        React.useEffect(() => {
            const changed = () => refresh(value => value + 1);
            const events = ['wr:gm-mode-changed', 'wr:alex-settings-changed', 'wr:player-tags-changed', 'wr:projections-loaded', 'wr:ros-market-loaded', 'wr:roster-data-updated', 'wr:auth-changed'];
            events.forEach(event => root.addEventListener(event, changed));
            return () => events.forEach(event => root.removeEventListener(event, changed));
        }, []);
        React.useEffect(() => {
            if (state.scope !== scope) setState(initial(scope));
        }, [scope]);
        React.useEffect(() => {
            const request = ++sequence.current;
            let cancelled = false;
            if (mode === 'off') { setLoad({ key, value: null }); return () => { cancelled = true; }; }
            const service = root.App?.[mode === 'waivers' ? 'RosterWaiverLens' : 'RosterTradeLens'];
            setLoad({ key, value: { status: 'loading', candidates: [] } });
            const opts = { league: input.league, roster: input.roster, rosters: input.league?.rosters, players: input.players,
                statsData: input.statsData, statsSeason: input.statsSeason, priorData: input.priorData, priorStatsData: input.priorData, userId: input.userId,
                projectionsData: text(root.S?.currentLeagueId) === text(input.league?.league_id || input.league?.id) ? root.S?.projectionsData : undefined,
                accountKey: account(input), skin: input.skin, gm: input.gm, exploreMode: ui.exploreMode,
                horizon: 'week', basis, revision: dataSignature };
            Promise.resolve().then(() => {
                if (!service?.load) throw new Error('The acquisition comparison has not loaded. Try again.');
                return service.load(opts);
            }).then(value => {
                if (cancelled || request !== sequence.current || live.current?.key !== key || identity(input) !== scope) return;
                const next = value && Array.isArray(value.candidates) ? value : { status: 'unavailable', reason: 'No verified comparison was returned.', candidates: [] };
                setLoad({ key, value: next });
            }).catch(error => {
                if (!cancelled && request === sequence.current && live.current?.key === key && identity(input) === scope)
                    setLoad({ key, value: { status: 'unavailable', reason: error?.message || 'The comparison could not be loaded.', candidates: [] } });
            });
            return () => { cancelled = true; };
        }, [key]);
        React.useEffect(() => {
            const request = ++seasonSequence.current;
            let cancelled = false;
            if (!seasonNeeded || !result || result.status === 'loading') return () => { cancelled = true; };
            const cached = seasonCache.current.get(seasonKey);
            if (cached) { setSeasonLoad({ key: seasonKey, value: cached }); return () => { cancelled = true; }; }
            setSeasonLoad({ key: seasonKey, value: { season: { status: 'loading', reason: 'Comparing the remaining season…' } } });
            const service = root.App?.RosterTradeLens;
            const opts = { league: input.league, roster: input.roster, rosters: input.league?.rosters, players: input.players,
                statsData: input.statsData, statsSeason: input.statsSeason, priorData: input.priorData, priorStatsData: input.priorData, userId: input.userId,
                accountKey: account(input), gm: input.gm, skin: input.skin, exploreMode: ui.exploreMode,
                basis, revision: dataSignature,
                projectionsData: text(root.S?.currentLeagueId) === text(input.league?.league_id || input.league?.id) ? root.S?.projectionsData : undefined,
                result, candidateId: baseSelected.id };
            Promise.resolve().then(() => service?.loadSeason ? service.loadSeason(opts) : { season: { status: 'unavailable', reason: 'Remaining-season analysis has not loaded.' } }).then(value => {
                if (cancelled || request !== seasonSequence.current || live.current?.key !== key || identity(input) !== scope) return;
                seasonCache.current.set(seasonKey, value);
                if (seasonCache.current.size > 8) seasonCache.current.delete(seasonCache.current.keys().next().value);
                setSeasonLoad({ key: seasonKey, value });
            }).catch(() => {
                if (!cancelled && request === seasonSequence.current && live.current?.key === key)
                    setSeasonLoad({ key: seasonKey, value: { season: { status: 'unavailable', reason: 'The season comparison could not be loaded. Open Trade Builder for a full review.' } } });
            });
            return () => { cancelled = true; };
        }, [seasonNeeded, seasonKey, result]);
        const setMode = next => {
            if (!['off', 'waivers', 'trades'].includes(next) || next === 'trades' && !canTrade || !allowed) return;
            update({ mode: next, horizon: 'week', selected: null, review: false, bid: '', notice: '', error: false, exploreMode: null });
        };
        const choose = candidate => {
            if (!isCurrent(candidate)) return;
            const saved = mode === 'waivers' ? WR.WaiverPlans?.get?.(input.league, candidate.pid || pidOf(candidate.incoming?.[0])) : null;
            update({ selected: candidate.id, review: false, bid: saved?.bid == null ? '' : text(saved.bid), notice: '', error: false });
        };
        const clear = () => update({ selected: '', review: false, bid: '', notice: '', error: false });
        const openReview = candidate => {
            if (!isCurrent(candidate)) return;
            update({ selected: candidate.id, review: !ui.review || selected?.id !== candidate.id, notice: '', error: false });
        };
        const savePlan = candidate => {
            if (!isCurrent(candidate) || mode !== 'waivers') return;
            const bid = !usesBids(input) || ui.bid === '' ? null : Number(ui.bid), left = budget(input);
            if (bid != null && (!Number.isInteger(bid) || bid < 0 || left != null && bid > left)) {
                update({ notice: left == null ? 'Use a whole-dollar maximum of zero or more.' : 'Use a whole-dollar maximum from $0 to $' + left + '.', error: true });
                return;
            }
            const incoming = candidate.incoming?.[0];
            const saved = WR.WaiverPlans?.save?.(input.league, { pid: candidate.pid || pidOf(incoming), dropPid: candidate.dropPid,
                bid, position: incoming?.position || incoming?.pos || candidate.player?.position || '', source: 'roster-waiver-lens',
                reason: candidate.reason || 'Roster lens: compare a legal add/drop against this roster.' });
            update({ notice: saved ? 'Private claim plan saved. No claim has been submitted.' : 'The plan could not be saved. Try again in Waivers.', error: !saved });
        };
        const openModule = candidate => {
            if (!isCurrent(candidate)) return;
            if (mode === 'waivers') {
                const context = { ...candidate.handoff, pid: candidate.pid || pidOf(candidate.incoming?.[0]), dropPid: candidate.dropPid,
                    leagueId: text(input.league?.league_id || input.league?.id), source: 'roster-waiver-lens' };
                if (WR.openAcquisition) WR.openAcquisition(context);
                else { WR.acquisitionContext = context; input.setActiveTab?.('fa'); }
            } else {
                const context = root.App?.RosterTradeLens?.toBuilderContext?.(candidate, result) || candidate.builderContext;
                if (!context) { update({ notice: 'This package cannot be opened. Refresh the trade lens.', error: true }); return; }
                root._wrTradeBuilderTarget = { ...context, returnTab: 'myteam', ts: Date.now() };
                input.setActiveTab?.('trades');
                root.dispatchEvent(new root.CustomEvent('wr:open-trade-builder', { detail: root._wrTradeBuilderTarget }));
            }
        };
        const openIncoming = (candidate, asset) => {
            if (!pidOf(asset) || !isCurrent(candidate) || !candidate.incoming?.some(item => pidOf(item) === pidOf(asset))) return;
            if (mode === 'trades') { openModule(candidate); return; }
            const ids = [...new Set([text(candidate.dropPid || pidOf(candidate.outgoing?.[0])), pidOf(asset)].filter(Boolean))];
            if (!ids.length || typeof root.wrComparePlayers !== 'function') {
                update({ notice: 'Player comparison could not be opened. Try again.', error: true });
                return;
            }
            const opened = root.wrComparePlayers(ids, { replace: true, leagueId: text(input.league?.league_id || input.league?.id),
                season: text(input.league?.season), accountKey: account(input), source: 'roster-waiver-lens' });
            if (opened === false) update({ notice: 'This comparison changed. Choose a current move.', error: true });
        };
        const byAnchor = new Map();
        options.forEach(candidate => {
            const anchor = text(candidate.anchorPlayerId || candidate.dropPid || pidOf(candidate.outgoing?.[0]));
            if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
            byAnchor.get(anchor).push(candidate);
        });
        return { input, scope, key, ui, mode, enabled: allowed, canTrade, result, options, selected, byAnchor,
            loading: mode !== 'off' && (!result || result.status === 'loading'), seasonLoading: seasonNeeded && selected?.season?.status === 'loading',
            setMode, choose, clear, openReview, savePlan, openModule, openIncoming,
            setHorizon: horizon => update({ horizon: allowSeasonView ? horizon : 'week', selected: selected?.id || '', notice: '', error: false }),
            setBasis: next => update({ basis: normalizeBasis(next), horizon: 'week', selected: null, review: false, bid: '', notice: '', error: false }),
            explore: next => update({ exploreMode: next, selected: null, review: false, notice: '', error: false }),
            setBid: bid => update({ bid, notice: '', error: false }), retry: () => setRetry(value => value + 1),
        };
    }
    function Gain({ candidate, lens, inline = false }) {
        if (futureView(lens)) {
            const age = candidate.futureFit?.ageDifference;
            return <strong className={'wr-lens-gain wr-lens-age' + (inline ? ' is-inline' : '')}>{finite(age) ? compactNumber(Math.abs(age)) : '—'}<small>{finite(age) ? age > 0 ? 'years younger' : age < 0 ? 'years older' : 'same age' : 'age comparison'}</small></strong>;
        }
        const delta = deltaOf(candidate, lens.ui.horizon);
        return <strong className={'wr-lens-gain' + (delta != null && delta < 0 ? ' is-loss' : '') + (inline ? ' is-inline' : '')}>{signed(delta)}<small>{lens.ui.horizon === 'season' ? 'ROS pts' : candidate.conditionalParticipation ? 'pts if they play' : lens.ui.basis === 'average' ? 'avg pts' : 'lineup pts'}</small></strong>;
    }
    function Impact({ lens }) {
        const candidate = lens.selected, metric = metricOf(candidate, lens.ui.horizon);
        if (candidate && futureView(lens)) return <div className="wr-lens-impact" aria-live="polite"><div><span>Average age · Preview</span><strong>{finite(candidate.futureFit?.outgoingAverageAge) && finite(candidate.futureFit?.incomingAge) ? compactNumber(candidate.futureFit.outgoingAverageAge) + ' → ' + compactNumber(candidate.futureFit.incomingAge) : 'Age unavailable'}</strong></div><Gain candidate={candidate} lens={lens} /></div>;
        const usable = finite(metric?.before) && finite(metric?.after) && deltaOf(candidate, lens.ui.horizon) != null;
        const week = lens.result?.timing?.fromWeek || lens.result?.week;
        const label = lens.ui.horizon === 'season' ? 'Season lineup' : lens.ui.basis === 'average' ? text(lens.input.league?.season) + ' avg lineup'
            : lens.ui.basis === 'idp-average' ? 'IDP avg + projections' : week ? 'Week ' + week + ' lineup' : 'Projected lineup';
        return <div className="wr-lens-impact" aria-live="polite">
            <div><span>{label} · Preview</span>
                {usable ? <strong>{number(metric.before)} <span aria-hidden="true">→</span> {number(metric.after)}</strong> : <strong className="wr-lens-unavailable">{lens.seasonLoading ? 'Comparing the season…' : candidate ? 'Comparison unavailable' : 'Choose a move to compare'}</strong>}
            </div>{candidate && <Gain candidate={candidate} lens={lens} />}
        </div>;
    }
    function Controls({ lens, inlinePids, compact = false }) {
        if (!lens?.enabled) return null;
        const active = lens.mode !== 'off', result = lens.result, selected = lens.selected;
        const anchor = text(selected?.anchorPlayerId || selected?.dropPid || pidOf(selected?.outgoing?.[0]));
        const inline = !!anchor && inlinePids?.has(anchor);
        const fallbackOptions = compact || !inlinePids ? lens.options : lens.options.filter(candidate =>
            !inlinePids.has(text(candidate.anchorPlayerId || candidate.dropPid || pidOf(candidate.outgoing?.[0]))));
        const strategy = result?.strategy;
        const dynasty = dynastyOf(lens.input);
        const showHorizon = lens.input.skin?.type !== 'chopped' && (lens.ui.basis === 'projected' || lens.mode === 'trades' && dynasty);
        return <section className={'wr-roster-lens' + (active ? ' is-on' : '')} data-lens={lens.mode} aria-label="Roster acquisition lenses">
            <div className="wr-lens-switch" role="group" aria-label="Roster lens">
                <button type="button" aria-pressed={!active} onClick={() => lens.setMode('off')}>Lens off</button>
                <button type="button" aria-pressed={lens.mode === 'waivers'} onClick={() => lens.setMode('waivers')}>Waivers</button>
                <button type="button" aria-pressed={lens.mode === 'trades'} disabled={!lens.canTrade} onClick={() => lens.setMode('trades')}>Trades{!lens.canTrade ? ' off' : ''}</button>
            </div>
            {active && <React.Fragment>
                <div className="wr-lens-context">
                    {lens.mode === 'trades' && dynasty && <label className="wr-lens-strategy"><span>{strategy?.source === 'saved' || lens.input.gm?.hasStrategy ? 'Saved plan' : 'GM direction'}: <strong>{strategy?.savedLabel || lens.input.gm?.modeLabel || 'Compete'}</strong></span>
                        <select aria-label="Explore a trade strategy without saving it" value={lens.ui.exploreMode || ''} onChange={event => lens.explore(event.target.value || null)}><option value="">Follow my plan</option><option value="win_now">Explore win now</option><option value="rebuild">Explore rebuild</option><option value="compete">Explore compete</option></select>
                    </label>}
                    <div className="wr-lens-tools"><select className="wr-lens-basis" aria-label="Point comparison basis" value={lens.ui.basis} onChange={event => lens.setBasis(event.target.value)}><option value="projected">Projected</option><option value="average">Avg points</option><option value="idp-average">IDP avg</option></select>
                        {showHorizon && <div className="wr-lens-horizons" role="group" aria-label="Acquisition projection horizon"><button type="button" aria-pressed={lens.ui.horizon === 'week'} onClick={() => lens.setHorizon('week')}>{lens.mode === 'trades' ? 'Next full week' : 'This week'}</button><button type="button" aria-pressed={lens.ui.horizon === 'season'} onClick={() => lens.setHorizon('season')}>{lens.mode === 'trades' && dynasty ? 'Future fit' : 'Season'}</button></div>}
                    </div>
                </div>
                {lens.loading ? <p className="wr-lens-status" role="status">Finding {lens.mode === 'waivers' ? 'waiver moves' : 'trade fits'}…</p> : result?.status === 'unavailable' || result?.status === 'disabled' ? <div className="wr-lens-status" role="status"><p>{result.reason || 'This comparison is not available for the current league.'}</p><button type="button" onClick={lens.retry}>Try again</button></div> : <React.Fragment>
                    {result?.participationNotice && <p className="wr-lens-note" role="status">{result.participationNotice}</p>}
                    {selected && (!inline || compact) && <Impact lens={lens} />}
                    {!selected && lens.ui.selected && <p className="wr-lens-note" role="status">Move no longer available. Choose another.</p>}
                    {!lens.options.length ? <p className="wr-lens-status" role="status">{result?.reason || 'No upgrades found.'}</p> : <React.Fragment>
                        {(!inline || compact) && selected && <Preview lens={lens} candidate={selected} />}
                        {fallbackOptions.some(candidate => candidate.id !== selected?.id) && <div className="wr-lens-alternatives" aria-label="Other acquisition ideas">{fallbackOptions.filter(candidate => candidate.id !== selected?.id).slice(0, 4).map(candidate => {
                            const sourceName = candidate.outgoing?.map(nameOf).join(' + ') || 'Open roster spot';
                            return <button type="button" key={candidate.id} data-lens-peek={candidate.id} aria-label={'Preview move for ' + sourceName} onClick={() => lens.choose(candidate)}><span>{sourceName}</span><Gain candidate={candidate} lens={lens} /></button>;
                        })}</div>}
                    </React.Fragment>}
                </React.Fragment>}
            </React.Fragment>}
        </section>;
    }
    function Preview({ lens, candidate, onOpenPlayer, inlineSource = false }) {
        const chosen = lens.selected?.id === candidate.id;
        if (!chosen) return null;
        const incoming = candidate.incoming || [], outgoing = candidate.outgoing || [];
        const trade = lens.mode === 'trades', metric = metricOf(candidate, lens.ui.horizon), partner = candidate.partner;
        const otherDelta = deltaOf(candidate, lens.ui.horizon === 'season' ? 'week' : 'season');
        const left = budget(lens.input);
        return <div className={'wr-lens-preview' + (inlineSource ? ' is-inline' : '')} data-lens-preview={candidate.id} data-lens-state="active" aria-label="Acquisition preview">
            <div className="wr-lens-source" aria-label={trade ? 'Your players in this trade' : 'Your player in this waiver move'}>
                <span>{outgoing.length ? trade ? 'You send' : 'You drop' : 'Open roster spot'}</span>
                {outgoing.length > 0 && <strong>{outgoing.map((asset, index) => <React.Fragment key={pidOf(asset)}>{index > 0 ? ' + ' : ''}{onOpenPlayer ? <button type="button" className="wr-lens-owned-target" aria-label={'Open player details for ' + nameOf(asset)} onClick={event => { event?.stopPropagation(); onOpenPlayer(pidOf(asset)); }}>{nameOf(asset)}</button> : nameOf(asset)}{lens.ui.basis !== 'projected' && <small> · {asset.comparisonBasis === 'average' ? 'Avg' : 'Proj'} {number(asset.projection)}</small>}</React.Fragment>)}</strong>}
            </div>
            <div className="wr-lens-target-label">{trade ? 'You get' : 'You add'}</div>
            <div className="wr-lens-incoming"><div>{incoming.map(asset => <button type="button" className="wr-lens-player-target" key={pidOf(asset)} aria-label={trade ? 'Open trade calculator for ' + nameOf(asset) : 'Compare ' + nameOf(asset) + (outgoing[0] ? ' with ' + nameOf(outgoing[0]) : '')} onClick={event => { event?.stopPropagation(); lens.openIncoming(candidate, asset); }}><strong>{nameOf(asset)}<span className="wr-lens-player-chevron" aria-hidden="true">›</span><small><span className="wr-lens-position" style={{ '--wr-position-color': root.App?.positionColor?.(asset.position || asset.pos) || root.App?.POS_COLORS?.[asset.position || asset.pos] }}>{asset.position || asset.pos}</span>{[asset.team, asset.age != null ? 'Age ' + asset.age : null].filter(Boolean).map(detail => ' · ' + detail)}</small><small className="wr-lens-player-stats"><span title={asset.comparisonBasis === 'average' ? [asset.averageSeason || lens.input.league?.season, 'season average', finite(asset.averageGames) ? asset.averageGames + ' games' : ''].filter(Boolean).join(' · ') : undefined}>{asset.comparisonBasis === 'average' ? 'Avg' : trade ? 'W' + lens.result?.week + ' proj' : 'Proj'} <b>{number(asset.projection)}</b>{asset.comparisonBasis === 'average' && finite(asset.averageGames) && <small>{compactNumber(asset.averageGames)} games</small>}</span><span>L5 PPG <b>{number(recentForm(lens.input, pidOf(asset)))}</b></span></small></strong></button>)}</div>{!inlineSource && <Gain candidate={candidate} lens={lens} />}</div>
            <div className="wr-lens-costs">
                {!trade && usesBids(lens.input) && lens.ui.bid !== '' && <p className="wr-lens-price"><span>Max bid</span> ${lens.ui.bid}</p>}
                {trade && candidate.price && finite(candidate.price.delta) && <p className="wr-lens-price"><span>Value change</span> {candidate.price.delta > 0 ? '+' : ''}{compactNumber(candidate.price.delta)} {candidate.price.unit || 'value'}</p>}
            </div>
            {inlineSource && <Impact lens={lens} />}
            {!trade && lens.input.skin?.type !== 'chopped' && otherDelta < 0 && <p className="wr-lens-other-horizon is-loss">{lens.ui.horizon === 'season' ? 'This week' : 'Rest of season'}: {signed(otherDelta)} lineup pts</p>}
            {!futureView(lens) && (!finite(metric?.before) || !finite(metric?.after)) && <p className="wr-lens-note">{metric?.reason || 'Projection unavailable.'}</p>}
            {trade && <div className="wr-lens-trade-facts" aria-label="Trade value and acceptance">
                <p><strong>Trade with {partner?.name || 'Unknown manager'}</strong></p>
                <p>You send <strong>{finite(candidate.price?.give) ? candidate.price.give.toLocaleString() : 'Unavailable'} {candidate.price?.unit === 'DHQ' ? 'DHQ' : 'season value'}</strong> · You get <strong>{finite(candidate.price?.receive) ? candidate.price.receive.toLocaleString() : 'Unavailable'} {candidate.price?.unit === 'DHQ' ? 'DHQ' : 'season value'}</strong></p>
                {finite(candidate.price?.give) && finite(candidate.price?.receive) && <p>Total exchanged: <strong>{(candidate.price.give + candidate.price.receive).toLocaleString()} {candidate.price.unit === 'DHQ' ? 'DHQ' : 'season value'}</strong></p>}
                <p>Estimated acceptance: <strong>{finite(candidate.acceptance?.likelihood) ? candidate.acceptance.likelihood + '%' : 'Unavailable'}</strong>{finite(lens.result?.strategy?.acceptanceFloor) && <span> · Your minimum {lens.result.strategy.acceptanceFloor}%</span>}</p>
            </div>}
            <div className="wr-lens-actions"><button type="button" className="wr-lens-primary" onClick={() => lens.openReview(candidate)} aria-expanded={lens.ui.review}>{trade ? 'Review trade' : 'Review claim'}</button><button type="button" onClick={lens.clear}>Close</button></div>
            {lens.ui.review && <section className="wr-lens-review" aria-label={trade ? 'Review trade package' : 'Review waiver claim plan'}>
                {!trade && lens.input.skin?.type !== 'chopped' && otherDelta != null && otherDelta >= 0 && <p className="wr-lens-other-horizon">{lens.ui.horizon === 'season' ? 'This week' : 'Rest of season'}: {signed(otherDelta)} lineup pts</p>}
                {!trade && futureView(lens) && <p className="wr-lens-note">Age fit only; future performance is not forecast.</p>}
                {!trade && candidate.cautions?.length > 0 && <ul>{candidate.cautions.map((caution, index) => <li key={index}>{typeof caution === 'string' ? caution : caution.text || caution.reason || ''}</li>)}</ul>}
                {!trade && usesBids(lens.input) && <label className="wr-lens-bid">Planned max bid <span>$<input type="number" min="0" max={left == null ? undefined : left} step="1" inputMode="numeric" aria-label="Planned maximum waiver bid" placeholder="Not set" value={lens.ui.bid} onChange={event => lens.setBid(event.target.value)} /></span><small>{left == null ? 'Remaining budget unavailable' : '$' + left + ' remaining'}</small></label>}
                <div className="wr-lens-actions">{!trade && <button type="button" className="wr-lens-primary" onClick={() => lens.savePlan(candidate)}>Save claim plan</button>}<button type="button" className={trade ? 'wr-lens-primary' : ''} onClick={() => lens.openModule(candidate)}>{trade ? 'Open in Trade Builder' : 'Open in Waivers'}</button></div>
                {lens.ui.notice && <p className={'wr-lens-feedback' + (lens.ui.error ? ' is-error' : '')} role={lens.ui.error ? 'alert' : 'status'}>{lens.ui.notice}</p>}
            </section>}
            {!lens.ui.review && lens.ui.notice && <p className={'wr-lens-feedback' + (lens.ui.error ? ' is-error' : '')} role={lens.ui.error ? 'alert' : 'status'}>{lens.ui.notice}</p>}
        </div>;
    }
    function Row({ lens, pid, onOpenPlayer, inlineSummary = false }) {
        if (!lens || lens.mode === 'off' || lens.loading) return null;
        const candidates = lens.byAnchor.get(text(pid)) || [];
        const selected = candidates.some(candidate => candidate.id === lens.selected?.id) ? lens.selected : null;
        if (!candidates.length) return null;
        if (inlineSummary && !selected) return null;
        const owned = lens.input.players?.[pid];
        const ownedName = owned?.full_name || [owned?.first_name, owned?.last_name].filter(Boolean).join(' ')
            || candidates.flatMap(candidate => candidate.outgoing || []).find(asset => pidOf(asset) === text(pid))?.name || 'your player';
        return <div id={'roster-lens-' + pid} className="wr-lens-row" data-lens={lens.mode} data-lens-state={selected ? 'active' : 'available'}>
            {!selected ? <button type="button" className="wr-lens-peek" data-lens-peek={candidates[0].id} aria-label={'Preview move for ' + ownedName} aria-expanded={false} onClick={() => lens.choose(candidates[0])}><span>Potential gain</span><Gain candidate={candidates[0]} lens={lens} /><span aria-hidden="true">›</span></button> : <React.Fragment>
                <Preview lens={lens} candidate={selected} onOpenPlayer={onOpenPlayer} inlineSource />
                {candidates.length > 2 ? <label className="wr-lens-more">Other ideas for {ownedName}<select aria-label={'Acquisition ideas for ' + ownedName} value={selected.id} onChange={event => { const candidate = candidates.find(item => item.id === event.target.value); if (candidate) lens.choose(candidate); }}><option value="" disabled>Choose a move</option>{candidates.map((candidate, index) => <option key={candidate.id} value={candidate.id}>{candidate.id === selected.id ? candidate.incoming.map(nameOf).join(' + ') : 'Move ' + (index + 1)} · {futureView(lens) ? candidate.futureFit?.label || 'Compare value' : signed(deltaOf(candidate, lens.ui.horizon)) + (lens.ui.horizon === 'season' ? ' ROS pts' : ' lineup pts')}</option>)}</select></label> : candidates.filter(candidate => candidate.id !== selected.id).map(candidate => <button type="button" className="wr-lens-try" key={candidate.id} data-lens-peek={candidate.id} onClick={() => lens.choose(candidate)}><span>Other move</span><Gain candidate={candidate} lens={lens} /><span aria-hidden="true">↓</span></button>)}
            </React.Fragment>}
        </div>;
    }
    WR.RosterLens = { useLens, Controls, Row, Preview, Gain, identity, signature, ranked, metricOf, deltaOf };
})(window);
