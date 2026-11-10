// ── GM Strategy Editor ────────────────────────────────────────────────────────
// Full strategy configuration panel — sets GM strategy that syncs to Scout.
// Depends on: window.GMStrategy (from ReconAI/shared/strategy.js)
//             window.WrStorage / window.WR_KEYS (from core.js)
// ─────────────────────────────────────────────────────────────────────────────

function StrategyEditorTab({ currentLeague, myRoster, playersData, gmStrategy, setGmStrategy }) {
    const leagueId = currentLeague?.league_id || currentLeague?.id;

    // Phone tier (≤767) — layout-only re-pours below (1-col grids, 44px tap
    // targets, WR.ActionBar save strip). Every state write is untouched and
    // every ternary resolves to its original value on desktop. The hook is
    // called unconditionally (order-safe across resizes).
    const _vp = window.WR.useViewport();
    const _phone = !!_vp.isPhone;
    const leagueType = window.App?.LeagueSkin?.build?.({ league: currentLeague })?.type
        || ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty', 3: 'chopped' })[currentLeague?.settings?.type];
    const showDynastyControls = !_phone || ['dynasty', 'empire'].includes(leagueType);

    const getWarRoomStorage = () => window.App?.WrStorage || window.WrStorage || null;
    const getWarRoomKeys = () => window.App?.WR_KEYS || window.WR_KEYS || null;
    // Routed through GmMode.effects (leagueId-aware resolveStrategy) rather
    // than a raw window.GMStrategy.getStrategy(leagueId) call — that call
    // silently ignores leagueId at the storage layer and always returns a
    // truthy object (even the untouched default), which made the per-league
    // WrStorage fallback in readSavedStrategy below permanently dead code:
    // this editor could load (and then re-save, permanentizing) a strategy
    // that was actually set for a completely different league.
    const readSharedStrategy = () => {
        try {
            const fx = window.WR?.GmMode?.effects?.(leagueId);
            return (fx && fx.hasStrategy) ? fx.strategy : null;
        } catch (_) {
            return null;
        }
    };
    const readSavedStrategy = () => {
        const storage = getWarRoomStorage();
        const keys = getWarRoomKeys();
        return readSharedStrategy()
            || storage?.get?.(keys?.GM_STRATEGY?.(leagueId))
            || gmStrategy
            || {};
    };
    const normalizePosition = (pos) => {
        if (!pos) return '';
        if (String(pos).toUpperCase() === 'PICKS') return 'PICKS';
        return window.App?.normPos?.(pos) || String(pos).trim().toUpperCase();
    };
    const normalizePositions = (positions) => Array.from(new Set((positions || []).map(normalizePosition).filter(Boolean)));
    const normalizeFaFilters = (f) => ({
        minDhq: Number(f?.minDhq) || 0,
        maxAge: Number(f?.maxAge) || 0,
        requirePrimeYears: !!f?.requirePrimeYears,
        excludePositions: normalizePositions(f?.excludePositions),
    });
    const positionLabel = (pos) => {
        if (pos === 'PICKS') return 'Picks';
        return window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
    };
    const acceptanceFloorFor = (aggression, mode) => {
        const fn = window.WR?.GmMode?.acceptanceFloorFor;
        return typeof fn === 'function' ? fn(aggression, mode) : 75;
    };
    const clampFloor = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(55, Math.min(90, Math.round(n))) : fallback;
    };
    const normalizeDraft = (saved) => {
        const normalize = window.WR?.GmMode?.normalize || ((m) => m || 'compete');
        const mode = normalize(saved.mode) || 'compete';
        const aggression = saved.aggression || 'medium';
        return {
            mode,
            aggression,
            // Explicit, user-editable acceptance floor (Trade Acceptance Floor
            // control). Defaults to the aggression+mode-derived floor when unset.
            acceptanceFloor: clampFloor(saved.acceptanceFloor, acceptanceFloorFor(aggression, mode)),
            draftStyle: saved.draftStyle || 'bpa',
            marketPosture: saved.marketPosture || 'hold',
            timeline: saved.timeline || '2_3_years',
            // saved.alexPersonality (legacy per-strategy voice knob) is
            // deliberately NOT carried into the draft — one canonical Alex voice
            // (owner ruling 2026-07-08). Old synced profiles still carry the
            // field; dropping it here (tolerate, never crash) is the migration.
            targetPositions: normalizePositions(saved.targetPositions),
            sellPositions: normalizePositions(saved.sellPositions),
            sellRules: saved.sellRules || [],
            untouchable: saved.untouchable || saved.untouchables || [],
            faFilters: normalizeFaFilters(saved.faFilters),
            // League FAAB minimum bid override. 0/unset = fall back to the
            // imported platform value everywhere this reads.
            faabMinBid: Math.max(0, Number(saved.faabMinBid) || 0),
        };
    };

    // ── Local draft of strategy (save only on explicit Save) ──────────────────
    // Phase 1: Three canonical presets (Rebuild / Compete / Win Now) + Custom.
    // Selecting a preset auto-bundles downstream variables; Custom unlocks them.
    const [draft, setDraft] = React.useState(() => normalizeDraft(readSavedStrategy()));

    // Saved-state snapshot for the phone ActionBar dirty check. normalizeDraft
    // builds its object literal in a fixed key order, so JSON equality is a
    // stable "draft differs from the saved strategy" signal.
    const [savedSnap, setSavedSnap] = React.useState(() => JSON.stringify(normalizeDraft(readSavedStrategy())));

    React.useEffect(() => {
        const next = normalizeDraft(readSavedStrategy());
        setDraft(next);
        setSavedSnap(JSON.stringify(next));
    }, [leagueId]);

    // Selecting a preset auto-applies its bundled config (incl. re-seeding the
    // acceptance floor from the preset's aggression — "driven by aggression").
    const applyPreset = (modeId) => {
        const preset = window.WR?.GmMode?.getPreset?.(modeId);
        const cfg = { ...(preset?.config || {}) };
        // Presets may still carry a legacy alexPersonality — strip it so it
        // never re-enters the draft/save (single Alex voice, 2026-07-08).
        delete cfg.alexPersonality;
        setDraft(d => ({
            ...d,
            ...cfg,
            mode: modeId,
            acceptanceFloor: acceptanceFloorFor(cfg.aggression || d.aggression, modeId),
        }));
    };
    const isCustom = draft.mode === 'custom';

    const [syncStatus, setSyncStatus] = React.useState('idle'); // idle | saving | saved | error
    const [newSellRule, setNewSellRule] = React.useState('');
    const [untouchableSearch, setUntouchableSearch] = React.useState('');
    const [showUntouchablePicker, setShowUntouchablePicker] = React.useState(false);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const set = (key, val) => setDraft(d => ({ ...d, [key]: val }));

    // Draft Archetype options — sourced from draft-gameplan.js (single source
    // of truth for the 8 keys/labels/blurbs; also shown on the War Room's
    // Draft Gameplan card), not a hardcoded duplicate list here.
    const archetypeOptions = React.useMemo(() => {
        if (!window.App?.DraftGameplan?.archetypes) return [];
        const rp = currentLeague?.roster_positions || [];
        const slots = window.App.DraftGameplan.parseSlots ? window.App.DraftGameplan.parseSlots(rp) : {};
        const superflex = (slots.sf > 0 || slots.qb >= 2);
        return window.App.DraftGameplan.archetypes({ superflex });
    }, [currentLeague]);

    const toggleArr = (key, val) => setDraft(d => {
        const arr = d[key] || [];
        return { ...d, [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] };
    });

    // Free-agency filter helpers (nested under draft.faFilters).
    const setFa = (key, val) => setDraft(d => ({ ...d, faFilters: { ...(d.faFilters || {}), [key]: val } }));
    const toggleFaPos = (pos) => setDraft(d => {
        const cur = (d.faFilters || {}).excludePositions || [];
        const next = cur.includes(pos) ? cur.filter(x => x !== pos) : [...cur, pos];
        return { ...d, faFilters: { ...(d.faFilters || {}), excludePositions: next } };
    });

    // ── Save ──────────────────────────────────────────────────────────────────
    const handleSave = async () => {
        setSyncStatus('saving');
        const payload = { ...draft, lastSyncedFrom: 'warroom', leagueId };
        try {
            let savedPayload = payload;
            if (window.GMStrategy?.saveStrategy) {
                savedPayload = await window.GMStrategy.saveStrategy(payload) || payload;
            }
            const storage = getWarRoomStorage();
            const keys = getWarRoomKeys();
            if (storage && keys?.GM_STRATEGY) {
                storage.set(keys.GM_STRATEGY(leagueId), savedPayload);
            }
            window._wrGmStrategy = savedPayload;
            if (setGmStrategy) setGmStrategy(savedPayload);
            // Phase 1: broadcast mode change so the header card + engines pick it up
            window.dispatchEvent(new CustomEvent('wr:gm-mode-changed', { detail: { mode: savedPayload.mode, strategy: savedPayload } }));
            // Phone ActionBar dirty check: the working draft is now the saved
            // strategy (desktop-inert — savedSnap only feeds the phone bar).
            setSavedSnap(JSON.stringify(draft));
            setSyncStatus('saved');
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch (e) {
            console.error('GMStrategy save error', e);
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    // ── Roster players for untouchables picker ────────────────────────────────
    const rosterPlayers = React.useMemo(() => {
        const pids = myRoster?.players || [];
        if (!pids.length || !playersData) return [];
        return pids
            .filter(pid => pid && pid !== '0')
            .map(pid => {
                const pd = playersData[pid] || {};
                return {
                    id: pid,
                    name: pd.full_name || pd.name || pid,
                    pos: pd.position || '?',
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [myRoster, playersData]);

    const filteredRoster = React.useMemo(() => {
        if (!untouchableSearch.trim()) return rosterPlayers;
        const q = untouchableSearch.toLowerCase();
        return rosterPlayers.filter(p => p.name.toLowerCase().includes(q) || p.pos.toLowerCase().includes(q));
    }, [rosterPlayers, untouchableSearch]);

    const untouchableNames = React.useMemo(() => {
        return (draft.untouchable || []).map(id => {
            const p = rosterPlayers.find(r => r.id === id);
            return p ? p.name : id;
        });
    }, [draft.untouchable, rosterPlayers]);

    // ── Sync badge ─────────────────────────────────────────────────────────────
    const SyncBadge = () => {
        if (syncStatus === 'saving') return (
            <span style={styles.badge('var(--acc-line1, rgba(212,175,55,0.2))', 'var(--k-d4af37, #d4af37)')}>Saving…</span>
        );
        if (syncStatus === 'saved') return (
            <span style={styles.badge('rgba(46,204,113,0.15)', 'var(--k-2ecc71, #2ecc71)')}>✓ Synced to Scout</span>
        );
        if (syncStatus === 'error') return (
            <span style={styles.badge('rgba(231,76,60,0.15)', 'var(--k-e74c3c, #e74c3c)')}>Save failed</span>
        );
        return null;
    };

    // ── Section header ────────────────────────────────────────────────────────
    const SectionHeader = ({ title, sub }) => (
        <div style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-body, 1rem)', color: 'var(--acc-line4, rgba(212,175,55,0.6))', letterSpacing: '0.16em', textTransform: 'uppercase' }}>{title}</div>
            {sub && <div data-mobile-caption style={{ fontSize: 'var(--text-label)', color: 'var(--ov-8, rgba(255,255,255,0.4))', marginTop: 2 }}>{sub}</div>}
        </div>
    );

    // ── Pill selector ─────────────────────────────────────────────────────────
    const PillGroup = ({ options, value, onChange, fullWidth }) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {options.map(opt => {
                const active = value === opt.value;
                return (
                    <button key={opt.value} onClick={() => onChange(opt.value)} style={{
                        padding: '12px 16px',
                        minHeight: 44,
                        border: active ? '1px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.12))',
                        borderRadius: 6,
                        background: active ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'var(--ov-3, rgba(255,255,255,0.04))',
                        color: active ? 'var(--gold)' : 'var(--ov-9, rgba(255,255,255,0.65))',
                        fontSize: 'var(--text-body, 1rem)',
                        fontFamily: 'var(--font-body)',
                        fontWeight: active ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        flex: fullWidth ? 1 : undefined,
                        textAlign: 'center',
                    }}>
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );

    // ── Multi-select pills ────────────────────────────────────────────────────
    const MultiSelect = ({ options, value, onChange }) => (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {options.map(opt => {
                const active = (value || []).includes(opt);
                return (
                    <button key={opt} onClick={() => onChange(opt)} style={{
                        padding: '10px 14px',
                        minHeight: 44,
                        border: active ? '1px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                        borderRadius: 5,
                        background: active ? 'var(--acc-fill3, rgba(212,175,55,0.18))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                        color: active ? 'var(--gold)' : 'var(--ov-9, rgba(255,255,255,0.55))',
                        fontSize: 'var(--text-label)',
                        fontFamily: 'var(--font-body)',
                        fontWeight: active ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.13s',
                    }}>
                        {positionLabel(opt)}
                    </button>
                );
            })}
        </div>
    );

    const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'PICKS'];

    // ── Mode configs (Phase 1: 3 canonical presets + Custom) ──────────────────
    const MODES = [
        { value: 'rebuild',  label: 'Rebuild',  desc: 'Youth, picks, and patience.', color: 'var(--k-3498db, #3498db)' },
        { value: 'compete',  label: 'Compete',  desc: 'Build long-term while staying competitive.', color: 'var(--k-d4af37, #d4af37)' },
        { value: 'win_now',  label: 'Win Now',  desc: 'Spend it all to win this year.', color: 'var(--k-e74c3c, #e74c3c)' },
        { value: 'custom',   label: 'Custom',   desc: 'Hand-tune every variable below.', color: 'var(--k-7c6bf8, #7c6bf8)' },
    ];

    const AGGRESSION = [
        { value: 'conservative', label: 'Conservative', desc: 'Wait for value, never overpay.' },
        { value: 'medium',       label: 'Medium',        desc: 'Calculated moves, balanced risk.' },
        { value: 'aggressive',   label: 'Aggressive',    desc: 'Make the big swing, force the deal.' },
    ];

    const DRAFT_STYLES = [
        { value: 'accumulate',       label: 'Accumulate',       desc: 'Stack picks, build depth.' },
        { value: 'consolidate',      label: 'Consolidate',      desc: 'Package depth into elite talent.' },
        { value: 'positional_need',  label: 'Positional Need',  desc: 'Fill the weakest spots first.' },
        { value: 'bpa',              label: 'BPA',              desc: 'Best player available, always.' },
    ];

    const MARKET_POSTURES = [
        { value: 'buy_low',   label: 'Buy Low',   desc: 'Target undervalued assets and injured players.' },
        { value: 'sell_high', label: 'Sell High', desc: 'Move players at peak value before decline.' },
        { value: 'hold',      label: 'Hold',      desc: 'Patient, only trade from a position of strength.' },
        { value: 'exploit',   label: 'Exploit',   desc: 'Identify and attack league-wide market inefficiencies.' },
    ];

    const TIMELINES = [
        { value: '1_year',       label: '1 Year',       desc: 'All chips on this season.' },
        { value: '2_3_years',    label: '2–3 Years',    desc: 'Medium-term contention window.' },
        { value: 'dynasty_long', label: 'Dynasty Long', desc: 'Build a program, not just a season.' },
    ];

    const currentMode = MODES.find(m => m.value === draft.mode);
    const currentAggression = AGGRESSION.find(a => a.value === draft.aggression);

    // ── Recommended mode — derived from the user's own team assessment ─────────
    // window.WR.GmMode.recommendMode is the single implementation (also used by
    // Analytics' "Suggested Mode" fallback) so the two surfaces never disagree.
    // Advisory only — never auto-applies.
    // Pro-only (gate-map row 17): the "★ Recommended for your roster" hint is a
    // derived recommendation (tier read); the rest of the editor is build/set
    // and stays free. Clean absence for free — teamRec null hides chip + line.
    const teamRec = React.useMemo(() => {
        try {
            if (typeof window.wrIsPro === 'function' && !window.wrIsPro()) return null;
            const rid = myRoster?.roster_id;
            const a = (rid != null && window.assessTeamFromGlobal) ? window.assessTeamFromGlobal(rid) : null;
            if (!a) return null;
            const mode = window.WR?.GmMode?.recommendMode ? window.WR.GmMode.recommendMode(a) : 'compete';
            return { mode, tierLabel: a.tier ? String(a.tier) : null, health: Number(a.healthScore) || 0 };
        } catch (_) { return null; }
    }, [myRoster, playersData]);
    const recommendedMode = teamRec?.mode || null;

    // Phone 44px tap-target aliases — desktop passes the original shared
    // style objects through untouched — plus the ActionBar dirty flag
    // (JSON.stringify only runs on the phone tier).
    const inputStyle = _phone ? { ...styles.input, minHeight: 44 } : styles.input;
    const addBtnStyle = _phone ? { ...styles.addBtn, minHeight: 44 } : styles.addBtn;
    const tagXStyle = _phone ? { ...styles.tagX, minWidth: 44, minHeight: 44 } : styles.tagX;
    const dropdownItemStyle = _phone ? { ...styles.dropdownItem, minHeight: 44 } : styles.dropdownItem;
    const _dirty = _phone ? JSON.stringify(draft) !== savedSnap : false;

    // ── Roster Cutdown Day — independent of the GM Strategy blob above: it's
    // a league fact, not a preference, so it saves immediately
    // (window.App.RosterCutdown) rather than riding the Save Strategy
    // button/dirty flag. The "league's rule" checkbox just tags who set it
    // (setBy 'commissioner' vs 'owner') for display — there's no cross-owner
    // sync in this app (see js/shared/roster-cutdown.js), so either framing
    // is recorded on this device only.
    const [cutdownRule, setCutdownRuleState] = React.useState(() => window.App?.RosterCutdown?.getRule?.(leagueId) || null);
    const [cutdownDraft, setCutdownDraft] = React.useState(() => {
        const r = window.App?.RosterCutdown?.getRule?.(leagueId);
        return { activeSlots: r?.activeSlots || '', taxiSlots: r?.taxiSlots || '', effectiveDate: r?.effectiveDate || '' };
    });
    const [cutdownIsRule, setCutdownIsRule] = React.useState(() => window.App?.RosterCutdown?.getRule?.(leagueId)?.setBy === 'commissioner');
    const [cutdownSaved, setCutdownSaved] = React.useState(false);
    React.useEffect(() => {
        const r = window.App?.RosterCutdown?.getRule?.(leagueId) || null;
        setCutdownRuleState(r);
        setCutdownDraft({ activeSlots: r?.activeSlots || '', taxiSlots: r?.taxiSlots || '', effectiveDate: r?.effectiveDate || '' });
        setCutdownIsRule(r?.setBy === 'commissioner');
    }, [leagueId]);
    const cutdownStatus = window.App?.RosterCutdown?.status?.(cutdownRule, Date.now()) || null;
    function saveCutdownRule() {
        if (typeof window.App?.RosterCutdown?.setRule !== 'function') return;
        const rec = window.App.RosterCutdown.setRule(leagueId, cutdownDraft, cutdownIsRule ? 'commissioner' : 'owner');
        if (rec) { setCutdownRuleState(rec); setCutdownSaved(true); setTimeout(() => setCutdownSaved(false), 2000); }
    }
    function clearCutdownRule() {
        if (typeof window.App?.RosterCutdown?.clearRule !== 'function') return;
        window.App.RosterCutdown.clearRule(leagueId);
        setCutdownRuleState(null);
        setCutdownDraft({ activeSlots: '', taxiSlots: '', effectiveDate: '' });
    }

    return (
        <div className="wr-strategy-editor" style={{ padding: _phone ? '20px 0 150px' : '20px 0 60px', width: '100%', maxWidth: 'none', margin: 0 }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
                <div>
                    <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em' }}>{showDynastyControls ? 'GM STRATEGY' : 'GM PLAN'}</div>
                    <div data-mobile-caption style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--ov-8, rgba(255,255,255,0.45))', fontFamily: 'var(--font-body)', marginTop: 2 }}>
                        {showDynastyControls ? 'Set your franchise direction — syncs to Scout so Alex knows how to advise you.' : 'Set waiver preferences and roster priorities.'}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <SyncBadge />
                    <button onClick={handleSave} style={styles.saveBtn(syncStatus === 'saving')}>
                        {syncStatus === 'saving' ? 'Saving…' : showDynastyControls ? 'Save Strategy' : 'Save Plan'}
                    </button>
                </div>
            </div>

            {/* ── Mode (Phase 1: preset-first) ── */}
            {showDynastyControls && <div style={styles.card}>
                {!_phone && <SectionHeader title="Mode" sub={currentMode?.desc + (isCustom ? '' : ' Preset bundles every downstream setting — switch to Custom to tune individually.')} />}
                {_phone ? <label className="wr-strategy-mode-picker">Your direction<select value={draft.mode} onChange={e => e.target.value === 'custom' ? set('mode', 'custom') : applyPreset(e.target.value)}>{MODES.map(m => <option key={m.value} value={m.value}>{m.label}{m.value === recommendedMode ? ' · Suggested' : ''}</option>)}</select><span data-mobile-caption>{currentMode?.desc}</span></label> : <div style={{ display: 'grid', gridTemplateColumns: _phone ? '1fr' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {MODES.map(m => {
                        const active = draft.mode === m.value;
                        return (
                            <button key={m.value} onClick={() => {
                                if (m.value === 'custom') set('mode', 'custom');
                                else applyPreset(m.value);
                            }} style={{
                                padding: '12px 14px',
                                border: active ? `1px solid ${m.color}` : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                borderRadius: 8,
                                background: active ? (wrAlpha(m.color, '18')) : 'var(--ov-2, rgba(255,255,255,0.03))',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s',
                                position: 'relative',
                            }}>
                                <div style={{ position: 'absolute', top: 10, right: 12, width: 8, height: 8, borderRadius: '50%', background: active ? m.color : 'transparent' }} />
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingRight: 14 }}>
                                    <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-body)', fontWeight: 700, color: active ? m.color : 'var(--ov-9, rgba(255,255,255,0.8))', letterSpacing: '0.03em' }}>{m.label}</div>
                                    {m.value === recommendedMode && (
                                        <span title={teamRec?.tierLabel ? `Your roster grades ${teamRec.tierLabel}` : 'Based on your roster'} style={{ fontSize: '0.5rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--gold)', background: 'var(--acc-fill2, rgba(212,175,55,0.16))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.4))', borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', whiteSpace: 'nowrap', lineHeight: 1.4 }}>★ Rec</span>
                                    )}
                                </div>
                                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--ov-8, rgba(255,255,255,0.4))', marginTop: 3, fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>{m.desc}</div>
                            </button>
                        );
                    })}
                </div>}
                {recommendedMode && (
                    <div data-mobile-caption style={{ marginTop: 12, fontSize: 'var(--text-label)', color: 'var(--ov-9, rgba(255,255,255,0.7))', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--gold)', fontWeight: 700 }}>★ Recommended for your roster:</span> {MODES.find(m => m.value === recommendedMode)?.label}
                        {teamRec?.tierLabel ? <> — your team grades <em>{teamRec.tierLabel}</em>.</> : '.'} You can still pick any direction.
                    </div>
                )}
                {!isCustom && (
                    <div data-mobile-caption style={{ marginTop: 14, padding: '10px 12px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 6, fontSize: 'var(--text-label)', color: 'var(--ov-9, rgba(255,255,255,0.7))', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                        <strong style={{ color: 'var(--gold)' }}>Preset applied:</strong> aggression <em>{draft.aggression}</em> · draft <em>{draft.draftStyle}</em> · market <em>{draft.marketPosture}</em> · timeline <em>{TIMELINES.find(t => t.value === draft.timeline)?.label || draft.timeline}</em>
                    </div>
                )}
            </div>}

            {/* ── Trade Acceptance Floor (always visible — drives the Trade Center) ── */}
            <window.WR.MobileSection phone={_phone} title="Trade Acceptance Floor" summary="How likely a partner must be to accept"><div style={styles.card}>
                <SectionHeader title="Trade Acceptance Floor" sub="The minimum acceptance an offer must clear for the Trade Center to call it Playable. Lower = chase more long-shot deals; higher = only safe, fair offers. Seeded by your aggression — drag to fine-tune." />
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '2.1rem', fontWeight: 700, color: 'var(--gold)', minWidth: 90, lineHeight: 1 }}>{draft.acceptanceFloor}%</div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                        <input
                            type="range" min="55" max="90" step="1"
                            value={draft.acceptanceFloor}
                            onChange={e => set('acceptanceFloor', Number(e.target.value))}
                            aria-label="Trade acceptance floor"
                            style={{ width: '100%', accentColor: 'var(--gold)', cursor: 'pointer', height: 32 }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro)', color: 'var(--ov-8, rgba(255,255,255,0.4))', fontFamily: 'var(--font-body)', marginTop: 2 }}>
                            <span>55% · chase long-shots</span>
                            <span>only safe deals · 90%</span>
                        </div>
                    </div>
                </div>
                <div style={{ marginTop: 14 }}>
                    <div style={styles.subLabel}>Quick set</div>
                    <PillGroup
                        options={[{ value: 82, label: 'Conservative · 82%' }, { value: 75, label: 'Balanced · 75%' }, { value: 58, label: 'Aggressive · 58%' }]}
                        value={draft.acceptanceFloor}
                        onChange={v => set('acceptanceFloor', v)}
                    />
                </div>
            </div></window.WR.MobileSection>

            {/* ── Aggression (Custom only) ── */}
            {showDynastyControls && isCustom && <window.WR.MobileSection phone={_phone} title="Aggression" summary="Your appetite for risk"><div style={styles.card}>
                <SectionHeader title="Aggression" sub={(currentAggression?.desc || '') + ' Also re-seeds the acceptance floor above.'} />
                <PillGroup
                    options={AGGRESSION.map(a => ({ value: a.value, label: a.label }))}
                    value={draft.aggression}
                    onChange={v => setDraft(d => ({ ...d, aggression: v, acceptanceFloor: acceptanceFloorFor(v, d.mode) }))}
                    fullWidth
                />
            </div></window.WR.MobileSection>}

            {/* ── FAAB / Waivers ── */}
            <window.WR.MobileSection phone={_phone} title="FAAB / Waivers" summary="Minimum bid and waiver rules"><div style={styles.card}>
                <SectionHeader title="FAAB / Waivers" sub="Your league's minimum waiver bid. Set this when your platform doesn't report it (or reports it wrong) — FAAB Command and Alex's 'offer the minimum' calls pull this number instead." />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono, monospace)', fontSize: '1.1rem', fontWeight: 700 }}>$</span>
                    <input
                        type="number" min="0" step="1"
                        value={draft.faabMinBid || ''}
                        onChange={e => set('faabMinBid', Math.max(0, Math.round(Number(e.target.value) || 0)))}
                        placeholder={String(currentLeague?.settings?.waiver_budget_min ?? 0)}
                        aria-label="Minimum FAAB bid"
                        style={{ ...inputStyle, maxWidth: 120 }}
                    />
                    <span data-mobile-caption style={{ fontSize: 'var(--text-label)', color: 'var(--ov-8, rgba(255,255,255,0.45))', fontFamily: 'var(--font-body)' }}>
                        {draft.faabMinBid > 0
                            ? 'Overriding the imported league setting.'
                            : `Unset — using the imported league setting${currentLeague?.settings?.waiver_budget_min ? ` ($${currentLeague.settings.waiver_budget_min})` : ' (currently $0 — likely not reported by your platform)'}.`}
                    </span>
                </div>
            </div></window.WR.MobileSection>

            {/* ── Roster Cutdown Day ── */}
            {showDynastyControls && <window.WR.MobileSection phone={_phone} title="Roster Cutdown Day" summary="Roster limits and effective date"><div style={styles.card}>
                <SectionHeader title="Roster Cutdown Day" sub="If your league shrinks its roster limits on a set date — an NFL-style cutdown to a smaller active roster + taxi squad — record it here so the Calendar counts it down and My Roster warns you once you're over the new limit." />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', fontSize: 'var(--text-label)', color: 'var(--ov-9, rgba(255,255,255,0.75))', fontFamily: 'var(--font-body)' }}>
                    <input type="checkbox" checked={cutdownIsRule} onChange={e => setCutdownIsRule(e.target.checked)}
                        style={_phone ? { width: 20, height: 20 } : undefined} />
                    This is the league's rule, not just my own note (shows as set by the commissioner if anyone else on this device checks it)
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                    <div>
                        <div style={styles.subLabel}>Active Roster Size</div>
                        <input
                            type="number" min="1" step="1"
                            value={cutdownDraft.activeSlots}
                            onChange={e => setCutdownDraft(d => ({ ...d, activeSlots: e.target.value }))}
                            placeholder="42" aria-label="Active roster size after cutdown"
                            style={{ ...inputStyle, maxWidth: 100 }}
                        />
                    </div>
                    <div>
                        <div style={styles.subLabel}>Taxi Squad Size</div>
                        <input
                            type="number" min="0" step="1"
                            value={cutdownDraft.taxiSlots}
                            onChange={e => setCutdownDraft(d => ({ ...d, taxiSlots: e.target.value }))}
                            placeholder="10" aria-label="Taxi squad size after cutdown"
                            style={{ ...inputStyle, maxWidth: 100 }}
                        />
                    </div>
                    <div>
                        <div style={styles.subLabel}>Effective Date</div>
                        <input
                            type="date"
                            value={cutdownDraft.effectiveDate}
                            onChange={e => setCutdownDraft(d => ({ ...d, effectiveDate: e.target.value }))}
                            aria-label="Cutdown effective date"
                            style={{ ...inputStyle, maxWidth: 170 }}
                        />
                    </div>
                    <button onClick={saveCutdownRule} style={{ ...styles.saveBtn(false), ...(_phone ? { minHeight: 44 } : null) }}>{cutdownSaved ? 'Saved ✓' : 'Save'}</button>
                    {cutdownRule && <button onClick={clearCutdownRule} style={{ ...addBtnStyle, background: 'transparent', color: 'var(--ov-8, rgba(255,255,255,0.5))', borderColor: 'var(--ov-6, rgba(255,255,255,0.12))' }}>Clear</button>}
                </div>
                {cutdownRule && cutdownStatus && (
                    <div style={{ marginTop: 12, fontSize: 'var(--text-label)', color: 'var(--ov-9, rgba(255,255,255,0.7))', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                        <span style={{ color: cutdownStatus.isPast ? 'var(--bad)' : cutdownStatus.isNear ? 'var(--warn)' : 'var(--gold)', fontWeight: 700 }}>
                            {cutdownStatus.isPast ? 'Cutdown day has passed' : `${cutdownStatus.daysUntil} day${cutdownStatus.daysUntil === 1 ? '' : 's'} until cutdown`}
                        </span>
                        {' — ' + cutdownRule.activeSlots + ' active / ' + cutdownRule.taxiSlots + ' taxi (' + (cutdownRule.activeSlots + cutdownRule.taxiSlots) + ' total)'}
                        {cutdownRule.setBy === 'commissioner' ? ' · marked as the league rule.' : ' · personal note.'}
                    </div>
                )}
            </div></window.WR.MobileSection>}

            {/* ── Free Agency Filters ── */}
            <window.WR.MobileSection phone={_phone} title="Free Agency Filters" summary="Age, value and position filters"><div style={styles.card}>
                <SectionHeader title="Free Agency Filters" sub="Tune who shows up in your waiver / FA recommendations. The market explorer still shows everyone." />
                <div style={{ display: 'grid', gridTemplateColumns: _phone ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                    <div>
                        <div style={styles.subLabel}>Minimum DHQ — hide anyone below</div>
                        <PillGroup
                            options={[{ value: 0, label: 'Off' }, { value: 500, label: '500' }, { value: 1000, label: '1,000' }, { value: 2000, label: '2,000' }, { value: 4000, label: '4,000' }]}
                            value={draft.faFilters?.minDhq || 0}
                            onChange={v => setFa('minDhq', v)}
                        />
                    </div>
                    <div>
                        <div style={styles.subLabel}>Max Age — hide older than</div>
                        <PillGroup
                            options={[{ value: 0, label: 'Any' }, { value: 24, label: '≤24' }, { value: 27, label: '≤27' }, { value: 30, label: '≤30' }]}
                            value={draft.faFilters?.maxAge || 0}
                            onChange={v => setFa('maxAge', v)}
                        />
                    </div>
                </div>
                <div style={{ marginTop: 16 }}>
                    <div style={styles.subLabel}>Prime Window</div>
                    <PillGroup
                        options={[{ value: 'any', label: 'Any window' }, { value: 'prime', label: 'Prime years remaining only' }]}
                        value={draft.faFilters?.requirePrimeYears ? 'prime' : 'any'}
                        onChange={v => setFa('requirePrimeYears', v === 'prime')}
                        fullWidth
                    />
                </div>
                <div style={{ marginTop: 16 }}>
                    <div style={styles.subLabel}>Exclude Positions — never recommend</div>
                    <MultiSelect
                        options={['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB']}
                        value={draft.faFilters?.excludePositions}
                        onChange={toggleFaPos}
                    />
                </div>
            </div></window.WR.MobileSection>

            {/* ── Priorities ── */}
            <window.WR.MobileSection phone={_phone} title="Priorities" summary="Targets, sell rules and untouchables"><div style={styles.card}>
                <SectionHeader title="Priorities" />
                <div style={{ display: 'grid', gridTemplateColumns: _phone ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                    {/* Target Positions */}
                    <div>
                        <div style={styles.subLabel}>Target Positions</div>
                        <MultiSelect
                            options={POSITIONS}
                            value={draft.targetPositions}
                            onChange={v => toggleArr('targetPositions', v)}
                        />
                    </div>
                    {/* Sell Positions */}
                    <div>
                        <div style={styles.subLabel}>Sell Positions</div>
                        <MultiSelect
                            options={POSITIONS}
                            value={draft.sellPositions}
                            onChange={v => toggleArr('sellPositions', v)}
                        />
                    </div>
                </div>

                {/* Sell Rules */}
                <div style={{ marginTop: 16 }}>
                    <div style={styles.subLabel}>Sell Rules</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {(draft.sellRules || []).map((rule, i) => (
                            <span key={i} style={styles.tag}>
                                {rule}
                                <button onClick={() => set('sellRules', draft.sellRules.filter((_, j) => j !== i))} style={tagXStyle}>×</button>
                            </span>
                        ))}
                        {draft.sellRules.length === 0 && <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))', fontFamily: 'var(--font-body)' }}>No rules set</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            aria-label="New sell rule"
                            value={newSellRule}
                            onChange={e => setNewSellRule(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && newSellRule.trim()) { set('sellRules', [...draft.sellRules, newSellRule.trim()]); setNewSellRule(''); }}}
                            placeholder='e.g. "Sell RB age 27+"'
                            style={inputStyle}
                        />
                        <button onClick={() => { if (newSellRule.trim()) { set('sellRules', [...draft.sellRules, newSellRule.trim()]); setNewSellRule(''); }}} style={addBtnStyle}>Add</button>
                    </div>
                </div>

                {/* Untouchables */}
                <div style={{ marginTop: 16 }}>
                    <div style={styles.subLabel}>Untouchables</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {untouchableNames.map((name, i) => (
                            <span key={i} style={{ ...styles.tag, borderColor: 'var(--acc-line3, rgba(212,175,55,0.4))', color: 'var(--gold)' }}>
                                🛡 {name}
                                <button onClick={() => set('untouchable', draft.untouchable.filter((_, j) => j !== i))} style={tagXStyle}>×</button>
                            </span>
                        ))}
                        {draft.untouchable.length === 0 && <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))', fontFamily: 'var(--font-body)' }}>No untouchables set</span>}
                    </div>
                    <div style={{ position: 'relative' }}>
                        <input
                            aria-label="Search roster for untouchables"
                            value={untouchableSearch}
                            onChange={e => { setUntouchableSearch(e.target.value); setShowUntouchablePicker(true); }}
                            onFocus={() => setShowUntouchablePicker(true)}
                            placeholder='Search roster…'
                            style={inputStyle}
                        />
                        {showUntouchablePicker && filteredRoster.length > 0 && (
                            <div style={styles.dropdown}>
                                {filteredRoster.slice(0, 12).map(p => (
                                    <button key={p.id} onClick={() => {
                                        if (!draft.untouchable.includes(p.id)) {
                                            set('untouchable', [...draft.untouchable, p.id]);
                                        }
                                        setUntouchableSearch('');
                                        setShowUntouchablePicker(false);
                                    }} style={dropdownItemStyle}>
                                        <span style={{ fontSize: 'var(--text-micro)', color: 'var(--acc-line4, rgba(212,175,55,0.7))', fontFamily: 'var(--font-title)', fontWeight: 700, marginRight: 6 }}>{p.pos}</span>
                                        {p.name}
                                    </button>
                                ))}
                                <button onClick={() => setShowUntouchablePicker(false)} style={{ ...dropdownItemStyle, color: 'var(--ov-8, rgba(255,255,255,0.3))', fontSize: 'var(--text-micro)' }}>Close</button>
                            </div>
                        )}
                    </div>
                </div>
            </div></window.WR.MobileSection>

            {/* ── Draft Style (Custom only) ── */}
            {showDynastyControls && isCustom && <window.WR.MobileSection phone={_phone} title="Draft Style" summary="Your approach to the draft"><div style={styles.card}>
                <SectionHeader title="Draft Style" />
                <div style={{ display: 'grid', gridTemplateColumns: _phone ? '1fr' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {DRAFT_STYLES.map(ds => {
                        const active = draft.draftStyle === ds.value;
                        return (
                            <button key={ds.value} onClick={() => set('draftStyle', ds.value)} style={{
                                padding: '11px 13px',
                                border: active ? '1px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                borderRadius: 8,
                                background: active ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s',
                            }}>
                                <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-body)', fontWeight: 700, color: active ? 'var(--gold)' : 'var(--ov-9, rgba(255,255,255,0.8))' }}>{ds.label}</div>
                                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--ov-8, rgba(255,255,255,0.4))', marginTop: 2, fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>{ds.desc}</div>
                            </button>
                        );
                    })}
                </div>
            </div></window.WR.MobileSection>}

            {/* ── Draft Archetype (Custom only) — which POSITIONS to lean
                 toward (RB Heavy/Zero-RB/etc.), distinct from Draft Style
                 above (pick-CAPITAL philosophy). Feeds the Big Board's AI
                 lane + Mock/Live Draft recommendation scoring. ── */}
            {showDynastyControls && isCustom && archetypeOptions.length > 0 && <window.WR.MobileSection phone={_phone} title="Draft Archetype" summary="Roster construction preferences"><div style={styles.card}>
                <SectionHeader title="Draft Archetype" />
                <div style={{ display: 'grid', gridTemplateColumns: _phone ? '1fr' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {archetypeOptions.map(arch => {
                        const active = (draft.draftArchetype || 'balanced') === arch.key;
                        return (
                            <button key={arch.key} onClick={() => set('draftArchetype', arch.key)} style={{
                                padding: '11px 13px',
                                border: active ? '1px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                borderRadius: 8,
                                background: active ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s',
                            }}>
                                <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-body)', fontWeight: 700, color: active ? 'var(--gold)' : 'var(--ov-9, rgba(255,255,255,0.8))' }}>{arch.label}</div>
                                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--ov-8, rgba(255,255,255,0.4))', marginTop: 2, fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>{arch.blurb}</div>
                            </button>
                        );
                    })}
                </div>
            </div></window.WR.MobileSection>}

            {/* ── Market Posture (Custom only) ── */}
            {showDynastyControls && isCustom && <window.WR.MobileSection phone={_phone} title="Market Posture" summary="Buying and selling approach"><div style={styles.card}>
                <SectionHeader title="Market Posture" />
                <div style={{ display: 'grid', gridTemplateColumns: _phone ? '1fr' : 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {MARKET_POSTURES.map(mp => {
                        const active = draft.marketPosture === mp.value;
                        return (
                            <button key={mp.value} onClick={() => set('marketPosture', mp.value)} style={{
                                padding: '11px 13px',
                                border: active ? '1px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                borderRadius: 8,
                                background: active ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s',
                            }}>
                                <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-body)', fontWeight: 700, color: active ? 'var(--gold)' : 'var(--ov-9, rgba(255,255,255,0.8))' }}>{mp.label}</div>
                                <div style={{ fontSize: 'var(--text-micro)', color: 'var(--ov-8, rgba(255,255,255,0.4))', marginTop: 2, fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>{mp.desc}</div>
                            </button>
                        );
                    })}
                </div>
            </div></window.WR.MobileSection>}

            {/* ── Timeline (Custom only) ── */}
            {showDynastyControls && isCustom && <window.WR.MobileSection phone={_phone} title="Timeline" summary="When you plan to compete"><div style={styles.card}>
                <SectionHeader title="Timeline" />
                <PillGroup
                    options={TIMELINES.map(t => ({ value: t.value, label: t.label }))}
                    value={TIMELINES.find(t => t.value === draft.timeline)?.label || draft.timeline}
                    onChange={v => set('timeline', v)}
                    fullWidth
                />
                {TIMELINES.find(t => t.value === draft.timeline) && (
                    <div style={{ marginTop: 8, fontSize: 'var(--text-label)', color: 'var(--ov-8, rgba(255,255,255,0.45))', fontFamily: 'var(--font-body)' }}>
                        {TIMELINES.find(t => t.value === draft.timeline).desc}
                    </div>
                )}
            </div></window.WR.MobileSection>}

            {/* Alex Personality card removed — one canonical Alex voice
                (owner ruling 2026-07-08). Strategy substance above is untouched. */}

            {/* ── Bottom save bar ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, paddingBottom: 40 }}>
                <SyncBadge />
                <button onClick={handleSave} style={styles.saveBtn(syncStatus === 'saving')}>
                    {syncStatus === 'saving' ? 'Saving…' : showDynastyControls ? 'Save Strategy' : 'Save Plan'}
                </button>
            </div>

            {/* ── P6 phone action bar — "UNSAVED CHANGES · SAVE STRATEGY ▸"
                pinned above the dock while the draft differs from the saved
                strategy. Same handleSave (local-draft / explicit-save model);
                WR.ActionBar renders null off-phone by construction. ── */}
            {window.WR && window.WR.ActionBar ? React.createElement(window.WR.ActionBar, {
                visible: _dirty,
                label: 'UNSAVED CHANGES',
                actionLabel: syncStatus === 'saving' ? 'SAVING…' : showDynastyControls ? 'SAVE STRATEGY' : 'SAVE PLAN',
                onAction: handleSave,
                onOpen: handleSave,
            }) : null}

        </div>
    );
}

// ── Shared style helpers ──────────────────────────────────────────────────────
const styles = {
    card: {
        background: 'var(--off-black, var(--k-0f0f14, #0f0f14))',
        border: 'var(--card-border)',
        borderRadius: 'var(--card-radius)',
        padding: 'var(--card-pad)',
        marginBottom: 'var(--card-gap)',
    },
    subLabel: {
        fontSize: 'var(--text-micro)',
        color: 'var(--ov-8, rgba(255,255,255,0.45))',
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 7,
    },
    input: {
        flex: 1,
        background: 'var(--ov-3, rgba(255,255,255,0.05))',
        border: '1px solid var(--ov-6, rgba(255,255,255,0.12))',
        borderRadius: 6,
        padding: '7px 10px',
        color: 'var(--k-ffffff, #ffffff)',
        fontSize: 'var(--text-body, 1rem)',
        fontFamily: 'var(--font-body)',
        outline: 'none',
        width: '100%',
        boxSizing: 'border-box',
    },
    addBtn: {
        background: 'var(--acc-fill3, rgba(212,175,55,0.15))',
        border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))',
        borderRadius: 6,
        color: 'var(--gold)',
        fontSize: 'var(--text-body, 1rem)',
        fontFamily: 'var(--font-body)',
        padding: '7px 14px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
    tag: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 9px',
        borderRadius: 5,
        border: '1px solid var(--ov-7, rgba(255,255,255,0.18))',
        background: 'var(--ov-4, rgba(255,255,255,0.06))',
        color: 'var(--ov-9, rgba(255,255,255,0.75))',
        fontSize: 'var(--text-label)',
        fontFamily: 'var(--font-body)',
    },
    tagX: {
        background: 'none',
        border: 'none',
        color: 'var(--ov-8, rgba(255,255,255,0.45))',
        cursor: 'pointer',
        fontSize: 'var(--text-body, 1rem)',
        padding: '8px',
        minWidth: 32,
        minHeight: 32,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
    },
    dropdown: {
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        zIndex: 99,
        background: 'var(--k-1a1a1a, #1a1a1a)',
        border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
        borderRadius: 8,
        marginTop: 4,
        maxHeight: 220,
        overflowY: 'auto',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    },
    dropdownItem: {
        width: '100%',
        padding: '9px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
        color: 'var(--ov-9, rgba(255,255,255,0.75))',
        fontSize: 'var(--text-body, 1rem)',
        fontFamily: 'var(--font-body)',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
    },
    saveBtn: (disabled) => ({
        padding: '9px 22px',
        background: disabled ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'var(--acc-line1, rgba(212,175,55,0.2))',
        border: '1px solid var(--acc-line3, rgba(212,175,55,0.5))',
        borderRadius: 7,
        color: disabled ? 'var(--acc-line3, rgba(212,175,55,0.5))' : 'var(--gold)',
        fontSize: 'var(--text-body, 1rem)',
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        letterSpacing: '0.04em',
        transition: 'all 0.15s',
    }),
    badge: (bg, color) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        background: bg,
        borderRadius: 20,
        color,
        fontSize: 'var(--text-body, 1rem)',
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
    }),
};

window.StrategyEditorTab = StrategyEditorTab;
