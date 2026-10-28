// ══════════════════════════════════════════════════════════════════
// app.js — OwnerDashboard (root component) + ReactDOM.render
// Must load LAST — depends on all other modules.
// ══════════════════════════════════════════════════════════════════
    const APP_WR_KEYS  = window.App.WR_KEYS;
    const AppStorage = window.App.WrStorage;
    function accountSessionCurrent() {
        return window.App.AccountSession?.isCurrent?.() !== false;
    }
    // Resume is account history, separate from the current URL/route. Keep the
    // ID inside an object: WrStorage parses a bare Sleeper ID as a number and
    // 19-digit IDs exceed JavaScript's integer precision.
    function hubLastVisitKey(sleeperUserId) {
        const accountId = (window.App.OD || window.OD)?.getCurrentUserId?.();
        const owner = accountId ? 'account:' + accountId : sleeperUserId ? 'sleeper:' + sleeperUserId : null;
        return owner ? 'wr_hub_last_visit_v1_' + encodeURIComponent(owner) : null;
    }
    function readHubLastVisit(sleeperUserId) {
        const key = hubLastVisitKey(sleeperUserId);
        const visit = key ? AppStorage.get(key) : null;
        return visit?.version === 1 && typeof visit.id === 'string' ? visit : null;
    }
    function rememberHubLastVisit(league, sleeperUserId) {
        const key = hubLastVisitKey(sleeperUserId);
        if (key && league?.id != null) AppStorage.set(key, { version: 1, id: String(league.id), name: league.name || '' });
    }
    const WR_HOST = window.location.hostname || '';
    const WR_PATH = window.location.pathname || '';
    const PLATFORM_SANDBOX_ACCESS = WR_HOST.includes('sandbox')
        || /\/warroom-sandbox(\/|$)/i.test(WR_PATH)
        || window.SANDBOX_MODE === true
        || ['localhost', '127.0.0.1'].includes(WR_HOST);
    // MFL is re-gated to sandbox-beta-only (2026-07-06; was GA). ESPN/Yahoo remain
    // sandbox-gated via PLATFORM_SANDBOX_ACCESS. Flip to true to relaunch MFL on
    // production — and mirror the mfl-api.js splice in index.html when you do.
    const MFL_ENABLED = false;
    const MFL_SANDBOX_ACCESS = MFL_ENABLED || PLATFORM_SANDBOX_ACCESS;
    function platformAccessAllowed(platform) {
        platform = platform || 'sleeper';
        if (platform === 'sleeper') return true;
        if (platform === 'mfl') return MFL_ENABLED || PLATFORM_SANDBOX_ACCESS;
        return PLATFORM_SANDBOX_ACCESS; // espn / yahoo — sandbox only
    }
    function platformBetaMessage(platform) {
        const labels = { espn: 'ESPN', mfl: 'MFL', yahoo: 'Yahoo' };
        return (labels[platform] || 'This platform') + ' is currently available only in the sandbox beta.';
    }
    window.App.PLATFORM_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
    window.App.MFL_SANDBOX_ACCESS = MFL_SANDBOX_ACCESS;
    window.PLATFORM_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
    window.MFL_SANDBOX_ACCESS = MFL_SANDBOX_ACCESS;
    window.platformAccessAllowed = platformAccessAllowed;

    // Validate the public profile before replacing a durable connection. A
    // typo, unavailable provider or full browser storage must leave it intact.
    async function saveSleeperConnection(username, options = {}) {
        const value = String(username || '').trim();
        if (!value) throw new Error('Enter your Sleeper username.');
        const fetcher = options.fetcher || window.fetch.bind(window);
        const storage = options.storage || window.localStorage;
        let previousAuth, previousSession;
        try {
            previousAuth = storage.getItem('od_auth_v1');
            previousSession = storage.getItem('fw_session_v1');
        } catch (_) {
            throw new Error('Could not access browser storage. Allow storage for Dynasty HQ and try again.');
        }
        const controller = new window.AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
        let user;
        try {
            const response = await fetcher('https://api.sleeper.app/v1/user/' + encodeURIComponent(value), { signal: controller.signal });
            if (response.status === 404) throw new Error('SLEEPER_USER_NOT_FOUND');
            if (!response.ok) throw new Error('SLEEPER_UNAVAILABLE');
            user = await response.json();
            if (user === null) throw new Error('SLEEPER_USER_NOT_FOUND');
            if (!user || !user.user_id || typeof user.username !== 'string' || !user.username.trim()) throw new Error('SLEEPER_UNAVAILABLE');
        } catch (err) {
            if (err.message === 'SLEEPER_USER_NOT_FOUND') throw new Error("Couldn't find that Sleeper username. Check it and try again.");
            if (controller.signal.aborted) throw new Error('Sleeper took too long to respond. Try again.');
            throw new Error('Could not reach Sleeper. Your connection has not changed. Try again.');
        } finally {
            clearTimeout(timer);
        }
        try {
            if (window.App.AccountSession?.isCurrent?.() === false || storage.getItem('fw_session_v1') !== previousSession || storage.getItem('od_auth_v1') !== previousAuth) throw new Error('CONNECTION_CHANGED');
            let existing = {};
            try { existing = JSON.parse(previousAuth || '{}'); } catch (_) { /* replace malformed connection metadata */ }
            const next = JSON.stringify({ ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), sleeperUsername: user.username.trim() });
            storage.setItem('od_auth_v1', next);
            if (storage.getItem('od_auth_v1') !== next) throw new Error('Storage did not retain the connection');
        } catch (err) {
            if (err.message === 'CONNECTION_CHANGED') throw new Error('Your account or connection changed while checking Sleeper. Try again.');
            throw new Error('Could not save your Sleeper connection in this browser. Free up browser storage and try again.');
        }
        return user;
    }

    // A failed provider response cannot prove that every original pick is still
    // owned. Keep the last verified transfers distinct from a verified empty feed.
    async function fetchEmpireTradedPicks(league, options = {}) {
        const id = String(league.id || league.league_id || '');
        const contextKey = String(league.season || '') + ':' + id;
        const previous = options.previous?.contextKey === contextKey ? options.previous : null;
        const unavailable = message => ({ contextKey, picks: previous?.picks, status: Array.isArray(previous?.picks) ? 'stale' : 'unavailable', error: message });
        if (!id || league._espn || league._mfl || (league._source && league._source !== 'sleeper')) return unavailable('Pick ownership is unavailable from this connection.');
        const controller = new window.AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
        try {
            const response = await (options.fetcher || window.fetch.bind(window))('https://api.sleeper.app/v1/league/' + encodeURIComponent(id) + '/traded_picks', { signal: controller.signal });
            if (!response.ok) throw new Error('Pick feed request failed');
            const data = await response.json();
            if (!Array.isArray(data) || data.some(pick => !pick || !Number.isInteger(Number(pick.season)) || Number(pick.season) < 1900 || !Number.isInteger(Number(pick.round)) || Number(pick.round) < 1 || pick.roster_id == null || pick.owner_id == null || !String(pick.roster_id).trim() || !String(pick.owner_id).trim())) throw new Error('Invalid pick feed');
            const normalize = options.normalize || window.App?.normalizeTradedPicks;
            const normalized = normalize ? normalize(league.rosters || [], data) : data;
            const distinct = new Map();
            for (const pick of normalized) {
                const key = [pick.season, pick.round, pick.roster_id].join(':');
                if (distinct.has(key) && String(distinct.get(key).owner_id) !== String(pick.owner_id)) throw new Error('Conflicting pick ownership');
                distinct.set(key, { ...pick, league_id: id });
            }
            return { contextKey, picks: [...distinct.values()], status: 'ready', error: null };
        } catch (_) { return unavailable('Could not verify pick ownership. Retry league sync.'); }
        finally { clearTimeout(timer); }
    }

    // Transfers prove ownership, not whether the draft has consumed the right.
    // Keep progress separate so a failed refresh cannot fabricate unused picks.
    async function fetchEmpireDraftInventory(league, options = {}) {
        const id = String(league.id || league.league_id || '');
        const season = String(league.season || '');
        const contextKey = season + ':' + id;
        const previous = options.previous?.contextKey === contextKey ? options.previous : null;
        const unavailable = () => ({ contextKey, inventory: previous?.inventory, status: previous?.inventory ? 'stale' : 'unavailable', error: 'Could not verify draft progress. Retry pick sync.' });
        const current = options.isCurrent || (() => true);
        if (!id || !/^\d{4}$/.test(season) || league._espn || league._mfl || (league._source && league._source !== 'sleeper')) return unavailable();
        async function read(path) {
            if (!current()) throw Error('Account changed');
            const controller = new window.AbortController();
            const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
            try {
                const response = await (options.fetcher || window.fetch.bind(window))('https://api.sleeper.app/v1/' + path, { signal: controller.signal });
                if (!response.ok) throw Error('Draft unavailable');
                const data = await response.json();
                if (!current()) throw Error('Account changed');
                return data;
            } finally { clearTimeout(timer); }
        }
        try {
            const drafts = await read('league/' + encodeURIComponent(id) + '/drafts');
            if (!Array.isArray(drafts)) throw Error('Invalid drafts');
            const candidates = drafts.filter(draft => String(draft?.season) === season && (!draft.league_id || String(draft.league_id) === id));
            const draft = candidates.find(item => String(item.draft_id) === String(league.draft_id)) || (candidates.length === 1 ? candidates[0] : null);
            if (!draft?.draft_id || !['pre_draft', 'drafting', 'complete'].includes(draft.status)) throw Error('Draft not identified');
            const rounds = Number(draft.settings?.rounds);
            if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw Error('Draft rounds unavailable');
            if (draft.type === 'auction' && draft.status !== 'complete') throw Error('Auction allocations are not round-based pick rights');
            const inventory = { draftId: String(draft.draft_id), season, phase: draft.status, rounds, consumed: [] };
            if (draft.status === 'drafting') {
                const rows = await read('draft/' + encodeURIComponent(draft.draft_id) + '/picks');
                if (!Array.isArray(rows)) throw Error('Draft picks unavailable');
                const slots = { ...(draft.slot_to_roster_id || {}) };
                for (const [owner, slot] of Object.entries(draft.draft_order || {})) {
                    const roster = (league.rosters || []).find(item => String(item.owner_id) === owner);
                    if (slots[slot] == null && roster) slots[slot] = roster.roster_id;
                }
                const consumed = new Map();
                for (const pick of rows) {
                    const round = Number(pick?.round), slot = Number(pick?.draft_slot);
                    const rosterId = slots[slot];
                    if (!pick?.player_id || !Number.isInteger(round) || round < 1 || round > rounds || !Number.isInteger(slot) || slot < 1 || rosterId == null || !(league.rosters || []).some(roster => String(roster.roster_id) === String(rosterId))) throw Error('Draft pick source unavailable');
                    const key = round + ':' + rosterId;
                    if (consumed.has(key) && String(consumed.get(key).playerId) !== String(pick.player_id)) throw Error('Conflicting draft picks');
                    consumed.set(key, { round, rosterId: String(rosterId), playerId: pick.player_id });
                }
                inventory.consumed = [...consumed.values()];
            }
            return { contextKey, inventory, status: 'ready', error: null };
        } catch (_) { return unavailable(); }
    }

    // A league list and its hydrated rosters are separate evidence. Publish
    // coverage alongside streamed usable leagues; missing data is never an empty roster.
    async function fetchSleeperPortfolio(options) {
        const { username, season, onProgress = () => {} } = options;
        const contextKey = String(username).toLowerCase() + ':' + String(season);
        const previous = options.previous?.contextKey === contextKey ? options.previous : {};
        const fetcher = options.fetcher || window.fetch.bind(window);
        async function read(path) {
            const controller = new window.AbortController();
            const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
            try {
                const response = await fetcher('https://api.sleeper.app/v1/' + path, { signal: controller.signal });
                if (!response.ok) throw new Error('Sleeper request failed');
                return await response.json();
            } finally { clearTimeout(timer); }
        }
        let user, listed;
        try {
            user = await read('user/' + encodeURIComponent(username));
            if (!user?.user_id) throw new Error('SLEEPER_USER_NOT_FOUND');
            listed = await read('user/' + encodeURIComponent(user.user_id) + '/leagues/nfl/' + encodeURIComponent(season));
            if (!Array.isArray(listed) || listed.some(league => !league?.league_id)) throw new Error('Invalid league list');
        } catch (err) {
            const leagues = (previous.leagues || []).map(league => ({ ...league, _portfolioStale: true }));
            const coverage = { ...(previous.coverage || {}), status: leagues.length ? 'stale' : 'error', listVerified: false, pendingCount: 0, freshCount: 0, staleCount: leagues.length, loadedCount: leagues.length,
                error: err.message === 'SLEEPER_USER_NOT_FOUND' ? "Couldn't find that Sleeper username. Check your connection and try again." : 'Could not refresh the Sleeper league list. Try again.' };
            const result = { contextKey, user: previous.user || user || null, leagues, coverage };
            onProgress(result);
            return result;
        }
        // Defensive deduplication avoids inflating either the denominator or requests.
        const known = [...new Map(listed.map(league => [String(league.league_id), league])).values()];
        const old = new Map((previous.leagues || []).map(league => [String(league.id), league]));
        const fresh = new Map(), failed = new Set(), pending = new Set(known.map(league => String(league.league_id)));
        const snapshot = () => {
            const leagues = known.map(league => {
                const id = String(league.league_id);
                return fresh.get(id) || (old.has(id) ? { ...old.get(id), _portfolioStale: true } : null);
            }).filter(Boolean);
            const unavailable = known.filter(league => !fresh.has(String(league.league_id)) && !old.has(String(league.league_id))).map(league => ({ id: String(league.league_id), name: league.name || 'League' }));
            return { contextKey, user, leagues, coverage: {
                status: pending.size ? 'loading' : failed.size ? (leagues.length ? 'partial' : 'error') : 'ready',
                listVerified: true, knownCount: known.length, loadedCount: leagues.length, freshCount: fresh.size,
                staleCount: leagues.length - fresh.size, failedCount: failed.size, pendingCount: pending.size,
                knownLeagues: known.map(league => ({ id: String(league.league_id), name: league.name || 'League' })),
                unavailable, error: failed.size ? 'Some Sleeper league details could not load.' : null,
            } };
        };
        onProgress(snapshot());
        await Promise.all(known.map(async league => {
            const id = String(league.league_id);
            try {
                const [rosters, users] = await Promise.all([read('league/' + encodeURIComponent(id) + '/rosters'), read('league/' + encodeURIComponent(id) + '/users')]);
                if (!Array.isArray(rosters) || !Array.isArray(users) || rosters.some(roster => !roster || roster.roster_id == null || (roster.players != null && !Array.isArray(roster.players)))) throw new Error('Invalid league details');
                const mine = rosters.find(roster => String(roster.owner_id) === String(user.user_id));
                fresh.set(id, { id, total_rosters: league.total_rosters, name: league.name, status: league.status || '', season: String(season),
                    wins: mine?.settings?.wins || 0, losses: mine?.settings?.losses || 0, ties: mine?.settings?.ties || 0,
                    scoring_settings: league.scoring_settings || {}, roster_positions: league.roster_positions || [],
                    settings: league.settings || {}, rosters, users, _portfolioStale: false });
            } catch (_) { failed.add(id); }
            finally { pending.delete(id); onProgress(snapshot()); }
        }));
        // Return the snapshot directly: React may defer state-updater callbacks.
        return snapshot();
    }

    // League IDs identify a season. Verify that year's connected league list
    // before restoring a bookmark missing from the current-year portfolio.
    async function fetchSleeperLinkedLeague(options) {
        const id = String(options.leagueId || '');
        const current = options.isCurrent || (() => true);
        if (!id || !options.username) throw new Error('Connect your Sleeper account to open this league link.');
        async function read(path) {
            if (!current()) throw new Error('Account changed. Reopen this link from your current account.');
            const controller = new window.AbortController();
            const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
            try {
                const response = await (options.fetcher || window.fetch.bind(window))('https://api.sleeper.app/v1/' + path, { signal: controller.signal });
                if (!response.ok) throw new Error('League unavailable. Retry when Sleeper is available.');
                const value = await response.json();
                if (!current()) throw new Error('Account changed. Reopen this link from your current account.');
                return value;
            } finally { clearTimeout(timer); }
        }
        const info = await read('league/' + encodeURIComponent(id));
        const season = String(info?.season || '');
        if (String(info?.league_id || '') !== id || !/^\d{4}$/.test(season) || Number(season) < 2000 || Number(season) > new Date().getFullYear() + 1 || (info.sport && info.sport !== 'nfl')) throw new Error('This link does not identify a valid football league season.');
        const user = options.user?.user_id ? options.user : await read('user/' + encodeURIComponent(options.username));
        if (!user?.user_id) throw new Error('Sleeper account unavailable. Check your connection and retry.');
        const list = await read('user/' + encodeURIComponent(user.user_id) + '/leagues/nfl/' + season);
        if (!Array.isArray(list)) throw new Error('Could not verify your leagues for ' + season + '. Retry this link.');
        const owned = list.find(league => String(league?.league_id) === id);
        if (!owned) throw new Error('This league is not connected to your Sleeper account for ' + season + '. Check your account or the link.');
        const [rosters, users] = await Promise.all([read('league/' + encodeURIComponent(id) + '/rosters'), read('league/' + encodeURIComponent(id) + '/users')]);
        if (!Array.isArray(rosters) || !Array.isArray(users) || rosters.some(roster => !roster || roster.roster_id == null || (roster.players != null && !Array.isArray(roster.players)) || (roster.co_owners != null && !Array.isArray(roster.co_owners)))) throw new Error('League details are unavailable. Retry this link.');
        const mine = rosters.find(roster => String(roster.owner_id) === String(user.user_id) || (roster.co_owners || []).some(owner => String(owner) === String(user.user_id)));
        return { user, league: { ...owned, ...info, id, season, rosters, users, myRosterId: mine?.roster_id,
            wins: mine?.settings?.wins || 0, losses: mine?.settings?.losses || 0, ties: mine?.settings?.ties || 0, _portfolioStale: false } };
    }

    // Read-only ownership context for shared player cards. This uses connected
    // account rosters only; an unhydrated league is unknown, never a zero holding.
    // player(pid) -> {count,totalLeagues,coveredLeagues,complete,leagues:[{id,name,teamName}]}.
    function buildPortfolioPlayerContext(leagues, userId, pid, coverage) {
        const unique = new Map();
        (leagues || []).forEach(l => { const id = l && (l.id || l.league_id); if (id != null) unique.set(String(id), l); });
        const holdings = [];
        let coveredLeagues = 0;
        const same = (a, b) => a != null && b != null && String(a) === String(b);
        unique.forEach((l, id) => {
            const roster = (l.rosters || []).find(r => same(r.owner_id, userId) || same(r.owner_id, l.myUserId) || same(r.roster_id, l.myRosterId));
            if (!roster || !Array.isArray(roster.players)) return;
            coveredLeagues++;
            const players = new Set([].concat(roster.players, roster.reserve || [], roster.taxi || []).filter(p => p && String(p) !== '0').map(String));
            if (pid != null && players.has(String(pid))) holdings.push({ id, name: l.name || 'League', teamName: roster.metadata?.team_name || l.teamName || '' });
        });
        const totalLeagues = unique.size + Math.max(0, (coverage?.knownCount || 0) - (coverage?.loadedCount || 0));
        return { count: holdings.length, totalLeagues, coveredLeagues, complete: coveredLeagues === totalLeagues && (!coverage || coverage.status === 'ready'), leagues: holdings };
    }
    window.App.PortfolioContext = { player: () => buildPortfolioPlayerContext([], null, null) };

    // ── PRE-LIVE: Empire Dashboard is free for everyone until launch. ──
    // Flip to false (or delete) to restore the paid gate before going live.
    const EMPIRE_FREE_PRELIVE = true;
    window.App.EMPIRE_FREE_PRELIVE = EMPIRE_FREE_PRELIVE;

    // Main hub modes are available on production and local instances.
    // Existing subscription and commissioner-ownership checks still apply.
    const EMPIRE_ENABLED = true;
    window.App.EMPIRE_ENABLED = EMPIRE_ENABLED;
    const COMMISH_ENABLED = true;
    window.App.COMMISH_ENABLED = COMMISH_ENABLED;
    const TIME_LEAGUE_ENABLED = true;
    window.App.TIME_LEAGUE_ENABLED = TIME_LEAGUE_ENABLED;

    // ── Owner default: bigloco's locked-in MFL franchise in the "MLS Dynasty
    // League" (id 41969). Used to auto-select the team on rehydrate when no
    // mfl_franchise_id is persisted yet. Matched by NAME in loadMflData so the
    // pick survives storage clears / new devices without pinning a numeric id. ──
    const OWNER_MFL_TEAM = 'St. Louis City SC';

    // ── Notes from the Front — Field Log feed from Scout sessions ──
    var FL_CAT_COLORS = { trade:'var(--k-d4af37, #d4af37)', roster:'var(--k-2ecc71, #2ecc71)', draft:'var(--k-3498db, #3498db)', waivers:'var(--k-9b59b6, #9b59b6)', research:'var(--k-e67e22, #e67e22)', note:'var(--k-808080, #808080)' };
    var FL_CAT_ICONS  = { trade:'🔄', roster:'📋', draft:'🎯', waivers:'📡', research:'🔍', note:'📝' };

    function FieldLogPanel(props) {
        var leagues = props.leagues || [];
        var onOpenLeague = props.onOpenLeague;
        var _s1 = React.useState(null);  var entries = _s1[0]; var setEntries = _s1[1];
        var _s2 = React.useState(false); var syncing = _s2[0]; var setSyncing = _s2[1];
        var _s3 = React.useState(0);     var lastRefresh = _s3[0]; var setLastRefresh = _s3[1];
        var _s4 = React.useState(false); var noSupabase = _s4[0]; var setNoSupabase = _s4[1];

        React.useEffect(function() {
            if (!window.OD || !window.OD.loadFieldLog) { setNoSupabase(true); setEntries([]); return; }
            setNoSupabase(false);
            window.OD.loadFieldLog(window.S?.currentLeagueId || null, 60)
                .then(function(data) { setEntries(data || []); })
                .catch(function() { setEntries([]); });
        }, [lastRefresh]);

        // Auto-refresh field log every 60 seconds
        React.useEffect(function() {
            var interval = setInterval(function() { setLastRefresh(Date.now()); }, 60000);
            return function() { clearInterval(interval); };
        }, []);

        var grouped = React.useMemo(function() {
            if (!entries || !entries.length) return [];
            var groups = {};
            entries.forEach(function(e) {
                var d = new Date(e.ts);
                var key = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
                if (!groups[key]) groups[key] = { label: key, ts: e.ts, items: [] };
                groups[key].items.push(e);
            });
            return Object.values(groups).sort(function(a,b) { return b.ts - a.ts; });
        }, [entries]);

        function handleManualSync() {
            if (!window.OD || !window.OD.syncPendingFieldLog) return;
            setSyncing(true);
            window.OD.syncPendingFieldLog().catch(function(){}).then(function() {
                setLastRefresh(Date.now());
                setSyncing(false);
            });
        }

        var pendingCount = (entries || []).filter(function(e) { return e.syncStatus === 'pending' || e.syncStatus === 'failed'; }).length;

        return React.createElement('div', { className: 'product-card', style: { gridColumn: '1 / -1' } },
            // Header row
            React.createElement('div', { className: 'product-card-header', style: { marginBottom: '0.75rem' } },
                React.createElement('div', { style: { width:40,height:40,borderRadius:10,background:'rgba(124,107,248,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.2rem',flexShrink:0 } }, '📋'),
                React.createElement('div', { style: { flex:1 } },
                    React.createElement('div', { className: 'product-card-title' }, 'NOTES FROM THE FRONT'),
                    React.createElement('div', { className: 'product-card-subtitle' }, 'Intel logged in your Scout sessions')
                ),
                React.createElement('button', { onClick: handleManualSync, disabled: syncing, style: { flexShrink:0,background:'none',border:'1px solid rgba(124,107,248,0.4)',borderRadius:6,color:'var(--k-7c6bf8, #7c6bf8)',fontSize:'var(--text-label, 0.75rem)',padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:700,opacity:syncing?0.5:1,minHeight:'44px',display:'inline-flex',alignItems:'center',justifyContent:'center' } },
                    syncing ? '↻ Syncing…' : '↻ Refresh'
                )
            ),
            // Body
            entries === null
                ? React.createElement('div', { style: { padding:'1rem 0',textAlign:'center',color:'var(--silver)',fontSize:'var(--text-body, 1rem)' } }, 'Loading field log…')
                : entries.length === 0
                ? (noSupabase
                    ? React.createElement('div', { style: { padding:'1.5rem 0',textAlign:'center' } },
                        React.createElement('div', { style: { fontSize:'1.6rem',marginBottom:'0.5rem' } }, '🔌'),
                        React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)',color:'var(--silver)',lineHeight:1.6 } }, 'Connect your Scout account to see field notes.')
                      )
                    : React.createElement('div', { style: { padding:'1.5rem 0',textAlign:'center' } },
                        React.createElement('div', { style: { fontSize:'2rem',marginBottom:'0.5rem' } }, '📋'),
                        React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)',color:'var(--silver)',lineHeight:1.6 } }, 'No field log entries yet. Actions you take in Scout — trade scenarios, draft targets, waiver bids — will appear here automatically after syncing.')
                      )
                  )
                : React.createElement('div', { style: { maxHeight:'340px',overflowY:'auto',paddingRight:'2px' } },
                    grouped.map(function(group) {
                        return React.createElement('div', { key: group.label, style: { marginBottom:'14px' } },
                            React.createElement('div', { style: { fontSize:'var(--text-label, 0.75rem)',fontWeight:700,color:'var(--silver)',textTransform:'uppercase',letterSpacing:'0.08em',padding:'0 0 5px',borderBottom:'1px solid var(--ov-4, rgba(255,255,255,0.06))',marginBottom:'6px',opacity:0.7 } }, group.label),
                            group.items.map(function(entry, idx) {
                                var timeStr = new Date(entry.ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
                                var catColor = FL_CAT_COLORS[entry.category] || 'var(--k-808080, #808080)';
                                var targetLeague = entry.leagueId ? leagues.find(function(l) { return l.id === entry.leagueId; }) : null;
                                return React.createElement('div', { key: entry.id || idx, style: { display:'flex',gap:'8px',alignItems:'flex-start',padding:'5px 0',borderBottom:'1px solid var(--ov-2, rgba(255,255,255,0.03))' } },
                                    React.createElement('span', { style: { fontSize:'var(--text-body, 1rem)',flexShrink:0,marginTop:'1px' } }, entry.icon || FL_CAT_ICONS[entry.category] || '📋'),
                                    React.createElement('div', { style: { flex:1,minWidth:0 } },
                                        React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)',color:'var(--white)',lineHeight:1.35 } }, entry.text),
                                        entry.players && entry.players.length > 0 && React.createElement('div', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--k-7c6bf8, #7c6bf8)',marginTop:'2px' } }, entry.players.map(function(p){ return p.name||p; }).join(', ')),
                                        entry.context && React.createElement('div', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',marginTop:'2px',fontStyle:'italic',opacity:0.8,lineHeight:1.3 } }, entry.context),
                                        React.createElement('div', { style: { display:'flex',gap:'5px',alignItems:'center',marginTop:'3px',flexWrap:'wrap' } },
                                            React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:catColor,fontWeight:700,textTransform:'uppercase' } }, entry.category),
                                            React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.4 } }, '·'),
                                            React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.6 } }, timeStr),
                                            targetLeague && React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.4 } }, '·'),
                                            targetLeague && React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.7 } }, targetLeague.name)
                                        )
                                    ),
                                    targetLeague && onOpenLeague && React.createElement('button', { onClick: function(){ onOpenLeague(targetLeague, entry.category); }, style: { flexShrink:0,background:'none',border:'1px solid var(--acc-line2, rgba(212,175,55,0.35))',borderRadius:4,color:'var(--gold)',fontSize:'var(--text-label, 0.75rem)',padding:'2px 7px',cursor:'pointer',fontFamily:'inherit',fontWeight:700,marginTop:'1px',minHeight:'44px',minWidth:'44px',display:'inline-flex',alignItems:'center',justifyContent:'center' } }, 'OPEN →')
                                );
                            })
                        );
                    })
                  ),
            // Footer
            entries !== null && pendingCount > 0 && React.createElement('div', { style: { marginTop:'8px',paddingTop:'8px',borderTop:'1px solid var(--ov-4, rgba(255,255,255,0.06))',fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.7 } }, pendingCount + ' entries pending sync from Scout. Open Scout to push them.')
        );
    }

    // ── ESPN Connect Card ─────────────────────────────────────────
    function ESPNConnectCard({ leagues, connecting, error, onConnect, onSelectLeague, reconBase }) {
        const [leagueId, setLeagueId]   = React.useState('');
        const [espnS2, setEspnS2]       = React.useState('');
        const [swid, setSwid]           = React.useState('');
        const [showCreds, setShowCreds] = React.useState(false);

        const RED = 'var(--k-cc0000, #cc0000)';
        const RED_BG = 'rgba(204,0,0,0.08)';
        const RED_BORDER = 'rgba(204,0,0,0.3)';

        function espnScoutUrl(numericId) {
            return reconBase + '?espn_league=' + numericId;
        }

        if (leagues.length > 0) {
            return React.createElement('div', null,
                leagues.map(function(l) {
                    return React.createElement('div', {
                        key: l.id,
                        style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: RED_BG, border: '1px solid ' + RED_BORDER, borderRadius: 10, marginBottom: 8, cursor: 'pointer' },
                        onClick: function() { onSelectLeague(l); }
                    },
                        React.createElement('div', { style: { width: 32, height: 32, borderRadius: 8, background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
                            React.createElement('span', { style: { fontSize: 13, fontWeight: 800, color: 'var(--k-ffffff, #ffffff)' } }, 'E')
                        ),
                        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 600, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, l.name),
                            React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: 2 } },
                                (l.rosters || []).length + ' teams · ' + l.season + ' · ESPN'
                            )
                        ),
                        React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 800, background: RED, color: 'var(--k-ffffff, #ffffff)', borderRadius: 4, padding: '2px 6px', flexShrink: 0 } }, 'ESPN')
                    );
                }),
                React.createElement('a', {
                    href: espnScoutUrl(leagues[0]._espnLeagueId),
                    target: '_blank', rel: 'noopener noreferrer',
                    className: 'hub-cta',
                    style: { textDecoration: 'none', background: RED, marginTop: 4, display: 'block', textAlign: 'center', padding: '10px', borderRadius: 8, fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--k-ffffff, #ffffff)', letterSpacing: '.06em' }
                }, 'OPEN IN SCOUT →'),
                React.createElement('button', {
                    onClick: function() { /* allow reconnecting */ },
                    style: { background: 'none', border: 'none', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', cursor: 'pointer', marginTop: 6, padding: 0 }
                }, '+ Connect another league')
            );
        }

        return React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.6 } },
                'Connect any ESPN Fantasy Football league. Your League ID is in the URL: fantasy.espn.com/football/league?leagueId=',
                React.createElement('strong', { style: { color: 'var(--white)' } }, '123456')
            ),
            React.createElement('input', {
                placeholder: 'ESPN League ID (e.g. 123456)',
                value: leagueId,
                onChange: function(e) { setLeagueId(e.target.value); },
                onKeyDown: function(e) { if (e.key === 'Enter') onConnect(leagueId, espnS2, swid); },
                style: { width: '100%', fontSize: 'var(--text-body, 1rem)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'var(--charcoal)', color: 'var(--white)', boxSizing: 'border-box', marginBottom: 8, fontFamily: 'inherit' }
            }),
            React.createElement('div', {
                onClick: function() { setShowCreds(!showCreds); },
                style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', cursor: 'pointer', marginBottom: showCreds ? 8 : 0, display: 'flex', alignItems: 'center', gap: 4 }
            },
                React.createElement('span', null, showCreds ? '▾' : '▸'),
                ' Private league? Add cookies for access'
            ),
            showCreds && React.createElement('div', { style: { marginBottom: 8 } },
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.5, marginBottom: 6 } },
                    'F12 → Application → Cookies → fantasy.espn.com — copy espn_s2 and SWID values.'
                ),
                React.createElement('input', {
                    placeholder: 'espn_s2 cookie value',
                    type: 'password',
                    value: espnS2,
                    onChange: function(e) { setEspnS2(e.target.value); },
                    style: { width: '100%', fontSize: 'var(--text-body, 1rem)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'var(--charcoal)', color: 'var(--white)', boxSizing: 'border-box', marginBottom: 6, fontFamily: 'monospace' }
                }),
                React.createElement('input', {
                    placeholder: 'SWID cookie value {XXXXXXXX-...}',
                    value: swid,
                    onChange: function(e) { setSwid(e.target.value); },
                    style: { width: '100%', fontSize: 'var(--text-body, 1rem)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'var(--charcoal)', color: 'var(--white)', boxSizing: 'border-box', fontFamily: 'monospace' }
                })
            ),
            error && React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--k-e74c3c, #e74c3c)', marginBottom: 8, padding: '6px 10px', background: 'rgba(231,76,60,0.08)', borderRadius: 6, lineHeight: 1.5 } }, error),
            React.createElement('button', {
                onClick: function() { onConnect(leagueId, espnS2, swid); },
                disabled: connecting,
                style: { width: '100%', padding: '10px', background: connecting ? 'rgba(204,0,0,0.5)' : RED, color: 'var(--k-ffffff, #ffffff)', border: 'none', borderRadius: 8, fontSize: 'var(--text-body, 1rem)', fontWeight: 700, cursor: connecting ? 'not-allowed' : 'pointer', letterSpacing: '.05em', fontFamily: 'inherit' }
            }, connecting ? 'Connecting...' : 'CONNECT ESPN LEAGUE')
        );
    }

    // Main Dashboard
    function OwnerDashboard() {
        const defaultTab = window.WR?.LeagueWorkspaces?.defaultTab?.() || 'dashboard';
        const [showSettings, setShowSettings] = useState(false);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [sleeperUser, setSleeperUser] = useState(null);
        const [selectedYear, setSelectedYear] = useState('2026');
        const [sleeperLeagues, setSleeperLeagues] = useState([]);
        const [sleeperCoverage, setSleeperCoverage] = useState({ status: 'idle', knownCount: null, loadedCount: 0 });
        const sleeperSnapshotRef = React.useRef({ user: null, leagues: [], coverage: { status: 'idle', knownCount: null, loadedCount: 0 } });
        const [activeLeagueId, setActiveLeagueId] = useState(null);
        const [selectedLeague, setSelectedLeague] = useState(null);
        const [leagueRouteStatus, setLeagueRouteStatus] = useState({ status: 'idle' });
        const linkedLeaguesRef = React.useRef(new Map());
        const linkedRouteRequestRef = React.useRef(0);
        const [allWireOpen, setAllWireOpen] = useState(false);
        const [proMode, setProMode] = useState(false); // Empire Dashboard mode
        const [leagueQuery, setLeagueQuery] = useState('');
        const [hubAllLeagues, setHubAllLeagues] = useState(false);
        const [showConnect, setShowConnect] = useState(false); // hub: show platform connect / add-league view
        // Lifted tab state for browser history navigation
        const [activeTab, setActiveTab] = useState(defaultTab);
        const isNavigatingRef = React.useRef(false);
        const initialRouteAppliedRef = React.useRef(false);
        // When the hub's league cards (records/rosters) last finished loading —
        // drives the return-to-hub freshness check below (audit:refresh-stale step 10).
        const hubSyncedAtRef = React.useRef(0);
        // Guards against overlapping background hub revalidations.
        const hubRevalidatingRef = React.useRef(null);
        // ESPN state
        const [espnLeagues, setEspnLeagues] = useState([]);
        const [espnConnecting, setEspnConnecting] = useState(false);
        // MFL state
        const [mflLeagues, setMflLeagues] = useState([]);
        const [mflConnecting, setMflConnecting] = useState(false);
        const [mflError, setMflError] = useState(null);
        const [mflFranchises, setMflFranchises] = useState(null);
        const [mflPendingResult, setMflPendingResult] = useState(null);
        const visibleEspnLeagues = PLATFORM_SANDBOX_ACCESS ? espnLeagues : [];
        const visibleMflLeagues = MFL_SANDBOX_ACCESS ? mflLeagues : [];
        useEffect(() => {
            const connected = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
            window.App.PortfolioContext.player = pid => buildPortfolioPlayerContext(connected, sleeperUser?.user_id, pid, sleeperCoverage.status === 'idle' ? null : sleeperCoverage);
            return () => { window.App.PortfolioContext.player = () => buildPortfolioPlayerContext([], null, null); };
        }, [sleeperLeagues, sleeperCoverage, espnLeagues, mflLeagues, sleeperUser?.user_id]);
        const [espnError, setEspnError] = useState(null);
        // Sleeper username — read from localStorage (login.html stores 'username', inline connect stores 'sleeperUsername')
        const sleeperUsername = React.useMemo(() => {
            return window.OD?.getCurrentUsername?.() || null;
        }, []);
        const [sleeperConnectInput, setSleeperConnectInput] = useState(sleeperUsername || '');
        const [sleeperConnecting, setSleeperConnecting] = useState(false);
        const [sleeperConnectError, setSleeperConnectError] = useState(null);
        const sleeperConnectPendingRef = React.useRef(false);

        async function handleSleeperConnect(event) {
            event?.preventDefault();
            if (sleeperConnectPendingRef.current) return;
            sleeperConnectPendingRef.current = true;
            setSleeperConnecting(true);
            setSleeperConnectError(null);
            try {
                await saveSleeperConnection(sleeperConnectInput);
                window.location.reload();
            } catch (err) {
                setSleeperConnectError(err.message);
            } finally {
                sleeperConnectPendingRef.current = false;
                setSleeperConnecting(false);
            }
        }

        // Display name state
        const [customDisplayName, setCustomDisplayName] = useState(() => {
            return localStorage.getItem('od_display_name') || '';
        });

        // Cloud sync — load from Supabase on mount
        useEffect(() => {
            if (!accountSessionCurrent()) return;
            if (window.OD?.loadDisplayName) {
                window.OD.loadDisplayName().then(name => {
                    if (!accountSessionCurrent()) return;
                    if (name) { setCustomDisplayName(name); localStorage.setItem('od_display_name', name); }
                }).catch(err => window.wrLog('app.loadDisplayName', err));
            }
        }, []);
        const leagueMates = React.useMemo(() => {
            const seen = new Set();
            // seed with current user's id so we exclude ourselves
            if (sleeperUser?.user_id) seen.add(sleeperUser.user_id);
            const mates = [];
            sleeperLeagues.forEach(league => {
                (league.users || []).forEach(u => {
                    const uid = u.user_id;
                    if (uid && !seen.has(uid)) {
                        seen.add(uid);
                        mates.push(u);
                    }
                });
            });
            return mates.sort((a, b) => (a.display_name || a.username || '').localeCompare(b.display_name || b.username || ''));
        }, [sleeperLeagues, sleeperUser]);

        // ── Browser History Navigation ──
        function buildHash(leagueId, tab) {
            return '#league=' + leagueId + '&tab=' + (tab || defaultTab);
        }
        function routeUrl(hash) {
            const query = new URLSearchParams(window.location.search || '');
            query.delete('league');
            query.delete('leagueId');
            query.delete('tab');
            const qs = query.toString();
            return window.location.pathname + (qs ? '?' + qs : '') + (hash || '');
        }
        function parseHash(hash) {
            const params = new URLSearchParams((hash || '').replace('#', ''));
            const query = new URLSearchParams(window.location.search || '');
            // Legacy 'brief' tab was folded into dashboard — redirect old bookmarks
            const rawTab = params.get('tab') || query.get('tab') || defaultTab;
            const tab = rawTab === 'brief' ? 'dashboard' : rawTab;
            return {
                leagueId: params.get('league') || query.get('league') || query.get('leagueId'),
                tab,
            };
        }

        function cancelLinkedLeagueRoute(clearRoute = false) {
            initialRouteAppliedRef.current = true;
            linkedRouteRequestRef.current++;
            setLeagueRouteStatus({ status: 'idle' });
            if (clearRoute && parseHash(window.location.hash).leagueId) history.replaceState({ view: 'hub' }, '', routeUrl(''));
        }
        function restoreLinkedLeague(league, route, providerUserId = sleeperUser?.user_id) {
            if (!accountSessionCurrent()) return;
            isNavigatingRef.current = true;
            setActiveLeagueId(league.id);
            setSelectedLeague(league);
            const tab = route.tab === 'brief' ? 'dashboard' : (route.tab || defaultTab);
            setActiveTab(tab);
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_ID, league.id);
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_NAME, league.name);
            rememberHubLastVisit(league, providerUserId);
            history.replaceState({ view: 'league', leagueId: league.id, tab }, '', routeUrl(buildHash(league.id, tab)));
            setTimeout(() => { isNavigatingRef.current = false; }, 0);
        }
        async function resolveLinkedLeagueRoute(route) {
            if (!accountSessionCurrent()) return;
            const request = ++linkedRouteRequestRef.current;
            const current = () => request === linkedRouteRequestRef.current && accountSessionCurrent() && String(parseHash(window.location.hash).leagueId) === String(route.leagueId);
            setSelectedLeague(null);
            setProMode(false);
            setLeagueRouteStatus({ status: 'loading', route });
            try {
                const result = await fetchSleeperLinkedLeague({ leagueId: route.leagueId, username: sleeperUsername, user: sleeperUser, isCurrent: current });
                if (!current()) return;
                linkedLeaguesRef.current.set(String(result.league.id), result.league);
                if (!sleeperUser) setSleeperUser(result.user);
                initialRouteAppliedRef.current = true;
                restoreLinkedLeague(result.league, route, result.user.user_id);
                setLeagueRouteStatus({ status: 'idle' });
            } catch (error) {
                if (!current()) return;
                setLeagueRouteStatus({ status: 'error', route, message: error.name === 'AbortError' ? 'League lookup timed out. Retry this link.' : error.message });
            }
        }

        useEffect(() => {
            if (sleeperUsername) loadSleeperData();
        }, [selectedYear]);

        // Build the hub league object from a mapped MFL result. Shared by the
        // connect flow (finalizeMFLConnect) and the on-load rehydrator
        // (loadMflData) so both produce an identical shape.
        function buildMflLeagueObj(result, leagueId, franchiseId) {
            const lg = result.league || {};
            return {
                id: lg.league_id,
                league_id: lg.league_id,
                name: lg.name,
                season: lg.season,
                // Draft-driven status ('pre_draft'/'drafting'/'in_season') so the
                // rookie-waiver lock + live-draft tool engage; was dropped before.
                status: lg.status || 'in_season',
                total_rosters: lg.total_rosters,
                wins: 0, losses: 0, ties: 0,
                rosters: result.rosters,
                scoring_settings: lg.scoring_settings,
                roster_positions: lg.roster_positions,
                settings: lg.settings || {},
                users: result.leagueUsers,
                // Status-bearing drafts (collectFaDrafts + draft-room read these).
                drafts: result.drafts || [],
                // Multi-copy availability map (copies + per-pid roster counts).
                _availability: lg._availability || null,
                _source: 'mfl',
                _mfl: true,
                _mflLeagueId: leagueId,
                _mflFranchiseId: franchiseId || null,
                _mflDraftPlayerPool: lg._mflDraftPlayerPool || '',
                _mflDraftTimer: lg._mflDraftTimer || '',
                _mflDraftLimitHours: lg._mflDraftLimitHours || '',
                _mflDraftKind: lg._mflDraftKind || '',
                _mflLockout: lg._mflLockout || '',
            };
        }

        // ── MFL rehydration ──
        // Sleeper leagues reload from the username on every launch; MFL has no
        // such identity, so a connected league would vanish on refresh. We
        // persist the connection (id / year / team) and re-fetch it on mount so
        // a locked-in MFL league always reappears in the franchise picker.
        useEffect(() => {
            if (!MFL_SANDBOX_ACCESS || !accountSessionCurrent()) return;
            let alive = true;
            (async () => {
                // Resolve the connection: prefer local, else pull the cloud-synced
                // one so a fresh device rehydrates the MFL league + team without a
                // manual reconnect (mirrors how Sleeper rehydrates from the username).
                let leagueId = localStorage.getItem('mfl_league_id');
                if (!leagueId && window.OD?.loadMflConnection) {
                    try {
                        const conn = await window.OD.loadMflConnection();
                        if (!alive || !accountSessionCurrent()) return;
                        if (conn?.leagueId) {
                            leagueId = String(conn.leagueId);
                            localStorage.setItem('mfl_league_id', leagueId);
                            if (conn.year) localStorage.setItem('mfl_year', String(conn.year));
                            if (conn.franchiseId) localStorage.setItem('mfl_franchise_id', String(conn.franchiseId));
                        }
                    } catch (e) { window.wrLog?.('app.loadMflConnection', e); }
                }
                if (!alive || !accountSessionCurrent() || !leagueId) return;
                // mfl-api.js ships in the shared bundle, but guard against the
                // connector not being ready yet on a cold start.
                for (let i = 0; i < 50 && !window.MFL; i++) {
                    await new Promise(r => setTimeout(r, 100));
                }
                if (!alive || !accountSessionCurrent() || !window.MFL) return;
                const year = localStorage.getItem('mfl_year') || '2026';
                const apiKey = sessionStorage.getItem('mfl_api_key') || null;
                let franchiseId = localStorage.getItem('mfl_franchise_id') || null;
                try {
                    const raw = await window.MFL.fetchLeague(leagueId, year, apiKey);
                    if (!alive || !accountSessionCurrent() || !raw?.leagueData?.league) return;
                    const franchisesRaw = raw.leagueData?.league?.franchises?.franchise || [];
                    const franchiseArr = Array.isArray(franchisesRaw) ? franchisesRaw : [franchisesRaw];
                    // Owner default: if bigloco hasn't picked a team yet, lock in the
                    // known franchise (OWNER_MFL_TEAM) by name and persist its id so
                    // it sticks across reloads / devices.
                    if (!franchiseId && (sleeperUsername || '').toLowerCase() === 'bigloco') {
                        const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const owned = franchiseArr.find(f => norm(f.name) === norm(OWNER_MFL_TEAM));
                        if (owned) { franchiseId = owned.id; localStorage.setItem('mfl_franchise_id', String(owned.id)); }
                    }
                    const mflPlayerArr = raw.playersData?.players?.player || [];
                    const allMflPlayers = Array.isArray(mflPlayerArr) ? mflPlayerArr : [mflPlayerArr];
                    const crosswalk = window.MFL.buildCrosswalk({}, allMflPlayers, year);
                    const result = window.MFL.mapToSleeperState(raw, leagueId, year, crosswalk);
                    if (!alive) return;
                    const league = buildMflLeagueObj(result, leagueId, franchiseId);
                    setMflLeagues(prev => {
                        const filtered = prev.filter(l => l._mflLeagueId !== league._mflLeagueId);
                        return [...filtered, league];
                    });
                    // Keep the cloud copy in sync — backfills a league first
                    // connected on this device so it follows the account elsewhere.
                    window.OD?.saveMflConnection?.({ leagueId, year, franchiseId });
                    // Still no team (non-owner, or name not matched)? Prime the
                    // franchise picker so it can be locked in one click from the MFL card.
                    if (!franchiseId) {
                        setMflFranchises(franchiseArr);
                        setMflPendingResult(result);
                    }
                } catch (e) {
                    window.wrLog?.('app.loadMflData', e);
                }
            })();
            return () => { alive = false; };
        }, []);

        function syncSleeperPortfolio() {
            if (!sleeperUsername) return Promise.resolve(null);
            const contextKey = String(sleeperUsername).toLowerCase() + ':' + String(selectedYear);
            if (hubRevalidatingRef.current?.contextKey === contextKey) return hubRevalidatingRef.current;
            setLoading(true);
            setError(null);
            if (sleeperSnapshotRef.current.contextKey && sleeperSnapshotRef.current.contextKey !== contextKey) {
                setSleeperLeagues([]);
                setSleeperUser(null);
                setSleeperCoverage({ status: 'loading', knownCount: null, loadedCount: 0 });
            } else setSleeperCoverage(previous => ({ ...previous, status: 'loading' }));
            const apply = snapshot => {
                if (hubRevalidatingRef.current !== request) return;
                if (window.App.AccountSession?.isCurrent && !window.App.AccountSession.isCurrent()) return;
                sleeperSnapshotRef.current = snapshot;
                setSleeperUser(snapshot.user);
                setSleeperLeagues(snapshot.leagues);
                setSleeperCoverage(snapshot.coverage);
                setError(snapshot.coverage.listVerified ? null : snapshot.coverage.error);
            };
            const request = fetchSleeperPortfolio({ username: sleeperUsername, season: selectedYear, previous: sleeperSnapshotRef.current, onProgress: apply })
                .then(snapshot => {
                    if (hubRevalidatingRef.current !== request) return null;
                    if (window.App.AccountSession?.isCurrent && !window.App.AccountSession.isCurrent()) return null;
                    apply(snapshot);
                    hubSyncedAtRef.current = Date.now();
                    return snapshot.leagues;
                })
                .finally(() => {
                    if (hubRevalidatingRef.current !== request) return;
                    hubRevalidatingRef.current = null;
                    setLoading(false);
                });
            request.contextKey = contextKey;
            hubRevalidatingRef.current = request;
            return request;
        }
        function loadSleeperData() { return syncSleeperPortfolio(); }
        function revalidateSleeperData() { return syncSleeperPortfolio(); }

        // Hub freshness (audit:refresh-stale step 10): league cards load once per
        // year selection and then sit stale for the whole session. When the user
        // closes a league and lands back on the hub with data older than 5 min,
        // re-pull records/rosters in the background (revalidateSleeperData) — the
        // existing cards stay up while fresh data swaps in on success.
        useEffect(() => {
            if (selectedLeague || proMode) return;   // only when the hub itself is showing
            if (!sleeperUsername || loading) return;
            if (!hubSyncedAtRef.current) return;     // first load is owned by the [selectedYear] effect
            if (Date.now() - hubSyncedAtRef.current < 5 * 60 * 1000) return;
            revalidateSleeperData();
        }, [selectedLeague, proMode]);

        // Hook must be above the early return to maintain consistent hook order
        const [reconLeagueId, setReconLeagueId] = useState(null);

        // popstate listener for back/forward navigation — MUST be before early return
        React.useEffect(() => {
            function onPopState(e) {
                if (window.App.NavigationGuard?.canNavigate() === false) {
                    window.App.NavigationGuard.restoreHistory();
                    return;
                }
                cancelLinkedLeagueRoute();
                isNavigatingRef.current = true;
                const state = e.state;
                const hashRoute = parseHash(window.location.hash);
                const nextState = state || (hashRoute.leagueId ? { view: 'league', leagueId: hashRoute.leagueId, tab: hashRoute.tab } : null);
                if (nextState && nextState.view === 'league' && nextState.leagueId) {
                    const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
                    const league = allLeagues.find(l => String(l.id) === String(nextState.leagueId)) || linkedLeaguesRef.current.get(String(nextState.leagueId));
                    if (league) {
                        restoreLinkedLeague(league, nextState);
                    } else resolveLinkedLeagueRoute(nextState);
                } else {
                    setSelectedLeague(null);
                    setActiveTab(defaultTab);
                }
                setTimeout(() => { isNavigatingRef.current = false; }, 0);
            }
            window.addEventListener('popstate', onPopState);
            if (!history.state) {
                const route = parseHash(window.location.hash);
                const state = route.leagueId
                    ? { view: 'league', leagueId: route.leagueId, tab: route.tab }
                    : { view: 'hub' };
                history.replaceState(state, '', routeUrl(window.location.hash));
            }
            return () => window.removeEventListener('popstate', onPopState);
        }, [sleeperLeagues, espnLeagues, mflLeagues, sleeperUser?.user_id]);

        React.useEffect(() => {
            if (initialRouteAppliedRef.current) return;
            const route = parseHash(window.location.hash);
            if (!route.leagueId) {
                if (!loading) initialRouteAppliedRef.current = true;
                return;
            }
            const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
            const league = allLeagues.find(l => String(l.id) === String(route.leagueId));
            if (!league) {
                const pendingTarget = sleeperCoverage.knownLeagues?.some(item => String(item.id) === String(route.leagueId));
                if ((!loading || !sleeperUsername) && !pendingTarget && leagueRouteStatus.status === 'idle') {
                    resolveLinkedLeagueRoute(route);
                }
                return;
            }
            initialRouteAppliedRef.current = true;
            linkedRouteRequestRef.current++;
            setLeagueRouteStatus({ status: 'idle' });
            restoreLinkedLeague(league, route);
        }, [loading, sleeperLeagues, sleeperCoverage, espnLeagues, mflLeagues, sleeperUser?.user_id]);

        // Show Empire Dashboard (Pro mode)
        // global-view.js is a deferred module group (see js/module-loader.js); load it
        // when Pro mode activates and re-render once EmpireDashboard exists.
        // eslint-disable-next-line no-undef
        const _EmpireDash = typeof EmpireDashboard === 'function' ? EmpireDashboard : null;
        const [empireModuleState, setEmpireModuleState] = useState(_EmpireDash ? 'ready' : 'idle');
        useEffect(() => {
            if (!proMode || _EmpireDash || !window.wrLoadModuleGroup) return;
            let alive = true;
            setEmpireModuleState('loading');
            window.wrLoadModuleGroup('empire')
                .then(() => { if (alive) setEmpireModuleState('ready'); })
                .catch(() => { if (alive) setEmpireModuleState('error'); });
            return () => { alive = false; };
        }, [proMode, _EmpireDash]);
        const [empirePlayersLoaded, setEmpirePlayersLoaded] = useState(false);
        const [empirePlayers, setEmpirePlayers] = useState({});

        // ── Commissioner's Office ─────────────────────────────────────
        // Discovery is passive: fetch each Sleeper league's users once and
        // count is_owner. The card only appears for actual commissioners —
        // everyone else never sees the surface exists.
        const [commishMode, setCommishMode] = useState(false);
        const [commishCount, setCommishCount] = useState(0);
        const [commishModuleState, setCommishModuleState] = useState(
            typeof window.CommissionerOffice === 'function' ? 'ready' : 'idle'
        );
        useEffect(() => {
            if (!COMMISH_ENABLED || !sleeperUser?.user_id || !sleeperLeagues.length || !accountSessionCurrent()) return;
            if (!window.App?.Commish?.discoverCommissioned) return;
            let alive = true;
            (async () => {
                try {
                    await window.App.Commish.hydrateCommissioned(sleeperLeagues);
                    if (!alive || !accountSessionCurrent()) return;
                    const mine = window.App.Commish.discoverCommissioned({ leagues: sleeperLeagues, myUserId: String(sleeperUser.user_id) });
                    if (alive) setCommishCount(mine.length);
                } catch (e) { /* card stays hidden — discovery is best-effort */ }
            })();
            return () => { alive = false; };
        }, [sleeperLeagues.length, sleeperUser?.user_id]);
        const openCommishOffice = () => {
            cancelLinkedLeagueRoute(true);
            setCommishMode(true);
            if (typeof window.CommissionerOffice === 'function') { setCommishModuleState('ready'); return; }
            if (!window.wrLoadModuleGroup) { setCommishModuleState('error'); return; }
            setCommishModuleState('loading');
            window.wrLoadModuleGroup('commish')
                .then(() => setCommishModuleState(typeof window.CommissionerOffice === 'function' ? 'ready' : 'error'))
                .catch(() => setCommishModuleState('error'));
        };

        // ── Time League ─────────────────────────────────────────────
        // Not tied to a real Sleeper/ESPN/MFL league, so unlike Commish there's
        // no per-user discovery step — the hub card just shows whenever the
        // sandbox lever is on.
        const [timeLeagueMode, setTimeLeagueMode] = useState(() => new URLSearchParams(window.location.search).get('vault') === '1');
        const [timeLeagueModuleState, setTimeLeagueModuleState] = useState(
            typeof window.TimeLeague === 'function' ? 'ready' : 'idle'
        );
        const openTimeLeague = () => {
            cancelLinkedLeagueRoute(true);
            setTimeLeagueMode(true);
            setDuatMode(false);
            const url = new URL(window.location.href);
            url.searchParams.set('vault', '1');
            url.searchParams.delete('duat');
            window.history.replaceState(window.history.state, '', url);
            if (typeof window.TimeLeague === 'function') { setTimeLeagueModuleState('ready'); return; }
            if (!window.wrLoadModuleGroup) { setTimeLeagueModuleState('error'); return; }
            setTimeLeagueModuleState('loading');
            window.wrLoadModuleGroup('timeleague')
                .then(() => setTimeLeagueModuleState(typeof window.TimeLeague === 'function' ? 'ready' : 'error'))
                .catch(() => setTimeLeagueModuleState('error'));
        };
        // A shareable beta entry opens the same Vault workspace as the hub card.
        // Solo play does not require the Dynasty setup or a connected NFL league.
        useEffect(() => {
            if (timeLeagueMode && timeLeagueModuleState === 'idle') openTimeLeague();
        }, [timeLeagueMode, timeLeagueModuleState]);
        const closeTimeLeague = () => {
            setTimeLeagueMode(false);
            const url = new URL(window.location.href);
            url.searchParams.delete('vault');
            window.history.replaceState(window.history.state, '', url);
        };

        // The Duat is a sibling game, independent of connected leagues.
        const [duatMode, setDuatMode] = useState(() => new URLSearchParams(window.location.search).get('duat') === '1');
        const [duatModuleState, setDuatModuleState] = useState(typeof window.DuatGame === 'function' ? 'ready' : 'idle');
        const openDuat = () => {
            cancelLinkedLeagueRoute(true);
            setDuatMode(true);
            setTimeLeagueMode(false);
            const url = new URL(window.location.href);
            url.searchParams.set('duat', '1'); url.searchParams.delete('vault');
            window.history.replaceState(window.history.state, '', url);
            if (duatModuleState === 'error') { window.location.reload(); return; }
            if (duatModuleState === 'ready' && typeof window.DuatGame === 'function') return;
            if (!window.wrLoadModuleGroup) { setDuatModuleState('error'); return; }
            setDuatModuleState('loading');
            window.wrLoadModuleGroup('duat').then(() => setDuatModuleState(typeof window.DuatGame === 'function' ? 'ready' : 'error')).catch(() => setDuatModuleState('error'));
        };
        useEffect(() => { if (duatMode && duatModuleState === 'idle') openDuat(); }, [duatMode, duatModuleState]);
        const closeDuat = () => {
            setDuatMode(false);
            const url = new URL(window.location.href); url.searchParams.delete('duat'); url.searchParams.delete('duat_invite');
            window.history.replaceState(window.history.state, '', url);
        };

        // Games replace the hub inside the same document. Do not carry the
        // hub's scroll position (or a previous game's position) into its header.
        const gameSurface = !selectedLeague && (duatMode ? 'duat:' + duatModuleState : timeLeagueMode ? 'vault:' + timeLeagueModuleState : '');
        const previousGameSurface = useRef('');
        useEffect(() => {
            if (!gameSurface && !previousGameSurface.current) return;
            previousGameSurface.current = gameSurface;
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        }, [gameSurface]);

        // ── Time League invite links ────────────────────────────────
        // The Vault has no URL router of its own (opened via the hub button
        // above, not a route), so a ?tl_invite=<code> link is caught here once
        // and stashed in sessionStorage rather than a login.html return_to param
        // — OAuth's redirect drops query strings, which would silently lose the
        // invite for anyone who signs in via Google/Apple instead of email/password.
        const PENDING_INVITE_KEY = 'tl-pending-invite-v1';
        const [pendingInvite, setPendingInvite] = useState(null);
        useEffect(() => {
            const code = new URLSearchParams(window.location.search).get('tl_invite');
            let preserved = false;
            if (code) {
                setPendingInvite(code);
                try { sessionStorage.setItem(PENDING_INVITE_KEY, code); preserved = sessionStorage.getItem(PENDING_INVITE_KEY) === code; } catch { /* Keep the code in the URL when storage is unavailable. */ }
                const url = new URL(window.location.href);
                if (preserved) url.searchParams.delete('tl_invite');
                // Keep the game destination after consuming the private code.
                // A reload must reopen the saved Vault room, not the hub.
                url.searchParams.set('vault', '1');
                window.history.replaceState(window.history.state, '', url);
            }
            let stored = null;
            try { stored = sessionStorage.getItem(PENDING_INVITE_KEY); } catch { /* best effort */ }
            if (!code && stored) setPendingInvite(stored);
        }, []);
        const clearPendingInvite = () => {
            try { sessionStorage.removeItem(PENDING_INVITE_KEY); } catch { /* best effort */ }
            const url = new URL(window.location.href);
            if (url.searchParams.has('tl_invite')) { url.searchParams.delete('tl_invite'); window.history.replaceState(window.history.state, '', url); }
            setPendingInvite(null);
        };
        // Open invitation entry for every visitor, including older links without
        // vault=1. The game presents account and guest choices before claiming.
        useEffect(() => {
            if (!pendingInvite || timeLeagueMode) return;
            openTimeLeague();
        }, [pendingInvite, timeLeagueMode]);

        // Bumped after background roster assessment so the Rolodex re-renders.
        const [, setEmpireAssessReady] = useState(0);
        const empirePickSnapshotsRef = React.useRef(new Map());

        // Cross-league window.S population + traded-picks fetch — extracted from
        // the one-time Empire bootstrap below so Empire's manual refresh can redo
        // this same step against freshly-revalidated leagues, not just on first load.
        async function populateEmpireWindowState(allLeaguesList) {
            if (!accountSessionCurrent()) return;
            if (!window.S) window.S = {};
            const allRosters = [];
            const allUsers = [];
            allLeaguesList.forEach(l => {
                (l.rosters || []).forEach(r => { if (!allRosters.find(x => x.roster_id === r.roster_id)) allRosters.push(r); });
                (l.users || []).forEach(u => { if (!allUsers.find(x => x.user_id === u.user_id)) allUsers.push(u); });
            });
            window.S.rosters = allRosters;
            window.S.leagueUsers = allUsers;
            window.S.myUserId = sleeperUser?.user_id;
            window.S.user = sleeperUser;
            const allTradedPicks = [];
            await Promise.allSettled(allLeaguesList.map(async l => {
                const lid = l.id || l.league_id;
                if (!lid) return;
                const snapshot = await fetchEmpireTradedPicks(l, { previous: empirePickSnapshotsRef.current.get(String(lid)) });
                if (!accountSessionCurrent()) return;
                const draftSnapshot = await fetchEmpireDraftInventory(l, { previous: empirePickSnapshotsRef.current.get(String(lid))?.draft, isCurrent: accountSessionCurrent });
                if (!accountSessionCurrent()) return;
                empirePickSnapshotsRef.current.set(String(lid), { ...snapshot, draft: draftSnapshot });
                l.tradedPicks = snapshot.picks;
                l._pickFeedState = snapshot.status;
                l._pickFeedError = snapshot.error;
                l._draftInventory = draftSnapshot.inventory;
                l._draftInventoryState = draftSnapshot.status;
                allTradedPicks.push(...(snapshot.picks || []));
            }));
            if (!accountSessionCurrent()) return;
            window.S.tradedPicks = allTradedPicks;
            setEmpireAssessReady(Date.now());
        }

        // Per-league health/tier assessment + Owner DNA — same extraction, same
        // reason. Mutates each league object in place (l.empireAssessments,
        // l.empireDna) and bumps empireAssessReady so a re-render picks the
        // fresh values up via a new allLeagues array reference.
        async function assessEmpirePortfolio(allLeaguesList, players) {
            if (!accountSessionCurrent()) return;
            if (typeof window.App?.assessAllTeams !== 'function') return;
            if (!window.S) window.S = {};
            // Empire mode never populated S.playerStats, so assessments ran with no
            // production data → degraded health/tier. Fetch current-season stats once
            // (league-independent season totals) and feed them to every assessment.
            if ((!window.S.playerStats || !Object.keys(window.S.playerStats).length) && typeof window.fetchSeasonStats === 'function') {
                const season = parseInt(window.S.season || new Date().getFullYear(), 10);
                let st = (await window.fetchSeasonStats(String(season)).catch(() => ({}))) || {};
                if (!accountSessionCurrent()) return;
                // Offseason: the current season has no games yet — fall back to the last
                // completed season so dynasty health/tier reflect real production.
                if (!Object.keys(st).length) st = (await window.fetchSeasonStats(String(season - 1)).catch(() => ({}))) || {};
                if (!accountSessionCurrent()) return;
                window.S.playerStats = st;
            }
            const stats = window.S.playerStats || {};
            // Yield between leagues so a heavy or oddly-shaped league can't freeze the load.
            for (const l of allLeaguesList) {
                await new Promise(r => setTimeout(r, 0));
                if (!accountSessionCurrent()) return;
                const lid = l.id || l.league_id;
                try {
                    l.empireAssessments = window.App.assessAllTeams(l.rosters || [], players, stats, l, l.users || [], l.tradedPicks || []);
                } catch (e) { l.empireAssessments = []; }
                // Real Owner DNA for the moat: curated reads (od_owner_dna) take
                // precedence; transaction-behavioral inference fills the gaps.
                try {
                    const saved = (window.OD?.loadDNA ? await window.OD.loadDNA(lid).catch(() => ({})) : {}) || {};
                    if (!accountSessionCurrent()) return;
                    const txns = (window.WrTxns?.fetchLeagueTxns ? await window.WrTxns.fetchLeagueTxns(lid).catch(() => []) : []) || [];
                    if (!accountSessionCurrent()) return;
                    l.empireDna = window.App.buildEmpireDna ? window.App.buildEmpireDna(saved, txns, l.rosters || [], sleeperUser?.user_id) : saved;
                } catch (e) { l.empireDna = l.empireDna || {}; }
            }
            setEmpireAssessReady(Date.now());
        }

        // Manual "Refresh Leagues" from Empire Command — re-pulls every Sleeper
        // league's rosters/settings (revalidateSleeperData, the same function the
        // 5-min hub freshness check already uses) and then redoes the assessment
        // pass above against the fresh data. Without the second step a refresh
        // would silently wipe Owner Rolodex / Empire Moves: revalidateSleeperData
        // builds plain new league objects with no empireAssessments/empireDna on
        // them at all, so skipping the reassessment would empty those surfaces
        // rather than update them. ESPN/MFL leagues aren't re-pulled here — there
        // is no equivalent revalidate function for those providers yet.
        const [empireRefreshing, setEmpireRefreshing] = useState(false);
        async function refreshEmpirePortfolio() {
            if (empireRefreshing || !accountSessionCurrent()) return;
            setEmpireRefreshing(true);
            try {
                const fresh = await revalidateSleeperData();
                if (!accountSessionCurrent()) return;
                const allLeaguesList = [...(fresh || sleeperLeagues), ...visibleEspnLeagues, ...visibleMflLeagues];
                await populateEmpireWindowState(allLeaguesList);
                await assessEmpirePortfolio(allLeaguesList, window.S?.players || empirePlayers);
            } catch (e) {
                window.wrLog?.('empire.refreshPortfolio', e);
            } finally {
                if (accountSessionCurrent()) setEmpireRefreshing(false);
            }
        }

        // Load player database + DHQ engine when Pro mode activates
        useEffect(() => {
            if (!proMode || empirePlayersLoaded || !accountSessionCurrent()) return;
            (async () => {
                try {
                    // The deferred empire group owns buildEmpireDna & co. — make sure it
                    // has executed before the assessment loop below reaches for it.
                    if (window.wrLoadModuleGroup) { try { await window.wrLoadModuleGroup('empire'); } catch (e) {} }
                    if (!accountSessionCurrent()) return;
                    // Load 10k player database (league-independent, cached 1hr)
                    const players = await window.App.fetchAllPlayers();
                    if (!accountSessionCurrent()) return;
                    setEmpirePlayers(players || {});
                    // Ensure window.S exists for assessment functions
                    if (!window.S) window.S = {};
                    window.S.players = players;
                    const allLeaguesList = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
                    // Populate rosters from all leagues into window.S for assessments,
                    // plus each league's traded picks.
                    await populateEmpireWindowState(allLeaguesList);
                    if (!accountSessionCurrent()) return;
                    // Empire mode opens no single league, so S.currentLeagueId is unset and
                    // loadLeagueIntel() bails — DHQ player scores never populate, leaving Empire
                    // Value 0 and every asset unvalued. Point LeagueIntel at a representative league
                    // (mirrors the canonical league-open S setup in league-detail.js) so the Empire
                    // gets DHQ-scale values — the documented one-league proxy (see H5 note, global-view.js).
                    if (!window.S.currentLeagueId) {
                        const rep = allLeaguesList.find(l => (l.rosters || []).length && (l.id || l.league_id)) || allLeaguesList[0];
                        if (rep) {
                            const repId = rep.id || rep.league_id;
                            window.S.leagues = [{ ...rep, league_id: repId }];
                            window.S.currentLeagueId = repId;
                            window.S.season = window.S.season || rep.season || String(new Date().getFullYear());
                            // loadLeagueIntel reads S.rosters for the rep league's team count / starter pool.
                            // The cross-league merged array (set above) is deduped by roster_id and would
                            // give a wrong totalTeams, so point it at the rep league's own rosters.
                            if (rep.rosters && rep.rosters.length) window.S.rosters = rep.rosters;
                        }
                    }
                    // Unblock the dashboard immediately; load DHQ scores in the background and
                    // re-render the Empire once they land (don't block the UI on the ~15s first load).
                    setEmpirePlayersLoaded(true);
                    if (typeof window.App?.loadLeagueIntel === 'function' && !window.App.LI_LOADED) {
                        if (window.DhqEvents?.once) window.DhqEvents.once('li:loaded', () => { if (accountSessionCurrent()) setEmpireAssessReady(Date.now()); });
                        window.App.loadLeagueIntel().catch(() => {});
                    }
                    // Then assess every roster in the background.
                    assessEmpirePortfolio(allLeaguesList, players).catch(e => console.warn('[Empire] Assessment error:', e));
                } catch (e) { console.warn('[Empire] Data load error:', e); if (accountSessionCurrent()) setEmpirePlayersLoaded(true); }
            })();
        }, [proMode, empirePlayersLoaded]);

        // Honor the mode switch if a saved navigation state opens a disabled surface.
        // (Render-phase reset is safe here: all hooks above have already run, and
        // the condition is false on the immediate re-render.)
        if (proMode && !EMPIRE_ENABLED) {
            setProMode(false);
            return null;
        }

        if (proMode && !selectedLeague && !_EmpireDash) {
            // Empire module still injecting (or failed) — hold the surface instead of
            // flashing the hub. Escape hatch mirrors the Empire onBack handler.
            return (
                <div style={{ padding: '96px 24px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' }}>
                    {empireModuleState === 'error' ? 'Empire Dashboard failed to load.' : 'Loading Empire Dashboard…'}
                    <div>
                        <button
                            onClick={() => {
                                if (empireModuleState === 'error') { window.location.reload(); return; }
                                setProMode(false);
                                if (!isNavigatingRef.current) {
                                    history.pushState({ view: 'hub' }, '', routeUrl(''));
                                }
                            }}
                            style={{ marginTop: '16px', padding: '8px 16px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', fontWeight: 600 }}
                        >{empireModuleState === 'error' ? 'Reload' : 'Back to Hub'}</button>
                    </div>
                </div>
            );
        }
        if (proMode && !selectedLeague && _EmpireDash) {
            return (
                <ErrorBoundary>
                    <_EmpireDash
                        allLeagues={[...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues]}
                        playersData={empirePlayers}
                        sleeperUserId={sleeperUser?.user_id}
                        onRefresh={refreshEmpirePortfolio}
                        refreshing={empireRefreshing || loading}
                        portfolioCoverage={sleeperCoverage}
                        hasNonSleeperLeagues={!!(visibleEspnLeagues.length || visibleMflLeagues.length)}
                        onEnterLeague={(league) => {
                            handleSelectLeague(league);
                        }}
                        onBack={() => {
                            setProMode(false);
                            if (!isNavigatingRef.current) {
                                history.pushState({ view: 'hub' }, '', routeUrl(''));
                            }
                        }}
                    />
                </ErrorBoundary>
            );
        }

        // ── Commissioner's Office surface ─────────────────────────────
        // Same defense-in-depth as Empire: stale state can't mount it when
        // the sandbox lever is off.
        if (commishMode && !COMMISH_ENABLED) {
            setCommishMode(false);
            return null;
        }
        if (commishMode && !selectedLeague) {
            const _Office = typeof window.CommissionerOffice === 'function' ? window.CommissionerOffice : null;
            if (!_Office) {
                return (
                    <div style={{ padding: '96px 24px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' }}>
                        {commishModuleState === 'error' ? "The Commissioner's Office failed to load." : "Opening the Commissioner's Office…"}
                        <div>
                            <button
                                onClick={() => { if (commishModuleState === 'error') { window.location.reload(); return; } setCommishMode(false); }}
                                style={{ marginTop: '16px', padding: '8px 16px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', fontWeight: 600 }}
                            >{commishModuleState === 'error' ? 'Reload' : 'Back to Hub'}</button>
                        </div>
                    </div>
                );
            }
            return (
                <ErrorBoundary>
                    <_Office
                        leagues={sleeperLeagues}
                        myUserId={String(sleeperUser?.user_id || '')}
                        onBack={() => setCommishMode(false)}
                        onEnterLeague={(league) => handleSelectLeague(league)}
                    />
                </ErrorBoundary>
            );
        }

        if (duatMode && !selectedLeague) {
            const _DuatGame = window.DuatGame;
            if (duatModuleState !== 'ready' || !_DuatGame) return <main style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--silver)' }}>
                <h2>{duatModuleState === 'error' ? 'The Duat could not load.' : 'Opening The Duat…'}</h2>
                <button onClick={duatModuleState === 'error' ? openDuat : closeDuat}>{duatModuleState === 'error' ? 'Try again' : 'Back to Dynasty HQ'}</button>
            </main>;
            return <ErrorBoundary><_DuatGame onClose={closeDuat} /></ErrorBoundary>;
        }

        // ── Time League surface ───────────────────────────────────────
        if (timeLeagueMode && !TIME_LEAGUE_ENABLED) {
            setTimeLeagueMode(false);
            return null;
        }
        if (timeLeagueMode && !selectedLeague) {
            const _TimeLeague = typeof window.TimeLeague === 'function' ? window.TimeLeague : null;
            if (!_TimeLeague) {
                return (
                    <div style={{ padding: '96px 24px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' }}>
                        {timeLeagueModuleState === 'error' ? 'The Vault failed to load.' : 'Opening The Vault…'}
                        <div>
                            <button
                                onClick={() => { if (timeLeagueModuleState === 'error') { window.location.reload(); return; } setTimeLeagueMode(false); }}
                                style={{ marginTop: '16px', padding: '8px 16px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', fontWeight: 600 }}
                            >{timeLeagueModuleState === 'error' ? 'Reload' : 'Back to Hub'}</button>
                        </div>
                    </div>
                );
            }
            return (
                <ErrorBoundary>
                    <_TimeLeague onClose={closeTimeLeague} pendingInvite={pendingInvite} onInviteConsumed={clearPendingInvite} />
                </ErrorBoundary>
            );
        }

        const allWireOverlay = allWireOpen && typeof window.WrAllLeaguesWire === 'function' ? <window.WrAllLeaguesWire key={sleeperUser?.user_id || sleeperUsername} accountId={sleeperUser?.user_id || sleeperUsername} leagues={sleeperLeagues} onClose={() => setAllWireOpen(false)} onOpenLeague={league => { setAllWireOpen(false); handleSelectLeague(league); }} /> : null;

        // Show league detail if selected
        const LeagueDetail = window.LeagueDetail;
        if (selectedLeague) {
            return <>
                {allWireOverlay}
                <ErrorBoundary>
                    <LeagueDetail
                        key={selectedLeague.id}
                        league={selectedLeague}
                        lensLeagues={[...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues]}
                        lensPortfolioCoverage={sleeperCoverage}
                        onOpenAllWire={() => setAllWireOpen(true)}
                        onBack={(navigation) => {
                            if (window.App.NavigationGuard?.canNavigate() === false) return;
                            const leagueSelector = navigation?.leagueSelector === true;
                            cancelLinkedLeagueRoute();
                            setSelectedLeague(null);
                            setActiveTab(defaultTab);
                            if (leagueSelector) setProMode(false);
                            // Return to Empire Dashboard if Pro mode was active, otherwise hub
                            if (!isNavigatingRef.current) {
                                history.pushState({ view: proMode && !leagueSelector ? 'pro' : 'hub' }, '', routeUrl(''));
                            }
                        }}
                        activeTab={activeTab}
                        onTabChange={handleTabChange}
                        sleeperUserId={sleeperUser?.user_id}
                        settingsProps={{
                            initDisplayName: customDisplayName,
                            onDisplayNameSave: (name) => {
                                if (!accountSessionCurrent()) return;
                                setCustomDisplayName(name);
                                window.OD.saveDisplayName(name);
                            },
                            leagueMates,
                        }}
                        onOpenSettings={() => setShowSettings(true)}
                    />
                </ErrorBoundary>
                {showSettings && (
                    <SettingsModal
                        onClose={() => setShowSettings(false)}
                        initDisplayName={customDisplayName}
                        onDisplayNameSave={(name) => {
                            if (!accountSessionCurrent()) return;
                            setCustomDisplayName(name);
                            window.OD.saveDisplayName(name);
                        }}
                        leagueMates={leagueMates}
                    />
                )}
            </>;
        }

        // ── Shared helpers ──
        const lastVisit = readHubLastVisit(sleeperUser?.user_id);
        const lastLeagueId = lastVisit?.id;
        const lastLeagueName = lastVisit?.name;
        const displayName = sleeperUser
            ? (customDisplayName || sleeperUser.display_name || sleeperUser.username || sleeperUsername).toUpperCase()
            : (customDisplayName || 'COMMANDER').toUpperCase();

        const RECONAI_BASE = 'https://c2-football.github.io/ReconAI/';
        function reconUrl(leagueId) {
            return leagueId ? RECONAI_BASE + '?league=' + leagueId : RECONAI_BASE;
        }

        function leagueHealth(league) {
            const gp = league.wins + league.losses + (league.ties || 0);
            const wp = gp > 0 ? Math.round((league.wins / gp) * 100) : null;
            const myRoster = league.rosters?.find(r => r.owner_id === sleeperUser?.user_id);
            const rosterSlots = league.roster_positions?.filter(p => p !== 'BN' && p !== 'IR' && p !== 'TAXI').length || 0;
            const filled = myRoster?.starters?.filter(s => s && s !== '0').length || 0;
            const fillPct = rosterSlots > 0 ? Math.round((filled / rosterSlots) * 100) : null;
            return { gp, wp, fillPct, teamCount: league.rosters?.length || 0 };
        }

        // ── Franchise-picker helpers ──
        function initialsFor(name) {
            // ASCII-only so emoji / astral scripts (cuneiform, etc.) don't break the crest.
            const ascii = String(name || '').replace(/[^A-Za-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
            if (!ascii) return '★';
            const w = ascii.split(' ');
            return (((w[0] && w[0][0]) || '') + ((w[1] && w[1][0]) || '')).toUpperCase();
        }
        function leagueTeamName(league) {
            try {
                const me = league.rosters?.find(r => r.owner_id === sleeperUser?.user_id);
                if (me) {
                    const u = league.users?.find(x => x.user_id === me.owner_id);
                    if (u?.metadata?.team_name) return u.metadata.team_name;
                    if (u?.display_name) return u.display_name;
                }
            } catch (e) {}
            return league.teamName || league.name || '';
        }
        function leagueFormat(league) {
            const bits = [];
            try {
                const rp = (league.roster_positions || []).map(s => String(s).toUpperCase());
                bits.push(rp.some(s => ['SUPER_FLEX', 'QB_FLEX', 'OP'].includes(s)) ? 'Superflex' : '1QB');
                const rec = Number(league.scoring_settings?.rec ?? 0);
                bits.push(rec >= 1 ? 'PPR' : rec >= 0.5 ? 'Half-PPR' : 'Standard');
                if (Number(league.scoring_settings?.bonus_rec_te ?? 0) > 0) bits.push('TE-Prem');
                const teams = league.rosters?.length || league.settings?.num_teams || league.total_rosters || 0;
                if (teams) bits.push(teams + '-team');
                const rawType = league.type ?? league.league_type ?? league.settings?.type ?? league.metadata?.type;
                const type = window.App?.LeagueSkin?.normalizeType?.(rawType)
                    || ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty', 3: 'chopped' }[String(rawType)] || 'unknown');
                const formatLabel = window.App?.LeagueSkin?.TYPE_META?.[type]?.label
                    || ({ redraft: 'Redraft', keeper: 'Keeper', dynasty: 'Dynasty', chopped: 'Chopped', best_ball: 'Best Ball' }[type]);
                if (formatLabel) bits.push(formatLabel);
            } catch (e) {}
            return bits.join(' · ');
        }

        // Pro tier icon (SVG shield with star)
        function ProTierIcon({ size }) {
            const s = size || 24;
            return React.createElement('svg', { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
                React.createElement('path', { d: 'M12 2L3 7v6c0 5.25 3.83 10.18 9 11.38C17.17 23.18 21 18.25 21 13V7L12 2z', fill: 'url(#proGrad)', stroke: 'var(--k-d4af37, #d4af37)', strokeWidth: '1' }),
                React.createElement('path', { d: 'M12 7l1.545 3.13 3.455.503-2.5 2.437.59 3.43L12 14.885 8.91 16.5l.59-3.43-2.5-2.437 3.455-.503L12 7z', fill: 'var(--k-0a0a0a, #0a0a0a)', stroke: 'var(--k-b8941e, #b8941e)', strokeWidth: '0.5' }),
                React.createElement('defs', null,
                    React.createElement('linearGradient', { id: 'proGrad', x1: '3', y1: '2', x2: '21', y2: '24' },
                        React.createElement('stop', { offset: '0%', stopColor: 'var(--k-d4af37, #d4af37)' }),
                        React.createElement('stop', { offset: '100%', stopColor: 'var(--k-8b6914, #8b6914)' })
                    )
                )
            );
        }
        window.ProTierIcon = ProTierIcon;

        function LeagueSelector({ onSelect, accent }) {
            const accentColor = 'var(--gold)';
            const accentBg = 'var(--acc-fill2, rgba(212,175,55,0.08))';
            const accentBorder = 'var(--acc-line2, rgba(212,175,55,0.3))';
            if (!sleeperUsername) return null;
            // Only show the full-screen loader before the FIRST league streams in; once
            // cards start arriving we render them live and show a "loading more" hint.
            if (loading && sleeperLeagues.length === 0) return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' }}>Loading leagues...</div>;
            if (error && sleeperLeagues.length === 0) return <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--k-e74c3c, #e74c3c)', fontSize: 'var(--text-body, 1rem)' }}>{error}</div>;
            if (!loading && sleeperLeagues.length === 0) return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' }}>{sleeperCoverage.status === 'error' ? 'League data unavailable. Retry league sync on the home screen.' : 'No leagues found for ' + selectedYear}</div>;

            return (
                <div className="hub-league-selector">
                    <label>Select League</label>

                    <div className="hub-league-list">
                        {sleeperLeagues.map(l => {
                            const h = leagueHealth(l);
                            const recordCol = h.wp === null ? 'var(--silver)' : h.wp >= 60 ? 'var(--win-green)' : h.wp < 40 ? 'var(--loss-red)' : 'var(--silver)';
                            const fillCol = h.fillPct === null ? 'var(--silver)' : h.fillPct >= 90 ? 'var(--win-green)' : h.fillPct >= 70 ? 'var(--silver)' : 'var(--loss-red)';
                            return (
                                <div key={l.id} className="hub-league-item" onClick={() => onSelect(l)}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.background = accentBg; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = accentBorder; e.currentTarget.style.background = 'var(--ov-1, rgba(255,255,255,0.02))'; }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '3px', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>
                                            <span>{h.teamCount}T</span>
                                            <span style={{ color: recordCol, fontWeight: 700 }}>{l.wins}-{l.losses}{l.ties > 0 ? '-'+l.ties : ''}</span>
                                            {h.fillPct !== null && <span style={{ color: fillCol }}>{h.fillPct}% filled</span>}
                                        </div>
                                    </div>
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={accentColor} strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}><polyline points="9 18 15 12 9 6"/></svg>
                                </div>
                            );
                        })}
                        {loading && <div style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', opacity: 0.6 }}>Loading more leagues…</div>}
                    </div>
                </div>
            );
        }

        // Signed-in experience hub. Keep product entry points and league selection distinct.
        function FranchisePicker({ leagues, onSelect }) {
            const tier = typeof getUserTier === 'function' ? getUserTier() : 'free';
            const isPaid = EMPIRE_FREE_PRELIVE || tier === 'pro' || tier === 'warroom' || tier === 'war_room' || tier === 'commissioner';
            const query = leagueQuery.trim().toLowerCase();
            const resume = leagues.find(l => String(l.id) === String(lastLeagueId));
            const focusLeague = resume || leagues[0];
            const incomplete = sleeperUsername && sleeperCoverage.status !== 'ready' && sleeperCoverage.status !== 'idle';
            const knownCount = sleeperCoverage.knownCount;
            const coverageText = knownCount == null ? 'Sleeper league count unavailable' : sleeperLeagues.length + ' of ' + knownCount + ' Sleeper leagues loaded';
            const focusHealth = focusLeague ? leagueHealth(focusLeague) : null;
            const filtered = leagues.filter(l => [l.name, leagueTeamName(l), leagueFormat(l)].join(' ').toLowerCase().includes(query))
                .sort((a, b) => Number(String(b.id) === String(lastLeagueId)) - Number(String(a.id) === String(lastLeagueId)));
            const leagueCards = filtered.map((l, index) => {
                const h = leagueHealth(l);
                const team = leagueTeamName(l);
                const title = team || l.name;
                const isLast = String(l.id) === String(lastLeagueId);
                return <button type="button" key={l.id} className={'hub-league-card' + (isLast ? ' is-last' : '') + (!query && index >= 3 ? ' hub-league-overflow' + (hubAllLeagues ? ' is-expanded' : '') : '')} onClick={() => onSelect(l)}>
                    <span className="hub-league-card-top"><span className="hub-team-avatar" aria-hidden="true">{initialsFor(title)}</span><span className="hub-league-identity"><strong>{title}</strong><span>{l.name}</span></span>{isLast && <span className="hub-last-badge">Last opened</span>}</span>
                    <span className="hub-league-card-bottom"><span>{leagueFormat(l)}{l._portfolioStale ? ' · Saved data' : ''}</span><span>{h.wp !== null ? l.wins + '–' + l.losses + (l.ties > 0 ? '–' + l.ties : '') : 'Open league'} <span aria-hidden="true">→</span></span></span>
                </button>;
            });
            return (
                <main className="hub-franchise-picker experience-hub">
                    <div className="hub-welcome">
                        <div><h1>{leagues.length ? 'Welcome back.' : 'Your home field.'}</h1></div>
                        <span className="hub-sync-status" role="status">{incomplete ? (hubSyncing ? 'Syncing · ' : '') + coverageText : leagues.length + ' connected league' + (leagues.length === 1 ? '' : 's')}</span>
                    </div>
                    {leagueRouteStatus.status !== 'idle' && <div className="hub-invite" role="status" data-testid="league-route-status" style={{ flexWrap: 'wrap' }}><div><strong style={{ fontSize: 16 }}>{leagueRouteStatus.status === 'loading' ? 'Opening linked league…' : 'League link could not open'}</strong><p style={{ fontSize: 16, lineHeight: 1.5 }}>{leagueRouteStatus.status === 'loading' ? 'Checking its season and your connected account.' : leagueRouteStatus.message}</p></div>{leagueRouteStatus.status === 'error' && <button type="button" className="hub-add-button" style={{ fontSize: 16, minHeight: 44 }} onClick={() => resolveLinkedLeagueRoute(leagueRouteStatus.route)}>Retry league link</button>}<button type="button" className="hub-add-button" style={{ fontSize: 16, minHeight: 44 }} onClick={() => { cancelLinkedLeagueRoute(); history.replaceState({ view: 'hub' }, '', routeUrl('')); }}>Stay on home</button></div>}
                    {focusLeague && <button type="button" className={resume ? 'hub-resume' : 'hub-resume hub-open-league'} onClick={() => onSelect(focusLeague)}><span className="hub-eyebrow">{resume ? 'Last opened' : 'Your league'}</span><strong>{resume ? 'Resume ' : 'Open '}{leagueTeamName(focusLeague) || focusLeague.name}</strong><span>{focusLeague.name}{focusHealth.wp !== null && <span className="hub-focus-record"> · {focusLeague.wins}–{focusLeague.losses}{focusLeague.ties > 0 ? '–' + focusLeague.ties : ''}</span>}</span><b aria-hidden="true">→</b></button>}
                    {pendingInvite && !(window.App.OD?.getCurrentUserId && window.App.OD.getCurrentUserId()) && <div className="hub-invite"><div><strong>You have a pending Vault invite</strong><p>Sign in with the account you want to play from to claim your seat.</p></div><a href={distPrefix + 'login.html?vault=1'}>Sign in to join →</a></div>}
                    <nav className="hub-jump-nav" aria-label="Choose your experience">
                        <a href="#hub-leagues">Your leagues</a>
                        {(EMPIRE_ENABLED || COMMISH_ENABLED) && <a href="#hub-management">Management</a>}
                        {TIME_LEAGUE_ENABLED && <a href="#hub-games">Games</a>}
                    </nav>
                    <section id="hub-leagues" className="hub-leagues" aria-labelledby="hub-leagues-title">
                        <div className="hub-section-heading"><div><h2 id="hub-leagues-title">Your leagues <span className="hub-count">{leagues.length}</span></h2></div><button type="button" className="hub-add-button" onClick={() => { cancelLinkedLeagueRoute(true); setShowConnect(true); }}>+ Add league</button></div>
                        {leagues.length > 0 && <div className="hub-league-tools"><label htmlFor="hub-league-search">Find your league</label><input id="hub-league-search" type="search" placeholder="Find a league or team" value={leagueQuery} onChange={e => setLeagueQuery(e.target.value)} /><span aria-live="polite">{query ? filtered.length + ' found' : ''}</span></div>}
                        {incomplete && <div className="hub-invite" role="status" style={{ flexWrap: 'wrap' }}><div><strong>{coverageText}</strong><p>{sleeperCoverage.error || 'Remaining league details are still loading.'}{sleeperCoverage.staleCount > 0 ? ' Showing last loaded data for ' + sleeperCoverage.staleCount + ' league(s).' : ''}</p>{sleeperCoverage.unavailable?.length > 0 && <details><summary>League details unavailable</summary>{sleeperCoverage.unavailable.map(league => <div key={league.id}>{league.name}</div>)}</details>}</div><button type="button" className="hub-add-button" disabled={hubSyncing} onClick={loadSleeperData}>{hubSyncing ? 'Loading…' : 'Retry league sync'}</button>{error && <button type="button" className="hub-add-button" onClick={() => { cancelLinkedLeagueRoute(true); setShowConnect(true); }}>Manage connection</button>}</div>}
                        <div id="hub-league-results" className="hub-league-grid">{leagueCards}</div>
                        {!query && leagueCards.length > 3 && <button type="button" className="hub-more-leagues" aria-expanded={hubAllLeagues} aria-controls="hub-league-results" onClick={() => setHubAllLeagues(!hubAllLeagues)}><span>{hubAllLeagues ? 'Show fewer leagues' : 'Show all ' + leagues.length + ' leagues'}</span><span aria-hidden="true">{hubAllLeagues ? '⌃' : '⌄'}</span></button>}
                        {!filtered.length && <div className="hub-empty" role="status"><strong>{query ? 'No matching leagues' : hubSyncing ? 'Bringing your leagues together…' : incomplete ? 'Your league data is unavailable.' : 'Your first league starts here.'}</strong><p>{query ? 'Try another team name, league, or format.' : hubSyncing ? 'You can explore Games while your leagues sync.' : incomplete ? 'Retry the sync above to load your teams.' : 'Connect your fantasy account to see your teams in one place.'}</p>{query ? <button type="button" className="hub-add-button" onClick={() => setLeagueQuery('')}>Clear search</button> : !hubSyncing && !incomplete && <button type="button" className="hub-add-button" onClick={() => { cancelLinkedLeagueRoute(true); setShowConnect(true); }}>Connect a league</button>}</div>}
                        {sleeperLeagues.length > 0 && <button type="button" className="hub-wire-entry wr-all-wire-launch" onClick={() => { cancelLinkedLeagueRoute(true); setAllWireOpen(true); }}><span className="hub-wire-icon" aria-hidden="true">W</span><span><strong>The Wire</strong><span>One front page for your leagues</span></span><b aria-hidden="true">→</b></button>}
                    </section>
                    <div className="hub-experience-grid">
                        {(EMPIRE_ENABLED || COMMISH_ENABLED) && <section id="hub-management" className="hub-management" aria-labelledby="hub-management-title">
                            <div className="hub-section-heading"><div><h2 id="hub-management-title">Across your leagues</h2></div></div>
                            <div className="hub-management-cards">
                                {EMPIRE_ENABLED && <button type="button" className="hub-experience-card empire-hero" onClick={() => { cancelLinkedLeagueRoute(true); if (isPaid) setProMode(true); else if (typeof window.showProLaunchPage === 'function') window.showProLaunchPage(); else window.location.href = distPrefix + 'landing.html'; }}>
                                    <span className="hub-card-top"><ProTierIcon size={34} /><span className="hub-product-tag">{isPaid ? 'PORTFOLIO' : 'PRO'}</span></span>
                                    <strong>Empire</strong><span className="hub-card-description">Players, picks, and exposure.</span>
                                    <span className="hub-card-action">{isPaid ? 'Open Empire' : 'Explore Empire Pro'} <span aria-hidden="true">↗</span></span>
                                </button>}
                                {COMMISH_ENABLED && <button type="button" className="hub-experience-card commish-hero" disabled={commishCount < 1} onClick={openCommishOffice}>
                                    <span className="hub-card-top"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z"/><path d="m8 12 3 3 5-6"/></svg><span className="hub-product-tag">COMMISSIONER</span></span>
                                    <strong>Commissioner’s Office</strong><span className="hub-card-description">Rules, people, and league operations.</span>
                                    <span className="hub-card-action">{commishCount >= 1 ? 'Open Commissioner' : hubSyncing ? 'Checking commissioner access…' : 'Requires a commissioner league'} {commishCount >= 1 && <span aria-hidden="true">↗</span>}</span>
                                </button>}
                            </div>
                        </section>}
                        {TIME_LEAGUE_ENABLED && <section id="hub-games" className="hub-games" aria-labelledby="hub-games-title">
                            <div className="hub-section-heading"><div><h2 id="hub-games-title">Keep playing</h2></div><span className="hub-section-note">Football history</span></div>
                            <button type="button" className="hub-experience-card time-league-hero" onClick={openTimeLeague}>
                                <span className="hub-vault-art" aria-hidden="true"><span className="hub-era-card">1970<span>CLASSIC</span></span><span className="hub-era-card">?<span>YOUR SEASON</span></span><span className="hub-era-card">2025<span>MODERN</span></span></span>
                                <span className="hub-vault-copy"><span className="hub-product-tag">TIME TRAVEL · BETA</span><strong>The Vault</strong><span className="hub-card-description">Draft legends. Discover their seasons.</span><span className="hub-card-action">Enter The Vault <span aria-hidden="true">↗</span></span></span>
                            </button>
                            <button type="button" className="hub-experience-card hub-duat-card" onClick={openDuat}>
                                <span className="hub-duat-symbol" aria-hidden="true">𓂀</span><span className="hub-duat-copy"><span className="hub-product-tag">HISTORICAL BETA</span><strong>The Duat</strong><span className="hub-card-description">Command a historical army. Claim the realm.</span><span className="hub-card-action">Enter The Duat ↗</span></span>
                            </button>
                        </section>}
                    </div>
                    <footer className="hub-footer"><span>Dynasty HQ</span><button type="button" onClick={() => { cancelLinkedLeagueRoute(true); setShowSettings(true); }}>Account & settings</button><a href={distPrefix + ((typeof window.wrIsPro === 'function' && !window.wrIsPro()) ? 'upgrade.html' : 'onboarding.html?manage=true')}>Plans & billing</a><a href={distPrefix + 'ai-settings.html'}>AI settings</a></footer>
                </main>
            );
        }

        function handleSelectLeague(league) {
            if (!accountSessionCurrent() || window.App.NavigationGuard?.canNavigate() === false) return;
            cancelLinkedLeagueRoute();
            setActiveLeagueId(league.id);
            setSelectedLeague(league);
            setActiveTab(defaultTab);
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_ID, league.id);
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_NAME, league.name);
            rememberHubLastVisit(league, sleeperUser?.user_id);
            if (!isNavigatingRef.current) {
                history.pushState({ view: 'league', leagueId: league.id, tab: defaultTab }, '', routeUrl(buildHash(league.id, defaultTab)));
            }
        }

        function handleTabChange(tab) {
            if (window.App.NavigationGuard?.canNavigate() === false) return;
            setActiveTab(tab);
            if (!isNavigatingRef.current && selectedLeague) {
                history.pushState({ view: 'league', leagueId: selectedLeague.id, tab }, '', routeUrl(buildHash(selectedLeague.id, tab)));
            }
        }

        async function handleESPNConnect(leagueId, espnS2, swid) {
            if (!accountSessionCurrent()) return;
            if (!platformAccessAllowed('espn')) { setEspnError(platformBetaMessage('espn')); return; }
            if (!leagueId) { setEspnError('Enter your ESPN league ID'); return; }
            const numericId = leagueId.replace(/\D/g, '');
            if (!numericId) { setEspnError('League ID must be a number from your ESPN URL'); return; }
            if (!window.ESPN) { setEspnError('ESPN connector not loaded — refresh and try again'); return; }
            setEspnConnecting(true);
            setEspnError(null);
            try {
                const year = parseInt(selectedYear);
                // Persist credentials for Scout deep-link
                if (espnS2) { sessionStorage.setItem('espn_s2', espnS2); localStorage.removeItem('espn_s2'); }
                if (swid)   { sessionStorage.setItem('espn_swid', swid); localStorage.removeItem('espn_swid'); }
                const result = await window.ESPN.connectLeague(numericId, year, espnS2 || null, swid || null);
                if (!accountSessionCurrent()) return;
                const league = {
                    id:              result.league.league_id,
                    name:            result.league.name,
                    season:          String(year),
                    wins:            0, losses: 0, ties: 0,
                    rosters:         result.rosters,
                    scoring_settings: result.league.scoring_settings,
                    roster_positions: result.league.roster_positions,
                    settings:         result.league.settings || {},
                    _espn:            true,
                    _espnLeagueId:    numericId,
                };
                setEspnLeagues(prev => {
                    const filtered = prev.filter(l => l._espnLeagueId !== numericId);
                    return [...filtered, league];
                });
            } catch (e) {
                if (accountSessionCurrent()) setEspnError(e.message || 'ESPN connection failed');
            } finally {
                if (accountSessionCurrent()) setEspnConnecting(false);
            }
        }

        async function handleMFLConnect(leagueId, year, apiKey) {
            if (!accountSessionCurrent()) return;
            if (!platformAccessAllowed('mfl')) { setMflError(platformBetaMessage('mfl')); return; }
            if (!leagueId) { setMflError('Enter your MFL League ID'); return; }
            if (!window.MFL) { setMflError('MFL connector not loaded — refresh and try again'); return; }
            setMflConnecting(true);
            setMflError(null);
            try {
                const raw = await window.MFL.fetchLeague(leagueId, year, apiKey || null);
                if (!accountSessionCurrent()) return;
                if (!raw?.leagueData?.league) throw new Error('Invalid MFL league data. Check your League ID and year.');
                // Build crosswalk (empty Sleeper players — rebuilds when full DB loads)
                const mflPlayerArr = raw.playersData?.players?.player || [];
                const allMflPlayers = Array.isArray(mflPlayerArr) ? mflPlayerArr : [mflPlayerArr];
                const crosswalk = window.MFL.buildCrosswalk({}, allMflPlayers, year);
                const result = window.MFL.mapToSleeperState(raw, leagueId, year, crosswalk);
                // Extract franchise list for picker
                const franchises = raw.leagueData?.league?.franchises?.franchise || [];
                const franchiseArr = Array.isArray(franchises) ? franchises : [franchises];
                // Store credentials
                localStorage.setItem('mfl_league_id', leagueId);
                localStorage.setItem('mfl_year', String(year));
                if (apiKey) { sessionStorage.setItem('mfl_api_key', apiKey); localStorage.removeItem('mfl_api_key'); }
                setMflPendingResult(result);
                setMflFranchises(franchiseArr);
            } catch (e) {
                if (accountSessionCurrent()) setMflError(e.message || 'MFL connection failed');
            } finally {
                if (accountSessionCurrent()) setMflConnecting(false);
            }
        }

        function finalizeMFLConnect(franchiseId) {
            if (!accountSessionCurrent()) return;
            if (!platformAccessAllowed('mfl')) return;
            const result = mflPendingResult;
            if (!result) return;
            const leagueId = localStorage.getItem('mfl_league_id');
            // Lock in the team pick so it rehydrates on every future launch
            // (league id + year are already persisted in handleMFLConnect).
            if (franchiseId) localStorage.setItem('mfl_franchise_id', String(franchiseId));
            else localStorage.removeItem('mfl_franchise_id');
            // Sync the connection to the account so it follows the user across devices.
            window.OD?.saveMflConnection?.({ leagueId, year: localStorage.getItem('mfl_year') || '2026', franchiseId: franchiseId || null });
            const league = buildMflLeagueObj(result, leagueId, franchiseId);
            setMflLeagues(prev => {
                const filtered = prev.filter(l => l._mflLeagueId !== league._mflLeagueId);
                return [...filtered, league];
            });
            setMflFranchises(null);
            setMflPendingResult(null);
            handleSelectLeague(league);
        }

        // Search connected leagues across active production platforms.
        const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
        const resumeLeague = allLeagues.find(l => String(l.id) === lastLeagueId);
        const distPrefix = (window.location.pathname || '').includes('/dist-preview/') ? '../' : '';
        const iconSrc = distPrefix + 'icon-192.png';
        // `loading` starts true and only resolves via loadSleeperData, which never
        // runs without a username — so treat the hub as syncing only when a Sleeper
        // fetch is actually in flight (a signed-out user goes straight to connect).
        const hubSyncing = loading && !!sleeperUsername;


        return (
            <div className="app-container hub-shell">
                {allWireOverlay}
                {/* ── PHONE TIER (≤767), hub view only — iPhone plan Phase 2 item 14.
                    (1) .header: the index.html mobile-hub rule (.header{padding:0.6rem 1rem})
                    overrides the base rule's safe-area padding at exactly the tier that
                    needs it (installed-PWA draws under the notch, black-translucent) —
                    restore it here; equal specificity, later in the document, so it wins.
                    (2) Connect grid: the inline repeat(2) template makes two ~165px
                    platform cards at 375 — stack to one column.
                    (3) Touch bumps are hit-area only (CTAs, MFL franchise/cancel rows);
                    ≥768 is untouched. --sa* vars resolve to 0 off-notch. */}
                <style>{`
                    @media (max-width: 767px) {
                        .header { padding: calc(0.6rem + var(--sat, 0px)) calc(1rem + var(--sar, 0px)) 0.6rem calc(1rem + var(--sal, 0px)); }
                        .hub-platform-grid { grid-template-columns: 1fr !important; padding-left: calc(12px + var(--sal, 0px)) !important; padding-right: calc(12px + var(--sar, 0px)) !important; }
                        .hub-franchise-picker { padding-left: calc(12px + var(--sal, 0px)) !important; padding-right: calc(12px + var(--sar, 0px)) !important; }
                        .hub-cta, .hub-platform-grid button { min-height: 44px; }
                    }
                `}</style>
                {/* ── Header ── */}
                <header className="header">
                    <a className="header-brand" aria-label="Dynasty HQ home" href={distPrefix + 'landing.html'}
                        style={{ cursor: 'pointer', textDecoration: 'none' }}>
                        <img src={iconSrc} alt="Logo" style={{ width:'44px',height:'44px',borderRadius:'var(--card-radius, 10px)',boxShadow:'0 2px 12px var(--acc-line2, rgba(212,175,55,.3))' }} />
                        <div className="header-text">
                            <h1 className="owner-name wr-wordmark" style={{ fontSize:'1.1rem',letterSpacing:'.06em' }}>DYNASTY HQ</h1>
                            <div className="header-subtitle">{String(displayName)}</div>
                        </div>
                    </a>
                    <div className="hub-account-controls">
                        <a href={distPrefix + ((typeof window.wrIsPro === 'function' && !window.wrIsPro()) ? 'upgrade.html' : 'onboarding.html?manage=true')}>Plans & billing</a><a href={distPrefix + 'ai-settings.html'}>AI settings</a>
                        <button type="button" aria-label="Account & settings" onClick={() => { cancelLinkedLeagueRoute(true); setShowSettings(true); }}><span className="hub-account-avatar" aria-hidden="true">{initialsFor(String(displayName))}</span><span className="hub-account-label">Account & settings</span></button>
                    </div>
                </header>

                {/* Session/resume affordance now lives inside the Add-a-league modal;
                    the picker surfaces the last league inline via its LAST badge. */}

                {/* ── Franchise picker — the default landing for every visitor.
                     Shows once we're past the initial no-cache sync, and stays
                     mounted behind the Add-a-league modal so connecting never
                     blanks it out. ── */}
                {FranchisePicker({ leagues: allLeagues, onSelect: handleSelectLeague })}

                {/* ── Add-a-league / connect — pops up over the franchise picker.
                     This is the only entry to the platform connectors now; the
                     picker itself is always the default surface underneath. ── */}
                {showConnect && (
                <div onClick={() => setShowConnect(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(4,4,7,0.74)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 'calc(52px + var(--wr-dev-banner-height, 0px)) 12px 40px' }}>
                <div onClick={e => e.stopPropagation()}
                    style={{ width: '100%', maxWidth: '760px', background: 'var(--page-bg, #08080B)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '16px', padding: '16px', boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                        <span style={{ fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '.08em', color: 'var(--gold)' }}>ADD A LEAGUE</span>
                        <button onClick={() => setShowConnect(false)} className="hub-cta ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'auto', flex: '0 0 auto' }}>✕ Close</button>
                    </div>
                    {resumeLeague && (
                        <div className="session-strip" style={{ marginBottom: '12px' }}>
                            <span className="session-strip-label">Last Session:</span>
                            <span className="session-strip-league">{lastLeagueName}</span>
                            <button className="session-strip-btn primary" onClick={() => handleSelectLeague(resumeLeague)}>Resume</button>
                        </div>
                    )}
                {/* ── Platform Cards ── */}
                <div className="hub-platform-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>

                    {/* ──── SLEEPER ──── */}
                    <div className="product-card" style={{ borderColor: 'rgba(26,153,170,0.3)', background: 'linear-gradient(135deg, rgba(26,153,170,0.04), transparent)' }}>
                        <div className="product-card-header">
                            <div className="product-card-icon" style={{ background: 'linear-gradient(135deg, var(--k-1a99aa, #1a99aa), var(--k-147d8a, #147d8a))', boxShadow: '0 3px 12px rgba(26,153,170,0.25)' }}>
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--white)" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                            </div>
                            <div>
                                <div className="product-card-title">SLEEPER</div>
                                <div className="product-card-subtitle">{sleeperUsername ? (error || sleeperCoverage.failedCount ? 'Connection needs attention' : hubSyncing ? 'Syncing leagues…' : sleeperLeagues.length + ' league' + (sleeperLeagues.length !== 1 ? 's' : '') + ' synced') : 'Connect your account'}</div>
                            </div>
                        </div>
                        <div className="product-card-body">
                            {sleeperUsername && <p style={{ marginTop: 0, fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5 }}>Sleeper profile: <strong style={{ color: 'var(--white)' }}>{sleeperUsername}</strong></p>}
                            <form className="hub-connect-card" onSubmit={handleSleeperConnect} aria-busy={sleeperConnecting} style={{ display: 'grid', gap: '8px', textAlign: 'left' }}>
                                <label htmlFor="wr-sleeper-input">Sleeper username</label>
                                <input id="wr-sleeper-input" name="sleeperUsername" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Sleeper username" value={sleeperConnectInput} onChange={e => { setSleeperConnectInput(e.target.value); setSleeperConnectError(null); }} disabled={sleeperConnecting} aria-invalid={!!sleeperConnectError} aria-describedby={(sleeperConnectError || error) ? 'wr-sleeper-connect-error' : undefined} style={{ fontSize: 'var(--text-body, 1rem)', textAlign: 'left' }} />
                                {(sleeperConnectError || error) && <p id="wr-sleeper-connect-error" role="alert" style={{ margin: 0, color: 'var(--k-e74c3c, #e74c3c)', fontSize: 'var(--text-body, 1rem)' }}>{sleeperConnectError || error}</p>}
                                <button type="submit" className="hub-cta gold" disabled={sleeperConnecting || !sleeperConnectInput.trim()}>{sleeperConnecting ? 'Checking Sleeper…' : sleeperUsername ? 'Update connection' : 'Connect Sleeper'}</button>
                            </form>
                            {sleeperUsername && !error && !sleeperConnectError && <p role="status" style={{ marginBottom: 0, fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5 }}>{hubSyncing ? 'Syncing your leagues…' : sleeperCoverage.failedCount ? 'Some league details are unavailable. Retry league sync on the home screen.' : sleeperLeagues.length ? 'Your leagues are on the home screen.' : 'No leagues found for ' + selectedYear + '. You can try another Sleeper username.'}</p>}
                        </div>
                    </div>

                    {/* ──── ESPN ──── HIDDEN — infrastructure preserved, UI removed */}

                    {/* ──── MFL — sandbox beta only ──── */}
                    {platformAccessAllowed('mfl') && <div className="product-card" style={{ borderColor: 'rgba(46,125,50,0.3)', background: 'linear-gradient(135deg, rgba(46,125,50,0.04), transparent)' }}>
                        <div className="product-card-header">
                            <div className="product-card-icon" style={{ background: 'linear-gradient(135deg, var(--k-2e7d32, #2e7d32), var(--k-1b5e20, #1b5e20))', boxShadow: '0 3px 12px rgba(46,125,50,0.25)' }}>
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--white)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                            </div>
                            <div>
                                <div className="product-card-title">MFL</div>
                                <div className="product-card-subtitle">{visibleMflLeagues.length > 0 ? visibleMflLeagues.length + ' league' + (visibleMflLeagues.length !== 1 ? 's' : '') + ' synced' : 'MyFantasyLeague connector'}</div>
                            </div>
                        </div>
                        <div className="product-card-body">
                            {/* Connected leagues */}
                            {visibleMflLeagues.length > 0 && (
                                <div style={{ marginBottom: '8px' }}>
                                    {visibleMflLeagues.map(l => (
                                        <button key={l.id} className="hub-cta gold" style={{ marginBottom: '4px', width: '100%' }} onClick={() => handleSelectLeague(l)}>
                                            ENTER {l.name?.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* Franchise picker */}
                            {mflFranchises && (
                                <div>
                                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', marginBottom: '8px', fontWeight: 700 }}>Select your team:</div>
                                    <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                                        {mflFranchises.map(f => (
                                            <button key={f.id} onClick={() => finalizeMFLConnect(f.id)}
                                                style={{ display: 'block', width: '100%', padding: '8px 10px', marginBottom: '4px', background: 'rgba(46,125,50,0.08)', border: '1px solid rgba(46,125,50,0.25)', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--white)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'left' }}>
                                                {f.name || f.owner_name || ('Team ' + f.id)}
                                            </button>
                                        ))}
                                    </div>
                                    <button onClick={() => { setMflFranchises(null); setMflPendingResult(null); }} style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', background: 'none', border: 'none', cursor: 'pointer', marginTop: '6px' }}>Cancel</button>
                                </div>
                            )}
                            {/* Connect form */}
                            {!mflFranchises && (
                                <div>
                                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '8px' }}>Enter your MFL League ID and year to connect.</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px,1fr))', gap: '6px', marginBottom: '10px' }}>
                                        {[
                                            ['Public', 'league XML'],
                                            ['Private', 'API key'],
                                            ['Team', 'franchise pick'],
                                        ].map(([label, detail]) => (
                                            <div key={label} style={{ border: '1px solid rgba(46,125,50,0.18)', background: 'rgba(46,125,50,0.06)', borderRadius: 'var(--card-radius-sm, 8px)', padding: '7px 8px', minWidth: 0 }}>
                                                <strong style={{ display: 'block', color: 'var(--k-81c784, #81c784)', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)' }}>{label}</strong>
                                                <span style={{ display: 'block', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', opacity: 0.72, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                                        <input id="wr-mfl-id" placeholder="League ID" style={{ flex: 1, padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--white)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)' }} />
                                        <input id="wr-mfl-year" placeholder="Year" defaultValue="2026" style={{ width: '70px', padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--white)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', textAlign: 'center' }} />
                                    </div>
                                    <details style={{ marginBottom: '8px' }}>
                                        <summary style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', cursor: 'pointer', opacity: 0.7 }}>Private league? Add API key</summary>
                                        <input id="wr-mfl-apikey" placeholder="API Key (optional)" style={{ width: '100%', marginTop: '6px', padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--white)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)' }} />
                                    </details>
                                    {mflError && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--k-e74c3c, #e74c3c)', marginBottom: '8px' }}>{mflError}</div>}
                                    <button className="hub-cta gold" disabled={mflConnecting} onClick={() => {
                                        const id = document.getElementById('wr-mfl-id')?.value?.trim();
                                        const yr = document.getElementById('wr-mfl-year')?.value?.trim() || '2026';
                                        const apiKey = document.getElementById('wr-mfl-apikey')?.value?.trim() || '';
                                        handleMFLConnect(id, yr, apiKey);
                                    }}>{mflConnecting ? 'Connecting...' : 'CONNECT MFL'}</button>
                                </div>
                            )}
                        </div>
                    </div>}

                    {/* ──── YAHOO ──── HIDDEN — infrastructure preserved, UI removed */}

                </div>
                </div>
                </div>
                )}

                {showSettings && (
                    <SettingsModal
                        accountOnly={true}
                        onClose={() => setShowSettings(false)}
                        initDisplayName={customDisplayName}
                        onDisplayNameSave={(name) => {
                            if (!accountSessionCurrent()) return;
                            setCustomDisplayName(name);
                            window.OD.saveDisplayName(name);
                        }}
                        leagueMates={leagueMates}
                    />
                )}

            </div>
        );
    }

    ReactDOM.render(<OwnerDashboard />, document.getElementById('root'));
