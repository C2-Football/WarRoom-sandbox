// ══════════════════════════════════════════════════════════════════
// js/tabs/my-team.js — MyTeamTab: roster view with format-aware value labels,
// PPG stats, age curves, acquisition history, and column customization
// Extracted from league-detail.js. Props: all required state from LeagueDetail.
// ══════════════════════════════════════════════════════════════════

function MyTeamTab({
  // Core data
  myRoster,
  currentLeague,
  leagueSkin,
  playersData,
  statsData,
  stats2025Data,
  standings,
  sleeperUserId,

  // Roster filter / sort / columns
  rosterFilter,
  setRosterFilter,
  rosterSort,
  setRosterSort,
  visibleCols,
  setVisibleCols,
  expandedPid,
  setExpandedPid,
  showColPicker,
  setShowColPicker,
  colPreset,
  setColPreset,

  // Compare sub-view was promoted to its own top-level tab (js/tabs/compare.js)
  // so myTeamView / compareTeamId props are gone.

  // GM Strategy
  gmStrategy,
  setGmStrategy,
  gmStrategyOpen,
  setGmStrategyOpen,

  // Alex avatar
  setAlexAvatar,
  setAvatarKey,

  // Navigation
  setActiveTab,

  // Misc
  timeRecomputeTs,
  setTimeRecomputeTs,
  getAcquisitionInfo: getAcquisitionInfoProp,
}) {
  // Fallback if prop not passed — prevents crash
  const getAcquisitionInfo = typeof getAcquisitionInfoProp === 'function' ? getAcquisitionInfoProp : () => ({ method: 'Unknown', date: '', cost: '' });
  const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
  const skinFeatures = resolvedLeagueSkin?.features || {};
  const skinVocabulary = resolvedLeagueSkin?.vocabulary || {};
  const valueLabel = skinVocabulary.valueLabel || 'DHQ Dynasty Value';
  const valueShortLabel = skinVocabulary.valueShortLabel || 'Value';

  // Scout-free vs Pro. Free keeps every raw column + sort/filter/tags/IR/taxi;
  // the verdict layer (Move column, DROP? chips, row tints, Action lens,
  // dossier roster call, START/SIT line, Dynasty Read AI) keys on this one
  // predicate — wrIsPro only, never canAccess/getTier (shadowing hazard).
  const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;

  function calcRawPts(s) { return window.App.calcRawPts(s, currentLeague?.scoring_settings); }

  function getPlayerName(playerId) {
    const player = playersData[playerId];
    if (!player) return `Player ${playerId}`;
    return player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || `Player ${playerId}`;
  }

  // Rookie/prospect join — name→prospect index (rebuilt when the rookie CSV lands,
  // signalled by timeRecomputeTs). Resolves a roster player to its rookie-data
  // record so the rich scouting fields surface in columns + the Rookies filter.
  const RookieFields = window.App?.RookieFields;
  const rookieIndex = React.useMemo(() => RookieFields ? RookieFields.buildIndex() : new Map(), [timeRecomputeTs]);
  const prospectForRow = React.useCallback((r) => RookieFields ? RookieFields.lookup(rookieIndex, r?.p, { posGuard: true }) : null, [rookieIndex]);
  const isRookieRow = React.useCallback((r) => {
    if (!r || !r.p) return false;
    const pr = prospectForRow(r);
    return RookieFields ? RookieFields.isRookie(r.p, pr, { cur: statsData, prev: stats2025Data }) : false;
  }, [prospectForRow, statsData, stats2025Data]);

  // NFL draft capital for EVERYONE (vets included) — static vendored dataset
  // (js/shared/draft-profile-data.js → window.WR_DRAFT_PROFILE): [year, round,
  // OVERALL pick, team]; round 0 = confirmed UDFA. Rookie prospect records
  // (prospectForRow) stay the richer source and take precedence where present.
  const draftCapFor = (pid) => {
    const d = window.WR_DRAFT_PROFILE?.[pid];
    if (!d) return null;
    return { year: d[0] || 0, round: d[1] || 0, overall: d[2] || 0, team: d[3] || '' };
  };

  // ── GM Strategy — single source of truth. Live-updates on GM Strategy save. ──
  // Drives untouchable lock badges, target/sell position accents, and a sell-rule
  // nudge on the roster recommendation. Hook is called once, unconditionally.
  const gm = window.WR.GmMode.useGmEffects(currentLeague);
  const gmTargetPositions = gm?.targetPositions instanceof Set ? gm.targetPositions : new Set();
  const gmSellPositions = gm?.sellPositions instanceof Set ? gm.sellPositions : new Set();
  const gmUntouchable = gm?.untouchable instanceof Set ? gm.untouchable : new Set();
  // Parse free-text sell rules like "Sell RB age 27+" leniently. Returns
  // { pos: 'RB', minAge: 27 } per parseable rule; unparseable rules are ignored.
  const gmSellRulesParsed = React.useMemo(() => {
    const out = [];
    (gm?.sellRules || []).forEach(rule => {
      try {
        const s = String(rule);
        const posM = s.match(/\b(QB|RB|WR|TE|K|DEF|DL|LB|DB)\b/i);
        const ageM = s.match(/age\s*(\d{1,2})\s*\+?/i);
        if (!posM && !ageM) return; // nothing structured to match on
        out.push({
          pos: posM ? posM[1].toUpperCase() : null,
          minAge: ageM ? parseInt(ageM[1], 10) : null,
        });
      } catch {}
    });
    return out;
  }, [gm?.sellRules]);
  // Does a row trip a sell rule or a sell-position? Used to nudge the rec.
  const gmTripsSell = React.useCallback((r) => {
    if (!r) return false;
    const pos = String(r.pos);
    if (gmSellPositions.has(pos)) return true;
    return gmSellRulesParsed.some(rule => {
      const posOk = !rule.pos || rule.pos === pos;
      const ageOk = rule.minAge == null || (r.age != null && r.age >= rule.minAge);
      // A rule with neither a usable pos nor age constraint shouldn't fire blindly.
      if (rule.pos == null && rule.minAge == null) return false;
      return posOk && ageOk;
    });
  }, [gmSellPositions, gmSellRulesParsed]);

  // GM Strategy-aware cut/taxi scoring — how strongly a bench player's OWN
  // mode nudges him toward CUT or STASH, independent of raw DHQ. Rebuild
  // protects developing players and pushes out aging vets; Win Now does the
  // opposite (protects proven vets, pushes out pieces that can't help THIS
  // season); Compete stays close to raw DHQ with a light decline-phase nudge.
  // Feeds both the drop/taxi candidate ranking below and the GM's Desk copy.
  //
  // Positional scarcity — mirrors free-agency.js's getScarcityMultiplier
  // (same league-format signal: superflex QB, TE-premium TE, RB-heavy roster
  // shape) so "scarce" means the same thing everywhere in the app. This is a
  // standing protection nudge, not a strategy preference — losing your only
  // real depth at a scarce position is a mistake in ANY mode, so it applies
  // on top of (not instead of) the rebuild/compete/win_now signal below.
  const _scarcityMult = React.useCallback((pos) => {
    const positions = currentLeague?.roster_positions || [];
    const scoring = currentLeague?.scoring_settings || {};
    let mult = 1.0;
    if (positions.includes('SUPER_FLEX') && pos === 'QB') mult = 1.8;
    if ((scoring.bonus_rec_te || scoring.rec_te || 0) > 0 && pos === 'TE') mult = 1.5;
    const rbSlots = positions.filter(s => s === 'RB').length;
    if (pos === 'RB' && rbSlots >= 2) mult = Math.max(mult, 1.3);
    return mult;
  }, [currentLeague]);
  const _cutScore = React.useCallback((r) => {
    let score = 0;
    const mode = gm?.mode;
    const ageCutoff = gm?.tradeWeights?.ageCutoff || 30;
    if (mode === 'rebuild') {
      if (r.peakPhase === 'VET' || r.peakPhase === 'POST') score += 15;
      if (r.age != null && r.age >= ageCutoff) score += 10;
      if (r.peakPhase === 'PRE') score -= 20;
    } else if (mode === 'win_now') {
      if (r.peakPhase === 'PRE') score += 15;
      if (r.age != null && r.age <= 22 && !r.curGP) score += 10;
      if (r.peakPhase === 'VET') score -= 15;
    } else {
      if (r.peakPhase === 'POST') score += 5;
    }
    if (gmSellPositions.has(String(r.pos))) score += 8;
    if (gmTargetPositions.has(String(r.pos))) score -= 5;
    score -= (_scarcityMult(r.pos) - 1) * 20;
    return score;
  }, [gm?.mode, gm?.tradeWeights, gmSellPositions, gmTargetPositions, _scarcityMult]);
  // Strategy's influence is capped to a FRACTION of the player's own DHQ (max
  // ±20%), not a flat point deduction — so it can only reorder near-equal-value
  // bench players. A blunt age/phase signal must never outrank real production:
  // a still-strong older player (last year's 3rd-best scorer at his position,
  // say) keeps ~80%+ of his real value and stays well clear of the worst bench
  // spots, even in Rebuild mode. Only players ALREADY close in raw DHQ get
  // reshuffled by strategy fit.
  const _adjustedDhq = React.useCallback((r) => {
    const scorePct = Math.max(-0.2, Math.min(0.2, _cutScore(r) / 200));
    return r.dhq * (1 - scorePct);
  }, [_cutScore]);
  // One-line, strategy-grounded reasoning for a GM's Desk call.
  const _gmDeskReason = React.useCallback((r, verdict) => {
    const mode = gm?.mode;
    const ageTxt = r.age != null ? r.age + '-year-old ' : '';
    if (verdict === 'STASH') {
      if (mode === 'win_now') return 'Not ready to move the needle this season — taxi him and save the bench spot for a win-now piece.';
      if (mode === 'rebuild') return ageTxt + r.pos + ', still building — exactly what a rebuild protects. Taxi him, don’t cut him.';
      return 'Taxi-eligible with real upside left — no reason to burn a bench spot on him yet.';
    }
    if (mode === 'rebuild') {
      if (r.valueYrsLeft <= 0) return 'Value window’s closed — that’s trade bait in a rebuild, not a roster spot.';
      return ageTxt + r.pos + ' doesn’t fit a youth build. Sell him or cut him.';
    }
    if (mode === 'win_now') {
      if (!r.curGP) return 'Hasn’t played a snap that matters — a win-now roster can’t carry a developmental piece.';
      return ageTxt + r.pos + ' isn’t helping this year’s push.';
    }
    return 'Lowest DHQ on the bench — not developing, not producing.';
  }, [gm?.mode]);

  // ── Weekly start/sit projections (redraft) — league-scored via App.WeeklyProj.
  // Computed once; the 'proj' column + its sort read it. Neutral matchup until the
  // projections feed lands; guarded so dynasty/offseason rows just render '—'.
  const weeklyLineup = React.useMemo(() => {
    const WP = window.App && window.App.WeeklyProj;
    if (!WP || !myRoster || !currentLeague) return null;
    try {
      const res = WP.optimalForRoster(myRoster, currentLeague, { playersData, statsData, priorData: stats2025Data });
      return { res, starterSet: new Set((res.optimal.starters || []).map(s => String(s.pid))), objective: res.objective };
    } catch (e) { if (window.wrLog) window.wrLog('myteam.weeklyProj', e); return null; }
  }, [myRoster, currentLeague, playersData, statsData, stats2025Data, timeRecomputeTs]);
  const projFor = (pid) => (weeklyLineup && weeklyLineup.res.projections[pid]) || null;

  // Build rest-of-season values for REDRAFT leagues so the value column + sort
  // + coloring reflect ROS production instead of dynasty DHQ. No-op (falls back
  // to DHQ) for dynasty/keeper, offseason, or when no weeks remain.
  React.useMemo(() => {
    try {
      window.App?.PlayerValue?.ensureRos?.({
        leagueId: currentLeague?.league_id || currentLeague?.id,
        league: currentLeague, playersData, statsData, priorData: stats2025Data,
        skin: resolvedLeagueSkin,
      });
    } catch (e) { if (window.wrLog) window.wrLog('myteam.ensureRos', e); }
    return null;
  }, [currentLeague, playersData, statsData, stats2025Data, timeRecomputeTs]);

  // ── filteredAndSortedRows (formerly a sibling function of renderMyTeamTab) ──
  function filteredAndSortedRows(rows) {
    const offPos = new Set(['QB','RB','WR','TE','K','DEF']);
    const idpPos = new Set(['DL','LB','DB']);
    let filtered = rows;
    if (rosterFilter === 'Starters') filtered = rows.filter(r => r.isStarter);
    else if (rosterFilter === 'Bench') filtered = rows.filter(r => !r.isStarter && !r.isIR && !r.isTaxi);
    else if (rosterFilter === 'Taxi') filtered = rows.filter(r => r.isTaxi);
    else if (rosterFilter === 'IR') filtered = rows.filter(r => r.isIR);
    else if (rosterFilter === 'Offense') filtered = rows.filter(r => offPos.has(r.pos));
    else if (rosterFilter === 'IDP') filtered = rows.filter(r => idpPos.has(r.pos));
    else if (rosterFilter === 'Rookies') filtered = rows.filter(r => isRookieRow(r));

    const posOrder = {QB:0,RB:1,WR:2,TE:3,K:4,DEF:5,DL:6,LB:7,DB:8};
    return [...filtered].sort((a, b) => {
      const {key, dir} = rosterSort;
      if (rosterGroupMode !== 'none') {
        const gd = (getRowGroupRank(a) - getRowGroupRank(b)) || String(getRowGroupKey(a)).localeCompare(String(getRowGroupKey(b)));
        if (gd !== 0) return gd;
      }
      if (key === 'dhq') return (b.dhq - a.dhq) * dir;
      if (key === 'age') return ((a.age||99) - (b.age||99)) * dir;
      if (key === 'ppg') {
        // Honor the rolling PPG window so sort order matches what's displayed.
        let av = a.curPPG || 0, bv = b.curPPG || 0;
        if (ppgWindow !== 'season' && typeof window.App?.computeRollingPPG === 'function') {
          const n = ppgWindow === 'l3' ? 3 : 5;
          const ra = window.App.computeRollingPPG(a.pid, n);
          const rb = window.App.computeRollingPPG(b.pid, n);
          // Only override if rolling data is available for the player; else fall back to seasonal.
          if (ra > 0) av = ra;
          if (rb > 0) bv = rb;
        }
        return (bv - av) * dir;
      }
      if (key === 'proj') {
        const obj = weeklyLineup?.objective || 'median';
        const pv = r => { const p = projFor(r.pid); return p && p.available ? (p.points[obj] || 0) : -1; };
        return (pv(b) - pv(a)) * dir;
      }
      if (key === 'hi' || key === 'lo') {
        const f = r => window.App?.WeeklyProj?.formStats?.(r.pid, 'season');
        const v = r => { const s = f(r); return s ? (key === 'hi' ? s.high : s.low) : -1; };
        return (v(b) - v(a)) * dir;
      }
      if (key === 'prev') return ((b.prevPPG||0) - (a.prevPPG||0)) * dir;
      if (key === 'trend') return ((b.trend||0) - (a.trend||0)) * dir;
      if (key === 'gp') return ((b.curGP||0) - (a.curGP||0)) * dir;
      if (key === 'durability') return ((b.durabilityGP||0) - (a.durabilityGP||0)) * dir;
      if (key === 'name') { const na = getPlayerName(a.pid).toLowerCase(), nb = getPlayerName(b.pid).toLowerCase(); return (na < nb ? -1 : na > nb ? 1 : 0) * dir; }
      if (key === 'pos') { const d = ((posOrder[a.pos] ?? 99) - (posOrder[b.pos] ?? 99)); return d !== 0 ? d * dir : (b.dhq - a.dhq); }
      if (key === 'peak') return ((b.peakYrsLeft||0) - (a.peakYrsLeft||0)) * dir;
      if (key === 'action') {
        // rec holds mixed-case labels ('Sell High', 'Build Around', 'Hold Core'…) — sort by family, not exact key.
        const fam = r => /sell/i.test(r.rec || '') ? 0 : /stash/i.test(r.rec || '') ? 1 : /buy|build|core/i.test(r.rec || '') ? 3 : 2;
        return (fam(b) - fam(a)) * dir;
      }
      if (key === 'yrsExp') return ((b.p.years_exp||0) - (a.p.years_exp||0)) * dir;
      if (key === 'college') { const ca = (a.p.college||'').toLowerCase(), cb = (b.p.college||'').toLowerCase(); return (ca < cb ? -1 : ca > cb ? 1 : 0) * dir; }
      if (key === 'nflDraft') return (((a.p.draft_round || (a.p.draft_pick ? Math.ceil(a.p.draft_pick/32) : 99)) - (b.p.draft_round || (b.p.draft_pick ? Math.ceil(b.p.draft_pick/32) : 99))) * dir);
      if (key === 'posRankLg') return (a.dhq - b.dhq) * dir; // proxy: higher dhq = better rank
      if (key === 'posRankNfl') return ((a.meta?.fcRank||999) - (b.meta?.fcRank||999)) * dir;
      if (key === 'starterSzn') return ((b.meta?.starterSeasons||0) - (a.meta?.starterSeasons||0)) * dir;
      if (key === 'height') return ((b.p.height||0) - (a.p.height||0)) * dir;
      if (key === 'weight') return ((b.p.weight||0) - (a.p.weight||0)) * dir;
      if (key === 'depthChart') return ((a.p.depth_chart_order||99) - (b.p.depth_chart_order||99)) * dir;
      if (key === 'slot') { const ord = {starter:0,taxi:1,bench:2,ir:3}; return ((ord[a.section]||9) - (ord[b.section]||9)) * dir; }
      if (key === 'acquired') { const aa = getAcquisitionInfo(a.pid, myRoster?.roster_id), ab = getAcquisitionInfo(b.pid, myRoster?.roster_id); return (aa.method < ab.method ? -1 : aa.method > ab.method ? 1 : 0) * dir; }
      if (key === 'acquiredDate') { const aa = getAcquisitionInfo(a.pid, myRoster?.roster_id), ab = getAcquisitionInfo(b.pid, myRoster?.roster_id); return (aa.date < ab.date ? -1 : aa.date > ab.date ? 1 : 0) * dir; }
      if (key === 'sos') {
        const getSosRank = (r) => { const s = window.App?.SOS?.getPlayerSOS?.(r.pid, r.pos, r.p?.team); return s?.avgRank || 16; };
        return (getSosRank(b) - getSosRank(a)) * dir; // higher rank = easier = sort first by default
      }
      // Draft-capital columns — prospect record first, then the static NFL
      // draft dataset (vets); players with neither sort last.
      if (key === 'rkSlot' || key === 'rkTeam' || key === 'rkRank' || key === 'rkTier' || key === 'rkProfile') {
        const pa = prospectForRow(a), pb = prospectForRow(b);
        if (key === 'rkTeam') {
          const team = (p, row) => p?.nflTeam || draftCapFor(row.pid)?.team || '';
          const ta = team(pa, a), tb = team(pb, b);
          if (!ta !== !tb) return ta ? -dir : dir;
          return (ta < tb ? -1 : ta > tb ? 1 : 0) * dir;
        }
        if (key === 'rkSlot') {
          // Unified ordinal ≈ overall selection: prospects approximate it from
          // round+pick-in-round; vets carry the true overall. UDFA = 9000.
          const slot = (p, row) => {
            if (p && Number(p.draftRound) > 0) return (Number(p.draftRound) - 1) * 32 + (Number(p.draftPick) || 32);
            const d = draftCapFor(row.pid);
            if (d) return d.round > 0 ? (d.overall || (d.round - 1) * 32 + 32) : 9000;
            return p ? 9000 : 1e9;
          };
          return (slot(pa, a) - slot(pb, b)) * dir;
        }
        if (key === 'rkProfile') {
          const spd = p => { const s = parseFloat(p?.speed); return Number.isFinite(s) && s > 0 ? s : 1e9; };
          return (spd(pa) - spd(pb)) * dir; // faster 40 first on ascending
        }
        // rkRank / rkTier — lower consensus rank is better; non-rookies last.
        const rank = p => (p && (p.consensusRank ?? p.rank) != null) ? Number(p.consensusRank ?? p.rank) : 1e9;
        return (rank(pa) - rank(pb)) * dir;
      }
      return 0;
    });
  }

  if (!myRoster) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--silver)' }}>No roster found</div>;

  // Dynasty (E2): the START/SIT verdict is suppressed at every tier — the Wk
  // column keeps raw pts + matchup grade, and the Redraft preset disappears.
  const wkVerdict = skinFeatures.showWeeklyVerdict !== false;
  const ROSTER_COLUMNS = {
    pos:        { label: 'Position', shortLabel: 'Pos', width: '38px', group: 'core' },
    age:        { label: 'Age', shortLabel: 'Age', width: '38px', group: 'dynasty' },
    dhq:        { label: valueLabel, shortLabel: valueShortLabel, width: '60px', group: 'dynasty' },
    ppg:        { label: 'Points Per Game', shortLabel: 'PPG', width: '48px', group: 'stats' },
    proj:       { label: isPro && wkVerdict ? 'This Week — projected pts + start/sit (league-scored)' : 'This Week — projected pts (league-scored)', shortLabel: 'Wk', width: '62px', group: 'stats' },
    hi:         { label: 'Season High — most fantasy pts in a week', shortLabel: 'Hi', width: '40px', group: 'stats' },
    lo:         { label: 'Season Low — fewest fantasy pts in a played week', shortLabel: 'Lo', width: '40px', group: 'stats' },
    prev:       { label: 'Previous Season PPG', shortLabel: 'Last', width: '44px', group: 'stats' },
    trend:      { label: 'Year-over-Year PPG Change (%) — how this season\u2019s PPG compares to last season\u2019s', shortLabel: 'Trend', width: '52px', group: 'dynasty' },
    peak:       { label: 'Peak Window Phase', shortLabel: 'Peak', width: '50px', group: 'dynasty' },
    action:     { label: 'Trade Recommendation', shortLabel: 'Move', width: '54px', group: 'dynasty' },
    gp:         { label: 'Games Played', shortLabel: 'GP', width: '36px', group: 'stats' },
    durability: { label: 'Durability — games played out of 17 (green=15+, amber=10-14, red=<10)', shortLabel: 'Dur', width: '40px', group: 'stats' },
    yrsExp:     { label: 'Years of Experience', shortLabel: 'Exp', width: '38px', group: 'dynasty' },
    college:    { label: 'College', shortLabel: 'School', width: '82px', group: 'scout' },
    // nflDraft removed — Sleeper doesn't reliably provide draft capital data
    posRankLg:  { label: 'League Position Rank', shortLabel: 'Lg #', width: '46px', group: 'dynasty' },
    posRankNfl: { label: 'NFL Position Rank', shortLabel: 'NFL #', width: '48px', group: 'dynasty' },
    starterSzn: { label: 'Starter Seasons', shortLabel: 'Starts', width: '48px', group: 'dynasty' },
    height:     { label: 'Height', shortLabel: 'Ht', width: '42px', group: 'scout' },
    weight:     { label: 'Weight (lbs)', shortLabel: 'Wt', width: '42px', group: 'scout' },
    depthChart: { label: 'Depth Chart Position', shortLabel: 'Depth', width: '48px', group: 'scout' },
    slot:       { label: 'Roster Slot', shortLabel: 'Slot', width: '48px', group: 'core' },
    acquired:   { label: 'Acquisition Method', shortLabel: 'Added', width: '74px', group: 'core' },
    acquiredDate: { label: 'Date Acquired', shortLabel: 'When', width: '60px', group: 'core' },
    sos:        { label: 'Sched Strength (1=hardest, 32=easiest)', shortLabel: 'SOS', width: '44px', group: 'stats' },
    // Draft-capital + profile columns. Rookies use the rookie-data record
    // (prospectForRow); vets fall back to the static NFL draft dataset
    // (draftCapFor — Sleeper's own API carries no draft capital).
    // Owner ask 2026-07-12: dropped the rookie-only Consensus Rank (rkRank)
    // and Tier (rkTier) columns — they read '—' for every veteran, so they
    // were dead weight in a roster board. The rich rookie tier/rank still
    // surface in the prospect scouting card, just not as roster columns.
    rkSlot:     { label: 'NFL Draft Capital — round + overall pick (UDFA = undrafted)', shortLabel: 'Draft', width: '54px', group: 'scout' },
    rkTeam:     { label: 'NFL Team That Drafted Him', shortLabel: 'Drafted', width: '50px', group: 'scout' },
    rkProfile:  { label: 'Profile — Ht · Wt (· 40 time for rookies)', shortLabel: 'Profile', width: '112px', group: 'scout' },
  };
  // Free: the Move/Trade-Recommendation column is a verdict → Pro. Dropping
  // the def removes it everywhere at once — the Customize picker, the 'full'
  // preset (derives from keys), the header + cell render, and persisted
  // column prefs (both filter on ROSTER_COLUMNS[key]) — so a saved custom
  // view can't resurrect it.
  if (!isPro) delete ROSTER_COLUMNS.action;

  // Dynasty (E2): 'proj' leaves the default preset — still user-addable
  // (raw pts; renderCell strips the verdict so saved views can't resurrect it).
  const COLUMN_PRESETS = {
    default: ['pos','age','dhq','posRankLg','ppg',...(wkVerdict ? ['proj'] : []),'durability','peak','action','sos'].filter(k => ROSTER_COLUMNS[k]),
    ...(wkVerdict ? { redraft: ['pos','proj','ppg','prev','trend','hi','lo','sos'].filter(k => ROSTER_COLUMNS[k]) } : {}),
    // Same ROSTER_COLUMNS guard `default` carries — a renamed or retired column
    // should drop out of a preset, not render an empty column in it.
    stats:   ['pos','dhq','ppg','prev','trend','gp','durability','sos'].filter(k => ROSTER_COLUMNS[k]),
    scout:   ['pos','age','college','slot','height','weight','depthChart','yrsExp','starterSzn','posRankNfl'].filter(k => ROSTER_COLUMNS[k]),
    rookie:  ['pos','age','college','rkSlot','rkTeam','rkProfile'].filter(k => ROSTER_COLUMNS[k]),
    full:    Object.keys(ROSTER_COLUMNS),
  };
  const COLUMN_PRESET_META = {
    default: { label: 'Default', tone: 'decision board' },
    redraft: { label: 'Redraft', tone: 'weekly + form' },
    stats: { label: 'Stats', tone: 'production' },
    scout: { label: 'Scout', tone: 'profile' },
    rookie: { label: 'Rookie', tone: 'prospect profile' },
    full: { label: 'Deep Data', tone: 'all fields' },
  };
  const rosterFilterOptions = [
    'All',
    'Starters',
    'Bench',
    ...(skinFeatures.showTaxi === false ? [] : ['Taxi']),
    'IR',
    'Offense',
    ...(skinFeatures.showIDP === false ? [] : ['IDP']),
    'Rookies',
  ];
  const rosterFilterKey = rosterFilterOptions.join('|');
  React.useEffect(() => {
    if (rosterFilter && !rosterFilterOptions.includes(rosterFilter)) setRosterFilter('All');
  }, [rosterFilter, rosterFilterKey]);

  const allPlayers = myRoster.players || [];
  const starters = new Set(myRoster.starters || []);
  const reserve = new Set(myRoster.reserve || []);
  const taxi = new Set(myRoster.taxi || []);

  const normPos = window.App.normPos;

  // Build enriched player rows
  const rows = allPlayers.map(pid => {
    const p = playersData[pid];
    if (!p) return null;
    const pos = normPos(p.position) || p.position || '?';
    // league-skin.js already labels this column "Keeper-Adjusted Value" for
    // keeper leagues (buildVocabulary) — route the actual number through the
    // keeper blend so the label matches what's shown, not pure dynasty DHQ.
    const dhq = resolvedLeagueSkin?.type === 'keeper' && window.App?.PlayerValue?.getKeeperValue
        ? window.App.PlayerValue.getKeeperValue(pid, { skin: resolvedLeagueSkin })
        : window.App?.PlayerValue?.getValue ? window.App.PlayerValue.getValue(pid, { skin: resolvedLeagueSkin }) : (window.App?.LI?.playerScores?.[pid] || 0);
    const meta = window.App?.LI?.playerMeta?.[pid];
    const st = statsData[pid] || {};
    const prev = stats2025Data?.[pid] || {};

    const curPts = calcRawPts(st) || 0;
    const curGP = st.gp || 0;
    const curPPG = curGP > 0 ? +(curPts / curGP).toFixed(1) : 0;

    const prevPts = calcRawPts(prev) || 0;
    const prevGP = prev.gp || 0;
    const prevPPG = prevGP > 0 ? +(prevPts / prevGP).toFixed(1) : 0;

    // Effective PPG: use current season if available, else fallback to previous season
    const effectivePPG = curPPG > 0 ? curPPG : prevPPG;
    const effectiveGP = curGP > 0 ? curGP : prevGP;
    // 2-year rolling average GP for durability (use meta.recentGP if available for longer history)
    const durabilityGP = meta?.recentGP > 0 ? meta.recentGP : (curGP > 0 && prevGP > 0 ? Math.round((curGP + prevGP) / 2) : effectiveGP);

    const trend = meta?.trend || (prevPPG && curPPG ? Math.round((curPPG - prevPPG) / prevPPG * 100) : 0);

    const age = p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null);
    const isStarter = starters.has(pid);
    const isIR = reserve.has(pid);
    const isTaxi = taxi.has(pid);
    const section = isStarter ? 'starter' : isIR ? 'ir' : isTaxi ? 'taxi' : 'bench';

    const curve = typeof window.App?.getAgeCurve === 'function'
      ? window.App.getAgeCurve(pos)
      : { build: [22, 24], peak: (window.App.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
    const [pLo, pHi] = curve.peak;
    const declineHi = curve.decline[1];
    const peakRangeHi = Math.max(declineHi + 2, age ? age + 1 : declineHi + 2);
    const peakPct = age ? Math.max(0, Math.min(100, ((age - (pLo-4)) / (peakRangeHi - (pLo-4))) * 100)) : 50;
    const peakPhase = !age ? '\u2014' : age < pLo ? 'PRE' : age <= pHi ? 'PRIME' : age <= declineHi ? 'VET' : 'POST';
    const peakYrsLeft = age ? Math.max(0, pHi - age) : 0;
    const valueYrsLeft = age ? Math.max(0, declineHi - age) : 0;

    const _pidElite = typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(pid) : dhq >= 7000;
    // Recommendation for MY roster — shared getPlayerAction() with simplified
    // fallback. Free: rec stays null (the seeded fallback is a rec too), so
    // every consumer — Move column, row tints, Action lens, dossier call,
    // dynasty-read clause — degrades to raw-only even if a gate is missed.
    const pa = isPro && typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
    let rec = !isPro ? null : pa ? pa.label : (valueYrsLeft <= 0 ? 'Sell' : _pidElite && peakYrsLeft >= 3 ? 'Hold Core' : peakYrsLeft >= 4 && dhq < 4000 ? 'Stash' : 'Hold');
    // Action family code (SELL_HIGH vs SELL etc.) — the dossier's market-posture
    // sub-line keys off this so a "past value window" Sell never reads "sell high".
    let recAction = !isPro ? null : pa ? pa.action : (valueYrsLeft <= 0 ? 'SELL' : _pidElite && peakYrsLeft >= 3 ? 'CORE' : peakYrsLeft >= 4 && dhq < 4000 ? 'STASH' : 'HOLD');

    // GM Strategy nudge — a VISUAL flag over the engine verdict. getPlayerAction
    // is now strategy-aware and returns GM-steered sells with a 'GM plan:'
    // reason; detect those so the flag survives. The local gmTripsSell steer
    // remains only for the simplified fallback rec (engine not loaded).
    // Pro-only (Q8): it marks/steers the app's verdict, unlike passive accents.
    const gmIsUntouchable = gmUntouchable.has(String(pid));
    const gmEngineNudge = !!(pa && /^GM plan/i.test(pa.reason || '') && /SELL/i.test(pa.action || ''));
    const gmSellNudge = isPro && !gmIsUntouchable && (gmEngineNudge || (!/sell|buy|build|core/i.test(rec) && gmTripsSell({ pos, age })));
    if (gmSellNudge && !/sell/i.test(rec)) { rec = 'Sell'; recAction = 'SELL'; }
    const gmIsTarget = gmTargetPositions.has(String(pos));
    const gmIsSellPos = gmSellPositions.has(String(pos));

    return { pid, p, pos, dhq, age, curPPG, prevPPG, effectivePPG, effectiveGP, prevGP, durabilityGP, trend, isStarter, isIR, isTaxi, section, peakPhase, peakPct, peakYrsLeft, valueYrsLeft, rec, recAction, curGP, meta, injury: p.injury_status, gmIsUntouchable, gmSellNudge, gmIsTarget, gmIsSellPos };
  }).filter(Boolean);

  // Position-level PPG percentiles for color coding
  const posPPGs = {};
  rows.forEach(r => {
    if (!posPPGs[r.pos]) posPPGs[r.pos] = [];
    if (r.curPPG > 0) posPPGs[r.pos].push(r.curPPG);
  });
  const posP75 = {}, posP25 = {};
  Object.entries(posPPGs).forEach(([pos, vals]) => {
    vals.sort((a,b) => a-b);
    posP75[pos] = vals[Math.floor(vals.length * 0.75)] || 10;
    posP25[pos] = vals[Math.floor(vals.length * 0.25)] || 5;
  });

  // Cell background helpers (FM-style colored cells)
  const dhqBg = () => 'transparent';
  // Position-relative DHQ tiers — same rule as the Analytics All Players
  // table (league-map.js): top 5% of the LEAGUE-WIDE pool at that position
  // green, next tier (top 20%) blue, top 50% silver, rest faded. The flat
  // 7000/4000/2000 cutoffs (kept below as a fallback when the league-wide
  // pool isn't built yet) are tuned to offense's absolute ceiling and
  // structurally never light up green/blue for lower-ceiling positions like
  // IDP or K — a position's own best players never got colored no matter
  // how dominant they are at that position.
  const posDhqRank = React.useMemo(() => {
    const scores = window.App?.LI?.playerScores || {};
    const meta = window.App?.LI?.playerMeta || {};
    const byPos = {};
    Object.keys(scores).forEach(pid => {
      const v = scores[pid];
      if (!(v > 0)) return;
      const pos = meta[pid]?.pos;
      if (!pos) return;
      (byPos[pos] = byPos[pos] || []).push([pid, v]);
    });
    const rank = {};
    Object.entries(byPos).forEach(([pos, arr]) => {
      arr.sort((a, b) => b[1] - a[1]);
      const map = new Map();
      arr.forEach(([pid], i) => map.set(String(pid), (i + 1) / arr.length));
      rank[pos] = map;
    });
    return rank;
  }, [timeRecomputeTs]);
  const dhqCol = (v, pid, pos) => {
    const pct = pid != null && pos ? posDhqRank[pos]?.get(String(pid)) : null;
    if (pct != null) {
      if (pct <= 0.05) return 'var(--good)';
      if (pct <= 0.20) return 'var(--k-3498db, #3498db)';
      if (pct <= 0.50) return 'var(--silver)';
      return 'var(--ov-8, rgba(255,255,255,0.3))';
    }
    return v >= 7000 ? 'var(--good)' : v >= 4000 ? 'var(--k-3498db, #3498db)' : v >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))';
  };
  const ageBg = () => 'transparent';
  const ageCol = () => 'var(--silver)';
  const ppgBg = () => 'transparent';
  const trendBg = () => 'transparent';
  const posColors = window.App.POS_COLORS;

  // Roster Cutdown Day (window.App.RosterCutdown) — a league rule set from
  // GM's Office: on a given date the active+taxi roster shrinks to a smaller
  // cap. Only surfaced once the date is near (isNear: within NEAR_DAYS or
  // past) so it doesn't nag all season for a rule that isn't imminent yet.
  const cutdownLeagueId = currentLeague?.league_id || currentLeague?.id || '';
  const [cutdownTick, setCutdownTick] = React.useState(0);
  React.useEffect(() => {
    const h = () => setCutdownTick(t => t + 1);
    window.addEventListener('wr:cutdown-rule-changed', h);
    return () => window.removeEventListener('wr:cutdown-rule-changed', h);
  }, []);
  const cutdownInfo = React.useMemo(() => {
    const rule = cutdownLeagueId ? window.App?.RosterCutdown?.getRule?.(cutdownLeagueId) : null;
    const RC = window.App?.RosterCutdown;
    if (!rule || !RC) return null;
    const rosterStatus = RC.status(rule, Date.now());
    if (!rosterStatus || !rosterStatus.isNear) return null;
    const rosterCount = rows.filter(r => !r.isIR).length;
    // Active and taxi are separate caps (NFL-style "42 active / 10 taxi") —
    // check each pool against its OWN limit. The shared module's overage()
    // treats them as one combined pool, which can mask a taxi-only overage
    // when the bench has room to spare (bench comfortably under cap, taxi
    // stuffed) — bucket them here so the roster board flags taxi cuts too.
    const activeCount = rows.filter(r => !r.isIR && !r.isTaxi).length;
    const taxiCount = rows.filter(r => r.isTaxi && !r.isIR).length;
    const activeOver = Math.max(0, activeCount - (rule.activeSlots || 0));
    const taxiOver = Math.max(0, taxiCount - (rule.taxiSlots || 0));
    const over = activeOver + taxiOver;
    return { rule, status: rosterStatus, rosterCount, over, activeOver, taxiOver };
  }, [cutdownLeagueId, rows, cutdownTick]);

  // Sleeper's taxi_years league setting caps who's taxi-eligible by years_exp;
  // most leagues never touch it, so fall back to rookies + 2nd-year (<=1) —
  // the common default dynasty leagues actually run.
  const taxiEligibleCap = React.useMemo(() => {
    const configured = Number(currentLeague?.settings?.taxi_years);
    return Number.isFinite(configured) ? configured : 1;
  }, [currentLeague]);

  // Real taxi-squad capacity from the league's own roster shape — distinct
  // from the GM's Office Cutdown Day rule (a separate, opt-in pending-limit
  // concept below). This is what lets the standing (no-cutdown-pending) taxi
  // suggestion know whether taxi room genuinely exists today.
  const taxiSlotsCap = React.useMemo(() => {
    const configured = Number(currentLeague?.settings?.taxi_slots);
    if (Number.isFinite(configured) && configured > 0) return configured;
    return (currentLeague?.roster_positions || []).filter(p => p === 'TAXI').length;
  }, [currentLeague]);

  // Drop/taxi candidate PIDs: non-starters ranked by strategy-adjusted DHQ
  // (_adjustedDhq — see GM Strategy scoring above), so a rebuild pushes aging
  // vets to the top of the cut list even over a slightly-higher-DHQ prospect,
  // and Win Now does the reverse. Untouchable players never enter the pool.
  // Once a Cutdown rule is set, bench and taxi are ranked separately against
  // cutdownInfo's per-pool overage; otherwise this is a standing "3 weakest
  // bench spots" advisory that runs every time. Either way, a taxi-eligible
  // active-side candidate is routed to taxiCandidatePids instead of a cut
  // whenever real taxi room exists — he's still on your roster, just off the
  // active cap.
  const { dropCandidatePids, taxiCandidatePids } = React.useMemo(() => {
    const benchPlayers = rows
      .filter(r => !r.isStarter && !r.isIR && !r.isTaxi && !r.gmIsUntouchable)
      .sort((a, b) => _adjustedDhq(a) - _adjustedDhq(b));
    const taxiPlayers = rows.filter(r => r.isTaxi && !r.isIR).sort((a, b) => a.dhq - b.dhq);
    const routeToTaxiOrCut = (candidates, roomStart) => {
      let taxiRoomLeft = roomStart;
      const cutPicks = [], taxiPicks = [];
      candidates.forEach(r => {
        const eligible = (r.p?.years_exp ?? 99) <= taxiEligibleCap;
        if (eligible && taxiRoomLeft > 0) { taxiPicks.push(r.pid); taxiRoomLeft--; }
        else cutPicks.push(r.pid);
      });
      return { cutPicks, taxiPicks };
    };
    if (cutdownInfo) {
      const activeCandidates = benchPlayers.slice(0, cutdownInfo.activeOver > 0 ? cutdownInfo.activeOver : 3);
      const roomStart = cutdownInfo.activeOver > 0 ? Math.max(0, (cutdownInfo.rule.taxiSlots || 0) - taxiPlayers.length) : 0;
      const { cutPicks, taxiPicks } = routeToTaxiOrCut(activeCandidates, roomStart);
      return {
        dropCandidatePids: new Set([...cutPicks, ...taxiPlayers.slice(0, cutdownInfo.taxiOver).map(r => r.pid)]),
        taxiCandidatePids: new Set(taxiPicks),
      };
    }
    const { cutPicks, taxiPicks } = routeToTaxiOrCut(benchPlayers.slice(0, 3), Math.max(0, taxiSlotsCap - taxiPlayers.length));
    return { dropCandidatePids: new Set(cutPicks), taxiCandidatePids: new Set(taxiPicks) };
  }, [rows, cutdownInfo, taxiEligibleCap, taxiSlotsCap, _adjustedDhq]);

  // Keeper recommendations — rows.dhq is already the keeper-blended value for
  // keeper leagues (see the dhq computation above), so ranking by it here
  // guarantees the recommendation list and the DHQ column never disagree.
  const maxKeepers = Number(currentLeague?.settings?.max_keepers || currentLeague?.settings?.keeper_count || currentLeague?.metadata?.keeper_count || 0) || 3;
  const keeperRanked = React.useMemo(() => {
    if (resolvedLeagueSkin?.type !== 'keeper') return [];
    return rows.slice().sort((a, b) => (b.dhq || 0) - (a.dhq || 0));
  }, [rows, resolvedLeagueSkin?.type]);
  const keeperTopPids = React.useMemo(
    () => new Set(keeperRanked.slice(0, maxKeepers).map(r => r.pid)),
    [keeperRanked, maxKeepers]
  );
  // Keeper take — one-shot, ask once, no back-and-forth (same idiom as the
  // waiver-take/team-diagnosis/trade-idea cards). A single cached AI reaction
  // to the WHOLE recommended set, not one call per player.
  const [keeperTake, setKeeperTake] = React.useState(null); // null | {loading} | {text} | {error}
  const keeperTakeKey = 'keeper-take:' + (currentLeague?.league_id || currentLeague?.id || '') + ':' + keeperRanked.slice(0, maxKeepers).map(r => r.pid).join(',');
  async function getKeeperTake() {
    if (typeof window.AlexVoice?.enhance !== 'function' || !isPro) return;
    setKeeperTake({ loading: true });
    try {
      const context = JSON.stringify({
        keeperSlots: maxKeepers,
        topKeeps: keeperRanked.slice(0, maxKeepers).map(r => ({ name: getPlayerName(r.pid), pos: r.pos, keeperValue: r.dhq })),
        bubble: keeperRanked.slice(maxKeepers, maxKeepers + 2).map(r => ({ name: getPlayerName(r.pid), pos: r.pos, keeperValue: r.dhq })),
      });
      const text = await window.AlexVoice.enhance({
        type: 'pick-analysis',
        message: 'In 1-2 sentences, react to this team’s keeper picks — call out if one is a clear reach, or if a bubble player should bump a top pick.',
        context,
        fallback: null,
        cacheKey: keeperTakeKey,
      });
      setKeeperTake(text ? { text } : null);
    } catch (e) {
      setKeeperTake({ error: e?.message || 'AI call failed' });
    }
  }
  function sendKeeperTakeFeedback(action) {
    setKeeperTake(prev => prev ? { ...prev, feedback: action } : prev);
    window.WR?.AIFeedback?.send?.({
      leagueId: currentLeague?.league_id || currentLeague?.id,
      surface: 'keeper_take',
      recId: keeperTakeKey,
      action,
    });
  }

  // Dismissed drop alerts (persisted in localStorage per league)
  const [dismissedDrops, setDismissedDrops] = React.useState(() => {
    try {
      const leagueId = currentLeague?.id || currentLeague?.league_id || '';
      const stored = localStorage.getItem('wr_dismissed_drops_' + leagueId);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  // Dismissed "move to taxi" suggestions — same persistence shape as drops.
  const [dismissedTaxiSuggestions, setDismissedTaxiSuggestions] = React.useState(() => {
    try {
      const leagueId = currentLeague?.id || currentLeague?.league_id || '';
      const stored = localStorage.getItem('wr_dismissed_taxi_' + leagueId);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Rolling PPG window — persisted per-user. 'season' = full season-to-date,
  // 'l5' / 'l3' = last N games computed from window.App.computeRollingPPG
  // (populated once wr:weekly-points-loaded fires).
  const [ppgWindow, setPpgWindow] = React.useState(() => {
    try { return localStorage.getItem('wr_ppg_window') || 'season'; } catch { return 'season'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_ppg_window', ppgWindow); } catch {}
  }, [ppgWindow]);
  const [rowDensity, setRowDensity] = React.useState(() => {
    try { return localStorage.getItem('wr_roster_density') || 'comfortable'; } catch { return 'comfortable'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_roster_density', rowDensity); } catch {}
  }, [rowDensity]);
  const [rosterGroupMode, setRosterGroupMode] = React.useState(() => {
    try { return localStorage.getItem('wr_roster_group_mode') || 'position'; } catch { return 'position'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_roster_group_mode', rosterGroupMode); } catch {}
  }, [rosterGroupMode]);
  // Free: the Action grouping lens organizes the board by verdict → Pro.
  // Clamp a persisted pick back to position (the option is also filtered out
  // of GROUP_MODES below). Safe pre-clamp render: free rows carry rec=null,
  // so the lens has no verdicts to reveal.
  React.useEffect(() => {
    if (!isPro && rosterGroupMode === 'action') setRosterGroupMode('position');
  }, [isPro, rosterGroupMode]);
  // Force a re-render when weekly points become available so rolling-PPG cells update.
  const [, forcePpgRerender] = React.useState(0);
  React.useEffect(() => {
    const h = () => forcePpgRerender(n => n + 1);
    window.addEventListener('wr:weekly-points-loaded', h);
    return () => window.removeEventListener('wr:weekly-points-loaded', h);
  }, []);

  // The clamp+fade+"Full read" disclosure that used to live here was extracted
  // to the shared WR.ClampedRead (js/components/wr-primitives.js); it measures
  // its own overflow and remounts (collapsed) per expanded row.
  // Track the roster board's VISIBLE width so the expand card pins to the viewport
  // instead of stretching to the full (horizontally-scrolling) table width.
  const boardScrollRef = React.useRef(null);
  const [boardWidth, setBoardWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    const measure = () => setBoardWidth(el.clientWidth);
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const dismissDrop = React.useCallback((pid) => {
    const playerName = window.App?.playersData?.[pid]?.full_name || pid;
    setDismissedDrops(prev => {
      const next = new Set(prev);
      next.add(pid);
      try {
        const leagueId = currentLeague?.id || currentLeague?.league_id || '';
        localStorage.setItem('wr_dismissed_drops_' + leagueId, JSON.stringify([...next]));
      } catch {}
      return next;
    });
    window.wrLogAction?.('\uD83D\uDEAB', 'Dismissed drop alert for ' + playerName, 'roster', { players: [{ name: playerName, pid: pid }], actionType: 'dismiss-drop' });
  }, [currentLeague]);

  // Manual "mark to cut" \u2014 a one-tap toggle, distinct from the algorithmic
  // DROP? suggestion above. Writes the shared window._playerTags 'cut' tag
  // (same store player-card's Tag As menu and the Dashboard's Cut Candidates
  // widget already read), so a mark here shows up there too. Marking a
  // suggested drop candidate also dismisses its DROP? flag \u2014 the decision's
  // made, no need to keep asking.
  const toggleCutTag = React.useCallback((pid) => {
    const playerName = window.App?.playersData?.[pid]?.full_name || pid;
    const lid = currentLeague?.id || currentLeague?.league_id || '';
    const wasCut = window._playerTags?.[pid] === 'cut';
    try {
      const tags = { ...(window._playerTags || {}) };
      if (wasCut) delete tags[pid]; else tags[pid] = 'cut';
      window._playerTags = tags;
      if (window.OD?.savePlayerTags) window.OD.savePlayerTags(lid, tags);
    } catch (e) {}
    if (!wasCut && dropCandidatePids.has(pid) && !dismissedDrops.has(pid)) dismissDrop(pid);
    try { setTimeRecomputeTs(Date.now()); } catch (e) {}
    window.wrLogAction?.(wasCut ? '\u21A9\uFE0F' : '\u2702\uFE0F', (wasCut ? 'Unmarked cut for ' : 'Marked to cut: ') + playerName, 'roster', { players: [{ name: playerName, pid: pid }], actionType: wasCut ? 'unmark-cut' : 'mark-cut' });
  }, [currentLeague, dropCandidatePids, dismissedDrops, dismissDrop, setTimeRecomputeTs]);

  const dismissTaxiSuggestion = React.useCallback((pid) => {
    const playerName = window.App?.playersData?.[pid]?.full_name || pid;
    setDismissedTaxiSuggestions(prev => {
      const next = new Set(prev);
      next.add(pid);
      try {
        const leagueId = currentLeague?.id || currentLeague?.league_id || '';
        localStorage.setItem('wr_dismissed_taxi_' + leagueId, JSON.stringify([...next]));
      } catch {}
      return next;
    });
    window.wrLogAction?.('\uD83D\uDEAB', 'Dismissed taxi suggestion for ' + playerName, 'roster', { players: [{ name: playerName, pid: pid }], actionType: 'dismiss-taxi' });
  }, [currentLeague]);

  // Manual "mark to stash on taxi" \u2014 the alternative to toggleCutTag above:
  // same shared window._playerTags store, 'taxi' value instead of 'cut', so
  // marking one clears the other if it was set. Confirming a suggested taxi
  // move dismisses its TAXI? flag the same way toggleCutTag resolves DROP?.
  const toggleTaxiTag = React.useCallback((pid) => {
    const playerName = window.App?.playersData?.[pid]?.full_name || pid;
    const lid = currentLeague?.id || currentLeague?.league_id || '';
    const wasTaxiTag = window._playerTags?.[pid] === 'taxi';
    try {
      const tags = { ...(window._playerTags || {}) };
      if (wasTaxiTag) delete tags[pid]; else tags[pid] = 'taxi';
      window._playerTags = tags;
      if (window.OD?.savePlayerTags) window.OD.savePlayerTags(lid, tags);
    } catch (e) {}
    if (!wasTaxiTag && taxiCandidatePids.has(pid) && !dismissedTaxiSuggestions.has(pid)) dismissTaxiSuggestion(pid);
    try { setTimeRecomputeTs(Date.now()); } catch (e) {}
    window.wrLogAction?.(wasTaxiTag ? '\u21A9\uFE0F' : '\uD83C\uDFF7\uFE0F', (wasTaxiTag ? 'Unmarked taxi stash for ' : 'Marked to stash on taxi: ') + playerName, 'roster', { players: [{ name: playerName, pid: pid }], actionType: wasTaxiTag ? 'unmark-taxi' : 'mark-taxi' });
  }, [currentLeague, taxiCandidatePids, dismissedTaxiSuggestions, dismissTaxiSuggestion, setTimeRecomputeTs]);

  // How many candidates have been resolved (cut OR stashed) \u2014 progress
  // readout for the Review Roster banner.
  const cutMarkedCount = React.useMemo(() => {
    return rows.filter(r => window._playerTags?.[r.pid] === 'cut' || window._playerTags?.[r.pid] === 'taxi').length;
  }, [rows, timeRecomputeTs]);

  // Which sort keys run high-to-low at dir=1. The row comparator is a mix:
  // most numeric columns are written `(b.x - a.x) * dir` (so dir=1 is
  // DESCENDING — best first), while rank/age/alphabetical ones are
  // `(a.x - b.x) * dir` (dir=1 is ASCENDING). The header glyph was derived
  // from `dir` alone, so every column in this set showed "^" while actually
  // sorting high-to-low — DHQ read "^" with your best player on top.
  // Keep in sync with the comparator in the rows memo above.
  const DESC_FIRST_SORTS = new Set([
    'dhq', 'ppg', 'proj', 'hi', 'lo', 'prev', 'trend', 'gp', 'durability',
    'peak', 'action', 'yrsExp', 'starterSzn', 'height', 'weight', 'sos',
  ]);
  const sortGlyph = React.useCallback((key) => {
    if (rosterSort.key !== key) return '';
    const descending = DESC_FIRST_SORTS.has(key) ? rosterSort.dir === 1 : rosterSort.dir === -1;
    return descending ? ' v' : ' ^';
  }, [rosterSort]);

  // Sorting by a column has to drop grouping. The row comparator resolves the
  // group rank BEFORE it ever looks at the sort key, so with the default
  // 'position' grouping a "sort by DHQ" only ordered players *within* each
  // position block — never a straight best-to-worst board. Owner ask
  // 2026-09-06 ("I want to sort by DHQ"). Grouping and an explicit column sort
  // are mutually exclusive now, last action wins: tapping a header flattens
  // (and the Group By control visibly moves to None, so it isn't hidden
  // state), and picking a grouping again re-groups.
  const sortByColumn = React.useCallback((colKey) => {
    setRosterGroupMode('none');
    setRosterSort(prev => (prev.key === colKey ? { ...prev, dir: prev.dir * -1 } : { key: colKey, dir: 1 }));
  }, [setRosterSort, setRosterGroupMode]);

  const GROUP_MODES = [
    { key: 'position', label: 'Position' },
    { key: 'slot', label: 'Slot' },
    { key: 'action', label: 'Action' },
    { key: 'age', label: 'Age' },
    { key: 'peak', label: 'Peak' },
    { key: 'none', label: 'None' },
  ].filter(g => isPro || g.key !== 'action'); // Action lens = verdict grouping → Pro
  const activeGroupModeLabel = GROUP_MODES.find(g => g.key === rosterGroupMode)?.label || 'Position';
  const slotOrder = { starter: 0, bench: 1, taxi: 2, ir: 3 };
  const recGroup = (rec) => /sell/i.test(rec || '') ? 'Sell'
    : /buy|build|core/i.test(rec || '') ? 'Build'
    : /stash/i.test(rec || '') ? 'Stash'
    : 'Hold';
  const getAgeBand = (r) => !r.age ? 'Unknown' : r.age <= 24 ? 'Youth' : r.age <= 29 ? 'Prime' : r.age <= 32 ? 'Veteran' : 'Post';
  const getRowGroupKey = (r) => {
    if (rosterGroupMode === 'none') return 'all';
    if (rosterGroupMode === 'slot') return r.section;
    if (rosterGroupMode === 'action') return recGroup(r.rec).toLowerCase();
    if (rosterGroupMode === 'age') return getAgeBand(r).toLowerCase();
    if (rosterGroupMode === 'peak') return (r.peakPhase || 'unknown').toLowerCase();
    return r.pos || '?';
  };
  const getRowGroupLabel = (r) => {
    if (rosterGroupMode === 'slot') return r.section === 'starter' ? 'Starters' : r.section === 'ir' ? 'IR' : r.section === 'taxi' ? 'Taxi' : 'Bench';
    if (rosterGroupMode === 'action') return recGroup(r.rec);
    if (rosterGroupMode === 'age') return getAgeBand(r);
    if (rosterGroupMode === 'peak') return r.peakPhase || 'Unknown';
    return r.pos || '?';
  };
  const getRowGroupRank = (r) => {
    const posRank = {QB:0,RB:1,WR:2,TE:3,K:4,DL:5,LB:6,DB:7};
    const actionRank = { build: 0, hold: 1, stash: 2, sell: 3 };
    const ageRank = { youth: 0, prime: 1, veteran: 2, post: 3, unknown: 4 };
    const peakRank = { pre: 0, prime: 1, vet: 2, post: 3, unknown: 4 };
    if (rosterGroupMode === 'slot') return slotOrder[r.section] ?? 9;
    if (rosterGroupMode === 'action') return actionRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'age') return ageRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'peak') return peakRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'none') return 0;
    return posRank[r.pos] ?? 99;
  };
  // Group dividers use the single gold accent for structure — no per-group rainbow.
  const getRowGroupColor = () => 'var(--gold)';

  const filtered = filteredAndSortedRows(rows);
  const filteredPosCounts = filtered.reduce((acc, r) => {
    const key = getRowGroupKey(r);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const rosterTagMeta = {
    trade: { bg: 'rgba(240,165,0,0.13)', col: 'var(--warn)', lbl: 'Trade' },
    cut: { bg: 'rgba(231,76,60,0.13)', col: 'var(--bad)', lbl: 'Cut' },
    untouchable: { bg: 'rgba(46,204,113,0.13)', col: 'var(--good)', lbl: 'Core' },
    watch: { bg: 'rgba(52,152,219,0.13)', col: 'var(--k-3498db, #3498db)', lbl: 'Watch' },
    taxi: { bg: 'rgba(52,152,219,0.13)', col: 'var(--k-3498db, #3498db)', lbl: 'Stash' },
  };
  const slotTagMeta = {
    starter: { bg: 'var(--ov-3, rgba(255,255,255,0.045))', col: 'var(--white)', lbl: 'STR' },
    bench: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'BN' },
    taxi: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'TAX' },
    ir: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'IR' },
  };
  const inlineTag = (cfg, key) => cfg ? (
    <span key={key} style={{
      fontSize: 'var(--text-micro, 0.6875rem)',
      padding: '2px 5px',
      borderRadius: 'var(--card-radius-xs, 5px)',
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.col,
      border: '1px solid ' + wrAlpha(cfg.col, '33'),
      flexShrink: 0,
      lineHeight: 1,
      letterSpacing: '0.035em',
      textTransform: 'uppercase',
    }}>{cfg.lbl}</span>
  ) : null;

  const controlBtn = (active) => ({
    padding: '6px 11px',
    fontSize: '0.72rem',
    fontWeight: active ? 800 : 650,
    fontFamily: 'var(--font-body)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: active ? 'var(--gold)' : 'var(--ov-3, rgba(255,255,255,0.045))',
    color: active ? 'var(--black)' : 'var(--silver)',
    border: '1px solid ' + (active ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.09))'),
    borderRadius: 'var(--card-radius-sm, 8px)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  // Compact dropdown used across the roster toolbar (mirrors free-agency's rkSelectStyle).
  const rosterSelectStyle = (active) => ({
    padding: '4px 6px',
    minHeight: '44px',
    fontSize: '0.72rem',
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: active ? 'var(--acc-fill2, rgba(212,175,55,0.13))' : 'var(--ov-3, rgba(255,255,255,0.045))',
    color: active ? 'var(--gold)' : 'var(--silver)',
    border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'),
    borderRadius: 'var(--card-radius-sm, 8px)',
    cursor: 'pointer',
    outline: 'none',
    minWidth: 0,
  });
  const groupLabelStyle = { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, whiteSpace: 'nowrap' };
  const sameColumnSet = (a, b) => a.length === b.length && a.every((key, idx) => key === b[idx]);
  const activePresetKey = Object.entries(COLUMN_PRESETS).find(([, cols]) => sameColumnSet(cols, visibleCols))?.[0] || 'custom';
  const activePresetMeta = COLUMN_PRESET_META[activePresetKey] || { label: 'Custom', tone: visibleCols.length + ' fields' };
  const isDeepData = activePresetKey === 'full';
  // Shared viewport seam (js/shared/viewport.js) — one debounced app-wide
  // listener; thresholds below (560/820/834/1023) are unchanged.
  const _vp = window.WR.useViewport();
  const rosterViewportWidth = _vp.width;
  const _isPhone = !!_vp.isPhone;
  const isNarrowRoster = rosterViewportWidth <= 560;
  const isTabletRoster = rosterViewportWidth > 560 && rosterViewportWidth <= 1023;
  // iPad/phone: collapse the Scope/View/PPG/Rows/Group control stack behind a
  // single "Filters" bar so it stops eating ~400px above the roster table.
  const isCompactRoster = rosterViewportWidth <= 1023;
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  // A desktop column preset must never force a spreadsheet onto a phone.
  const [phoneTableOpen, setPhoneTableOpen] = React.useState(false);
  const [phoneSearch, setPhoneSearch] = React.useState('');
  const [phoneDeskOpen, setPhoneDeskOpen] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false); // phone "review flagged players" sheet
  const [reviewStripOpen, setReviewStripOpen] = React.useState(false); // desktop/iPad flagged-players triage strip (owner-approved iPad pass)
  // Manual verdict/tag override (owner ask): one picker sets the player's
  // call, rolling the old TRADE BLOCK/CUT/UNTOUCHABLE/WATCH tags in with
  // Hold/Stash/Sell/Drop. Runs on ALL versions. The 4 tag-values sync to the
  // shared window._playerTags store so existing consumers (untouchable
  // protection, trade finder, the desktop row tag badge) keep working; the
  // verdict-values live in verdictOverrides. Per-league localStorage.
  const VERDICT_OPTIONS = ['Untouchable', 'Hold', 'Watch', 'Stash', 'Trade Block', 'Sell', 'Drop'];
  const _LABEL_TO_TAG = { 'Trade Block': 'trade', 'Cut': 'cut', 'Untouchable': 'untouchable', 'Watch': 'watch' };
  const _TAG_TO_LABEL = { trade: 'Trade Block', cut: 'Cut', untouchable: 'Untouchable', watch: 'Watch' };
  const [verdictOverrides, setVerdictOverrides] = React.useState(() => {
    try { const lid = currentLeague?.id || currentLeague?.league_id || ''; return JSON.parse(localStorage.getItem('dhq_roster_verdict_v1:' + lid) || '{}') || {}; } catch (e) { return {}; }
  });
  const [tagEditPid, setTagEditPid] = React.useState(null); // which player's verdict picker is open
  const setPlayerVerdict = (pid, v) => {
    // Sync the shared player-tag store for the 4 tag-values (else clear it).
    try {
      const lid = currentLeague?.id || currentLeague?.league_id || '';
      const tags = window._playerTags || {};
      const tag = v ? _LABEL_TO_TAG[v] : null;
      if (tag) tags[pid] = tag; else delete tags[pid];
      window._playerTags = { ...tags };
      if (window.OD?.savePlayerTags) window.OD.savePlayerTags(lid, tags);
    } catch (e) {}
    setVerdictOverrides(prev => {
      const next = { ...prev };
      if (v) next[pid] = v; else delete next[pid];
      try { const lid = currentLeague?.id || currentLeague?.league_id || ''; localStorage.setItem('dhq_roster_verdict_v1:' + lid, JSON.stringify(next)); } catch (e) {}
      return next;
    });
    try { setTimeRecomputeTs(Date.now()); } catch (e) {}
  };
  // Effective call: manual override → existing player-tag → engine r.rec.
  const _effRec = (r) => verdictOverrides[r.pid] || _TAG_TO_LABEL[window._playerTags && window._playerTags[r.pid]] || r.rec;
  // The user's own call for a player (manual verdict or synced tag), IGNORING
  // the engine's r.rec — null when they haven't weighed in.
  const _manualCall = (r) => verdictOverrides[r.pid] || _TAG_TO_LABEL[window._playerTags && window._playerTags[r.pid]] || null;
  // Owner ask 2026-07-12: the Review-roster drop list is a to-do of the app's
  // drop flags. Once the user tags a flagged player as anything that ISN'T
  // Drop/Cut (Hold/Stash/Untouchable/Watch…), they've decided to keep him —
  // the flag is resolved, so he leaves the list. No manual call = flag stands.
  // (SELL CALLS already self-resolves because its filter reads _effRec.)
  const _isActiveDrop = (r) => {
    if (!isPro || !dropCandidatePids.has(r.pid) || dismissedDrops.has(r.pid)) return false;
    const manual = _manualCall(r);
    return !(manual && !/drop|cut/i.test(manual));
  };
  // Same idea for taxi suggestions: marking the player 'taxi' auto-dismisses
  // (toggleTaxiTag), so the only other resolution to check for here is the
  // user overriding the suggestion by marking the player 'cut' instead.
  const _isActiveTaxiSuggestion = (r) => {
    if (!isPro || !taxiCandidatePids.has(r.pid) || dismissedTaxiSuggestions.has(r.pid)) return false;
    return window._playerTags?.[r.pid] !== 'cut';
  };
  // GM's Desk is a MULTI-YEAR roster-construction memo: its calls are framed by
  // the GM Strategy window (rebuild / compete / win-now) and it advises stashing
  // youth on taxi. None of that exists in a league that resets every season, so
  // a redraft owner got "Youth, picks, and patience. Tear it down to build the
  // next dynasty." over an empty bench (owner ask 2026-09-05). Gated on the same
  // showFuturePicks seam the app already uses for its other long-horizon
  // surfaces (future capital, age curves) — dynasty and keeper keep the desk,
  // redraft / best-ball / chopped / DFS drop it. Fail-open: an unknown skin
  // keeps it rather than silently losing the panel.
  const showGmDesk = skinFeatures.showFuturePicks !== false;
  // GM's Desk — the top 3 unresolved cut/taxi calls, strategy-ranked (most
  // urgent first), for the memo-style panel below. Same active/unresolved
  // definition as the chips and Review Roster strip so a mark or dismiss
  // anywhere resolves it everywhere.
  const gmDeskCalls = !isPro ? [] : [
    ...rows.filter(_isActiveDrop).map(r => ({ r, verdict: 'CUT' })),
    ...rows.filter(_isActiveTaxiSuggestion).map(r => ({ r, verdict: 'STASH' })),
  ].sort((a, b) => _adjustedDhq(a.r) - _adjustedDhq(b.r)).slice(0, 3);
  // Call → accent color, shared by chip + badge + picker + desktop action col.
  const _recColor = (rec) => {
    const s = String(rec || '');
    if (/untouchable/i.test(s)) return 'var(--good)';
    if (/watch/i.test(s)) return 'var(--k-3498db, #3498db)';
    if (/trade.?block/i.test(s)) return 'var(--warn)';
    if (/drop|cut/i.test(s)) return 'var(--bad)';
    if (/sell/i.test(s)) return 'var(--warn)';
    if (/buy|build|core/i.test(s)) return 'var(--good)';
    if (/stash/i.test(s)) return 'var(--k-3498db, #3498db)';
    return 'var(--gold)';
  };
  // Filtering visibleCols on ROSTER_COLUMNS here is what keeps a persisted
  // 'action' pref from rendering for free (its def is deleted above).
  // (The old ≤560 3-col survival set is deleted: ≤560 is always inside the
  // phone tier (<768) — the AssetRow card list supersedes it, and Deep
  // Data keeps the full column set inside its scoped scroll container.)
  const rosterTableCols = visibleCols.filter(key => ROSTER_COLUMNS[key]);
  const visibleColGroupStarts = new Set();
  rosterTableCols.forEach((key, idx) => {
    const prev = rosterTableCols[idx - 1];
    if (idx > 0 && ROSTER_COLUMNS[key]?.group !== ROSTER_COLUMNS[prev]?.group) visibleColGroupStarts.add(key);
  });
  const isCompactRows = rowDensity === 'compact' || isNarrowRoster;
  const rowHeight = isCompactRows ? 38 : 46;
  const avatarSize = isNarrowRoster ? 22 : (isCompactRows ? 26 : 30);
  const playerNameSize = isNarrowRoster ? '0.74rem' : (isCompactRows ? '0.78rem' : '0.84rem');
  const columnGroups = ['core', 'dynasty', 'stats', 'scout'].map(group => ({
    group,
    columns: Object.entries(ROSTER_COLUMNS).filter(([, col]) => col.group === group),
  })).filter(g => g.columns.length > 0);
  const playerColWidth = isNarrowRoster ? 156 : isTabletRoster ? 220 : 292;
  const visibleDataWidth = rosterTableCols.reduce((sum, key) => sum + parseInt(ROSTER_COLUMNS[key]?.width || '0', 10), 0);
  const tableMinWidth = playerColWidth + visibleDataWidth;
  const setCustomColumns = (updater) => {
    setVisibleCols(prev => typeof updater === 'function' ? updater(prev) : updater);
    setColPreset('custom');
  };
  const moveVisibleColumn = (key, delta) => {
    setCustomColumns(prev => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const nextIdx = Math.max(0, Math.min(prev.length - 1, idx + delta));
      if (nextIdx === idx) return prev;
      const next = prev.slice();
      const [item] = next.splice(idx, 1);
      next.splice(nextIdx, 0, item);
      return next;
    });
  };
  const removeVisibleColumn = (key) => setCustomColumns(prev => prev.filter(c => c !== key));
  const addVisibleColumn = (key) => setCustomColumns(prev => prev.includes(key) ? prev : [...prev, key]);
  const activeColumnOrder = visibleCols.filter(key => ROSTER_COLUMNS[key]);
  const inactiveColumnCount = Object.keys(ROSTER_COLUMNS).filter(key => !visibleCols.includes(key)).length;
  const formatHeight = h => h ? Math.floor(h / 12) + "'" + h % 12 + '"' : null;
  const _slotLabel = r => r.section === 'starter' ? 'Starter' : r.section === 'ir' ? 'IR' : r.section === 'taxi' ? 'Taxi' : 'Bench';
  const getLeaguePositionRank = r => {
    const allAtPos = (currentLeague.rosters || []).flatMap(ros => (ros.players || []).filter(pid => {
      const pp = playersData[pid];
      return pp && (normPos(pp.position) === r.pos);
    })).map(pid => ({ pid, dhq: window.App?.LI?.playerScores?.[pid] || 0 })).sort((a, b) => b.dhq - a.dhq);
    const rank = allAtPos.findIndex(x => x.pid === r.pid) + 1;
    return rank > 0 ? rank : null;
  };

  // renderCell — renders each data cell with FM-style coloring
  function renderCell(colKey, r) {
    const col = ROSTER_COLUMNS[colKey];
    const isGroupStart = visibleColGroupStarts.has(colKey);
    const base = { width: col.width, minWidth: col.width, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isCompactRows ? '0.73rem' : '0.78rem', padding: '0 5px', borderLeft: isGroupStart ? '1px solid var(--acc-fill2, rgba(212,175,55,0.12))' : '1px solid var(--ov-1, rgba(255,255,255,0.024))', color: 'rgba(235,235,240,0.78)', lineHeight: 1.1 };

    switch(colKey) {
      case 'proj': {
        const p = projFor(r.pid);
        if (!p) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: 0.45 }}>{'—'}</span></div>;
        if (!p.available) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--warn)', opacity: 0.85, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em' }}>{p.injuryStatus || 'OUT'}</span></div>;
        const obj = weeklyLineup?.objective || 'median';
        const pts = p.points[obj] || 0;
        const isStart = !!(weeklyLineup && weeklyLineup.starterSet.has(String(r.pid)));
        const g = p.matchupGrade;
        const gcol = g === 'A' ? 'var(--good)' : g === 'B' ? 'var(--gold)' : g === 'D' ? 'var(--warn)' : g === 'F' ? 'var(--bad)' : 'var(--silver)';
        // Free: raw projected pts keep rendering; START/SIT (optimizer output)
        // + matchup grade (interpretive read) are the Pro line. Dynasty (E2):
        // only the START/SIT verdict is suppressed — Pro keeps the matchup
        // grade, and saved views keep the raw pts.
        return <div key={colKey} style={{...base, flexDirection: 'column', gap: '0px'}} title={'Projected ' + pts.toFixed(1) + ' pts' + (isPro ? ' · matchup ' + g : '') + (p.opponent && p.opponent.abbr ? ' vs ' + p.opponent.abbr : '')}>
          <span style={{ color: 'var(--white)', fontWeight: 600, fontSize: '0.76rem', fontFamily: 'var(--font-body)' }}>{pts > 0 ? pts.toFixed(1) : '—'}</span>
          {isPro && <span style={{ fontSize: '0.54rem', fontWeight: 700, letterSpacing: '0.03em', color: wkVerdict ? (isStart ? 'var(--good)' : 'var(--silver)') : gcol }}>{wkVerdict ? (isStart ? 'START' : 'SIT') : ''}<span style={{ color: gcol, marginLeft: wkVerdict ? '3px' : '0px' }}>{g}</span></span>}
        </div>;
      }
      case 'hi': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return <div key={colKey} style={{...base}}><span style={{ color: fs ? 'var(--good, #2ecc71)' : 'var(--silver)', opacity: fs ? 1 : 0.45, fontWeight: 550 }}>{fs ? fs.high.toFixed(1) : '—'}</span></div>; }
      case 'lo': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: fs ? 0.85 : 0.45 }}>{fs ? fs.low.toFixed(1) : '—'}</span></div>; }
      case 'pos': return <div key={colKey} style={{...base}}><span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 550, color: 'var(--silver)' }}>{window.App?.posLabel?.(r.pos) || (r.pos === 'DEF' ? 'D/ST' : r.pos)}</span></div>;
      case 'age': return <div key={colKey} style={{...base, background: ageBg(r.age, r.pos)}}><span style={{ color: ageCol(r.age, r.pos), fontWeight: 550 }}>{r.age||'\u2014'}</span></div>;
      case 'dhq': {
        // Redraft \u2192 show projected rest-of-season POINTS (tier-colored by the
        // scaled value r.dhq). Dynasty/keeper \u2192 the scaled value as before.
        const rosPts = (resolvedLeagueSkin?.type === 'redraft' && window.App?.PlayerValue?.getRosPoints) ? window.App.PlayerValue.getRosPoints(r.pid) : null;
        const showRos = rosPts != null;
        const disp = showRos ? (rosPts > 0 ? Math.round(rosPts).toLocaleString() : '\u2014') : (r.dhq > 0 ? r.dhq.toLocaleString() : '\u2014');
        const title = showRos ? ('\u2248 ' + Math.round(rosPts) + ' projected pts rest-of-season') : '';
        return <div key={colKey} style={{...base, background: dhqBg(r.dhq)}} title={title}><span style={{ color: dhqCol(r.dhq, r.pid, r.pos), fontWeight: 600, fontFamily: 'var(--font-body)', fontSize: '0.78rem' }}>{disp}</span></div>;
      }
      case 'ppg': {
        // Rolling PPG override — swap in last-N-games PPG when user toggled the window.
        // If a window is active but weekly data isn't ready for this player, fall back
        // to seasonal and mark the cell "· Szn" so the user knows it's not rolling.
        let shown = r.effectivePPG;
        let marker = r.curPPG === 0 && r.prevPPG > 0 ? '*' : '';
        if (ppgWindow !== 'season') {
          const n = ppgWindow === 'l3' ? 3 : 5;
          const rolling = typeof window.App?.computeRollingPPG === 'function'
            ? window.App.computeRollingPPG(r.pid, n)
            : 0;
          if (rolling > 0) { shown = rolling; marker = ' · L' + n; }
          else { marker = ' · Szn'; }
        }
        return <div key={colKey} style={{...base, background: ppgBg(shown, r.pos)}}><span style={{ color: 'var(--silver)', fontWeight: 500 }}>{shown > 0 ? shown : '\u2014'}{marker}</span></div>;
      }
      case 'prev': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: 0.6 }}>{r.prevPPG > 0 ? r.prevPPG : '\u2014'}</span></div>;
      case 'trend': {
        const trendBars = (() => {
          const t = r.trend || 0;
          const up = t > 0;
          const color = 'var(--silver)';
          const heights = up ? [4, 6, 8, 11, 14] : t < 0 ? [14, 11, 8, 6, 4] : [8, 9, 10, 9, 8];
          return React.createElement('div', { className: 'wr-spark' }, ...heights.map((h, i) => React.createElement('div', { key: i, className: 'wr-spark-bar', style: { height: h + 'px', background: color } })));
        })();
        return <div key={colKey} style={{...base, background: trendBg(r.trend), flexDirection: 'column', gap: '1px'}}>
          <span style={{ color: 'var(--silver)', fontWeight: 550, fontSize: '0.7rem' }}>{r.trend>0?'+'+r.trend+'%':r.trend<0?r.trend+'%':'\u2014'}</span>
          {trendBars}
        </div>;
      }
		      case 'peak': return <div key={colKey} style={{...base, flexDirection: 'column', gap: '1px'}}>
		        <span style={{ fontSize: '0.7rem', fontWeight: 550, color: 'var(--silver)' }}>{r.peakPhase}</span>
        <div style={{ width: '30px', height: '3px', borderRadius: '1px', background: 'var(--ov-4, rgba(255,255,255,0.06))', overflow: 'hidden', position: 'relative' }}>
          <div style={{ position:'absolute',left:r.peakPct+'%',top:'-1px',width:'2px',height:'5px',background:'var(--silver)',borderRadius:'1px' }}></div>
        </div>
      </div>;
      case 'action': {
        const ann = getPlayerAnnotation(r.pid);
        const gmNudgeTitle = r.gmSellNudge ? 'Nudged to Sell by GM Strategy (position/age trips a sell rule)' : '';
        const _ar = _effRec(r);
        const _amanual = !!(verdictOverrides[r.pid] || (window._playerTags && window._playerTags[r.pid]));
        return <div key={colKey} style={{...base, flexDirection:'column', gap:'2px', alignItems:'center'}} title={_amanual ? 'Your call — set in the player card' : (gmNudgeTitle || ann?.text || '')}>
          <span style={{ fontSize:'var(--text-micro, 0.6875rem)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.03em',color: _recColor(_ar) }}>{_ar}</span>
          {_amanual ? <span style={{ fontSize: '0.56rem', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.05em', opacity: 0.85, lineHeight: 1 }}>YOU</span> : (r.gmSellNudge && <span style={{ fontSize: '0.56rem', fontWeight: 800, color: 'var(--warn)', letterSpacing: '0.05em', opacity: 0.85, lineHeight: 1 }}>GM</span>)}
        </div>;
      }
      case 'gp': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.74rem' }}>{r.effectiveGP > 0 ? r.effectiveGP : '\u2014'}{r.curGP === 0 && r.prevGP > 0 ? '*' : ''}</span></div>;
      case 'durability': { const gpForDur = r.durabilityGP || 0; return <div key={colKey} style={{...base}} title={'Avg GP: ' + gpForDur + '/17'}><div style={{ width:'24px',height:'4px',borderRadius:'2px',background:'var(--ov-4, rgba(255,255,255,0.06))',overflow:'hidden' }}><div style={{ width:Math.min(100,(gpForDur/17)*100)+'%',height:'100%',background:'var(--silver)',opacity:0.7,borderRadius:'2px' }}></div></div></div>; }
      case 'yrsExp': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{r.p.years_exp ?? '\u2014'}</span></div>;
      case 'college': return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.p.college || '\u2014'}</span></div>;
      case 'nflDraft': { const dr = r.p.draft_round; const dp = r.p.draft_pick; const dy = r.p.draft_year; const dRound = dr || (dp ? Math.ceil(dp / 32) : null); const draftLabel = dRound ? (dy ? "'" + String(dy).slice(2) + ' ' : '') + 'Rd ' + dRound + (dp ? '.' + ((dp - 1) % 32 + 1) : '') : (r.p.undrafted === true || (r.p.years_exp > 0 && !dp && !dr) ? 'UDFA' : '\u2014'); return <div key={colKey} style={{...base}}><span style={{ color: dRound ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))', fontSize: '0.74rem' }}>{draftLabel}</span></div>; }
      case 'posRankLg': {
        const rank = getLeaguePositionRank(r);
        return <div key={colKey} style={{...base}}><span style={{ color: rank && rank<=3?'var(--white)':'var(--silver)', fontWeight: 450 }}>{rank ? '#'+rank : '\u2014'}</span></div>;
      }
      case 'posRankNfl': {
        const meta = r.meta;
        return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{meta?.fcRank ? '#'+meta.fcRank : '\u2014'}</span></div>;
      }
      case 'starterSzn': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontWeight: 500 }}>{r.meta?.starterSeasons ?? '\u2014'}</span></div>;
      case 'height': {
        const h = r.p.height;
        return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem' }}>{h ? Math.floor(h/12)+"'"+h%12+'"' : '\u2014'}</span></div>;
      }
      case 'weight': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem' }}>{r.p.weight || '\u2014'}</span></div>;
      case 'depthChart': return <div key={colKey} style={{...base}}><span style={{ color: r.p.depth_chart_order != null ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))', fontSize: '0.72rem' }}>{r.p.depth_chart_order != null ? r.pos + (r.p.depth_chart_order + 1) : (r.section === 'ir' ? 'IR' : (!r.p.team || r.p.team === 'FA') ? 'FA' : 'N/A')}</span></div>;
      case 'slot': return <div key={colKey} style={{...base}}><span style={{ fontSize:'0.76rem',color:'var(--silver)',opacity:0.65,textTransform:'uppercase' }}>{r.section==='starter'?'STR':r.section==='ir'?'IR':r.section==='taxi'?'TAX':'BN'}</span></div>;
      case 'acquired': {
        const acq = getAcquisitionInfo(r.pid, myRoster?.roster_id);
        const col = 'var(--silver)';
        return <div key={colKey} style={{...base, minWidth: 0, overflow: 'hidden'}}><span
          style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, color: col, padding: '1px 5px', borderRadius: '3px', border: `1px solid ${col}40`, background: `${col}10`, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}
          title={acq.method + (acq.cost ? ' · ' + acq.cost : '')}
        >{acq.method}{acq.cost ? ' · ' + acq.cost : ''}</span></div>;
      }
      case 'acquiredDate': {
        const acq = getAcquisitionInfo(r.pid, myRoster?.roster_id);
        const show = acq.date && acq.date !== '\u2014' ? acq.date : '';
        return <div key={colKey} style={{...base, minWidth: 0, overflow: 'hidden'}} title={show || undefined}><span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.8, display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{show || '\u2014'}</span></div>;
      }
      case 'sos': {
        const sosMod = window.App?.SOS;
        if (!sosMod?.ready) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))', fontSize: '0.72rem' }}>{'\u2014'}</span></div>;
        const team = r.p?.team;
        if (!team || team === 'FA') return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))' }}>{'\u2014'}</span></div>;
        const sos = sosMod.getPlayerSOS(r.pid, r.pos, team);
        if (!sos) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))' }}>{'\u2014'}</span></div>;
        // Color already carries the tier (Easy/Favorable/Neutral/Tough/Hard);
        // the label was redundant text on every row \u2014 full context stays in the title.
        return <div key={colKey} style={{...base, minWidth: 0, overflow: 'hidden'}} title={sos.label + ' schedule (' + sos.avgRank + '/32)'}>
          <span style={{ color: sos.color || 'var(--silver)', fontWeight: 600, fontSize: '0.8rem', fontFamily: 'var(--font-body)' }}>{sos.avgRank}</span>
        </div>;
      }
      case 'rkSlot': case 'rkTeam': case 'rkRank': case 'rkTier': case 'rkProfile': {
        const rf = window.App?.RookieFields?.fields?.(prospectForRow(r)) || null;
        const dp = draftCapFor(r.pid);
        const dim = <span style={{ color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>{'\u2014'}</span>;
        if (colKey === 'rkSlot') {
          // Prospect slot ("1.05") wins; vets show round + overall ("R2 #47")
          // with the class year underneath, or UDFA.
          const slotTxt = rf?.draftSlot || (dp ? (dp.round > 0 ? 'R' + dp.round + ' #' + dp.overall : 'UDFA') : null);
          if (!slotTxt) return <div key={colKey} style={{...base}}>{dim}</div>;
          const yr = dp?.year ? '\u2019' + String(dp.year).slice(2) : '';
          const tip = dp ? (dp.round > 0 ? dp.year + ' draft \u2014 round ' + dp.round + ', pick ' + dp.overall + ' overall' + (dp.team ? ' (' + dp.team + ')' : '') : 'Undrafted free agent' + (dp.year ? ' \u2014 entered ' + dp.year : '')) : slotTxt;
          return <div key={colKey} title={tip} style={{...base, flexDirection: 'column', gap: '1px'}}>
            <span style={{ color: 'var(--silver)', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{slotTxt}</span>
            {yr ? <span style={{ color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.6 }}>{yr}</span> : null}
          </div>;
        }
        if (colKey === 'rkTeam') {
          const tm = rf?.nflTeam || dp?.team || '';
          return <div key={colKey} style={{...base}}>{tm ? <span style={{ color: 'var(--silver)' }}>{tm}</span> : dim}</div>;
        }
        if (colKey === 'rkProfile') {
          // Rookies carry the full Ht \u00b7 Wt \u00b7 40 scouting line; vets compose
          // Ht \u00b7 Wt from the Sleeper record.
          const prof = rf?.profile || [formatHeight(r.p.height), r.p.weight ? r.p.weight + ' lb' : null].filter(Boolean).join(' \u00b7 ');
          return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}>{prof ? <span title={prof} style={{ color: 'var(--silver)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prof}</span> : dim}</div>;
        }
        if (!rf) return <div key={colKey} style={{...base}}>{dim}</div>;
        if (colKey === 'rkRank') return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>{rf.consensusRank != null ? rf.consensusRank : '\u2014'}</span></div>;
        return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}><span style={{ color: 'var(--silver)', fontWeight: 600, fontSize: '0.72rem' }}>{rf.tierLabel || '\u2014'}</span></div>;
      }
      default: return <div key={colKey} style={{...base}}>{'\u2014'}</div>;
    }
  }

  // ── Expand-card dossier body (identity → signals → dynasty read → age
  // curve → career stats → actions) — HOISTED VERBATIM from the desktop
  // board's inline expand card so the phone AssetRow expansion renders the
  // identical dossier. The desktop boardWidth pinning wrapper stays inside
  // _renderRosterBoard below; the phone card path never mounts it.
  const renderExpandBody = (r) => (<React.Fragment>
                  {/* ── Dossier (02 "clear hierarchy"): identity + roster call → signals strip → read + signals → curve → stats ── */}
                  {(() => {
                    const tier =(typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(r.pid) : r.dhq >= 7000) ? 'Elite' : r.dhq >= 4000 ? 'Starter' : r.dhq >= 2000 ? 'Depth' : 'Stash';
                    const field = (currentLeague.rosters || []).flatMap(ros => (ros.players || []).filter(pid2 => normPos(playersData[pid2]?.position) === r.pos)).map(pid2 => ({ pid: pid2, dhq: window.App?.LI?.playerScores?.[pid2] || 0 })).filter(x => x.dhq > 0).sort((a, b) => b.dhq - a.dhq);
                    const rank = field.findIndex(x => x.pid === r.pid) + 1;
                    const posLbl = window.App?.posLabel?.(r.pos) || (r.pos === 'DEF' ? 'D/ST' : r.pos);
                    const chip = (bg, col) => ({ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: bg, color: col, whiteSpace: 'nowrap' });
                    const primeEnd = r.peakYrsLeft > 0 && r.age ? r.age + r.peakYrsLeft : null;
                    const sigWindow = (r.peakPhase || '—') + (primeEnd ? ' · thru ' + primeEnd : r.valueYrsLeft > 0 ? ' · ~' + r.valueYrsLeft + 'yr value' : '');
                    const sigRisk = r.injury ? r.injury : (r.durabilityGP && r.durabilityGP < 13 ? '~' + r.durabilityGP + ' GP/yr' : 'no current flags');
                    const sigFloor = r.isStarter ? 'weekly starter' : (r.p.depth_chart_order != null && r.p.depth_chart_order <= 1 ? 'rotation role' : 'bench / depth');
                    const sigCeiling = r.trend >= 10 ? 'trending up' : (tier === 'Elite' || tier === 'Starter') ? 'proven ' + tier.toLowerCase() : r.peakPhase === 'PRE' ? 'developing' : 'limited upside';
                    const sigCell = (label, val) =>(<div style={{ fontSize: '0.74rem' }}><span style={{ color: 'var(--silver)', opacity: 0.65 }}>{label}{' '}</span><span style={{ color: 'var(--white)', fontWeight: 600 }}>{val}</span></div>);
                    return (<React.Fragment>
                      {/* Identity + roster call */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <div style={{ flexShrink: 0, position: 'relative' }}>
                          <img src={'https://sleepercdn.com/content/nfl/players/' + r.pid + '.jpg'} alt="" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} style={{ width: '58px', height: '58px', borderRadius: 'var(--card-radius-sm, 8px)', objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))' }} />
                          <div style={{ display: 'none', width: '58px', height: '58px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--charcoal)', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, color: 'var(--silver)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))' }}>{(r.p.first_name || '?')[0]}{(r.p.last_name || '?')[0]}</div>
                          <div style={{ position: 'absolute', bottom: '-4px', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--card-radius-sm, 8px)', background: (posColors[r.pos] || 'var(--k-666666, #666666)') + '22', color: posColors[r.pos] || 'var(--silver)', whiteSpace: 'nowrap' }}>{posLbl}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '150px' }}>
                          <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.35rem', color: 'var(--white)', letterSpacing: '0.01em', lineHeight: 1.04 }}>{r.p.full_name || getPlayerName(r.pid)}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--silver)', marginTop: '3px', lineHeight: 1.4 }}>
                            {posLbl} {'·'} {r.p.team || 'FA'} {'·'} Age {r.age || '?'} {'·'} {r.p.years_exp || 0}yr exp
                            {formatHeight(r.p.height) ? ' · ' + formatHeight(r.p.height) : ''}
                            {r.p.college ? ' · ' + r.p.college : ''}
                            {(() => {
                                // Prefer the rookie prospect record (RookieFields/CSV) over the
                                // static vendored WR_DRAFT_PROFILE dataset — same precedence the
                                // rkSlot column already uses. WR_DRAFT_PROFILE is a third-party
                                // snapshot that can lag a real pick (was showing round-2 rookies
                                // as "UDFA" here while the prospect CSV had the correct capital).
                                const rf = window.App?.RookieFields?.fields?.(prospectForRow(r)) || null;
                                const d = draftCapFor(r.pid);
                                const slot = rf?.draftSlot || (d ? (d.round > 0 ? 'R' + d.round + ' #' + d.overall + (d.year ? ' ’' + String(d.year).slice(2) : '') + (d.team ? ' ' + d.team : '') : 'UDFA' + (d.year ? ' ’' + String(d.year).slice(2) : '')) : null);
                                return slot ? ' · ' + slot : '';
                            })()}
                            {r.injury ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}> {'·'} {r.injury}</span> : null}
                          </div>
                        </div>
                        {/* Verdict badge — editable on ALL versions. Tap to open
                            the picker (Hold/Stash/Sell/Drop + Trade Block/Watch/
                            Untouchable/Cut, the old tag buttons rolled in). */}
                        {isPro ? (() => {
                          const ev = _effRec(r) || 'Hold';
                          const evc = _recColor(ev);
                          return (
                        <button onClick={e => { e.stopPropagation(); setTagEditPid(p => p === r.pid ? null : r.pid); }} title="Tap to set your own call" aria-expanded={tagEditPid === r.pid} style={{ flexShrink: 0, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'Rajdhani, sans-serif', fontSize: '1.25rem', fontWeight: 700, color: evc, textTransform: 'uppercase', letterSpacing: '0.03em', lineHeight: 1, padding: '7px 14px', borderRadius: '999px', border: '1px solid ' + wrAlpha(evc, '55'), background: wrAlpha(evc, '16'), whiteSpace: 'nowrap', cursor: 'pointer' }}>{ev}<span aria-hidden="true" style={{ fontSize: '0.75rem', opacity: 0.65 }}>{'▾'}</span></button>
                          );
                        })() : (
                        <button onClick={e => { e.stopPropagation(); if (window.showProLaunchPage) window.showProLaunchPage(); else if (window.showUpgradePrompt) window.showUpgradePrompt('analytics_depth'); }}
                          title="Buy/sell roster calls are a Pro read"
                          style={{ flexShrink: 0, alignSelf: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          <span style={{ display: 'inline-block', fontFamily: 'Rajdhani, sans-serif', fontSize: '1.15rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1, padding: '7px 15px', borderRadius: '999px', border: '1px solid ' + wrAlpha('var(--gold)', '55'), background: wrAlpha('var(--gold)', '16'), whiteSpace: 'nowrap' }}>{'🔒'} Pro</span>
                        </button>
                        )}
                      </div>

                      {/* Verdict/tag picker — all versions. Sets your own call
                          (Hold/Stash/Sell/Drop + the rolled-in Trade Block/Watch/
                          Untouchable/Cut); Auto reverts to the DHQ engine read. */}
                      {isPro && tagEditPid === r.pid && (() => {
                        const hasOverride = !!(verdictOverrides[r.pid] || (window._playerTags && window._playerTags[r.pid]));
                        const cur = String(_effRec(r) || 'Hold').toLowerCase();
                        return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: '2px' }}>Your call</span>
                        {VERDICT_OPTIONS.map(t => {
                          const active = cur === t.toLowerCase();
                          const c = _recColor(t);
                          return <button key={t} onClick={e => { e.stopPropagation(); setPlayerVerdict(r.pid, t); setTagEditPid(null); }} style={{ minHeight: '38px', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', color: active ? c : 'var(--silver)', background: active ? wrAlpha(c, '22') : 'transparent', border: '1px solid ' + (active ? wrAlpha(c, '99') : 'var(--ov-6, rgba(255,255,255,0.12))') }}>{t}</button>;
                        })}
                        {hasOverride && <button onClick={e => { e.stopPropagation(); setPlayerVerdict(r.pid, null); setTagEditPid(null); }} title="Revert to the DHQ engine call" style={{ minHeight: '38px', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', color: 'var(--text-muted)', background: 'transparent', border: '1px dashed var(--ov-6, rgba(255,255,255,0.14))' }}>{'↺'} Auto</button>}
                      </div>
                        );
                      })()}

                      {/* Signals chip strip */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                        <span style={chip(dhqBg(r.dhq), dhqCol(r.dhq, r.pid, r.pos))}>{tier} {'·'} {r.dhq.toLocaleString()} DHQ</span>
                        {rank > 0 ? <span style={chip('var(--ov-3, rgba(255,255,255,0.05))', 'var(--gold)')}>{r.pos}{rank}</span> : null}
                        <span style={chip(r.peakPhase === 'PRE' ? 'rgba(46,204,113,0.1)' : r.peakPhase === 'POST' ? 'rgba(231,76,60,0.1)' : 'var(--acc-fill2, rgba(212,175,55,0.08))', r.peakPhase === 'PRE' ? 'var(--good)' : r.peakPhase === 'POST' ? 'var(--bad)' : 'var(--gold)')}>{r.peakPhase}{r.peakYrsLeft > 0 ? ' · ~' + r.peakYrsLeft + 'yr' : ''}</span>
                        {r.effectivePPG ? <span style={chip('var(--ov-3, rgba(255,255,255,0.05))', 'var(--white)')}>{r.effectivePPG} PPG</span> : null}
                        {r.injury ? <span style={chip('rgba(231,76,60,0.13)', 'var(--bad)')}>{r.injury}</span> : null}
                      </div>

                      {/* Signals — 2x2 grid, compact now that this box runs full width */}
                      <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.065))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '9px 11px', marginBottom: '10px' }}>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '6px' }}>Signals</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '6px 16px' }}>
                          {sigCell('Ceiling', sigCeiling)}
                          {sigCell('Floor', sigFloor)}
                          {sigCell('Risk', sigRisk)}
                          {sigCell('Window', sigWindow)}
                        </div>
                      </div>
                    </React.Fragment>);
                  })()}

		                  {/* Age Curve visualization */}
	                  {(() => {
	                    const nP = r.pos === 'DE' || r.pos === 'DT' ? 'DL' : r.pos === 'CB' || r.pos === 'S' ? 'DB' : r.pos;
	                    const curve = typeof window.App?.getAgeCurve === 'function'
	                      ? window.App.getAgeCurve(nP)
	                      : { build: [22, 24], peak: (window.App.peakWindows || {})[nP] || [24, 29], decline: [30, 32] };
	                    const [pLo, pHi] = curve.peak;
	                    const declineHi = curve.decline[1];
	                    const ages = Array.from({length: 17}, (_, i) => i + 20);
                    return <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Age Curve</div>
	                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{'Currently age ' + (r.age || '?') + ' \u00B7 ' + r.peakPhase + ' \u00B7 ' + (r.peakYrsLeft > 0 ? '~' + r.peakYrsLeft + ' peak yr left' : r.valueYrsLeft > 0 ? '~' + r.valueYrsLeft + ' value yr left' : 'Past value window')}</div>
                      </div>
                      <div style={{ display: 'flex', height: '22px', borderRadius: 'var(--card-radius-xs, 5px)', overflow: 'hidden', gap: '1px' }}>
                        {ages.map(a => {
	                          const col = a < pLo - 3 ? 'rgba(96,165,250,0.3)' : a < pLo ? 'rgba(46,204,113,0.45)' : (a >= pLo && a <= pHi) ? 'rgba(46,204,113,0.75)' : a <= declineHi ? 'var(--acc-line3, rgba(212,175,55,0.45))' : 'rgba(231,76,60,0.35)';
                          const isMe = a === (r.age || 0);
                          return <div key={a} style={{ flex: 1, background: col, opacity: isMe ? 1 : 0.55, outline: isMe ? '2px solid var(--gold)' : 'none', outlineOffset: '-1px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: isMe ? 'var(--text-primary)' : 'transparent' }}>{isMe ? a : ''}</div>;
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', marginTop: '3px' }}>
	                        <span>20</span><span>{'Peak ' + pLo + '\u2013' + pHi + ' / Value thru ' + declineHi}</span><span>36</span>
                      </div>
                    </div>;
                  })()}

                  {/* Career Stats Table */}
                  <InlineCareerStats pid={r.pid} pos={r.pos} player={r.p} scoringSettings={currentLeague?.scoring_settings} statsData={statsData} />

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {/* Phase 2: News button removed per user feedback (2026-04-18) */}
                    {/* TRADE BLOCK/CUT/UNTOUCHABLE/WATCH buttons removed 2026-07-09 \u2014
                        rolled into the verdict picker (tap the call badge above). */}
                    <button onClick={e => {
                      e.stopPropagation();
                      try {
                        // Trade Center listens on window._wrTradeFinderTarget \u2014 same
                        // deep-link contract as the player-card modal's Trade Finder.
                        window._wrTradeFinderTarget = { pid: r.pid, mode: 'my', ts: Date.now() };
                        if (typeof window.wrNavigateTab === 'function') window.wrNavigateTab('trades');
                        else if (typeof setActiveTab === 'function') setActiveTab('trades');
                        window.dispatchEvent(new CustomEvent('wr:open-trade-finder', { detail: { pid: r.pid } }));
                      } catch (err) { console.warn('[MyTeam] Trade Finder deep-link unavailable', err); }
                    }} style={{ padding: '7px 16px', minHeight: '44px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', fontWeight: 600 }}>Trade Finder</button>
                    <button onClick={e => { e.stopPropagation(); setExpandedPid(null); }} style={{ padding: '7px 16px', minHeight: '44px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer' }}>COLLAPSE</button>
                  </div>
  </React.Fragment>);

  // ══ PHONE (<768) — Phase 0 pilot (iPhone program) ═══════════════════
  // Everything in this section renders ONLY when `_phone` is true; the
  // desktop/tablet render path below is byte-identical to the pre-phase
  // file (blocks are wrapped or hoisted, never edited). Kit presence
  // (wr-primitives.js loads earlier in the babel chain) is fixed for the
  // page's lifetime, so `_phone` can gate render without hook hazards.
  const _kitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList && window.WR.FilterPill && window.WR.FilterSheet);
  const _phone = _isPhone && _kitReady;

  // Preset → "which 3 stat slots ride the card row" (P1 AssetRow). Slot
  // values are produced by _phoneSlotFor, which calls the SAME sources the
  // desktop renderCell uses (projFor / App.computeRollingPPG /
  // App.PlayerValue.getRosPoints / App.WeeklyProj.formStats /
  // App.RookieFields.fields) — lookups reused, no formulas duplicated.
  const PHONE_SLOT_PRESETS = {
    default: ['dhq', 'proj', 'ppg'],
    redraft: ['proj', 'ppg', 'trend'],
    stats:   ['ppg', 'prev', 'trend'],
    scout:   ['yrsExp', 'starterSzn', 'posRankNfl'],
    rookie:  ['rkSlot', 'age', 'dhq'],
  };
  const PHONE_SLOT_KEYS = new Set(['dhq', 'proj', 'ppg', 'prev', 'trend', 'age', 'gp', 'hi', 'lo', 'yrsExp', 'starterSzn', 'posRankNfl', 'posRankLg', 'sos', 'peak', 'rkSlot']);
  // Custom column sets ride the first 3 slot-capable picks; empty → default.
  let _phoneSlotKeys = PHONE_SLOT_PRESETS[activePresetKey]
    || visibleCols.filter(k => PHONE_SLOT_KEYS.has(k)).slice(0, 3);
  if (!_phoneSlotKeys.length) _phoneSlotKeys = PHONE_SLOT_PRESETS.default;
  const _phoneSlotFor = (colKey, r) => {
    const short = ROSTER_COLUMNS[colKey]?.shortLabel || colKey;
    switch (colKey) {
      case 'dhq': {
        // Same redraft ROS-points swap as renderCell's dhq cell.
        const rosPts = (resolvedLeagueSkin?.type === 'redraft' && window.App?.PlayerValue?.getRosPoints) ? window.App.PlayerValue.getRosPoints(r.pid) : null;
        const disp = rosPts != null ? (rosPts > 0 ? Math.round(rosPts).toLocaleString() : '—') : (r.dhq > 0 ? r.dhq.toLocaleString() : '—');
        return { label: short, value: disp, strong: true };
      }
      case 'proj': {
        const p = projFor(r.pid);
        if (!p) return { label: 'Wk', value: '—', tone: 'mute' };
        if (!p.available) return { label: 'Wk', value: p.injuryStatus || 'OUT', tone: 'warn' };
        const pts = p.points[weeklyLineup?.objective || 'median'] || 0;
        return { label: 'Wk', value: pts > 0 ? pts.toFixed(1) : '—' };
      }
      case 'ppg': {
        // Same rolling-window override + seasonal fallback as renderCell;
        // the window rides the LABEL (L5/L3) since card slots have no room
        // for the " · L5" marker.
        let shown = r.effectivePPG;
        let lbl = 'PPG';
        if (ppgWindow !== 'season') {
          const n = ppgWindow === 'l3' ? 3 : 5;
          const rolling = typeof window.App?.computeRollingPPG === 'function' ? window.App.computeRollingPPG(r.pid, n) : 0;
          if (rolling > 0) { shown = rolling; lbl = 'L' + n; } else { lbl = 'SZN'; }
        }
        return { label: lbl, value: shown > 0 ? shown : '—' };
      }
      case 'prev': return { label: short, value: r.prevPPG > 0 ? r.prevPPG : '—', tone: 'mute' };
      case 'trend': return { label: short, value: r.trend > 0 ? '+' + r.trend + '%' : r.trend < 0 ? r.trend + '%' : '—', tone: 'mute' };
      case 'age': return { label: short, value: r.age || '—', tone: 'mute' };
      case 'gp': return { label: short, value: r.effectiveGP > 0 ? r.effectiveGP : '—', tone: 'mute' };
      case 'hi': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return { label: short, value: fs ? fs.high.toFixed(1) : '—', tone: fs ? 'good' : 'mute' }; }
      case 'lo': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return { label: short, value: fs ? fs.low.toFixed(1) : '—', tone: 'mute' }; }
      case 'yrsExp': return { label: short, value: r.p.years_exp ?? '—', tone: 'mute' };
      case 'starterSzn': return { label: short, value: r.meta?.starterSeasons ?? '—', tone: 'mute' };
      case 'posRankNfl': return { label: short, value: r.meta?.fcRank ? '#' + r.meta.fcRank : '—', tone: 'mute' };
      case 'posRankLg': { const rank = getLeaguePositionRank(r); return { label: short, value: rank ? '#' + rank : '—', tone: 'mute' }; }
      case 'sos': { const s = window.App?.SOS?.ready ? window.App.SOS.getPlayerSOS(r.pid, r.pos, r.p?.team) : null; return { label: short, value: s ? s.avgRank : '—', tone: 'mute' }; }
      case 'peak': return { label: short, value: r.peakPhase || '—', tone: 'mute' };
      case 'rkSlot': case 'rkRank': case 'rkTier': {
        const rf = window.App?.RookieFields?.fields?.(prospectForRow(r)) || null;
        if (colKey === 'rkSlot') {
          // Vet fallback mirrors the desktop cell: R<rd> #<overall> or UDFA.
          const dp = draftCapFor(r.pid);
          const slotTxt = rf?.draftSlot || (dp ? (dp.round > 0 ? 'R' + dp.round + ' #' + dp.overall : 'UDFA') : null);
          return { label: short, value: slotTxt || '—', tone: slotTxt ? undefined : 'mute' };
        }
        if (!rf) return { label: short, value: '—', tone: 'mute' };
        if (colKey === 'rkRank') return { label: short, value: rf.consensusRank != null ? rf.consensusRank : '—' };
        return { label: short, value: rf.tierLabel || '—' };
      }
      default: return { label: short, value: '—', tone: 'mute' };
    }
  };
  // Two-line tag under the name: team · age · injury-or-slot.
  const _phoneTagFor = (r) => {
    const bits = [r.p.team || 'FA'];
    if (r.age) bits.push(String(r.age));
    bits.unshift(r.pos);
    if (r.injury) bits.push(r.injury);
    if (isPro && resolvedLeagueSkin?.type === 'keeper' && keeperTopPids.has(r.pid)) bits.push('KEEP');
    return bits.join(' · ');
  };
  // Verdict chip (Move-column analog) — Pro-only, exactly mirroring the
  // desktop `delete ROSTER_COLUMNS.action` gate: free rows carry rec=null
  // and render no chip even if a gate upstream is ever missed. Tones per
  // the approved mockup: SELL amber / CORE-BUILD gold / rest calm blue.
  const _phoneVerdictChip = (r) => {
    const rec = _effRec(r);
    if (!isPro || !rec) return null;
    const isManual = !!verdictOverrides[r.pid];
    const col = _recColor(rec);
    return (
      <span title={isManual ? 'Your call (tap the badge in the player card to change)' : (r.gmSellNudge ? 'Nudged to Sell by GM Strategy (position/age trips a sell rule)' : '')} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, padding: '2px 6px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid ' + wrAlpha(col, '80'), color: col, letterSpacing: '0.02em', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>
        {rec}{isManual ? ' *' : (r.gmSellNudge ? ' ·GM' : '')}
      </span>
    );
  };

  // Hero + pill strip + filter sheet (P5/P3) — computed only on phone.
  let _phoneHeroEl = null, _phonePillsEl = null, _phoneSheetEl = null, _reviewSheetEl = null;
  if (_phone) {
    // Decision hero: drop-alert count + GM window, all from data the tab
    // already computes (dropCandidatePids / dismissedDrops are Pro
    // verdicts — free renders raw roster facts, zero gate drift).
    const dropAlerts = isPro ? rows.filter(_isActiveDrop) : [];
    const taxiAlerts = isPro ? rows.filter(_isActiveTaxiSuggestion) : [];
    const modeLabel = String((gm && gm.modeLabel) || 'Compete');
    // Override-aware (owner ask): a user-kept player drops out of the hero
    // count too, matching the review list below (both read _effRec).
    const sellCalls = isPro ? rows.filter(r => /sell/i.test(_effRec(r) || '')).length : 0;
    const totalRosterAlerts = dropAlerts.length + taxiAlerts.length;
    const heroGhost = totalRosterAlerts > 0 ? 'Review' : null;
    _phoneHeroEl = React.createElement(window.WR.HeroCard, {
      kicker: 'Roster call',
      headline: totalRosterAlerts ? `${totalRosterAlerts} roster ${totalRosterAlerts === 1 ? 'decision' : 'decisions'} to review` : `${allPlayers.length} players · Your roster`,
      facts: `${modeLabel} window${sellCalls ? ` · ${sellCalls} sell calls` : ''}`,
      ctaGhost: heroGhost,
      onCtaGhost: heroGhost ? () => setReviewOpen(true) : undefined,
    });

    const openSheet = () => setFiltersOpen(true);
    _phonePillsEl = (
      <div className="wr-hscroll" style={{ display: 'flex', gap: '6px', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
        {React.createElement(window.WR.FilterPill, { label: 'Filters', value: rosterFilter, onClick: openSheet })}
        {React.createElement(window.WR.FilterPill, {
          label: phoneTableOpen ? 'Player cards' : 'Full table',
          onClick: () => setPhoneTableOpen(value => !value),
        })}
      </div>
    );

    // FilterSheet re-homes the EXISTING toolbar controls behind one sheet;
    // every control drives the exact same state setters as the desktop
    // toolbar (which stays untouched for tablet/desktop).
    const sheetSelectStyle = (active) => ({ ...rosterSelectStyle(active), width: '100%' });
    _phoneSheetEl = React.createElement(window.WR.FilterSheet, {
      open: filtersOpen,
      onClose: () => setFiltersOpen(false),
      title: 'Roster filters',
      sections: [
        { label: 'Scope', node: (
          <select value={rosterFilter} onChange={e => setRosterFilter(e.target.value)} style={sheetSelectStyle(rosterFilter !== 'All')} title="Show a slot or position group">
            {rosterFilterOptions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        ) },
        { label: 'View', node: (
          <select value={activePresetKey} onChange={e => { const key = e.target.value; const cols = COLUMN_PRESETS[key]; if (!cols) return; setVisibleCols(cols); setColPreset(key); if (key === 'rookie') setRosterFilter('Rookies'); else if (rosterFilter === 'Rookies') setRosterFilter('All'); }} style={sheetSelectStyle(activePresetKey !== 'default')} title="Column preset">
            {Object.keys(COLUMN_PRESETS).map(key => <option key={key} value={key}>{COLUMN_PRESET_META[key]?.label || key}</option>)}
            {activePresetKey === 'custom' && <option value="custom">Custom</option>}
          </select>
        ) },
        { label: 'Columns', node: (
          <button onClick={() => { setShowColPicker(true); setFiltersOpen(false); }} style={{ ...controlBtn(showColPicker || activePresetKey === 'custom'), minHeight: '44px', width: '100%' }} title="Add, remove, or reorder columns">Customize · {visibleCols.length}/{Object.keys(ROSTER_COLUMNS).length} fields</button>
        ) },
        { label: 'PPG window', node: (
          <select value={ppgWindow} onChange={e => setPpgWindow(e.target.value)} style={sheetSelectStyle(ppgWindow !== 'season')} title="Points-per-game window">
            <option value="season">Season</option>
            <option value="l5">L5</option>
            <option value="l3">L3</option>
          </select>
        ) },
        { label: 'Rows', node: (
          <select value={rowDensity} onChange={e => setRowDensity(e.target.value)} style={sheetSelectStyle(rowDensity !== 'comfortable')} title="Row density">
            <option value="comfortable">Comfort</option>
            <option value="compact">Compact</option>
          </select>
        ) },
        { label: 'Group', node: (
          <select value={rosterGroupMode} onChange={e => setRosterGroupMode(e.target.value)} style={sheetSelectStyle(rosterGroupMode !== 'position')} title="Group rows by">
            {GROUP_MODES.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
          </select>
        ) },
        { label: 'Saved views', node: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, whiteSpace: 'nowrap' }}>{filtered.length} / {allPlayers.length} shown</span>
            {window.WR?.SavedViews?.SavedViewBar && React.createElement(window.WR.SavedViews.SavedViewBar, {
              surface: 'roster',
              leagueId: currentLeague?.id,
              currentState: { columns: visibleCols, sort: rosterSort, filters: { rosterFilter, rosterGroupMode, rowDensity } },
              onApply: (v) => {
                if (Array.isArray(v.columns) && v.columns.length) { setVisibleCols(v.columns); setColPreset('custom'); }
                if (v.sort && v.sort.key) setRosterSort({ key: v.sort.key, dir: v.sort.dir || 1 });
                if (v.filters && typeof v.filters.rosterFilter === 'string') setRosterFilter(v.filters.rosterFilter);
                if (v.filters && typeof v.filters.rosterGroupMode === 'string') setRosterGroupMode(v.filters.rosterGroupMode);
                if (v.filters && typeof v.filters.rowDensity === 'string') setRowDensity(v.filters.rowDensity);
              },
            })}
          </div>
        ) },
      ],
      footer: (
        <React.Fragment>
          <button onClick={() => { setRosterFilter('All'); setVisibleCols(COLUMN_PRESETS.default); setColPreset('default'); setPpgWindow('season'); setRowDensity('comfortable'); setRosterGroupMode('position'); }} style={{ ...controlBtn(false), minHeight: '44px', flex: 1 }}>Reset</button>
          <button onClick={() => setFiltersOpen(false)} style={{ ...controlBtn(true), minHeight: '44px', flex: 2 }}>Apply</button>
        </React.Fragment>
      ),
    });

    // Review sheet — the flagged players (drop alerts + sell calls) as a
    // tappable list; tapping jumps to that player's dossier. Opened by the
    // hero's Review CTA.
    const _reviewRow = (r) => React.createElement(window.WR.AssetRow, {
      key: 'rv-' + r.pid,
      pos: r.pos,
      pid: r.pid,
      name: getPlayerName(r.pid),
      tag: _phoneTagFor(r),
      slots: [{ label: 'DHQ', value: r.dhq > 0 ? r.dhq.toLocaleString() : '—', strong: true }],
      verdict: _phoneVerdictChip(r),
      title: 'Open ' + getPlayerName(r.pid),
      onClick: () => {
        setReviewOpen(false);
        setExpandedPid(r.pid);
        setTimeout(() => { try { const el = document.querySelector('[data-wr-roster-pid="' + r.pid + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 90);
      },
    });
    const _dropPidSet = new Set(dropAlerts.map(r => r.pid));
    const _sellRows = isPro ? rows.filter(r => /sell/i.test(_effRec(r) || '') && !_dropPidSet.has(r.pid)) : [];
    const _reviewGroups = [];
    if (dropAlerts.length) _reviewGroups.push({ label: 'Drop alerts', sub: String(dropAlerts.length), rows: dropAlerts.map(_reviewRow) });
    if (taxiAlerts.length) _reviewGroups.push({ label: 'Taxi suggestions', sub: String(taxiAlerts.length), rows: taxiAlerts.map(_reviewRow) });
    if (_sellRows.length) _reviewGroups.push({ label: 'Sell calls', sub: String(_sellRows.length), rows: _sellRows.map(_reviewRow) });
    if (_reviewGroups.length) {
      _reviewSheetEl = React.createElement(window.WR.Sheet, { open: reviewOpen, onClose: () => setReviewOpen(false), title: 'Review roster' },
        React.createElement('div', { style: { padding: '2px 12px 8px', display: 'flex', flexDirection: 'column', gap: '12px' } },
          React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0 2px', lineHeight: 1.4 } }, 'Players flagged to move or cut. Tap one to open its full read.'),
          React.createElement(window.WR.CardList, { groups: _reviewGroups })
        )
      );
    }
  }

  // P1 card list — the phone board: groups follow the EXISTING group mode
  // (filtered is already group-sorted), each row is a WR.AssetRow, and row
  // tap toggles the EXISTING expandedPid state. The expand renders the
  // hoisted dossier as AssetRow children — the desktop boardWidth pinning
  // wrapper is bypassed here (cards are viewport-width already).
  const _renderPhoneCards = () => {
    const groups = [];
    filtered.forEach(r => {
      const query = phoneSearch.trim().toLowerCase();
      if (query && !`${getPlayerName(r.pid)} ${r.pos} ${r.p.team || 'FA'}`.toLowerCase().includes(query)) return;
      const key = getRowGroupKey(r);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: rosterGroupMode === 'none' ? null : getRowGroupLabel(r), rows: [] };
        groups.push(g);
      }
      const isExpanded = expandedPid === r.pid;
      const isDropFlag = isPro && dropCandidatePids.has(r.pid) && !dismissedDrops.has(r.pid);
      g.rows.push(React.createElement(window.WR.AssetRow, {
        key: r.pid,
        pos: r.pos,
        pid: r.pid,
        name: getPlayerName(r.pid),
        tag: _phoneTagFor(r),
        slots: [_phoneSlotFor(_phoneSlotKeys[0], r)],
        // Verdict chip dropped from the collapsed row (owner ask, 2026-08-30)
        // to give the name/slots more width — Hold/Stash/Sell is still the
        // first thing you see when you tap into the player card.
        // No colored row accent either — the outline read as ambiguous
        // (owner call). Rows keep AssetRow's default faint border.
        expanded: isExpanded,
        onClick: () => setExpandedPid(prev => prev === r.pid ? null : r.pid),
        title: 'Open roster player detail',
        'data-wr-drop-flag': isDropFlag ? '1' : undefined,
        'data-wr-roster-pid': r.pid,
      }, isExpanded ? <React.Fragment>
        <div style={{ display: 'flex', gap: '18px', padding: '4px 0 14px', flexWrap: 'wrap' }}>
          {_phoneSlotKeys.map(key => { const stat = _phoneSlotFor(key, r); return <div key={key}><div style={{ fontSize: '0.7rem', color: 'var(--silver)' }}>{stat.label}</div><strong>{stat.value}</strong></div>; })}
        </div>
        {renderExpandBody(r)}
        <button type="button" onClick={() => {
          setExpandedPid(null);
          requestAnimationFrame(() => {
            const row = document.querySelector(`[data-wr-roster-pid="${r.pid}"]`);
            row?.scrollIntoView({ block: 'nearest' });
            row?.querySelector('[role="button"]')?.focus({ preventScroll: true });
          });
        }} style={{ ...controlBtn(false), width: '100%', minHeight: '44px', marginTop: '14px' }}>Back to roster ↑</button>
      </React.Fragment> : null));
    });
    if (!groups.length) {
      return <div role="status" style={{ padding: '14px', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', borderRadius: 'var(--card-radius, 10px)', color: 'var(--silver)', fontSize: '0.78rem' }}>No players match{phoneSearch ? ` “${phoneSearch}”` : ' this view'}.
        <button type="button" onClick={() => { setPhoneSearch(''); setRosterFilter('All'); }} style={{ ...controlBtn(false), display: 'block', minHeight: '44px', marginTop: '8px' }}>Show all players</button>
      </div>;
    }
    return React.createElement(window.WR.CardList, {
      groups: groups.map(g => ({ label: g.label, sub: g.rows.length + (g.rows.length === 1 ? ' player' : ' players'), rows: g.rows })),
    });
  };

  // ── Desktop/tablet roster board — HOISTED VERBATIM from the return so
  // the phone Deep Data view can reuse it inside the scoped scroll wrap.
  // Desktop output is byte-identical: the return renders this directly.
  const _renderRosterBoard = () => (
      <div style={{ border: '1px solid var(--ov-5, rgba(255,255,255,0.075))', borderRadius: 'var(--card-radius)', overflow: 'hidden', background: 'var(--surf-solid, rgba(12,12,17,0.98))', boxShadow: '0 10px 24px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', background: 'var(--ov-1, rgba(255,255,255,0.018))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', color: 'var(--white)', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700 }}>Roster Board</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: isDeepData ? 'var(--gold)' : 'var(--silver)', opacity: isDeepData ? 0.86 : 0.58 }}>{activePresetMeta.label} · {visibleCols.length} fields</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: rosterGroupMode === 'none' ? 'var(--silver)' : 'var(--gold)', opacity: 0.62 }}>Grouped by {activeGroupModeLabel}</div>
            <div style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.52, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Sort: {ROSTER_COLUMNS[rosterSort.key]?.shortLabel || (rosterSort.key === 'name' ? 'Player' : rosterSort.key)}
            </div>
          </div>
        </div>
        <div ref={boardScrollRef} style={{ overflowX: 'auto', overflowY: 'clip', background: 'linear-gradient(90deg, var(--ov-1, rgba(255,255,255,0.02)), transparent 12%, transparent 88%, var(--ov-1, rgba(255,255,255,0.018)))' }}>
          <div style={{ minWidth: tableMinWidth + 'px' }}>
            {/* Header row */}
            <div style={{ display: 'flex', height: '32px', background: 'var(--ov-2, rgba(255,255,255,0.03))', borderBottom: '1px solid var(--ov-6, rgba(255,255,255,0.12))', position: 'sticky', top: 0, zIndex: 5 }}>
              <div title="Player" style={{ width: playerColWidth + 'px', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '0.72rem', fontWeight: 600, color: rosterSort.key === 'name' ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', letterSpacing: '0.035em', cursor: 'pointer', userSelect: 'none', borderRight: '1px solid var(--ov-6, rgba(255,255,255,0.1))', textTransform: 'uppercase', position: 'sticky', left: 0, zIndex: 7, background: 'linear-gradient(180deg, var(--k-1b1d23, #1b1d23), var(--k-15161b, #15161b))', boxShadow: '8px 0 14px rgba(0,0,0,0.2)' }}
                onClick={() => sortByColumn('name')}>
                Player{sortGlyph('name')}
              </div>
              <div style={{ flex: 1, display: 'flex' }}>
                {rosterTableCols.map(colKey => {
                  const col = ROSTER_COLUMNS[colKey];
                  if (!col) return null;
                  const isSorted = rosterSort.key === colKey;
                  const isGroupStart = visibleColGroupStarts.has(colKey);
                  return (
                    <div key={colKey} title={col.label} onClick={() => sortByColumn(colKey)}
                      style={{ width: col.width, minWidth: col.width, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: isSorted ? 700 : 600, color: isSorted ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', letterSpacing: '0.025em', cursor: 'pointer', userSelect: 'none', textTransform: 'uppercase', borderLeft: isGroupStart ? '1px solid var(--ov-4, rgba(255,255,255,0.06))' : '1px solid var(--ov-3, rgba(255,255,255,0.035))', padding: '0 3px', textAlign: 'center', lineHeight: 1.05, background: isSorted ? 'var(--acc-fill1, rgba(212,175,55,0.06))' : 'transparent' }}>
                      <span>{col.shortLabel || col.label}{sortGlyph(colKey)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Player rows + inline expand */}
            {filtered.map((r, idx) => {
              const isExpanded = expandedPid === r.pid;
              const rowGroupKey = getRowGroupKey(r);
              const startsPositionGroup = rosterGroupMode !== 'none' && (idx === 0 || getRowGroupKey(filtered[idx - 1]) !== rowGroupKey);
              const rowBg = isExpanded ? 'var(--acc-fill1, rgba(212,175,55,0.058))' : idx % 2 === 1 ? 'var(--ov-1, rgba(255,255,255,0.018))' : 'var(--ov-1, rgba(255,255,255,0.006))';
              // Frozen player cell needs an OPAQUE background — 'inherit' picks up
              // the translucent row tint and the h-scrolled data columns bleed
              // through under the sticky cell. Compose tint-over-solid instead.
              const frozenBase = 'var(--surf-solid, rgba(12,12,17,0.98))';
              const frozenBg = 'linear-gradient(' + rowBg + ', ' + rowBg + '), ' + frozenBase;
              const frozenHoverBg = 'linear-gradient(var(--acc-fill1, rgba(212,175,55,0.06)), var(--acc-fill1, rgba(212,175,55,0.06))), ' + frozenBase;
              // Phone Deep Data (owner ask 2026-07-12): the frozen name cell is
              // just photo + "F. Last" + team — 30 scrolling columns leave no
              // room for the full name + slot/GM/drop tag cluster the desktop
              // board carries. Shorten to first-initial · last-name so it never
              // truncates. Desktop/tablet keep the full card (gated on !_phone).
              const frozenName = _phone && r.p.first_name && r.p.last_name
                ? r.p.first_name.charAt(0) + '. ' + r.p.last_name
                : getPlayerName(r.pid);

              const _recLower = (r.rec || '').toLowerCase();
          const actionClass = _recLower === 'sell now' || _recLower === 'sell' ? 'wr-row-sell' :
            _recLower === 'sell high' ? 'wr-row-sell-high' :
            _recLower === 'hold core' || _recLower === 'build around' ? 'wr-row-core' : '';
          const untouchables = (window._wrGmStrategy?.untouchable || []);
          const isUntouchable = untouchables.includes(r.pid);

          return (
            <React.Fragment key={r.pid}>
              {startsPositionGroup && (
	                <div style={{ display: 'flex', height: isCompactRows ? '24px' : '28px', borderTop: idx === 0 ? 'none' : '2px solid var(--acc-line3, rgba(212,175,55,0.45))', borderBottom: '1px solid var(--ov-5, rgba(255,255,255,0.08))', background: 'var(--ov-2, rgba(255,255,255,0.045))' }}>
	                  <div style={{ width: playerColWidth + 'px', flexShrink: 0, position: 'sticky', left: 0, zIndex: 4, display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', background: 'var(--k-1b1d23, #1b1d23)', borderLeft: '3px solid var(--gold)', borderRight: '1px solid var(--ov-5, rgba(255,255,255,0.08))', boxShadow: '8px 0 14px rgba(0,0,0,0.16)' }}>
	                    <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.84rem', color: getRowGroupColor(r), fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{getRowGroupLabel(r)}</span>
	                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{filteredPosCounts[rowGroupKey]} players</span>
                  </div>
                  <div style={{ flex: 1, borderLeft: '1px solid var(--ov-2, rgba(255,255,255,0.025))' }} />
                </div>
              )}
              {/* Normal row */}
              <div className={[actionClass, isUntouchable ? 'wr-untouchable' : ''].filter(Boolean).join(' ')} role="button" tabIndex={0} title="Open roster player detail" style={{ display: 'flex', overflow: 'visible', borderTop: 'none', borderBottom: isExpanded ? 'none' : '1px solid var(--ov-3, rgba(255,255,255,0.035))', cursor: 'pointer', background: rowBg, transition: 'background 0.1s' }}
                onClick={() => setExpandedPid(prev => prev === r.pid ? null : r.pid)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedPid(prev => prev === r.pid ? null : r.pid); } }}
                onMouseEnter={e => { if (!isExpanded) { e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'; const fc = e.currentTarget.firstElementChild; if (fc) fc.style.background = frozenHoverBg; } }}
                onMouseLeave={e => { if (!isExpanded) { e.currentTarget.style.background = rowBg; const fc = e.currentTarget.firstElementChild; if (fc) fc.style.background = frozenBg; } }}>
                {/* Frozen player info */}
	                <div style={{ width: playerColWidth + 'px', flexShrink: 0, height: rowHeight + 'px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', borderRight: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', position: 'sticky', left: 0, zIndex: 3, background: frozenBg, boxShadow: '8px 0 14px rgba(0,0,0,0.16)' }}>
                  <div style={{ width: avatarSize + 'px', height: avatarSize + 'px', flexShrink: 0 }}><img src={'https://sleepercdn.com/content/nfl/players/thumb/'+r.pid+'.jpg'} alt="" onError={e=>e.target.style.display='none'} style={{ width: avatarSize + 'px', height: avatarSize + 'px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))' }} /></div>
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
	                      <span style={{ fontWeight: 650, color: 'var(--white)', fontSize: playerNameSize, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{frozenName}</span>
                      {/* Tag cluster (slot/roster/GM/drop) is desktop + tablet only —
                          phone Deep Data keeps the name cell to photo · name · team. */}
                      {!_phone && <React.Fragment>
                      {inlineTag(slotTagMeta[r.section], 'slot-' + r.pid)}
                      {window._playerTags?.[r.pid] && window._playerTags[r.pid] !== 'cut' && window._playerTags[r.pid] !== 'taxi' && inlineTag(rosterTagMeta[window._playerTags[r.pid]], 'tag-' + r.pid)}
                      {/* GM Strategy: untouchable lock — distinct from manual tag system */}
                      {r.gmIsUntouchable && <span title="GM Strategy: untouchable — locked from sell flags" style={{ fontSize: 'var(--text-micro, 0.6875rem)', flexShrink: 0, lineHeight: 1, color: 'var(--good)' }}>{'🛡'}</span>}
                      {/* GM Strategy: acquisition-focus / sell-candidate position accents */}
                      {!r.gmIsUntouchable && r.gmIsTarget && <span title="GM Strategy: acquisition-focus position" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 800, background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.28))', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>TGT</span>}
                      {!r.gmIsUntouchable && r.gmIsSellPos && <span title="GM Strategy: sell-candidate position" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 800, background: 'rgba(240,165,0,0.13)', color: 'var(--warn)', border: '1px solid rgba(240,165,0,0.32)', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>SELL</span>}
                      {isPro && dropCandidatePids.has(r.pid) && !dismissedDrops.has(r.pid) && <span className="wr-drop-chip" onClick={e => { e.stopPropagation(); dismissDrop(r.pid); }} title="Drop candidate (click to dismiss)" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, background: 'rgba(231,76,60,0.2)', color: 'var(--bad)', border: '1px solid rgba(231,76,60,0.4)', flexShrink: 0, cursor: 'pointer', lineHeight: 1 }}>DROP?</span>}
                      {isPro && taxiCandidatePids.has(r.pid) && !dismissedTaxiSuggestions.has(r.pid) && <span className="wr-drop-chip" onClick={e => { e.stopPropagation(); dismissTaxiSuggestion(r.pid); }} title={(cutdownInfo ? 'Better stashed than cut — room on taxi under the pending cutdown' : 'Better stashed than cut — real taxi room open on your roster') + ' (click to dismiss)'} style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, background: 'rgba(52,152,219,0.2)', color: 'var(--k-3498db, #3498db)', border: '1px solid rgba(52,152,219,0.4)', flexShrink: 0, cursor: 'pointer', lineHeight: 1 }}>TAXI?</span>}
                      {isPro && (() => {
                        const isCut = window._playerTags?.[r.pid] === 'cut';
                        return (
                          <span className="wr-cut-toggle-chip" onClick={e => { e.stopPropagation(); toggleCutTag(r.pid); }}
                            title={isCut ? 'Marked to cut — click to unmark' : 'Mark this player to cut'}
                            style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700,
                              background: isCut ? 'rgba(231,76,60,0.2)' : 'transparent',
                              color: isCut ? 'var(--bad)' : 'var(--silver)',
                              border: '1px solid ' + (isCut ? 'rgba(231,76,60,0.4)' : 'var(--ov-6, rgba(255,255,255,0.14))'),
                              opacity: isCut ? 1 : 0.5, flexShrink: 0, cursor: 'pointer', lineHeight: 1 }}>
                            {isCut ? 'CUTTING ✕' : '+ CUT'}
                          </span>
                        );
                      })()}
                      {isPro && !r.isStarter && !r.isTaxi && !r.isIR && (r.p?.years_exp ?? 99) <= taxiEligibleCap && (() => {
                        const isStashed = window._playerTags?.[r.pid] === 'taxi';
                        return (
                          <span className="wr-cut-toggle-chip" onClick={e => { e.stopPropagation(); toggleTaxiTag(r.pid); }}
                            title={isStashed ? 'Marked to stash on taxi — click to unmark' : 'Mark this player to move to taxi'}
                            style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700,
                              background: isStashed ? 'rgba(52,152,219,0.2)' : 'transparent',
                              color: isStashed ? 'var(--k-3498db, #3498db)' : 'var(--silver)',
                              border: '1px solid ' + (isStashed ? 'rgba(52,152,219,0.4)' : 'var(--ov-6, rgba(255,255,255,0.14))'),
                              opacity: isStashed ? 1 : 0.5, flexShrink: 0, cursor: 'pointer', lineHeight: 1 }}>
                            {isStashed ? 'STASHING ✕' : '+ STASH'}
                          </span>
                        );
                      })()}
                      {isPro && resolvedLeagueSkin?.type === 'keeper' && keeperTopPids.has(r.pid) && <span title={'Recommended keep — top ' + maxKeepers + ' by keeper value'} style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 800, background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.28))', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>KEEP</span>}
                      </React.Fragment>}
                    </div>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, marginTop: '1px' }}>{r.p.team || 'FA'}{!_phone && r.injury ? ' \u00B7 '+r.injury : ''}</div>
                  </div>
                  <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.42 }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
                {/* Data columns */}
                <div style={{ flex: 1, display: 'flex', height: rowHeight + 'px', overflow: 'hidden' }}>
                  {rosterTableCols.map(colKey => ROSTER_COLUMNS[colKey] ? renderCell(colKey, r) : null)}
                </div>
              </div>

              {/* Inline expand card — Madden/FM style */}
              {isExpanded && (
                <div style={{ borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'linear-gradient(180deg, var(--surf-solid, rgba(18,18,24,0.99)), var(--surf-solid, rgba(6,6,10,0.99)))', padding: '12px 14px', animation: 'wrFadeIn 0.2s ease', position: 'sticky', left: 0, zIndex: 3, width: boardWidth ? boardWidth + 'px' : '100%', boxSizing: 'border-box' }}>
                  {renderExpandBody(r)}
                </div>
              )}
            </React.Fragment>
          );
            })}
            {filtered.length === 0 && (
              <div style={{ display: 'flex', minHeight: '76px', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.04))', background: 'var(--ov-1, rgba(255,255,255,0.012))' }}>
                <div style={{ width: playerColWidth + 'px', flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: 'var(--k-0d0d13, #0d0d13)', borderRight: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))', display: 'flex', alignItems: 'center', padding: '0 12px', color: 'var(--silver)', fontWeight: 700 }}>No players</div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 14px', color: 'var(--silver)', opacity: 0.58, fontSize: '0.78rem' }}>No roster rows match this view.</div>
              </div>
            )}
          </div>
        </div>
      </div>
  );

  return (
    <div style={{ padding: _phone ? '12px var(--wr-phone-gutter, 12px) 8px' : 'var(--card-pad, 16px 18px)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {_phone && <React.Fragment>
        {_phoneHeroEl}
        {_phonePillsEl}
        {_phoneSheetEl}
        {_reviewSheetEl}
      </React.Fragment>}
      {!_phone && <React.Fragment>
      {isCompactRoster && (() => {
        const ppgLabelMap = { season: 'Season', l5: 'L5', l3: 'L3' };
        const rowLabelMap = { comfortable: 'Comfort', compact: 'Compact' };
        const groupLabel = (GROUP_MODES.find(g => g.key === rosterGroupMode) || {}).label || 'None';
        const viewLabel = (COLUMN_PRESET_META[activePresetKey] || {}).label || activePresetKey;
        const summary = [rosterFilter, viewLabel, ppgLabelMap[ppgWindow] || ppgWindow, rowLabelMap[rowDensity] || rowDensity, groupLabel].join(' · ');
        return (
          <button onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--surf-solid, rgba(20,20,26,0.72))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 'var(--card-radius)', padding: '10px 12px', minHeight: '44px', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em', flexShrink: 0 }}>Filters</span>
            {!filtersOpen && <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{summary}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, whiteSpace: 'nowrap', flexShrink: 0 }}>{filtered.length}/{allPlayers.length}</span>
            <span style={{ color: 'var(--gold)', fontSize: 'var(--text-body, 1rem)', flexShrink: 0, transition: 'transform 0.15s', transform: filtersOpen ? 'rotate(180deg)' : 'none' }}>{'▾'}</span>
          </button>
        );
      })()}

      {/* Phone (≤767): the expanded filter row must wrap — 6 selects + Customize
          + SavedViewBar are ~700px of nowrap controls, which overflow a 375px
          viewport with no scroll path (body is overflow-x:clip). Tablet/desktop
          keep the shipped single-line nowrap bar. */}
      {(!isCompactRoster || filtersOpen) && (
      <section style={{ background: 'var(--surf-solid, rgba(20,20,26,0.72))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 'var(--card-radius)', padding: 'var(--card-pad-sm)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: rosterViewportWidth <= 767 ? 'wrap' : 'nowrap', minWidth: 0 }}>
        <span className="wr-module-toolbar-label">Scope</span>
        <select value={rosterFilter} onChange={e => setRosterFilter(e.target.value)} style={rosterSelectStyle(rosterFilter !== 'All')} title="Show a slot or position group">
          {rosterFilterOptions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <span className="wr-module-toolbar-label">View</span>
        <select value={activePresetKey} onChange={e => { const key = e.target.value; const cols = COLUMN_PRESETS[key]; if (!cols) return; setVisibleCols(cols); setColPreset(key); if (key === 'rookie') setRosterFilter('Rookies'); else if (rosterFilter === 'Rookies') setRosterFilter('All'); }} style={rosterSelectStyle(activePresetKey !== 'default')} title="Column preset">
          {Object.keys(COLUMN_PRESETS).map(key => <option key={key} value={key}>{COLUMN_PRESET_META[key]?.label || key}</option>)}
          {activePresetKey === 'custom' && <option value="custom">Custom</option>}
        </select>
        <button onClick={() => setShowColPicker(!showColPicker)} style={{ ...controlBtn(showColPicker || activePresetKey === 'custom'), minHeight: '44px', flexShrink: 0 }} title="Add, remove, or reorder columns">Customize</button>

        <span className="wr-module-toolbar-label">PPG</span>
        <select value={ppgWindow} onChange={e => setPpgWindow(e.target.value)} style={rosterSelectStyle(ppgWindow !== 'season')} title="Points-per-game window">
          <option value="season">Season</option>
          <option value="l5">L5</option>
          <option value="l3">L3</option>
        </select>

        <span className="wr-module-toolbar-label">Rows</span>
        <select value={rowDensity} onChange={e => setRowDensity(e.target.value)} style={rosterSelectStyle(rowDensity !== 'comfortable')} title="Row density">
          <option value="comfortable">Comfort</option>
          <option value="compact">Compact</option>
        </select>

        <span className="wr-module-toolbar-label">Group</span>
        <select value={rosterGroupMode} onChange={e => setRosterGroupMode(e.target.value)} style={rosterSelectStyle(rosterGroupMode !== 'position')} title="Group rows by">
          {GROUP_MODES.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, whiteSpace: 'nowrap' }}>{filtered.length} / {allPlayers.length} shown</span>
          {window.WR?.SavedViews?.SavedViewBar && React.createElement(window.WR.SavedViews.SavedViewBar, {
            surface: 'roster',
            leagueId: currentLeague?.id,
            currentState: { columns: visibleCols, sort: rosterSort, filters: { rosterFilter, rosterGroupMode, rowDensity } },
            onApply: (v) => {
              if (Array.isArray(v.columns) && v.columns.length) { setVisibleCols(v.columns); setColPreset('custom'); }
              if (v.sort && v.sort.key) setRosterSort({ key: v.sort.key, dir: v.sort.dir || 1 });
              if (v.filters && typeof v.filters.rosterFilter === 'string') setRosterFilter(v.filters.rosterFilter);
              if (v.filters && typeof v.filters.rosterGroupMode === 'string') setRosterGroupMode(v.filters.rosterGroupMode);
              if (v.filters && typeof v.filters.rowDensity === 'string') setRowDensity(v.filters.rowDensity);
            },
          })}
        </div>
      </section>
      )}
      </React.Fragment>}

      <div>

      {/* Column picker dropdown — desktop/tablet only; the phone tier re-homes
          the SAME showColPicker state into the WR.FilterSheet below (shared
          customizer treatment with Free Agency's colpick). */}
      {showColPicker && !_phone && (
        <div style={{ background: 'linear-gradient(180deg, var(--surf-solid, rgba(22,22,29,0.98)), var(--surf-solid, rgba(10,10,14,0.98)))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: 'var(--card-radius, 10px)', padding: '12px', marginBottom: '10px', boxShadow: '0 10px 28px rgba(0,0,0,0.24)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', color: 'var(--white)', fontWeight: 700, letterSpacing: '0.04em' }}>Customize Columns</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58 }}>{visibleCols.length} of {Object.keys(ROSTER_COLUMNS).length} active</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setCustomColumns(Object.keys(ROSTER_COLUMNS))} style={controlBtn(inactiveColumnCount === 0)}>All Fields</button>
              <button onClick={() => setCustomColumns(COLUMN_PRESETS.default)} style={controlBtn(activePresetKey === 'default')}>Reset Default</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: rosterViewportWidth <= 820 ? '1fr' : 'minmax(280px, 0.9fr) minmax(360px, 1.4fr)', gap: '12px', alignItems: 'start' }}>
            <div style={{ background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>Active Order</div>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.54 }}>{activeColumnOrder.length} visible</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', paddingRight: '2px' }}>
                {activeColumnOrder.length === 0 ? (
                  <div style={{ padding: '12px', borderRadius: 'var(--card-radius-sm, 8px)', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>Only the player column is visible.</div>
                ) : activeColumnOrder.map((key, idx) => {
                  const col = ROSTER_COLUMNS[key];
                  return (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) 26px 26px 26px', gap: '5px', alignItems: 'center', padding: '5px 6px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--acc-fill2, rgba(212,175,55,0.075))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))' }}>
                      <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>{idx + 1}</span>
                      <span title={col.label} style={{ color: 'var(--white)', fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.shortLabel || col.label}</span>
                      <button disabled={idx === 0} onClick={() => moveVisibleColumn(key, -1)} title="Move left" style={{ height: '24px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === 0 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === 0 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === 0 ? 'default' : 'pointer' }}>{'\u2039'}</button>
                      <button disabled={idx === activeColumnOrder.length - 1} onClick={() => moveVisibleColumn(key, 1)} title="Move right" style={{ height: '24px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === activeColumnOrder.length - 1 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === activeColumnOrder.length - 1 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === activeColumnOrder.length - 1 ? 'default' : 'pointer' }}>{'\u203A'}</button>
                      <button onClick={() => removeVisibleColumn(key)} title="Hide column" style={{ height: '24px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid rgba(231,76,60,0.22)', background: 'rgba(231,76,60,0.08)', color: 'var(--bad)', cursor: 'pointer' }}>{'\u00D7'}</button>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.07))' }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '7px' }}>Group Rows By</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {GROUP_MODES.map(opt => (
                    <button key={opt.key} onClick={() => setRosterGroupMode(opt.key)} style={controlBtn(rosterGroupMode === opt.key)}>{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
              {columnGroups.map(({ group, columns }) => (
                <div key={group} style={{ background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '8px' }}>
                  <div style={{ marginBottom: '6px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>{group}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {columns.map(([key, col]) => {
                      const active = visibleCols.includes(key);
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 7px', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', fontSize: '0.74rem', background: active ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'var(--ov-1, rgba(255,255,255,0.018))', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (active ? 'var(--acc-fill3, rgba(212,175,55,0.18))' : 'var(--ov-3, rgba(255,255,255,0.04))') }}>
                          <input type="checkbox" checked={active} onChange={() => {
                            if (active) removeVisibleColumn(key);
                            else addVisibleColumn(key);
                          }} style={{ accentColor: 'var(--gold)' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Phone column customizer — the shared P3 FilterSheet treatment (same
          anatomy as Free Agency's colpick sheet): "Active (n)" 44px rows with
          the EXISTING ▲▼ move + × remove setters (moveVisibleColumn /
          removeVisibleColumn — same functions the desktop ‹ › buttons call),
          then "Available" add chips grouped by the EXISTING columnGroups
          metadata (addVisibleColumn). Free/Pro: ROSTER_COLUMNS.action is
          deleted upstream for free, so the option never exists here. */}
      {_phone && React.createElement(window.WR.FilterSheet, {
        open: !!showColPicker,
        onClose: () => setShowColPicker(false),
        title: 'Customize columns',
        sections: [
          { label: 'Active (' + activeColumnOrder.length + ')', node: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {activeColumnOrder.length === 0 ? (
                <div style={{ padding: '12px', borderRadius: 'var(--card-radius-sm, 8px)', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>Only the player column is visible.</div>
              ) : activeColumnOrder.map((key, idx) => {
                const col = ROSTER_COLUMNS[key];
                return (
                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) 44px 44px 44px', gap: '3px', alignItems: 'center', minHeight: '44px', padding: '0 2px 0 8px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--acc-fill2, rgba(212,175,55,0.075))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))' }}>
                    <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>{idx + 1}</span>
                    <span title={col.label} style={{ color: 'var(--white)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.shortLabel || col.label}</span>
                    <button disabled={idx === 0} onClick={() => moveVisibleColumn(key, -1)} title="Move up" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === 0 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === 0 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === 0 ? 'default' : 'pointer' }}>{'▲'}</button>
                    <button disabled={idx === activeColumnOrder.length - 1} onClick={() => moveVisibleColumn(key, 1)} title="Move down" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === activeColumnOrder.length - 1 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === activeColumnOrder.length - 1 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === activeColumnOrder.length - 1 ? 'default' : 'pointer' }}>{'▼'}</button>
                    <button onClick={() => removeVisibleColumn(key)} title="Hide column" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid rgba(231,76,60,0.22)', background: 'rgba(231,76,60,0.08)', color: 'var(--bad)', cursor: 'pointer' }}>{'×'}</button>
                  </div>
                );
              })}
            </div>
          ) },
          { label: 'Available', node: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {inactiveColumnCount === 0 && (
                <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>All columns are active.</div>
              )}
              {columnGroups.map(({ group, columns }) => {
                const inactive = columns.filter(([key]) => !visibleCols.includes(key));
                if (!inactive.length) return null;
                return (
                  <div key={group}>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '6px' }}>{group}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {inactive.map(([key, col]) => (
                        <button key={key} onClick={() => addVisibleColumn(key)} title={'Add ' + col.label} style={{ minHeight: '44px', padding: '7px 12px', fontSize: '0.74rem', fontFamily: 'var(--font-body)', background: 'var(--ov-1, rgba(255,255,255,0.018))', color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ {col.shortLabel || col.label}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) },
        ],
        footer: (
          <React.Fragment>
            <button onClick={() => setCustomColumns(Object.keys(ROSTER_COLUMNS))} style={{ ...controlBtn(inactiveColumnCount === 0), minHeight: '44px', flex: 1 }}>All fields</button>
            <button onClick={() => setCustomColumns(COLUMN_PRESETS.default)} style={{ ...controlBtn(false), minHeight: '44px', flex: 1 }}>Reset</button>
            <button onClick={() => setShowColPicker(false)} style={{ ...controlBtn(true), minHeight: '44px', flex: 1 }}>Done</button>
          </React.Fragment>
        ),
      })}

      {/* GM's Desk — the standing cut/taxi advisory, framed as a decision memo
          rather than another data row. Same dropCandidatePids/taxiCandidatePids
          engine that drives the chips and Review Roster strip elsewhere on this
          page, now strategy-ranked (_adjustedDhq) and given a one-line reason
          in the active GM Strategy mode's own voice. Confirm/Keep write to the
          same window._playerTags store as every other tag surface (player card,
          Dashboard's Cut Candidates widget), so a call made here is made
          everywhere. Pro-gated like the rest of the roster call engine, and
          long-horizon-gated by showGmDesk (see above). */}
      {isPro && showGmDesk && (
        <section style={{ border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius)', background: 'var(--surf-solid, rgba(20,20,26,0.72))', padding: 'var(--card-pad-sm)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {_phone && <button type="button" aria-expanded={phoneDeskOpen} onClick={() => setPhoneDeskOpen(value => !value)} style={{ ...controlBtn(false), minHeight: '44px', width: '100%', textAlign: 'left' }}>GM’s Desk · {gmDeskCalls.length ? `${gmDeskCalls.length} suggested moves` : 'No moves flagged'} {phoneDeskOpen ? '▴' : '▾'}</button>}
          {(!_phone || phoneDeskOpen) && <React.Fragment>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em' }}>GM's Desk</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '999px', color: gm?.badgeColor || 'var(--gold)', border: '1px solid ' + wrAlpha(gm?.badgeColor || 'var(--gold)', '55'), background: wrAlpha(gm?.badgeColor || 'var(--gold)', '14') }}>{(gm?.modeLabel || 'Compete') + ' Mode'}</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.75, fontStyle: 'italic', marginTop: '-4px' }}>{window.WR.GmMode.getPreset(gm?.mode)?.tagline || ''}</div>
          {gmDeskCalls.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: 'var(--silver)', opacity: 0.7, padding: '4px 0' }}>Bench is settled — no cuts or stashes flagged under {(gm?.modeLabel || 'Compete').toUpperCase()} mode.</div>
          ) : React.createElement(window.WR.CardList, {
            groups: [{
              label: 'Recommended Moves',
              sub: gmDeskCalls.length + ' call' + (gmDeskCalls.length === 1 ? '' : 's'),
              rows: gmDeskCalls.map(({ r, verdict }) => {
                const col = verdict === 'CUT' ? 'var(--bad)' : 'var(--k-3498db, #3498db)';
                return React.createElement(window.WR.AssetRow, {
                  key: 'desk-' + r.pid,
                  pid: r.pid,
                  pos: r.pos,
                  name: getPlayerName(r.pid),
                  tag: [r.p?.team || 'FA', r.age ? String(r.age) : null, r.peakPhase].filter(Boolean).join(' · '),
                  slots: [{ label: 'DHQ', value: (r.dhq || 0).toLocaleString(), strong: true }],
                  verdict: React.createElement('span', {
                    style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid ' + wrAlpha(col, '80'), color: col, letterSpacing: '0.02em', whiteSpace: 'nowrap', textTransform: 'uppercase' },
                  }, verdict === 'CUT' ? 'CUT' : 'STASH → TAXI'),
                  expanded: true,
                }, (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>{_gmDeskReason(r, verdict)}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => verdict === 'CUT' ? toggleCutTag(r.pid) : toggleTaxiTag(r.pid)} style={{ padding: '5px 11px', fontSize: '0.76rem', fontWeight: 700, fontFamily: 'var(--font-body)', background: wrAlpha(col, '14'), color: col, border: '1px solid ' + wrAlpha(col, '55'), borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer' }}>
                        {'✓ Confirm ' + (verdict === 'CUT' ? 'cut' : 'stash')}
                      </button>
                      <button onClick={() => verdict === 'CUT' ? dismissDrop(r.pid) : dismissTaxiSuggestion(r.pid)} style={{ padding: '5px 11px', fontSize: '0.76rem', fontWeight: 600, fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer' }}>
                        Keep him
                      </button>
                    </div>
                  </div>
                ));
              }),
            }],
          })}
          </React.Fragment>}
        </section>
      )}

      {/* Keeper recommendations — keeper leagues only, Pro-gated same as the
          Move column / Dynasty Read. Additive to the existing roster board,
          not a replacement for the Move column (different questions: "should
          I trade him" vs "should I spend a keeper slot on him"). */}
      {resolvedLeagueSkin?.type === 'keeper' && isPro && keeperRanked.length > 0 && (() => {
        const keeperRowEl = (r, isBubble) => {
          const ka = window.getKeeperAction ? window.getKeeperAction(r.pid) : null;
          return React.createElement(window.WR.AssetRow, {
            key: r.pid,
            pos: r.pos,
            name: getPlayerName(r.pid),
            tag: [r.p?.team || 'FA', r.age ? String(r.age) : null].filter(Boolean).join(' · '),
            slots: [{ label: 'KEEPER VAL', value: (r.dhq || 0).toLocaleString(), strong: true }],
            verdict: ka && React.createElement('span', {
              title: ka.reason,
              style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid ' + wrAlpha(ka.col, '80'), color: ka.col, letterSpacing: '0.02em', whiteSpace: 'nowrap', textTransform: 'uppercase' }
            }, ka.label),
            expanded: expandedPid === r.pid,
            onClick: () => setExpandedPid(prev => prev === r.pid ? null : r.pid),
            title: isBubble ? 'On the bubble — open full detail' : 'Recommended keep — open full detail',
          }, expandedPid === r.pid && ka ? React.createElement('div', { style: { fontSize: '0.8rem', color: 'var(--silver)', lineHeight: 1.4 } }, ka.reason) : null);
        };
        const topRows = keeperRanked.slice(0, maxKeepers).map(r => keeperRowEl(r, false));
        const bubbleRows = keeperRanked.slice(maxKeepers, maxKeepers + 2).map(r => keeperRowEl(r, true));
        return (
          <section style={{ border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius)', background: 'var(--surf-solid, rgba(20,20,26,0.72))', padding: 'var(--card-pad-sm)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em' }}>Keeper Recommendations</span>
              <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{maxKeepers} keeper slot{maxKeepers === 1 ? '' : 's'}</span>
            </div>
            {React.createElement(window.WR.CardList, {
              groups: [
                { label: 'Recommended Keeps', sub: topRows.length + (topRows.length === 1 ? ' player' : ' players'), rows: topRows },
                ...(bubbleRows.length ? [{ label: 'On the Bubble', sub: bubbleRows.length + (bubbleRows.length === 1 ? ' player' : ' players'), rows: bubbleRows }] : []),
              ],
            })}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {keeperTake?.error ? (
                <span style={{ fontSize: '0.78rem', color: 'var(--k-e74c3c, #e74c3c)' }}>Alex couldn’t generate a take: {keeperTake.error}</span>
              ) : keeperTake?.text ? (
                <React.Fragment>
                  <span style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>✦ {keeperTake.text}</span>
                  {keeperTake.feedback
                    ? <span style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.6 }}>{keeperTake.feedback === 'up' ? 'Glad it helped.' : 'Noted — Alex learns from this.'}</span>
                    : (
                      <React.Fragment>
                        <span style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.6 }}>Useful?</span>
                        <button onClick={() => sendKeeperTakeFeedback('up')} style={{ background: 'none', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: 'var(--card-radius-xs, 5px)', color: 'var(--silver)', cursor: 'pointer', fontSize: '0.78rem', padding: '2px 9px' }}>👍</button>
                        <button onClick={() => sendKeeperTakeFeedback('down')} style={{ background: 'none', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: 'var(--card-radius-xs, 5px)', color: 'var(--silver)', cursor: 'pointer', fontSize: '0.78rem', padding: '2px 9px' }}>👎</button>
                      </React.Fragment>
                    )}
                </React.Fragment>
              ) : (
                <button onClick={getKeeperTake} disabled={keeperTake?.loading} style={{ padding: '6px 12px', fontSize: '0.8rem', fontFamily: 'var(--font-body)', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer' }}>
                    {keeperTake?.loading ? '✨ Thinking…' : '✨ Alex’s take'}
                  </button>
                )}
            </div>
          </section>
        );
      })()}

      {/* Review Roster triage strip (iPad pass, owner-approved 2026-07-12):
          the phone triage SHEET had no ≥768 equivalent — flags only lived
          inline per row. Same data seams as the phone sheet (_isActiveDrop /
          _effRec); chip tap expands the player on the board below. Collapsed
          to a one-line count by default. */}
      {!_phone && isPro && (() => {
        const dropAlerts = rows.filter(_isActiveDrop);
        const taxiAlerts = rows.filter(_isActiveTaxiSuggestion);
        const sellCalls = rows.filter(r => /sell/i.test(_effRec(r) || '') && !dropAlerts.some(d => d.pid === r.pid));
        if (!dropAlerts.length && !taxiAlerts.length && !sellCalls.length) return null;
        const chipColor = { DROP: 'var(--bad)', STASH: 'var(--k-3498db, #3498db)', SELL: 'var(--warn)' };
        const chipBorder = { DROP: 'rgba(231,76,60,0.4)', STASH: 'rgba(52,152,219,0.4)', SELL: 'rgba(240,165,0,0.35)' };
        const chip = (r, kind) => (
          <button key={kind + '-' + r.pid} type="button" onClick={() => setExpandedPid(prev => prev === r.pid ? null : r.pid)}
            title="Expand this player on the board below"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '999px', cursor: 'pointer', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + chipBorder[kind], color: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 600 }}>
            <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, color: chipColor[kind], letterSpacing: '0.04em' }}>{kind}</span>
            {getPlayerName(r.pid)}
            <span style={{ color: 'var(--silver)', opacity: 0.6, fontSize: 'var(--text-micro, 0.6875rem)' }}>{r.pos}</span>
          </button>
        );
        return (
          <div style={{ marginBottom: '10px', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--ov-1, rgba(255,255,255,0.015))', overflow: 'hidden' }}>
            <button type="button" onClick={() => setReviewStripOpen(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Review Roster</span>
              {cutdownInfo && (
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: cutdownInfo.over > 0 ? 'var(--bad)' : 'var(--warn)' }}>
                  {cutdownInfo.status.isPast
                    ? (cutdownInfo.over > 0 ? 'Cutdown day passed — ' + cutdownInfo.over + ' over the ' + (cutdownInfo.rule.activeSlots + cutdownInfo.rule.taxiSlots) + '-man limit' : 'Cutdown day passed')
                    : 'Cutdown in ' + cutdownInfo.status.daysUntil + ' day' + (cutdownInfo.status.daysUntil === 1 ? '' : 's') + (cutdownInfo.over > 0 ? ' — ' + cutdownInfo.over + ' over the ' + (cutdownInfo.rule.activeSlots + cutdownInfo.rule.taxiSlots) + '-man limit' : '')}
                  {cutdownInfo.over > 0 && ' — ' + cutMarkedCount + ' of ' + (dropCandidatePids.size + taxiCandidatePids.size) + ' resolved'}
                  {' ·'}
                </span>
              )}
              <span style={{ fontSize: '0.76rem', color: 'var(--silver)' }}>{dropAlerts.length} drop alert{dropAlerts.length === 1 ? '' : 's'} · {taxiAlerts.length} taxi suggestion{taxiAlerts.length === 1 ? '' : 's'} · {sellCalls.length} sell call{sellCalls.length === 1 ? '' : 's'}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.74rem', color: 'var(--gold)', fontWeight: 700 }}>{reviewStripOpen ? 'Hide ▴' : 'Review ▾'}</span>
            </button>
            {reviewStripOpen && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '2px 12px 10px' }}>
                {dropAlerts.map(r => chip(r, 'DROP'))}
                {taxiAlerts.map(r => chip(r, 'STASH'))}
                {sellCalls.map(r => chip(r, 'SELL'))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Roster table with inline expand cards — desktop/tablet renders the
          hoisted board verbatim; the phone tier re-homes it: AssetRow card
          list by default, or the full board inside the scoped Deep Data
          scroll wrap (P7) so no column is ever lost. */}
      {!_phone && _renderRosterBoard()}
      {_phone && phoneTableOpen && (
        <div className="wr-sticky-table-wrap" style={{ border: 'none' }}>{_renderRosterBoard()}</div>
      )}
      {_phone && !phoneTableOpen && <React.Fragment>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input type="search" aria-label="Search your roster" placeholder="Find a player, team or position" value={phoneSearch} onChange={event => setPhoneSearch(event.target.value)} style={{ minWidth: 0, flex: 1, minHeight: '44px', padding: '10px 12px', fontSize: '16px', borderRadius: 'var(--card-radius, 10px)', background: 'var(--black)', color: 'var(--white)', border: '1px solid var(--ov-6, rgba(255,255,255,.12))' }} />
          {phoneSearch && <button type="button" onClick={() => setPhoneSearch('')} style={{ ...controlBtn(false), minHeight: '44px' }}>Clear</button>}
        </div>
        <p style={{ margin: '0 0 12px', fontSize: '0.75rem', color: 'var(--silver)' }}>Tap a player for stats, strategy and roster actions.</p>
        {_renderPhoneCards()}
      </React.Fragment>}

      </div>
    </div>
  );
}
