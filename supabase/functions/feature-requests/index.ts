// ============================================================
// Feature Requests Edge Function  [v1]
// Supabase Edge Function: /functions/v1/feature-requests
//
// Voting board backend. Actions (POST body { action, ... }):
//   • list   — { status? }         → board rows + this caller's vote state (session optional)
//   • submit — { title, description?, category? } → create idea (LOGGED-IN ONLY)
//   • vote   — { id }              → cast an upvote (LOGGED-IN ONLY)
//   • unvote — { id }              → remove your upvote (LOGGED-IN ONLY)
//
// The Discord announcement of new submissions was removed 2026-09-06
// (owner ruling: no Discord anywhere in the product). The in-app board is
// the only place ideas surface; it already lists every idea on submit, so
// nothing was lost besides the mirror.
//
// Secrets (supabase secrets set ...):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — platform-provided
//
// DEPLOY:
//   supabase functions deploy feature-requests
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    corsHeaders,
    handleOptions,
    requireActiveAppSession,
    requireSleeperSession,
    checkRateLimit,
} from '../_shared/security.ts';


interface Session {
    identifier: string;
    userId: string | null;
    username: string | null;
    label: string;
}

function s(v: unknown, max: number): string {
    if (v === null || v === undefined) return '';
    return String(v).slice(0, max);
}

async function resolveSession(admin: any, req: Request): Promise<Session | null> {
    try {
        const app = await requireActiveAppSession(admin, req);
        if (app) {
            return {
                identifier: `app:${app.userId}`,
                userId: app.userId,
                username: null,
                label: app.email || `app user ${app.userId.slice(0, 8)}`,
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
                label: `@${sleeper.username}`,
            };
        }
    } catch { /* fall through */ }
    return null;
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
            return new Response(JSON.stringify({ error: 'Board unavailable.' }), { status: 503, headers: responseHeaders });
        }
        const supabase = createClient(supabaseUrl, serviceRoleKey);

        const body = await req.json().catch(() => null);
        const action = s(body?.action, 20) || 'list';
        const session = await resolveSession(supabase, req);

        // ── LIST (public read; vote state only if signed in) ──────────────
        if (action === 'list') {
            const status = s(body?.status, 20) || null;
            const { data, error } = await supabase.rpc('list_feature_requests', {
                p_identifier: session?.identifier || null,
                p_status: status,
                p_limit: 200,
            });
            if (error) {
                console.error('[feature-requests] list failed:', error);
                return new Response(JSON.stringify({ error: 'Could not load board.' }), { status: 500, headers: responseHeaders });
            }
            return new Response(JSON.stringify({ items: data || [], signedIn: !!session }), { headers: responseHeaders });
        }

        // Everything below mutates and requires a session.
        if (!session) {
            return new Response(JSON.stringify({ error: 'Sign in to submit or vote.' }), { status: 401, headers: responseHeaders });
        }

        // ── SUBMIT ────────────────────────────────────────────────────────
        if (action === 'submit') {
            const rl = await checkRateLimit(supabase, 'feature_submit', session.identifier, {
                limit: 5,
                windowSeconds: 3600,
                lockoutSeconds: 3600,
            });
            if (!rl.allowed) {
                return new Response(JSON.stringify({ error: 'You have submitted a lot recently — try again later.' }), {
                    status: 429, headers: { ...responseHeaders, 'Retry-After': String(rl.retryAfterSeconds || 3600) },
                });
            }

            const title = s(body?.title, 140).trim();
            const description = s(body?.description, 2000).trim();
            const category = s(body?.category, 40).trim() || null;
            if (title.length < 4) {
                return new Response(JSON.stringify({ error: 'Give your idea a clear title (4+ characters).' }), { status: 400, headers: responseHeaders });
            }

            const { data: created, error } = await supabase.from('feature_requests').insert({
                title,
                description: description || null,
                category,
                author_identifier: session.identifier,
                author_user_id: session.userId,
                author_username: session.username,
                vote_count: 1, // author implicitly backs their own idea
            }).select('id').maybeSingle();

            if (error || !created) {
                console.error('[feature-requests] submit failed:', error);
                return new Response(JSON.stringify({ error: 'Could not submit idea.' }), { status: 500, headers: responseHeaders });
            }

            // Author auto-votes so vote_count is truthful.
            await supabase.rpc('toggle_feature_vote', {
                p_feature_id: created.id,
                p_identifier: session.identifier,
                p_user_id: session.userId,
                p_username: session.username,
                p_vote: true,
            });

            return new Response(JSON.stringify({ ok: true, id: created.id }), { headers: responseHeaders });
        }

        // ── VOTE / UNVOTE ──────────────────────────────────────────────────
        if (action === 'vote' || action === 'unvote') {
            const id = s(body?.id, 40);
            if (!id) {
                return new Response(JSON.stringify({ error: 'Missing idea id.' }), { status: 400, headers: responseHeaders });
            }
            const rl = await checkRateLimit(supabase, 'feature_vote', session.identifier, {
                limit: 60,
                windowSeconds: 60,
            });
            if (!rl.allowed) {
                return new Response(JSON.stringify({ error: 'Slow down.' }), { status: 429, headers: responseHeaders });
            }
            const { data, error } = await supabase.rpc('toggle_feature_vote', {
                p_feature_id: id,
                p_identifier: session.identifier,
                p_user_id: session.userId,
                p_username: session.username,
                p_vote: action === 'vote',
            });
            if (error || !data?.ok) {
                console.error('[feature-requests] vote failed:', error || data);
                return new Response(JSON.stringify({ error: 'Could not record vote.' }), { status: 500, headers: responseHeaders });
            }
            return new Response(JSON.stringify({ ok: true, voteCount: data.voteCount, myVote: data.myVote }), { headers: responseHeaders });
        }

        return new Response(JSON.stringify({ error: 'Unknown action.' }), { status: 400, headers: responseHeaders });
    } catch (error: any) {
        console.error('[feature-requests] error:', error);
        return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), { status: 500, headers: responseHeaders });
    }
});
