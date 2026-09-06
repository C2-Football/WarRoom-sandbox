'use strict';
const {createHash} = require('node:crypto');
const {canonical, evaluate, SCHEMA_VERSION} = require('../../js/shared/forecast-ledger.js');
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const frozenFields = ['schemaVersion','leagueId','season','decisionWeek','startWeek','endWeek','config','models','rows','sourceAsOf','dynastyModelInputs'];
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN;
const numericOrNull = value => value === null || (typeof value === 'number' && Number.isFinite(value));

// Consistency checks, not signatures: an author can recompute every hash.
function checkRecord(r) {
    if (!r || r.schemaVersion !== SCHEMA_VERSION || r.mode !== 'shadow' || typeof r.leagueId !== 'string' || !r.leagueId || !Number.isInteger(r.season) || !Number.isInteger(r.decisionWeek) || r.decisionWeek < 1 || r.startWeek !== r.decisionWeek + 1 || !Number.isInteger(r.endWeek) || r.endWeek < r.startWeek || r.endWeek > 18 || !Number.isFinite(timestamp(r.capturedAt)) || !r.config || !r.models || !r.runtimeSignatures || !Array.isArray(r.rows) || !r.rows.length) return 'invalid_record';
    const seen = new Set();
    for (const row of r.rows) {
        if (!row || typeof row.pid !== 'string' || !row.pid || seen.has(row.pid) || !row.baseline || !row.challenger || typeof row.challenger.baselineKnown !== 'boolean' || !numericOrNull(row.baseline.points) || !numericOrNull(row.challenger.expectedPoints)) return 'invalid_player_rows';
        seen.add(row.pid);
    }
    const frozen = Object.fromEntries(frozenFields.map(key => [key, r[key]]));
    if (hash(frozen) !== r.inputHash || hash(r.config) !== r.configHash || hash(r.runtimeSignatures) !== r.runtimeHash || hash({inputHash:r.inputHash,runtimeHash:r.runtimeHash,day:r.capturedAt.slice(0,10)}) !== r.id) return 'fingerprint_mismatch';
    return null;
}

// Registration files must come from an operator-controlled archive export and
// complete schedule source. Arbitrary JSON receipts are NOT authenticated here.
function checkRegistration(r, registration, evaluatedAt) {
    const receipts = registration.receipts.filter(receipt => receipt?.id === r.id);
    if (receipts.length !== 1) return {reason:'missing_or_ambiguous_receipt'};
    const received = timestamp(receipts[0].receivedAt);
    if (!Number.isFinite(received) || received < timestamp(r.capturedAt) || received > timestamp(evaluatedAt)) return {reason:'invalid_receipt_time'};
    const cutoffs = registration.cutoffs.filter(c => c?.season === r.season && c?.week === r.startWeek);
    if (cutoffs.length !== 1) return {reason:'missing_or_ambiguous_cutoff'};
    const cutoff = cutoffs[0], deadline = timestamp(cutoff.firstKickoffAt);
    if (!Number.isFinite(deadline) || cutoff.completeSchedule !== true || typeof cutoff.source !== 'string' || !cutoff.source.trim()) return {reason:'invalid_cutoff_evidence'};
    if (received >= deadline) return {reason:'received_at_or_after_first_kickoff'};
    return {receivedAt:receipts[0].receivedAt, deadline:cutoff.firstKickoffAt, source:cutoff.source};
}

function evaluateExport(ledger, outcomes, {registration = null, evaluatedAt = new Date().toISOString()} = {}) {
    if (!Array.isArray(ledger?.records) || !Array.isArray(outcomes) || !Number.isFinite(timestamp(evaluatedAt))) throw Error('Invalid ledger, outcomes or evaluation time');
    if (registration !== null && (!Array.isArray(registration.receipts) || !Array.isArray(registration.cutoffs))) throw Error('Registration requires receipts and cutoffs arrays');
    const rejected = [], eligible = [], duplicates = [], ids = new Set();
    for (const record of ledger.records) {
        const reason = checkRecord(record);
        if (reason) {rejected.push({recordId:record?.id ?? null,reason});continue;}
        if (ids.has(record.id)) {duplicates.push(record.id);continue;}
        ids.add(record.id);
        if (timestamp(record.capturedAt) > timestamp(evaluatedAt)) {rejected.push({recordId:record.id,reason:'future_capture'});continue;}
        const gate = registration ? checkRegistration(record,registration,evaluatedAt) : null;
        if (gate?.reason) {rejected.push({recordId:record.id,reason:gate.reason});continue;}
        eligible.push({record,gate});
    }
    // Choose by receipt time in gated mode, never by subsequent accuracy. Each
    // runtime remains separate; a comparison is not a model promotion decision.
    eligible.sort((a,b) => timestamp(a.gate?.receivedAt || a.record.capturedAt) - timestamp(b.gate?.receivedAt || b.record.capturedAt) || a.record.id.localeCompare(b.record.id));
    const first = new Map(), superseded = [];
    for (const entry of eligible) {
        const r = entry.record, key = canonical([r.leagueId,r.season,r.decisionWeek,r.configHash,r.runtimeHash]);
        if (first.has(key)) superseded.push(r.id); else first.set(key,entry);
    }
    const results = [...first.values()].map(({record,gate}) => {
        try {return {recordId:record.id, registration:gate, ...evaluate(record,outcomes,{evaluatedAt})};}
        catch (error) {return {recordId:record.id,ready:false,reason:'invalid_outcomes',detail:error.message};}
    });
    return {evaluationMode:registration ? 'receipt_cutoff_checked' : 'exploratory', externalEvidenceAuthenticated:false,
        warning:registration ? 'Receipt and schedule provenance must be verified externally. Passing this gate is not proof of model accuracy or authorization to promote it.' : 'Local capture timestamps do not establish advance registration.',
        evaluatedAt, recordsSubmitted:ledger.records.length, rejected, duplicateRecordIds:duplicates, supersededRecordIds:superseded,
        distinctRuns:first.size, matureRuns:results.filter(r=>r.ready).length, results};
}
module.exports = {checkRecord, checkRegistration, evaluateExport};
