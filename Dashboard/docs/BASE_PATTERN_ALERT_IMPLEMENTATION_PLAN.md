# Base Pattern Alert Implementation Plan

Last updated: 2026-06-12

## Goal

Redesign `ราคารับผิดปกติ` and `ราคาจ่ายผิดปกติ` so the dashboard separates:

- real anomalies that require action
- route/day base-rate patterns that are informative but not operational problems

This plan keeps base-rate pattern data visible in the UI, but excludes it from anomaly totals, anomaly summary cards, anomaly filters, and primary anomaly export sheets.

## Business Rule

### Current problem

Today the dashboard flags many rows as `payHigh` or `recvLow` as soon as the row differs from its reference row.

That causes route/day-wide pricing patterns such as:

- `170, 200, 170, 200`
- `2198 vs 2250` repeated across the same route/day cluster

to appear as anomalies even when management considers them the route's daily base rate.

### New classification

For `pay` and `recv`, classify each row into one of two groups:

1. `real anomaly`
   - the row deviates from the dominant route/day pricing pattern
   - this row must count toward anomaly totals

2. `base pattern`
   - the row belongs to the dominant route/day pricing pattern
   - this row must remain visible in the UI
   - this row must not count toward anomaly totals
   - this row must not appear in primary anomaly export sheets

### Recommended first-pass rule

For each route/day cluster, identify the dominant pricing pattern from repeated values.

Recommended first-pass cluster key:

- `recv`
- `pay`
- `margin`

Recommended first-pass dominance rule:

- repeated at least `2` trips
- and is the largest cluster for that route/day

Rows inside that dominant cluster are `base pattern` rows.

Rows outside that dominant cluster remain eligible for:

- `payHigh`
- `recvLow`
- `recvOilChanged`
- `loss`
- `oil50`

## New Status Model

Do not overload the current anomaly statuses.

Use two layers instead:

### Layer 1: real anomaly statuses

Keep existing anomaly-facing statuses:

- `loss`
- `oil50`
- `payHigh`
- `recvLow`
- `recvOilChanged`
- `normal`
- `noRef`

### Layer 2: informational base-pattern statuses

Add separate info-only statuses:

- `payBasePattern`
- `recvBasePattern`

These statuses are not part of the anomaly filter bar in v1.

They are for:

- disclosure text in cards
- modal detail sections
- optional future reporting

## UI Behavior

### Primary rule

The main anomaly experience must stay executive-focused:

- anomaly counts show only real anomalies
- anomaly badges in summary show only real anomalies
- `ราคารับผิดปกติ` and `ราคาจ่ายผิดปกติ` filters show only real anomalies

### Base-pattern disclosure

Keep base-pattern rows visible through a separate disclosure line such as:

`มีรูปแบบราคากลางของวันอีก 4 เที่ยว (คลิกเพื่อดูรายละเอียด)`

This disclosure must not reuse the same meaning as:

`มีคู่เปรียบเทียบเพิ่มเติมอีก ... คู่ (คลิกเพื่อดูรายละเอียด)`

### Non-collision rule

Treat the two disclosures as different concerns:

1. `base-pattern disclosure`
   - means hidden informational rows, not anomalies
   - count is total hidden base-pattern rows for that card

2. `overflow disclosure`
   - means there are more rendered anomaly rows than the preview limit
   - count is remaining anomaly rows beyond preview

Recommended rendering order inside a card:

1. main anomaly preview table
2. base-pattern disclosure
3. overflow disclosure

Do not merge these into one sentence or one clickable block.

## Scope: Where This Logic Must Apply

### 1. Normal view

Must update.

Reason:

- normal mode already uses cross-day reference logic through `dcQaTripStatuses(...)`
- summary counts and customer counts are derived from that same status output

Key code path:

- `renderSingleTable(...)` in `Dashboard/scripts/app.js`
- `dcQaTripStatuses(...)`
- `dcQaSingleCustomerSummaryCard(...)`
- `dcQaSingleReportHead(...)`

### 2. Compare view

Must update.

Reason:

- compare cards use `dcQaCompareStatuses(...)`
- compare summary counts come from `card.anomRows`
- compare card preview already has the existing `มีคู่เปรียบเทียบเพิ่มเติม...` disclosure that must remain separate

Key code path:

- `dcQaBuildAnomalyCards(...)`
- `dcQaCompareStatuses(...)`
- `renderAnomalyTable(...)`
- `dcOpenAnomalyModal(...)`

### 3. 7D vs Previous

Must update.

Reason:

- 7D single-mode flows through the same `renderSingleTable(...)` + `dcQaTripStatuses(...)`
- 7D export reuses the same single-mode/export templates

Key code path:

- same single-mode logic as normal view
- single-mode export builder in the XLSX flow

### 4. Compare no-ref / unmatched cards

Must update.

Reason:

- compare mode merges no-ref cards into the same compare export and compare UI flow
- unmatched/no-ref rows still call `dcQaTripStatuses(...)`

Key code path:

- `dcQaBuildUnmatchedCards(...)`
- `dcQaBuildCompareNoRefCards(...)`
- compare export card builder

### 5. XLSX export

Must update.

Reason:

- the workbook summary counts use the same anomaly helpers
- per-sheet route summaries derive card counts from current status logic

Primary export rule for v1:

- primary anomaly sheets export only real anomalies
- base-pattern rows stay out of those anomaly sheets

Optional future enhancement:

- add a separate informational sheet for base-pattern rows

Not required in v1.

## Required Data Shape Changes

Current card/row objects are too narrow for this feature.

Recommended additions:

### Per row

- `statuses`: real anomaly statuses only
- `infoStatuses`: info-only statuses such as `payBasePattern`, `recvBasePattern`
- `isBasePattern`: convenience boolean

### Per card

- `anomRows`: real anomaly rows shown in the main anomaly table
- `basePatternRows`: hidden informational rows shown through disclosure/modal
- `anomCount`: count of `anomRows`
- `basePatternCount`: count of `basePatternRows`

This split is the safest way to prevent summary and export leakage.

## Detailed Code Touchpoints

### A. Status generation

These are the core implementation points and must be changed first.

- `dcQaTripStatuses(...)` at `Dashboard/scripts/app.js:7401`
  - currently determines `payHigh`, `recvLow`, `recvOilChanged`, `normal`, `noRef`
  - must add dominant route/day pattern analysis before assigning pay/recv anomaly statuses

- `dcQaCompareStatuses(...)` at `Dashboard/scripts/app.js:7439`
  - currently merges the two row-side status sets
  - must also merge/propagate base-pattern info state

- `dcQaPairNotes(...)` at `Dashboard/scripts/app.js:7452`
  - currently writes anomaly-facing notes only
  - must avoid presenting base-pattern rows as anomalies

### B. Shared status helpers

These central helpers control counts, ranking, badges, and text across the app.

- `dcQaStatusOrder` at `Dashboard/scripts/app.js:7289`
- `dcQaStatusLabels()` at `Dashboard/scripts/app.js:7291`
- `dcQaStatusRank(...)` at `Dashboard/scripts/app.js:7307`
- `dcQaHasAnomalyStatus(...)` at `Dashboard/scripts/app.js:7318`
- `dcQaStatusSummaryText(...)` at `Dashboard/scripts/app.js:7322`
- `dcQaStatusBadges(...)` at `Dashboard/scripts/app.js:7345`

Rule:

- `payBasePattern` and `recvBasePattern` must not be treated as anomalies by `dcQaHasAnomalyStatus(...)`
- they may appear as informational badges in modal/detail contexts if desired
- they should not increase severity rank

### C. Filters

Filter chips are currently hardcoded to anomaly-facing statuses.

- `renderCompareStatusFilter(...)` at `Dashboard/scripts/app.js:5447`
- `statusMatchesFilter(...)` at `Dashboard/scripts/app.js:5163`

Rule for v1:

- do not add base-pattern statuses to the main filter bar
- keep the filter bar focused on operational problems

### D. Normal-view rendering and counts

- `renderSingleTable(...)` at `Dashboard/scripts/app.js:7781`
- `dcQaSingleCustomerSummaryCard(...)` at `Dashboard/scripts/app.js:7505`
- `dcQaSingleReportHead(...)` at `Dashboard/scripts/app.js:7544`
- `updateCompareStatusVisibility(...)` logic around visible anomaly counting

Required changes:

- card main table shows only `anomRows`
- card still surfaces `basePatternRows` through disclosure
- summary and customer `ความผิดปกติ` use `anomCount` only
- route sorting uses real anomaly severity, not base-pattern presence

### E. Compare rendering and counts

- `dcQaBuildAnomalyCards(...)` at `Dashboard/scripts/app.js:7634`
- `renderAnomalyTable(...)` at `Dashboard/scripts/app.js:8012`
- `dcOpenAnomalyModal(...)` at `Dashboard/scripts/app.js:8128`

Required changes:

- keep `anomRows` for real pair anomalies
- add `basePatternRows` for informational pair rows
- preserve the existing overflow disclosure for anomaly rows
- add a second disclosure for base-pattern rows
- modal needs separate sections:
  - real anomalies
  - base-pattern rows

### F. No-ref / unmatched rendering

- `dcQaBuildUnmatchedCards(...)` at `Dashboard/scripts/app.js:7685`
- `dcQaBuildCompareNoRefCards(...)` at `Dashboard/scripts/app.js:7736`

Required changes:

- unmatched/no-ref cards must still exclude base-pattern rows from anomaly totals
- if a no-ref card contains only base-pattern rows and no anomalies, it must remain discoverable through disclosure/modal, not disappear silently

### G. Export

- `buildNormalQaSheet(...)` at `Dashboard/scripts/app.js:6123`
- `buildAnomalyExportCards(...)` at `Dashboard/scripts/app.js:6255`
- `buildUnmatchedSheet(...)` at `Dashboard/scripts/app.js:6269`
- summary export selection logic around `Dashboard/scripts/app.js:6378`
- single-mode summary tally around `Dashboard/scripts/app.js:6438`
- single-mode extra sheet builder around `Dashboard/scripts/app.js:6789`

Required changes:

- export anomaly totals use real anomalies only
- anomaly route headers use real anomaly counts only
- normal/compare/unmatched sheets exclude base-pattern rows from anomaly sheets
- do not let base-pattern statuses accidentally appear in the status filter summary text for primary anomaly sheets

## Recommended Implementation Order

### Phase 1: Core classifier

1. Add route/day dominant-pattern analyzer
2. Add per-row info state for base pattern
3. Keep anomaly status output clean and separate

### Phase 2: Card shaping

1. Split card rows into `anomRows` and `basePatternRows`
2. Recompute `anomCount` from `anomRows` only
3. Preserve route visibility when only base-pattern rows exist

### Phase 3: UI rendering

1. Normal view disclosure
2. Compare view disclosure
3. Modal sections for base-pattern detail
4. No-ref/unmatched behavior

### Phase 4: Summary and filter alignment

1. Update all summary counts
2. Confirm filter chips still reflect real anomalies only
3. Confirm route/customer anomaly numbers stay aligned

### Phase 5: XLSX alignment

1. Update workbook summary totals
2. Update route header counts in per-sheet exports
3. Confirm compare and 7D exports follow the same logic

## Validation Checklist

Before shipping, validate all of the following:

### Normal view

- route with only dominant base pattern shows `ความผิดปกติ = 0`
- route still exposes `มีรูปแบบราคากลางของวันอีก ... เที่ยว`
- main table does not count those rows as anomalies

### Compare view

- real pair anomalies remain in the main preview
- base-pattern pair rows move to separate disclosure
- `มีคู่เปรียบเทียบเพิ่มเติมอีก ... คู่` still refers only to anomaly overflow
- both disclosures can appear on the same card without ambiguity

### 7D vs Previous

- same route/day pattern logic as normal view
- same anomaly counts as UI summary

### No-ref / unmatched

- no-ref rows still show `ไม่มีข้อมูลเปรียบเทียบ` correctly
- base-pattern rows do not inflate anomaly counts there

### XLSX

- `สรุปผลดำเนินงาน` counts only real anomalies
- `ราคาจ่ายผิดปกติ` and `ราคารับผิดปกติ` sheets do not contain base-pattern-only rows
- normal and compare exports match the on-screen anomaly totals

## v1 Design Decision

For the first implementation:

- show base-pattern rows in UI only
- exclude base-pattern rows from primary anomaly export sheets
- do not add a dedicated filter chip for base-pattern rows

This keeps the operational dashboard focused while preserving traceability.

## Out of Scope for v1

- adding a new workbook sheet for base-pattern rows
- adding separate top-level KPI cards for base-pattern counts
- adding user-configurable thresholds for dominant-cluster detection

These can be added later after the base split is stable.
