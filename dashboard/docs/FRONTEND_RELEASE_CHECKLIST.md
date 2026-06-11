# Frontend Release Checklist (2K Logistics Dashboard)

Last updated: 2026-05-17

## Current stable behavior (reference)

- Frontend loads `trips` at startup (eager-load) for stability.
- Compare page uses already-loaded data to avoid hanging when opening page 2.
- Compare/export labels use `สำรองน้ำมัน`.
- Netlify publish directory is `dashboard` (from `netlify.toml`).

## Target environments

- GitHub repository: `https://github.com/2klogistics/Logistics-Profitability-Dashboard.git`
- Netlify production: `https://2klogistics-dashboard.netlify.app/`

## What to do after frontend changes are finished

### 1) Pre-push validation (required)

- [ ] Check JS syntax:
  - `node --check dashboard/scripts/app.js`
- [ ] Confirm only intended frontend files are changed:
  - `git status --short`
- [ ] Confirm critical UI text is still correct:
  - `สำรองน้ำมัน` appears in compare/export headers.
- [ ] Quick local/manual smoke check:
  - Page 1 opens and shows summary data.
  - Page 2 opens and renders compare table.
  - Date/range/filter interactions still update correctly.
  - Export `.xlsx` works in both `มุมมองปกติ` and `เปรียบเทียบ`.

### 2) Commit + push

- [ ] Stage only necessary files.
- [ ] Commit with clear message (example):
  - `fix(frontend): <short description>`
- [ ] Push to `main`:
  - `git push origin main`

### 3) Netlify deployment verification

- [ ] Open Netlify deploy history and confirm latest deploy is **Published** from `main`.
- [ ] Open production URL:
  - `![1781074262722](image/FRONTEND_RELEASE_CHECKLIST/1781074262722.png)`
- [ ] Hard refresh browser cache:
  - `Ctrl+F5`
- [ ] Verify production reflects latest commit (UI/behavior changed as expected).

### 4) Production smoke test (required)

- [ ] Page 1: data complete, no stuck loading.
- [ ] Page 2: compare page opens successfully.
- [ ] `มุมมองปกติ`: table + totals + export are correct.
- [ ] `เปรียบเทียบ`: table + anomaly/unmatched sections + export sheets are correct.
- [ ] Export header correctness:
  - period/date labels match selected filters.
  - `สำรองน้ำมัน` label is correct.
- [ ] No console/runtime errors that break rendering.

## Rollback plan (if production issue is found)

1. Revert to previous stable commit on GitHub (or redeploy previous successful deploy on Netlify).
2. Re-run production smoke test.
3. Create a fix branch/commit and redeploy.

## Release log template

Use this block for every frontend release:

```md
Date:
Commit:
Changed files:
Netlify deploy status:
Smoke test result:
Known issues:
Owner/Reviewer:
```
