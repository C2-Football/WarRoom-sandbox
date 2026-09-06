// ══════════════════════════════════════════════════════════════════
// js/components/manual-seasons-editor.js — WR.ManualSeasonsEditor
//
// Sleeper's previous_league_id chain stops at the year a league moved onto
// the platform. A league that ran for years on paper (or another host) has
// real history the API can never return: titles, runners-up, and the draft
// slot each of them came from. This is the way in for those years.
//
// One editor, two homes — Analytics' Winner's Perch (which reads the draft
// slot) and the Trophy Room's Championship Timeline (which reads the names)
// are two views of the same rows, so they share one control rather than
// drifting apart. Rows live in WrHistory under wr_history_manual_<leagueId>.
//
//   <WR.ManualSeasonsEditor leagueId={id} teamCount={12} showSlots />
//
// showSlots draws the per-finish draft-slot pickers; without it the editor
// collects names only (the Trophy Room doesn't care which slot won).
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const React = window.React;

    function ManualSeasonsEditor({ leagueId, teamCount, showSlots }) {
        // The rows are the single copy in WrHistory; this mirror exists only so
        // React re-renders, and every write goes through WrHistory first. The
        // event listener is what keeps the two mounts (Winner's Perch and the
        // Championship Timeline) in step when the other one saves.
        const readRows = () => (window.WrHistory && window.WrHistory.getManualSeasons)
            ? window.WrHistory.getManualSeasons(leagueId) : [];
        const [rows, setRows] = React.useState(readRows);
        const [editing, setEditing] = React.useState(null);
        React.useEffect(() => {
            setRows(readRows());
            setEditing(null);
            const onChanged = (e) => {
                if (!e || !e.detail || String(e.detail.leagueId) === String(leagueId)) setRows(readRows());
            };
            window.addEventListener('wr_history_manual_changed', onChanged);
            return () => window.removeEventListener('wr_history_manual_changed', onChanged);
        }, [leagueId]);
        const onSave = (row) => {
            window.WrHistory?.upsertManualSeason?.(leagueId, row);
            setEditing(null);
        };
        const onDelete = (id) => {
            window.WrHistory?.removeManualSeason?.(leagueId, id);
            setEditing(null);
        };
        const blank = () => ({
            id: '',
            season: '',
            finishes: [1, 2, 3].map(place => ({ place, owner: '', draftSlot: '' })),
        });
        const placeLabel = { 1: 'Champion', 2: 'Runner-up', 3: 'Third' };
        const btn = {
            background: 'transparent',
            border: '1px solid var(--ov-6, rgba(255,255,255,0.12))',
            borderRadius: 'var(--card-radius-sm, 8px)',
            color: 'var(--silver)',
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
            fontSize: '0.74rem',
            minHeight: '36px',
            padding: '6px 12px',
        };
        const input = {
            background: 'var(--ov-2, rgba(255,255,255,0.03))',
            border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
            borderRadius: 'var(--card-radius-sm, 8px)',
            color: 'var(--white)',
            fontFamily: 'var(--font-body)',
            fontSize: '0.8rem',
            minHeight: '36px',
            minWidth: 0,
            padding: '6px 9px',
            width: '100%',
        };
        const patch = (idx, key, value) => setEditing(prev => {
            const next = Object.assign({}, prev);
            next.finishes = prev.finishes.map((f, i) => (i === idx ? Object.assign({}, f, { [key]: value }) : f));
            return next;
        });
        const slotOptions = [];
        for (let i = 1; i <= (Number(teamCount) || 12); i++) slotOptions.push(i);
        const seasonValid = /^\d{4}$/.test(String(editing?.season || '').trim());
        // A row has to carry something the app can read: a draft slot (the
        // Winner's Perch) or a name (the Championship Timeline). Storing an
        // empty year helps nobody, so say so instead of accepting it.
        const hasContent = !!(editing?.finishes || []).some(f => Number(f.draftSlot) > 0 || (f.owner || '').trim());

        return (
            <div style={{ borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))', marginTop: 12, paddingTop: 10 }}>
                {rows.length > 0 && (
                    <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                        {rows.map(r => (
                            <div key={r.id} style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                                <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.74rem', flexShrink: 0, width: 42 }}>{r.season}</span>
                                <span style={{ color: 'var(--silver)', flex: 1, fontSize: '0.75rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {(r.finishes || []).map(f => (placeLabel[f.place] || f.place) + ': ' + (f.owner || '—') + (showSlots && f.draftSlot ? ' (slot ' + f.draftSlot + ')' : '')).join(' · ') || 'no finishes recorded'}
                                </span>
                                <button type="button" onClick={() => setEditing({ id: r.id, season: String(r.season), finishes: [1, 2, 3].map(place => (r.finishes || []).find(f => f.place === place) || { place, owner: '', draftSlot: '' }) })}
                                    style={Object.assign({}, btn, { minHeight: '30px', padding: '3px 9px' })}>Edit</button>
                                <button type="button" onClick={() => onDelete(r.id)}
                                    style={Object.assign({}, btn, { minHeight: '30px', padding: '3px 9px' })}>Remove</button>
                            </div>
                        ))}
                    </div>
                )}

                {!editing && (
                    <button type="button" onClick={() => setEditing(blank())} style={Object.assign({}, btn, { borderColor: 'var(--acc-line1, rgba(212,175,55,0.24))', color: 'var(--gold)' })}>
                        + Add a season Sleeper doesn't have
                    </button>
                )}

                {editing && (
                    <div style={{ background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: 'var(--card-radius, 10px)', padding: '12px' }}>
                        <label style={{ color: 'var(--gold)', display: 'block', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4, textTransform: 'uppercase' }}>Season</label>
                        <input type="text" inputMode="numeric" maxLength={4} placeholder="2014" value={editing.season}
                            onChange={e => setEditing(prev => Object.assign({}, prev, { season: e.target.value.replace(/[^\d]/g, '') }))}
                            style={Object.assign({}, input, { marginBottom: 12, maxWidth: 110 })} />
                        {editing.finishes.map((f, i) => (
                            <div key={f.place} style={{ display: 'grid', gap: 8, gridTemplateColumns: showSlots ? 'minmax(0,1fr) 108px' : 'minmax(0,1fr)', marginBottom: 8 }}>
                                <div>
                                    <label style={{ color: 'var(--silver)', display: 'block', fontSize: 'var(--text-micro, 0.6875rem)', letterSpacing: '0.06em', marginBottom: 4, opacity: 0.8, textTransform: 'uppercase' }}>{placeLabel[f.place]}</label>
                                    <input type="text" placeholder="Team or owner" value={f.owner}
                                        onChange={e => patch(i, 'owner', e.target.value)} style={input} />
                                </div>
                                {showSlots && (
                                    <div>
                                        <label style={{ color: 'var(--silver)', display: 'block', fontSize: 'var(--text-micro, 0.6875rem)', letterSpacing: '0.06em', marginBottom: 4, opacity: 0.8, textTransform: 'uppercase' }}>Draft slot</label>
                                        <select value={f.draftSlot} onChange={e => patch(i, 'draftSlot', e.target.value)} style={input}>
                                            <option value="">—</option>
                                            {slotOptions.map(n => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>
                        ))}
                        <div style={{ color: 'var(--silver)', fontSize: '0.72rem', lineHeight: 1.5, marginBottom: 10, opacity: 0.7 }}>
                            {showSlots
                                ? 'The Winner\u2019s Perch reads the draft slot; the Trophy Room reads the names. Fill in what you know \u2014 the same row feeds both.'
                                : 'Names matching a current owner link to their profile and count toward their title total. The same row feeds the Winner\u2019s Perch in Analytics.'}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" disabled={!seasonValid || !hasContent}
                                onClick={() => onSave({
                                    id: editing.id || editing.season,
                                    season: Number(editing.season),
                                    finishes: editing.finishes
                                        .filter(f => f.owner.trim() || Number(f.draftSlot) > 0)
                                        .map(f => ({ place: f.place, owner: f.owner.trim(), draftSlot: Number(f.draftSlot) || null })),
                                })}
                                style={Object.assign({}, btn, {
                                    background: (seasonValid && hasContent) ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'transparent',
                                    borderColor: 'var(--acc-line1, rgba(212,175,55,0.24))',
                                    color: (seasonValid && hasContent) ? 'var(--gold)' : 'var(--silver)',
                                    cursor: (seasonValid && hasContent) ? 'pointer' : 'not-allowed',
                                    opacity: (seasonValid && hasContent) ? 1 : 0.5,
                                })}>Save season</button>
                            <button type="button" onClick={() => setEditing(null)} style={btn}>Cancel</button>
                            {!seasonValid && <span style={{ alignSelf: 'center', color: 'var(--silver)', fontSize: '0.72rem', opacity: 0.6 }}>Enter a 4-digit year.</span>}
                            {seasonValid && !hasContent && <span style={{ alignSelf: 'center', color: 'var(--silver)', fontSize: '0.72rem', opacity: 0.6 }}>Fill in at least one finish.</span>}
                        </div>
                    </div>
                )}
            </div>
        );
    }


    window.WR = window.WR || {};
    window.WR.ManualSeasonsEditor = ManualSeasonsEditor;
})();
