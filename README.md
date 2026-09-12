# 2K Logistics Dashboard V2

## Production Identity

Use these names as the source of truth:

```text
Local workspace folder: Data sum Daily express 4 month V3
GitHub repository: awiruttangwong/2klogistics-dashboard-v2.0
Production URL: https://2klogistics-dashboard.pages.dev (Cloudflare Pages)
Cloudflare account: 6c6387119b50a72218ec37c3618d1972
Cloudflare Pages project: 2klogistics-dashboard
Cloudflare publish directory: dashboard
Legacy Netlify site (fallback only, not decommissioned yet): 2klogistics-dashboard
Legacy Netlify URL: https://2klogistics-dashboard.netlify.app
Apps Script source directory: dashboard/API
Apps Script project: DASHBOARD-DAILY-QA
Google Sheet: Database Daily EXPRESS
Active Supabase read model: oecahsecztxykwiwonrb
```

The two earlier Supabase projects (`cghcyuuyzahpzzbyxrgo`, then `juzkxljnyonckjkmttzq`)
were both retired: the first was deleted outright by a Supabase-side incident
(2026-09-07), and the second — used as an emergency replacement — hit
Supabase's "Unresponsive Projects" platform incident (Nano/free-tier compute,
2026-09-10) and never recovered even after pause/restore/restart. The current
project `oecahsecztxykwiwonrb` was created fresh on 2026-09-12, schema
re-applied from `supabase/migrations/`, and repopulated via a full
`npm run supabase:sync -- --promote` from the Apps Script source (parity
passed, zero rows failed). The source of truth is always the Google Sheet —
Supabase is a rebuildable read cache, not the primary data store.

The local folder name is only a Windows workspace label. Production deploys
from the GitHub Actions workflow `.github/workflows/cloudflare-pages-deploy.yml`
in `awiruttangwong/2klogistics-dashboard-v2.0`, publishing the `dashboard`
directory to the Cloudflare Pages project `2klogistics-dashboard` (test suite
first, then preview deploy + health check, then production deploy + health
check, with automatic rollback on failure).

Netlify was the original host but started hitting `usage_exceeded` outages;
see `dashboard/docs/CLOUDFLARE_MIGRATION_PLAN.md` for the full migration
record. Netlify's config/functions and the GitHub Actions secrets
`NETLIFY_AUTH_TOKEN`/`NETLIFY_SITE_ID` are intentionally left in place as a
fallback until Cloudflare has a burn-in period — do not remove them without
checking that doc's Phase 9 checklist first.

Use lowercase `dashboard/` as the active source directory. The uppercase
`Dashboard/` tree is retained only for historical docs/notes and must not be
used as the Netlify publish directory.

## Supabase V3 Local Setup

Copy `.env.example` to `.env` and fill these values locally only:

```text
SUPABASE_PROJECT_REF=<project-ref>
SUPABASE_ACCESS_TOKEN=<personal-access-token>
SUPABASE_DB_PASSWORD=<database-password>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side-service-role-key>
APPS_SCRIPT_API_URL=<existing Apps Script Web App URL>
```

Do not commit `.env`. The root `.gitignore` already excludes it.

Remote CLI workflow on this Windows workspace:

```powershell
npm.cmd run supabase:link
npm.cmd run supabase:db:push:dry-run
npm.cmd run supabase:db:push
```

Shadow sync workflow on this Windows workspace:

```powershell
npm.cmd run supabase:sync -- --dry-run
npm.cmd run supabase:sync
npm.cmd run supabase:sync -- --promote
```

`SUPABASE_SERVICE_ROLE_KEY` is server-side only. Never put it in `dashboard/scripts/*` or any frontend bundle.

## Frontend Supabase API

The dashboard now supports:

```js
apiMode: 'apps-script' | 'supabase-with-fallback' | 'supabase'
```

The default is `supabase-with-fallback`: the browser calls `/api/supabase-api` (a Cloudflare Pages Function, `dashboard/functions/api/supabase-api.js`) first and falls back to the existing Apps Script URL if Supabase is unavailable.

Production currently uses the Supabase backend `oecahsecztxykwiwonrb`. Two
earlier projects are retired and must not be pointed to again: `juzkxljnyonckjkmttzq`
(2 GB disk filled during the first full-snapshot migration design, then hit an
unresolved Supabase "Unresponsive Projects" incident in Sept 2026) and
`cghcyuuyzahpzzbyxrgo` (deleted by a Supabase-side incident in Sept 2026).

`eagerTripsOnStartup: false` keeps the first dashboard screen fast by rendering from `summary_snapshots` first. Full trip rows are loaded lazily when the compare/export workflows need them.

Set these Cloudflare Pages secrets (Production **and** Preview environments;
`wrangler pages secret put` only targets Production, so Preview needs a
direct Cloudflare API call — see `dashboard/docs/CLOUDFLARE_MIGRATION_PLAN.md`):

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APPS_SCRIPT_API_URL
```

The primary daily sync trigger is event-driven: Apps Script's `dailyBatchJob`
calls `requestSupabaseSyncAfterBatch_()` right after it finishes, which
dispatches the "Supabase Shadow Sync" GitHub Actions workflow
(`.github/workflows/supabase-sync.yml`) using a GitHub PAT stored in Apps
Script Script Properties under `GITHUB_SYNC_DISPATCH_TOKEN`. GitHub Actions
also runs its own schedule as a backup —
`.github/workflows/production-sync-watchdog.yml` at 08:20/08:30/08:40/08:50,
08:47, and 10:17 Asia/Bangkok — since GitHub scheduled events don't provide a
strict start-time guarantee and the webhook path can fail independently.

Add these GitHub Actions secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APPS_SCRIPT_API_URL
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
CLOUDFLARE_PAGES_PROJECT
```
