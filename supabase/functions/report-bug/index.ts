// ============================================================
// Report Bug Edge Function  [v1]
// Supabase Edge Function: /functions/v1/report-bug
//
// Two feeds land here and are stored in public.bug_reports:
//   • kind:'user'  — a person clicked "Report a bug"
//   • kind:'crash' — an uncaught error / promise rejection
//
// Session is OPTIONAL: crashes can fire before/without login, so we
// accept anonymous reports (IP rate-limited) but attach the app or
// Sleeper identity when present.
//
// The Discord mirror was removed 2026-09-06 (owner ruling: no Discord
// anywhere in the product). The table is now the ONLY copy of a report,
// so a failed insert is a failed report and is reported as such — it is
// no longer swallowed as best-effort the way it was when a webhook was
// carrying a second copy.
//
// Secrets (supabase secrets set ...):
//   SUPABASE_URL              — provided by the platform
//   SUPABASE_SERVICE_ROLE_KEY — provided by the platform
//
// DEPLOY:
//   supabase functions deploy report-bug
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    corsHeaders,
    handleOptions,
    clientIp,
    userAgent,
    requireActiveAppSession,
    requireSleeperSession,
    checkRateLimit,
} from '../_shared/security.ts';

const ALLOWED_KINDS = new Set(['user', 'crash']);
const ALLOWED_SEVERITY = new Set(['low', 'normal', 'high', 'blocker']);

function s(v: unknown, max: number): string {
    if (v === null || v === undefined) return '';
    return String(v).slice(0, max);
}

interface Reporter {
    identifier: string;
    userId: string | null;
    username: string | null;
    label: string; // human-friendly for the embed
}

async function resolveReporter(admin: any, req: Request): Promise<Reporter> {
    try {
        const appSession = await requireActiveAppSession(admin, req);
        if (appSession) {
            return {
                identifier: `app:${appSession.userId}`,
                userId: appSession.userId,
                username: null,
                label: appSession.email || `app user ${appSession.userId.slice(0, 8)}`,
            };
        }
    } catch { /* fall through */ }
    try {
        const sleeper = await requireSleeperSession(req);
        if (sleeper) {
            return {
                identifier: `sleeper:${sleeper.username.toLowerCase()}`,
                userId: null,
                username: sleeper.username,
                label: `@${sleeper.username} (Sleeper)`,
            };
        }
    } catch { /* fall through */ }
    return { identifier: `ip:${clientIp(req)}`, userId: null, username: null, label: 'Anonymous' };
}

Deno.serve(async (req) => {
    const options = handleOptions(req);
    if (options) return options;

    const responseHeaders = { ...corsHeaders(req), 'Content-Type': 'application/json' };

    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: responseHeaders });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !serviceRoleKey) {
            return new Response(JSON.stringify({ error: 'Reporting unavailable.' }), { status: 503, headers: responseHeaders });
        }
        const supabase = createClient(supabaseUrl, serviceRoleKey);

        const reporter = await resolveReporter(supabase, req);

        // Rate limit by identity (or IP for anon). Crashes dedupe client-side,
        // so this mainly guards against a runaway loop or an abusive origin.
        const rl = await checkRateLimit(supabase, 'report_bug', reporter.identifier, {
            limit: 20,
            windowSeconds: 60,
            lockoutSeconds: 300,
        });
        if (!rl.allowed) {
            return new Response(JSON.stringify({ error: 'Too many reports, slow down.' }), {
                status: 429,
                headers: { ...responseHeaders, 'Retry-After': String(rl.retryAfterSeconds || 60) },
            });
        }

        const body = await req.json().catch(() => null);
        const kind = s(body?.kind, 12) || 'user';
        if (!ALLOWED_KINDS.has(kind)) {
            return new Response(JSON.stringify({ error: 'Invalid kind.' }), { status: 400, headers: responseHeaders });
        }

        const message = s(body?.message, 4000).trim();
        if (!message) {
            return new Response(JSON.stringify({ error: 'A message is required.' }), { status: 400, headers: responseHeaders });
        }

        const ctx = (body?.context && typeof body.context === 'object') ? body.context : {};
        const title = s(body?.title, 200).trim() || (kind === 'crash' ? 'Uncaught error' : 'Bug report');
        const severityRaw = s(body?.severity, 12).toLowerCase();
        const severity = ALLOWED_SEVERITY.has(severityRaw) ? severityRaw : (kind === 'crash' ? 'high' : 'normal');
        const url = s(ctx.url, 500);
        const leagueId = s(ctx.leagueId, 100);
        const tier = s(ctx.tier, 40);
        const platform = s(ctx.platform, 60);
        const appVersion = s(ctx.appVersion, 60);
        const stack = s(body?.stack, 3000);
        const screenshotUrl = s(body?.screenshotUrl, 800);
        const ua = userAgent(req);

        // The table is the only copy — see the header note. A failure here
        // loses the report outright, so it surfaces as a 5xx instead of a
        // { reported: true } the client would show as a successful send.
        let storedId: string | null = null;
        try {
            const { data, error: insertError } = await supabase.from('bug_reports').insert({
                kind,
                identifier: reporter.identifier,
                user_id: reporter.userId,
                username: reporter.username,
                reporter_label: reporter.label,
                title,
                message,
                severity,
                url,
                league_id: leagueId || null,
                tier: tier || null,
                platform: platform || null,
                app_version: appVersion || null,
                user_agent: ua,
                stack: stack || null,
                screenshot_url: screenshotUrl || null,
                ip_address: clientIp(req),
            }).select('id').maybeSingle();
            if (insertError) throw insertError;
            storedId = data?.id || null;
        } catch (e: any) {
            console.error('[report-bug] store failed:', e);
            return new Response(JSON.stringify({ error: 'Could not save your report. Please try again.' }), {
                status: 502,
                headers: responseHeaders,
            });
        }

        return new Response(JSON.stringify({ reported: true, id: storedId }), { headers: responseHeaders });
    } catch (error: any) {
        console.error('[report-bug] error:', error);
        return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), { status: 500, headers: responseHeaders });
    }
});
