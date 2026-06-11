# Netlify Manual Production Deploy

Last updated: 2026-06-10

## Purpose

Use this guide when:

- frontend changes are already committed and pushed to `main`
- GitHub auto deploy on Netlify does not publish the latest version
- Netlify production build is blocked by credit usage or similar account limits

This workflow was verified with the 2K Logistics Dashboard project.

## Project references

- GitHub repo: `https://github.com/2klogistics/Logistics-Profitability-Dashboard.git`
- Netlify site: `https://2klogistics-dashboard.netlify.app/`
- Netlify project id: `b88ddbac-45b5-4438-b93f-a086c21d9007`
- Publish directory: `dashboard`

## Important behavior

- `git push origin main` may succeed even when Netlify does not update production.
- When Netlify shows errors like `Skipped due to account credit usage exceeded`, auto deploy from GitHub can fail.
- In that case, production can still be updated by uploading the local `dashboard` folder as a manual draft deploy, then restoring that deploy to production.

## Required checks before deploy

Run these first:

```powershell
cmd /c node --check Dashboard\scripts\app.js
git status --short
git push origin main
```

Expected:

- JS syntax passes
- only intended files were changed
- latest code is already on `origin/main`

## Step 1: Confirm Netlify project link

```powershell
npx --yes netlify-cli status
```

Confirm:

- current project is `2klogistics-dashboard`
- project URL is `https://2klogistics-dashboard.netlify.app`

## Step 2: Upload a manual draft deploy

```powershell
npx --yes netlify-cli deploy --dir=dashboard --no-build --json
```

This should return data similar to:

- `deploy_id`
- `deploy_url`
- `logs`

If you want a predictable draft URL for checking:

```powershell
npx --yes netlify-cli deploy --dir=dashboard --no-build --alias prod-manual-test
```

Important:

- this step uploads local static files directly
- this usually works even when GitHub-triggered production builds are blocked

## Step 3: Do not use `--prod` if Netlify blocks production deploy creation

This command may fail:

```powershell
npx --yes netlify-cli deploy --dir=dashboard --no-build --prod
```

Typical error:

```text
Account credit usage exceeded - new deploys are blocked until credits are added
```

If that happens, continue to Step 4.

## Step 4: Restore the successful draft deploy to production

Replace `DEPLOY_ID` with the draft deploy id from Step 2.

```powershell
npx --yes netlify-cli --% api restoreSiteDeploy --data "{ \"site_id\": \"b88ddbac-45b5-4438-b93f-a086c21d9007\", \"deploy_id\": \"DEPLOY_ID\" }"
```

Notes:

- use the PowerShell `--%` stop-parsing operator exactly as shown
- this promotes the uploaded deploy content without creating a new GitHub build

## Step 5: Verify production is updated

Check production file markers from the latest code:

```powershell
$c=(Invoke-WebRequest -Uri "https://2klogistics-dashboard.netlify.app/scripts/app.js?verify=prod" -UseBasicParsing -Headers @{ "Cache-Control"="no-cache" }).Content
[PSCustomObject]@{
  HasNoRefHelper    = $c.Contains("dcQaBuildCompareNoRefCards")
  HasRecvOilChanged = $c.Contains("recvOilChanged")
  Length            = $c.Length
}
```

If the release in question includes different identifiers, replace the marker strings with the relevant new code markers.

You can also compare the draft deploy URL and production URL the same way.

## Recommended fallback checks

To inspect recent deploy history:

```powershell
npx --yes netlify-cli --% api listSiteDeploys --data "{ \"site_id\": \"b88ddbac-45b5-4438-b93f-a086c21d9007\" }"
```

Useful things to check:

- latest deploy `state`
- `context`
- `published_at`
- `error_message`

## Known failure patterns

### 1) GitHub push succeeded, production still old

Likely cause:

- auto deploy from `main` was skipped on Netlify

Action:

- use the manual draft deploy + `restoreSiteDeploy` flow

### 2) `netlify deploy --prod` returns `403`

Likely cause:

- Netlify blocks creation of a new production deploy because account credit usage is exceeded

Action:

- do not retry `--prod` repeatedly
- upload draft deploy
- restore the successful draft deploy to production

### 3) Netlify CLI deploy works for draft but not production

This is expected in the blocked-credit scenario above.

## Release log template for manual production deploy

```md
Date:
Git commit:
Manual draft deploy id:
Draft deploy URL:
Restore to production: yes/no
Production verification:
Notes:
```
