/* global module */
// Shadow-only availability scenarios. No calibrated injury/return probabilities.
(function(root) {
    'use strict';
    const VERSION = 'availability-scenarios-v1';
    const NO_TEAM = new Set(['', 'FA', 'FA*', 'NONE', 'NULL', 'UNDEFINED']);
    function forecast(input) {
        const {player = {}, weeks = [], healthyPerWeek, capturedAt, evidence, season} = input;
        const status = String(player.injury_status || '').trim().toUpperCase();
        const rosterStatus = String(player.status || '').trim().toUpperCase();
        const team = String(player.team || '').trim().toUpperCase();
        const hasTeam = !NO_TEAM.has(team);
        const uncertain = !hasTeam || !!status || ['INACTIVE', 'IR', 'PUP', 'NFI', 'SUSPENDED', 'RETIRED'].includes(rosterStatus);
        const validEvidence = !!(evidence && typeof evidence.source === 'string' && evidence.source.trim()
            && Number.isInteger(season) && evidence.season === season
            && Number.isFinite(Date.parse(evidence.asOf)) && Date.parse(evidence.asOf) <= Date.parse(capturedAt));
        const weekly = weeks.map(week => {
            if (Number(player.bye_week) === week) return {week, probability: 0, reason: 'bye'};
            const supplied = validEvidence ? evidence.probabilityByWeek?.[week] : undefined;
            if (typeof supplied === 'number' && Number.isFinite(supplied) && supplied >= 0 && supplied <= 1) {
                return {week, probability: supplied, reason: 'explicit_evidence', source: evidence.source, asOf: evidence.asOf};
            }
            // Today's OUT/IR designation is not a known absence in every future
            // week. Missing team is not proof a dynasty player never signs again.
            if (uncertain) return {week, probability: null, reason: !hasTeam ? 'unsigned_or_missing_team' : 'return_or_role_unresolved'};
            return {week, probability: 1, reason: 'healthy_status_quo_assumption'};
        });
        const baselineKnown = typeof healthyPerWeek === 'number' && Number.isFinite(healthyPerWeek) && healthyPerWeek >= 0;
        const unresolvedWeeks = weekly.filter(w => w.probability == null).map(w => w.week);
        const minWeeks = weekly.reduce((sum,w) => sum + (w.probability ?? 0), 0);
        const maxWeeks = minWeeks + unresolvedWeeks.length;
        const centralWeeks = unresolvedWeeks.length ? null : minWeeks;
        return {
            modelVersion: VERSION, baselineKnown, healthyPerWeek: baselineKnown ? healthyPerWeek : null,
            expectedActiveWeeks: centralWeeks,
            expectedPoints: baselineKnown && centralWeeks != null ? healthyPerWeek * centralWeeks : null,
            scenarioLowPoints: baselineKnown ? healthyPerWeek * minWeeks : null,
            scenarioHighPoints: baselineKnown ? healthyPerWeek * maxWeeks : null,
            scenarioKind: 'availability_only_not_confidence_interval',
            calibrated: false, unresolvedWeeks, weekly,
            assumptions: ['No forecast of new injuries, future signings or role changes.', 'Healthy status quo assumes all non-bye weeks available.', 'Unresolved future availability has no central estimate.'],
            evidenceRejected: !!evidence && !validEvidence,
        };
    }
    const api = {VERSION, forecast};
    root.App = root.App || {}; root.App.AvailabilityForecast = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
