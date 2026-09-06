# Dynasty HQ — Bug Reporting + Feature Voting

> **2026-09-06 — Discord removed.** This used to mirror bug reports to a private
> Discord staff channel and announce new ideas to a public one. Owner ruling: no
> Discord anywhere in the product. Both webhooks are gone from the edge
> functions; Supabase is now the only destination. See
> [Retiring the Discord wiring](#retiring-the-discord-wiring) for the ops
> follow-up.

Three things in War Room:

1. **In-app "Report a bug"** — users file bugs; each one is stored in `bug_reports`.
2. **Automatic crash capture** — uncaught JS errors + unhandled promise rejections land in the same table (deduped, capped per page-load).
3. **Feature voting board** — users submit ideas and upvote. Submitting/voting is **logged-in only**.

All three are surfaced by a single floating **Feedback** launcher (bottom-right) and are also callable from anywhere via `window.WR.Feedback.reportBug()` and `window.WR.Feedback.openBoard()`.

---

## Files

**Edge functions**
- `supabase/functions/report-bug/index.ts`
- `supabase/functions/feature-requests/index.ts`

**Migrations**
- `supabase/migrations/20260711000000_bug_reports.sql`
- `supabase/migrations/20260711010000_feature_requests.sql`

**Client**
- `js/shared/feedback-hub.js`

`supabase/config.toml` pins `verify_jwt = false` for both functions. The client calls them through the existing `window.OD.getClient()`, so no CSP change is needed (`connect-src` already allows the Supabase origin).

---

## Setup

Run from the `warroom/` repo root, linked to project `sxshiqyxhhifvtfqawbq`.

### 1. Apply the migrations
```bash
supabase db push
```
This creates `bug_reports`, `feature_requests`, `feature_votes`, and the `toggle_feature_vote` / `list_feature_requests` RPCs (all RLS-locked, service-role only — same model as `ai_feedback`).

### 2. Deploy the functions
```bash
supabase functions deploy report-bug
supabase functions deploy feature-requests
```
`config.toml` already pins `verify_jwt = false` for both, so a plain deploy won't turn on gateway JWT verification and break custom-JWT auth. No function secrets are needed beyond the platform-provided `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

### 3. Frontend
The script include is already in `index.html`. Deploy the site as normal; the Feedback button appears on the authenticated app immediately.

For other standalone pages (`free-agency.html`, `draft-warroom.html`, …), add:
```html
<script src="js/shared/feedback-hub.js?v=20260711fb2"></script>
```
Crash capture only reports when `window.OD.getClient()` exists on that page (it needs the client to send).

---

## Test it

1. **User bug report:** open the app → **Feedback → Report a bug** → send. A row appears in `bug_reports`.
2. **Crash capture:** in the console run `setTimeout(() => { throw new Error("DHQ test crash"); })`. A `kind = 'crash'` row appears.
3. **Feature board — submit:** **Feedback → Feature requests → Submit idea.** The idea appears on the board with 1 vote (yours).
4. **Vote:** click the ▲ on any idea; the count updates and toggles.
5. **Logged-out guard:** while signed out, voting/submitting should show "Sign in to vote / submit."

Since there is no chat mirror any more, **reading the table is the only way to see reports.** Check it on a schedule, or build the admin surface below.

---

## Managing it day-to-day

**Bug statuses** live on `bug_reports.status` (`open → triaged → in_progress → resolved / wont_fix / duplicate`). Update via SQL or the Supabase table editor:
```sql
select created_at, kind, severity, reporter_label, title, url
from public.bug_reports
where status = 'open'
order by created_at desc;
```
```sql
update public.bug_reports set status = 'resolved', admin_note = 'fixed in v20260712' where id = '...';
```

**Feature statuses** live on `feature_requests.status` (`open → planned → in_progress → shipped / declined`). Moving one is what turns the board into a public roadmap:
```sql
update public.feature_requests set status = 'planned' where id = '...';
```
The board's status filter chips (Open / Planned / In Progress / Shipped) read this. `pinned = true` keeps something at the top.

---

## Retiring the Discord wiring

The code no longer reads either webhook, so nothing breaks if the secrets stay
set — but they are live credentials to a channel, so clear them:

```bash
supabase secrets unset DISCORD_BUG_WEBHOOK_URL
supabase secrets unset DISCORD_IDEAS_WEBHOOK_URL
```

Then **redeploy both functions** (above) — until you do, the deployed copies are
still the old ones that post to Discord. Deleting the webhooks in Discord itself
is the belt-and-braces version, and is the only step that revokes them for good.

`supabase/migrations/20260711000000_bug_reports.sql` still mentions the Discord
mirror in two comments. That migration is already applied; editing applied
migration files invites checksum drift, so it is deliberately left alone. The
comments are historical, not behaviour.

---

## Optional upgrades (not built)

- **Admin surface in `admin.html`** — a table view of `bug_reports` and a dropdown to change statuses, instead of raw SQL. This matters more now that no chat channel surfaces new reports.
- **Digest email** — a scheduled function that mails open bugs daily, replacing what the staff channel used to do passively.
- **Screenshots on bug reports** — capture with `html2canvas`, upload to a Supabase Storage bucket, pass the public URL as `screenshotUrl`; the column already exists. (Add `html2canvas` to CSP `script-src` first.)
- **Sentry** — CSP already allows it. If you add `Sentry.init`, dial the built-in crash capture down (e.g. lower `CRASH_CAP`) to avoid double-reporting.

---

## Security notes

- Both functions authenticate internally (custom JWT via `_shared/security.ts`), rate-limit per identity/IP, and reach the DB only with the service role. Tables have no `anon`/`authenticated` grants.
- `report-bug` is intentionally **session-optional** (so pre-login crashes are still captured) but IP rate-limited; `feature-requests` writes (submit/vote) **require a session**.
- Only `pathname + hash` is sent as the page reference — never the query string — so tokens/PII in URLs are never forwarded.
- **`report-bug` now fails loudly.** When Discord held a second copy, a failed insert was logged and swallowed. The table is the only copy now, so an insert failure returns `502` rather than telling the user their report was sent.
