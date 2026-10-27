// ══════════════════════════════════════════════════════════════════
// js/tabs/time-league.js — window.TimeLeague, the Time League mode
// orchestrator. Mirrors js/tabs/commissioner-office.js's shape: a
// top-level mode (not a per-league tab) that owns all state and calls the
// ported engine (js/shared/time-league-*.js) directly.
//
// Ported from The Duat's app/TimeLeagueView.tsx — localStorage read/write,
// bundled-dataset fetch caching, and the shell/lobby/tab-bar. The four
// content tabs (draft / team-roster-waivers-trades / standings / activity)
// and the gameday/gamecast tab render via the sibling panel components in
// js/components/time-league-*.js.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useState, useEffect, useCallback, useMemo, useRef } = React;
    const h = React.createElement;

    const Types = window.App.TimeLeagueTypes;
    const Season = window.App.TimeLeagueSeason;
    const PlayerCards = window.App.TimeLeaguePlayerCards;
    const Engine = window.App.TimeLeagueEngine;
    const EraRules = window.App.TimeLeagueEraRules;
    const Remote = window.App.TimeLeagueRemote;
    const Storage = window.App.TimeLeagueStorage;
    const signInHref = (window.location?.pathname?.includes('/dist-preview/') ? '../' : '') + 'login.html?vault=1&reauth=1';
    const gameActor = () => window.App.GameGuest?.getActor('vault') || (window.App.OD?.getCurrentUserId?.() ? {
        userId: window.App.OD.getCurrentUserId(), token: window.App.OD.getSessionToken?.(), kind: 'account',
    } : null);

    const UI_PREFS_KEY = 'wr-time-league-ui-v1';
    const REGULAR_SEASON_WEEKS = 14;
    const MAX_QUARTERBACKS = 2;

    const TAB_IDS = ['home', 'draft', 'gameday', 'roster', 'waivers', 'trades', 'stats', 'achievements', 'messages', 'career', 'community', 'activity'];
    const TAB_LABELS = {
        home: 'HOME', draft: 'DRAFT', gameday: 'GAMEDAY', roster: 'ROSTER', waivers: 'WAIVERS', stats: 'PLAYER STATS',
        trades: 'TRADES', achievements: 'ACHIEVEMENTS', messages: 'MESSAGES', career: 'MY PROFILE', community: 'COMMUNITY', standings: 'COMMAND CENTRAL', activity: 'ACTIVITY',
    };
    const TAB_ICONS = {
        home: '⌂', draft: '▤', gameday: '▶', roster: '♙', waivers: '+', stats: '▥', trades: '⇄',
        achievements: '♛', messages: '✉', career: '★', community: '◎', standings: '≡', activity: '◷',
    };
    const gateWorkspace = league => league.weekStage === 'claims'
        ? league.settings.waiversEnabled ? 'waivers' : league.settings.tradesEnabled ? 'trades' : 'roster'
        : ({ lineup: 'roster', ready: 'gameday', postgame: 'gameday' })[league.weekStage] || 'home';

    function LeagueEraSummary({ league }) {
        // The local canonical save also contains sealed editions. Only the
        // already-public decade may contribute while their years are hidden.
        const hidden = league.settings.hiddenYears && !league.yearsRevealed;
        const present = new Set(league.teams.flatMap(team => team.roster || []).map(entry =>
            hidden ? entry.hiddenDecade : EraRules.decadeOf(entry.drawnSeason)).filter(Boolean));
        const decades = EraRules.ERA_DECADES.filter(decade => present.has(decade.id));
        if (!decades.length) return null;
        return h('div', { className: 'tl-league-eras', role: 'group', 'aria-label': 'Eras on the field' },
            h('span', { className: 'tl-league-eras-label' }, 'Eras'),
            decades.map(decade => h('span', { key: decade.id, title: `${decade.from}–${decade.to}` }, decade.label)));
    }

    const PERSONA_IDS = Engine.AI_PERSONA_IDS;
    // Helmet defaults are deterministic per name (see time-league-helmet.js) so
    // the same roster of default seats always looks the same, not reshuffled
    // on every "Found a League" mount.
    const seatWithHelmet = (seat) => ({ ...seat, helmet: window.App.TimeLeagueHelmet.defaultHelmet(seat.name) });
    const defaultSeats = () => {
        const identity = window.App.TimeLeagueProfile?.teamDefaults();
        return [
        { ...seatWithHelmet({ name: 'Commander', manager: 'human', aiPersona: 'warlord' }), ...(identity || {}) },
        ...Array.from({ length: 5 }, (_, index) => Engine.defaultAiSeat(index + 1)),
        ];
    };

    // ── storage (all reads guarded; wall-clock timestamps live only in this UI layer) ──
    function readIndexEntries() {
        try {
            const raw = JSON.parse(window.localStorage.getItem(Types.TIME_LEAGUE_INDEX_KEY) ?? 'null');
            if (!Array.isArray(raw)) return [];
            return raw.flatMap((item) => {
                if (!item || typeof item !== 'object' || typeof item.leagueId !== 'string' || typeof item.name !== 'string') return [];
                const phase = item.phase === 'season' || item.phase === 'complete' ? item.phase : 'draft';
                return [{
                    leagueId: item.leagueId, name: item.name, phase,
                    teamCount: typeof item.teamCount === 'number' ? item.teamCount : 0,
                    currentWeek: typeof item.currentWeek === 'number' ? item.currentWeek : 1,
                    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
                    weekStage: ['claims', 'lineup', 'ready', 'postgame'].includes(item.weekStage) ? item.weekStage : undefined,
                    teamName: typeof item.teamName === 'string' ? item.teamName : undefined,
                    draftPickCount: Number.isInteger(item.draftPickCount) ? item.draftPickCount : undefined,
                    draftTotalPicks: Number.isInteger(item.draftTotalPicks) ? item.draftTotalPicks : undefined,
                    completedWeeks: Number.isInteger(item.completedWeeks) ? item.completedWeeks : undefined,
                    totalWeeks: Number.isInteger(item.totalWeeks) ? item.totalWeeks : undefined,
                }];
            });
        } catch { return []; }
    }
    function writeIndexEntries(entries) {
        try { window.localStorage.setItem(Types.TIME_LEAGUE_INDEX_KEY, JSON.stringify(entries)); } catch { /* in-memory only */ }
    }
    function readLeague(leagueId, snapshotRef) {
        try {
            const raw = window.localStorage.getItem(Types.timeLeagueStorageKey(leagueId));
            const state = Engine.normalizeTimeLeague(Storage ? Storage.decode(raw) : JSON.parse(raw ?? 'null'));
            if (state && snapshotRef) snapshotRef.current = { leagueId: state.leagueId, raw };
            return state;
        }
        catch { return null; }
    }
    function writeLeague(state) {
        window.localStorage.setItem(Types.timeLeagueStorageKey(state.leagueId), Storage ? Storage.encode(state) : JSON.stringify(state));
    }
    function writeLeagueSnapshot(state, entries, options) {
        if (Storage) return Storage.writeSnapshot(state, entries, options);
        // Save the discoverable shelf first and the authoritative game last.
        // A failed game write leaves the previous game untouched; roll back
        // the shelf so a failed creation cannot leave a phantom league.
        const previousIndex = window.localStorage.getItem(Types.TIME_LEAGUE_INDEX_KEY);
        window.localStorage.setItem(Types.TIME_LEAGUE_INDEX_KEY, JSON.stringify(entries));
        try { writeLeague(state); }
        catch (error) {
            try {
                if (previousIndex === null) window.localStorage.removeItem(Types.TIME_LEAGUE_INDEX_KEY);
                else window.localStorage.setItem(Types.TIME_LEAGUE_INDEX_KEY, previousIndex);
            } catch { /* The saved game itself is still intact. */ }
            throw error;
        }
    }
    function removeLeagueRecord(leagueId) {
        try { window.localStorage.removeItem(Types.timeLeagueStorageKey(leagueId)); } catch { /* nothing to clean up */ }
    }
    const indexEntryOf = (state) => ({
        leagueId: state.leagueId, name: state.name, phase: state.phase,
        teamCount: state.teams.length, currentWeek: state.currentWeek, createdAt: state.createdAt,
        weekStage: state.weekStage, teamName: state.teams.find(team => team.manager === 'human')?.name,
        draftPickCount: state.draftPicks.length, draftTotalPicks: state.teams.length * Engine.rosterCapacity(state.settings),
        completedWeeks: state.finalizedWeeks.length, totalWeeks: Engine.seasonEndWeek(state),
    });
    function readUiPrefs() {
        try {
            const raw = JSON.parse(window.localStorage.getItem(UI_PREFS_KEY) ?? 'null');
            const tab = TAB_IDS.includes(String(raw?.tab)) ? raw.tab : 'home';
            return {
                leagueId: typeof raw?.leagueId === 'string' ? raw.leagueId : null, tab,
                teamId: typeof raw?.teamId === 'string' ? raw.teamId : '',
                onlineRowId: typeof raw?.onlineRowId === 'string' ? raw.onlineRowId : null,
            };
        } catch { return { leagueId: null, tab: 'home', teamId: '', onlineRowId: null }; }
    }
    function writeUiPrefs(prefs) {
        try { window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs)); } catch { /* convenience only */ }
    }

    // ── bundled dataset caches (module scope so remounts reuse the heavy parse) ──
    // Cache each archive separately so a failed download can be retried without
    // downloading the successful half again. Legacy saves retain their original
    // source rows; the full archive is used by versioned game decks.
    const archiveRequests = new Map();
    function fetchArchive(file, read) {
        if (!archiveRequests.has(file)) archiveRequests.set(file,
            fetch(`${window.location?.pathname?.includes('/dist-preview/') ? '../' : ''}data/time-league/${file}`).then(response => response.ok ? read(response) : null)
                .catch(() => null).then(value => {
                    if (!value?.size) archiveRequests.delete(file);
                    return value;
                }));
        return archiveRequests.get(file);
    }
    const fetchLogIndex = (version = 1) => fetchArchive(
        version === 1 ? 'regular-season-game-logs.csv' : 'nflverse-game-logs.csv',
        async response => {
            const { logs } = Season.parseGameLogCsv(await response.text());
            if (!logs.length) return null;
            const index = Season.buildGameLogIndex(logs);
            index.dataset = version === 1 ? 'full-regular-season-v1' : 'legacy-week-calendar';
            return index;
        });
    const fetchEraFactors = (version = 1) => fetchArchive(
        version === 1 ? 'regular-season-era-factors.json' : 'era-factors.json',
        async response => {
            const payload = await response.json();
            if (!payload?.factors) return null;
            const factors = new Map(Object.entries(payload.factors).flatMap(([key, value]) =>
                (typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [])));
            factors.dataset = version === 1 ? 'full-regular-season-v1' : 'legacy-week-calendar';
            return factors;
        });
    let cardsPromise = null;
    const fetchCards = () => {
        const read = async response => PlayerCards.buildPlayerCardIndex(await response.json());
        cardsPromise ??= Promise.all([
            fetchArchive('player-cards.json', read),
            fetchArchive('legacy-player-cards.json', read),
        ]).then(([full, legacy]) => {
            if (!full?.size || !legacy?.size) return new Map();
            full.legacyCards = legacy;
            for (const [identity, card] of full) {
                if (legacy.has(identity)) Object.defineProperty(card, 'legacyCard', { value: legacy.get(identity) });
            }
            return full;
        })
            .then(result => { if (!result?.size) cardsPromise = null; return result || new Map(); });
        return cardsPromise;
    };

    // ── shared bits ──
    function EraChipRail({ label, chips }) {
        return h('div', { className: 'tl-rail' },
            h('span', { className: 'tl-label' }, label),
            chips.map((chip, position) => h('span', { key: `${chip}:${position}`, className: `tl-pill${position === 0 ? ' gold' : ''}` }, chip)));
    }
    window.TimeLeagueEraChipRail = EraChipRail;
    window.TimeLeagueUtils = {
        REGULAR_SEASON_WEEKS, MAX_QUARTERBACKS, TAB_LABELS, PERSONA_IDS, defaultSeats,
        indexEntryOf, readLeague, writeLeague, removeLeagueRecord,
    };

    function TimeLeagueStyles() {
        return h('style', null, `
            .tl-root .tabular { font-variant-numeric: tabular-nums; }
            .tl-root { min-height: 100vh; background:
                radial-gradient(circle at 80% 2%, rgba(212,175,55,.10), transparent 28rem),
                linear-gradient(180deg, rgba(255,255,255,.012), transparent 22rem); }
            .tl-lobby-wrap { max-width: 1220px; margin: 0 auto; padding: 0 20px 84px; }
            .tl-main-inner { max-width: 1180px; margin: 0 auto; }

            /* ── Player-first Vault lobby ── */
            .tl-vault-lobby { display: flex; flex-direction: column; gap: 28px; }
            .tl-vault-lobby button:focus-visible, .tl-vault-lobby a:focus-visible, .tl-helmet-workshop button:focus-visible { outline: 3px solid #83dcca; outline-offset: 4px; }
            .tl-builder-section { scroll-margin-top: 24px; }
            .tl-flow-steps a { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); text-decoration: none; font: 10px var(--font-mono); }
            .tl-demo-player { margin-top: 12px; font: 700 16px/1.1 var(--font-title); color: #fff; text-align: left; }
            button.tl-mystery-card { cursor: pointer; text-align: left; transition: transform .25s ease, border-color .25s ease; }
            button.tl-mystery-card:hover, button.tl-mystery-card:focus-visible { z-index: 5; transform: translateY(-12px) rotate(0deg); }
            .tl-lobby-visual.revealed .tl-mystery-card::after { content: '✦'; color: var(--card-color); font-size: 35px; }
            .tl-lobby-visual.revealed .tl-mystery-card { border-color: var(--card-color); }
            .tl-helmet-controls-grid > .tl-helmet-control:only-child { grid-column: 1 / -1; }
            @media (prefers-reduced-motion: reduce) { button.tl-mystery-card { transition: none; } }
            .tl-lobby-hero { position: relative; min-height: 360px; overflow: hidden; display: grid; grid-template-columns: 1.08fr .92fr; border: 1px solid rgba(212,175,55,.28); border-radius: 22px; background:
                linear-gradient(112deg, rgba(10,10,14,.98) 0%, rgba(19,18,22,.96) 54%, rgba(28,23,13,.92) 100%); box-shadow: 0 24px 80px rgba(0,0,0,.32); }
            .tl-lobby-hero::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .22; background-image: repeating-linear-gradient(90deg, transparent 0, transparent 79px, rgba(255,255,255,.035) 80px); }
            .tl-lobby-hero::after { content: 'V'; position: absolute; right: -28px; bottom: -160px; font-family: Georgia, serif; font-size: 490px; line-height: 1; font-weight: 700; color: rgba(212,175,55,.035); pointer-events: none; }
            .tl-lobby-copy { position: relative; z-index: 2; padding: 50px 24px 44px 48px; align-self: center; }
            .tl-hero-kicker, .tl-eyebrow { display: block; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .18em; color: var(--gold); text-transform: uppercase; }
            .tl-hero-kicker span { display: inline-grid; place-items: center; width: 21px; height: 21px; margin-right: 7px; color: var(--page-bg); background: var(--gold); border-radius: 50%; }
            .tl-lobby-copy h1 { margin: 17px 0 16px; font-family: var(--font-title); font-size: clamp(42px, 5.2vw, 67px); line-height: .94; letter-spacing: -.04em; color: var(--white); }
            .tl-lobby-copy h1 em { color: var(--gold); font-style: normal; }
            .tl-lobby-copy > p { max-width: 570px; margin: 0; font-size: 15px; line-height: 1.65; color: var(--text-secondary); }
            .tl-hero-proof { display: flex; gap: 0; margin-top: 27px; }
            .tl-hero-proof > span { padding: 0 20px; border-right: 1px solid rgba(255,255,255,.10); font-family: var(--font-mono); font-size: 10px; letter-spacing: .04em; color: var(--text-muted); text-transform: uppercase; }
            .tl-hero-proof > span:first-child { padding-left: 0; }
            .tl-hero-proof > span:last-child { border-right: 0; }
            .tl-hero-proof b { margin-right: 4px; font-family: var(--font-title); font-size: 20px; color: var(--white); }
            .tl-lobby-visual { position: relative; min-height: 360px; overflow: hidden; }
            .tl-lobby-visual::before { content: ''; position: absolute; inset: 39px 26px 0 18px; border: 1px solid rgba(255,255,255,.07); border-bottom: 0; border-radius: 180px 180px 0 0; background: linear-gradient(180deg, rgba(212,175,55,.08), rgba(8,8,11,.72) 68%); }
            .tl-stadium-glow { position: absolute; width: 410px; height: 210px; right: -50px; top: -70px; border-radius: 50%; background: rgba(212,175,55,.16); filter: blur(70px); }
            .tl-visual-score { position: absolute; z-index: 2; top: 38px; right: 34px; width: 215px; padding: 12px 15px; border: 1px solid rgba(255,255,255,.11); border-radius: var(--card-radius-lg, 14px); background: rgba(6,6,9,.82); box-shadow: 0 18px 50px rgba(0,0,0,.4); transform: rotate(1.5deg); }
            .tl-visual-score .live { display: block; margin-bottom: 8px; font-family: var(--font-mono); font-size: 8.5px; letter-spacing: .12em; color: var(--gold); }
            .tl-visual-score > div { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; border-top: 1px solid rgba(255,255,255,.06); }
            .tl-visual-score b { font-family: var(--font-mono); font-size: 9.5px; color: var(--text-secondary); }
            .tl-visual-score strong { font-family: var(--font-title); font-size: 17px; }
            .tl-card-fan { position: absolute; z-index: 3; width: 330px; height: 210px; left: 34px; bottom: 42px; }
            .tl-mystery-card { --card-color: #d4af37; position: absolute; width: 132px; height: 175px; padding: 14px; border-radius: var(--card-radius-lg, 14px); border: 1px solid color-mix(in srgb, var(--card-color) 55%, transparent); background:
                radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--card-color) 25%, transparent), transparent 52%),
                linear-gradient(155deg, #25242a, #0c0c10 72%); box-shadow: 0 17px 42px rgba(0,0,0,.48); display: flex; flex-direction: column; }
            .tl-mystery-card::after { content: '?'; margin: auto; font-family: Georgia, serif; font-size: 58px; line-height: 1; color: color-mix(in srgb, var(--card-color) 52%, transparent); }
            .tl-mystery-card > span { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: var(--card-color); color: #0b0b0e; font-family: var(--font-mono); font-size: 9px; font-weight: 800; }
            .tl-mystery-card > b { position: absolute; top: 15px; right: 14px; font-family: var(--font-title); font-size: 18px; color: var(--white); }
            .tl-mystery-card > small { font-family: var(--font-mono); font-size: 7.5px; letter-spacing: .12em; color: var(--text-muted); text-align: center; }
            .tl-mystery-card.card-1 { --card-color: #5daDE2; left: 0; bottom: 0; transform: rotate(-13deg); }
            .tl-mystery-card.card-2 { --card-color: #d4af37; left: 95px; bottom: 10px; transform: rotate(-1deg); z-index: 2; }
            .tl-mystery-card.card-3 { --card-color: #e05a4e; left: 190px; bottom: 0; transform: rotate(12deg); }
            .tl-era-track { position: absolute; z-index: 4; left: 24px; right: 24px; bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
            .tl-era-track::before { content: ''; position: absolute; left: 10px; right: 10px; top: 4px; height: 1px; background: linear-gradient(90deg, rgba(176,141,87,.5), rgba(58,166,166,.7), rgba(212,175,55,.7)); }
            .tl-era-track span { position: relative; padding-top: 10px; font-family: var(--font-mono); font-size: 7.5px; color: var(--text-muted); }
            .tl-era-track span::before { content: ''; position: absolute; top: 1px; left: 50%; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%; background: var(--gold); }

            .tl-section-heading, .tl-builder-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
            .tl-section-heading h2, .tl-builder h2, .tl-invite-lockup h2 { margin: 4px 0 0; font-family: var(--font-title); font-size: 25px; letter-spacing: -.02em; }
            .tl-section-heading > small { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; }
            .tl-season-list { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-top: 12px; }
            .tl-season-card { display: flex; align-items: center; gap: 13px; min-width: 0; padding: 14px; border: 1px solid rgba(255,255,255,.08); border-radius: var(--card-radius-lg, 14px); background: rgba(13,13,17,.82); }
            .tl-season-mark { width: 42px; height: 42px; flex: none; display: grid; place-items: center; border: 1px solid rgba(212,175,55,.35); border-radius: var(--card-radius-lg, 14px); background: rgba(212,175,55,.10); font-family: Georgia, serif; font-weight: 700; color: var(--gold); }
            .tl-season-mark.friends { color: var(--info); border-color: rgba(93,173,226,.35); background: rgba(93,173,226,.10); }
            .tl-season-copy { min-width: 0; flex: 1; }
            .tl-season-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-title); font-size: 15px; font-weight: 700; }
            .tl-season-meta { display: flex; align-items: center; gap: 8px; margin-top: 5px; font-family: var(--font-mono); font-size: 8.5px; letter-spacing: .06em; color: var(--text-muted); }
            .tl-season-actions { display: flex; align-items: center; gap: 6px; flex: none; }

            .tl-builder { overflow: hidden; border: 1px solid rgba(255,255,255,.09); border-radius: 18px; background: rgba(12,12,16,.94); box-shadow: 0 22px 70px rgba(0,0,0,.20); }
            .tl-builder-head { padding: 25px 28px 20px; border-bottom: 1px solid rgba(255,255,255,.06); background: linear-gradient(90deg, rgba(212,175,55,.08), transparent 52%); }
            .tl-flow-steps { display: flex; align-items: center; gap: 20px; }
            .tl-flow-steps span { position: relative; display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 8px; letter-spacing: .1em; color: var(--text-muted); }
            .tl-flow-steps span:not(:last-child)::after { content: ''; position: absolute; left: calc(100% + 5px); width: 10px; height: 1px; background: rgba(212,175,55,.35); }
            .tl-flow-steps b { width: 20px; height: 20px; display: grid; place-items: center; border: 1px solid rgba(212,175,55,.5); border-radius: 50%; color: var(--gold); }
            .tl-builder-section { display: grid; grid-template-columns: 260px minmax(0,1fr); gap: 28px; padding: 26px 28px; border-bottom: 1px solid rgba(255,255,255,.06); }
            .tl-question { display: flex; align-items: flex-start; gap: 12px; }
            .tl-question > span { width: 25px; height: 25px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--gold); color: #0c0c0e; font-family: var(--font-mono); font-size: 10px; font-weight: 900; }
            .tl-question h3 { margin: 0 0 5px; font-family: var(--font-title); font-size: 17px; line-height: 1.15; }
            .tl-question p { margin: 0; font-size: 11.5px; line-height: 1.45; color: var(--text-muted); }
            .tl-play-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .tl-play-mode { position: relative; display: grid; grid-template-columns: 44px minmax(0,1fr) 16px; align-items: center; gap: 12px; min-height: 112px; padding: 15px; border: 1px solid rgba(255,255,255,.09); border-radius: var(--card-radius-lg, 14px); background: rgba(255,255,255,.018); color: var(--text-secondary); cursor: pointer; text-align: left; transition: border-color .18s ease, background .18s ease, transform .18s ease; }
            .tl-play-mode:hover { transform: translateY(-1px); border-color: rgba(212,175,55,.4); }
            .tl-play-mode.selected { border-color: var(--gold); background: linear-gradient(135deg, rgba(212,175,55,.13), rgba(212,175,55,.025)); box-shadow: inset 0 0 0 1px rgba(212,175,55,.09); }
            .tl-play-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: var(--card-radius-lg, 14px); background: rgba(212,175,55,.13); color: var(--gold); font-size: 18px; }
            .tl-play-topline { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
            .tl-play-copy { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
            .tl-play-copy strong { font-family: var(--font-title); font-size: 15px; color: var(--white); }
            .tl-play-copy > span:not(.tl-play-topline) { font-size: 11.5px; line-height: 1.35; }
            .tl-play-copy small { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-muted); text-transform: uppercase; }
            .tl-play-topline em { padding: 2px 5px; border-radius: var(--card-radius-xs, 5px); background: rgba(46,204,113,.13); font-family: var(--font-mono); font-size: 7px; font-style: normal; letter-spacing: .08em; color: var(--good); }
            .tl-radio-dot { width: 14px; height: 14px; border: 1px solid rgba(255,255,255,.24); border-radius: 50%; }
            .tl-play-mode.selected .tl-radio-dot { border: 4px solid var(--gold); background: #111; }
            .tl-signin-callout { grid-column: 2; display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 10px; margin-top: -14px; padding: 11px 13px; border: 1px solid rgba(93,173,226,.22); border-radius: var(--card-radius, 10px); background: rgba(93,173,226,.07); }
            .tl-signin-callout > span { color: var(--info); text-align: center; }
            .tl-signin-callout p { margin: 0; font-size: 11px; line-height: 1.4; color: var(--text-secondary); }
            .tl-signin-callout b { color: var(--white); }
            .tl-era-mode-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 9px; }
            .tl-era-mode { position: relative; min-height: 155px; overflow: hidden; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 15px; border: 1px solid rgba(255,255,255,.09); border-radius: var(--card-radius-lg, 14px); background: rgba(255,255,255,.018); color: var(--text-secondary); cursor: pointer; text-align: left; transition: border-color .18s ease, transform .18s ease; }
            .tl-era-mode::after { content: ''; position: absolute; width: 120px; height: 120px; right: -48px; bottom: -60px; border-radius: 50%; background: var(--mode-color, var(--gold)); opacity: .08; filter: blur(4px); }
            .tl-era-mode:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--mode-color, var(--gold)) 60%, transparent); }
            .tl-era-mode.selected { border-color: var(--mode-color, var(--gold)); background: color-mix(in srgb, var(--mode-color, var(--gold)) 9%, transparent); }
            .tl-era-mode.classic { --mode-color: #5dade2; }
            .tl-era-mode.decades { --mode-color: #3aa6a6; }
            .tl-era-mode.roulette { --mode-color: #d4af37; }
            .tl-era-icon { width: 33px; height: 33px; flex: none; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--mode-color, var(--gold)) 55%, transparent); border-radius: var(--card-radius, 10px); background: color-mix(in srgb, var(--mode-color, var(--gold)) 12%, transparent); font-family: Georgia, serif; font-size: 17px; color: var(--mode-color, var(--gold)); }
            .tl-era-icon.classic { --mode-color: #5dade2; }
            .tl-era-icon.decades { --mode-color: #3aa6a6; }
            .tl-era-icon.roulette { --mode-color: #d4af37; }
            .tl-era-copy { display: flex; flex-direction: column; gap: 4px; }
            .tl-era-copy small { font-family: var(--font-mono); font-size: 7.5px; letter-spacing: .1em; color: var(--mode-color, var(--gold)); }
            .tl-era-copy strong { font-family: var(--font-title); font-size: 14px; color: var(--white); }
            .tl-era-copy > span { font-size: 10.5px; line-height: 1.4; color: var(--text-muted); }
            .tl-mode-badge { position: absolute; top: 12px; right: 10px; padding: 3px 5px; border-radius: var(--card-radius-xs, 5px); background: var(--gold); color: #0a0a0c; font-family: var(--font-mono); font-size: 6.5px; font-weight: 900; letter-spacing: .06em; }
            .tl-decade-picker { grid-column: 2; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: -14px; padding: 11px 13px; border: 1px solid rgba(255,255,255,.07); border-radius: var(--card-radius, 10px); background: rgba(255,255,255,.015); }
            .tl-decade-picker > div:first-child { display: flex; flex-direction: column; gap: 2px; }
            .tl-decade-picker b { font-size: 11px; }
            .tl-decade-picker small { font-family: var(--font-mono); font-size: 8px; color: var(--text-muted); text-transform: uppercase; }
            .tl-decade-row { display: flex; gap: 5px; flex-wrap: wrap; }
            .tl-decade-row button { padding: 5px 8px; border: 1px solid rgba(255,255,255,.10); border-radius: var(--card-radius-sm, 8px); background: rgba(255,255,255,.025); color: var(--text-muted); font-family: var(--font-mono); font-size: 9px; cursor: pointer; }
            .tl-decade-row button.selected { border-color: var(--gold); background: rgba(212,175,55,.12); color: var(--gold); }
            .tl-identity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .tl-identity-grid > label { display: flex; flex-direction: column; gap: 6px; }
            .tl-identity-grid .tl-input { min-height: 43px; font-size: 14px; }
            .tl-team-input { display: grid; grid-template-columns: 42px 1fr; align-items: center; gap: 7px; }
            .tl-team-input .tl-helmet-picker > button { width: 42px; height: 43px; }
            .tl-rival-preview { grid-column: 2; display: grid; grid-template-columns: minmax(145px,1fr) auto auto; align-items: center; gap: 13px; padding: 13px 14px; border: 1px solid rgba(255,255,255,.07); border-radius: var(--card-radius-lg, 14px); background: rgba(255,255,255,.018); }
            .tl-rival-preview > div:first-child { display: flex; flex-direction: column; gap: 4px; }
            .tl-rival-preview > div:first-child b { font-size: 11.5px; }
            .tl-rival-stack { display: flex; align-items: center; padding-left: 8px; }
            .tl-rival-stack > span { display: inline-flex; margin-left: -8px; filter: drop-shadow(0 2px 4px rgba(0,0,0,.45)); }
            .tl-team-count { display: flex; align-items: center; gap: 8px; }
            .tl-team-count button { width: 25px; height: 25px; padding: 0; border: 1px solid rgba(255,255,255,.12); border-radius: var(--card-radius-sm, 8px); background: rgba(255,255,255,.03); color: var(--white); cursor: pointer; }
            .tl-team-count button:disabled { opacity: .3; cursor: default; }
            .tl-team-count strong { min-width: 17px; text-align: center; font-family: var(--font-title); color: var(--gold); }
            .tl-advanced { border-bottom: 1px solid rgba(255,255,255,.06); }
            .tl-advanced > summary { display: flex; align-items: center; justify-content: space-between; padding: 17px 28px; color: var(--text-secondary); cursor: pointer; list-style: none; }
            .tl-advanced > summary::-webkit-details-marker { display: none; }
            .tl-advanced > summary span { font-family: var(--font-title); font-size: 13px; font-weight: 700; }
            .tl-advanced > summary small { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-muted); }
            .tl-advanced[open] > summary { color: var(--gold); background: rgba(212,175,55,.04); }
            .tl-advanced-body { padding: 22px 28px 26px; border-top: 1px solid rgba(255,255,255,.06); }
            .tl-persona-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; margin-top: 10px; }
            .tl-persona-card { padding: 11px; border: 1px solid rgba(255,255,255,.07); border-radius: var(--card-radius, 10px); background: rgba(255,255,255,.016); }
            .tl-persona-card > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-bottom: 8px; }
            .tl-persona-card strong { font-size: 11px; }
            .tl-persona-card p { margin: 7px 0 0; font-size: 9.5px; line-height: 1.4; color: var(--text-muted); }
            .tl-persona-meter { display: grid; grid-template-columns: 52px 1fr 22px; align-items: center; gap: 6px; margin: 5px 0; }
            .tl-persona-meter .track { height: 3px; overflow: hidden; border-radius: 100px; background: rgba(255,255,255,.08); }
            .tl-persona-meter .track > span { display: block; height: 100%; background: var(--gold); }
            .tl-persona-meter > .tabular { font-family: var(--font-mono); font-size: 8px; color: var(--text-muted); text-align: right; }
            .tl-rules-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
            .tl-rules-grid small { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-muted); }
            .tl-toggle-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; margin-top: 5px; }
            .tl-toggle-grid .tl-toggle { padding: 11px; border: 1px solid rgba(255,255,255,.07); border-radius: var(--card-radius, 10px); }
            .tl-toggle-grid .tl-toggle span { display: flex; flex-direction: column; gap: 3px; }
            .tl-toggle-grid b { font-size: 10.5px; }
            .tl-toggle-grid small { font-size: 9.5px; color: var(--text-muted); }
            .tl-waiver-options { display: flex; align-items: center; gap: 6px; margin: 8px 0 0 30px; }
            .tl-waiver-options button { padding: 5px 8px; border: 1px solid rgba(255,255,255,.10); border-radius: var(--card-radius-sm, 8px); background: transparent; color: var(--text-muted); font-family: var(--font-mono); font-size: 8px; cursor: pointer; }
            .tl-waiver-options button.selected { border-color: var(--gold); color: var(--gold); background: rgba(212,175,55,.08); }
            .tl-waiver-options label { display: flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 8px; color: var(--text-muted); }
            .tl-waiver-options .tl-input { width: 68px; padding: 4px 6px; }
            .tl-create-error { margin: 14px 28px 0; }
            .tl-launch-bar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 19px 28px; background: linear-gradient(90deg, rgba(212,175,55,.10), rgba(212,175,55,.02)); }
            .tl-launch-bar > div { display: flex; align-items: center; gap: 11px; }
            .tl-launch-bar p { display: flex; flex-direction: column; gap: 3px; margin: 0; }
            .tl-launch-bar p b { font-family: var(--font-title); font-size: 12.5px; }
            .tl-launch-bar p span { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-muted); text-transform: uppercase; }
            .tl-launch-btn { min-height: 42px; justify-content: center; padding: 11px 20px; box-shadow: 0 9px 26px rgba(212,175,55,.14); }
            .tl-invite-screen { padding: 32px; }
            .tl-invite-lockup { display: flex; align-items: center; gap: 14px; }
            .tl-invite-lockup > span { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; background: rgba(46,204,113,.15); color: var(--good); font-size: 20px; }
            .tl-invite-screen > p { max-width: 680px; color: var(--text-secondary); }
            .tl-invite-list { margin: 22px 0; }
            .tl-invite-row { display: grid; grid-template-columns: 34px 130px minmax(180px,1fr) auto; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
            .tl-invite-number { font-family: var(--font-title); color: var(--gold); }
            .tl-invite-row > div { display: flex; flex-direction: column; }
            .tl-invite-row b { font-size: 10px; }
            .tl-invite-row small { font-family: var(--font-mono); font-size: 8px; color: var(--text-muted); }

            @media (max-width: 900px) {
                .tl-lobby-hero { grid-template-columns: 1fr; }
                .tl-lobby-copy { padding: 42px 34px 26px; }
                .tl-lobby-visual { min-height: 285px; }
                .tl-card-fan { left: 50%; transform: translateX(-50%); }
                .tl-season-list { grid-template-columns: 1fr; }
                .tl-builder-section { grid-template-columns: 1fr; gap: 17px; }
                .tl-signin-callout, .tl-decade-picker, .tl-rival-preview { grid-column: 1; }
                .tl-persona-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
            }
            @media (max-width: 640px) {
                .tl-lobby-wrap { padding: 0 12px 68px; }
                .tl-lobby-hero { min-height: 0; border-radius: 16px; }
                .tl-lobby-copy { padding: 34px 22px 22px; }
                .tl-lobby-copy h1 { font-size: 43px; }
                .tl-lobby-copy > p { font-size: 13px; }
                .tl-hero-proof > span { padding: 0 10px; font-size: 8px; }
                .tl-hero-proof b { font-size: 16px; }
                .tl-lobby-visual { min-height: 250px; }
                .tl-card-fan { bottom: 30px; transform: translateX(-50%) scale(.83); transform-origin: bottom center; }
                .tl-visual-score { top: 18px; right: 14px; transform: scale(.88) rotate(1.5deg); transform-origin: top right; }
                .tl-builder-head { align-items: flex-start; padding: 21px 18px 17px; }
                .tl-flow-steps { gap: 10px; }
                .tl-flow-steps span, .tl-flow-steps a { font-size: 0; }
                .tl-flow-steps a b { font-size: 10px; }
                .tl-flow-steps span:not(:last-child)::after { display: none; }
                .tl-builder-section { padding: 22px 18px; }
                .tl-play-grid, .tl-identity-grid, .tl-rules-grid, .tl-toggle-grid { grid-template-columns: 1fr; }
                .tl-era-mode-grid { grid-template-columns: 1fr; }
                .tl-era-mode { min-height: 0; display: grid; grid-template-columns: 38px minmax(0,1fr); align-items: center; }
                .tl-decade-picker { flex-direction: column; align-items: flex-start; }
                .tl-rival-preview { grid-template-columns: 1fr auto; }
                .tl-rival-stack { grid-row: 2; }
                .tl-team-count { grid-column: 2; grid-row: 1 / span 2; }
                .tl-advanced > summary { padding: 16px 18px; }
                .tl-advanced > summary small { display: none; }
                .tl-advanced-body { padding: 20px 18px; }
                .tl-persona-grid { grid-template-columns: 1fr; }
                .tl-launch-bar { align-items: stretch; flex-direction: column; padding: 17px 18px; }
                .tl-launch-btn { width: 100%; }
                .tl-season-card { align-items: flex-start; flex-wrap: wrap; }
                .tl-season-actions { width: 100%; justify-content: flex-end; }
                .tl-invite-row { grid-template-columns: 28px 1fr auto; }
                .tl-invite-row .tl-input { grid-column: 1 / -1; grid-row: 2; }
            }

            /* ── Left sidenav — mirrors js/league-detail.js's wr-sidebar: fixed
               column, gold left-border active state, collapses to a horizontal
               bar below the same 1023px breakpoint that file uses. ── */
            .tl-sidenav { position: fixed; left: 0; top: 0; bottom: 0; width: 176px; background: var(--black); border-right: 1px solid rgba(212,175,55,0.2); display: flex; flex-direction: column; padding: 16px 0; z-index: 100; overflow-y: auto; }
            .tl-sidenav-brand { padding: 0 20px 14px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
            .tl-sidenav-brand strong { font-family: var(--font-title); font-weight: 700; font-size: 15px; letter-spacing: .04em; color: var(--gold); }
            .tl-sidenav-lockup { display: flex; align-items: center; gap: 10px; }
            .tl-sidenav-crest, .tl-lobby-crest { width: 31px; height: 36px; flex: none; display: grid; place-items: center; border: 1px solid rgba(212,175,55,.55); border-radius: 8px 8px 12px 12px; background: linear-gradient(145deg, rgba(212,175,55,.2), rgba(212,175,55,.04)); font-family: Georgia, serif; font-weight: 700; color: var(--gold); }
            .tl-sidenav-brand span:last-child { display: flex; flex-direction: column; }
            .tl-sidenav-brand small { margin-top: 2px; font-family: var(--font-mono); font-size: 6.5px; letter-spacing: .1em; color: var(--text-muted); text-transform: uppercase; }
            .tl-sidenav .tl-tabbtn { width: 100%; min-height: 40px; padding: 9px 16px 9px 20px; border: none; border-left: 3px solid transparent; border-bottom: none; background: transparent; display: flex; align-items: center; justify-content: flex-start; text-align: left; color: var(--text-secondary); font-weight: 400; }
            .tl-tab-icon { width: 20px; margin-right: 7px; font-family: Georgia, serif; font-size: 14px; line-height: 1; text-align: center; color: var(--text-muted); }
            .tl-tabbtn.active .tl-tab-icon { color: var(--gold); }
            .tl-sidenav .tl-tabbtn:hover { color: var(--white); background: rgba(255,255,255,0.03); }
            .tl-sidenav .tl-tabbtn.active { background: rgba(212,175,55,0.12); border-left-color: var(--gold); color: var(--gold); font-weight: 700; }
            .tl-main { padding: 28px 20px 80px; }
            @media (min-width: 1024px) { .tl-main { margin-left: 176px; } }
            @media (max-width: 1023px) {
                .tl-sidenav { position: static; width: 100%; height: auto; flex-direction: row; overflow-x: auto; overflow-y: visible; border-right: none; border-bottom: 1px solid rgba(212,175,55,0.2); padding: 0; margin-bottom: 18px; }
                .tl-sidenav-brand { display: none; }
                .tl-sidenav .tl-tabbtn { width: auto; min-height: auto; white-space: nowrap; border-left: none; border-bottom: 2px solid transparent; padding: 12px 16px; }
                .tl-sidenav .tl-tabbtn.active { border-left-color: transparent; border-bottom-color: var(--gold); }
                .tl-main { margin-left: 0; padding-top: 0; }
            }
            .tl-card { background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius, 10px); padding: 14px 16px; }
            .tl-card + .tl-card { margin-top: 14px; }
            .tl-card-title { font-family: var(--font-title); font-weight: 600; font-size: 13.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
            .tl-card-title small { font-family: var(--font-mono); font-weight: 500; font-size: 11px; color: var(--text-muted); text-transform: none; letter-spacing: 0; }
            .tl-label { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
            .tl-pill { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 100px; background: rgba(255,255,255,0.06); color: var(--text-secondary); }
            .tl-pill.gold { background: rgba(212,175,55,0.14); color: var(--gold); }
            .tl-pill.info { background: rgba(93,173,226,0.14); color: var(--info); }
            .tl-pill.warn { background: rgba(240,165,0,0.14); color: var(--warn); }
            .tl-pill.good { background: rgba(46,204,113,0.14); color: var(--good); }
            .tl-pill.bad { background: rgba(231,76,60,0.14); color: var(--bad); }
            .tl-grid-2 { display: grid; grid-template-columns: minmax(0,1.3fr) minmax(0,1fr); gap: 16px; align-items: start; }
            .tl-grid-2 > *, .tl-grid-2 .tl-card, .tl-input { min-width: 0; }
            .tl-grid-2.even { grid-template-columns: repeat(2,minmax(0,1fr)); }
            @media (max-width: 900px) { .tl-grid-2, .tl-grid-2.even { grid-template-columns: minmax(0,1fr); } }
            .tl-btn { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 7px 13px; border-radius: var(--card-radius-sm, 8px); background: rgba(255,255,255,0.04); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
            .tl-btn:hover:not(:disabled) { border-color: rgba(212,175,55,0.4); color: var(--white); }
            .tl-btn:disabled { opacity: .4; cursor: default; }
            .tl-btn.primary { background: var(--gold); color: var(--page-bg); border: none; }
            .tl-btn.primary:hover:not(:disabled) { background: var(--dark-gold); }
            .tl-btn.danger { border-color: rgba(231,76,60,0.4); color: var(--bad); }
            .tl-btn.icon { padding: 6px 8px; }
            .tl-input, .tl-select { font-family: var(--font-body); font-size: 13px; padding: 7px 10px; border-radius: var(--card-radius-sm, 8px); background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); color: var(--white); width: 100%; }
            .tl-input:focus, .tl-select:focus { outline: none; border-color: var(--gold); }
            .tl-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
            .tl-field:last-child { margin-bottom: 0; }
            .tl-hint { font-size: 11.5px; color: var(--text-muted); margin: 0; }
            .tl-chip-row { display: flex; flex-wrap: wrap; gap: 7px; }
            .tl-opt-chip { font-size: 12px; padding: 6px 12px; border-radius: var(--card-radius-sm, 8px); border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.02); color: var(--text-secondary); cursor: pointer; text-align: left; }
            .tl-opt-chip.selected { border-color: var(--gold); background: rgba(212,175,55,0.1); color: var(--gold); font-weight: 600; }
            .tl-opt-detail { display: block; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint, rgba(189,184,173,0.5)); margin-top: 2px; }
            .tl-seat-row { display: grid; grid-template-columns: 28px 36px 1fr 90px 130px 28px; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .tl-seat-row:last-child { border-bottom: none; }
            .tl-helmet { display: block; overflow: visible; }
            .tl-helmet-picker { position: relative; display: inline-flex; }
            .tl-helmet-trigger { position: relative; width: 50px; height: 44px; display: grid; place-items: center; overflow: visible; padding: 1px; border: 1px solid rgba(212,175,55,.25); border-radius: var(--card-radius, 10px); background: radial-gradient(circle at 50% 25%, rgba(212,175,55,.11), rgba(255,255,255,.025)); color: var(--white); cursor: pointer; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
            .tl-helmet-trigger::after { content: '✎'; position: absolute; right: -4px; bottom: -4px; width: 14px; height: 14px; display: grid; place-items: center; border: 2px solid #0d0d12; border-radius: 50%; background: var(--gold); color: #09090b; font-size: 8px; font-weight: 900; }
            .tl-helmet-trigger:hover { transform: translateY(-1px); border-color: var(--gold); background: rgba(212,175,55,.1); }
            .tl-team-input .tl-helmet-trigger { width: 42px; height: 43px; }
            .tl-team-input .tl-helmet-trigger .tl-helmet { width: 41px; height: auto; }
            .tl-seat-row .tl-helmet-trigger { width: 36px; height: 34px; }
            .tl-seat-row .tl-helmet-trigger .tl-helmet { width: 37px; height: auto; }

            .tl-helmet-workshop-backdrop { position: fixed; inset: 0; z-index: 100000; display: grid; place-items: center; padding: 18px; background: rgba(3,3,6,.82); backdrop-filter: blur(10px); }
            .tl-helmet-workshop { width: min(720px, calc(100vw - 28px)); max-height: min(850px, calc(100vh - 28px)); overflow: hidden; display: flex; flex-direction: column; border: 1px solid rgba(212,175,55,.35); border-radius: 18px; background: #0d0d12; box-shadow: 0 35px 120px rgba(0,0,0,.78), 0 0 0 1px rgba(255,255,255,.03) inset; }
            .tl-helmet-workshop-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 22px; border-bottom: 1px solid rgba(255,255,255,.07); background: linear-gradient(100deg, rgba(212,175,55,.11), transparent 60%); }
            .tl-helmet-workshop-head h2 { margin: 4px 0 0; font-family: var(--font-title); font-size: 24px; letter-spacing: -.02em; }
            .tl-helmet-close { width: 34px; height: 34px; border: 1px solid rgba(255,255,255,.11); border-radius: 50%; background: rgba(255,255,255,.025); color: var(--text-secondary); font-size: 23px; line-height: 1; cursor: pointer; }
            .tl-helmet-close:hover { border-color: var(--gold); color: var(--white); }
            .tl-helmet-workshop-body { min-height: 0; overflow-y: auto; padding: 20px 22px 24px; scrollbar-color: rgba(212,175,55,.45) transparent; }
            .tl-helmet-big-preview { position: relative; min-height: 280px; overflow: hidden; display: grid; grid-template-columns: 1fr 280px; align-items: center; padding: 24px 28px; border: 1px solid rgba(212,175,55,.22); border-radius: 15px; background:
                linear-gradient(90deg, transparent 49.7%, rgba(255,255,255,.055) 50%, transparent 50.3%),
                repeating-linear-gradient(0deg, transparent 0, transparent 39px, rgba(255,255,255,.03) 40px),
                radial-gradient(circle at 78% 36%, rgba(212,175,55,.18), transparent 42%), #11140f; }
            .tl-helmet-big-preview::before, .tl-helmet-big-preview::after { content: ''; position: absolute; top: 50%; width: 54px; height: 106px; margin-top: -53px; border: 2px solid rgba(255,255,255,.055); }
            .tl-helmet-big-preview::before { left: -28px; border-radius: 0 55px 55px 0; }
            .tl-helmet-big-preview::after { right: -28px; border-radius: 55px 0 0 55px; }
            .tl-helmet-big-preview > .tl-helmet { position: relative; z-index: 2; width: 260px; height: auto; justify-self: end; filter: drop-shadow(0 22px 18px rgba(0,0,0,.58)); }
            .tl-helmet-preview-copy { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
            .tl-helmet-preview-copy span { font-family: var(--font-mono); font-size: 8.5px; letter-spacing: .16em; color: var(--gold); }
            .tl-helmet-preview-copy strong { max-width: 250px; margin: 7px 0 6px; font-family: var(--font-title); font-size: 27px; line-height: 1; color: var(--white); }
            .tl-helmet-preview-copy small { font-family: var(--font-mono); font-size: 8px; color: var(--text-muted); text-transform: uppercase; }

            .tl-helmet-control { margin-top: 20px; }
            .tl-helmet-control-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
            .tl-helmet-control-head strong { font-family: var(--font-title); font-size: 13px; color: var(--white); }
            .tl-helmet-control-head span { font-family: var(--font-mono); font-size: 8px; letter-spacing: .08em; color: var(--text-muted); text-transform: uppercase; }
            .tl-helmet-preset-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
            .tl-helmet-preset { min-width: 0; display: grid; grid-template-columns: 75px minmax(0,1fr); align-items: center; gap: 4px; padding: 8px 10px; border: 1px solid rgba(255,255,255,.08); border-radius: var(--card-radius, 10px); background: linear-gradient(145deg, rgba(255,255,255,.025), rgba(255,255,255,.008)); color: var(--text-secondary); cursor: pointer; text-align: left; }
            .tl-helmet-preset:hover { border-color: rgba(212,175,55,.48); background: rgba(212,175,55,.06); }
            .tl-helmet-preset .tl-helmet { width: 70px; height: auto; filter: drop-shadow(0 7px 7px rgba(0,0,0,.5)); }
            .tl-helmet-preset > span { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
            .tl-helmet-preset b { overflow: hidden; font-family: var(--font-title); font-size: 11px; color: var(--white); text-overflow: ellipsis; white-space: nowrap; }
            .tl-helmet-preset small { font-family: var(--font-mono); font-size: 7.5px; color: var(--gold); text-transform: uppercase; }
            .tl-helmet-controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
            .tl-helmet-choice-grid { display: grid; gap: 6px; }
            .tl-helmet-choice-grid.three { grid-template-columns: repeat(3,minmax(0,1fr)); }
            .tl-helmet-choice-grid.two { grid-template-columns: repeat(2,minmax(0,1fr)); }
            .tl-helmet-choice { min-width: 0; min-height: 49px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; padding: 8px 9px; border: 1px solid rgba(255,255,255,.08); border-radius: var(--card-radius-sm, 8px); background: rgba(255,255,255,.018); color: var(--text-secondary); cursor: pointer; text-align: left; }
            .tl-helmet-choice:hover { border-color: rgba(212,175,55,.38); }
            .tl-helmet-choice.selected { border-color: var(--gold); background: rgba(212,175,55,.1); color: var(--white); box-shadow: inset 0 0 0 1px rgba(212,175,55,.07); }
            .tl-helmet-choice b { margin-bottom: 2px; font-family: var(--font-title); font-size: 16px; color: var(--gold); }
            .tl-helmet-choice span { overflow: hidden; width: 100%; font-family: var(--font-title); font-size: 10.5px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
            .tl-helmet-choice small { font-family: var(--font-mono); font-size: 7px; color: var(--text-muted); text-transform: uppercase; }
            .tl-helmet-color-row { display: flex; flex-wrap: wrap; gap: 7px; }
            .tl-helmet-color { --swatch: #fff; position: relative; width: 30px; height: 30px; padding: 0; border: 2px solid #0d0d12; border-radius: 50%; background: var(--swatch); box-shadow: 0 0 0 1px rgba(255,255,255,.14); cursor: pointer; }
            .tl-helmet-color::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; border-top: 1px solid rgba(255,255,255,.42); }
            .tl-helmet-color:hover { transform: translateY(-1px); box-shadow: 0 0 0 2px rgba(212,175,55,.35); }
            .tl-helmet-color.selected { box-shadow: 0 0 0 2px var(--gold); }
            .tl-helmet-workshop-actions { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 22px; border-top: 1px solid rgba(255,255,255,.07); background: #101015; }
            .tl-helmet-workshop-actions .tl-btn { min-height: 38px; padding: 9px 16px; }
            @media (max-width: 640px) {
                .tl-helmet-workshop-backdrop { padding: 6px; align-items: end; }
                .tl-helmet-workshop { width: 100%; max-height: calc(100vh - 12px); border-radius: 16px 16px 10px 10px; }
                .tl-helmet-workshop-head { padding: 15px 16px; }
                .tl-helmet-workshop-head h2 { font-size: 20px; }
                .tl-helmet-workshop-body { padding: 14px 16px 20px; }
                .tl-helmet-big-preview { min-height: 220px; grid-template-columns: minmax(0,1fr) 180px; padding: 14px; }
                .tl-helmet-big-preview > .tl-helmet { width: 180px; }
                .tl-helmet-preview-copy strong { font-size: 20px; }
                .tl-helmet-preview-copy small { max-width: 130px; line-height: 1.45; }
                .tl-helmet-preset-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
                .tl-helmet-preset { grid-template-columns: 60px minmax(0,1fr); padding: 7px; }
                .tl-helmet-preset .tl-helmet { width: 58px; }
                .tl-helmet-controls-grid { grid-template-columns: 1fr; gap: 0; }
                .tl-helmet-workshop-actions { padding: 12px 16px; }
                .tl-helmet-workshop-actions .tl-btn { padding: 8px 11px; font-size: 9px; }
            }
            .tl-toggle { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; cursor: pointer; }
            .tl-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
            .tl-tbl th { text-align: left; font-family: var(--font-mono); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); padding: 6px 8px; border-bottom: 1px solid var(--charcoal); font-weight: 500; }
            .tl-tbl td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
            .tl-tbl tr:last-child td { border-bottom: none; }
            .tl-tbl td.num, .tl-tbl th.num { text-align: right; }
            .tl-tbl tr.selected td { background: rgba(212,175,55,0.06); }
            .tl-tbl tr.clickable { cursor: pointer; }
            .tl-tbl tr.clickable:hover td { background: rgba(255,255,255,0.02); }
            .tl-empty { font-size: 12.5px; color: var(--text-muted); padding: 10px 2px; margin: 0; }
            .tl-feedrow { display: flex; gap: 10px; padding: 8px 2px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; }
            .tl-feedrow:last-child { border-bottom: none; }
            .tl-feedrow time { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); flex: none; padding-top: 1px; white-space: nowrap; }
            .tl-feedrow p { margin: 0; color: var(--text-secondary); }
            .tl-feedrow.caution { background: rgba(240,165,0,0.05); }
            .tl-feedrow.caution time { color: var(--warn); }
            .tl-feedrow.urgent time { color: var(--bad); }
            .tl-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 14px 16px; margin-bottom: 16px; flex-wrap: wrap; }
            .tl-lobby-header { align-items: center; margin: 0 -20px 18px; padding: 18px 20px 12px; }
            .tl-lobby-brand { display: flex; align-items: center; gap: 11px; }
            .tl-lobby-brand > span:last-child { display: flex; flex-direction: column; gap: 1px; }
            .tl-lobby-brand strong { font-family: var(--font-title); font-size: 18px; color: var(--white); }
            .tl-lobby-brand small { font-family: var(--font-mono); font-size: 7.5px; letter-spacing: .11em; color: var(--text-muted); text-transform: uppercase; }
            .tl-header-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
            .tl-header-title strong { font-family: var(--font-title); font-weight: 700; font-size: 22px; letter-spacing: .01em; }
            .tl-header-tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
            .tl-rail { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
            .tl-tabbar { display: flex; gap: 2px; margin-bottom: 18px; border-bottom: 1px solid var(--charcoal); overflow-x: auto; }
            .tl-tabbtn { font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); background: none; border: none; border-bottom: 2px solid transparent; padding: 10px 16px; cursor: pointer; white-space: nowrap; }
            .tl-tabbtn:hover { color: var(--text-secondary); }
            .tl-tabbtn.active { color: var(--gold); border-bottom-color: var(--gold); }
            .tl-pos-badge { font-family: var(--font-mono); font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: var(--card-radius-xs, 5px); }
            .tl-pos-QB { background: rgba(96,165,250,0.16); color: #60a5fa; }
            .tl-pos-RB { background: rgba(46,204,113,0.16); color: var(--good); }
            .tl-pos-WR { background: rgba(212,175,55,0.18); color: var(--gold); }
            .tl-pos-TE { background: rgba(251,191,36,0.16); color: #fbbf24; }
            .tl-pos-K  { background: rgba(168,172,184,0.16); color: #a8acb8; }
            .tl-pos-DEF, .tl-pos-DL, .tl-pos-LB, .tl-pos-DB { background: rgba(248,113,113,0.16); color: #f87171; }

            /* ── Avatars ── */
            .tl-avatar { width: 32px; height: 32px; border-radius: 50%; display: inline-grid; place-items: center; flex: none; font-family: var(--font-title); font-weight: 700; font-size: 12px; color: var(--page-bg, #08080B); }
            .tl-avatar.sm { width: 22px; height: 22px; font-size: 9.5px; }
            .tl-avatar.lg { width: 56px; height: 56px; font-size: 20px; border: 2px solid rgba(255,255,255,0.15); }

            /* ── Player tile — era-coded, replaces table rows in Roster/Waivers ── */
            .tl-tile-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
            @media (max-width: 700px) { .tl-tile-grid { grid-template-columns: 1fr; } }
            .tl-player-tile { display: flex; align-items: center; gap: 12px; background: var(--off-black); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--card-radius, 10px); padding: 10px 12px; position: relative; overflow: hidden; }
            .tl-player-tile::before { content: ''; position: absolute; inset: 0; opacity: .10; background: radial-gradient(circle at 100% 0%, var(--era-color, var(--gold)), transparent 65%); pointer-events: none; }
            .tl-era-badge { width: 40px; height: 40px; border-radius: var(--card-radius, 10px); display: grid; place-items: center; flex: none; font-size: 17px; border: 2px solid var(--era-color, var(--gold)); background: color-mix(in srgb, var(--era-color, var(--gold)) 16%, var(--black)); box-shadow: 0 0 12px -2px var(--era-color, var(--gold)); }
            .tl-player-tile .tl-p-body { flex: 1; min-width: 0; }
            .tl-player-tile .tl-p-name { font-weight: 700; font-size: 13px; }
            .tl-player-tile .tl-p-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
            .tl-player-tile .tl-p-era { font-family: var(--font-mono); font-size: 10px; color: var(--era-color, var(--text-muted)); font-weight: 700; }
            .tl-player-tile .tl-p-pts { font-family: var(--font-title); font-weight: 700; font-size: 19px; color: var(--gold); flex: none; text-align: right; }
            .tl-player-tile .tl-p-pts small { display: block; font-family: var(--font-mono); font-weight: 400; font-size: 9.5px; color: var(--text-muted); }
            .tl-top-pick-badge { font-family: var(--font-mono); font-size: 9px; font-weight: 700; color: var(--gold); background: rgba(212,175,55,0.14); border-radius: var(--card-radius-xs, 5px); padding: 1px 5px; margin-left: 6px; }

            /* ── League Home ── */
            .tl-home-hero { background: linear-gradient(135deg, rgba(212,175,55,0.10), transparent 55%), var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius-lg, 14px); padding: 20px 22px; margin-bottom: 16px; }
            .tl-home-hero-top { display: flex; align-items: center; gap: 16px; }
            .tl-home-hero-top .tl-h-info { flex: 1; }
            .tl-home-hero-top .tl-h-league { font-family: var(--font-title); font-weight: 700; font-size: 20px; }
            .tl-home-hero-top .tl-h-sub { font-size: 12.5px; color: var(--text-secondary); margin-top: 2px; }
            .tl-mini-matchup { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--charcoal); }
            .tl-mini-matchup .tl-mm-side { display: flex; align-items: center; gap: 10px; }
            .tl-mini-matchup .tl-mm-pts { font-family: var(--font-title); font-weight: 700; font-size: 24px; }
            .tl-mini-matchup .tl-mm-vs { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint, rgba(189,184,173,0.5)); text-align: center; }
            .tl-quick-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
            .tl-home-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12.5px; }
            .tl-home-row:last-child { border-bottom: none; }

            /* ── Scoreboard strip + hero matchup (Gameday) ── */
            .tl-scoreboard-strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 16px; }
            .tl-score-chip { flex: none; min-width: 180px; background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius, 10px); padding: 10px 12px; }
            .tl-score-chip.mine { border-color: var(--gold); background: linear-gradient(135deg, rgba(212,175,55,0.08), transparent); }
            .tl-score-chip .tl-sc-tag { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .08em; color: var(--text-muted); display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
            .tl-sc-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--bad); animation: tlPulse 1.4s infinite; }
            .tl-sc-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; gap: 8px; }
            .tl-sc-row .tl-sc-team { display: flex; align-items: center; gap: 6px; font-size: 12px; min-width: 0; }
            .tl-sc-row .tl-sc-team span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tl-sc-row.winning .tl-sc-team { color: var(--white); font-weight: 700; }
            .tl-sc-row:not(.winning) .tl-sc-team { color: var(--text-muted); }
            .tl-sc-row .tl-sc-pts { font-family: var(--font-mono); font-size: 13px; flex: none; }
            @keyframes tlPulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
            .tl-hero-matchup { background: var(--black); border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius-lg, 14px); padding: 20px 24px; margin-bottom: 16px; }
            .tl-hero-top { display: flex; align-items: center; justify-content: center; gap: 24px; }
            .tl-hero-side { text-align: center; flex: 1; min-width: 0; }
            .tl-hero-side .tl-h-name { font-size: 13px; color: var(--text-secondary); margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tl-hero-side .tl-h-name.leading { color: var(--white); font-weight: 700; }
            .tl-hero-side .tl-h-pts { font-family: var(--font-title); font-weight: 700; font-size: 38px; line-height: 1; margin-top: 4px; }
            .tl-hero-side .tl-h-pts.leading { color: var(--gold); }
            .tl-hero-mid { text-align: center; flex: none; width: 80px; }
            .tl-hero-mid .tl-h-vs { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint, rgba(189,184,173,0.5)); letter-spacing: .1em; }
            .tl-hero-mid .tl-h-clock { font-family: var(--font-mono); font-size: 11.5px; color: var(--gold); margin-top: 6px; }
            .tl-score-bar { height: 6px; border-radius: 100px; background: rgba(255,255,255,0.08); overflow: hidden; margin: 18px 0 4px; display: flex; }
            .tl-score-bar .tl-fill { background: var(--gold); }
            .tl-score-bar .tl-fill.against { background: var(--charcoal); }
            .tl-win-prob { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted); margin-bottom: 4px; }

            /* ── Draft: pick clock + queue strip ── */
            .tl-clock-ring { width: 30px; height: 30px; border-radius: 50%; border: 3px solid rgba(212,175,55,0.25); border-top-color: var(--gold); flex: none; animation: tlSpin 3s linear infinite; }
            @keyframes tlSpin { to { transform: rotate(360deg); } }
            .tl-queue-strip { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 4px; }
            .tl-queue-chip { flex: none; display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 100px; padding: 5px 10px 5px 5px; font-size: 11.5px; cursor: pointer; }
            .tl-queue-chip .tl-qnum { width: 16px; height: 16px; border-radius: 50%; background: var(--gold); color: var(--page-bg, #08080B); font-family: var(--font-mono); font-size: 9px; font-weight: 700; display: grid; place-items: center; flex: none; }

            /* ── Trades: fairness scale ── */
            /* ── Trade fairness — mirrors War Room's real trade-engine.js
               fairnessGrade tile (A+ Steal .. F Bad Trade) plus the per-player
               value bar from trade-calculator.html's ta-val-bar-fill, instead
               of the plain +/- swing number this used to show. ── */
            .tl-fairness-grade { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: var(--card-radius, 10px); border: 1px solid rgba(212,175,55,0.25); background: rgba(255,255,255,0.02); margin: 10px 0; }
            .tl-fairness-grade .fg-letter { font-family: var(--font-title); font-weight: 700; font-size: 34px; line-height: 1; flex: none; width: 60px; text-align: center; }
            .tl-fairness-grade .fg-letter.good { color: var(--good); }
            .tl-fairness-grade .fg-letter.gold { color: var(--gold); }
            .tl-fairness-grade .fg-letter.warn { color: var(--warn); }
            .tl-fairness-grade .fg-letter.bad { color: var(--bad); }
            .tl-fairness-grade .fg-label { font-family: var(--font-title); font-weight: 700; font-size: 14px; }
            .tl-fairness-grade .fg-sub { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted); margin-top: 2px; }
            .tl-val-bar { height: 4px; border-radius: 100px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 5px; }
            .tl-val-bar-fill { height: 100%; border-radius: 100px; }

            /* ── Achievements — mirrors War Room's real achievements.js chip-grid
               pattern (js/tabs/trophy-room.js renderAchievementsCard): tier-tinted
               border + full-opacity icon when earned, greyscale + dim + a thin
               progress bar when not, grouped under a tier label. ── */
            .tl-badge-tier-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-muted); margin: 18px 0 8px; }
            .tl-badge-tier-label:first-child { margin-top: 0; }
            .tl-badge-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
            .tl-badge-chip { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--card-radius, 10px); border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
            .tl-badge-chip.earned { border-color: var(--tier-color, var(--gold)); background: color-mix(in srgb, var(--tier-color, var(--gold)) 10%, transparent); }
            .tl-badge-chip .tl-badge-icon { font-size: 21px; flex: none; width: 32px; text-align: center; filter: grayscale(1); opacity: .5; }
            .tl-badge-chip.earned .tl-badge-icon { filter: none; opacity: 1; }
            .tl-badge-chip .tl-badge-body { flex: 1; min-width: 0; }
            .tl-badge-chip .tl-badge-label { font-weight: 700; font-size: 12.5px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
            .tl-badge-chip .tl-badge-desc { font-size: 10.5px; color: var(--text-muted); margin-top: 2px; }
            .tl-badge-chip .tl-badge-progress { height: 3px; border-radius: 100px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 6px; }
            .tl-badge-chip .tl-badge-progress-fill { height: 100%; background: var(--tier-color, var(--gold)); }

            /* ── Standings streaks ── */
            .tl-streak { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: var(--card-radius-xs, 5px); }
            .tl-streak.W { background: rgba(46,204,113,0.14); color: var(--good); }
            .tl-streak.L { background: rgba(231,76,60,0.14); color: var(--bad); }
            .tl-streak.T { background: rgba(255,255,255,0.08); color: var(--text-secondary); }

            /* ── Roster Central — mirrors War Room's real Game Day Central
               (js/tabs/lineup.js): a gold-bordered status hero above a unified
               CSS-grid lineup table, in place of Game Day's Slot/Player/Proj/
               Mtch/Form/Hi/Lo columns (which don't apply to fixed historical
               stat lines — no weekly projection uncertainty to show). ── */
            .tl-lineup-hero { background: var(--black); border: 1px solid rgba(212,175,55,0.35); border-radius: var(--card-radius, 10px); padding: 16px 18px; margin-bottom: 14px; }
            .tl-lineup-hero .lh-kicker { font-family: var(--font-mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--gold); margin-bottom: 6px; }
            .tl-lineup-hero .lh-headline { font-family: var(--font-title); font-weight: 700; font-size: 19px; margin-bottom: 4px; color: var(--white); }
            .tl-lineup-hero .lh-headline.good { color: var(--good); }
            .tl-lineup-hero .lh-headline.warn { color: var(--warn); }
            .tl-lineup-hero .lh-sub { font-size: 12px; color: var(--text-secondary); margin-bottom: 12px; }
            .tl-lineup-table { border: 1px solid rgba(255,255,255,0.08); border-radius: var(--card-radius, 10px); overflow: hidden; margin-bottom: 14px; }
            .tl-lineup-table-title { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); padding: 10px 14px; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.06); }
            .tl-lineup-head { display: grid; padding: 6px 14px; font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid rgba(255,255,255,0.06); }
            .tl-lineup-row { display: grid; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .tl-lineup-row:last-child { border-bottom: none; }
            .tl-lineup-row.open-slot { color: var(--text-faint, rgba(189,184,173,0.5)); font-size: 12px; font-style: italic; }
            .tl-lineup-slot { font-family: var(--font-mono); font-weight: 700; font-size: 11px; color: var(--gold); }
            .tl-lineup-player { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tl-lineup-player .name { font-weight: 600; font-size: 12.5px; }
            .tl-lineup-player .meta { color: var(--text-muted); font-size: 10.5px; margin-left: 6px; font-family: var(--font-mono); }
            .tl-lineup-pts { text-align: right; font-family: var(--font-title); font-weight: 700; font-size: 16px; color: var(--gold); }
            .tl-lineup-pts small { display: block; font-family: var(--font-mono); font-weight: 400; font-size: 8.5px; color: var(--text-muted); letter-spacing: .04em; }

            /* ── Matchup-first Home hub ── */
            .tl-home { display: flex; flex-direction: column; gap: 14px; }
            .tl-home-hero { position: relative; min-height: 278px; overflow: hidden; display: grid; grid-template-columns: .95fr 1.05fr; align-items: center; gap: 20px; padding: 32px 38px; border: 1px solid rgba(212,175,55,.34); border-radius: 17px; background:
                radial-gradient(circle at 82% 22%, rgba(212,175,55,.16), transparent 28%),
                linear-gradient(122deg, #17161a 0%, #0b0b0e 56%, #18150d 100%); box-shadow: 0 21px 60px rgba(0,0,0,.22); }
            .tl-home-hero::before { content: ''; position: absolute; inset: 0; opacity: .11; pointer-events: none; background-image:
                repeating-linear-gradient(90deg, transparent 0, transparent 78px, rgba(255,255,255,.06) 79px, rgba(255,255,255,.06) 80px),
                linear-gradient(0deg, transparent 49.5%, rgba(255,255,255,.16) 50%, transparent 50.5%); }
            .tl-home-hero-copy { position: relative; z-index: 2; }
            .tl-home-hero-copy h1 { margin: 10px 0 10px; font-family: var(--font-title); font-size: clamp(28px, 3.5vw, 43px); line-height: 1.03; letter-spacing: -.035em; color: var(--white); }
            .tl-home-hero-copy > p { max-width: 470px; margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
            .tl-home-hero-actions { display: flex; gap: 8px; margin-top: 20px; }
            .tl-home-hero-actions .tl-btn { min-height: 40px; padding-inline: 16px; }
            .tl-home-matchup { position: relative; z-index: 2; display: grid; grid-template-columns: minmax(0,1fr) 64px minmax(0,1fr); align-items: center; }
            .tl-home-team { min-width: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
            .tl-home-team .tl-helmet { filter: drop-shadow(0 12px 16px rgba(0,0,0,.42)); }
            .tl-home-team > strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 10px; font-family: var(--font-title); font-size: 14px; color: var(--white); }
            .tl-home-team > span { margin-top: 3px; font-family: var(--font-mono); font-size: 8.5px; letter-spacing: .06em; color: var(--text-muted); }
            .tl-home-vs { display: flex; flex-direction: column; align-items: center; gap: 4px; }
            .tl-home-vs span, .tl-home-vs small { font-family: var(--font-mono); font-size: 8px; letter-spacing: .12em; color: var(--text-muted); }
            .tl-home-vs strong { font-family: var(--font-title); font-size: 24px; color: var(--gold); }
            .tl-home-bye { width: 70px; height: 70px; display: grid; place-items: center; border: 1px dashed rgba(255,255,255,.18); border-radius: 50%; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
            .tl-home-yardline { position: absolute; z-index: 1; width: 120px; height: 120px; border: 1px solid rgba(255,255,255,.05); border-radius: 50%; }
            .tl-home-yardline.one { right: 34%; top: -64px; }
            .tl-home-yardline.two { right: 7%; bottom: -78px; width: 170px; height: 170px; }
            .tl-home-hero.champion { grid-template-columns: 1fr 1fr; }
            .tl-home-trophy { min-height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid rgba(212,175,55,.22); border-radius: var(--card-radius-lg, 14px); background: radial-gradient(circle, rgba(212,175,55,.16), transparent 62%); }
            .tl-home-trophy > span { font-size: 54px; line-height: 1; color: var(--gold); }
            .tl-home-trophy strong { margin-top: 9px; font-family: var(--font-title); color: var(--gold); }
            .tl-home-trophy small { margin-top: 3px; color: var(--text-secondary); }
            .tl-home-action-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; }
            .tl-home-action { --action-color: var(--gold); display: grid; grid-template-columns: 38px minmax(0,1fr); gap: 11px; min-height: 123px; padding: 15px; border: 1px solid rgba(255,255,255,.08); border-radius: var(--card-radius-lg, 14px); background: rgba(13,13,17,.88); color: var(--text-secondary); cursor: pointer; text-align: left; transition: transform .16s ease, border-color .16s ease; }
            .tl-home-action:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--action-color) 55%, transparent); }
            .tl-home-action.good { --action-color: var(--good); }
            .tl-home-action.warn { --action-color: var(--warn); }
            .tl-home-action.info { --action-color: var(--info); }
            .tl-home-action.gold { --action-color: var(--gold); }
            .tl-home-action-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: var(--card-radius, 10px); background: color-mix(in srgb, var(--action-color) 13%, transparent); color: var(--action-color); font-family: var(--font-title); font-size: 17px; font-weight: 800; }
            .tl-home-action-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
            .tl-home-action-copy small { font-family: var(--font-mono); font-size: 8px; letter-spacing: .12em; color: var(--action-color); }
            .tl-home-action-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-title); font-size: 13px; color: var(--white); }
            .tl-home-action-copy > span { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: 10.5px; line-height: 1.35; color: var(--text-muted); }
            .tl-home-action-go { grid-column: 2; align-self: end; font-family: var(--font-mono); font-size: 8.5px; font-weight: 700; letter-spacing: .06em; color: var(--action-color); }
            .tl-home-grid { display: grid; grid-template-columns: .92fr 1.08fr; gap: 14px; }
            .tl-home-grid .tl-card { margin-top: 0; }
            .tl-home-standings .tl-card-title button { border: 0; background: transparent; color: var(--gold); font-family: var(--font-mono); font-size: 8px; cursor: pointer; }
            .tl-home-standing-row { display: grid; grid-template-columns: 22px 34px minmax(0,1fr) auto 34px 54px; align-items: center; gap: 8px; min-height: 48px; padding: 5px 7px; border-bottom: 1px solid rgba(255,255,255,.045); }
            .tl-home-standing-row:last-child { border-bottom: 0; }
            .tl-home-standing-row.mine { margin: 0 -5px; padding-inline: 12px; border-radius: var(--card-radius-sm, 8px); background: linear-gradient(90deg, rgba(212,175,55,.12), rgba(212,175,55,.02)); }
            .tl-home-standing-row .rank { font-family: var(--font-title); font-size: 13px; color: var(--text-muted); text-align: center; }
            .tl-home-standing-row.mine .rank { color: var(--gold); }
            .tl-home-standing-row .team { min-width: 0; display: flex; flex-direction: column; }
            .tl-home-standing-row .team b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
            .tl-home-standing-row .team small { margin-top: 2px; font-family: var(--font-mono); font-size: 7px; letter-spacing: .08em; color: var(--text-muted); }
            .tl-home-standing-row .record { font-family: var(--font-title); font-size: 12px; text-align: right; }
            .tl-home-standing-row .points { display: flex; flex-direction: column; font-family: var(--font-title); font-size: 12px; color: var(--gold); text-align: right; }
            .tl-home-standing-row .points small { font-family: var(--font-mono); font-size: 6px; color: var(--text-muted); }
            .tl-home-pulse { padding: 16px 18px; background: linear-gradient(145deg, rgba(22,20,18,.96), rgba(10,10,13,.98)); }
            .tl-pulse-masthead { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 3px double rgba(212,175,55,.42); font-family: Georgia, serif; }
            .tl-pulse-masthead span { font-size: 10px; color: var(--gold); }
            .tl-pulse-masthead strong { font-size: 15px; letter-spacing: .02em; color: #ede6d3; }
            .tl-pulse-masthead small { margin-left: auto; font-family: var(--font-mono); font-size: 7px; color: var(--text-muted); }
            .tl-home-pulse > h2 { margin: 14px 0 6px; font-family: Georgia, serif; font-size: 18px; line-height: 1.12; color: #ede6d3; }
            .tl-home-pulse > p { margin: 0; font-family: Georgia, serif; font-size: 11.5px; line-height: 1.5; color: var(--text-secondary); }
            .tl-pulse-stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 7px; margin-top: 14px; }
            .tl-pulse-stats > span { padding: 8px; border: 1px solid rgba(212,175,55,.16); border-radius: var(--card-radius-sm, 8px); }
            .tl-pulse-stats b { display: block; font-family: Georgia, serif; font-size: 17px; color: var(--gold); }
            .tl-pulse-stats small { display: block; margin-top: 2px; font-family: var(--font-mono); font-size: 6.5px; letter-spacing: .06em; color: var(--text-muted); }
            .tl-pulse-wire { margin-top: 12px; }
            .tl-pulse-wire > div { display: grid; grid-template-columns: 24px 1fr; gap: 7px; padding: 5px 0; border-bottom: 1px dotted rgba(255,255,255,.09); }
            .tl-pulse-wire time { font-family: var(--font-mono); font-size: 8px; color: var(--gold); }
            .tl-pulse-wire p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: Georgia, serif; font-size: 10.5px; color: var(--text-secondary); }
            .tl-home-era-strip { display: grid; grid-template-columns: 190px 1fr auto; align-items: center; gap: 20px; padding: 16px 18px; border: 1px solid rgba(255,255,255,.08); border-radius: var(--card-radius-lg, 14px); background: rgba(13,13,17,.78); }
            .tl-home-era-strip > div:first-child { display: flex; flex-direction: column; gap: 4px; }
            .tl-home-era-strip > div:first-child strong { font-family: var(--font-title); font-size: 11.5px; }
            .tl-home-era-line { position: relative; display: grid; grid-template-columns: repeat(6,1fr); }
            .tl-home-era-line::before { content: ''; position: absolute; left: 8%; right: 8%; top: 6px; height: 1px; background: rgba(255,255,255,.10); }
            .tl-home-era-line > span { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 15px; color: var(--text-muted); }
            .tl-home-era-line > span::before { content: ''; position: absolute; top: 2px; width: 8px; height: 8px; border: 1px solid rgba(255,255,255,.22); border-radius: 50%; background: #111116; }
            .tl-home-era-line > span.live::before { border-color: var(--gold); background: var(--gold); box-shadow: 0 0 0 4px rgba(212,175,55,.08); }
            .tl-home-era-line b { font-family: var(--font-mono); font-size: 8px; }
            .tl-home-era-line small { font-family: var(--font-mono); font-size: 6px; color: var(--text-muted); }

            @media (max-width: 900px) {
                .tl-home-hero { grid-template-columns: 1fr; }
                .tl-home-action-grid { grid-template-columns: 1fr 1fr; }
                .tl-home-action-grid > :last-child { grid-column: 1 / -1; }
                .tl-home-grid { grid-template-columns: 1fr; }
                .tl-home-era-strip { grid-template-columns: 1fr; }
            }
            @media (max-width: 600px) {
                .tl-home-hero { padding: 25px 18px; }
                .tl-home-matchup { margin-top: 9px; }
                .tl-home-action-grid { grid-template-columns: 1fr; }
                .tl-home-action-grid > :last-child { grid-column: auto; }
                .tl-home-action { min-height: 106px; }
                .tl-home-standing-row { grid-template-columns: 18px 32px minmax(0,1fr) 30px 48px; }
                .tl-home-standing-row .tl-streak { display: none; }
                .tl-home-era-line { overflow-x: auto; grid-template-columns: repeat(6,70px); padding-bottom: 4px; }
            }

            /* ── Gazette (Home tab newspaper front page) — dark "midnight edition":
               the rest of the mode stays dark, so this is a front page printed on
               dark stock rather than a light page dropped into a dark app. Serif is
               Georgia/Times — no new font dependency to load. */
            .tl-gazette { --tl-paper: #EDE6D3; }
            .tl-masthead { text-align: center; padding: 4px 0 12px; }
            .tl-masthead .tl-kicker { font-family: var(--font-mono); font-size: 10px; letter-spacing: .25em; color: var(--gold); text-transform: uppercase; }
            .tl-masthead .tl-name { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 38px; letter-spacing: .01em; margin: 4px 0 2px; color: var(--tl-paper); }
            .tl-masthead .tl-name em { font-style: italic; color: var(--gold); }
            .tl-masthead .tl-dateline { display: flex; align-items: center; justify-content: center; gap: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; flex-wrap: wrap; }
            .tl-gazette-rule { height: 3px; background: var(--gold); margin: 8px 0 3px; }
            .tl-gazette-rule.thin { height: 1px; background: rgba(212,175,55,0.35); margin: 3px 0 18px; }
            .tl-gazette-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; }
            @media (max-width: 860px) { .tl-gazette-grid { grid-template-columns: 1fr; } }
            .tl-col-rule { border-right: 1px solid rgba(212,175,55,0.2); padding-right: 24px; }
            @media (max-width: 860px) { .tl-col-rule { border-right: none; padding-right: 0; } }
            .tl-section-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--gold); border-bottom: 1px solid rgba(212,175,55,0.3); padding-bottom: 4px; margin-bottom: 10px; }
            .tl-gaz-headline { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 24px; line-height: 1.15; color: var(--tl-paper); margin-bottom: 8px; }
            .tl-gaz-byline { font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 12px; }
            .tl-gaz-lede { font-family: Georgia, 'Times New Roman', serif; font-size: 14.5px; line-height: 1.55; color: var(--text-secondary); margin-bottom: 6px; }
            .tl-gaz-lede.drop::first-letter { font-size: 38px; font-weight: 700; float: left; line-height: .82; padding: 2px 5px 0 0; color: var(--gold); }
            .tl-boxscore { border: 1px solid rgba(212,175,55,0.3); margin-top: 14px; }
            .tl-boxscore-head { background: rgba(212,175,55,0.1); padding: 7px 12px; font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 12.5px; color: var(--tl-paper); border-bottom: 1px solid rgba(212,175,55,0.3); }
            .tl-boxscore-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: var(--font-mono); font-size: 12px; }
            .tl-boxscore-row:last-child { border-bottom: none; }
            .tl-boxscore-row.winner { color: var(--gold); font-weight: 700; }
            .tl-wire-item { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .tl-wire-item:last-child { border-bottom: none; }
            .tl-wire-item b { color: var(--tl-paper); }
            .tl-kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 18px; }
            .tl-gazette-kpi { border: 1px solid rgba(212,175,55,0.18); border-radius: var(--card-radius-xs, 5px); padding: 9px 11px; }
            .tl-gazette-kpi .k-label { font-family: var(--font-mono); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; }
            .tl-gazette-kpi .k-value { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: 21px; color: var(--gold); line-height: 1; }
            .tl-gazette-kpi .k-sub { font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); margin-top: 3px; }
            .tl-brief { padding: 7px 0; border-bottom: 1px dotted rgba(255,255,255,0.1); font-size: 12px; color: var(--text-secondary); }
            .tl-brief:last-child { border-bottom: none; }
            .tl-brief b { font-family: Georgia, 'Times New Roman', serif; color: var(--tl-paper); }
            .tl-issue-bar { display: flex; align-items: center; gap: 0; margin-top: 24px; padding-top: 12px; border-top: 3px double rgba(212,175,55,0.4); flex-wrap: wrap; }
            .tl-issue-bar button { font-family: var(--font-mono); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--tl-paper); background: none; border: none; border-right: 1px solid rgba(212,175,55,0.25); padding: 6px 14px; cursor: pointer; }
            .tl-issue-bar button:first-child { padding-left: 0; }
            .tl-issue-bar button:last-child { border-right: none; }
            .tl-issue-bar button:hover { color: var(--gold); }
            .tl-issue-bar button.primary { color: var(--gold); font-weight: 700; }
        `);
    }

    function LobbyExtras({ children }) {
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : false;
        return h('details', { className: 'tl-card tl-lobby-extras', open: !phone }, h('summary', null, 'My profile, career & community'), children);
    }

    function MobileGameNav({ tabs, activeTab, onNavigate, unread = 0, onReportBug }) {
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : true;
        const [expanded, setExpanded] = useState(false);
        const dialogRef = React.useRef(null);
        const triggerRef = React.useRef(null);
        const navRef = React.useRef(null);
        useEffect(() => {
            const nav = navRef.current;
            const root = nav?.closest('.tl-root');
            if (!root) return undefined;
            const property = '--tl-mobile-nav-space';
            const previous = root.style.getPropertyValue(property);
            let alive = true;
            const measure = () => {
                if (!alive) return;
                const height = Math.ceil(nav.getBoundingClientRect().height);
                if (height > 0) root.style.setProperty(property, `${height}px`);
                else root.style.removeProperty(property);
            };
            const observer = window.ResizeObserver ? new window.ResizeObserver(measure) : null;
            observer?.observe(nav);
            window.addEventListener?.('resize', measure);
            window.document?.fonts?.ready?.then(measure);
            measure();
            return () => {
                alive = false;
                observer?.disconnect();
                window.removeEventListener?.('resize', measure);
                if (previous) root.style.setProperty(property, previous);
                else root.style.removeProperty(property);
            };
        }, []);
        const close = () => { setExpanded(false); triggerRef.current?.focus?.({ preventScroll: true }); };
        useEffect(() => {
            const dialog = dialogRef.current;
            if (expanded && dialog && !dialog.open) dialog.showModal?.();
            if (!expanded && dialog?.open) dialog.close?.();
            if (!expanded || !document.body) return undefined;
            const overflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = overflow; };
        }, [expanded]);
        useEffect(() => { if (!phone && expanded) close(); }, [phone, expanded]);
        const primary = tabs.includes('home') ? ['home', 'roster', 'gameday', 'waivers'] : ['draft', 'activity'];
        const extra = tabs.filter(tab => !primary.includes(tab));
        const labels = { home: 'Home', roster: 'My team', gameday: 'Game day', waivers: 'Players', stats: 'Player stats', draft: tabs.includes('home') ? 'Draft recap' : 'Draft', activity: 'Activity', trades: 'Trades', achievements: 'Trophies', standings: 'Command Central', messages: 'Messages', career: 'My career', community: 'Community' };
        const choose = tab => { close(); onNavigate(tab); };
        return h(React.Fragment, null,
            h('dialog', { ref: dialogRef, className: 'tl-mobile-more', id: 'vault-more-navigation', 'aria-label': 'More Vault views', onCancel: event => { event.preventDefault(); close(); }, onClose: close },
                h('div', { className: 'tl-card-title' }, 'More ways to play', h('button', { className: 'tl-btn icon', 'aria-label': 'Close more navigation', autoFocus: true, onClick: close }, '×')),
                h('div', null, extra.map(tab => h('button', { key: tab, onClick: () => choose(tab), 'aria-current': activeTab === tab ? 'page' : undefined }, h('span', { 'aria-hidden': 'true' }, TAB_ICONS[tab]), labels[tab], tab === 'messages' && unread > 0 ? h('em', { className: 'tl-mail-badge' }, unread) : null)),
                    onReportBug && h('button', { type: 'button', onClick: () => { close(); onReportBug(); } }, h('span', { 'aria-hidden': true }, '⚑'), 'Report a bug'))),
            h('nav', { ref: navRef, className: 'tl-mobile-nav', 'aria-label': 'Vault game navigation' },
                primary.map(tab => h('button', { key: tab, className: activeTab === tab ? 'active' : '', 'aria-current': activeTab === tab ? 'page' : undefined, onClick: () => choose(tab) },
                    h('span', { 'aria-hidden': 'true' }, TAB_ICONS[tab]), h('b', null, labels[tab]))),
                extra.length > 0 && h('button', { ref: triggerRef, 'aria-haspopup': 'dialog', className: expanded || extra.includes(activeTab) ? 'active' : '', 'aria-expanded': expanded, 'aria-controls': 'vault-more-navigation', onClick: () => setExpanded(value => !value) }, h('span', { 'aria-hidden': 'true' }, '•••'), h('b', null, 'More'), unread > 0 ? h('em', { className: 'tl-mail-badge', 'aria-label': `${unread} unread messages` }, unread) : null)));
    }

    function FriendsRoom({ league, meta, saving, onAction, onClose }) {
        const [copied, setCopied] = useState('');
        const [notice, setNotice] = useState('');
        const [manualLink, setManualLink] = useState('');
        const [teamName, setTeamName] = useState('');
        const members = meta.members || [];
        const mine = league.teams.find(t => t.teamId === meta.seatTeamId);
        const host = meta.role === 'commissioner';
        const openSeats = members.filter(member => !member.joined);
        const joined = members.filter(member => member.joined);
        const allJoined = members.length > 0 && !openSeats.length;
        const invitesOpen = !meta.draftStarted && league.phase === 'draft';
        const linkFor = code => {
            const publicPage = 'https://c2-football.github.io/WarRoom/index.html';
            const page = new URL(window.location.href || `${window.location.origin}${window.location.pathname}`, publicPage);
            const local = /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(page.hostname);
            const link = new URL(/^https?:$/.test(page.protocol) && !local ? page.href : publicPage);
            link.search = ''; link.hash = '';
            link.searchParams.set('vault', '1');
            link.searchParams.set('tl_invite', code);
            return link.href;
        };
        const canInvite = member => host && invitesOpen && !member.joined && Boolean(member.invite_code);
        const copyInvite = async member => {
            if (!canInvite(member)) return;
            setNotice('');
            try {
                await navigator.clipboard.writeText(linkFor(member.invite_code));
                setCopied(member.id); setManualLink(''); setNotice('Invite copied. Send it to the friend taking this team.');
            } catch { setManualLink(member.id); setNotice('Select the link below and copy it to share.'); }
        };
        const shareInvite = async member => {
            if (!canInvite(member)) return;
            if (!navigator.share) return copyInvite(member);
            const team = league.teams.find(item => item.teamId === member.seat_team_id);
            setNotice('');
            try { await navigator.share({ title: `Join ${league.name}`, text: `Take ${team?.name || 'an open team'} in my Vault league.`, url: linkFor(member.invite_code) }); }
            catch (error) { if (error?.name !== 'AbortError') await copyInvite(member); }
        };
        const seatName = member => league.teams.find(team => team.teamId === member.seat_team_id)?.name || member.seat_team_id;
        return h('section', { id: 'vault-friends-room', tabIndex: -1, className: 'tl-card tl-friends-room', 'aria-label': host ? 'Invite friends' : 'League managers' },
            h('div', { className: 'tl-card-title' },
                h('span', null, host && invitesOpen ? 'Invite friends' : 'League managers'),
                h('small', null, `${joined.length}/${members.length} joined`),
                meta.draftStarted && onClose && h('button', { type: 'button', className: 'tl-btn icon', onClick: onClose, 'aria-label': 'Close league managers' }, '×')),
            h('p', { className: 'tl-invite-intro' }, !invitesOpen ? 'The draft has started and this league’s seats are locked.'
                : allJoined ? 'Everyone is here. Your league is ready to open the draft room.'
                    : host ? 'Send a different seat link to each friend. They can sign in, create a free account, or join as a guest. Wait until every friend appears below before opening the draft.' : 'Your commissioner can share invitations for the open seats below.'),
            openSeats.length > 0 && h('div', { className: 'tl-open-seats' }, openSeats.map(member => {
                const team = league.teams.find(item => item.teamId === member.seat_team_id);
                return h('article', { key: member.id, className: 'tl-open-seat', 'aria-label': `Open seat: ${seatName(member)}` },
                    h('div', { className: 'tl-open-seat-team' },
                        h(window.TimeLeagueHelmetIcon, { helmet: team?.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(seatName(member)), size: 36 }),
                        h('div', null, h('strong', null, seatName(member)), h('small', null, 'Waiting for a friend'))),
                    canInvite(member) && h('div', { className: 'tl-invite-actions' },
                        typeof navigator.share === 'function' && h('button', { type: 'button', className: 'tl-btn primary', 'aria-label': `Share invite for ${seatName(member)}`, onClick: () => shareInvite(member) }, 'Share invite'),
                        h('button', { type: 'button', className: 'tl-btn', 'aria-label': `Copy invite for ${seatName(member)}`, onClick: () => copyInvite(member) }, copied === member.id ? 'Copied' : 'Copy invite')),
                    canInvite(member) && h('details', { className: 'tl-seat-invite-link', open: manualLink === member.id || undefined },
                        h('summary', null, 'Show invite link'),
                        h('input', { className: 'tl-input', readOnly: true, 'aria-label': `Invite link for ${seatName(member)}`, value: linkFor(member.invite_code), onFocus: event => event.target.select() })),
                    host && invitesOpen && !member.invite_code && h('p', { className: 'tl-hint', role: 'status' }, 'Waiting for this seat’s invite link. Reconnecting will refresh it.'));
            })),
            notice && h('p', { className: 'tl-invite-notice', role: 'status' }, notice),
            joined.length > 0 && h('details', { className: 'tl-joined-managers' },
                h('summary', null, `${joined.length} ${joined.length === 1 ? 'manager has' : 'managers have'} joined`),
                joined.map(member => h('div', { key: member.id, className: 'tl-joined-manager' }, h('strong', null, seatName(member)),
                    h('small', null, [member.displayName, member.role === 'commissioner' ? 'Commissioner' : member.guest ? 'Guest · Joined' : 'Joined', member.ready_week === league.currentWeek ? 'Ready' : 'Not ready'].filter(Boolean).join(' · '))))),
            invitesOpen && host && h('button', { type: 'button', className: 'tl-btn primary tl-open-draft', disabled: saving || !allJoined, onClick: () => onAction({ type: 'start' }) }, 'Open draft room'),
            invitesOpen && !host && h('p', { className: 'tl-hint' }, 'The commissioner will open the draft once everyone has joined.'),
            h('details', { className: 'tl-friends-team-editor' },
                h('summary', null, `Your team · ${mine?.name || meta.seatTeamId}`),
                h(window.TimeLeagueHelmetPicker, { helmet: mine?.helmet, name: mine?.name, letter: window.App.TimeLeagueHelmet.monogramFor(mine?.name || ''), onChange: helmet => onAction({ type: 'team', teamId: meta.seatTeamId, name: mine.name, helmet }) }),
                h('div', { className: 'tl-friends-team-name' },
                    h('input', { className: 'tl-input', 'aria-label': 'Your team name', placeholder: mine?.name, maxLength: 60, value: teamName, onChange: event => setTeamName(event.target.value) }),
                    h('button', { type: 'button', className: 'tl-btn', disabled: saving || !teamName.trim(), onClick: async () => { if (await onAction({ type: 'team', teamId: meta.seatTeamId, name: teamName })) setTeamName(''); } }, 'Save team name'))));
    }

    // ── shell ──
    function TimeLeagueMode({ onClose, pendingInvite, onInviteConsumed }) {
        const [index, setIndex] = useState([]);
        const [league, setLeague] = useState(null);
        const leagueRef = useRef(null);
        leagueRef.current = league;
        const [autoPlayWeek, setAutoPlayWeek] = useState(null);
        const [draftModuleState, setDraftModuleState] = useState('idle');
        const [tab, setTab] = useState('home');
        const navigateTab = useCallback(nextTab => {
            setTab(nextTab === 'standings' ? 'home' : nextTab);
            window.requestAnimationFrame(() => document.querySelector('.tl-root')?.scrollIntoView({ block: 'start', behavior: 'auto' }));
        }, []);
        // Automatic handoffs (including the final saved pick) set the tab
        // directly. Give them the same entry position as an explicit nav click.
        useEffect(() => {
            if (!league) return;
            window.requestAnimationFrame?.(() => window.document?.querySelector('.tl-root')?.scrollIntoView?.({ block: 'start', behavior: 'auto' }));
        }, [league?.leagueId, tab]);
        const [activeTeamId, setActiveTeamId] = useState('');
        const [cards, setCards] = useState(null);
        const [loadedLogIndex, setLogIndex] = useState(null);
        const [logsMissing, setLogsMissing] = useState(false);
        const [loadedEraFactors, setEraFactors] = useState(null);
        const [booted, setBooted] = useState(false);
        const bootArchiveVersion = useMemo(() => {
            const savedId = readUiPrefs().leagueId;
            const saved = savedId ? readLeague(savedId) : null;
            return saved ? (saved.settings.gameDeckVersion === 1 ? 1 : 0) : 1;
        }, []);
        const archiveVersion = league ? (league.settings.gameDeckVersion === 1 ? 1 : 0) : bootArchiveVersion;
        const archiveDataset = archiveVersion === 1 ? 'full-regular-season-v1' : 'legacy-week-calendar';
        const logIndex = loadedLogIndex?.dataset && loadedLogIndex.dataset !== archiveDataset ? null : loadedLogIndex;
        const eraFactors = loadedEraFactors?.dataset && loadedEraFactors.dataset !== archiveDataset ? null : loadedEraFactors;

        // Online bookkeeping deliberately lives OUTSIDE `league` — Engine.normalizeTimeLeague()
        // rebuilds `league` from an explicit key allowlist on every handleUpdate, so anything
        // attached to the league object itself would be silently stripped on the very next update.
        const [onlineMeta, setOnlineMeta] = useState(null); // null = local league, else {rowId, version, role}
        const [onlineIndex, setOnlineIndex] = useState([]);
        const [onlineIndexState, setOnlineIndexState] = useState('idle'); // idle | signed-out | ready
        const [conflictNotice, setConflictNotice] = useState(null);
        const [claimingInvite, setClaimingInvite] = useState(false);
        const [inviteError, setInviteError] = useState(null);
        const [saving, setSaving] = useState(false);
        const [showFriends, setShowFriends] = useState(false);
        const openFriends = useCallback(() => {
            setShowFriends(true);
            window.requestAnimationFrame(() => {
                const room = document.getElementById('vault-friends-room');
                room?.scrollIntoView({ block: 'start', behavior: 'auto' });
                room?.focus({ preventScroll: true });
            });
        }, []);
        const [connectionError, setConnectionError] = useState(null);
        const [lastSyncedAt, setLastSyncedAt] = useState(0);
        const [reconnecting, setReconnecting] = useState(false);
        const [showCareer, setShowCareer] = useState(false);
        const [showCommunity, setShowCommunity] = useState(false);
        const [draftReveal, setDraftReveal] = useState({ leagueId: null, ready: false });
        const [waiverBrowse, setWaiverBrowse] = useState({ leagueId: null, teamId: null, week: null, slot: null, replacementEntryId: null, requestId: 0 });
        const [storageError, setStorageError] = useState(null);
        const [saveConflict, setSaveConflict] = useState(false);
        const saveRecoveryRef = useRef(null);
        const gameplayRef = useRef(null);
        useEffect(() => {
            if (!storageError) return;
            // Native modal dialogs occupy the top layer even when their parent
            // is hidden. Release that layer before presenting save recovery.
            gameplayRef.current?.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
            saveRecoveryRef.current?.focus({ preventScroll: false });
        }, [storageError]);
        // Keep the durable snapshot paired with the local view. Reading the
        // newest disk value just before saving would accept a stale tab's move.
        const localSnapshot = useRef({ leagueId: null, raw: null });
        const [dataAttempt, setDataAttempt] = useState(0);
        const [dataLoading, setDataLoading] = useState(true);
        const [eraFactorsMissing, setEraFactorsMissing] = useState(false);
        const [gamecastStatus, setGamecastStatus] = useState(null);
        const [scoreRequest, setScoreRequest] = useState(null);
        const [mailReads, setMailReads] = useState({});
        const [mailThread, setMailThread] = useState(null);
        const [, refreshMail] = useState(0);
        const [authRequired, setAuthRequired] = useState(false);
        const [, refreshGuest] = useState(0);
        const [inviteAttempt, setInviteAttempt] = useState(0);
        const actor = gameActor();
        const actorKey = `${actor?.kind || ''}:${actor?.userId || ''}:${actor?.token || ''}`;
        const GuestPanel = window.App.GameGuestPanel;
        const inviteSignInHref = signInHref + (pendingInvite ? '&tl_invite=' + encodeURIComponent(pendingInvite) : '');
        useEffect(() => window.App.GameGuest?.subscribe(() => refreshGuest(value => value + 1)), []);
        const reportRemoteError = useCallback(error => {
            if (error.authRequired) setAuthRequired(true);
            if (onlineRef.current) setConnectionError(error.message || error.error);
        }, []);
        const presentedMail = window.TimeLeagueMail?.presentation(league);
        useEffect(() => {
            if (!presentedMail?.nextAt) return undefined;
            const timer = window.setTimeout(() => refreshMail(value => value + 1), Math.max(0, presentedMail.nextAt - Date.now()));
            return () => window.clearTimeout(timer);
        }, [league?.leagueId, presentedMail?.nextAt]);
        const onMailRead = useCallback((key, ids) => setMailReads(previous => ({ ...previous, [key]: ids })), []);
        useEffect(() => {
            const refresh = event => {
                if (event.key && !event.key.startsWith('tl-rival-read:')) return;
                setMailReads({});
            };
            window.addEventListener?.('storage', refresh);
            return () => window.removeEventListener?.('storage', refresh);
        }, []);
        const gamecastRef = useRef(null);
        gamecastRef.current = gamecastStatus;
        const gateBusy = useRef(false);
        const reportPlayback = useCallback(value => {
            const previous = gamecastRef.current;
            gamecastRef.current = value;
            setGamecastStatus(value);
            if (value) setAutoPlayWeek(week => week === value.week ? null : week);
            if (value?.done && !value.replay && value.leagueId === leagueRef.current?.leagueId
                && (!previous?.done || previous.week !== value.week || previous.leagueId !== value.leagueId)) navigateTab('home');
        }, [navigateTab]);
        const pendingLocalSave = useRef(null);
        const pendingSaveTime = useRef(null);
        const previousLocalSave = useRef(null);
        const draftRevealed = league?.settings.eraRules?.mode !== 'position-roulette' || league?.seasonsRevealed || (draftReveal.leagueId === league?.leagueId && draftReveal.ready);
        const revealRef = useRef(false);
        revealRef.current = Boolean(draftRevealed);
        const draftActionBusy = useRef(false);
        const draftRetryAt = useRef(0);
        const onDraftRevealReady = useCallback(ready => {
            setDraftReveal(previous => previous.leagueId === league?.leagueId && previous.ready === ready ? previous : { leagueId: league?.leagueId, ready });
        }, [league?.leagueId]);
        const onlineRef = useRef(null);
        const writeBusy = useRef(false);
        const openGeneration = useRef(0);
        const acceptRow = useCallback((row, opening = false) => {
            if (!opening && (!onlineRef.current || onlineRef.current.rowId !== row.id || row.version < onlineRef.current.version)) return;
            const safe = Engine.normalizePublicTimeLeague(row.state);
            if (!safe) {
                setConnectionError('This league needs the latest secure draft view. Refresh the app and try again.');
                return;
            }
            if (opening) { setAutoPlayWeek(null); setGamecastStatus(null); setScoreRequest(null); setShowFriends(false); }
            if (!opening && leagueRef.current?.leagueId === safe.leagueId && safe.finalizedWeeks.length > leagueRef.current.finalizedWeeks.length) {
                setAutoPlayWeek(safe.finalizedWeeks[safe.finalizedWeeks.length - 1]?.week);
            }
            if (!opening && leagueRef.current?.leagueId === safe.leagueId && leagueRef.current.phase === 'draft' && safe.phase !== 'draft') {
                setTab(current => current === 'draft' ? 'home' : current);
            }
            const meta = { rowId: row.id, userId: gameActor()?.userId, version: row.version, role: row.role || onlineRef.current?.role,
                seatTeamId: row.seatTeamId || onlineRef.current?.seatTeamId,
                members: row.members || onlineRef.current?.members || [], draftStarted: row.draft_started };
            onlineRef.current = meta;
            leagueRef.current = safe;
            window.App.TimeLeagueCareerStore?.remember(safe, meta);
            setOnlineMeta(meta);
            setLeague(safe);
            setActiveTeamId(meta.seatTeamId);
            setConnectionError(null);
            setLastSyncedAt(Date.now());
            setAuthRequired(false);
        }, []);

        const reconnectRoom = async () => {
            const meta = onlineRef.current;
            if (!meta || reconnecting || authRequired) return;
            setReconnecting(true);
            try { acceptRow(await Remote.loadOnlineLeague(meta.rowId)); }
            catch (error) { if (onlineRef.current?.rowId === meta.rowId) reportRemoteError(error); }
            finally { setReconnecting(false); }
        };

        const refreshOnlineIndex = useCallback(() => {
            if (!Remote) return;
            if (!gameActor()?.userId) {
                setOnlineIndex([]); setOnlineIndexState('signed-out'); return;
            }
            Remote.listMyOnlineLeagues().then((rows) => { setOnlineIndex(rows); setOnlineIndexState('ready'); }).catch(error => { setOnlineIndexState('error'); setInviteError(error.message); reportRemoteError(error); });
        }, [actorKey]);

        useEffect(() => {
            setIndex(readIndexEntries());
            refreshOnlineIndex();
            if (onlineRef.current && onlineRef.current.userId !== actor?.userId) {
                ++openGeneration.current;
                onlineRef.current = null; setOnlineMeta(null); setLeague(null); setAuthRequired(false);
            }
            // Entry is a deliberate menu choice. Merely viewing it must not
            // open a room, run a draft timer or advance an existing save.
            setBooted(true);
        }, [refreshOnlineIndex]);

        // Account sessions claim their invite here. Guest joining already claims
        // the seat on the server and must never replay an account claim.
        useEffect(() => {
            if (!pendingInvite || !Remote || actor?.kind !== 'account') { setClaimingInvite(false); return; }
            const generation = ++openGeneration.current;
            setClaimingInvite(true);
            setInviteError(null);
            let cancelled = false;
            Remote.claimInvite(pendingInvite).then(async (result) => {
                if (!result.ok) throw Object.assign(new Error(result.error || 'This invite could not be claimed.'), { authRequired: result.authRequired });
                const row = await Remote.loadOnlineLeague(result.rowId);
                if (cancelled || generation !== openGeneration.current) return;
                acceptRow(row, true);
                setTab(row.state.phase === 'draft' ? 'draft' : 'home');
                if (onInviteConsumed) onInviteConsumed();
                refreshOnlineIndex();
            }).catch(error => { if (!cancelled && generation === openGeneration.current) { setInviteError(error.message); reportRemoteError(error); } })
                .finally(() => { if (!cancelled) setClaimingInvite(false); });
            return () => { cancelled = true; };
        }, [pendingInvite, actorKey, inviteAttempt]);

        const joinedAsGuest = () => {
            Remote?.resetAuth?.();
            setInviteError(null); setAuthRequired(false);
            onInviteConsumed?.();
            refreshGuest(value => value + 1);
            const session = window.App.GameGuest?.getSession('vault');
            if (session?.roomId) openOnlineLeague(session.roomId);
        };

        useEffect(() => {
            let cancelled = false;
            setDataLoading(true);
            Promise.all([fetchLogIndex(archiveVersion), fetchEraFactors(archiveVersion), fetchCards()]).then(([logs, factors, playerCards]) => {
                if (cancelled) return;
                setLogIndex(logs); setLogsMissing(!logs?.size);
                setEraFactors(factors); setEraFactorsMissing(!factors?.size);
                setCards(playerCards); setDataLoading(false);
            });
            return () => { cancelled = true; };
        }, [dataAttempt, archiveVersion]);

        useEffect(() => {
            const retry = () => setDataAttempt(attempt => attempt + 1);
            window.addEventListener?.('online', retry);
            return () => window.removeEventListener?.('online', retry);
        }, []);

        useEffect(() => {
            if (!booted || !league) return;
            writeUiPrefs({ leagueId: league?.leagueId ?? null, tab, teamId: activeTeamId, onlineRowId: onlineMeta?.rowId ?? null });
        }, [booted, league, tab, activeTeamId, onlineMeta]);

        // Live sync: another member's write lands here without a refresh. Keyed on the row id
        // (not the whole onlineMeta object, which changes identity on every version bump) so a
        // write from THIS tab doesn't tear down and resubscribe the channel every time.
        useEffect(() => {
            if (!onlineMeta?.rowId || !Remote) return undefined;
            const unsubscribe = Remote.subscribeToLeague(onlineMeta.rowId, row => acceptRow(row), reportRemoteError);
            return unsubscribe;
        }, [onlineMeta?.rowId, actorKey]);

        const persistLeague = useCallback((state, options) => {
            const previous = readIndexEntries();
            const entry = indexEntryOf(state);
            const next = previous.some(item => item.leagueId === state.leagueId)
                ? previous.map(item => item.leagueId === state.leagueId ? entry : item)
                : [...previous, entry];
            const written = writeLeagueSnapshot(state, next, options);
            localSnapshot.current = { leagueId: state.leagueId, raw: written || (Storage ? Storage.encode(state) : JSON.stringify(state)) };
            // Career summaries and React state change only after durable storage.
            try { window.App.TimeLeagueCareerStore?.remember(state, null); } catch { /* Derived career summaries can be rebuilt from the saved game. */ }
            setIndex(next);
        }, []);

        const handleUpdate = useCallback(async (next, action, options = {}) => {
            const meta = onlineRef.current;
            if (meta) {
                if (writeBusy.current || !action || authRequired) return false;
                writeBusy.current = true;
                setSaving(true);
                try {
                    const result = await Remote.writeOnlineLeague(meta.rowId, action, meta.version);
                    if (onlineRef.current?.rowId !== meta.rowId) return false;
                    if (result.authRequired) setAuthRequired(true);
                    if (result.ok) {
                        if (result.row) acceptRow(result.row);
                        else { onlineRef.current = { ...onlineRef.current, version: result.version }; setConnectionError('Move saved; waiting for the updated room.'); }
                        if (!options.background) setConflictNotice(null);
                        return result.row?.state || true;
                    }
                    if (!options.optional && !(options.background && result.conflict)) setConflictNotice(result.conflict ? 'Someone else acted first. Your move was not saved; review the updated room and try again.' : result.error);
                    if (result.authRequired) return false;
                    try { acceptRow(await Remote.loadOnlineLeague(meta.rowId)); } catch (error) { if (!options.optional || error.authRequired) reportRemoteError(error); }
                    return false;
                } catch (error) {
                    if (options.optional) return false;
                    throw error;
                } finally { writeBusy.current = false; setSaving(false); }
            }
            const retryingLocalSave = pendingLocalSave.current === next;
            if (pendingLocalSave.current && !retryingLocalSave) return false;
            const previous = leagueRef.current;
            if (options.base && options.base !== previous) {
                setConflictNotice('The game changed before this move was saved. Review the current state and try again.');
                return false;
            }
            const stamp = new Date().toISOString();
            if (!retryingLocalSave && previous?.phase === 'draft' && next.phase === 'season' && cards) next = window.App.TimeLeagueAI.aiGenerateTrades(next, cards, stamp);
            if (previous && (previous.weekStage !== next.weekStage || previous.phase !== next.phase)) next = { ...next, gateStartedAt: stamp, gateVotes: [] };
            const safe = Engine.normalizeTimeLeague(next);
            if (!safe) return false;
            const expectedSnapshot = localSnapshot.current.leagueId === safe.leagueId ? localSnapshot.current.raw : null;
            const generation = openGeneration.current;
            try {
                const save = () => {
                    if (openGeneration.current !== generation || leagueRef.current !== previous || onlineRef.current) {
                        const error = new Error('The view changed before this move was saved. Review the current game and try again.');
                        error.name = 'VaultViewChangedError';
                        throw error;
                    }
                    persistLeague(safe, { expectedSnapshot });
                    leagueRef.current = safe;
                };
                // Supported browsers serialize cooperating local tabs; the
                // expected snapshot still protects older browsers and retries.
                if (window.document && window.navigator?.locks?.request) await window.navigator.locks.request(`vault-save:${safe.leagueId}`, save);
                else save();
            }
            catch (error) {
                if (error.name === 'VaultViewChangedError') {
                    if (openGeneration.current === generation) setConflictNotice(error.message);
                    return false;
                }
                if (error.name === 'VaultSnapshotConflictError') {
                    pendingLocalSave.current = safe;
                    setSaveConflict(true);
                    setStorageError('This season changed in another tab. This move was not saved. Load the latest save to continue with its progress.');
                    return false;
                }
                if (!previousLocalSave.current && previous) {
                    // Capture the previous seat's clock at the first storage
                    // failure, before a later retry can consume its remaining time.
                    previousLocalSave.current = previous.phase === 'draft' && previous.draftClock?.status === 'running'
                        ? Engine.pauseDraft(previous, stamp) : previous;
                }
                pendingLocalSave.current = safe;
                pendingSaveTime.current = stamp;
                setStorageError('This move could not be saved on this device. Your previous save is intact. Retry, or keep your previous save to go back.');
                return false;
            }
            if (openGeneration.current !== generation || onlineRef.current) return true;
            pendingLocalSave.current = null;
            pendingSaveTime.current = null;
            previousLocalSave.current = null;
            setStorageError(null);
            setSaveConflict(false);
            if (previous?.leagueId === safe.leagueId && safe.finalizedWeeks.length > previous.finalizedWeeks.length) setAutoPlayWeek(safe.finalizedWeeks[safe.finalizedWeeks.length - 1]?.week);
            if (previous?.leagueId === safe.leagueId && previous.phase === 'draft' && safe.phase !== 'draft') {
                setTab(current => current === 'draft' ? 'home' : current);
            }
            leagueRef.current = safe;
            setLeague(safe);
            return true;
        }, [persistLeague, acceptRow, cards, authRequired]);

        // Resume old saves at their current planning gate. This only adds an
        // offer to the inbox; accepting it remains the manager's decision.
        const tradeRefreshKey = useRef(null);
        useEffect(() => {
            if (!league || !cards?.size || saving || storageError || (onlineMeta && authRequired) || !league.seasonsRevealed
                || league.phase !== 'season' || !league.settings.tradesEnabled || !['claims', 'lineup'].includes(league.weekStage)
                || league.planningRecoveryWeek === league.currentWeek) return;
            const current = leagueRef.current;
            if (!current || pendingLocalSave.current || writeBusy.current) return;
            const key = `${onlineMeta?.rowId || current.leagueId}:${current.currentWeek}:${current.weekStage}`;
            if (tradeRefreshKey.current === key) return;
            tradeRefreshKey.current = key;
            if (onlineRef.current) {
                // Public snapshots have neither a seed nor private game decks.
                // Only the authoritative server generates online offers.
                handleUpdate(current, { type: 'refresh-trade-offers' }, { background: true, optional: true });
            } else {
                const next = window.App.TimeLeagueAI.aiGenerateTrades(current, cards, new Date().toISOString(), { humanOnly: true });
                if (next !== current) handleUpdate(next);
            }
        }, [league?.leagueId, league?.currentWeek, league?.weekStage, league?.seasonsRevealed, league?.planningRecoveryWeek, onlineMeta?.rowId, cards, saving, storageError, handleUpdate, authRequired]);

        const loadLatestLocalSave = useCallback(() => {
            const stored = readLeague(leagueRef.current?.leagueId, localSnapshot);
            if (!stored) {
                setStorageError('The latest save is missing or unreadable. This view has been kept without overwriting anything. Restore the save in the other tab, then try again.');
                return false;
            }
            pendingLocalSave.current = null;
            pendingSaveTime.current = null;
            previousLocalSave.current = null;
            leagueRef.current = stored;
            setLeague(stored);
            setIndex(readIndexEntries());
            setAutoPlayWeek(null);
            setGamecastStatus(null);
            setScoreRequest(null);
            setStorageError(null);
            setSaveConflict(false);
            navigateTab(stored.phase === 'draft' ? 'draft' : 'home');
            setConflictNotice('Latest saved progress loaded. Review it before making your next move.');
            return true;
        }, [navigateTab]);

        const retryLocalSave = useCallback(async () => {
            if (saveConflict) return loadLatestLocalSave();
            let pending = pendingLocalSave.current;
            if (!pending) return false;
            // Time spent fixing device storage must not consume the next
            // manager's draft clock before their pick has even appeared.
            if (pending.phase === 'draft' && pending.draftClock?.status === 'running' && pendingSaveTime.current) {
                pending = Engine.resumeDraft(Engine.pauseDraft(pending, pendingSaveTime.current), new Date().toISOString());
                pendingLocalSave.current = pending;
            }
            const previousStage = leagueRef.current?.weekStage;
            const saved = await handleUpdate(pending);
            if (saved && leagueRef.current?.weekStage !== previousStage) {
                if (!onlineRef.current && Engine.planningRecovery(pending).active) {
                    const affected = Engine.planningRecovery(pending).teams;
                    const selected = affected.find(team => team.teamId === activeTeamId) || affected[0];
                    if (selected) setActiveTeamId(selected.teamId);
                }
                navigateTab(gateWorkspace(leagueRef.current));
            }
            return saved;
        }, [activeTeamId, handleUpdate, navigateTab, saveConflict, loadLatestLocalSave]);

        const keepPreviousSave = useCallback(() => {
            if (saveConflict) return loadLatestLocalSave();
            const previous = previousLocalSave.current;
            if (!pendingLocalSave.current || !previous) return false;
            // A running draft must durably return in a paused state. Do not
            // discard its pending move while storage still cannot save that pause.
            if (previous !== leagueRef.current) {
                try { persistLeague(previous, { expectedSnapshot: localSnapshot.current.raw }); }
                catch {
                    setStorageError('The previous draft could not be restored and paused. Your move is still waiting here. Allow site storage or free some space, then try again.');
                    return false;
                }
                leagueRef.current = previous;
                setLeague(previous);
            }
            pendingLocalSave.current = null;
            pendingSaveTime.current = null;
            previousLocalSave.current = null;
            setStorageError(null);
            return true;
        }, [persistLeague, saveConflict, loadLatestLocalSave]);

        const dispatchGate = useCallback(async action => {
            const current = leagueRef.current;
            if (!current || gateBusy.current) return false;
            const cast = gamecastRef.current;
            if (current.weekStage === 'postgame' && cast?.leagueId === current.leagueId && !cast.done && ['advance-week', 'vote-advance', 'timed-advance', 'reveal-years'].includes(action.type)) return false;
            gateBusy.current = true;
            try {
                const own = onlineRef.current?.seatTeamId || current.teams.find(team => team.teamId === activeTeamId && team.manager === 'human')?.teamId || current.teams.find(team => team.manager === 'human')?.teamId;
                const next = onlineRef.current ? current : window.App.TimeLeagueActions.applyOnlineAction(current, action,
                    { role: 'commissioner', seat_team_id: own }, { cards, logIndex, eraFactors }, new Date().toISOString());
                const saved = await handleUpdate(next, action);
                if (saved) {
                    const result = saved && typeof saved === 'object' ? saved : next;
                    if (action.type === 'reopen-planning' && !onlineRef.current) {
                        const affected = Engine.planningRecovery(current).teams;
                        const selected = affected.find(team => team.teamId === action.teamId) || affected.find(team => team.teamId === own) || affected[0];
                        if (selected) setActiveTeamId(selected.teamId);
                    }
                    if (result.weekStage !== current.weekStage) {
                        navigateTab(gateWorkspace(result));
                    }
                }
                return saved;
            } catch (error) { setConflictNotice(error.message); return false; }
            finally { gateBusy.current = false; }
        }, [activeTeamId, cards, logIndex, eraFactors, handleUpdate, navigateTab]);

        const sendRivalMessage = useCallback(async input => {
            const current = leagueRef.current;
            if (!current) return false;
            const own = onlineRef.current?.seatTeamId || current.teams.find(team => team.teamId === activeTeamId && team.manager === 'human')?.teamId || current.teams.find(team => team.manager === 'human')?.teamId;
            const action = { ...input, type: 'rival-message', teamId: own };
            try {
                const next = onlineRef.current ? current : window.App.TimeLeagueActions.applyOnlineAction(current, action,
                    { role: 'commissioner', seat_team_id: own }, { cards }, new Date().toISOString());
                return await handleUpdate(next, action);
            } catch (error) { throw new Error(error.message || 'Your message could not be sent. Try again.'); }
        }, [activeTeamId, cards, handleUpdate]);

        const revealOnlineEra = useCallback(async position => {
            const current = leagueRef.current;
            if (!onlineRef.current || current?.phase !== 'draft') return false;
            return handleUpdate(current, { type: 'reveal-era', position });
        }, [handleUpdate]);

        const dispatchDraft = useCallback(async (action, options = {}) => {
            const current = leagueRef.current;
            if (!current || current.phase !== 'draft' || (!revealRef.current && action.type !== 'draft-order-settings') || draftActionBusy.current) return false;
            draftActionBusy.current = true;
            try {
                const nominatedTeam = action.teamId || Engine.currentDraftSeat(current)?.teamId;
                const own = onlineRef.current?.seatTeamId || current.teams.find(team => team.teamId === nominatedTeam && team.manager === 'human')?.teamId || current.teams.find(team => team.manager === 'human')?.teamId;
                const next = onlineRef.current ? current : window.App.TimeLeagueActions.applyOnlineAction(current, action,
                    { role: 'commissioner', seat_team_id: own }, { cards, logIndex, eraFactors }, new Date().toISOString());
                return await handleUpdate(next, action, options);
            } catch (error) { setConflictNotice(error.message); return false; }
            finally { draftActionBusy.current = false; }
        }, [cards, logIndex, eraFactors, handleUpdate]);

        // A manager finishes their own reveal before the shared clock can start.
        // Readiness is server-owned and is visible to the commissioner on refresh.
        useEffect(() => {
            if (!Remote || authRequired || !onlineMeta?.draftStarted || league?.phase !== 'draft' || !draftRevealed) return undefined;
            if (onlineMeta.members?.some(member => member.seat_team_id === onlineMeta.seatTeamId && member.ready_week === league.currentWeek)) return undefined;
            let cancelled = false;
            const rowId = onlineMeta.rowId;
            Remote.setReady(rowId, true).then(async result => {
                if (cancelled || onlineRef.current?.rowId !== rowId) return;
                if (!result.ok) { reportRemoteError(result); return; }
                try { const row = await Remote.loadOnlineLeague(rowId); if (!cancelled) acceptRow(row); }
                catch (error) { if (!cancelled) reportRemoteError(error); }
            });
            return () => { cancelled = true; };
        }, [onlineMeta?.rowId, onlineMeta?.draftStarted, onlineMeta?.members, league?.phase, draftRevealed, acceptRow, authRequired]);

        // Keep the displayed clock and automatic picks independent of the active
        // tab. A stored absolute deadline also resumes correctly after reconnect.
        useEffect(() => {
            if ((onlineMeta && authRequired) || league?.phase !== 'draft' || !cards?.size || !window.App.TimeLeagueDraftClock) return undefined;
            const checkDraft = async () => {
                const current = leagueRef.current;
                const meta = onlineRef.current;
                if (!current || pendingLocalSave.current || writeBusy.current || draftActionBusy.current || Date.now() < draftRetryAt.current || (meta && !meta.draftStarted)) return;
                const action = window.App.TimeLeagueDraftClock.nextAction(current, cards, Date.now(), revealRef.current);
                if (!action) return;
                // A rejected stale-version request gets time to fetch the latest
                // room, preventing overlapping writes or repeated error messages.
                draftRetryAt.current = Date.now() + 2000;
                if (await dispatchDraft(action, { background: true })) draftRetryAt.current = 0;
            };
            const timer = window.setInterval(checkDraft, 250);
            checkDraft();
            return () => window.clearInterval(timer);
        }, [league?.leagueId, league?.phase, cards, dispatchDraft, authRequired]);

        useEffect(() => {
            if (!onlineMeta || authRequired || league?.phase !== 'season' || league.settings.advancementMode !== 'timed') return undefined;
            const checkDeadline = () => {
                const current = leagueRef.current;
                if (!current || writeBusy.current || !cards?.size || !logIndex || (current.settings.eraAdjusted && !eraFactors?.size)) return;
                const due = Date.parse(current.gateStartedAt || current.createdAt) + (current.settings.gateHours || 24) * 3600000;
                if (Date.now() >= due) dispatchGate({ type: 'timed-advance' });
            };
            const timer = window.setInterval(checkDeadline, 10000);
            checkDeadline();
            return () => window.clearInterval(timer);
        }, [onlineMeta?.rowId, league?.weekStage, league?.gateStartedAt, league?.settings.advancementMode, cards, logIndex, eraFactors, dispatchGate, authRequired]);

        useEffect(() => {
            if (!league || (tab !== 'draft' && league.phase !== 'draft') || draftModuleState !== 'idle') return;
            if (!window.wrLoadDraft || window.DraftCC?.DraftGridPanel) { setDraftModuleState('ready'); return; }
            setDraftModuleState('loading');
            window.wrLoadDraft().then(() => setDraftModuleState('ready')).catch(() => setDraftModuleState('error'));
        }, [tab, league?.phase, Boolean(league), draftModuleState]);

        const createLeague = useCallback((input) => {
            const createdAt = new Date().toISOString();
            const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'time-league';
            const state = Engine.createTimeLeague({ name: input.name, seed: `${slug}:${createdAt}`, createdAt, settings: input.settings, seats: input.seats });
            try { persistLeague(state, { expectedSnapshot: null }); }
            catch { throw new Error('This device could not save your league. Allow site storage or free some space, then try again. Your setup is still here.'); }
            setLeague(state);
            leagueRef.current = state;
            setScoreRequest(null);
            onlineRef.current = null;
            openGeneration.current += 1;
            setOnlineMeta(null);
            setTab('draft');
        }, [persistLeague]);

        const createOnlineLeague = useCallback(async (input) => {
            if (!Remote) return { ok: false, error: 'not_configured' };
            const result = await Remote.createOnlineLeague(input);
            if (result.authRequired) reportRemoteError(result);
            if (!result.ok) return result;
            // Open through the same membership-aware waiting room used on return visits.
            refreshOnlineIndex();
            return result;
        }, [refreshOnlineIndex]);

        const openLeague = useCallback((leagueId) => {
            if (pendingLocalSave.current) return;
            const stored = readLeague(leagueId, localSnapshot);
            if (!stored) {
                setInviteError('This saved season could not be read. Its data has been kept. Restore it in the original browser or retry after restoring site storage.');
                return;
            }
            leagueRef.current = stored;
            onlineRef.current = null;
            openGeneration.current += 1;
            setOnlineMeta(null);
            setAutoPlayWeek(null);
            setGamecastStatus(null);
            setScoreRequest(null);
            setLeague(stored);
            const prefs = readUiPrefs();
            setTab(stored.phase === 'draft' ? 'draft' : prefs.leagueId === leagueId && !prefs.onlineRowId && prefs.tab !== 'draft' ? prefs.tab : 'home');
            if (prefs.leagueId === leagueId && !prefs.onlineRowId && prefs.teamId) setActiveTeamId(prefs.teamId);
        }, []);

        const openOnlineLeague = useCallback((rowId) => {
            if (!Remote || pendingLocalSave.current) return;
            const generation = ++openGeneration.current;
            setInviteError(null);
            Remote.loadOnlineLeague(rowId).then((row) => {
                if (generation !== openGeneration.current) return;
                acceptRow(row, true);
                const prefs = readUiPrefs();
                setTab(row.state.phase === 'draft' ? 'draft' : prefs.onlineRowId === rowId && prefs.tab !== 'draft' ? prefs.tab : 'home');
            }).catch(error => { setInviteError(error.message); reportRemoteError(error); });
        }, []);

        const switchLeague = useCallback(() => {
            pendingLocalSave.current = null;
            pendingSaveTime.current = null;
            previousLocalSave.current = null;
            setStorageError(null);
            setSaveConflict(false);
            leagueRef.current = null;
            localSnapshot.current = { leagueId: null, raw: null };
            setLeague(null);
            setAutoPlayWeek(null);
            setGamecastStatus(null);
            setScoreRequest(null);
            onlineRef.current = null;
            openGeneration.current += 1;
            setOnlineMeta(null);
            setConflictNotice(null);
            refreshOnlineIndex();
        }, [refreshOnlineIndex]);

        const deleteLeague = useCallback((leagueId) => {
            const saved = readLeague(leagueId);
            if (saved) window.App.TimeLeagueCareerStore?.remember(saved, null, true);
            removeLeagueRecord(leagueId);
            setIndex((prev) => { const next = prev.filter((item) => item.leagueId !== leagueId); writeIndexEntries(next); return next; });
            setLeague((prev) => (prev?.leagueId === leagueId ? null : prev));
        }, []);

        const SetupPanel = window.WrTimeLeagueSetupPanel;
        const DraftPanel = window.WrTimeLeagueDraftPanel;
        const DraftClock = window.WrTimeLeagueDraftClock;
        const AuctionPanel = window.WrTimeLeagueAuctionPanel;
        const TeamPanel = window.WrTimeLeagueTeamPanel;
        const WeekGates = window.WrTimeLeagueWeekGates;
        const ActivityPanel = window.WrTimeLeagueActivityPanel;
        const GamecastPanel = window.WrTimeLeagueGamecastPanel;
        const HomePanel = window.WrTimeLeagueHomePanel;
        const CareerView = window.WrTimeLeagueCareerView;
        const ProfilePanel = window.WrTimeLeagueProfilePanel;
        const CommunityPanel = window.WrTimeLeagueCommunityPanel;
        const RivalsPanel = window.WrTimeLeagueRivalsPanel;
        const reportBug = window.WR?.Feedback?.reportBug ? () => {
            // Give support the current screen and game stage, never a snapshot,
            // invitation token, private conversation or account details.
            const context = league
                ? `${onlineMeta ? 'Friends' : 'Solo/local'} · ${TAB_LABELS[tab] || 'Home'} · ${league.phase} · week ${league.weekStage === 'postgame' ? league.currentWeek - 1 : league.currentWeek} · ${league.weekStage}`
                : 'League setup';
            window.WR.Feedback.reportBug({ message: `The Vault · ${context}\n\nWhat happened:\n\nSteps to reproduce:\n` });
        } : null;
        const failedData = [cards !== null && !cards?.size && 'player archive', logsMissing && 'weekly game data', eraFactorsMissing && league?.settings.eraAdjusted && 'era scoring'].filter(Boolean);
        const dataNotice = failedData.length > 0 && h('div', { className: 'tl-card', role: 'alert' },
            h('p', null, `Couldn’t load ${failedData.join(' and ')}. Check your connection and try again.`),
            h('button', { type: 'button', className: 'tl-btn', disabled: dataLoading, onClick: () => setDataAttempt(attempt => attempt + 1) }, dataLoading ? 'Retrying…' : 'Retry loading'));
        const signInNotice = authRequired && (!league || onlineMeta) && h('div', { className: 'tl-card', role: 'alert' },
            h('p', null, actor?.kind === 'guest' ? 'Your guest session needs to reconnect. Restore your guest pass below to return to this team.' : 'Your sign-in is no longer accepted. Sign in again to reconnect to your saved league.'),
            actor?.kind !== 'guest' && h('a', { className: 'tl-btn primary', href: inviteSignInHref }, 'Sign in again'));
        const guestSessionPanel = GuestPanel && actor?.kind !== 'account' && h(GuestPanel, {
            game: 'vault', code: pendingInvite || null, onJoined: joinedAsGuest, onError: message => setInviteError(typeof message === 'string' ? message : message?.message),
        });
        const guestAccess = guestSessionPanel && league && actor?.kind === 'guest' && !pendingInvite && !authRequired
            ? h('details', { className: 'tl-card tl-guest-access' }, h('summary', null, `Playing as ${actor.displayName || 'Guest'} · Save your guest pass`), guestSessionPanel)
            : pendingInvite || (actor?.kind === 'guest' && authRequired) ? guestSessionPanel : null;
        const pendingInviteNotice = pendingInvite && actor?.kind !== 'account' && h('section', { className: 'tl-card tl-pending-invite', 'aria-label': 'Join your friends in The Vault' },
            h('h2', null, 'You’re invited to The Vault'),
            h('p', null, 'Take the team your friend reserved for you. Sign in or create a free account to keep your team across devices, or join as a guest below.'),
            h('a', { className: 'tl-btn primary', href: inviteSignInHref }, 'Sign in or create account'),
            actor?.kind === 'guest' && h('button', { type: 'button', className: 'tl-btn', onClick: () => { onInviteConsumed?.(); openOnlineLeague(actor.roomId); } }, 'Return to my current guest team'));

        if (!league) {
            const lobbyExtras = h(LobbyExtras, null,
                        h('div', { className: 'tl-community-tabs' },
                            CareerView && h('button', { className: 'tl-btn' + (showCareer ? ' primary' : ''), 'aria-expanded': showCareer, onClick: () => { setShowCareer(value => !value); setShowCommunity(false); } }, 'My profile & career'),
                            CommunityPanel && h('button', { className: 'tl-btn' + (showCommunity ? ' primary' : ''), 'aria-expanded': showCommunity, onClick: () => { setShowCommunity(value => !value); setShowCareer(false); } }, 'Community & leaderboard'),
                            reportBug && h('button', { type: 'button', className: 'tl-btn tl-lobby-support', onClick: reportBug }, 'Report a bug')),
                        showCareer && CareerView && h(CareerView, { index, onOpenLocal: openLeague, onOpenOnline: openOnlineLeague }),
                        showCommunity && CommunityPanel && h(CommunityPanel, { onOpenOnline: openOnlineLeague, onProfile: () => { setShowCareer(true); setShowCommunity(false); } }));
            return h('div', { className: 'tl-root tl-play' },
                h(TimeLeagueStyles, null),
                h('div', { className: 'tl-lobby-wrap' },
                    h('div', { className: 'tl-header tl-lobby-header' },
                        h('div', { className: 'tl-lobby-brand' },
                            h('span', { className: 'tl-lobby-crest' }, 'V'),
                            h('span', null, h('strong', null, 'The Vault'), h('small', null, 'Fantasy football through time'))),
                        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                            h('button', { type: 'button', className: 'tl-btn', onClick: onClose }, '← BACK'))),
                    claimingInvite && h('div', { className: 'tl-card', style: { marginBottom: 14 } }, h('p', { className: 'tl-empty' }, 'Claiming your invite…')),
                    dataNotice,
                    signInNotice,
                    inviteError && h('div', { className: 'tl-card', style: { borderColor: 'rgba(240,165,0,0.4)', marginBottom: 14 } },
                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
                            h('span', { style: { fontSize: 12.5, color: 'var(--warn)' } }, `⚠ ${inviteError}`),
                            pendingInvite && actor?.kind === 'account' && !authRequired && h('button', { type: 'button', className: 'tl-btn', disabled: claimingInvite, onClick: () => setInviteAttempt(value => value + 1) }, 'Retry joining'),
                            h('button', { type: 'button', className: 'tl-btn icon', onClick: () => setInviteError(null) }, '✕'))),
                    SetupPanel ? h(SetupPanel, {
                        index, onOpen: openLeague, onDelete: deleteLeague, onCreate: createLeague,
                        onlineIndex, onlineIndexState, onOpenOnline: openOnlineLeague, onCreateOnline: createOnlineLeague,
                        pendingInvite,
                        joinPanel: h(React.Fragment, null, pendingInviteNotice, guestSessionPanel),
                        settingsPanel: h(React.Fragment, null, ProfilePanel && h(ProfilePanel), lobbyExtras),
                        guestResume: actor?.kind === 'guest' ? { rowId: actor.roomId, name: actor.displayName, onResume: () => openOnlineLeague(actor.roomId) } : null,
                        onJoinInvite: code => {
                            const target = new URL(window.location.href);
                            target.searchParams.set('vault', '1');
                            target.searchParams.set('tl_invite', code);
                            window.location.assign(target.href);
                        },
                    }) : h('div', null, pendingInviteNotice, guestSessionPanel, lobbyExtras)));
        }

        const tabs = league.phase === 'draft'
            ? ['draft', 'messages', 'career', 'community', 'activity']
            : ['home', 'gameday', 'roster', 'waivers', 'trades', 'stats', 'achievements', 'draft', 'messages', 'career', 'community', 'activity'];
        const activeTab = tabs.includes(tab) ? tab : tabs[0];
        const addPlayoffCounts = league.phase === 'complete' && !league.seasonExtensionLocked && !league.yearsRevealed && !Object.values(league.yearReveals || {}).some(Boolean) && !Engine.playoffCount(league)
            ? [2, 4].filter(count => league.teams.length >= count && league.settings.regularSeasonWeeks + (count === 4 ? 2 : 1) <= 14) : [];
        const activeTeam = onlineMeta ? onlineMeta.seatTeamId : league.teams.some((team) => team.teamId === activeTeamId)
            ? activeTeamId
            : (league.teams.find((team) => team.manager === 'human')?.teamId ?? league.teams[0]?.teamId ?? 't1');
        const responseTeam = onlineMeta?.seatTeamId || (league.teams.find(team => team.teamId === activeTeam && team.manager === 'human')?.teamId ?? league.teams.find(team => team.manager === 'human')?.teamId);
        const currentWaiverBrowse = waiverBrowse.leagueId === league.leagueId && waiverBrowse.teamId === responseTeam && waiverBrowse.week === league.currentWeek ? waiverBrowse : null;
        const phaseTone = league.phase === 'draft' ? 'warn' : league.phase === 'season' ? 'info' : 'gold';
        const cardsReady = cards !== null && cards.size > 0;
        const pendingPlayback = autoPlayWeek && league.finalizedWeeks.some(week => week.week === autoPlayWeek)
            && (gamecastStatus?.leagueId !== league.leagueId || gamecastStatus.week !== autoPlayWeek);
        const playback = pendingPlayback ? { week: autoPlayWeek, done: false, quarter: 1, playing: false }
            : gamecastStatus?.leagueId === league.leagueId ? gamecastStatus : null;
        const watching = playback && !playback.done;
        const Mail = window.TimeLeagueMail;
        const mailKey = Mail?.readKey(league.leagueId, responseTeam);
        // Replaying a finished week must not roll the live season's stats or
        // conversations backwards. Only first-time playback needs a spoiler cap.
        const mailThroughWeek = watching && !playback.replay ? playback.week - 1 : undefined;
        const unreadMail = Mail ? Mail.unreadMessages(presentedMail.league, responseTeam, mailReads[mailKey] || Mail.readIds(league.leagueId, responseTeam), mailThroughWeek) : [];
        const openMail = teamId => {
            setMailThread(teamId ? { key: mailKey, teamId } : null);
            navigateTab('messages');
        };
        const latestFinalWeek = league.finalizedWeeks.at(-1)?.week;
        const postgameMail = unreadMail.find(message => message.id === `game:${latestFinalWeek}:${responseTeam}`) || unreadMail[0];
        const mailSender = league.teams.find(team => team.teamId === postgameMail?.fromTeamId);
        const mailAction = !watching && mailSender ? h('button', { type: 'button', className: 'tl-btn tl-mail-action', onClick: () => openMail(mailSender.teamId), 'aria-label': `New message from ${mailSender.name}. Read and reply` },
            window.TimeLeagueHelmetIcon ? h(window.TimeLeagueHelmetIcon, { helmet: mailSender.helmet, letter: window.App.TimeLeagueHelmet?.monogramFor(mailSender.name), size: 26 }) : h('span', { 'aria-hidden': true }, '✉'),
            h('span', null, h('small', null, 'New message'), h('strong', null, mailSender.name))) : null;
        const mailNotice = !watching && postgameMail && window.WrTimeLeagueMailNotice
            ? h(window.WrTimeLeagueMailNotice, { league, message: postgameMail, count: unreadMail.length, onOpen: openMail }) : null;
        const showWeekActions = Boolean(WeekGates && league.phase !== 'draft' && ['home', 'roster', 'waivers', 'trades', 'gameday'].includes(activeTab));
        const loadingNotice = cards === null
            ? h('div', { className: 'tl-card' }, h('p', { className: 'tl-empty' }, 'Loading player cards…'))
            : null;

        return h('div', { className: `tl-root tl-play${showWeekActions ? ' tl-has-week-actions' : ''}`, 'data-vault-phase': league.phase, 'data-vault-tab': activeTab },
            h(TimeLeagueStyles, null),
            h('nav', { className: 'tl-sidenav', 'aria-label': 'Vault navigation' },
                h('div', { className: 'tl-sidenav-brand' },
                    h('div', { className: 'tl-sidenav-lockup' },
                        h('span', { className: 'tl-sidenav-crest' }, 'V'),
                        h('span', null, h('strong', null, 'THE VAULT'), h('small', null, 'Fantasy through time')))),
                tabs.map((item) => h('button', {
                    key: item, type: 'button', className: `tl-tabbtn${item === activeTab ? ' active' : ''}`, 'aria-current': item === activeTab ? 'page' : undefined, onClick: () => navigateTab(item),
                }, h('span', { className: 'tl-tab-icon', 'aria-hidden': 'true' }, TAB_ICONS[item]),
                h('span', null, item === 'draft' && league.phase !== 'draft' ? 'DRAFT RECAP' : TAB_LABELS[item]), item === 'messages' && unreadMail.length > 0 ? h('em', { className: 'tl-mail-badge', 'aria-label': `${unreadMail.length} unread messages` }, unreadMail.length) : null))),
            h(MobileGameNav, { tabs, activeTab, onNavigate: navigateTab, unread: unreadMail.length, onReportBug: reportBug }),
            h('div', { className: 'tl-main' }, h('div', { className: 'tl-main-inner' },
                h('header', { className: `tl-league-bar${onlineMeta ? ' has-invite' : ''}` },
                    h('div', { className: 'tl-league-heading' },
                        h('span', { className: 'tl-league-name' }, league.name),
                        h('strong', null, activeTab === 'draft' && league.phase !== 'draft' ? 'Draft recap' : TAB_LABELS[activeTab])),
                    league.phase !== 'draft' && h(LeagueEraSummary, { league }),
                    h('div', { className: 'tl-league-context' },
                        !(activeTab === 'draft' && league.phase === 'draft') && h('span', { className: `tl-pill ${phaseTone}` }, watching ? `${playback.replay ? 'REPLAY' : playback.playing ? 'PLAYING' : 'PAUSED'} · WEEK ${playback.week}` : league.phase === 'draft' ? 'DRAFT' : league.phase === 'complete' ? 'COMPLETE' : `${league.weekStage === 'postgame' ? 'FINAL · ' : ''}WEEK ${Math.min(league.weekStage === 'postgame' ? league.currentWeek - 1 : league.currentWeek, Engine.seasonEndWeek(league))}`),
                        onlineMeta && h('button', { type: 'button', className: 'tl-btn tl-invite-trigger', onClick: openFriends, 'aria-controls': 'vault-friends-room', 'aria-expanded': showFriends || !onlineMeta.draftStarted }, onlineMeta.role === 'commissioner' ? 'Invite' : 'Managers'),
                        activeTab !== 'messages' && unreadMail.length > 0 && h('button', { type: 'button', className: 'tl-mail-trigger', onClick: () => openMail(unreadMail[0].fromTeamId), 'aria-label': `${unreadMail.length} unread messages. Open message from ${unreadMail[0].name}`, title: 'Unread messages' }, h('span', { 'aria-hidden': true }, '✉'), h('em', { className: 'tl-mail-badge' }, unreadMail.length)),
                        h('details', { key: `${league.leagueId}:${activeTab}`, className: 'tl-league-menu' },
                            h('summary', { 'aria-label': 'League options' }, '•••'),
                            h('div', { className: 'tl-league-menu-body' },
                                h('strong', null, league.name),
                                h('small', null, `${onlineMeta ? 'Friends league' : league.teams.filter(team => team.manager === 'human').length > 1 ? 'Local multiplayer' : 'Solo season'} · ${league.teams.length} managers`),
                                h(EraChipRail, { label: 'League format', chips: EraRules.eraRuleChips(league.settings.eraRules).filter(chip => !chip.toLowerCase().includes('reveal in the draft')) }),
                                onlineMeta && h('button', { type: 'button', className: 'tl-btn', onClick: openFriends }, 'Friends & invites'),
                                reportBug && h('button', { type: 'button', className: 'tl-btn', onClick: event => { event.currentTarget.closest('details')?.removeAttribute('open'); reportBug(); } }, 'Report a bug'),
                                h('button', { type: 'button', className: 'tl-btn', disabled: Boolean(storageError), onClick: switchLeague }, 'Switch league'),
                                h('button', { type: 'button', className: 'tl-btn', onClick: () => { if (!storageError || keepPreviousSave()) onClose(); } }, saveConflict ? 'Load latest save & go back' : storageError ? 'Keep previous save & go back' : 'Back to dashboard'))))),
                onlineMeta && window.App.GameRoomStatus && h(window.App.GameRoomStatus, { authRequired, saving, error: connectionError, lastSyncedAt, retrying: reconnecting, onRetry: reconnectRoom,
                    joined: onlineMeta.members.filter(member => member.joined).length, total: onlineMeta.members.length,
                    ready: onlineMeta.members.filter(member => member.joined && member.ready_week === league.currentWeek).length }),
                conflictNotice && h('div', { className: 'tl-card', role: 'alert', style: { borderColor: 'rgba(240,165,0,0.4)', marginBottom: 14 } },
                    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
                        h('span', { style: { fontSize: 12.5, color: 'var(--warn)' } }, `⚠ ${conflictNotice}`),
                        h('button', { type: 'button', className: 'tl-btn icon', 'aria-label': 'Dismiss move notice', onClick: () => setConflictNotice(null) }, '✕'))),
                signInNotice,
                guestAccess,
                connectionError && !authRequired && !window.App.GameRoomStatus && h('p', { className: 'tl-card', role: 'status' }, 'Connection interrupted. Reconnecting automatically; your last saved game is shown.'),
                storageError && h('div', { className: 'tl-card', role: 'alert', tabIndex: -1, ref: saveRecoveryRef, 'aria-label': 'Save recovery' },
                    h('p', null, storageError),
                    h('div', { className: 'tl-stage-actions' },
                        h('button', { type: 'button', className: 'tl-btn primary', onClick: retryLocalSave }, saveConflict ? 'Load latest save' : 'Retry save'),
                        saveConflict && h('button', { type: 'button', className: 'tl-btn', onClick: switchLeague }, 'Return to saved seasons'),
                        !saveConflict && h('button', { type: 'button', className: 'tl-btn', onClick: keepPreviousSave }, 'Keep previous save'))),
                dataNotice,
                onlineMeta && (showFriends || !onlineMeta.draftStarted) && h(FriendsRoom, {
                    key: `${onlineMeta.rowId}:${onlineMeta.seatTeamId}`, league, meta: onlineMeta, saving, onAction: action => handleUpdate(league, action), onClose: () => setShowFriends(false),

                }),
                activeTab === 'career' && CareerView ? h(CareerView, { index, league, onlineMeta, onOpenLocal: openLeague, onOpenOnline: openOnlineLeague }) : null,
                activeTab === 'community' && CommunityPanel ? h(CommunityPanel, { onOpenOnline: openOnlineLeague, onProfile: () => navigateTab('career') }) : null,
                activeTab === 'messages' && RivalsPanel ? h(RivalsPanel, { key: `${league.leagueId}:${responseTeam}`, league, teamId: responseTeam, throughWeek: mailThroughWeek, threadRequest: mailThread, onRead: onMailRead, isPrivate: Boolean(onlineMeta), onSend: sendRivalMessage, onNavigate: navigateTab }) : null,
                h('fieldset', { ref: gameplayRef, hidden: Boolean(storageError), disabled: saving || Boolean(storageError) || Boolean(onlineMeta && (authRequired || !onlineMeta.draftStarted)), style: { border: 0, padding: 0, margin: 0, minWidth: 0, display: storageError ? 'none' : undefined } },
                ['home', 'gameday'].includes(activeTab) && addPlayoffCounts.length > 0 && h('section', { className: 'tl-card tl-week-gate' },
                    h('div', null, h('strong', null, 'Finish with a playoff?'), h('p', null, 'Keep regular-season results and reopen this season for a seeded championship. This replaces the standings-only title.')),
                    addPlayoffCounts.map(count => h('button', { key: count, className: 'tl-btn', disabled: saving || (onlineMeta && onlineMeta.role !== 'commissioner'), onClick: () => handleUpdate(Engine.startPlayoffs(league, count), { type: 'start-playoffs', count }) }, `Add ${count}-team playoffs`))),
                activeTab === 'draft' && draftModuleState === 'error' && h('p', { role: 'status' }, 'The draft grid could not load. ', h('button', { className: 'tl-btn', onClick: () => setDraftModuleState('idle') }, 'Retry draft module')),
                activeTab === 'home' && watching && !playback.replay ? h('section', { className: 'tl-card' },
                    h('h2', null, `Week ${playback.week} is still in progress`), h('p', null, 'Your week recap opens after the final whistle.'),
                    h('button', { className: 'tl-btn primary', onClick: () => navigateTab('gameday') }, 'Watch game'))
                    : activeTab === 'home' && HomePanel ? h(HomePanel, { league, onNavigate: navigateTab,
                        onInspectScore: week => { setScoreRequest(previous => ({ leagueId: league.leagueId, week, requestId: (previous?.requestId || 0) + 1 })); navigateTab('gameday'); },
                        seatTeamId: responseTeam, cards, logIndex, eraFactors, throughWeek: mailThroughWeek }) : null,
                activeTab === 'draft' ? (cardsReady && DraftPanel ? h(DraftPanel, {
                    key: league.leagueId, league, cards, logIndex, eraFactors, throughWeek: mailThroughWeek, onUpdate: (next, action) => handleUpdate(next, action, { base: league }), onlineMeta, onRevealReadyChange: onDraftRevealReady, onDraftAction: dispatchDraft, onRevealEra: onlineMeta ? revealOnlineEra : undefined,
                    draftControls: league.phase === 'draft' && DraftClock && h(DraftClock, { league, onlineMeta, saving, onAction: dispatchDraft }),
                    auctionControls: league.phase === 'draft' && league.settings.draftFormat === 'auction' && AuctionPanel && h(AuctionPanel, { league, cards, currentTeamId: responseTeam, onlineMeta, saving, onAction: dispatchDraft }),
                }) : loadingNotice) : null,
                league.phase !== 'draft' && GamecastPanel ? h('div', { key: league.leagueId, hidden: activeTab !== 'gameday', className: 'tl-gamecast-workspace' }, h(GamecastPanel, {
                    league, cards, logIndex, logsMissing, eraFactors, onlineMeta, autoPlayWeek, scoreRequest, active: activeTab === 'gameday' && !storageError, seatTeamId: responseTeam, mailNotice, throughWeek: mailThroughWeek, onPlaybackChange: reportPlayback, onGoCeremony: () => navigateTab('home'), onUpdate: (next, action) => handleUpdate(next, action, { base: league }), onGoRoster: () => navigateTab('roster'),
                })) : null,
                activeTab === 'stats' ? (window.WrTimeLeagueStatsPanel && cardsReady ? h(window.WrTimeLeagueStatsPanel, { key: league.leagueId, league, cards, logIndex, eraFactors, throughWeek: mailThroughWeek, onNavigate: navigateTab }) : loadingNotice) : null,
                (activeTab === 'roster' || activeTab === 'waivers' || activeTab === 'trades' || activeTab === 'achievements')
                    ? (cardsReady && TeamPanel
                        ? h(TeamPanel, { league, cards, logIndex, eraFactors, section: activeTab, throughWeek: mailThroughWeek, onNavigate: navigateTab, onReopenPlanning: teamId => dispatchGate({ type: 'reopen-planning', teamId }), onStats: () => navigateTab('stats'), activeTeamId: responseTeam, onSelectTeam: setActiveTeamId, onUpdate: (next, action) => handleUpdate(next, action, { base: league }), onlineMeta,
                            waiverSlot: currentWaiverBrowse?.slot || null,
                            waiverContext: currentWaiverBrowse && !currentWaiverBrowse.contextCleared ? currentWaiverBrowse : null,
                            onClearWaiverContext: () => setWaiverBrowse(previous => previous.leagueId === league.leagueId && previous.teamId === responseTeam
                                && previous.week === league.currentWeek && previous.requestId === waiverBrowse.requestId
                                ? { ...previous, replacementEntryId: null, contextCleared: true } : previous),
                            onBrowseWaivers: (slot, replacementEntryId = null) => {
                                const current = leagueRef.current;
                                if (!current || current.leagueId !== league.leagueId || current.currentWeek !== league.currentWeek) return;
                                const owner = current.teams.find(team => team.teamId === responseTeam && team.manager === 'human');
                                if (!owner) return;
                                const replacement = owner.roster.find(entry => entry.entryId === replacementEntryId);
                                setWaiverBrowse(previous => ({ leagueId: current.leagueId, teamId: owner.teamId, week: current.currentWeek, slot,
                                    replacementEntryId: replacement?.entryId || null, requestId: (previous.requestId || 0) + 1 }));
                                navigateTab('waivers');
                            } })
                        : loadingNotice)
                    : null,

                activeTab === 'activity' && ActivityPanel ? (league.phase === 'draft' && !draftRevealed
                    ? h('section', { className: 'tl-card' }, h('h3', null, 'The draft archives are sealed'), h('p', null, 'Finish the position reveal to open your league wire.'), h('button', { className: 'tl-btn primary', onClick: () => navigateTab('draft') }, 'Open the reveal'))
                    : h(ActivityPanel, { league })) : null),
                showWeekActions && h(WeekGates, { key: `${league.leagueId}:${league.weekStage}:${activeTab}`, currentTab: activeTab, teamId: responseTeam, league, onlineMeta, saving, authRequired: Boolean(onlineMeta && authRequired), signInHref, saveError: Boolean(storageError), saveConflict, onRetrySave: retryLocalSave, playback, messageAction: mailAction,
                    onReviewLineup: teamId => {
                        if (!league.teams.some(team => team.teamId === teamId && team.manager === 'human') || (onlineMeta && teamId !== onlineMeta.seatTeamId)) return;
                        if (!onlineMeta) setActiveTeamId(teamId);
                        navigateTab('roster');
                    },
                    dataReady: cardsReady && Boolean(logIndex) && (!league.settings.eraAdjusted || Boolean(eraFactors?.size)), onAction: dispatchGate, onNavigate: navigateTab }))));
    }

    window.TimeLeague = TimeLeagueMode;
})();
