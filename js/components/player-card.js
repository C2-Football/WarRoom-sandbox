// ══════════════════════════════════════════════════════════════════
// player-card.js — Unified War Room Player Card (SI-2)
// Replaces window.openFWPlayerModal (ReconAI CDN) as the primary player modal.
// Single entry point: window.WR.openPlayerCard(pid, { context })
// Used by: My Roster, Free Agency, Compare, Draft big boards, Trade Center, Home widgets.
// ══════════════════════════════════════════════════════════════════
(function () {
    const { useState, useEffect, useRef } = React;

    // ── Shared helpers ────────────────────────────────────────────
    function normPos(pos) {
        if (['DE', 'DT', 'NT'].includes(pos)) return 'DL';
        if (['CB', 'S', 'SS', 'FS'].includes(pos)) return 'DB';
        if (['OLB', 'ILB', 'MLB'].includes(pos)) return 'LB';
        return pos || '';
    }

    function playerName(p) {
        return p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim() || '—';
    }

    // Tier comes from DHQ score (same thresholds used in roster table)
    function tierFromDhq(dhq) {
        if (dhq >= 7000) return { label: 'Elite', color: 'var(--k-2ecc71, #2ecc71)' };
        if (dhq >= 5000) return { label: 'Tier 1', color: 'var(--k-3498db, #3498db)' };
        if (dhq >= 3500) return { label: 'Tier 2', color: 'var(--k-d4af37, #d4af37)' };
        if (dhq >= 2000) return { label: 'Tier 3', color: 'var(--k-d0d0d0, #d0d0d0)' };
        if (dhq > 0)    return { label: 'Depth', color: 'var(--text-muted)' };
        return { label: '—', color: 'var(--text-muted)' };
    }

    // Chronicles → custom-awards index. Scans `wr_chronicles_*` keys ONCE and
    // returns a lowercased-name → [awards] map so repeated card opens don't
    // rescan localStorage. Invalidated via window._wrChroniclesInvalidate()
    // whenever chronicles are imported or removed.
    let _chroniclesIndexCache = null;
    function _getChroniclesAwardIndex() {
        if (_chroniclesIndexCache) return _chroniclesIndexCache;
        const index = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith('wr_chronicles_')) continue;
                let data;
                try { data = JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { continue; }
                if (!data || !Array.isArray(data.customAwards)) continue;
                data.customAwards.forEach(a => {
                    (a.winners || []).forEach(w => {
                        const key = (w.winner || '').toLowerCase();
                        if (!key) return;
                        if (!index[key]) index[key] = [];
                        index[key].push({ name: a.name, year: w.year, stats: w.stats, league: data.leagueName || '' });
                    });
                });
            }
        } catch (_) { /* noop */ }
        _chroniclesIndexCache = index;
        return index;
    }
    // Public invalidator — Trophy Room calls this after a chronicles import/delete.
    window._wrChroniclesInvalidate = function () { _chroniclesIndexCache = null; };

    // ── Team history: best-effort from career stats + current team ────
    // Sleeper doesn't expose a first-class team history. We reconstruct from
    // the yearly NFL career stats table (already fetched by fwFetchCareerStats).
    // If that fails we show only the current team with a note.
    function useTeamHistory(pid, player) {
        const [rows, setRows] = useState(null);
        const [loading, setLoading] = useState(true);
        useEffect(() => {
            let cancelled = false;
            async function load() {
                try {
                    const exp = player?.years_exp || 0;
                    const cur = parseInt(window.S?.season) || new Date().getFullYear();
                    if (typeof window.fwFetchCareerStats !== 'function' || exp <= 0) {
                        // Rookie or no career fetcher available — current team only
                        if (!cancelled) setRows(player?.team ? [{ season: cur, team: player.team }] : []);
                        setLoading(false);
                        return;
                    }
                    const career = await window.fwFetchCareerStats(pid, cur, exp);
                    if (cancelled) return;
                    const history = [];
                    Object.keys(career || {}).sort().forEach(yr => {
                        const row = career[yr] || {};
                        const team = row.team || row.tm || row.TEAM;
                        if (team) history.push({ season: parseInt(yr), team });
                    });
                    // Append current season / team if not represented
                    const latest = history[history.length - 1];
                    if (player?.team && (!latest || latest.team !== player.team || latest.season < cur)) {
                        history.push({ season: cur, team: player.team });
                    }
                    setRows(history);
                } catch (e) {
                    if (!cancelled) setRows(player?.team ? [{ season: new Date().getFullYear(), team: player.team }] : []);
                } finally {
                    if (!cancelled) setLoading(false);
                }
            }
            load();
            return () => { cancelled = true; };
        }, [pid]);
        return { rows, loading };
    }

    // Collapse consecutive same-team seasons into ranges (SEA 2022-2024, KC 2025)
    function compressHistory(rows) {
        if (!Array.isArray(rows) || !rows.length) return [];
        const out = [];
        let cur = { team: rows[0].team, start: rows[0].season, end: rows[0].season };
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].team === cur.team && rows[i].season === cur.end + 1) {
                cur.end = rows[i].season;
            } else {
                out.push(cur);
                cur = { team: rows[i].team, start: rows[i].season, end: rows[i].season };
            }
        }
        out.push(cur);
        return out;
    }

    // Weekly observations stay scoped to the selected player and season.
    function PlayerSeasonStats({ pid, player, league, scoring }) {
        const engine = window.App?.LeagueStats;
        const latest = Number(window.S?.nflState?.season) || new Date().getFullYear();
        const initial = Number(league?.season) || latest;
        const [season, setSeason] = useState(String(initial));
        const [revision, setRevision] = useState(0);
        const [load, setLoad] = useState({ key: '', status: 'loading' });
        const requestKey = pid + '|' + season;
        useEffect(() => {
            if (!engine?.loadGameLog) return;
            let alive = true;
            setLoad({ key: requestKey, status: 'loading' });
            const lastWeek = Number(season) < latest ? 18 : Number(season) > latest ? 0 : Math.min(18, Math.max(0, Number(window.S?.nflState?.week) || 0));
            engine.loadGameLog({ pid, season, weeks: Array.from({ length: lastWeek }, (_, i) => i + 1), force: revision > 0 }).then(rows => {
                if (alive) setLoad({ key: requestKey, status: 'ready', rows });
            }).catch(() => { if (alive) setLoad({ key: requestKey, status: 'error' }); });
            return () => { alive = false; };
        }, [engine, requestKey, revision, latest]);
        const h = React.createElement;
        const years = Array.from({ length: Math.max(1, Math.min(30, Number(player.years_exp) + 1 || 1)) }, (_, i) => latest - i);
        if (!years.includes(initial)) years.push(initial);
        years.sort((a, b) => b - a);
        const controls = h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' } },
            h('label', null, 'Season ', h('select', { 'aria-label': 'Player stats season', value: season, onChange: e => setSeason(e.target.value), style: { ...btnStyle(), background: 'var(--surf-solid, #15171b)' } }, years.map(year => h('option', { key: year, value: year }, year)))),
            h('button', { style: btnStyle(), onClick: () => setRevision(v => v + 1) }, 'Refresh'));
        let content;
        if (!engine?.loadGameLog) content = h('p', null, 'Weekly stats are unavailable. Reload the app to try again.');
        else if (load.key !== requestKey || load.status === 'loading') content = h('p', { role: 'status' }, 'Loading weekly stats…');
        else if (load.status === 'error') content = h('p', { role: 'alert' }, 'Weekly stats could not load. Select Refresh to retry.');
        else if (!load.rows.length) content = h('p', null, 'No regular-season weeks available yet.');
        else {
            const pos = engine.normalizePosition(player.position);
            const keys = pos === 'QB' ? ['pass_yd','pass_td','pass_int','rush_yd','rush_td'] : pos === 'RB' ? ['rush_att','rush_yd','rush_td','rec_tgt','rec','rec_yd','rec_td'] : ['WR','TE'].includes(pos) ? ['rec_tgt','rec','rec_yd','rec_td','rush_att','rush_yd','rush_td'] : pos === 'K' ? ['fgm','fga','xpm'] : ['idp_tkl','idp_tkl_solo','idp_sack','idp_int','pts_allow'];
            const labels = {pass_yd:'Pass yd',pass_td:'Pass TD',pass_int:'INT',rush_att:'Carries',rush_yd:'Rush yd',rush_td:'Rush TD',rec_tgt:'Targets',rec:'Rec',rec_yd:'Rec yd',rec_td:'Rec TD',fgm:'FG',fga:'FG att',xpm:'XP',idp_tkl:'Tackles',idp_tkl_solo:'Solo',idp_sack:'Sacks',idp_int:'INT',pts_allow:'Pts allowed'};
            const cell = { padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--ov-4, #333)', fontSize: '14px' };
            content = h('div', { style: { overflowX: 'auto' }, tabIndex: 0, role: 'region', 'aria-label': 'Weekly fantasy scoring table' },
                h('table', { style: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' } },
                    h('caption', { style: { textAlign: 'left', padding: '8px 0', fontSize: '14px' } }, 'One row per week · swipe for more stats'),
                    h('thead', null, h('tr', null, ['Week','Fantasy pts',...keys.map(k => labels[k]),'Status'].map(label => h('th', { key: label, scope: 'col', style: cell }, label)))),
                    h('tbody', null, load.rows.map(game => {
                        const raw = game.raw;
                        const points = raw ? engine.score(raw, scoring, pos) : null;
                        return h('tr', { key: game.week },
                            h('th', { scope: 'row', style: {...cell, position: 'sticky', left: 0, background: 'var(--surf-solid, #15171b)'} }, 'W' + game.week),
                            h('td', { style: {...cell, color: 'var(--text-primary)', fontWeight: 700} }, Number.isFinite(points) ? points.toFixed(1) : '—'),
                            ...keys.map(k => h('td', { key:k, style:cell }, Number.isFinite(raw?.[k]) ? raw[k] : '—')),
                            h('td', { style:cell }, game.error ? 'Could not load · refresh' : raw ? 'Reported' : 'No stats reported'));
                    }))));
        }
        return h('section', { 'aria-label': 'Season stats', style: { padding: '14px 20px', color: 'var(--silver)' } }, controls,
            h('p', { style: { fontSize: '14px' } }, season + ' regular season · ' + (league.name || 'League scoring')),
            content, h('p', { style: { fontSize: '14px' } }, 'Fantasy points use your league scoring. A dash means unavailable; an empty week is not automatically a bye.'));
    }

    function PlayerFantasySummary({ pid, player, league, scoring, playersData, dhq }) {
        const h = React.createElement;
        const [data, setData] = useState(null);
        const season = String(league.season || window.S?.nflState?.season || new Date().getFullYear());
        const key = pid + '|' + season + '|' + String(league.league_id || league.id || '');
        useEffect(() => {
            let alive = true;
            setData(null);
            window.App?.LeagueStats?.load({ season }).then(result => { if (alive) setData({key, stats:result.statsByPid}); }).catch(() => {});
            return () => { alive = false; };
        }, [key]);
        const stats = data?.key === key ? data.stats : null;
        const engine = window.App?.LeagueStats;
        const row = stats?.[pid] && engine?.buildRows({statsByPid:{[pid]:stats[pid]},playersData:{[pid]:player},league:{scoring_settings:scoring}})[0];
        const ppg = row?.gp > 0 && Number.isFinite(row.fantasyPoints) ? row.fantasyPoints / row.gp : null;
        const current = season === String(window.S?.nflState?.season || new Date().getFullYear());
        const week = window.App?.WeeklyProj?.currentWeek?.();
        const board = React.useMemo(() => {
            if (!stats || !current) return null;
            try {
                const cached = window.App?.PlayerValue?.rosState?.();
                if (cached && String(cached.leagueId) === String(league.league_id || league.id) && Number(cached.week) === Number(week)) return cached;
                return window.App?.PlayerValue?.computePrices?.({league,leagueId:league.league_id || league.id,scoring,playersData,statsData:stats,priorData:window.S?.priorData,week}); } catch (_) { return null; }
        }, [stats, current, league, scoring, playersData, week]);
        let projection = null;
        try { if (stats && current) { const forecast = window.App?.WeeklyProj?.projectPlayer?.(pid,{playersData,statsData:stats,priorData:window.S?.priorData,scoring,week}); if (forecast?.available) projection = forecast.points?.median; } } catch (_) { /* Missing forecasts stay unknown. */ }
        const fmt = (n, digits = 1) => Number.isFinite(n) ? n.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
        const cells = [
            {label:'Season value',value:fmt(board?.values?.[pid],0),help:'0–10,000 value rating; not fantasy points'},
            {label:'ROS pts',value:fmt(board?.points?.[pid]),help:'Projected fantasy points remaining this season'},
            {label:'Avg PPG',value:fmt(ppg),help:season + ' actual fantasy points per game'},
            {label:week ? 'Week ' + week + ' proj' : 'Week proj',value:fmt(projection),help:'Projected fantasy points this week'}
        ];
        const type = window.App?.LeagueSkin?.build?.({league})?.type;
        return h('section', {'aria-label':'Fantasy decision stats',style:{padding:'14px 20px'}},
            type === 'dynasty' ? h('p',null,'DHQ dynasty value: ',fmt(dhq,0)) : null,
            h('dl',{style:{display:'grid',gridTemplateColumns:'repeat(2, minmax(0, 1fr))',gap:'10px',margin:0}},cells.map(cell=>h('div',{key:cell.label,title:cell.help,style:{padding:'12px',background:'var(--ov-3, #202026)',borderRadius:'var(--card-radius-sm, 8px)'}},h('dt',{style:{fontSize:'14px',color:'var(--silver)'}},cell.label),h('dd',{style:{margin:'5px 0 0',fontSize:'21px',fontWeight:700,color:'var(--text-primary)'}},cell.value)))),
            h('p',{style:{fontSize:'14px',color:'var(--silver)'}},'Avg PPG: ' + season + ' actuals · ROS pts: remaining-season projection. Season value is a rating, not points.'));
    }

    // ── Main component ────────────────────────────────────────────
    // Surface the user's private scouting note (written on the Draft Big Board) on
    // the player card wherever it opens — incl. Follow Live Draft. Scans every board
    // store for the current league (variant-suffixed + legacy keys) so we find the
    // note regardless of which draft variant key it was saved under.
    function draftScoutNote(pid) {
        try {
            const lid = window.S?.currentLeagueId;
            if (!lid || pid == null) return '';
            const want = String(pid);
            const prefix = 'wr_bigboard_' + lid;
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || k.indexOf(prefix) !== 0) continue;
                const data = JSON.parse(localStorage.getItem(k) || '{}');
                const n = data && data.notes && data.notes[want];
                if (n && String(n).trim()) return String(n).trim();
            }
        } catch (e) {}
        return '';
    }

    // ── Rookie Scouting Report (deterministic, no LLM) ────────────
    // Consensus/positional rank, grade+tier, draft round/pick or UDFA, physicals
    // (when present), per-source rank chips, highlight link, and a summary
    // (prospect.summary if present, else a short rank-derived line). HONESTY:
    // model/consensus-derived numbers are labeled; physicals + real summary render
    // only when the prospect actually carries them.
    function scoutingReportBlock(pr) {
        if (!pr) return null;
        const gold = 'var(--gold)';
        const muted = 'var(--text-muted)';
        const labelStyle = { fontSize: 'var(--text-label, 0.75rem)', color: muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' };
        const valStyle = { fontSize: 'var(--text-body, 1rem)', color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' };

        const consensus = Number.isFinite(pr.consensusRank) && pr.consensusRank > 0 ? Math.round(pr.consensusRank * 10) / 10 : null;
        const overall = Number.isFinite(pr.rank) && pr.rank > 0 ? pr.rank : null;
        const posRank = Number.isFinite(pr.rookiePosRank) && pr.rookiePosRank > 0 ? pr.rookiePosRank : null;
        const posLabel = (pr.position || pr.pos || pr.rawPos || '').toUpperCase();
        const grade = Number.isFinite(pr.grade) && pr.grade > 0 ? pr.grade : null;
        const tierTxt = pr.tierLabel ? String(pr.tierLabel).replace(/_/g, ' ') : null;

        let capital = null;
        if (pr.draftPick) capital = 'Pick ' + pr.draftPick + (pr.draftRound ? ' (Rd ' + pr.draftRound + ')' : '') + (pr.nflTeam ? ' · ' + pr.nflTeam : '');
        else if (pr.draftRound) capital = 'Round ' + pr.draftRound + (pr.nflTeam ? ' · ' + pr.nflTeam : '');
        else if (pr.isUDFA) capital = 'UDFA' + (pr.nflTeam ? ' · ' + pr.nflTeam : '');

        const physicals = [
            pr.size ? { l: 'Size', v: pr.size } : null,
            pr.weight ? { l: 'Weight', v: pr.weight } : null,
            pr.speed ? { l: '40 / Speed', v: pr.speed } : null,
        ].filter(Boolean);

        let sourceChips = [];
        if (pr.sourceRanks && typeof pr.sourceRanks === 'object') {
            sourceChips = Object.keys(pr.sourceRanks)
                .filter(k => Number.isFinite(pr.sourceRanks[k]) && pr.sourceRanks[k] > 0)
                .map(k => ({ source: k, rank: pr.sourceRanks[k] }));
        }
        if (!sourceChips.length && Array.isArray(pr.sources)) {
            sourceChips = pr.sources.filter(s => s && s.rank > 0).map(s => ({ source: s.source, rank: s.rank }));
        }

        const summaryReal = pr.summary && String(pr.summary).trim() ? String(pr.summary).trim() : '';
        let summaryDerived = '';
        if (!summaryReal) {
            const parts = [];
            if (tierTxt) parts.push(tierTxt + ' prospect');
            if (posRank && posLabel) parts.push(posLabel + posRank + ' at the position');
            else if (overall) parts.push('No. ' + overall + ' overall');
            if (consensus) parts.push('consensus ' + consensus);
            summaryDerived = parts.length ? 'Model read: ' + parts.join(' · ') + '. Pre-NFL — no verified film summary on file.' : '';
        }

        const tiles = [];
        if (consensus || overall) tiles.push({ l: 'Consensus Rank', v: (consensus ? consensus : '#' + overall), note: 'model' });
        if (posRank && posLabel) tiles.push({ l: 'Positional Rank', v: posLabel + posRank, note: 'model' });
        if (grade != null || tierTxt) tiles.push({ l: 'Grade / Tier', v: (grade != null ? grade.toFixed(1) : '—') + (tierTxt ? ' · ' + tierTxt : ''), note: 'model' });
        if (capital) tiles.push({ l: 'Draft Capital', v: capital, note: null });

        if (!tiles.length && !physicals.length && !sourceChips.length && !summaryReal && !summaryDerived) return null;

        return React.createElement('div', {
            key: 'scouting-report',
            style: { margin: '12px 20px 0', padding: '12px 14px', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--acc-fill1, rgba(212,175,55,0.06))' }
        },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' } },
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', color: gold } }, '🔍 Scouting Report'),
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.7rem)', color: muted } }, 'Rookie prospect')
            ),
            tiles.length ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: (physicals.length || sourceChips.length || summaryReal || summaryDerived) ? '10px' : '0' } },
                tiles.map((t, i) => React.createElement('div', { key: i },
                    React.createElement('div', { style: labelStyle }, t.l, t.note ? React.createElement('span', { style: { color: 'var(--silver)', opacity: 0.6, fontWeight: 600, marginLeft: '4px', textTransform: 'none', letterSpacing: 0 } }, '(' + t.note + ')') : null),
                    React.createElement('div', { style: valStyle }, t.v)
                ))
            ) : null,
            physicals.length ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: (sourceChips.length || summaryReal || summaryDerived) ? '10px' : '0' } },
                physicals.map((ph, i) => React.createElement('div', { key: i },
                    React.createElement('div', { style: labelStyle }, ph.l),
                    React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--text-primary)', fontWeight: 500 } }, ph.v)
                ))
            ) : null,
            sourceChips.length ? React.createElement('div', { style: { marginBottom: (summaryReal || summaryDerived) ? '10px' : '0' } },
                React.createElement('div', { style: { ...labelStyle, marginBottom: '5px' } }, 'Source Ranks'),
                React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                    sourceChips.map((c, i) => React.createElement('span', { key: i, style: { padding: '3px 8px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', fontSize: 'var(--text-label, 0.72rem)', color: 'var(--k-d0d0d0, #d0d0d0)', fontFamily: 'JetBrains Mono, monospace' } }, c.source + ' ' + c.rank))
                )
            ) : null,
            (summaryReal || summaryDerived) ? React.createElement('div', { style: { fontSize: 'var(--text-body, 0.92rem)', color: 'var(--k-d0d0d0, #d0d0d0)', lineHeight: 1.45, marginBottom: pr.highlightUrl ? '8px' : '0' } }, summaryReal || summaryDerived) : null,
            pr.highlightUrl ? React.createElement('a', { href: pr.highlightUrl, target: '_blank', rel: 'noopener noreferrer', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-label, 0.78rem)', color: gold, textDecoration: 'none', fontWeight: 600 } }, '▶ Watch highlights') : null
        );
    }

    function PlayerCard({ pid, playersData, statsData, scoringSettings, onClose, initialTab, context, embedded = false, nflFitText }) {
        const [tab, setTab] = useState(initialTab || 'overview');
        const [tagMenu, setTagMenu] = useState(false);
        const closeRef = useRef(null);
        // Phone tier (<768): the card renders as a WR.Sheet bottom sheet
        // instead of the centered 640px modal (plan D4). Hook comes from
        // js/shared/viewport.js (plain script, always ahead of this babel
        // file, so the branch is fixed for the page's lifetime) and is
        // called before the `if (!p)` early return for hook-order safety.
        const _useVp = window.WR && window.WR.useViewport;
        const isPhone = _useVp ? !!_useVp().isPhone : false;
        const sleeperPlayer = playersData?.[pid];

        // Resolve a draft prospect for this card via window.findProspect (keyed by
        // name with alias matching). Covers (1) a Sleeper player who is also a
        // current rookie, and (2) a synthetic `csv_*` id with no Sleeper player —
        // reversed back into a name. Hoisted above the early return for stable hooks.
        const prospect = React.useMemo(() => {
            try {
                if (typeof window.findProspect !== 'function') return null;
                let name = sleeperPlayer
                    ? (sleeperPlayer.full_name || ((sleeperPlayer.first_name || '') + ' ' + (sleeperPlayer.last_name || '')).trim())
                    : '';
                if (!name && typeof pid === 'string' && pid.indexOf('csv_') === 0) {
                    name = pid.slice(4).replace(/_/g, ' ').trim();
                }
                if (!name) return null;
                return window.findProspect(name) || null;
            } catch (e) { return null; }
        }, [pid, sleeperPlayer?.full_name, sleeperPlayer?.first_name, sleeperPlayer?.last_name]);

        // No Sleeper player (synthetic `csv_*` id) but a prospect resolved →
        // synthesize a minimal player so the card body renders instead of blank.
        const p = sleeperPlayer || (prospect ? {
            full_name: prospect.name,
            first_name: (prospect.name || '').split(' ')[0] || '',
            last_name: (prospect.name || '').split(' ').slice(1).join(' ') || '',
            position: prospect.position || prospect.pos || prospect.rawPos || '',
            team: prospect.nflTeam || 'FA',
            college: prospect.college || prospect.school || '',
            years_exp: 0,
            age: 0,
            _synthetic: true,
            _fromProspect: true,
        } : null);

        // ESC closes
        useEffect(() => {
            if (embedded) return;
            const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
            document.addEventListener('keydown', onKey);
            return () => document.removeEventListener('keydown', onKey);
        }, [onClose, embedded]);

        const { rows: historyRows, loading: historyLoading } = useTeamHistory(pid, p);

        // Custom awards hook must fire unconditionally — hoisted above the early
        // return so hook count stays stable across renders where p flips between
        // defined/undefined (otherwise React hook-count mismatch crashes the card).
        // Uses a single cached player→awards index so we don't rescan localStorage
        // on every card open. Cache is rebuilt on demand when storage version changes.
        const customAwards = React.useMemo(() => {
            if (!p) return [];
            const fullName = (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || '').toLowerCase();
            if (!fullName) return [];
            const index = _getChroniclesAwardIndex();
            const hits = index[fullName] || [];
            return hits.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
        }, [pid, p?.full_name, p?.first_name, p?.last_name]);

        // ── Scouting tab data — loaded lazily, only when that tab is open ──
        const [gameLog, setGameLog] = useState(null);           // null = loading, [] = none
        const [scoutTick, setScoutTick] = useState(0);          // bumps when SOS / weather finish loading

        // ── Value History tab data — loaded lazily, only when that tab is open ──
        const currentLeague = window.S?.leagues?.find(l => String(l.league_id || l.id) === String(window.S?.currentLeagueId)) || {};
        const [valueHistory, setValueHistory] = useState(null);
        const [historyError,setHistoryError]=useState(null);
        const [historyFormat,setHistoryFormat]=useState(Number(currentLeague?.settings?.type)===0?'redraft':'dynasty'); // null = loading, [] = none
        useEffect(() => {
            if (tab !== 'value-history' || !pid) return;
            let alive = true;
            const S = window.S || {};
            const leagueId = S.currentLeagueId;
            if (!leagueId || typeof window.OD?.loadValueSnapshots !== 'function') { setValueHistory([]); return; }
            setValueHistory(null);setHistoryError(null);
            window.OD.loadValueSnapshots({ leagueId, playerId: pid, valueType:historyFormat })
                .then(rows => { if (alive) setValueHistory(rows || []); })
                .catch(e => { if (alive) {setHistoryError(e.message);setValueHistory([]);} });
            return () => { alive = false; };
        }, [tab, pid, currentLeague?.league_id, historyFormat]);
        useEffect(() => {
            if (tab !== 'scouting' || !pid) return;
            let alive = true;
            const A = window.App || {};
            const S = window.S || {};
            const season = (S.nflState && S.nflState.season) || S.season || (new Date().getFullYear());
            const scoring = scoringSettings
                || ((S.leagues && S.leagues.find(l => l.league_id === S.currentLeagueId)) || {}).scoring_settings
                || ((S.leagues && S.leagues[0]) || {}).scoring_settings || {};
            // Warm the matchup engines so opponent + weather fill in when ready.
            if (A.SOS && A.SOS.initialize && !A.SOS.ready) A.SOS.initialize(season, playersData, () => { if (alive) setScoutTick(t => t + 1); });
            if (A.NflContext && A.NflContext.loadCurrent) A.NflContext.loadCurrent(season).then(() => { if (alive) setScoutTick(t => t + 1); }).catch(() => {});
            // Game-by-game log.
            if (A.GameLog && A.GameLog.buildPlayerLog) {
                A.GameLog.buildPlayerLog(pid, season, { playersData, scoring }).then(r => { if (alive) setGameLog(r || []); }).catch(() => { if (alive) setGameLog([]); });
            } else if (alive) setGameLog([]);
            return () => { alive = false; };
        }, [tab, pid, scoutTick]);

        if (!p) return null;

        const pos = p.position || '?';
        const nPos = normPos(pos);
        const name = playerName(p);
        const scoutNote = draftScoutNote(pid);
        const age = p.age || 0;
        const team = p.team || 'FA';
        const dhq = window.App?.LI?.playerScores?.[pid] || 0;
        const meta = window.App?.LI?.playerMeta?.[pid] || {};
        const st = statsData?.[pid] || {};
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(nPos)
            : { build: [22, 24], peak: (window.App?.peakWindows || {})[nPos] || [24, 29], decline: [30, 32] };
        const [pLo, pHi] = curve.peak;
        const declineHi = curve.decline[1];
        const peakYrs = Math.max(0, pHi - age);
        const valueYrs = Math.max(0, declineHi - age);
        const peakLabel = age < pLo ? 'Rising' : age <= pHi ? 'Prime' : age <= declineHi ? 'Veteran' : 'Post-Window';
        const peakCol = age < pLo ? 'var(--k-2ecc71, #2ecc71)' : age <= pHi ? 'var(--k-d4af37, #d4af37)' : age <= declineHi ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
        const dhqCol = dhq >= 7000 ? 'var(--k-2ecc71, #2ecc71)' : dhq >= 4000 ? 'var(--k-3498db, #3498db)' : dhq >= 2000 ? 'var(--k-d0d0d0, #d0d0d0)' : 'var(--text-muted)';
        const sc = scoringSettings || currentLeague?.scoring_settings || {};
        const leagueProfile = typeof window.App?.Intelligence?.buildLeagueProfile === 'function'
            ? window.App.Intelligence.buildLeagueProfile({ league: { ...currentLeague, scoring_settings: sc }, rosters: window.S?.rosters || [], platform: window.S?.platform || currentLeague?._platform })
            : null;
        const playerFormatReasons = leagueProfile && typeof window.App?.Intelligence?.buildPlayerFormatReasons === 'function'
            ? window.App.Intelligence.buildPlayerFormatReasons({ player: p, pos: nPos, profile: leagueProfile }).slice(0, 3)
            : [];
        const ppgRaw = typeof window.App?.calcPPG === 'function' ? window.App.calcPPG(st, sc) : 0;
        const ppg = ppgRaw > 0 ? +ppgRaw.toFixed(1) : (meta.ppg || 0);
        const trend = meta.trend || 0;
        const trendBadge = window.App?.classifyTrend?.(trend) || null;
        const playerContext = typeof window.App?.Intelligence?.buildPlayerContext === 'function'
            ? window.App.Intelligence.buildPlayerContext({
                id: 'player_context_' + pid,
                pid,
                player: p,
                pos: nPos,
                profile: leagueProfile,
                dhq,
                ppg,
                trend,
                peakYrs,
                valueYrs,
                formatReasons: playerFormatReasons,
            })
            : null;
        // Free/Pro seam: the BUY/SELL/HOLD verdict chip + roster recommendation
        // are Pro reads; raw DHQ/PPG/tier/curve stay free. Fail-open when
        // pro-gate.js isn't on the page.
        const isPro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
        const pa = typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
        const rec = pa ? pa.label.toUpperCase() :
            (valueYrs <= 0 && trend <= -10 ? 'SELL NOW' : valueYrs <= 0 ? 'SELL' : peakYrs <= 1 ? 'SELL' : dhq >= 7000 && peakYrs >= 3 ? 'HOLD CORE' : 'HOLD');
        const recCol = rec.includes('SELL') ? 'var(--k-e74c3c, #e74c3c)' : rec.includes('BUY') ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-d4af37, #d4af37)';
        const rosterRecommendation = isPro && typeof window.App?.Intelligence?.buildRosterRecommendation === 'function'
            ? window.App.Intelligence.buildRosterRecommendation({
                id: 'player_card_' + pid,
                pid,
                player: p,
                pos: nPos,
                profile: leagueProfile,
                dhq,
                trend,
                peakYrs,
                valueYrs,
                playerContext,
                action: rec.includes('SELL') ? 'sell' : rec.includes('BUY') ? 'target' : 'hold',
                formatReasons: playerFormatReasons,
                detail: rec.includes('SELL')
                    ? 'Value window is tightening; shop before the market prices in decline.'
                    : peakYrs >= 4
                        ? 'Long dynasty runway supports patience unless the offer is a clear tier-up.'
                        : 'Current value is tied to near-term production more than long-run upside.',
                badge: rec,
            })
            : null;
        if (typeof window.App?.Intelligence?.publishRecommendations === 'function' && rosterRecommendation) {
            window.App.Intelligence.publishRecommendations('player-card', [rosterRecommendation], { surface: 'player-card', playerId: pid });
        }
        const tier = tierFromDhq(dhq);
        const depthChart = typeof p.depth_chart_order === 'number'
            ? (pos + (p.depth_chart_order + 1))
            : null;
        const dhqContext = meta.statusReason
            ? (meta.statusReason + (meta.roleLabel ? ' · ' + meta.roleLabel : ''))
            : [meta.roleLabel, meta.opportunityLabel].filter(Boolean).join(' · ');
        const dhqContextCol = meta.statusReason ? 'var(--k-e74c3c, #e74c3c)'
            : meta.roleMult && meta.roleMult < 0.9 ? 'var(--k-f0a500, #f0a500)'
                : meta.opportunityMult && meta.opportunityMult < 1 ? 'var(--k-f0a500, #f0a500)'
                    : 'var(--text-muted)';
        // "Alex NFL Fit" — deterministic real-situation read from the engine's
        // signals (depth-chart role, named blockers + PPG, status, trend). No LLM
        // here to keep card opens cheap; the draft board layers a live read on top.
        // Seeded-template Alex verdict copy ("upside hold, not a weekly starter")
        // → Pro at render (clean absence), matching draft-room's teamFitInsight
        // gate; the raw dhqContext facts line above it stays free.
        const nflFit = (() => {
            try { return window.App?.computeNFLFit?.(pid, { pos, player: p, dhq }) || null; }
            catch (e) { return null; }
        })();
        const fitNarrative = nflFitText === undefined ? nflFit?.narrative : nflFitText;
        const inlineDraft = embedded && context === 'draft-board';

        // Roster context
        const S = window.S || {};
        const actionContext = context || S.activeTab || 'player-card';
        const cardAction = window.WR?.PlayerNotebook?.resolveAction({
            pid, league: currentLeague, rosters: S.rosters, myRosterId: S.myRosterId,
            context: actionContext, features: window.App?.LeagueSkin?.getCurrent?.()?.features || {},
        }) || { kind: 'watch', label: 'Watch player', mine: false };
        const isOnMyTeam = cardAction.mine;
        const portfolio = window.App?.PortfolioContext?.player?.(pid);

        const heightWeight = [p.height, p.weight].filter(Boolean).join(' / ');

        // customAwards is computed above (hoisted for stable hook order).

        // ── Action handlers ────────────────────────────────────────
        function goCompare() {
            try {
                // Player-vs-player Compare (Players mode). Fall back to the legacy
                // team-vs-team deep-link if the newer global isn't present.
                if (typeof window.wrComparePlayers === 'function') window.wrComparePlayers(pid);
                else if (typeof window.wrOpenCompare === 'function') window.wrOpenCompare(pid);
            } catch (e) { /* noop */ }
            onClose && onClose();
        }
        function goTradeBuilder() {
            window._wrTradeBuilderTarget = { pid, returnTab: typeof S.activeTab === 'string' ? S.activeTab : 'myteam', ts: Date.now() };
            onClose && onClose();
            if (typeof window.wrNavigateTab === 'function') window.wrNavigateTab('trades');
            else if (typeof window.setActiveTab === 'function') window.setActiveTab('trades');
            window.dispatchEvent(new CustomEvent('wr:open-trade-builder', { detail: window._wrTradeBuilderTarget }));
        }
        function goTradeFinder() {
            try {
                // Trade Center listens on window._wrTradeFinderTarget
                window._wrTradeFinderTarget = { pid, mode: isOnMyTeam ? 'my' : 'acquire', ts: Date.now() };
                if (typeof window.wrNavigateTab === 'function') window.wrNavigateTab('trades');
                else if (typeof window.setActiveTab === 'function') window.setActiveTab('trades');
                window.dispatchEvent(new CustomEvent('wr:open-trade-finder', { detail: { pid } }));
            } catch (e) { console.warn('[PlayerCard] Trade Finder deep-link unavailable', e); }
            onClose && onClose();
        }
        function goPrimaryAction() {
            if (cardAction.kind === 'trade') { goTradeFinder(); return; }
            const incoming = typeof actionContext === 'object' ? actionContext : {};
            const next = { ...incoming, pid: cardAction.dropPid ? null : pid, position: nPos, dropPid: cardAction.dropPid || incoming.dropPid,
                leagueId: S.currentLeagueId, source: typeof actionContext === 'string' ? actionContext : incoming.source || 'player-card' };
            if (cardAction.kind === 'draft') window.WR?.openDraftPlayer?.(next);
            else if (cardAction.kind === 'waiver') window.WR?.openAcquisition?.(next);
            else { window.WR?.PlayerNotebook?.update(pid, { watch: true }, { leagueId: S.currentLeagueId }); return; }
            onClose && onClose();
        }
        function applyTag(tag) {
            try {
                const leagueId = window.S?.currentLeagueId || window.S?.currentLeague?.league_id || window.S?.currentLeague?.id || '';
                const next = { ...(window._playerTags || {}) };
                const wasActive = next[pid] === tag;
                if (wasActive) delete next[pid];
                else next[pid] = tag;
                window._playerTags = next;

                if (window.OD?.savePlayerTags) {
                    window.OD.savePlayerTags(leagueId, next);
                } else if (leagueId) {
                    localStorage.setItem('player_tags_' + leagueId, JSON.stringify(next));
                }
                if (!wasActive) {
                    window.wrLogAction?.('🏷️', 'Tagged ' + name + ' as ' + tag, 'roster', {
                        players: [{ name, pid, pos: nPos }],
                        actionType: 'tag',
                    });
                }
                window.dispatchEvent(new CustomEvent('wr:player-tags-changed', { detail: { leagueId, tags: next, pid, tag: wasActive ? null : tag } }));
            } catch (e) { /* noop */ }
            setTagMenu(false);
        }

        // ── Overview section ──────────────────────────────────────
        function OverviewTab() {
            const compressed = compressHistory(historyRows || []);
            return React.createElement(React.Fragment, null,
                React.createElement(PlayerFantasySummary, { pid, player: p, league: currentLeague, scoring: sc, playersData, dhq }),
                !inlineDraft && dhqContext && React.createElement('div', {
                    style: {
                        margin: '12px 20px 0',
                        padding: '9px 11px',
                        border: '1px solid var(--acc-fill3, rgba(212,175,55,0.16))',
                        borderRadius: 'var(--card-radius-sm, 8px)',
                        background: 'var(--ov-2, rgba(255,255,255,0.025))',
                        color: dhqContextCol,
                        fontSize: 'var(--text-body, 1rem)',
                        lineHeight: 1.45,
                    }
                }, dhqContext),
                isPro && fitNarrative && React.createElement('div', {
                    style: {
                        margin: '10px 20px 0',
                        padding: '9px 11px',
                        border: '1px solid rgba(46,204,113,0.18)',
                        borderRadius: 'var(--card-radius-sm, 8px)',
                        background: 'rgba(46,204,113,0.05)',
                    }
                },
                    React.createElement('div', { style: { color: 'var(--k-2ecc71, #2ecc71)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px' } }, 'Alex NFL Fit'),
                    React.createElement('div', { style: { color: 'var(--text-muted)', fontSize: 'var(--text-body, 0.92rem)', lineHeight: 1.45 } }, fitNarrative)
                ),
                // Rookie Scouting Report — only when a prospect resolves (no regression for vets)
                !inlineDraft && prospect && scoutingReportBlock(prospect),
                // Age curve
                React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' } },
	                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
	                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 } }, 'Age Curve'),
	                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: peakCol } },
	                            peakLabel + ' · ' + (peakYrs > 0 ? peakYrs + 'yr peak left' : valueYrs > 0 ? valueYrs + 'yr value left' : 'Past value window'))
                    ),
                    React.createElement('div', { style: { display: 'flex', height: '18px', borderRadius: 'var(--card-radius-xs, 5px)', overflow: 'hidden', gap: '1px' } },
                        Array.from({ length: 17 }, (_, i) => {
                            const a = i + 20;
                            const col = a < pLo - 3 ? 'rgba(96,165,250,0.3)' :
                                a < pLo ? 'rgba(46,204,113,0.45)' :
                                (a >= pLo && a <= pHi) ? 'rgba(46,204,113,0.75)' :
	                                a <= declineHi ? 'var(--acc-line3, rgba(212,175,55,0.45))' : 'rgba(231,76,60,0.35)';
                            return React.createElement('div', {
                                key: a,
                                style: {
                                    flex: 1, background: col, opacity: a === age ? 1 : 0.55,
                                    outline: a === age ? '2px solid var(--k-d4af37, #d4af37)' : 'none', outlineOffset: '-1px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: a === age ? 'var(--text-primary)' : 'transparent'
                                }
                            }, a === age ? String(age) : '');
                        })
                    ),
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--text-muted)', marginTop: '4px' } },
                        React.createElement('span', null, '20'),
                        React.createElement('span', null, 'Peak ' + pLo + '–' + pHi),
                        React.createElement('span', null, '36')
                    )
                ),
                // Attributes row (depth chart clarified, no "News" button).
                // Phone: 2x2 instead of 4-across (~80px cells at 375 otherwise).
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '10px', padding: '14px 20px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' } },
                    [
                        { l: 'Experience', v: (p.years_exp || 0) + ' yr' + ((p.years_exp || 0) === 1 ? '' : 's') },
                        { l: 'NFL Depth Chart', v: depthChart || '—' },
                        { l: 'Height / Weight', v: heightWeight || '—' },
                        { l: 'College', v: p.college || '—' },
                    ].map((s, i) => React.createElement('div', { key: i },
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' } }, s.l),
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--text-primary)', fontWeight: 500 } }, s.v)
                    ))
                ),
                // Team history
                React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '8px' } }, 'Team History'),
                    historyLoading
                        ? React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.55 } }, 'Loading…')
                        : (compressed.length
                            ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                                compressed.map((r, i) => React.createElement('span', {
                                    key: i,
                                    style: {
                                        padding: '4px 10px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))',
                                        border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)',
                                        fontSize: 'var(--text-body, 1rem)', color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace'
                                    }
                                }, r.team + ' ' + (r.start === r.end ? r.start : r.start + '–' + r.end)))
                            )
                            : React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--text-primary)' } },
                                    team === 'FA' ? 'Free Agent' : ('Current: ' + team)
                                ),
                                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55, marginTop: '4px' } },
                                    'Per-season history not available from the current data source.'
                                )
                            )
                        )
                ),
                // Phase 9 deferred: custom awards from imported Chronicles
                customAwards.length > 0 && React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '8px' } }, 'Custom Awards'),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                        customAwards.map((a, i) => React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderRadius: 'var(--card-radius-sm, 8px)' } },
                            React.createElement('span', { style: { fontSize: 'var(--text-body, 1rem)' } }, '\uD83C\uDFC5'),
                            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--text-primary)' } }, a.name),
                                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' } },
                                    [a.year, a.stats, a.league].filter(Boolean).join(' · ')
                                )
                            )
                        ))
                    )
                )
            );
        }

        // ── Stats tab reuses InlineCareerStats (NFL + College, with PPG) ──
        function StatsTab() {
            const InlineCareerStats = window.InlineCareerStats;
            if (typeof InlineCareerStats !== 'function') {
                return React.createElement('div', { style: { padding: '28px 20px', color: 'var(--silver)', opacity: 0.6 } }, 'Stats module not loaded.');
            }
            // Phone: the career-stats tables can outgrow 375px — this wrapper
            // owns the horizontal scroll so the sheet body never pans sideways.
            return React.createElement('div', { style: { padding: '14px 20px', ...(isPhone ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%' } : null) } },
                React.createElement(InlineCareerStats, {
                    pid, pos, player: p,
                    scoringSettings: sc,
                    statsData
                })
            );
        }

        // ── Scouting tab: this-week matchup + injury + usage + game log + news ──
        function ScoutingTab() {
            const A = window.App || {};
            const GREEN = 'var(--k-2ecc71, #2ecc71)', AMBER = 'var(--k-f0a500, #f0a500)', RED = 'var(--k-e74c3c, #e74c3c)', SILVER = 'var(--silver)';
            const week = (A.WeeklyProj && A.WeeklyProj.currentWeek && A.WeeklyProj.currentWeek()) || 1;
            const teamU = String(team || '').toUpperCase();
            const opp = (A.SOS && A.SOS.schedule && A.SOS.schedule[week] && A.SOS.schedule[week][teamU]) || null;
            const ctx = (A.NflContext && A.NflContext.teamWeekCtx) ? A.NflContext.teamWeekCtx(team, week) : null;
            const weather = ctx && ctx.weather, vegas = ctx && ctx.vegas, home = ctx ? ctx.home : null;
            const ranks = A.SOS && A.SOS.defenseRankings;
            const dvpRank = (opp && ranks && ranks[opp]) ? ranks[opp]['vs' + nPos] : null;
            const dvp = dvpRank ? (dvpRank >= 25 ? { t: 'Great matchup', c: GREEN } : dvpRank >= 20 ? { t: 'Favorable', c: GREEN } : dvpRank >= 12 ? { t: 'Neutral', c: SILVER } : dvpRank >= 7 ? { t: 'Tough', c: AMBER } : { t: 'Hard', c: RED }) : null;
            const avail = (A.StartSit && A.StartSit.availability) ? A.StartSit.availability(p.injury_status) : { available: !p.injury_status, mult: 1 };
            const usage = (A.GameLog && A.GameLog.usageSeries && gameLog && gameLog.length) ? A.GameLog.usageSeries(gameLog, nPos) : null;
            const sectionStyle = { padding: '14px 20px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' };
            const hdrStyle = { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '8px' };
            const wxText = weather ? (weather.indoor ? 'Dome' : ([weather.temp != null ? Math.round(weather.temp) + '°' : null, weather.display].filter(Boolean).join(' '))) : null;

            return React.createElement(React.Fragment, null,
                React.createElement('div', { style: sectionStyle },
                    React.createElement('div', { style: hdrStyle }, 'Week ' + week + ' Matchup'),
                    opp ? React.createElement('div', null,
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
                            React.createElement('span', { style: { fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' } }, (home ? 'vs ' : '@ ') + opp),
                            dvp ? React.createElement('span', { style: { fontSize: 'var(--text-label, 0.8rem)', fontWeight: 700, color: dvp.c } }, dvp.t + (dvpRank ? ' (D#' + dvpRank + ' vs ' + nPos + ')' : '')) : null
                        ),
                        React.createElement('div', { style: { display: 'flex', gap: '14px', marginTop: '6px', fontSize: 'var(--text-label, 0.78rem)', color: 'var(--text-muted)' } },
                            (vegas && vegas.impliedTotal) ? React.createElement('span', { key: 'it' }, 'Team total ' + Math.round(vegas.impliedTotal)) : null,
                            (vegas && vegas.spread != null) ? React.createElement('span', { key: 'sp' }, 'Spread ' + (vegas.spread > 0 ? '+' : '') + vegas.spread) : null,
                            wxText ? React.createElement('span', { key: 'wx' }, wxText) : null
                        )
                    ) : React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 } }, 'Opponent not set yet (off-season or schedule pending).')
                ),
                p.injury_status ? React.createElement('div', { style: sectionStyle },
                    React.createElement('div', { style: hdrStyle }, 'Injury'),
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                        React.createElement('span', { style: { padding: '3px 10px', borderRadius: 'var(--card-radius-xs, 5px)', fontWeight: 800, fontSize: 'var(--text-label, 0.75rem)', color: avail.available ? AMBER : RED, border: '1px solid ' + (avail.available ? 'rgba(240,165,0,0.4)' : 'rgba(231,76,60,0.4)') } }, String(p.injury_status).toUpperCase()),
                        React.createElement('span', { style: { fontSize: 'var(--text-label, 0.8rem)', color: 'var(--text-muted)' } }, avail.available ? ('~' + Math.round((avail.mult || 1) * 100) + '% expected') : 'Not expected to play')
                    )
                ) : null,
                usage ? React.createElement('div', { style: sectionStyle },
                    React.createElement('div', { style: hdrStyle }, 'Usage'),
                    React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' } }, usage.avg),
                        React.createElement('span', { style: { fontSize: 'var(--text-label, 0.78rem)', color: 'var(--text-muted)' } }, usage.label + ' · last: ' + usage.series.slice(-6).map(x => x.v).join(', '))
                    )
                ) : null,
                React.createElement('div', { style: sectionStyle },
                    React.createElement('div', { style: hdrStyle }, 'This Season · Game by Game'),
                    gameLog == null
                        ? React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 } }, 'Loading game log…')
                        : (gameLog.filter(r => r.played || r.isBye).length === 0
                            ? React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 } }, 'No games logged yet this season.')
                            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
                                gameLog.map(r => {
                                    if (!r.played && !r.isBye) return null;
                                    const ks = (A.GameLog && r.statLine) ? A.GameLog.keyStats(r.statLine, nPos) : [];
                                    return React.createElement('div', { key: r.week, style: { display: 'grid', gridTemplateColumns: '28px 44px 46px 1fr', gap: '8px', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))' } },
                                        React.createElement('span', { style: { fontSize: 'var(--text-label, 0.72rem)', color: 'var(--silver)', fontWeight: 700 } }, 'W' + r.week),
                                        React.createElement('span', { style: { fontSize: 'var(--text-label, 0.74rem)', color: 'var(--text-muted)' } }, r.isBye ? 'BYE' : (r.opp || '—')),
                                        React.createElement('span', { style: { textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.82rem)', fontWeight: 700, color: r.isBye ? 'var(--silver)' : (r.pts >= 15 ? GREEN : r.pts != null ? 'var(--text-primary)' : 'var(--silver)') } }, r.isBye ? '—' : (r.pts != null ? r.pts.toFixed(1) : '—')),
                                        React.createElement('span', { style: { fontSize: 'var(--text-label, 0.72rem)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.isBye ? 'Bye week' : ks.map(k => k.l + ' ' + k.v).join(' · '))
                                    );
                                })
                            )
                        )
                )
            );
        }

        // ── Value History tab ────────────────────────────────────────────
        // Point-in-time DHQ value snapshots (draft pick / trade / periodic
        // capture) — see dhq-shared/supabase-client.js recordValueSnapshot
        // and supabase/migrations/20260809000000_player_value_snapshots.sql.
        // History only accumulates from when a snapshot was first written;
        // there is no way to reconstruct what a player was worth before
        // this shipped, so an early-looking series is expected, not a bug.
        function ValueHistoryTab() {
            const e=React.createElement,rows=valueHistory||[];
            const colors={draft:'var(--gold)',trade:'var(--k-5dade2, #5dade2)',periodic:'var(--silver)',monitor:'var(--k-2ecc71, #2ecc71)'};
            const first=rows[0],last=rows.at(-1);
            const delta=first?.value!=null&&last?.value!=null&&(first.calculation_status||'ok')==='ok'&&(last.calculation_status||'ok')==='ok'?Number(last.value)-Number(first.value):null;
            const good=rows.filter(r=>r.value!=null && (r.calculation_status||'ok')==='ok');
            const points=rows.map((r,i)=>({r,x:i,y:r.value==null?null:Number(r.value)}));
            const max=Math.max(1,...good.map(r=>Number(r.value))),x=i=>10+i/Math.max(1,rows.length-1)*540,y=v=>130-v/max*115;
            let pen=false;const path=points.map(p=>{if(p.y==null||p.r.calculation_status&&p.r.calculation_status!=='ok'){pen=false;return ''; }const cmd=pen?'L':'M';pen=true;return cmd+x(p.x)+','+y(p.y);}).join(' ');
            return e('div',{style:{padding:'14px 20px'}},
                e('h3',null,'Value History'),
                rows.length>1&&delta!=null?e('p',null,'Captured change: '+(delta>0?'+':'')+delta.toLocaleString()):null,
                e('label',null,'Value format ',e('select',{value:historyFormat,onChange:ev=>setHistoryFormat(ev.target.value)},e('option',{value:'dynasty'},'Dynasty'),e('option',{value:'redraft'},'Redraft'))),
                e(window.App.ValueMonitorPanel,{leagueId:currentLeague?.league_id||window.S?.currentLeagueId}),
                historyError?e('p',{role:'alert'},historyError):valueHistory===null?e('p',null,'Loading persisted history…'):!rows.length?e('p',null,'No persisted observations in this format. History starts when values are captured; past values cannot be reconstructed.'):null,
                good.length?e('svg',{width:'100%',height:140,viewBox:'0 0 560 140','aria-label':historyFormat+' value history'},
                    e('path',{d:path,fill:'none',stroke:'var(--gold)',strokeWidth:1.5}),points.filter(p=>p.y!=null&&(p.r.calculation_status||'ok')==='ok').map(p=>e('circle',{key:p.r.id,cx:x(p.x),cy:y(p.y),r:3,fill:colors[p.r.source]||'var(--silver)'},e('title',null,new Date(p.r.ts).toLocaleString()+' · '+p.r.source+' · '+p.y)))):null,
                e('div',{style:{display:'flex',gap:12,flexWrap:'wrap',fontSize:12}},Object.keys(colors).map(source=>e('span',{key:source,style:{color:colors[source]}},'● '+source))),
                e('p',{style:{fontSize:12,color:'var(--text-muted)'}},'Captured observations, not historical reconstructions. Latest 40 records listed. Gaps represent unavailable values. Legacy timestamps and calculation provenance may be unverified.'),
                rows.slice().reverse().slice(0,40).map(r=>e('details',{key:r.id,style:{padding:'6px 0',borderBottom:'1px solid var(--border-subtle, #333)'}},
                    e('summary',null,new Date(r.ts).toLocaleString()+' · '+(r.value==null?'Unknown':Number(r.value).toLocaleString())+' · '+r.source+' · '+(r.calculation_status||'legacy')),
                    e('p',null,'Season '+r.season+' / week '+r.week+' · '+r.value_type+' · calculated '+(r.calculated_at||'unknown')),
                    e('p',null,'Capture '+(r.capture_key||'legacy')+(r.context?.observed_now?' · event discovered now, not valued historically':'')),
                    e('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:11}},JSON.stringify(r.provenance||{},null,2))
                ))
            );
        }

        // ── Render ────────────────────────────────────────────────
        const backdrop = {
            position: 'fixed', inset: 0, background: 'var(--surf-solid, rgba(5,6,9,0.72))',
            zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px', animation: 'wrFadeIn 0.15s ease'
        };
        const modal = {
            width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto',
            background: 'var(--k-0a0b0d, #0a0b0d)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
            borderRadius: 'var(--card-radius-lg, 14px)', boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
            animation: 'wrFadeIn 0.2s ease'
        };

        // Card content is tier-agnostic; only the shell differs (sheet vs modal).
        const cardBody = React.createElement(React.Fragment, null,
                // Hero
                React.createElement('div', { className: 'wr-player-card-hero', style: { padding: '18px 20px', background: 'linear-gradient(135deg, var(--acc-fill2, rgba(212,175,55,0.10)), transparent 60%)', borderBottom: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', display: 'flex', gap: '14px', alignItems: 'center' } },
                    React.createElement('div', { className: 'wr-ring wr-ring-' + nPos, style: { width: '60px', height: '60px', borderRadius: 'var(--card-radius-lg, 14px)', overflow: 'hidden', background: 'var(--acc-fill2, rgba(212,175,55,0.1))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
                        React.createElement('img', {
                            src: 'https://sleepercdn.com/content/nfl/players/' + pid + '.jpg',
                            style: { width: '60px', height: '60px', objectFit: 'cover' },
                            onError: function (e) { e.target.style.display = 'none'; }
                        })
                    ),
                    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' } },
                            React.createElement('span', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-hero, 2rem)', color: 'var(--text-primary)', letterSpacing: '0.02em' } }, name),
                            trendBadge && React.createElement('span', {
                                title: 'Year-over-year PPG change: ' + (trendBadge.pct > 0 ? '+' : '') + trendBadge.pct + '%',
                                style: {
                                    fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                                    padding: '2px 8px', borderRadius: 'var(--card-radius-xs, 5px)', whiteSpace: 'nowrap',
                                    color: trendBadge.color, border: '1px solid ' + window.wrAlpha(trendBadge.color, '55'), background: window.wrAlpha(trendBadge.color, '18'),
                                }
                            }, trendBadge.glyph + ' ' + trendBadge.label)
                        ),
                        // Single-row identity strip — no redundant profile block below
                        React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--k-d0d0d0, #d0d0d0)', marginTop: '2px' } },
                            [nPos, team, window.App?.NFLByes?.label(p, window.App.NFLByes.seasonFor(currentLeague)) || 'Bye —', 'Age ' + (age || '?'), heightWeight, p.college].filter(Boolean).join(' · ')
                        )
                    ),
                    !embedded && React.createElement('button', {
                        ref: closeRef, onClick: onClose,
                        style: { background: 'none', border: '1px solid var(--ov-6, rgba(255,255,255,0.12))', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-body, 1rem)', padding: '4px 10px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                    }, '✕')
                ),
                // Private scouting note from the Draft Big Board (if any)
                !window.WR?.PlayerNotebook && scoutNote && React.createElement('div', {
                    style: { margin: '12px 20px 0', padding: '10px 12px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: 'var(--card-radius-sm, 8px)' }
                },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gold)', marginBottom: '4px' } }, '📝 Your scouting note'),
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.8rem)', color: 'var(--k-d0d0d0, #d0d0d0)', lineHeight: 1.45, whiteSpace: 'pre-wrap' } }, scoutNote)
                ),
                portfolio?.coveredLeagues > 1 && React.createElement('p', { style: { margin: '10px 20px', fontSize: '.78rem', color: 'var(--silver)' }, title: (portfolio.leagues || []).map(l => l.name).join(' · ') }, 'Owned in ' + portfolio.count + ' of ' + portfolio.coveredLeagues + ' synced leagues'),
                !inlineDraft && window.WR?.PlayerNotebook?.NotebookEditor && React.createElement('div', { style: { margin: '10px 20px' } }, React.createElement(window.WR.PlayerNotebook.NotebookEditor, { pid, leagueId: S.currentLeagueId, leagueName: currentLeague.name || 'This league', compact: true })),
                // Tabs. Phone (D4 polish): the shared .wr-seg segmented sub-nav
                // (P2, index.html ≤767 block) with .is-on active anatomy —
                // three items distribute evenly (flex:1), no momentum scroll
                // needed. Desktop keeps the underline tab strip untouched.
                isPhone
                    ? React.createElement('div', { className: 'wr-seg', style: { margin: '12px 20px 0', flexWrap: 'wrap' } },
                        ['overview', 'season-stats', 'stats', 'scouting', 'value-history'].map(t =>
                            React.createElement('button', {
                                key: t,
                                className: tab === t ? 'is-on' : undefined,
                                onClick: () => setTab(t),
                                style: { minHeight: '44px' }
                            }, t === 'overview' ? 'Overview' : t === 'season-stats' ? 'Season Stats' : t === 'stats' ? 'Career Stats' : t === 'scouting' ? 'Scouting' : 'Value')
                        )
                    )
                    : React.createElement('div', {
                        style: { display: 'flex', flexWrap: 'wrap', gap: '2px', padding: '0 20px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }
                    },
                        ['overview', 'season-stats', 'stats', 'scouting', 'value-history'].map(t =>
                            React.createElement('button', {
                                key: t,
                                onClick: () => setTab(t),
                                style: {
                                    padding: '10px 14px', minHeight: '44px', background: 'transparent',
                                    border: 'none', borderBottom: tab === t ? '2px solid var(--gold)' : '2px solid transparent',
                                    color: tab === t ? 'var(--gold)' : 'var(--silver)',
                                    fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer'
                                }
                            }, t === 'overview' ? 'Overview' : t === 'season-stats' ? 'Season Stats' : t === 'stats' ? 'Career Stats' : t === 'scouting' ? 'Scouting' : 'Value')
                        )
                    ),
                // Tab body
                tab === 'overview' ? OverviewTab() : tab === 'season-stats' ? React.createElement(PlayerSeasonStats, { key: pid + '|' + (currentLeague.league_id || ''), pid, player: p, league: currentLeague, scoring: sc }) : tab === 'stats' ? StatsTab() : tab === 'scouting' ? ScoutingTab() : ValueHistoryTab(),
                // Actions — Compare, Trade Finder, Tag As (no News button).
                // Phone (D4 polish): the 4 buttons ride a 2-up grid of 44px
                // targets (never a sideways pan); desktop keeps the flex row.
                React.createElement('div', { style: { padding: '14px 20px', display: 'flex', gap: '8px', borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))', position: 'relative', ...(isPhone ? { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' } : null) } },
                    React.createElement('button', { onClick: goCompare, style: btnStyle() }, 'Compare'),
                    React.createElement('button', { onClick: cardAction.kind === 'trade' ? goTradeBuilder : goPrimaryAction, style: btnStyle('primary') }, cardAction.kind === 'trade' ? 'Build a trade' : cardAction.label),
                    cardAction.kind === 'trade' && React.createElement('button', { onClick: goTradeFinder, style: btnStyle() }, 'Find offers'),
                    isOnMyTeam && React.createElement('button', { onClick: () => { onClose && onClose(); window.wrNavigateTab?.('lineup'); }, style: btnStyle() }, 'Set lineup'),
                    React.createElement('button', { onClick: () => { onClose && onClose(); window.dispatchEvent(new CustomEvent('wr:mission-alex-open', { detail: { pid, prompt: 'Help me decide what to do with ' + (p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ')) + '.' } })); }, style: btnStyle() }, 'Ask Alex'),
                    isOnMyTeam && React.createElement('button', { onClick: () => setTagMenu(!tagMenu), style: btnStyle() }, 'Tag As ▾'),
                    isOnMyTeam && tagMenu ? React.createElement('div', {
                        // Phone: full-width above the grid so the 4 tag rows are
                        // easy 44px targets; desktop anchors right, unchanged.
                        style: { position: 'absolute', bottom: '54px', right: '20px', background: 'var(--k-0a0b0d, #0a0b0d)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '6px', zIndex: 5, minWidth: '160px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', ...(isPhone ? { left: '20px', right: '20px', bottom: '60px' } : null) }
                    },
                        (isOnMyTeam ? ['trade', 'cut', 'untouchable'] : []).filter(t => t !== 'trade' || cardAction.kind === 'trade').map(t =>
                            React.createElement('button', {
                                key: t, onClick: () => applyTag(t),
                                style: { display: 'block', width: '100%', textAlign: 'left', padding: '12px 10px', minHeight: '44px', background: 'transparent', border: 'none', color: 'var(--k-d0d0d0, #d0d0d0)', fontSize: 'var(--text-body, 1rem)', cursor: 'pointer', borderRadius: 'var(--card-radius-xs, 5px)' }
                            }, 'Tag as ' + t.charAt(0).toUpperCase() + t.slice(1))
                        )
                    ) : null,
                    !embedded && React.createElement('button', { onClick: onClose, style: btnStyle('ghost', isPhone ? null : { marginLeft: 'auto' }) }, 'Close')
                )
        );

        if (embedded) {
            return React.createElement('section', { className: 'wr-player-card-embedded', 'aria-label': name + ' player profile' }, cardBody);
        }

        // Phone (<768): full-width bottom sheet via the shared WR.Sheet
        // primitive (plan D4). showClose:false — the hero already carries the
        // card's own 44px ✕; the sheet adds grab-strip drag-down + scrim tap.
        // Tablet/desktop: the centered 640px modal below, unchanged.
        if (isPhone && window.WR && window.WR.Sheet) {
            return React.createElement(window.WR.Sheet, { open: true, onClose: onClose, showClose: false }, cardBody);
        }
        return React.createElement('div', { style: backdrop, onClick: (e) => { if (e.target === e.currentTarget) onClose && onClose(); } },
            React.createElement('div', { style: modal, onClick: (e) => e.stopPropagation() }, cardBody)
        );
    }

    function btnStyle(variant, extra) {
        const base = {
            padding: '9px 14px', minHeight: '44px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
            borderRadius: 'var(--card-radius-sm, 8px)', fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-body, 1rem)',
            letterSpacing: '0.03em', cursor: 'pointer'
        };
        if (variant === 'primary') return { ...base, background: 'var(--k-d4af37, #d4af37)', color: 'var(--k-0a0a0a, #0a0a0a)', border: '1px solid var(--k-d4af37, #d4af37)', ...(extra || {}) };
        if (variant === 'ghost')   return { ...base, background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', ...(extra || {}) };
        return { ...base, background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', ...(extra || {}) };
    }

    // ── Host component: mounted once into a root container ────────
    function PlayerCardHost() {
        const [state, setState] = useState(null); // { pid, options }

	        useEffect(() => {
	            window.WR = window.WR || {};
	            window.WR.openPlayerCard = function (pid, options) {
	                if (!pid) return;
	                window.OD?.track?.('player_modal_opened', {
	                    platform: 'warroom',
	                    module: window.S?.activeTab || null,
	                    leagueId: window.S?.currentLeagueId || null,
	                    entityType: 'player',
	                    entityId: pid,
	                    metadata: { source: options?.context || 'player_card' },
	                });
	                setState({ pid, options: options || {} });
	            };
            window.WR.closePlayerCard = function () { setState(null); };
            return () => { /* Do not clear globals on unmount; host is persistent */ };
        }, []);

        if (!state) return null;
        const playersData = (window.App && window.App._playersCache) || {};
        const statsData = window._wrStatsData || window.App?._statsCache || {};
        // Callers that don't pass scoring settings fall through to PlayerCard's
        // own resolver, which reads the CURRENT league. Defaulting to
        // leagues[0] here silently scored every such card against whichever
        // league happened to sync first.
        const sc = state.options.scoringSettings;
        return React.createElement(PlayerCard, {
            pid: state.pid,
            playersData,
            statsData,
            scoringSettings: sc,
            initialTab: state.options.tab,
            context: state.options.context,
            onClose: () => setState(null)
        });
    }

    // ── Boot ──────────────────────────────────────────────────────
    window.PlayerCard = PlayerCard;
    window.PlayerCardHost = PlayerCardHost;

    function mount() {
        if (document.getElementById('wr-player-card-root')) return;
        const el = document.createElement('div');
        el.id = 'wr-player-card-root';
        document.body.appendChild(el);
        // Defer until React + ReactDOM are ready
        const tryRender = () => {
            if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
                return setTimeout(tryRender, 80);
            }
            try {
                if (ReactDOM.createRoot) {
                    ReactDOM.createRoot(el).render(React.createElement(PlayerCardHost));
                } else {
                    ReactDOM.render(React.createElement(PlayerCardHost), el);
                }
            } catch (e) { console.warn('[PlayerCard] mount failed', e); }
        };
        tryRender();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
