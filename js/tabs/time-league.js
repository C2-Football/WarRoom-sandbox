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
    const { useState, useEffect, useCallback, useMemo } = React;
    const h = React.createElement;

    const Types = window.App.TimeLeagueTypes;
    const Season = window.App.TimeLeagueSeason;
    const PlayerCards = window.App.TimeLeaguePlayerCards;
    const Engine = window.App.TimeLeagueEngine;
    const EraRules = window.App.TimeLeagueEraRules;
    const Remote = window.App.TimeLeagueRemote;

    const UI_PREFS_KEY = 'wr-time-league-ui-v1';
    const REGULAR_SEASON_WEEKS = 14;
    const MAX_QUARTERBACKS = 2;

    const TAB_IDS = ['home', 'draft', 'gameday', 'roster', 'waivers', 'trades', 'achievements', 'standings', 'activity'];
    const TAB_LABELS = {
        home: 'HOME', draft: 'DRAFT', gameday: 'GAMEDAY', roster: 'ROSTER', waivers: 'WAIVERS',
        trades: 'TRADES', achievements: 'ACHIEVEMENTS', standings: 'STANDINGS', activity: 'ACTIVITY',
    };
    const TAB_ICONS = {
        home: '⌂', draft: '▤', gameday: '▶', roster: '♙', waivers: '+', trades: '⇄',
        achievements: '♛', standings: '≡', activity: '◷',
    };

    const PERSONA_IDS = ['warlord', 'archivist', 'gambler', 'steward'];
    // Helmet defaults are deterministic per name (see time-league-helmet.js) so
    // the same roster of default seats always looks the same, not reshuffled
    // on every "Found a League" mount.
    const seatWithHelmet = (seat) => ({ ...seat, helmet: window.App.TimeLeagueHelmet.defaultHelmet(seat.name) });
    const defaultSeats = () => [
        seatWithHelmet({ name: 'Commander', manager: 'human', aiPersona: 'warlord' }),
        seatWithHelmet({ name: 'Warlord Kade', manager: 'ai', aiPersona: 'warlord' }),
        seatWithHelmet({ name: 'The Archivist', manager: 'ai', aiPersona: 'archivist' }),
        seatWithHelmet({ name: 'Riverboat Sol', manager: 'ai', aiPersona: 'gambler' }),
        seatWithHelmet({ name: 'Steward Vance', manager: 'ai', aiPersona: 'steward' }),
        seatWithHelmet({ name: 'Iron Ledger', manager: 'ai', aiPersona: 'archivist' }),
    ];

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
                }];
            });
        } catch { return []; }
    }
    function writeIndexEntries(entries) {
        try { window.localStorage.setItem(Types.TIME_LEAGUE_INDEX_KEY, JSON.stringify(entries)); } catch { /* in-memory only */ }
    }
    function readLeague(leagueId) {
        try { return Engine.normalizeTimeLeague(JSON.parse(window.localStorage.getItem(Types.timeLeagueStorageKey(leagueId)) ?? 'null')); }
        catch { return null; }
    }
    function writeLeague(state) {
        try { window.localStorage.setItem(Types.timeLeagueStorageKey(state.leagueId), JSON.stringify(state)); } catch { /* in-memory only */ }
    }
    function removeLeagueRecord(leagueId) {
        try { window.localStorage.removeItem(Types.timeLeagueStorageKey(leagueId)); } catch { /* nothing to clean up */ }
    }
    const indexEntryOf = (state) => ({
        leagueId: state.leagueId, name: state.name, phase: state.phase,
        teamCount: state.teams.length, currentWeek: state.currentWeek, createdAt: state.createdAt,
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
    let logIndexPromise = null;
    const fetchLogIndex = () => {
        logIndexPromise ??= fetch('data/time-league/nflverse-game-logs.csv')
            .then(async (response) => {
                if (!response.ok) return null;
                const { logs } = Season.parseGameLogCsv(await response.text());
                return logs.length ? Season.buildGameLogIndex(logs) : null;
            })
            .catch(() => null);
        return logIndexPromise;
    };
    let eraFactorsPromise = null;
    const fetchEraFactors = () => {
        eraFactorsPromise ??= fetch('data/time-league/era-factors.json')
            .then(async (response) => {
                if (!response.ok) return null;
                const payload = await response.json();
                if (!payload?.factors) return null;
                return new Map(Object.entries(payload.factors).flatMap(([key, value]) =>
                    (typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [])));
            })
            .catch(() => null);
        return eraFactorsPromise;
    };
    let cardsPromise = null;
    const fetchCards = () => { cardsPromise ??= PlayerCards.loadPlayerCards(); return cardsPromise; };

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
            .tl-grid-2 { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; align-items: start; }
            .tl-grid-2.even { grid-template-columns: 1fr 1fr; }
            @media (max-width: 900px) { .tl-grid-2, .tl-grid-2.even { grid-template-columns: 1fr; } }
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

    // ── shell ──
    function TimeLeagueMode({ onClose, pendingInvite, onInviteConsumed }) {
        const [index, setIndex] = useState([]);
        const [league, setLeague] = useState(null);
        const [tab, setTab] = useState('home');
        const [activeTeamId, setActiveTeamId] = useState('');
        const [cards, setCards] = useState(null);
        const [logIndex, setLogIndex] = useState(null);
        const [logsMissing, setLogsMissing] = useState(false);
        const [eraFactors, setEraFactors] = useState(null);
        const [booted, setBooted] = useState(false);
        // Online bookkeeping deliberately lives OUTSIDE `league` — Engine.normalizeTimeLeague()
        // rebuilds `league` from an explicit key allowlist on every handleUpdate, so anything
        // attached to the league object itself would be silently stripped on the very next update.
        const [onlineMeta, setOnlineMeta] = useState(null); // null = local league, else {rowId, version, role}
        const [onlineIndex, setOnlineIndex] = useState([]);
        const [onlineIndexState, setOnlineIndexState] = useState('idle'); // idle | signed-out | ready
        const [conflictNotice, setConflictNotice] = useState(null);
        const [claimingInvite, setClaimingInvite] = useState(false);
        const [inviteError, setInviteError] = useState(null);

        const refreshOnlineIndex = useCallback(() => {
            if (!Remote) return;
            if (!(window.App.OD && window.App.OD.getCurrentUserId && window.App.OD.getCurrentUserId())) {
                setOnlineIndex([]); setOnlineIndexState('signed-out'); return;
            }
            Remote.listMyOnlineLeagues().then((rows) => { setOnlineIndex(rows); setOnlineIndexState('ready'); });
        }, []);

        useEffect(() => {
            const prefs = readUiPrefs();
            setIndex(readIndexEntries());
            refreshOnlineIndex();
            if (prefs.onlineRowId && Remote) {
                Remote.loadOnlineLeague(prefs.onlineRowId).then((row) => {
                    const safe = row && Engine.normalizeTimeLeague(row.state);
                    if (!safe) { setBooted(true); return; }
                    setLeague(safe);
                    setOnlineMeta({ rowId: row.id, version: row.version });
                    setTab(prefs.tab);
                    if (prefs.teamId) setActiveTeamId(prefs.teamId);
                    setBooted(true);
                });
                return;
            }
            if (prefs.leagueId) {
                const stored = readLeague(prefs.leagueId);
                if (stored) {
                    setLeague(stored);
                    setTab(prefs.tab);
                    if (prefs.teamId) setActiveTeamId(prefs.teamId);
                }
            }
            setBooted(true);
        }, [refreshOnlineIndex]);

        // Consumes a ?tl_invite link once — app.js only opens the Vault this way once a
        // real account session already exists, but this checks again in case someone
        // mounts this component directly with a code and no session (defensive, not load-bearing).
        useEffect(() => {
            if (!pendingInvite || !Remote) return;
            if (!(window.App.OD && window.App.OD.getCurrentUserId && window.App.OD.getCurrentUserId())) return;
            setClaimingInvite(true);
            Remote.claimInvite(pendingInvite).then((result) => {
                setClaimingInvite(false);
                if (onInviteConsumed) onInviteConsumed();
                if (!result.ok) { setInviteError(result.error || 'That invite link no longer works — ask your commissioner for a fresh one.'); return; }
                Remote.loadOnlineLeague(result.rowId).then((row) => {
                    const safe = row && Engine.normalizeTimeLeague(row.state);
                    if (!safe) return;
                    setLeague(safe);
                    setOnlineMeta({ rowId: row.id, version: row.version });
                    setTab(safe.phase === 'draft' ? 'draft' : 'home');
                    refreshOnlineIndex();
                });
            });
        }, [pendingInvite]);

        useEffect(() => {
            let cancelled = false;
            fetchLogIndex().then((result) => { if (!cancelled) { if (result) setLogIndex(result); else setLogsMissing(true); } });
            fetchEraFactors().then((result) => { if (!cancelled) setEraFactors(result); });
            fetchCards().then((result) => { if (!cancelled) setCards(result); });
            return () => { cancelled = true; };
        }, []);

        useEffect(() => {
            if (!booted) return;
            writeUiPrefs({ leagueId: league?.leagueId ?? null, tab, teamId: activeTeamId, onlineRowId: onlineMeta?.rowId ?? null });
        }, [booted, league, tab, activeTeamId, onlineMeta]);

        // Live sync: another member's write lands here without a refresh. Keyed on the row id
        // (not the whole onlineMeta object, which changes identity on every version bump) so a
        // write from THIS tab doesn't tear down and resubscribe the channel every time.
        useEffect(() => {
            if (!onlineMeta?.rowId || !Remote) return undefined;
            const unsubscribe = Remote.subscribeToLeague(onlineMeta.rowId, (row) => {
                const safe = Engine.normalizeTimeLeague(row.state);
                if (!safe) return;
                setLeague(safe);
                setOnlineMeta((prev) => (prev?.rowId === row.id ? { ...prev, version: row.version } : prev));
            });
            return unsubscribe;
        }, [onlineMeta?.rowId]);

        const persistLeague = useCallback((state) => {
            writeLeague(state);
            setIndex((prev) => {
                const entry = indexEntryOf(state);
                const next = prev.some((item) => item.leagueId === state.leagueId)
                    ? prev.map((item) => (item.leagueId === state.leagueId ? entry : item))
                    : [...prev, entry];
                writeIndexEntries(next);
                return next;
            });
        }, []);

        const handleUpdate = useCallback((next) => {
            const safe = Engine.normalizeTimeLeague(next) ?? next;
            if (onlineMeta) {
                setLeague(safe); // optimistic — instant feedback while the write is in flight
                Remote.writeOnlineLeague(onlineMeta.rowId, safe, onlineMeta.version).then((result) => {
                    if (result.ok) {
                        setOnlineMeta((prev) => (prev?.rowId === onlineMeta.rowId ? { ...prev, version: result.version } : prev));
                        return;
                    }
                    if (result.conflict) {
                        setConflictNotice('Someone else acted first — reloading the latest state.');
                        Remote.loadOnlineLeague(onlineMeta.rowId).then((row) => {
                            const latest = row && Engine.normalizeTimeLeague(row.state);
                            if (!latest) return;
                            setLeague(latest);
                            setOnlineMeta((prev) => (prev?.rowId === onlineMeta.rowId ? { ...prev, version: row.version } : prev));
                        });
                    } else {
                        setConflictNotice('Could not save — check your connection and try again.');
                    }
                });
                return;
            }
            persistLeague(safe);
            setLeague(safe);
        }, [persistLeague, onlineMeta]);

        const createLeague = useCallback((input) => {
            const createdAt = new Date().toISOString();
            const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'time-league';
            const state = Engine.createTimeLeague({ name: input.name, seed: `${slug}:${createdAt}`, createdAt, settings: input.settings, seats: input.seats });
            persistLeague(state);
            setLeague(state);
            setOnlineMeta(null);
            setTab('draft');
        }, [persistLeague]);

        const createOnlineLeague = useCallback(async (input) => {
            if (!Remote) return { ok: false, error: 'not_configured' };
            const createdAt = new Date().toISOString();
            const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'time-league';
            const state = Engine.createTimeLeague({ name: input.name, seed: `${slug}:${createdAt}`, createdAt, settings: input.settings, seats: input.seats });
            const result = await Remote.createOnlineLeague({ state, seats: input.seats });
            if (!result.ok) return result;
            // Deliberately does NOT set `league`/`tab` here — the caller (Found a League)
            // shows an invite-links screen first and enters the league via onOpenOnline once
            // the founder is done sharing invites, rather than yanking them straight to the draft.
            refreshOnlineIndex();
            return result;
        }, [refreshOnlineIndex]);

        const openLeague = useCallback((leagueId) => {
            const stored = readLeague(leagueId);
            if (!stored) return;
            setOnlineMeta(null);
            setLeague(stored);
            setTab(stored.phase === 'draft' ? 'draft' : 'home');
        }, []);

        const openOnlineLeague = useCallback((rowId) => {
            if (!Remote) return;
            Remote.loadOnlineLeague(rowId).then((row) => {
                const safe = row && Engine.normalizeTimeLeague(row.state);
                if (!safe) return;
                setLeague(safe);
                setOnlineMeta({ rowId: row.id, version: row.version });
                setTab(safe.phase === 'draft' ? 'draft' : 'home');
            });
        }, []);

        const switchLeague = useCallback(() => {
            setLeague(null);
            setOnlineMeta(null);
            setConflictNotice(null);
            refreshOnlineIndex();
        }, [refreshOnlineIndex]);

        const deleteLeague = useCallback((leagueId) => {
            removeLeagueRecord(leagueId);
            setIndex((prev) => { const next = prev.filter((item) => item.leagueId !== leagueId); writeIndexEntries(next); return next; });
            setLeague((prev) => (prev?.leagueId === leagueId ? null : prev));
        }, []);

        const SetupPanel = window.WrTimeLeagueSetupPanel;
        const DraftPanel = window.WrTimeLeagueDraftPanel;
        const TeamPanel = window.WrTimeLeagueTeamPanel;
        const StandingsPanel = window.WrTimeLeagueStandingsPanel;
        const ActivityPanel = window.WrTimeLeagueActivityPanel;
        const GamecastPanel = window.WrTimeLeagueGamecastPanel;
        const HomePanel = window.WrTimeLeagueHomePanel;

        if (!league) {
            return h('div', { className: 'tl-root' },
                h(TimeLeagueStyles, null),
                h('div', { className: 'tl-lobby-wrap' },
                    h('div', { className: 'tl-header tl-lobby-header' },
                        h('div', { className: 'tl-lobby-brand' },
                            h('span', { className: 'tl-lobby-crest' }, 'V'),
                            h('span', null, h('strong', null, 'The Vault'), h('small', null, 'Fantasy football through time'))),
                        h('button', { type: 'button', className: 'tl-btn', onClick: onClose }, '← BACK')),
                    claimingInvite && h('div', { className: 'tl-card', style: { marginBottom: 14 } }, h('p', { className: 'tl-empty' }, 'Claiming your invite…')),
                    inviteError && h('div', { className: 'tl-card', style: { borderColor: 'rgba(240,165,0,0.4)', marginBottom: 14 } },
                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
                            h('span', { style: { fontSize: 12.5, color: 'var(--warn)' } }, `⚠ ${inviteError}`),
                            h('button', { type: 'button', className: 'tl-btn icon', onClick: () => setInviteError(null) }, '✕'))),
                    SetupPanel ? h(SetupPanel, {
                        index, onOpen: openLeague, onDelete: deleteLeague, onCreate: createLeague,
                        onlineIndex, onlineIndexState, onOpenOnline: openOnlineLeague, onCreateOnline: createOnlineLeague,
                    }) : null));
        }

        const tabs = league.phase === 'draft'
            ? ['draft', 'activity']
            : ['home', 'gameday', 'roster', 'waivers', 'trades', 'achievements', 'standings', 'draft', 'activity'];
        const activeTab = tabs.includes(tab) ? tab : tabs[0];
        const activeTeam = league.teams.some((team) => team.teamId === activeTeamId)
            ? activeTeamId
            : (league.teams.find((team) => team.manager === 'human')?.teamId ?? league.teams[0]?.teamId ?? 't1');
        const phaseTone = league.phase === 'draft' ? 'warn' : league.phase === 'season' ? 'info' : 'gold';
        const cardsReady = cards !== null && cards.size > 0;
        const loadingNotice = cards === null
            ? h('div', { className: 'tl-card' }, h('p', { className: 'tl-empty' }, 'Loading player cards…'))
            : h('div', { className: 'tl-card' }, h('p', { className: 'tl-empty tl-pill bad' }, 'Player cards missing — check data/time-league/.'));

        return h('div', { className: 'tl-root' },
            h(TimeLeagueStyles, null),
            h('nav', { className: 'tl-sidenav' },
                h('div', { className: 'tl-sidenav-brand' },
                    h('div', { className: 'tl-sidenav-lockup' },
                        h('span', { className: 'tl-sidenav-crest' }, 'V'),
                        h('span', null, h('strong', null, 'THE VAULT'), h('small', null, 'Fantasy through time')))),
                tabs.map((item) => h('button', {
                    key: item, type: 'button', className: `tl-tabbtn${item === activeTab ? ' active' : ''}`, onClick: () => setTab(item),
                }, h('span', { className: 'tl-tab-icon', 'aria-hidden': 'true' }, TAB_ICONS[item]),
                h('span', null, item === 'draft' && league.phase !== 'draft' ? 'DRAFT RECAP' : TAB_LABELS[item])))),
            h('div', { className: 'tl-main' }, h('div', { className: 'tl-main-inner' },
                h('div', { className: 'tl-card tl-header' },
                    h('div', null,
                        h('div', { className: 'tl-eyebrow', style: { marginBottom: 5 } }, `THE VAULT · ${onlineMeta ? 'FRIENDS LEAGUE' : 'SOLO SEASON'}`),
                        h('div', { className: 'tl-header-title' },
                            h('strong', null, league.name),
                            h('span', { className: `tl-pill ${phaseTone}` }, league.phase.toUpperCase()),
                            onlineMeta ? h('span', { className: 'tl-pill info' }, '🌐 ONLINE') : null),
                        h(EraChipRail, { label: 'Era of Play', chips: EraRules.eraRuleChips(league.settings.eraRules) })),
                    h('div', { className: 'tl-header-tools' },
                        league.phase !== 'draft' ? h('span', { className: 'tl-pill' }, `WK ${Math.min(league.currentWeek, league.settings.regularSeasonWeeks)}/${league.settings.regularSeasonWeeks}`) : null,
                        h('span', { className: 'tl-pill' }, `${league.teams.length} MGRS`),
                        h('button', { type: 'button', className: 'tl-btn', onClick: switchLeague }, 'SWITCH LEAGUE'),
                        h('button', { type: 'button', className: 'tl-btn', onClick: onClose }, '← DASHBOARD'))),
                conflictNotice && h('div', { className: 'tl-card', style: { borderColor: 'rgba(240,165,0,0.4)', marginBottom: 14 } },
                    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 } },
                        h('span', { style: { fontSize: 12.5, color: 'var(--warn)' } }, `⚠ ${conflictNotice}`),
                        h('button', { type: 'button', className: 'tl-btn icon', onClick: () => setConflictNotice(null) }, '✕'))),
                activeTab === 'home' && HomePanel ? h(HomePanel, { league, onNavigate: setTab }) : null,
                activeTab === 'draft' ? (cardsReady && DraftPanel ? h(DraftPanel, { league, cards, onUpdate: handleUpdate }) : loadingNotice) : null,
                activeTab === 'gameday' && GamecastPanel ? h(GamecastPanel, {
                    league, cards, logIndex, logsMissing, eraFactors, onUpdate: handleUpdate, onGoRoster: () => setTab('roster'),
                }) : null,
                (activeTab === 'roster' || activeTab === 'waivers' || activeTab === 'trades' || activeTab === 'achievements')
                    ? (cardsReady && TeamPanel
                        ? h(TeamPanel, { league, cards, section: activeTab, activeTeamId: activeTeam, onSelectTeam: setActiveTeamId, onUpdate: handleUpdate })
                        : loadingNotice)
                    : null,
                activeTab === 'standings' && StandingsPanel ? h(StandingsPanel, { league }) : null,
                activeTab === 'activity' && ActivityPanel ? h(ActivityPanel, { league }) : null)));
    }

    window.TimeLeague = TimeLeagueMode;
})();
