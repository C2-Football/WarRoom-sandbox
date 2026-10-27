// ══════════════════════════════════════════════════════════════════
// time-league-ai.js — AI managers for Time League. Every function is pure
// and deterministic: randomness flows from createSeededRandom keyed off
// `state.seed` plus a stable context (overall pick, week, trade id), so a
// league replays exactly.
//
// Ported from The Duat's app/time-league-ai.ts.
// ══════════════════════════════════════════════════════════════════
/* global module, require */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    if (!App.TimeLeagueStrategy && typeof module !== 'undefined' && module.exports) require('./time-league-strategy.js');
    const { findOpenRosterSlot } = App.TimeLeagueDraftRoom;
    const { createSeededRandom, ROSTER_SLOT_IDS, SLOT_ELIGIBILITY } = App.TimeLeagueRoster;
    const {
        currentDraftSeat, eraEligibleCards, autoFillLineup, rosterCapacity, freeAgents,
        submitWaiverClaim, respondToTrade, proposeTrade,
    } = App.TimeLeagueEngine;

    const AI_PERSONAS = App.TimeLeagueEngine.AI_PERSONAS;

    const STARTER_SLOTS = ROSTER_SLOT_IDS.filter((slot) => slot !== "BN" && slot !== "IR" && slot !== "TAXI");

    const personaFor = (team) => AI_PERSONAS[team?.aiPersona] || AI_PERSONAS.steward;
    const strategyFor = (state, team) => App.TimeLeagueStrategy?.forTeam(state, team) || { aggressionDelta: 0, patienceDelta: 0, riskDelta: 0, spendMultiplier: 1, depthWeight: .2, tradeThresholdDelta: 0, reason: '' };
    const adaptivePersona = (state, team) => {
        const base = personaFor(team), strategy = strategyFor(state, team);
        return { ...base, aggression: Math.max(0, Math.min(100, base.aggression + strategy.aggressionDelta)),
            patience: Math.max(0, Math.min(100, base.patience + strategy.patienceDelta)),
            riskTolerance: Math.max(0, Math.min(100, base.riskTolerance + strategy.riskDelta * (.3 + base.riskTolerance / 100))) };
    };
    const hidden = state => state?.settings?.hiddenYears === true && state.yearsRevealed !== true;
    const relationshipFor = (state, owner, other) => App.TimeLeagueRivals?.relationshipFor(state, owner, other) || { heat: 0, tradePremium: 0 };
    const hottestRival = (state, owner) => App.TimeLeagueRivals?.hottestRelationship(state, owner) || { heat: 0, aggressionDelta: 0 };
    // A provoked manager spends and negotiates more assertively. These bounded
    // effects use past correspondence only, never hidden bids or future scores.
    const waiverPersona = (state, team) => {
        const base = adaptivePersona(state, team), rivalry = hottestRival(state, team.teamId);
        return { ...base, aggression: Math.min(100, base.aggression + rivalry.aggressionDelta), patience: Math.max(0, base.patience - rivalry.aggressionDelta) };
    };

    /**
     * Difficulty tunes HOW SHARP the AI's decisions are, not its rosters or
     * scoring — persona flavor (aggression/patience/risk) stays the same at
     * every difficulty. "veteran" is the baseline, and older saves retain it
     * unless their manager explicitly chooses another difficulty.
     */
    const DIFFICULTY_TUNING = {
        rookie: { noiseMult: 1.8, marginBonus: 0.12, thresholdDelta: -0.06, bidMult: 0.7 },
        veteran: { noiseMult: 1, marginBonus: 0, thresholdDelta: 0, bidMult: 1 },
        allpro: { noiseMult: 0.35, marginBonus: -0.1, thresholdDelta: 0.07, bidMult: 1.25 },
    };
    const difficultyFor = (state) => DIFFICULTY_TUNING[state.settings.aiDifficulty] ?? DIFFICULTY_TUNING.veteran;

    const AI_DIFFICULTY_LABELS = {
        rookie: { label: 'Rookie', blurb: 'Sloppier picks, easier to fleece in a trade, slower off the wire.' },
        veteran: { label: 'Veteran', blurb: "Today's baseline GM — solid value reads, fair trades, competitive claims." },
        allpro: { label: 'All-Pro', blurb: 'Sharp draft boards, demands real value in trades, wins contested waivers.' },
    };

    /** Accept when incoming covers outgoing x threshold: bold personas take thin wins (~0.95), careful ones demand a premium (~1.04). */
    const acceptThreshold = (persona, difficulty) => {
        const base = 1.08 - 0.16 * ((persona.aggression + persona.riskTolerance) / 200);
        return Math.max(0.75, Math.min(1.35, base + (difficulty ? difficulty.thresholdDelta : 0)));
    };

    /** Patient personas demand a bigger upgrade before spending a waiver claim. */
    const waiverMargin = (persona, difficulty) => {
        const base = 1.05 + (persona.patience / 100) * 0.35;
        return Math.max(1.0, base + (difficulty ? difficulty.marginBonus : 0));
    };

    const pushActivity = (state, kind, message, createdAt) => {
        const last = state.activity.reduce((max, event) => {
            const value = Number(event.id.slice(1));
            return Number.isFinite(value) ? Math.max(max, value) : max;
        }, 0);
        return { ...state, activity: [...state.activity, { id: `a${last + 1}`, week: state.currentWeek, kind, message, createdAt }] };
    };

    function entryValueFromCard(card, drawnSeason) {
        if (!card) return 0;
        if (drawnSeason !== undefined) {
            const drawn = card.seasons.find((item) => item.season === drawnSeason);
            if (drawn) return drawn.points;
        }
        return card.peak;
    }

    const observedRead = (state, cards, entry, logIndex) => {
        const visible = entry.editionId ? entry : { identity: entry.identity, name: entry.name, position: entry.position, hiddenDecade: entry.hiddenDecade, editionId: `mystery:${entry.identity}` };
        const read = App.TimeLeagueHiddenYears?.read(state, visible, cards, logIndex);
        if (read) return read;
        // A missing helper cannot give an AI permission to inspect the draw.
        const seasons = App.TimeLeagueEraRules.filterSeasonsForEra(cards.get(entry.identity)?.seasons || [], state.settings.eraRules, entry.position);
        const values = seasons.map(row => row.points / Math.max(1, row.games || 16));
        return { estimatedAverage: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0, spread: values.length ? Math.max(...values) - Math.min(...values) : 0 };
    };
    const entryValue = (cards, entry, state) => hidden(state) ? Math.max(0, observedRead(state, cards, entry).estimatedAverage || 0) * 16 : entryValueFromCard(cards.get(entry.identity), entry.drawnSeason);
    const bestName = (cards, entries, fallback, state) =>
        [...entries].sort((left, right) => entryValue(cards, right, state) - entryValue(cards, left, state))[0]?.name ?? fallback;

    const starterEligible = (settings, position) =>
        STARTER_SLOTS.some((slot) => (settings.rosterSlots[slot] ?? 0) > 0 && SLOT_ELIGIBILITY[slot].includes(position));

    function draftValue(state, card, persona) {
        const seasons = hidden(state) && App.TimeLeagueHiddenYears ? App.TimeLeagueHiddenYears.eligibleSeasons(state, card)
            : App.TimeLeagueEraRules.filterSeasonsForEra(card.seasons, state.settings.eraRules, card.position);
        if (!seasons.length) return 0;
        const mean = seasons.reduce((sum, season) => sum + season.points, 0) / seasons.length;
        const peak = Math.max(...seasons.map(season => season.points));
        return (mean * (1 - persona.peakWeight) + peak * persona.peakWeight) * (persona.positionBias[card.position] || 1);
    }
    const tradeValue = (cards, entries, persona, state) => entries.reduce((sum, entry) =>
        sum + entryValue(cards, entry, state) * (1 + ((persona.positionBias[entry.position] || 1) - 1) * 0.5), 0);

    function aiDraftChoice(state, cards) {
        cards = App.TimeLeagueEngine.cardsFor(state, cards);
        const seat = state.phase === "draft" ? currentDraftSeat(state) : null;
        const team = seat ? state.teams.find((item) => item.teamId === seat.teamId) : undefined;
        if (!seat || !team) return null;
        const assignedSlots = team.roster.map((entry) => entry.slot);
        const positions = team.roster.map((entry) => entry.position);
        const openBySlot = new Map();
        for (const slot of STARTER_SLOTS) {
            const room = (state.settings.rosterSlots[slot] ?? 0) - assignedSlots.filter((assigned) => assigned === slot).length;
            if (room > 0) openBySlot.set(slot, room);
        }
        const noise = createSeededRandom(`${state.seed}:aidraft:${seat.overall}`);
        const persona = personaFor(team);
        const amp = (0.2 + (persona.riskTolerance / 100) * 0.3) * difficultyFor(state).noiseMult;
        let best = null;
        // The era-eligible board is the whole world for an AI GM: undrafted cards
        // that the league's decades can actually field.
        for (const card of eraEligibleCards(state, cards)) {
            if (!findOpenRosterSlot(card.position, assignedSlots, state.settings.rosterSlots, state.settings.maxQuarterbacks, positions)) continue;
            let openStarters = 0;
            for (const [slot, room] of openBySlot) {
                if (SLOT_ELIGIBILITY[slot].includes(card.position)) openStarters += room;
            }
            const score = draftValue(state, card, persona) * (openStarters > 0 ? 1 + persona.needWeight * openStarters : 0.4) * (1 + (noise() - 0.5) * amp * 0.18);
            if (!best || score > best.score) best = { card, score };
        }
        return best?.card ?? null;
    }

    /** Auction rivals price only the visible, era-eligible board, never the mystery draw. */
    function aiAuctionStep(state, cards, stamp) {
        cards = App.TimeLeagueEngine.cardsFor(state, cards);
        const E = App.TimeLeagueEngine;
        if (state.phase !== 'draft' || state.settings.draftFormat !== 'auction' || state.draftClock?.status !== 'running') return state;
        const n = state.draftAuction?.nomination;
        if (!n) {
            const seat = currentDraftSeat(state), team = state.teams.find(t => t.teamId === seat?.teamId);
            if (team?.manager !== 'ai') return state;
            const card = team.queue.map(id => cards.get(id)).find(c => E.auctionCanBid(state, team.teamId, c)) || aiDraftChoice(state, cards);
            return card ? E.nominateAuctionPlayer(state, team.teamId, card, 1, stamp) : state;
        }
        const card = cards.get(n.identity);
        if (!card) return state;
        const board = eraEligibleCards(state, cards);
        const visibleValue = player => {
            const seasons = hidden(state) && App.TimeLeagueHiddenYears ? App.TimeLeagueHiddenYears.eligibleSeasons(state, player)
                : App.TimeLeagueEraRules.filterSeasonsForEra(player.seasons, state.settings.eraRules, player.position);
            return seasons.length ? seasons.reduce((sum, season) => sum + season.points, 0) / seasons.length : 0;
        };
        const peak = Math.max(1, ...board.map(visibleValue));
        const value = visibleValue(card);
        const contenders = state.teams.filter(t => t.manager === 'ai' && t.teamId !== n.highTeamId && E.auctionCanBid(state, t.teamId, card));
        const random = createSeededRandom(`${state.seed}:auction:${n.identity}:${n.highBid}`);
        const ranked = contenders.map(team => {
            const persona = personaFor(team);
            const max = E.auctionMaxBid(state, team.teamId);
            const average = (state.settings.draftAuctionBudget || 200) / Math.max(1, rosterCapacity(state.settings));
            const preference = draftValue(state, card, persona) / Math.max(1, value);
            const factor = 0.55 + (value / peak) * preference * 2.25 + persona.aggression / 200;
            const limit = Math.min(max, Math.max(1, Math.round(average * factor * difficultyFor(state).bidMult)));
            return { team, limit, order: random() };
        }).filter(item => item.limit > n.highBid).sort((a, b) => a.order - b.order);
        if (!ranked.length) return state;
        const bidder = ranked[0];
        const next = E.bidAuctionPlayer(state, bidder.team.teamId, n.highBid + 1, stamp, cards);
        return next === state ? state : { ...next, draftAuction: { ...next.draftAuction, lastAiAt: stamp } };
    }

    function aiPrepareWeek(state, cards, logIndex, eraFactors) {
        cards = App.TimeLeagueEngine.cardsFor(state, cards);
        const currentAvailability = entry => {
            const endWeek = App.TimeLeagueEngine.seasonEndWeek(state);
            if (state.phase !== 'season' || !state.seasonsRevealed || state.weekStage === 'postgame' || state.currentWeek > endWeek) return null;
            if (state.publicSnapshotVersion === 1) {
                const key = App.TimeLeagueHiddenYears?.editionKey(entry) || entry.editionId || entry.entryId;
                const report = state.playerReports?.[key];
                return report?.week === state.currentWeek && typeof report.currentAvailable === 'boolean' ? report.currentAvailable : null;
            }
            // The same coarse clue is visible in the human roster. Missing
            // data is unknown; it must never turn into a no-game decision.
            if (!logIndex?.size) return null;
            const clue = App.TimeLeagueSeason.weeklyStarOutlook(entry, state.currentWeek, endWeek, logIndex,
                state.settings.scoring, state.settings.eraAdjusted ? eraFactors : null, state);
            const available = clue?.schedule?.find(row => row.week === state.currentWeek)?.available;
            return typeof available === 'boolean' ? available : null;
        };
        return state.teams.reduce((next, team) => {
            if (team.manager !== "ai") return next;
            if (hidden(next)) {
                const persona = adaptivePersona(next, team);
                const values = new Map();
                const value = entry => {
                    if (values.has(entry.entryId)) return values.get(entry.entryId);
                    // Keep the persona's visible-evidence ordering, but prefer
                    // a legal substitute over an explicitly known zero. Only
                    // availability crosses this boundary, never the game score.
                    if (currentAvailability(entry) === false) { values.set(entry.entryId, -1); return -1; }
                    const read = observedRead(next, cards, entry, logIndex);
                    const estimate = Math.max(0, (read.estimatedAverage || 0) + (read.spread || 0) * (persona.riskTolerance - 50) / 500);
                    values.set(entry.entryId, estimate);
                    return estimate;
                };
                const plan = tradeLineup(team.roster, next.settings, value);
                return { ...next, teams: next.teams.map(item => item.teamId !== team.teamId ? item : repairAiLineup({ ...item, roster: item.roster.map(entry =>
                    ['IR', 'TAXI'].includes(entry.slot) ? entry : { ...entry, slot: plan.starterSlots.get(entry.entryId) || 'BN' }) }, next.settings)) };
            }
            let prepared = autoFillLineup(next, team.teamId, cards);
            const current = prepared.teams.find(item => item.teamId === team.teamId);
            const repaired = repairAiLineup(current, prepared.settings);
            if (repaired !== current) prepared = { ...prepared, teams: prepared.teams.map(item => item.teamId === team.teamId ? repaired : item) };
            if (!logIndex || state.phase !== 'season') return prepared;
            // Availability is already visible to managers. A rival should not
            // leave a guaranteed no-game zero in while a legal substitute plays.
            // Inspect keys only: knowing the future score would give AI an edge.
            const available = entry => state.publicSnapshotVersion === 1 && state.settings.gameDeckVersion === 1
                ? state.playerReports?.[App.TimeLeagueSeason.editionKey(entry)]?.currentAvailable === true
                : Boolean(App.TimeLeagueSeason.resolveGameLog(state, entry, state.currentWeek, logIndex, App.TimeLeagueEngine.seasonEndWeek(state)));
            const starters = prepared.teams.find(item => item.teamId === team.teamId).roster
                .filter(entry => STARTER_SLOTS.includes(entry.slot) && !available(entry));
            for (const starter of starters) {
                const roster = prepared.teams.find(item => item.teamId === team.teamId).roster;
                const replacement = roster.filter(entry => entry.slot === 'BN' && available(entry) && SLOT_ELIGIBILITY[starter.slot].includes(entry.position))
                    .sort((left, right) => entryValue(cards, right) - entryValue(cards, left) || left.entryId.localeCompare(right.entryId))[0];
                if (replacement) prepared = App.TimeLeagueEngine.setEntrySlot(prepared, team.teamId, replacement.entryId, starter.slot, starter.entryId);
            }
            return prepared;
        }, state);
    }

    function aiSubmitWaiverClaims(state, cards, createdAt) {
        cards = App.TimeLeagueEngine.cardsFor(state, cards);
        if (state.phase !== "season" || !state.settings.waiversEnabled) return state;
        const capacity = rosterCapacity(state.settings);
        const faab = state.settings.waiverMode === "faab";
        const difficulty = difficultyFor(state);
        // freeAgents already drops era-ineligible cards, so the wire an AI reads
        // is exactly the wire a human sees.
        const pool = freeAgents(state, cards), mystery = hidden(state), values = new Map();
        // A waiver batch changes pending claims, not the observed games. Compute
        // each public valuation once and reuse one standings read per manager.
        const valueOf = entry => {
            const key = entry.identity;
            if (!values.has(key)) values.set(key, entryValue(cards, entry, state));
            return values.get(key);
        };
        return state.teams.reduce((next, team) => {
            if (team.manager !== "ai") return next;
            if (next.pendingClaims.some((claim) => claim.teamId === team.teamId && claim.week === next.currentWeek)) return next;
            if (faab && (team.faabRemaining ?? 0) <= 0) return next;
            const draftPersona = adaptivePersona(next, team);
            const weakest = team.roster.reduce((low, entry) => {
                if (!starterEligible(next.settings, entry.position)) return low;
                const value = valueOf(entry);
                return value < low ? value : low;
            }, Number.POSITIVE_INFINITY);
            const bar = (Number.isFinite(weakest) ? weakest : 0) * waiverMargin(waiverPersona(next, team), difficulty);
            // Adds always land on the bench, so a full BENCH needs a drop even when
            // the roster itself is under capacity — otherwise the claim is doomed.
            const benchFull = team.roster.filter((entry) => entry.slot === "BN").length >= (next.settings.rosterSlots.BN ?? 0);
            const needsDrop = team.roster.length >= capacity || benchFull;
            const drop = needsDrop
                ? team.roster
                    .filter((entry) => entry.slot === "BN")
                    .sort((left, right) => valueOf(left) - valueOf(right) || left.entryId.localeCompare(right.entryId))[0]
                : undefined;
            if (needsDrop && !drop) return next;
            const quarterbacks = team.roster.filter((entry) => entry.position === "QB").length;
            const target = pool.filter((card) => (
                card.seasons.length > 0
                && starterEligible(next.settings, card.position)
                && !(card.position === "QB" && quarterbacks >= next.settings.maxQuarterbacks)
                && (mystery ? valueOf(card) : card.peak) >= bar
            )).sort((left, right) => (mystery ? valueOf(right) - valueOf(left)
                : draftValue(next, right, draftPersona) - draftValue(next, left, draftPersona)) || left.identity.localeCompare(right.identity))[0];
            if (!target) return next;
            let bidAmount;
            if (faab) {
                const persona = waiverPersona(next, team);
                const remaining = team.faabRemaining ?? 0;
                const noise = createSeededRandom(`${state.seed}:aibid:${state.currentWeek}:${team.teamId}`)();
                // Aggressive personas spend a bigger slice of what's left; a touch
                // of noise keeps two same-persona teams from bidding identically.
                const aggressionFactor = (0.08 + (persona.aggression / 100) * 0.25 + noise * 0.05) * difficulty.bidMult * strategyFor(next, team).spendMultiplier;
                bidAmount = Math.max(1, Math.min(remaining, Math.round(remaining * aggressionFactor)));
            }
            return submitWaiverClaim(next, {
                teamId: team.teamId,
                addIdentity: target.identity,
                addName: target.name,
                addPosition: target.position,
                dropEntryId: drop?.entryId ?? "",
                ...(faab ? { bidAmount } : {}),
            }, createdAt);
        }, state);
    }

    function aiTradeRead(state, trade, cards) {
        const from = state.teams.find((team) => team.teamId === trade.fromTeamId);
        const to = state.teams.find((team) => team.teamId === trade.toTeamId);
        if (!from || !to) return null;
        const persona = adaptivePersona(state, to), strategy = strategyFor(state, to);
        const incoming = trade.giveEntryIds.flatMap((id) => from.roster.find((entry) => entry.entryId === id) ?? []);
        const outgoing = trade.receiveEntryIds.flatMap((id) => to.roster.find((entry) => entry.entryId === id) ?? []);
        const complete = incoming.length === trade.giveEntryIds.length && outgoing.length === trade.receiveEntryIds.length;
        // A roster-fit read needs public identity, eligibility and observed
        // scoring only. Do not spread a canonical entry and read its sealed draw.
        const moved = entry => ({ entryId: entry.entryId, editionId: entry.editionId,
            identity: entry.identity, name: entry.name, position: entry.position,
            hiddenDecade: entry.hiddenDecade, slot: 'BN',
            ...(!hidden(state) ? { drawnSeason: entry.drawnSeason } : {}) });
        const after = [...to.roster.filter(entry => !trade.receiveEntryIds.includes(entry.entryId)), ...incoming.map(moved)];
        const legal = tradeLineup(after, state.settings, entry => entryValue(cards, entry, state)).legal;
        const accept = complete && legal && tradeValue(cards, incoming, persona, state) >= tradeValue(cards, outgoing, persona, state) * (acceptThreshold(persona, difficultyFor(state)) + strategy.tradeThresholdDelta + relationshipFor(state, to.teamId, from.teamId).tradePremium);
        return { from, to, persona, strategy, incoming, outgoing, accept };
    }

    // Acceptance is deterministic in this game. A preview therefore reports
    // the current rule's 0/100 decision, never an invented midrange probability.
    function previewTrade(state, offer, cards) {
        const unavailable = (label, reason) => ({ percent: null, label, reason });
        if (state.phase !== 'season' || !['claims', 'lineup'].includes(state.weekStage) || !state.seasonsRevealed) return unavailable('Desk closed', 'Review acceptance during trade planning.');
        if (!offer || (offer.status && offer.status !== 'pending')) return unavailable('Offer settled', 'This offer already has a saved outcome.');
        if (offer.deferredUntilWeek > state.currentWeek) return unavailable('Deferred', `Review this offer in Week ${offer.deferredUntilWeek}.`);
        const problem = App.TimeLeagueEngine.tradeProblem(state, offer);
        if (problem) return unavailable('Roster blocked', problem);
        const recipient = state.teams.find(team => team.teamId === offer.toTeamId);
        if (recipient.manager !== 'ai') return unavailable('Human decision', 'This manager decides whether to accept.');
        cards = App.TimeLeagueEngine.cardsFor(state, cards);
        const entries = state.teams.flatMap(team => team.roster).filter(entry => [...offer.giveEntryIds, ...offer.receiveEntryIds].includes(entry.entryId));
        const bases = new Set();
        const available = entries.every(entry => {
            const card = cards?.get(entry.identity);
            if (!card?.seasons?.length) return false;
            if (hidden(state)) {
                const read = observedRead(state, cards, entry);
                bases.add(read.estimateBasis === 'completed Vault games' ? 'Completed Vault averages' : 'Reference archive averages');
                return Number.isFinite(read.estimatedAverage);
            }
            bases.add('Reference season totals');
            return Number.isFinite(card.seasons.find(season => season.season === entry.drawnSeason)?.points);
        });
        if (!available) return unavailable('Archive unavailable', 'Every selected player needs an available public value.');
        const read = aiTradeRead(state, offer, cards);
        return { percent: read.accept ? 100 : 0, label: read.accept ? 'Would accept now' : 'Would decline now',
            reason: `${[...bases].join(' + ')}. Roster fit, personality and difficulty also apply. This GM uses a fixed rule; roster changes can change the decision.` };
    }

    function resolveAiTrade(state, trade, cards, createdAt) {
        cards = App.TimeLeagueEngine.cardsFor(state, cards);
        if (trade.status !== 'pending') return state;
        const read = aiTradeRead(state, trade, cards);
        if (!read) return state;
        const { to, persona, strategy, incoming, outgoing, accept } = read;
        const inName = bestName(cards, incoming, "That package", state);
        const outName = bestName(cards, outgoing, "my starter", state);
        const note = (accept ? `${persona.accept} ${inName} for ${outName}.` : `${persona.reject} ${outName} stays for now.`) + (strategy.reason ? ` ${strategy.reason}` : '');
        const resolved = respondToTrade(state, trade.tradeId, accept, note, createdAt);
        return resolved === state ? state : pushActivity(resolved, "trade", `${to.name} — ${persona.label}: "${note}"`, createdAt);
    }

    function aiRespondToTrades(state, cards, createdAt) {
        cards = App.TimeLeagueEngine.cardsFor(state, cards);
        return state.trades.reduce((next, trade) => {
            if (trade.status !== "pending" || trade.deferredUntilWeek > state.currentWeek) return next;
            const to = next.teams.find((team) => team.teamId === trade.toTeamId);
            if (!to || to.manager !== "ai") return next;
            const live = next.trades.find((item) => item.tradeId === trade.tradeId);
            return live ? resolveAiTrade(next, live, cards, createdAt) : next;
        }, state);
    }

    // Score the best legal lineup, counting each FLEX seat once. The old
    // position-surplus test counted every FLEX against every eligible position,
    // leaving ordinary twelve-player rosters with no trade candidates at all.
    // The supported eligibility sets are nested or disjoint. Filling narrower
    // sets first, in value order, finds their best lineup without combinatorics.
    function repairAiLineup(team, settings) {
        const assigned = !App.TimeLeagueEngine.lineupProblems({ settings, teams: [team] }, team.teamId).length
            && ['BN', 'IR', 'TAXI'].every(slot => team.roster.filter(entry => entry.slot === slot).length <= (settings.rosterSlots[slot] || 0));
        if (assigned) return team;
        const plan = App.TimeLeagueEngine.rosterFeasibility(team.roster, settings);
        if (!plan.legal) return team;
        const slots = new Map(plan.slots.map(row => [row.entryId, row.slot]));
        // Preserve normal persona/value decisions. Only an invalid assignment
        // uses the same public legal reserve repair available to human managers.
        return { ...team, roster: team.roster.map(entry => slots.get(entry.entryId) === entry.slot ? entry : { ...entry, slot: slots.get(entry.entryId) }) };
    }

    function tradeLineup(roster, settings, valueOf, depthWeight = .2) {
        const remaining = roster.filter(entry => entry.slot !== 'IR' && entry.slot !== 'TAXI')
            .slice().sort((a, b) => valueOf(b) - valueOf(a) || a.entryId.localeCompare(b.entryId));
        const slots = STARTER_SLOTS.slice().sort((a, b) => SLOT_ELIGIBILITY[a].length - SLOT_ELIGIBILITY[b].length);
        let starters = 0, filled = 0, required = 0;
        const starterSlots = new Map();
        for (const slot of slots) {
            required += settings.rosterSlots[slot] || 0;
            for (let n = 0; n < (settings.rosterSlots[slot] || 0); n++) {
                const index = remaining.findIndex(entry => SLOT_ELIGIBILITY[slot].includes(entry.position));
                if (index < 0) continue;
                const entry = remaining.splice(index, 1)[0];
                starterSlots.set(entry.entryId, slot); starters += valueOf(entry); filled++;
            }
        }
        return { starters, filled, required, starterSlots,
            total: starters + remaining.reduce((sum, entry) => sum + valueOf(entry) * depthWeight, 0),
            legal: App.TimeLeagueEngine.rosterFeasibility(roster, settings).legal };
    }

    function tradeEntryAverage(cards, entry, state) {
        if (hidden(state)) return Math.max(0, observedRead(state, cards, entry).estimatedAverage || 0);
        // Only the publicly revealed edition's archive average. Never consult
        // game decks, hidden availability, unused games or future scoring.
        const season = cards.get(entry.identity)?.seasons.find(item => item.season === entry.drawnSeason);
        if (!season || !Number.isFinite(season.points)) return 0;
        return Math.max(0, season.points / Math.max(1, Number(season.games) || 16));
    }

    const sameIdSet = (left, right) => left.length === right.length && left.every(id => right.includes(id));
    const alreadyOffered = (trades, from, to, give, receive) => trades.some(trade =>
        trade.fromTeamId === from && trade.toTeamId === to
        && sameIdSet(trade.giveEntryIds, [give.entryId]) && sameIdSet(trade.receiveEntryIds, [receive.entryId]));

    function aiGenerateTrades(state, cards, createdAt, options = {}) {
        if (state.phase !== 'season' || !state.settings.tradesEnabled || state.seasonsRevealed !== true
            || !['claims', 'lineup'].includes(state.weekStage) || state.publicSnapshotVersion === 1) return state;
        cards = App.TimeLeagueEngine.cardsFor(state, cards);
        if (!cards?.size) return state;
        const values = new Map(state.teams.flatMap(team => team.roster).map(entry => [entry.entryId, tradeEntryAverage(cards, entry, state)]));
        const valueOf = entry => values.get(entry.entryId) || 0;
        const strategies = new Map(state.teams.map(team => [team.teamId, strategyFor(state, team)]));
        const before = new Map(state.teams.map(team => [team.teamId, tradeLineup(team.roster, state.settings, valueOf, strategies.get(team.teamId).depthWeight)]));
        const locked = new Set(state.trades.filter(trade => trade.status === 'pending').flatMap(trade => [...trade.giveEntryIds, ...trade.receiveEntryIds]));
        // One offer per human per week, including rejected offers. An unanswered
        // or deferred offer stays in their inbox instead of spawning new mail.
        const humans = state.teams.filter(team => team.manager === 'human' && !state.trades.some(trade =>
            trade.toTeamId === team.teamId && state.teams.some(owner => owner.teamId === trade.fromTeamId && owner.manager === 'ai')
            && (trade.status === 'pending' || trade.week === state.currentWeek)));
        const eligible = team => team.roster.filter(entry => !locked.has(entry.entryId) && entry.slot !== 'IR' && entry.slot !== 'TAXI' && valueOf(entry) > 0);
        const candidates = [];
        for (const proposer of state.teams.filter(team => team.manager === 'ai')) {
            const persona = adaptivePersona(state, proposer);
            const partners = options.humanOnly ? humans : [...humans, ...state.teams.filter(team => team.manager === 'ai' && team.teamId > proposer.teamId)];
            for (const partner of partners) {
                if (proposer.teamId === partner.teamId) continue;
                for (const give of eligible(proposer)) for (const receive of eligible(partner)) {
                    if (give.position === receive.position || alreadyOffered(state.trades, proposer.teamId, partner.teamId, give, receive)) continue;
                    // Fit can justify a modest value difference, never a lopsided
                    // opening bid that only improves the AI's side of the deal.
                    const ratio = valueOf(give) / valueOf(receive);
                    if (ratio < 0.75 || ratio > 1 / 0.75) continue;
                    const mine = tradeLineup([...proposer.roster.filter(entry => entry !== give), { ...receive, slot: 'BN' }], state.settings, valueOf, strategies.get(proposer.teamId).depthWeight);
                    const theirs = tradeLineup([...partner.roster.filter(entry => entry !== receive), { ...give, slot: 'BN' }], state.settings, valueOf, strategies.get(partner.teamId).depthWeight);
                    if (!mine.legal || !theirs.legal) continue;
                    const myGain = mine.total - before.get(proposer.teamId).total;
                    const theirGain = theirs.total - before.get(partner.teamId).total;
                    const myStarterGain = mine.starters - before.get(proposer.teamId).starters;
                    const theirStarterGain = theirs.starters - before.get(partner.teamId).starters;
                    const premium = Math.max(0, difficultyFor(state).thresholdDelta + strategies.get(proposer.teamId).tradeThresholdDelta + relationshipFor(state, proposer.teamId, partner.teamId).tradePremium);
                    if (myGain < Math.max(0.1, valueOf(give) * premium) || theirGain < 0.1 || myStarterGain < 0 || theirStarterGain < 0) continue;
                    const tie = createSeededRandom(`${state.seed}:trade-fit:${state.currentWeek}:${give.entryId}:${receive.entryId}`)();
                    candidates.push({ proposer, partner, persona, give, receive, myStarterGain, theirStarterGain,
                        rank: Math.min(myGain, theirGain) * 2 + myGain * (1 + strategies.get(proposer.teamId).urgency * .35)
                            + theirGain + (persona.positionBias[receive.position] || 1) * .15 + tie * .01 });
                }
            }
        }
        candidates.sort((a, b) => Number(b.partner.manager === 'human') - Number(a.partner.manager === 'human') || b.rank - a.rank);
        let next = state, aiDeals = state.trades.filter(trade => trade.week === state.currentWeek
            && state.teams.find(team => team.teamId === trade.fromTeamId)?.manager === 'ai'
            && state.teams.find(team => team.teamId === trade.toTeamId)?.manager === 'ai').length;
        const offeredTo = new Set();
        const engagedTeams = new Set(next.trades.filter(trade => trade.status === 'pending').flatMap(trade => [trade.fromTeamId, trade.toTeamId]));
        for (const candidate of candidates) {
            const { proposer, partner, persona, give, receive, myStarterGain, theirStarterGain } = candidate;
            // Asset-level locks are insufficient: two individually legal
            // offers can promise away both players covering the same slot.
            if (engagedTeams.has(proposer.teamId) || locked.has(give.entryId) || locked.has(receive.entryId) || offeredTo.has(partner.teamId)) continue;
            if (partner.manager === 'ai' && (aiDeals >= 1 || engagedTeams.has(partner.teamId))) continue;
            const note = `${persona.pitch} You get ${give.name} (${give.position}) for ${receive.name} (${receive.position}). `
                + `Best-lineup ${hidden(state) ? 'visible-evidence estimate' : 'archive average'}: +${theirStarterGain.toFixed(1)} pts/game for you, +${myStarterGain.toFixed(1)} for ${proposer.name}. `
                + `Both rosters can field a legal lineup. ${hidden(state) ? 'An estimate from observed games and possible years.' : 'Archive comparison, not a game forecast.'} `
                + strategies.get(proposer.teamId).reason;
            const proposed = proposeTrade(next, { fromTeamId: proposer.teamId, toTeamId: partner.teamId, giveEntryIds: [give.entryId], receiveEntryIds: [receive.entryId], note }, createdAt);
            if (proposed === next || proposed.trades.length !== next.trades.length + 1) continue;
            next = proposed;
            offeredTo.add(partner.teamId); locked.add(give.entryId); locked.add(receive.entryId);
            engagedTeams.add(proposer.teamId); engagedTeams.add(partner.teamId);
            if (partner.manager === 'ai') {
                // Both sides already passed the same roster-fit and fairness
                // checks. Human recipients always make their own decision.
                next = respondToTrade(next, next.trades[next.trades.length - 1].tradeId, true, note, createdAt);
                next = { ...next, teams: next.teams.map(team => {
                    if (![proposer.teamId, partner.teamId].includes(team.teamId)) return team;
                    const lineup = tradeLineup(team.roster, next.settings, valueOf);
                    return repairAiLineup({ ...team, roster: team.roster.map(entry => entry.slot === 'IR' || entry.slot === 'TAXI' ? entry
                        : { ...entry, slot: lineup.starterSlots.get(entry.entryId) || 'BN' }) }, next.settings);
                }) };
                aiDeals++;
            }
        }
        return next;
    }

    const api = {
        AI_PERSONAS, AI_DIFFICULTY_LABELS, entryValueFromCard, aiDraftChoice, aiAuctionStep, aiPrepareWeek, aiSubmitWaiverClaims,
        aiRespondToTrades, aiGenerateTrades, strategyFor, adaptivePersona, previewTrade,
    };
    App.TimeLeagueAI = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
