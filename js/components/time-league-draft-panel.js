// ══════════════════════════════════════════════════════════════════
// js/components/time-league-draft-panel.js — window.WrTimeLeagueDraftPanel
// The draft room: big board, scout file, queue, and the post-draft reveal.
// Ported from The Duat's app/TimeLeagueDraftCenter.tsx.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const { useMemo, useState, useEffect, useRef } = React;
    const h = React.createElement;

    const DraftRoom = window.App.TimeLeagueDraftRoom;
    const EraRules = window.App.TimeLeagueEraRules;
    const AI = window.App.TimeLeagueAI;
    const Engine = window.App.TimeLeagueEngine;
    const Roster = window.App.TimeLeagueRoster;

    const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const DRAFT_FILTER_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'];
    const DECADE_BY_ID = new Map(EraRules.ERA_DECADES.map((d) => [d.id, d]));
    const positionRank = (position) => { const i = POSITION_ORDER.indexOf(position); return i === -1 ? POSITION_ORDER.length : i; };

    const QB_COLUMNS = [{ key: 'passYd', label: 'Pa Yd' }, { key: 'passTd', label: 'Pa TD' }, { key: 'passInt', label: 'Int' }, { key: 'rushYd', label: 'Ru Yd' }, { key: 'rushTd', label: 'Ru TD' }];
    const RB_COLUMNS = [{ key: 'rushYd', label: 'Ru Yd' }, { key: 'rushTd', label: 'Ru TD' }, { key: 'rec', label: 'Rec' }, { key: 'recYd', label: 'Re Yd' }, { key: 'recTd', label: 'Re TD' }];
    const RECEIVER_COLUMNS = [{ key: 'rec', label: 'Rec' }, { key: 'recYd', label: 'Re Yd' }, { key: 'recTd', label: 'Re TD' }, { key: 'rushYd', label: 'Ru Yd' }, { key: 'rushTd', label: 'Ru TD' }];
    const statColumnsFor = (position) => (position === 'QB' ? QB_COLUMNS : position === 'RB' ? RB_COLUMNS : position === 'K' || position === 'DEF' ? [] : RECEIVER_COLUMNS);

    const spanOf = (seasons) => {
        const first = seasons[0]; const last = seasons[seasons.length - 1];
        if (!first || !last) return '—';
        return first.season === last.season ? String(first.season) : `${first.season}-${last.season}`;
    };
    const seasonSpan = (card) => spanOf(card.seasons);
    const availableYears = (seasons) => {
        const years = [...new Set(seasons.map(row => row.season))].sort((a, b) => a - b);
        const ranges = [];
        for (const year of years) {
            const last = ranges[ranges.length - 1];
            if (last && year === last[1] + 1) last[1] = year;
            else ranges.push([year, year]);
        }
        return ranges.map(([first, last]) => first === last ? String(first) : `${first}–${last}`).join(', ') || 'None';
    };
    const peakOf = (seasons) => {
        const points = seasons.map(season => season.points).filter(Number.isFinite);
        return points.length ? Math.max(...points) : 0;
    };
    // Reference archive PPG is pooled over eligible recorded games. It is not a
    // projection for the concealed season that the game will draw later.
    const archivePpg = (seasons) => {
        const recorded = seasons.filter(season => Number.isFinite(season.points) && Number.isFinite(season.games) && season.games > 0);
        const games = recorded.reduce((sum, season) => sum + season.games, 0);
        return games ? recorded.reduce((sum, season) => sum + season.points, 0) / games : null;
    };
    const pickLabel = (order, overall, round) => {
        const inRound = order.filter((seat) => seat.round === round).findIndex((seat) => seat.overall === overall) + 1;
        return `R${round}.${String(inRound).padStart(2, '0')}`;
    };
    const gradeFor = (total, median) => {
        if (median <= 0) return 'C';
        const ratio = total / median;
        return ratio >= 1.15 ? 'A' : ratio >= 1.05 ? 'B' : ratio >= 0.95 ? 'C' : ratio >= 0.85 ? 'D' : 'F';
    };

    // ── Position Roulette reveal ────────────────────────────────────────
    // Decades roll once at founding. Local leagues remember their presentation
    // in device storage. Online leagues disclose each archive through a server
    // request; undisclosed assignments and player editions are never received.
    const ERA_REVEAL_STORAGE_PREFIX = 'wr-tl-era-reveal:';
    const ERA_ENTRY_STORAGE_PREFIX = 'wr-tl-era-entered:';
    // Stored as the list of position codes the human has actually turned
    // over — a single boolean can't distinguish "QB revealed, RB still
    // pending" from "nothing revealed yet". The legacy '1' value (from the
    // old all-at-once ceremony, before per-position reveal existed) means
    // "this league's ceremony already played in full" — resolved against
    // whatever positions the league currently has assigned, so upgrading
    // this file doesn't re-hide decades a commissioner already saw.
    function loadRevealedPositions(leagueId, allPositions) {
        try {
            const raw = window.localStorage.getItem(ERA_REVEAL_STORAGE_PREFIX + leagueId);
            if (raw === '1') return new Set(allPositions);
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            return new Set(Array.isArray(parsed) ? parsed : []);
        } catch (err) { return new Set(); }
    }
    function saveRevealedPositions(leagueId, positions) {
        try { window.localStorage.setItem(ERA_REVEAL_STORAGE_PREFIX + leagueId, JSON.stringify([...positions])); } catch (err) { /* private mode / quota — worst case a reveal replays once more */ }
    }
    // The era reveal includes only positions this league can actually start.
    function positionDemand(settings, position) {
        return Roster.ROSTER_SLOT_IDS.reduce((demand, slot) => {
            if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') return demand;
            const count = settings.rosterSlots[slot] ?? 0;
            return demand + (count > 0 && Roster.SLOT_ELIGIBILITY[slot].includes(position) ? count : 0);
        }, 0);
    }
    function WrTimeLeagueDraftPanel({ league, cards, onUpdate, onlineMeta, onRevealReadyChange, draftControls, auctionControls, onDraftAction, onRevealEra, logIndex, eraFactors, throughWeek }) {
        const phone = window.WR?.useViewport ? window.WR.useViewport().isPhone : false;
        const archiveCards = cards;
        cards = Engine.cardsFor(league, cards);
        const [query, setQuery] = useState('');
        const [positionSelection, setPositionSelection] = useState({ leagueId: league.leagueId, value: 'ALL' });
        const [selectedIdentity, setSelectedIdentity] = useState(null);
        const [boardView, setBoardView] = useState(null);
        const [historyLimit, setHistoryLimit] = useState(6);
        const recap = Boolean(league.seasonsRevealed);
        const concealed = league.settings.hiddenYears && !league.yearsRevealed;
        const eligibleSeasons = card => league.settings.hiddenYears && window.App.TimeLeagueHiddenYears
            ? window.App.TimeLeagueHiddenYears.eligibleSeasons(league, card)
            : EraRules.filterSeasonsForEra(card.seasons, eraRules, card.position);
        const showBoardGrid = boardView?.leagueId === league.leagueId && boardView.recap === recap ? boardView.grid : recap;
        const [pinnedRosterId, setPinnedRosterId] = useState(null);
        const [note, setNote] = useState('');
        const [pickReceipt, setPickReceipt] = useState(null);
        const draftAttemptRef = useRef(null);
        const activeLeagueRef = useRef(league.leagueId);
        activeLeagueRef.current = league.leagueId;
        const activeReceipt = pickReceipt?.leagueId === league.leagueId ? pickReceipt : null;
        const [boardLimit, setBoardLimit] = useState(24);
        const scoutRef = useRef(null);
        const [scoutOpen, setScoutOpen] = useState(false);
        const scoutDialogRef = useRef(null);
        const scoutTriggerRef = useRef(null);
        const myDraftRef = useRef(null);
        const DraftRoster = window.WrTimeLeagueDraftRoster;
        function viewMyDraft() {
            const panel = myDraftRef.current;
            const details = panel?.querySelector?.('details');
            if (details) details.open = true;
            panel?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
            details?.querySelector('summary')?.focus({ preventScroll: true });
        }

        const seat = useMemo(() => Engine.currentDraftSeat(league), [league]);
        const drafted = useMemo(() => Engine.draftedIdentities(league), [league]);
        const onClockTeam = seat ? league.teams.find((t) => t.teamId === seat.teamId) ?? null : null;
        const humanTeam = league.teams.find((t) => t.manager === 'human' && (!onlineMeta || t.teamId === onlineMeta.seatTeamId)) ?? null;
        const orderedTeams = useMemo(() => Engine.draftTeamOrder(league)
            .map(teamId => league.teams.find(team => team.teamId === teamId)).filter(Boolean), [league]);
        const gridTeamIndex = teamId => orderedTeams.findIndex(team => team.teamId === teamId);
        const isAuction = league.settings.draftFormat === 'auction';
        const clockReady = !league.draftClock || league.draftClock.status === 'running';
        const canSim = !onlineMeta || onlineMeta.role === 'commissioner';
        useEffect(() => {
            if (!activeReceipt || !['saving', 'rejected'].includes(activeReceipt.status)) return;
            const confirmedPick = league.draftPicks.find(pick => pick.identity === activeReceipt.identity);
            const nomination = league.draftAuction?.nomination;
            const confirmedNomination = isAuction && nomination?.identity === activeReceipt.identity;
            if (!confirmedPick && !confirmedNomination) return;
            const belongsToYou = confirmedPick ? confirmedPick.teamId === humanTeam?.teamId : nomination.nominatedBy === humanTeam?.teamId;
            const message = confirmedPick ? belongsToYou ? `${activeReceipt.name} is drafted. The saved roster confirms your pick.` : `${activeReceipt.name} was drafted by ${league.teams.find(team => team.teamId === confirmedPick.teamId)?.name || 'another team'}. Choose another player.`
                : belongsToYou ? `${activeReceipt.name} is nominated. The room confirms bidding is open.` : `${activeReceipt.name} is already on the auction floor. Check the current bidding.`;
            if (activeReceipt.message !== message) setPickReceipt({ ...activeReceipt, status: belongsToYou ? 'confirmed' : 'rejected', message });
        }, [activeReceipt, league.draftPicks, league.draftAuction?.nomination, humanTeam?.teamId, isAuction]);

        const eraRules = useMemo(() => EraRules.normalizeEraDraftRules(league.settings.eraRules), [league.settings.eraRules]);
        const publicSnapshot = league.publicSnapshotVersion === 1;
        const eraRestricted = eraRules.mode !== 'any-era' && (eraRules.decades.length > 0 || Boolean(eraRules.positionDecades));

        const available = useMemo(() => Engine.eraEligibleCards(league, cards).map((card) => {
            const seasons = eligibleSeasons(card);
            return { card, peak: peakOf(seasons), draw: concealed && seasons.length ? `${EraRules.decadeOf(seasons[0].season)} · ${seasons.length} possible year${seasons.length === 1 ? '' : 's'}` : spanOf(seasons) };
        }).sort((left, right) => right.peak - left.peak || left.card.identity.localeCompare(right.card.identity))
            .map((entry, index) => ({ ...entry, rank: index + 1 })), [cards, eraRules, league]);
        const GameDraftTable = window.App.GameDraftTable;
        const draftPool = useMemo(() => {
            // Clear only the taken list: era, playable positions and the server's
            // revealed-position boundary still decide which identities exist.
            const eligible = Engine.eraEligibleCards({ ...league, draftPicks: [] }, cards);
            return eligible.map(card => {
                const seasons = eligibleSeasons(card);
                return { card, seasons, peak: peakOf(seasons), ppg: archivePpg(seasons) };
            }).filter(row => row.seasons.length).sort((left, right) => right.peak - left.peak || left.card.identity.localeCompare(right.card.identity))
                .map((row, index) => ({ ...row, rank: index + 1 }));
        }, [cards, eraRules, league]);
        const positionFilters = useMemo(() => {
            const present = new Set(available.map(({ card }) => card.position));
            return DRAFT_FILTER_ORDER.filter((position) => position === 'FLEX' || position === 'SUPER_FLEX'
                ? Number(league.settings.rosterSlots[position]) > 0
                : present.has(position));
        }, [available, league.settings.rosterSlots]);
        const positionFilter = positionSelection.leagueId === league.leagueId && positionFilters.includes(positionSelection.value) ? positionSelection.value : 'ALL';
        useEffect(() => setBoardLimit(24), [query, positionFilter]);
        useEffect(() => {
            if (positionSelection.leagueId !== league.leagueId || positionSelection.value !== positionFilter) {
                setPositionSelection({ leagueId: league.leagueId, value: positionFilter });
            }
        }, [league.leagueId, positionFilter, positionSelection]);
        const eraAssignments = useMemo(() => {
            if (eraRules.mode !== 'position-roulette') return [];
            const poolSize = new Map();
            for (const { card } of available) poolSize.set(card.position, (poolSize.get(card.position) ?? 0) + 1);
            // Sealed online assignments are absent, but their position buttons
            // still exist. Only the server decides which archives are open.
            const assignments = publicSnapshot
                ? (league.draftVisibility?.allPositions || []).map(position => [position, eraRules.positionDecades?.[position] ?? null])
                : Object.entries(eraRules.positionDecades ?? {});
            return assignments
                .flatMap(([position, decade]) => ((publicSnapshot || decade) && POSITION_ORDER.includes(position) && positionDemand(league.settings, position) > 0 ? [{ position, decade }] : []))
                .sort((l, r) => positionRank(l.position) - positionRank(r.position) || l.position.localeCompare(r.position))
                .map((row) => ({ ...row, detail: DECADE_BY_ID.get(row.decade) ?? null, pool: poolSize.get(row.position) ?? 0 }));
        }, [available, eraRules, league.settings, league.draftVisibility, publicSnapshot]);

        // Rank the reveal leaders by seasons inside their assigned decade.
        // A career peak outside that decade must not move a player up this list.
        const topThreeByPosition = useMemo(() => {
            const map = {};
            for (const entry of available) {
                const pos = entry.card.position;
                const bucket = map[pos] || (map[pos] = []);
                bucket.push(entry);
            }
            for (const position of Object.keys(map)) map[position] = map[position].slice(0, 3);
            return map;
        }, [available]);

        const allEraPositions = useMemo(() => eraAssignments.map((row) => row.position), [eraAssignments]);
        const [localRevealedPositions, setLocalRevealedPositions] = useState(() => publicSnapshot ? new Set() : loadRevealedPositions(league.leagueId, allEraPositions));
        const revealedPositions = useMemo(() => publicSnapshot
            ? new Set((league.draftVisibility?.revealedPositions || []).filter(position => allEraPositions.includes(position) && eraRules.positionDecades?.[position]))
            : localRevealedPositions, [publicSnapshot, league.draftVisibility, allEraPositions, eraRules, localRevealedPositions]);
        const [activeEraPosition, setActiveEraPosition] = useState(() => allEraPositions[0] || null);
        const [enteredDraft, setEnteredDraft] = useState(() => {
            if (league.seasonsRevealed || league.draftPicks.length > 0) return true;
            if (publicSnapshot) return false;
            try {
                const saved = window.localStorage.getItem(ERA_ENTRY_STORAGE_PREFIX + league.leagueId);
                if (saved !== null) return saved === '1';
            } catch { /* Device storage may be unavailable. */ }
            // Existing completed reveals resume at their board after this upgrade.
            return allEraPositions.length > 0 && allEraPositions.every(position => revealedPositions.has(position));
        });
        const freshlyRevealedRef = useRef(new Set());
        const entryButtonRef = useRef(null);
        const draftRoomRef = useRef(null);
        const revealFocusRef = useRef(null);
        const revealBusyRef = useRef(false);
        const [revealPending, setRevealPending] = useState(false);
        const [revealError, setRevealError] = useState('');
        function rememberEntry(entered) {
            if (publicSnapshot) return;
            try { window.localStorage.setItem(ERA_ENTRY_STORAGE_PREFIX + league.leagueId, entered ? '1' : '0'); } catch { /* Keep this session usable. */ }
        }
        async function requestPublicReveal(position) {
            if (revealBusyRef.current) return false;
            if (!onRevealEra) { setRevealError('Reconnect to reveal this archive.'); return false; }
            revealBusyRef.current = true; setRevealPending(true); setRevealError('');
            try {
                const saved = await onRevealEra(position);
                if (saved === false) { setRevealError('The reveal was not saved. Try again.'); return false; }
                const opened = position === 'all' ? allEraPositions : [position];
                opened.forEach(item => freshlyRevealedRef.current.add(item));
                if (allEraPositions.every(item => opened.includes(item) || revealedPositions.has(item))) revealFocusRef.current = 'entry';
                // The confirmed snapshot supplies revealedPositions; never open
                // an archive optimistically while its request is in flight.
                return true;
            } catch {
                setRevealError('The reveal was not saved. Try again.'); return false;
            } finally { revealBusyRef.current = false; setRevealPending(false); }
        }
        function revealPosition(position) {
            setActiveEraPosition(position);
            if (revealedPositions.has(position)) return;
            if (publicSnapshot) return requestPublicReveal(position);
            freshlyRevealedRef.current.add(position);
            if (allEraPositions.every(item => item === position || revealedPositions.has(item))) revealFocusRef.current = 'entry';
            if (!enteredDraft) rememberEntry(false);
            setLocalRevealedPositions(previous => {
                const next = new Set(previous); next.add(position);
                saveRevealedPositions(league.leagueId, next);
                return next;
            });
        }
        function revealAllPositions() {
            if (publicSnapshot) return requestPublicReveal('all');
            revealFocusRef.current = 'entry';
            allEraPositions.forEach(position => freshlyRevealedRef.current.add(position));
            const next = new Set([...revealedPositions, ...allEraPositions]);
            if (!enteredDraft) rememberEntry(false);
            saveRevealedPositions(league.leagueId, next);
            setLocalRevealedPositions(next);
        }
        const anyPending = eraRules.mode === 'position-roulette' && allEraPositions.some(position => !revealedPositions.has(position));
        const revealReady = league.seasonsRevealed || eraRules.mode !== 'position-roulette' || (!anyPending && enteredDraft);
        function enterDraft() {
            if (anyPending || revealPending) return;
            revealFocusRef.current = 'board';
            rememberEntry(true); setEnteredDraft(true);
        }
        useEffect(() => { onRevealReadyChange?.(revealReady); }, [onRevealReadyChange, revealReady]);
        useEffect(() => {
            if (revealFocusRef.current === 'entry' && !anyPending && !enteredDraft) {
                entryButtonRef.current?.focus(); revealFocusRef.current = null;
            } else if (revealFocusRef.current === 'board' && revealReady) {
                draftRoomRef.current?.focus(); revealFocusRef.current = null;
            }
        }, [anyPending, enteredDraft, revealReady, revealPending]);
        const canScoutCard = (card) => Boolean(card && (eraRules.mode !== 'position-roulette' || revealedPositions.has(card.position)));
        function openScout(card, event) {
            if (!canScoutCard(card)) return;
            const trigger = event?.currentTarget;
            scoutTriggerRef.current = trigger?.querySelector?.('.game-draft-player-link') || trigger || window.document?.activeElement || null;
            setSelectedIdentity(card.identity);
            setScoutOpen(true);
        }
        function closeScout() {
            setScoutOpen(false);
            scoutTriggerRef.current?.focus?.();
        }
        useEffect(() => {
            if (!scoutOpen || !window.document) return undefined;
            const dialog = scoutDialogRef.current;
            const previousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            dialog?.querySelector('button')?.focus();
            const handleKey = (event) => {
                if (event.key === 'Escape') { event.preventDefault(); closeScout(); return; }
                if (event.key !== 'Tab') return;
                const controls = [...(dialog?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex="0"]') || [])];
                const first = controls[0]; const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            };
            document.addEventListener('keydown', handleKey);
            return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); };
        }, [scoutOpen, selectedIdentity]);

        const filtered = useMemo(() => {
            const term = query.trim().toLowerCase();
            if (!revealReady) return [];
            return available.filter(({ card }) => (positionFilter === 'ALL' || Roster.SLOT_ELIGIBILITY[positionFilter]?.includes(card.position)) && (!term || card.name.toLowerCase().includes(term)));
        }, [available, positionFilter, query, revealReady]);
        const visible = filtered.slice(0, boardLimit);

        const requestedCard = selectedIdentity ? cards.get(selectedIdentity) : null;
        const selectedCard = (canScoutCard(requestedCard) ? requestedCard : null) ?? visible[0]?.card ?? null;
        const queueCards = useMemo(() => (humanTeam && revealReady
            ? humanTeam.queue.map((id) => cards.get(id)).filter((c) => c && !drafted.has(c.identity))
            : []), [cards, drafted, humanTeam, revealReady]);

        const gridPicks = useMemo(() => {
            if (!isAuction) return league.draftPicks;
            const acquired = new Map();
            return [...league.draftPicks].sort((left, right) => left.overall - right.overall).map((pick) => {
                const row = (acquired.get(pick.teamId) || 0) + 1;
                acquired.set(pick.teamId, row);
                return { ...pick, round: row };
            });
        }, [isAuction, league.draftPicks]);
        const gridOrder = useMemo(() => {
            if (!isAuction) return league.draftOrder;
            const rowCount = Math.max(1, ...league.draftOrder.map((slot) => slot.round), ...gridPicks.map((pick) => pick.round));
            return Array.from({ length: rowCount }, (_, index) => orderedTeams.map((team) => {
                const pick = gridPicks.find((entry) => entry.round === index + 1 && entry.teamId === team.teamId);
                return { round: index + 1, teamId: team.teamId, overall: pick?.overall ?? null };
            })).flat();
        }, [isAuction, league.draftOrder, orderedTeams, gridPicks]);
        const draftPickLabel = (pick) => isAuction ? `Award #${pick.overall}` : pickLabel(league.draftOrder, pick.overall, pick.round);
        const pickByOverall = useMemo(() => new Map(league.draftPicks.map((p) => [p.overall, p])), [league.draftPicks]);
        const boardRounds = useMemo(() => {
            const rounds = new Map();
            for (const orderSeat of gridOrder) rounds.set(orderSeat.round, [...(rounds.get(orderSeat.round) ?? []), orderSeat]);
            return [...rounds.entries()];
        }, [gridOrder]);
        const teamName = (teamId) => league.teams.find((t) => t.teamId === teamId)?.name ?? teamId;

        const reveal = useMemo(() => {
            if (!league.seasonsRevealed || concealed) return null;
            const entryById = new Map(league.teams.flatMap((t) => t.roster.map((e) => [e.entryId, e])));
            const teams = league.teams.map((team) => {
                const picks = league.draftPicks.filter((p) => p.teamId === team.teamId).sort((l, r) => l.overall - r.overall).map((pick) => {
                    const drawnSeason = entryById.get(pick.entryId)?.drawnSeason;
                    return { ...pick, drawnSeason, points: AI.entryValueFromCard(cards.get(pick.identity), drawnSeason) };
                });
                return { team, picks, total: Math.round(picks.reduce((sum, p) => sum + p.points, 0) * 10) / 10 };
            });
            const totals = teams.map((t) => t.total).sort((l, r) => l - r);
            const median = totals.length === 0 ? 0 : totals.length % 2 ? totals[(totals.length - 1) / 2] : (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2;
            const best = [...teams].sort((l, r) => r.total - l.total)[0] ?? null;
            return { teams, median, best };
        }, [cards, league]);

        function draftBlockReason(card) {
            if (draftAttemptRef.current?.leagueId === league.leagueId) return 'Saving your selection…';
            if (!revealReady) return 'Open every position archive before the draft begins';
            if (!seat || !onClockTeam) return 'Draft complete';
            if (!clockReady) return league.draftClock.status === 'paused' ? 'Draft paused' : 'Start the draft to make picks';
            if (isAuction && league.draftAuction?.nomination) return 'Bidding is open — finish the current player first';
            if (onlineMeta && seat.teamId !== onlineMeta.seatTeamId) return `Waiting for ${onClockTeam.name} to pick`;
            if (drafted.has(card.identity)) return 'Already drafted';
            if (!card.seasons.length) return 'No playable seasons on file';
            if (!EraRules.eraEligibleCard(card, eraRules)) return "No season on file clears the league's era rule";
            if (card.position === 'QB' && onClockTeam.roster.filter((e) => e.position === 'QB').length >= league.settings.maxQuarterbacks) {
                return `QB cap reached (max ${league.settings.maxQuarterbacks})`;
            }
            const open = DraftRoom.findOpenRosterSlot(card.position, onClockTeam.roster.map((e) => e.slot), league.settings.rosterSlots, league.settings.maxQuarterbacks, onClockTeam.roster.map((e) => e.position));
            return open ? null : `No open roster slot fits ${card.position}`;
        }

        const stripDraftedFromQueues = (state) => {
            const taken = Engine.draftedIdentities(state);
            if (!state.teams.some((t) => t.queue.some((id) => taken.has(id)))) return state;
            return { ...state, teams: state.teams.map((t) => (t.queue.some((id) => taken.has(id)) ? { ...t, queue: t.queue.filter((id) => !taken.has(id)) } : t)) };
        };

        async function draftCard(card, madeBy) {
            if (draftBlockReason(card)) return;
            if (isAuction && !onDraftAction) return;
            const attempt = { leagueId: league.leagueId, identity: card.identity, name: card.name };
            draftAttemptRef.current = attempt;
            setSelectedIdentity(card.identity);
            setNote('');
            setPickReceipt({ ...attempt, status: 'saving', message: `${isAuction ? 'Nominating' : 'Drafting'} ${card.name}…` });
            const current = () => draftAttemptRef.current === attempt && activeLeagueRef.current === attempt.leagueId;
            try {
                let saved;
                if (isAuction) saved = await onDraftAction({ type: 'auction-nominate', identity: card.identity, amount: 1, teamId: seat.teamId });
                else if (onDraftAction) saved = await onDraftAction({ type: 'draft', identity: card.identity });
                else {
                    const next = Engine.applyDraftPick(league, card, { madeBy, createdAt: new Date().toISOString() });
                    saved = next !== league && await onUpdate(stripDraftedFromQueues(next), { type: 'draft', identity: card.identity });
                }
                if (!current()) return;
                if (saved === false) {
                    setPickReceipt({ ...attempt, status: 'rejected', message: `${card.name} was not confirmed. Your selection and filters are kept; check the room status before trying again.` });
                    return;
                }
                setPickReceipt({ ...attempt, status: 'confirmed', message: isAuction ? `${card.name} is nominated. Bidding is open.` : `${card.name} is drafted. Your roster is updated.` });
                setSelectedIdentity(null); setScoutOpen(false);
            } catch {
                if (current()) setPickReceipt({ ...attempt, status: 'rejected', message: `${card.name} could not be confirmed. Your selection and filters are kept; reconnect and check the roster before trying again.` });
            } finally {
                if (draftAttemptRef.current === attempt) draftAttemptRef.current = null;
            }
        }

        function simAiPick() {
            if (!revealReady || !clockReady || isAuction || !canSim || !seat || onClockTeam?.manager !== 'ai') return;
            if (onDraftAction) { onDraftAction({ type: 'ai-pick' }); return; }
            const choice = AI.aiDraftChoice(league, cards);
            if (!choice) { setNote('AI found no eligible player for this seat.'); return; }
            const next = Engine.applyDraftPick(league, choice, { madeBy: 'ai', createdAt: new Date().toISOString() });
            if (next === league) { setNote('The AI pick was rejected by the engine.'); return; }
            setNote('');
            onUpdate(stripDraftedFromQueues(next), { type: 'ai-pick' });
        }

        function simToMyPick() {
            if (!revealReady || !clockReady || isAuction || !canSim) return;
            if (onDraftAction) { onDraftAction({ type: 'ai-run' }); return; }
            let state = league;
            const createdAt = new Date().toISOString();
            for (let iteration = 0; iteration <= state.draftOrder.length; iteration += 1) {
                const active = Engine.currentDraftSeat(state);
                const team = active ? state.teams.find((t) => t.teamId === active.teamId) : null;
                if (!active || !team || team.manager !== 'ai') break;
                const choice = AI.aiDraftChoice(state, cards);
                if (!choice) break;
                const next = Engine.applyDraftPick(state, choice, { madeBy: 'ai', createdAt });
                if (next === state) break;
                state = next;
            }
            if (state === league) { setNote('Nothing to simulate.'); return; }
            setNote('');
            onUpdate(stripDraftedFromQueues(state), { type: 'ai-run' });
        }

        function toggleQueueFor(identity) {
            if (!humanTeam || !revealReady || drafted.has(identity) || draftAttemptRef.current?.leagueId === league.leagueId) return;
            onUpdate({ ...league, teams: league.teams.map((t) => (t.teamId === humanTeam.teamId ? { ...t, queue: DraftRoom.toggleDraftQueue(t.queue, identity) } : t)) }, { type: 'queue', teamId: humanTeam.teamId, identity });
        }

        function autoFromQueue() {
            const card = queueCards.find((c) => draftBlockReason(c) === null);
            if (!card) { setNote('No queued player fits the on-clock roster.'); return; }
            draftCard(card, 'human');
        }

        const humanOnClock = onClockTeam?.manager === 'human';
        const myTurn = humanOnClock && (!onlineMeta || seat?.teamId === onlineMeta.seatTeamId);
        const turn = useMemo(() => {
            const paused = league.draftClock?.status === 'paused';
            const waiting = league.draftClock?.status === 'waiting';
            const nomination = isAuction && league.draftAuction?.nomination;
            let distance = -1, nextPick = null;
            if (isAuction) {
                // A lot can fill its winner's roster and change the next
                // rotation. Only count nominations between settled auctions.
                if (!nomination && seat) {
                    const open = orderedTeams.filter(team => team.roster.length < Engine.rosterCapacity(league.settings));
                    const start = open.findIndex(team => team.teamId === seat.teamId);
                    distance = open.slice(start).concat(open.slice(0, start)).findIndex(team => team.teamId === humanTeam?.teamId);
                }
            } else {
                const taken = new Set(league.draftPicks.map(pick => pick.overall));
                const remaining = league.draftOrder.filter(pick => !taken.has(pick.overall)).sort((left, right) => left.overall - right.overall);
                distance = remaining.findIndex(pick => pick.teamId === humanTeam?.teamId);
                nextPick = distance >= 0 ? remaining[distance] : null;
            }
            const full = humanTeam && humanTeam.roster.length >= Engine.rosterCapacity(league.settings);
            const yours = distance === 0 && !nomination;
            let label, detail;
            if (!humanTeam) {
                label = 'DRAFT IN PROGRESS';
                detail = nomination ? 'Watching the current auction.' : 'Watching the draft.';
            } else if (nomination) {
                label = full ? 'YOUR ROSTER IS FULL' : 'BIDDING OPEN';
                detail = full ? 'Follow the remaining auctions.' : 'Eligible teams can bid on this player.';
            } else if (distance < 0) {
                label = 'YOUR DRAFT IS COMPLETE';
                detail = 'Follow the remaining selections.';
            } else if (isAuction) {
                label = yours ? 'YOUR NOMINATION' : distance === 1 ? 'YOU NOMINATE NEXT' : `${distance} NOMINATIONS UNTIL YOURS`;
                detail = yours ? 'Choose a player to open bidding.' : `${onClockTeam?.name || 'The current manager'} is choosing a player.`;
            } else {
                label = yours ? 'YOUR PICK' : distance === 1 ? 'YOU’RE NEXT' : `${distance} PICKS UNTIL YOUR TURN`;
                detail = yours ? 'Choose a player to lock in your pick.' : nextPick ? `Next pick: ${pickLabel(league.draftOrder, nextPick.overall, nextPick.round)} · #${nextPick.overall}` : '';
            }
            if (paused || waiting) {
                detail = !humanTeam ? paused ? 'The draft will continue when the room resumes.' : 'The draft has not started.'
                    : nomination ? 'Bidding resumes with the current player.'
                    : yours ? `Your ${isAuction ? 'nomination' : 'pick'} when the draft ${paused ? 'resumes' : 'starts'}.`
                        : distance > 0 ? `${distance} ${isAuction ? 'nomination' : 'pick'}${distance === 1 ? '' : 's'} until your turn.` : 'Your draft is complete.';
                label = paused ? 'DRAFT PAUSED' : 'WAITING TO START';
            }
            return { label, detail, yours: yours && !paused && !waiting, distance };
        }, [league, isAuction, seat, orderedTeams, humanTeam, onClockTeam]);
        const scoutBlock = selectedCard ? (onClockTeam && !humanOnClock ? `${onClockTeam.name} is on the clock — sim picks to advance.` : draftBlockReason(selectedCard)) : null;
        const canDraftSelected = Boolean(selectedCard && myTurn && !draftBlockReason(selectedCard));
        const selectedQueued = Boolean(selectedCard && humanTeam?.queue.includes(selectedCard.identity));
        const draftRows = revealReady ? draftPool.map(({ card, seasons, rank, peak, ppg }) => {
            const pick = league.draftPicks.find(item => item.identity === card.identity);
            const block = !myTurn && !drafted.has(card.identity) ? `${onClockTeam?.name || 'Another manager'} is on the clock` : draftBlockReason(card);
            return {
                id: card.identity, name: card.name, position: card.position, card, rank,
                detail: `${seasons.length} eligible season${seasons.length === 1 ? '' : 's'} · ${league.settings.hiddenYears ? 'Hidden year' : 'Season drawn after draft'}`,
                years: availableYears(seasons), firstYear: Math.min(...seasons.map(season => season.season)),
                peak, ppg, seasons, drafted: Boolean(pick), draftedBy: pick ? teamName(pick.teamId) : null,
                canDraft: myTurn && !draftBlockReason(card), draftDisabledReason: block,
            };
        }) : [];
        const draftColumns = [
            { key: 'years', label: 'Eligible years', title: 'Seasons inside this league’s era and archive rules', getValue: row => row.firstYear, render: row => row.years, defaultDirection: 'asc' },
            { key: 'ppg', label: 'Archive PPG', title: 'Reference scoring points per recorded game across eligible seasons; not a weekly projection', getValue: row => row.ppg, render: row => row.ppg == null ? '—' : row.ppg.toFixed(1), defaultDirection: 'desc' },
            { key: 'peak', label: 'Peak pts', title: 'Best eligible archived season in reference scoring; the drawn season may differ', getValue: row => row.peak, render: row => row.peak.toFixed(1), defaultDirection: 'desc' },
        ];
        const draftPositionOptions = DRAFT_FILTER_ORDER.filter(position => position === 'FLEX' || position === 'SUPER_FLEX'
            ? Number(league.settings.rosterSlots[position]) > 0 : draftPool.some(row => row.card.position === position))
            .map(position => ({ value: position, label: position === 'SUPER_FLEX' ? 'SUPER FLEX' : position, positions: Roster.SLOT_ELIGIBILITY[position] || [position] }));
        function scoutingForRow(row) {
            const seasons = row.seasons || eligibleSeasons(row.card);
            const games = seasons.reduce((total, season) => total + (Number.isFinite(season.games) && season.games > 0 ? season.games : 0), 0);
            const points = seasons.map(season => season.points).filter(Number.isFinite);
            const low = points.length ? Math.min(...points) : null, high = points.length ? Math.max(...points) : null;
            const opening = humanTeam ? DraftRoom.findOpenRosterSlot(row.position, humanTeam.roster.map(entry => entry.slot), league.settings.rosterSlots,
                league.settings.maxQuarterbacks, humanTeam.roster.map(entry => entry.position)) : null;
            const slot = opening?.slot || null;
            const label = slot === 'BN' ? 'bench' : slot === 'SUPER_FLEX' ? 'superflex' : slot === 'FLEX' ? 'flex' : slot;
            const owned = humanTeam?.roster.filter(entry => entry.position === row.position).length || 0;
            const reason = row.drafted ? `Already drafted by ${row.draftedBy || 'another team'}. You can still compare the public archive.`
                : !humanTeam ? 'Choose your seat to see roster fit.'
                    : !slot ? `Your roster has no legal opening for another ${row.position}.`
                        : slot === 'BN' ? `Adds ${row.position} depth on the bench. You already have ${owned} at this position.`
                            : `Fills an open ${label} slot. You currently have ${owned} ${row.position}${owned === 1 ? '' : 's'}.`;
            return {
                subtitle: `${row.position} · ${availableYears(seasons)} · ${league.settings.gameDeckVersion === 1 ? 'NFL regular-season archive' : 'Legacy archive · W1–14'}`,
                summary: points.length ? `${seasons.length} eligible season${seasons.length === 1 ? '' : 's'} range from ${low.toFixed(1)} to ${high.toFixed(1)} reference points.` : 'Eligible archive totals are unavailable.',
                reason,
                confidence: `${seasons.length === 1 ? 'One eligible season' : `${seasons.length} possible seasons`}; the drawn edition is sealed. Archive values are reference scoring, not a weekly forecast.`,
                metrics: [
                    { label: 'Eligible archive PPG', value: row.ppg == null ? '—' : row.ppg.toFixed(1) },
                    { label: 'Peak season pts', value: high == null ? '—' : high.toFixed(1) },
                    { label: 'Recorded games', value: games ? String(games) : '—' },
                    { label: 'Roster fit', value: row.drafted ? 'Already drafted' : humanTeam ? label ? label.toUpperCase() : 'No open slot' : 'No seat' },
                ],
            };
        }
        const scoutCard = selectedCard ? archiveCards.get(selectedCard.identity) || selectedCard : null;
        const eligibleScoutSeasons = selectedCard ? eligibleSeasons(selectedCard) : [];
        const fullScoutByYear = new Map((scoutCard?.seasons || []).map(season => [season.season, season]));
        // New-archive exclusions must not hide editions that remain draftable
        // in an existing league. Preserve those rows with their legacy scope.
        const scoutLegacyFallbackYears = new Set(eligibleScoutSeasons.filter(season => !fullScoutByYear.has(season.season)).map(season => season.season));
        const scoutSeasons = eligibleScoutSeasons.map(season => fullScoutByYear.get(season.season) || season);
        const scoutHidden = selectedCard ? selectedCard.seasons.length - scoutSeasons.length : 0;
        const fullSeasonScout = scoutSeasons.length > 0 && scoutSeasons.every(season => season.sourceWeekKind);
        const mixedSeasonScout = scoutLegacyFallbackYears.size > 0 && scoutSeasons.some(season => season.sourceWeekKind);
        const legacyScout = (fullSeasonScout || mixedSeasonScout) && league.settings.gameDeckVersion !== 1;
        const selectedDrafted = selectedCard && drafted.has(selectedCard.identity);
        const hasScoutBio = selectedCard?.bio && ['college', 'height', 'weight', 'draftTeam', 'draftYear', 'birthDate'].some(key => selectedCard.bio[key]);
        const pickFeedback = activeReceipt && h('div', { className: 'tl-draft-receipt', 'data-state': activeReceipt.status,
            role: activeReceipt.status === 'rejected' ? 'alert' : 'status', 'aria-atomic': true },
            h('strong', null, activeReceipt.status === 'saving' ? 'Saving selection' : activeReceipt.status === 'confirmed' ? 'Confirmed' : 'Not confirmed'),
            h('span', null, activeReceipt.message));

        const scoutFile = h('div', { className: 'tl-card tl-scout-file', ref: scoutRef },
                        h('div', { className: 'tl-card-title' }, h('span', null, 'Scout file'), h('small', null, selectedCard ? (scoutHidden > 0 ? `${scoutSeasons.length} of ${selectedCard.seasons.length} seasons draftable` : `${scoutSeasons.length} seasons on record`) : 'no selection')),
                        selectedCard ? h(React.Fragment, null,
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
                                h('strong', { style: { fontSize: 15 } }, selectedCard.name),
                                h('span', { className: 'tl-pos-badge tl-pos-' + selectedCard.position }, selectedCard.position),
                                selectedCard.bio?.hofYear && h('span', { className: 'tl-pill gold' }, `HOF ${selectedCard.bio.hofYear}`),
                                h('span', { className: 'tl-label' }, `${spanOf(scoutSeasons)} · ${fullSeasonScout ? 'NFL archive peak' : mixedSeasonScout ? 'archive peak' : 'draw peak'} ${peakOf(scoutSeasons).toFixed(1)}`),
                                scoutHidden > 0 && scoutSeasons.length > 0 && h('span', { className: 'tl-pill warn' }, `${scoutHidden} seasons outside this draw`)),
                            hasScoutBio && h('div', { className: 'tl-scout-bio', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10, fontSize: 12 } },
                                selectedCard.bio.college && h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'College'), h('strong', null, selectedCard.bio.college)),
                                (selectedCard.bio.height || selectedCard.bio.weight) && h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Size'), h('strong', null, [selectedCard.bio.height, selectedCard.bio.weight].filter(Boolean).join(' · '))),
                                (selectedCard.bio.draftTeam || selectedCard.bio.draftYear) && h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'NFL draft'), h('strong', null, [selectedCard.bio.draftYear, selectedCard.bio.draftTeam].filter(Boolean).join(' · '))),
                                selectedCard.bio.birthDate && h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, 'Born'), h('strong', null, selectedCard.bio.birthDate))),
                            scoutSeasons.length === 0 && h('p', { className: 'tl-empty' }, "No season on this file clears the league's era rule — nothing here can be drawn."),
                            !selectedDrafted && scoutSeasons.length > 0 && h('p', { className: 'tl-era-years' }, `Available years: ${availableYears(scoutSeasons)}`),
                            scoutSeasons.length > 0 && h('div', { className: 'tl-scout-seasons', role: 'region', 'aria-label': 'Season statistics, newest first', tabIndex: 0, style: { overflowX: 'auto', marginBottom: 10 } }, h('table', { className: 'tl-tbl tl-scout-season-table', style: { minWidth: `${162 + (statColumnsFor(selectedCard.position).length + 1 + Number(legacyScout)) * 64}px` } },
                                h('colgroup', null, h('col', { style: { width: 66 } }), h('col', { style: { width: 60 } }), h('col', { style: { width: 100 } }), legacyScout && h('col'), statColumnsFor(selectedCard.position).map(c => h('col', { key: c.key }))),
                                h('thead', null, h('tr', null, h('th', { scope: 'col', className: 'num', title: mixedSeasonScout ? 'Reference scoring fantasy points for each row’s labelled archive scope' : fullSeasonScout ? 'Recorded NFL regular-season fantasy points · reference scoring' : 'Weeks 1–14 archive fantasy points · reference scoring' }, 'FPTS'), h('th', { scope: 'col' }, 'Year'), h('th', { scope: 'col', className: 'num', title: mixedSeasonScout ? 'Legacy rows count only archive weeks 1–14; other rows count recorded NFL regular-season games' : fullSeasonScout ? 'Distinct regular-season games with archived records' : 'Games in archive weeks 1–14' }, 'GP'), legacyScout && h('th', { scope: 'col', className: 'num', title: 'Preserved Weeks 1–14 points used by this saved league' }, 'Vault W1–14'), statColumnsFor(selectedCard.position).map((c) => h('th', { scope: 'col', className: 'num', key: c.key }, c.label)))),
                                h('tbody', null, [...scoutSeasons].sort((a, b) => b.season - a.season).map((season) => h('tr', { key: season.season },
                                    h('td', { className: 'num' }, season.points.toFixed(1), ...(scoutLegacyFallbackYears.has(season.season) ? [h('small', { style: { display: 'block' } }, 'Legacy W1–14')] : [])), h('td', null, season.season), h('td', { className: 'num' }, season.games, ...(mixedSeasonScout && scoutLegacyFallbackYears.has(season.season) ? [h('small', { style: { display: 'block' } }, 'Vault GP')] : [])),
                                    legacyScout && h('td', { className: 'num' }, selectedCard.seasons.find(row => row.season === season.season)?.points.toFixed(1) ?? '—'),
                                    statColumnsFor(selectedCard.position).map((c) => h('td', { className: 'num', key: c.key }, season[c.key]))))))),
                            scoutHidden > 0 && h('p', { className: 'tl-hint', style: { marginBottom: 10 } }, `${scoutHidden} season${scoutHidden === 1 ? '' : 's'} hidden — outside the league's era rule for ${selectedCard.position}, so they cannot be drawn.`),
                            scoutOpen && pickFeedback,
                            h('div', { className: 'tl-draft-card-actions', style: { display: 'flex', gap: 8 } },
                                h('button', { className: 'tl-btn primary', disabled: !canDraftSelected, onClick: () => draftCard(selectedCard, 'human') }, `${isAuction ? 'NOMINATE' : 'DRAFT'} ${selectedCard.name.toUpperCase()}`),
                                h('button', { className: 'tl-btn', disabled: !humanTeam || !revealReady || drafted.has(selectedCard.identity), 'aria-pressed': selectedQueued, onClick: () => toggleQueueFor(selectedCard.identity) }, selectedQueued ? 'Unqueue' : 'Queue')),
                            scoutBlock && h('p', { style: { fontSize: 11.5, color: 'var(--warn)', marginTop: 8 } }, scoutBlock))
                            : h('p', { className: 'tl-empty' }, 'Select a player on the big board to open the scout file.'));
        const scoutDialog = scoutOpen && selectedCard ? h('div', { className: 'tl-scout-overlay', onClick: (event) => { if (event.target === event.currentTarget) closeScout(); } },
            h('section', { className: 'tl-scout-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': `${selectedCard.name} career scout`, ref: scoutDialogRef },
                h('div', { className: 'tl-scout-dialog-header' }, h('strong', null, 'Career in this draw'), h('button', { type: 'button', className: 'tl-btn', onClick: closeScout }, '← Back to draft')), scoutFile)) : null;

        const activeEra = eraAssignments.find(row => row.position === activeEraPosition) || eraAssignments[0];
        const activeLanded = activeEra && revealedPositions.has(activeEra.position);
        const nextEra = eraAssignments.find(row => !revealedPositions.has(row.position));
        const openedCount = allEraPositions.filter(position => revealedPositions.has(position)).length;
        const eraRoom = eraAssignments.length > 0 ? h('section', { className: 'tl-card tl-era-show', 'aria-label': 'Position Roulette reveal' },
            h('header', { className: 'tl-era-room-heading' },
                h('div', null, h('span', { className: 'tl-label' }, 'POSITION ROULETTE'), h('h2', null, 'Meet your draft class')),
                h('span', { className: 'tl-era-open-count', role: 'status' }, revealPending ? 'Opening archive…' : `${openedCount}/${allEraPositions.length} revealed`)),
            revealError && h('p', { className: 'tl-hint', role: 'alert' }, revealError),
            h('div', { className: 'tl-era-stage', role: 'group', 'aria-label': 'Position eras' },
                eraAssignments.map(row => {
                    const landed = revealedPositions.has(row.position);
                    return h('button', { key: row.position, type: 'button',
                        className: `tl-era-tile${landed ? ' is-revealed' : ' is-sealed'}${activeEra?.position === row.position ? ' is-active' : ''}`,
                        'aria-pressed': activeEra?.position === row.position,
                        'aria-label': landed ? `View ${row.position} era · ${row.detail?.label ?? row.decade} · ${row.pool} players` : `Reveal ${row.position} era`,
                        disabled: revealPending, onClick: () => revealPosition(row.position),
                    }, h('span', { className: `tl-pos-badge tl-pos-${row.position}` }, row.position),
                    h('strong', null, landed ? row.detail?.label ?? row.decade : '?'),
                    h('small', null, landed ? `${row.pool} players` : 'Reveal'));
                })),
            activeEra && h('div', { key: `${activeEra.position}:${activeLanded}`, className: `tl-era-feature${activeLanded && freshlyRevealedRef.current.has(activeEra.position) ? ' is-fresh' : ''}` },
                activeLanded ? h(React.Fragment, null,
                    h('div', { className: 'tl-era-feature-heading' },
                        h('div', null, h('span', { className: 'tl-label' }, `${activeEra.position} · TOP THREE`), h('h3', null, activeEra.detail?.label ?? activeEra.decade)),
                        h('span', { className: 'tl-era-coverage' }, availableYears(available.filter(({ card }) => card.position === activeEra.position).flatMap(({ card }) => eligibleSeasons(card))))),
                    h('div', { className: 'tl-era-shortlist', 'aria-label': `${activeEra.position} top three` },
                        (topThreeByPosition[activeEra.position] || []).map(({ card }, index) => h('button', {
                            key: card.identity, type: 'button', className: 'tl-era-headliner',
                            'aria-label': `Scout ${card.name} in the ${activeEra.detail?.label ?? activeEra.decade}`,
                            onClick: event => openScout(card, event),
                        }, h('span', { className: 'tl-era-headliner-rank' }, String(index + 1).padStart(2, '0')),
                        h('span', null, h('strong', null, card.name), h('small', null, availableYears(eligibleSeasons(card)))),
                        h('span', { className: 'tl-era-scout-link', 'aria-hidden': true }, 'Scout ›')))),
                    activeEra.pool === 0 && h('p', { className: 'tl-empty' }, 'No players remain at this position.'))
                : h('div', { className: 'tl-era-invitation' },
                    h('span', { className: 'tl-era-invitation-mark', 'aria-hidden': true }, '✦'),
                    h('h3', null, 'Decades of possibility'),
                    h('button', { type: 'button', className: 'tl-btn primary', disabled: revealPending, onClick: () => revealPosition(activeEra.position) }, `Reveal ${activeEra.position}`))),
            h('footer', { className: 'tl-era-room-actions' },
                nextEra ? h(React.Fragment, null,
                    h('button', { type: 'button', className: 'tl-btn', disabled: revealPending, onClick: revealAllPositions }, 'Reveal all'),
                    activeLanded && h('button', { type: 'button', className: 'tl-btn primary', disabled: revealPending, onClick: () => revealPosition(nextEra.position) }, `Reveal ${nextEra.position} →`))
                    : !enteredDraft ? h('button', { ref: entryButtonRef, type: 'button', className: 'tl-btn primary', disabled: revealPending, onClick: enterDraft }, 'Enter draft →')
                        : h('small', null, 'Your eras stay fixed for this league.')))
            : null;
        const eraBanner = eraRules.mode === 'position-roulette'
            ? revealReady ? h('details', { className: 'tl-era-review' },
                h('summary', null, h('strong', null, 'Your eras'), h('span', { className: 'tl-era-review-chips' }, eraAssignments.map(row =>
                    h('span', { key: row.position }, h('b', null, row.position), row.detail?.label ?? row.decade))), h('span', { className: 'tl-era-review-toggle' }, 'Scout eras')), eraRoom)
                : eraRoom
            : eraRestricted ? h('div', { className: 'tl-card' },
                h('div', { className: 'tl-card-title' }, h('span', null, 'Era of play'), h('small', null, `${eraRules.decades.length} decade${eraRules.decades.length === 1 ? '' : 's'} in play · ${available.length} draftable`)),
                h('div', { className: 'tl-chip-row' }, eraRules.decades.map(id => h('span', { key: id, className: 'tl-pill info' }, DECADE_BY_ID.get(id)?.label ?? id))))
            : null;

        const recentPicks = [...league.draftPicks].sort((a, b) => b.overall - a.overall);
        const latestPick = recentPicks[0];
        const roomWindow = recentPicks.slice(0, 6);
        let streak = 0;
        for (const pick of recentPicks) {
            if (!latestPick || pick.position !== latestPick.position) break;
            streak++;
        }
        const runPosition = POSITION_ORDER.find(position => roomWindow.filter(pick => pick.position === position).length >= 4);
        const roomRun = streak >= 3 && POSITION_ORDER.includes(latestPick?.position)
            ? { position: latestPick.position, detail: `${streak} straight picks` }
            : runPosition ? { position: runPosition, detail: `${roomWindow.filter(pick => pick.position === runPosition).length} of the last ${roomWindow.length}` } : null;
        const clockStateLabel = league.draftClock?.status === 'paused' ? 'Paused'
            : league.draftClock?.status === 'waiting' ? 'Waiting to start'
                : myTurn ? 'Your turn' : 'Picking now';
        const publicPickEra = pick => {
            if (eraRules.mode === 'position-roulette' && !revealedPositions.has(pick.position)) return null;
            const entry = league.teams.flatMap(team => team.roster).find(row => row.identity === pick.identity);
            const advertised = entry?.hiddenDecade || league.hiddenYearDecades?.[pick.identity]
                || (eraRules.mode === 'position-roulette' ? eraRules.positionDecades?.[pick.position] : null);
            if (advertised) return advertised;
            const card = cards.get(pick.identity);
            const decades = card ? [...new Set(eligibleSeasons(card).map(season => EraRules.decadeOf(season.season)))].filter(Boolean).sort() : [];
            return decades.join(', ') || null;
        };
        const pickFeed = h('div', { className: 'tl-draft-pick-feed' },
            h('ol', { className: 'tl-draft-feed-list', 'aria-label': 'Recent draft picks, newest first' }, recentPicks.slice(0, historyLimit).map((pick, index) =>
                h('li', { key: pick.overall, className: `tl-draft-feed-pick tl-draft-pick-${pick.position}${index === 0 ? ' is-latest' : ''}` },
                    h('span', { className: 'tl-draft-feed-number' }, `#${pick.overall}`),
                    h('div', { className: 'tl-draft-feed-player' }, h('strong', null, pick.name),
                        publicPickEra(pick) && h('span', { className: 'tl-draft-feed-era', title: 'Public eligible era; the assigned season stays sealed until its reveal' }, publicPickEra(pick)),
                        h('small', null, `${teamName(pick.teamId)} · ${draftPickLabel(pick)}${Number.isFinite(pick.auctionPrice) ? ` · $${pick.auctionPrice}` : ''}`)),
                    h('span', { className: 'tl-draft-feed-position' }, pick.position)))),
            recentPicks.length > historyLimit && h('button', { type: 'button', className: 'tl-btn tl-draft-feed-more', onClick: () => setHistoryLimit(limit => limit + 12) }, `Show earlier picks (${recentPicks.length - historyLimit})`));
        const drawnByOverall = new Map((reveal?.teams || []).flatMap((row) => row.picks.map((pick) => [pick.overall, pick])));
        const draftCell = (pick) => {
            const drawn = drawnByOverall.get(pick.overall);
            return h('div', { className: `tl-draft-pick tl-draft-pick-${pick.pos || pick.position}${!recap && pick.overall === latestPick?.overall ? ' is-latest' : ''}`, title: pick.name },
                h('small', null, `#${pick.overall} · ${pick.pos || pick.position}${Number.isFinite(pick.auctionPrice) ? ` · $${pick.auctionPrice}` : ''}`),
                h('strong', null, pick.name),
                drawn && h('span', null, `${drawn.drawnSeason ?? '—'} · ${drawn.points.toFixed(1)} pts`));
        };
        const dhqState = {
            picks: gridPicks.map((pick) => ({ ...pick, pos: pick.position, teamIdx: gridTeamIndex(pick.teamId), isUser: pick.teamId === humanTeam?.teamId })),
            pickOrder: gridOrder.map((slot) => ({ ...slot, teamIdx: gridTeamIndex(slot.teamId), rosterId: slot.teamId, ownerName: teamName(slot.teamId) })),
            userSlot: gridTeamIndex(humanTeam?.teamId) + 1,
            userRosterId: humanTeam?.teamId, leagueSize: league.teams.length, rounds: boardRounds.length,
            currentIdx: league.draftPicks.length, phase: 'vault', mode: 'ghost', pinnedRosterId,
            personas: Object.fromEntries(league.teams.map((team) => [team.teamId, { teamName: team.name }]))
        };
        const sharedGrid = window.DraftCC?.DraftGridPanel ? h(window.DraftCC.DraftGridPanel, {
            state: dhqState, currentSlot: seat && !isAuction ? dhqState.pickOrder.find((slot) => slot.overall === seat.overall) : null,
            isUserTurn: turn.yours, dispatch: (action) => { if (action.type === 'PIN_TEAM') setPinnedRosterId(action.rosterId); }, renderPick: draftCell, embedded: true
        }) : null;
        const draftLog = h('div', { className: 'tl-card tl-draft-log' },
            h('div', { className: 'tl-card-title' }, h('span', null, !recap && !showBoardGrid ? 'Recent picks' : isAuction ? 'Auction results' : 'Draft board'),
                h('button', { className: 'tl-btn', onClick: () => setBoardView({ leagueId: league.leagueId, recap, grid: !showBoardGrid }) }, showBoardGrid ? recap ? 'Pick list' : 'Recent picks' : 'Board grid')),
            showBoardGrid && league.draftPicks.length > 0 && h('p', { className: 'tl-draft-scroll-hint' }, isAuction ? 'Swipe across teams · each row is an acquisition' : 'Swipe across to see every team'),
            league.draftPicks.length === 0 ? h('p', { className: 'tl-empty' }, 'No picks yet — the log fills as the room drafts.')
                : showBoardGrid
                    ? sharedGrid || h('div', { className: 'tl-draft-fallback-scroll', role: 'region', 'aria-label': 'Draft grid by round and team', tabIndex: 0 }, h('table', { className: 'tl-tbl tl-draft-fallback-grid', style: { minWidth: `${league.teams.length * 148 + 30}px` } },
                        h('thead', null, h('tr', null, h('th', null, isAuction ? 'Add' : 'Rd'), orderedTeams.map((team) => h('th', { key: team.teamId }, team.name)))),
                        h('tbody', null, boardRounds.map(([round, seats]) => h('tr', { key: round },
                            h('td', { className: 'num' }, round),
                            orderedTeams.map((team) => {
                                const cell = seats.find((slot) => slot.teamId === team.teamId);
                                if (!cell) return h('td', { key: team.teamId }, '—');
                                const pick = pickByOverall.get(cell.overall);
                                return h('td', { key: team.teamId }, h('div', null, h('span', { className: 'tl-label', style: { display: 'block' } }, teamName(cell.teamId)), pick ? draftCell(pick) : h('span', null, '—')));
                            }))))))
                    : !recap ? pickFeed : h('div', { style: { overflowX: 'auto' } }, h('table', { className: 'tl-tbl' },
                        h('thead', null, h('tr', null, h('th', null, 'Pick'), h('th', null, 'Team'), h('th', null, 'Player'), h('th', null, 'Pos'), h('th', null, 'By'))),
                        h('tbody', null, [...league.draftPicks].reverse().map((pick) => h('tr', { key: pick.overall },
                            h('td', null, draftPickLabel(pick)), h('td', null, teamName(pick.teamId)),
                            h('td', null, pick.name), h('td', null, h('span', { className: `tl-pos-badge tl-pos-${pick.position}` }, pick.position)),
                            h('td', null, pick.madeBy === 'ai' ? 'AI' : 'HU')))))));

        if (league.seasonsRevealed && concealed) {
            return h('div', { className: 'tl-draft-recap' },
                h('section', { className: 'tl-card tl-recap-summary', 'aria-label': 'Draft summary' },
                    h('div', { className: 'tl-recap-heading' }, h('strong', null, 'Draft complete · hidden-year mode'), h('small', null, `${league.draftPicks.length} picks · ${league.teams.length} teams`)),
                    h('p', { className: 'tl-hint' }, 'Every player has one fixed year in the advertised decade. Explore possible seasons from My team; completed games add clues. One remaining candidate identifies the year. The final recap reveals unresolved years.')),
                draftLog,
                h('div', { className: 'tl-draft-grade-grid' }, league.teams.map(team => h('details', { key: team.teamId, className: 'tl-card tl-draft-grade' },
                    h('summary', { className: 'tl-draft-class-summary' }, h('strong', null, team.name), h('small', null, `${team.roster.length} players · hidden-year mode`)),
                    h('div', { className: 'tl-draft-class-body' }, team.roster.map(entry => h('p', { key: entry.entryId }, h('strong', null, entry.name), ` · ${entry.position} · ${window.WrTimeLeagueYearLabel?.(league, entry, cards, logIndex, eraFactors, throughWeek) ?? window.App.TimeLeagueHiddenYears.label(league, entry, cards)}`)))))));
        }

        if (league.seasonsRevealed && reveal) {
            const myClass = reveal.teams.find(({ team }) => team.teamId === humanTeam?.teamId);
            return h('div', { className: 'tl-draft-recap' },
                h('section', { className: 'tl-card tl-recap-summary', 'aria-label': 'Draft summary' },
                    h('div', { className: 'tl-recap-heading' }, h('strong', null, 'Draft complete'), h('small', null, `${league.draftPicks.length} picks · ${league.teams.length} teams · ${boardRounds.length} rounds`)),
                    h('div', { className: 'tl-recap-stats' },
                        myClass && h('div', { className: 'tl-recap-stat is-grade' }, h('span', null, 'Your grade'), h('strong', null, gradeFor(myClass.total, reveal.median))),
                        myClass && h('div', { className: 'tl-recap-stat' }, h('span', null, 'Your class'), h('strong', null, myClass.total.toFixed(1)), h('small', null, 'season points')),
                        h('div', { className: 'tl-recap-stat' }, h('span', null, 'League median'), h('strong', null, reveal.median.toFixed(1)), h('small', null, 'season points'))),
                    reveal.best && h('p', { className: 'tl-recap-best' }, 'Best class: ', h('strong', null, reveal.best.team.name), ` · ${reveal.best.total.toFixed(1)} pts`)),
                draftLog,
                h('div', { className: 'tl-draft-grade-heading' },
                    h('h2', null, 'Team report cards'),
                    h('p', null, 'Grades compare drawn-season points with the league median.')),
                h('div', { className: 'tl-draft-grade-grid' },
                    reveal.teams.map(({ team, picks, total }) => {
                        const grade = gradeFor(total, reveal.median);
                        const best = [...picks].sort((l, r) => r.points - l.points)[0];
                        const isMine = team.teamId === humanTeam?.teamId;
                        return h('details', { key: team.teamId, className: 'tl-card tl-draft-grade', 'data-grade': grade },
                            h('summary', { className: 'tl-draft-class-summary' },
                                h('span', { className: 'tl-draft-class-team' },
                                    h(window.TimeLeagueHelmetIcon, { helmet: team.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(team.name), size: 46 }),
                                    h('span', null, h('strong', null, team.name), h('small', null, `${isMine ? 'Your team · ' : ''}${picks.length} picks`))),
                                h('span', { className: 'tl-draft-grade-mark', 'aria-label': `Grade ${grade}` }, h('small', null, 'Grade'), h('b', null, grade)),
                                h('span', { className: 'tl-draft-class-total' }, h('strong', null, total.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })), ' season pts'),
                                h('span', { className: 'tl-draft-class-toggle' },
                                    h('span', { className: 'tl-draft-class-expand' }, 'View picks'),
                                    h('span', { className: 'tl-draft-class-collapse' }, 'Hide picks'),
                                    h('span', { className: 'tl-draft-class-chevron', 'aria-hidden': true }, '⌄'))),
                            h('div', { className: 'tl-draft-class-body' },
                                best && h('div', { className: 'tl-draft-class-standout' },
                                    h('div', null, h('small', null, 'Best draw'), h('strong', null, best.name), h('span', null, `${best.position} · ${best.drawnSeason ?? '—'}`)),
                                    h('div', { className: 'tl-draft-class-standout-points' }, h('strong', null, best.points.toFixed(1)), h('small', null, 'season pts'))),
                                h('table', { className: 'tl-draft-class-table', 'aria-label': `${team.name} draft picks` },
                                    h('colgroup', null, h('col', { className: 'tl-draft-class-pick-col' }), h('col'), h('col', { className: 'tl-draft-class-points-col' })),
                                    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Pick'), h('th', { scope: 'col' }, 'Player / season'), h('th', { scope: 'col' }, 'Pts'))),
                                    h('tbody', null, picks.length ? picks.map((pick) => h('tr', { key: pick.overall, className: `tl-draft-class-row tl-draft-pick-${pick.position}` },
                                        h('td', { className: 'tl-draft-class-pick' }, draftPickLabel(pick)),
                                        h('td', { className: 'tl-draft-class-player' }, h('strong', null, pick.name),
                                            h('span', { className: 'tl-draft-class-season' }, h('span', { className: 'tl-draft-class-position' }, pick.position), pick.drawnSeason ?? '—')),
                                        h('td', { className: 'tl-draft-class-points' }, pick.points.toFixed(1)))) : h('tr', null, h('td', { colSpan: 3, className: 'tl-draft-class-empty' }, 'No picks recorded.'))))));
                    })));
        }

        if (!revealReady) return h('div', { className: 'tl-draft-sealed' }, eraBanner,
            h('p', { className: 'tl-draft-sealed-note' }, anyPending ? 'Reveal every position, then enter the draft.' : 'Scout your class. Enter the draft when you’re ready.'), scoutDialog);

        return h('div', null,
            eraBanner,
            scoutDialog,
            h('div', { ref: draftRoomRef, role: 'region', 'aria-label': 'Draft room', tabIndex: -1, className: `tl-card tl-on-clock${turn.yours ? ' your-turn' : ''}` },
                h('div', { className: 'tl-draft-progress', 'aria-label': `Draft ${Math.round(league.draftPicks.length / league.draftOrder.length * 100)} percent complete` }, h('span', { style: { width: `${league.draftPicks.length / league.draftOrder.length * 100}%` } })),
                draftControls,
                h('div', { className: 'tl-draft-turn', role: 'status', 'aria-live': 'polite', 'aria-atomic': true },
                    h('strong', { className: 'tl-draft-turn-label' }, turn.label),
                    h('span', { className: 'tl-draft-turn-detail' }, turn.detail)),
                h('div', { className: 'tl-draft-turn-footer', 'aria-label': 'Current draft turn' },
                    h('div', { className: 'tl-draft-current-manager' },
                        onClockTeam && h(window.TimeLeagueHelmetIcon, { helmet: onClockTeam.helmet, letter: window.App.TimeLeagueHelmet.monogramFor(onClockTeam.name), size: 32, title: onClockTeam.name }),
                        h('div', null,
                            h('small', { className: 'tl-draft-seat-label' }, seat ? `${isAuction ? 'Nominating' : 'On the clock'} · #${seat.overall}` : 'Draft complete'),
                            h('strong', null, isAuction && league.draftAuction?.nomination ? league.draftAuction.nomination.name : onClockTeam?.name || 'Draft complete'),
                            h('small', null, isAuction && league.draftAuction?.nomination ? `Nominated by ${teamName(league.draftAuction.nomination.nominatedBy)}`
                                : seat ? `${isAuction ? 'Nomination' : 'Pick'} ${seat.overall} of ${league.draftOrder.length}${isAuction ? '' : ` · ${pickLabel(league.draftOrder, seat.overall, seat.round)}`} · ${clockStateLabel}` : `${league.draftPicks.length} picks recorded`))),
                    h('div', { className: `tl-draft-room-run${roomRun ? ' is-active' : ''}` },
                        h('strong', null, roomRun ? `${roomRun.position} run` : 'No position run'), roomRun && h('span', null, roomRun.detail)),
                    onClockTeam && !humanOnClock && canSim && !isAuction && h('div', { className: 'tl-draft-sim-actions' },
                        h('button', { className: 'tl-btn', disabled: !clockReady, onClick: simAiPick }, '▶ Sim pick'),
                        h('button', { className: 'tl-btn', disabled: !clockReady, onClick: simToMyPick }, '⏭ Sim to my pick'))),
                note && h('p', { className: 'tl-pick-feedback', role: 'status', style: { fontSize: 12, color: 'var(--warn)', marginTop: 8 } }, note)),
            auctionControls,
            league.phase === 'draft' && selectedCard && h('div', { className: 'tl-draft-dock' },
                humanTeam && DraftRoster && h('button', { type: 'button', className: 'tl-dock-roster', 'aria-label': 'View my drafted team', onClick: viewMyDraft }, h('small', null, 'My team'), h('strong', { className: 'tabular' }, `${humanTeam.roster.length}/${Engine.rosterCapacity(league.settings)}`)),
                h('button', { className: 'tl-dock-player', onClick: (event) => openScout(selectedCard, event), 'aria-label': `Scout ${selectedCard.name}` },
                    h('span', { className: `tl-pos-badge tl-pos-${selectedCard.position}` }, selectedCard.position), h('span', null, h('small', null, turn.label), h('b', null, selectedCard.name))),
                h('button', { className: 'tl-btn primary', 'aria-label': `${isAuction ? 'Nominate' : 'Draft'} ${selectedCard.name}`, disabled: !canDraftSelected, onClick: () => draftCard(selectedCard, 'human') }, isAuction ? 'Nominate' : 'Draft', h('span', { 'aria-hidden': 'true' }, '↗'))),
            h('div', { className: 'tl-grid-2 tl-draft-grid' },
                h('div', { className: 'tl-draft-main-board' },
                    !scoutOpen && pickFeedback,
                    GameDraftTable ? h(GameDraftTable, {
                        key: league.leagueId, className: 'tl-vault-draft-table', title: 'Find your next legend',
                        preferenceKey: 'vault-draft-board-v1', workspaceKey: `vault:${league.leagueId}:${onlineMeta?.userId || 'local'}:${humanTeam?.teamId || 'viewer'}`,
                        scoutingForRow,
                        statusText: `${available.length} available · ${isAuction ? 'Auction' : league.settings.draftFormat === 'linear' ? 'Linear' : 'Snake'} draft`,
                        rows: draftRows, columns: draftColumns, positionOptions: draftPositionOptions,
                        selectedId: selectedCard?.identity, onSelect: (row, event) => openScout(row.card, event),
                        queuedIds: humanTeam?.queue || [], onToggleQueue: humanTeam ? row => toggleQueueFor(row.id) : undefined,
                        onDraft: row => myTurn ? draftCard(row.card, 'human') : undefined, draftLabel: isAuction ? 'Nominate' : 'Draft',
                        query, onQueryChange: setQuery, restoreQuery: true,
                        emptyText: cards.size === 0 ? 'No player cards loaded.' : 'No eligible players match these filters.',
                        filterControls: h('p', { className: 'tl-draft-metric-note' }, 'Archive PPG and peak use eligible seasons in reference scoring. Your drawn season may differ.'),
                    }) : h(React.Fragment, null,
                    h('div', { className: 'tl-card tl-player-board' },
                        h('div', { className: 'tl-card-title' }, h('span', null, 'Find your next legend'), h('small', null, `${visible.length} of ${filtered.length} ${query.trim() || positionFilter !== 'ALL' ? 'matching' : eraRestricted ? 'era-eligible' : 'available'}`)),
                        h('div', { className: 'tl-draft-board-tools', style: { display: 'flex', gap: 8, marginBottom: 10 } },
                            h('input', { className: 'tl-input', value: query, onChange: (e) => setQuery(e.target.value), placeholder: 'Search player', 'aria-label': 'Search players' }),
                            h('select', { className: 'tl-select', style: { width: 138, flexShrink: 0 }, value: positionFilter, onChange: (e) => setPositionSelection({ leagueId: league.leagueId, value: e.target.value }), 'aria-label': 'Filter position' },
                                h('option', { value: 'ALL' }, 'ALL POS'), positionFilters.map((p) => h('option', { key: p, value: p }, p === 'SUPER_FLEX' ? 'SUPER FLEX' : p)))),
                        h('div', { className: 'tl-mobile-player-list' }, visible.map(({ card, rank, draw, peak }) => h('div', { key: card.identity, className: `tl-mobile-player${selectedCard?.identity === card.identity ? ' selected' : ''}`, 'data-position': card.position },
                            h('button', { className: 'tl-mobile-player-pick', 'aria-pressed': selectedCard?.identity === card.identity, 'aria-label': `Scout ${card.name}`, onClick: (event) => openScout(card, event) },
                                h('span', { className: 'tl-player-number' }, h('small', null, String(rank).padStart(2, '0')), h('b', null, card.position)),
                                h('span', { className: 'tl-player-name' }, h('b', null, card.name), h('small', null, `${eraRestricted ? draw : seasonSpan(card)} · Mystery season`)),
                                h('span', { className: 'tl-player-peak', title: 'Best eligible archived season · reference scoring' }, h('b', null, Math.round(peak)), h('small', null, eraRestricted ? 'DRAW PEAK' : 'PEAK'))),
                            h('button', { className: 'tl-player-star', 'aria-label': `${humanTeam?.queue.includes(card.identity) ? 'Unqueue' : 'Queue'} ${card.name}`, 'aria-pressed': Boolean(humanTeam?.queue.includes(card.identity)), disabled: !humanTeam, onClick: () => toggleQueueFor(card.identity) }, humanTeam?.queue.includes(card.identity) ? '★' : '☆')))),
                        visible.length === 0
                            ? h('p', { className: 'tl-empty' }, cards.size === 0 ? 'No player cards loaded.' : eraRestricted && available.length === 0 ? "No player on file clears this league's era rule — the pool is empty." : 'No available players match the filters.')
                            : h('div', { className: 'tl-desktop-player-board', style: { maxHeight: 520, overflowY: 'auto' } }, h('table', { className: 'tl-tbl' },
                                h('thead', null, h('tr', null, h('th', { className: 'num' }, 'Rk'), h('th', null, 'Player'), h('th', null, 'Pos'), h('th', null, eraRestricted ? 'Draw' : 'Seasons'), h('th', { className: 'num', title: 'Best eligible archived season · reference scoring' }, eraRestricted ? 'Draw peak' : 'Peak'), h('th', null, 'Q'))),
                                h('tbody', null, visible.map(({ card, rank, draw, peak }) => {
                                    const queued = Boolean(humanTeam?.queue.includes(card.identity));
                                    return h('tr', { key: card.identity, className: `clickable${selectedCard?.identity === card.identity ? ' selected' : ''}`, onClick: (event) => openScout(card, event) },
                                        h('td', { className: 'num tabular' }, rank), h('td', null, h('button', { className: 'tl-scout-player-name', type: 'button', onClick: (event) => { event.stopPropagation(); openScout(card, event); } }, card.name)),
                                        h('td', null, h('span', { className: `tl-pos-badge tl-pos-${card.position}` }, card.position)),
                                        h('td', null, eraRestricted ? draw : seasonSpan(card)),
                                        h('td', { className: 'num tabular' }, peak.toFixed(1)),
                                        h('td', null, h('button', {
                                            className: `tl-btn icon${queued ? ' primary' : ''}`, 'aria-pressed': queued, disabled: !humanTeam,
                                            onClick: (e) => { e.stopPropagation(); toggleQueueFor(card.identity); },
                                        }, '★')));
                                }))))),
                    filtered.length > visible.length && h('button', { className: 'tl-btn tl-show-more', onClick: () => setBoardLimit(value => value + 24) }, `Show more legends · ${filtered.length - visible.length} more`)),
                    draftLog),
                h('div', { className: 'tl-draft-sidebar' },
                    league.phase === 'draft' && humanTeam && DraftRoster && h('div', { ref: myDraftRef, className: 'tl-draft-my-roster' }, h(DraftRoster, { league, team: humanTeam,
                        highlightIdentity: !isAuction && activeReceipt?.status === 'confirmed' ? activeReceipt.identity : null,
                        onScout: (identity, event) => openScout(cards.get(identity), event) })),
                    !GameDraftTable && (phone ? h('details', { className: 'tl-draft-phone-extra' }, h('summary', null, selectedCard ? `Scout file · ${selectedCard.name}` : 'Scout file'), scoutFile) : scoutFile),
                    h('div', { className: 'tl-card' },
                        h('div', { className: 'tl-card-title' }, h('span', null, 'My queue'), h('small', null, humanTeam ? `${humanTeam.name} · ${queueCards.length} queued` : 'no human seat')),
                        queueCards.length === 0 ? h('p', { className: 'tl-empty' }, 'Queue empty — star players on the big board.')
                            : h('div', { className: 'tl-queue-strip' }, queueCards.map((card, i) => h('div', { key: card.identity, className: 'tl-queue-chip' },
                                h('span', { className: 'tl-qnum' }, i + 1),
                                h('button', { type: 'button', className: 'tl-queue-player-card', onClick: event => openScout(card, event) }, card.name),
                                h('span', { className: `tl-pos-badge tl-pos-${card.position}` }, card.position),
                                h('button', { className: 'tl-btn icon', style: { padding: '2px 5px' }, 'aria-label': `Remove ${card.name} from queue`, onClick: (e) => { e.stopPropagation(); toggleQueueFor(card.identity); } }, '✕')))),
                        h('button', { className: 'tl-btn', disabled: !myTurn || !clockReady || (isAuction && Boolean(league.draftAuction?.nomination)) || queueCards.length === 0, onClick: autoFromQueue, style: { marginTop: 8 } }, isAuction ? 'Nominate from queue' : 'Auto from queue')))));
    }

    window.WrTimeLeagueDraftPanel = WrTimeLeagueDraftPanel;
})();
