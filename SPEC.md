# SPEC — NexusAI prototype

## §G

Build modern HTML/CSS/JS crime-intelligence prototype: login + investigation dashboard.

## §C

- Level-2 full-stack: static frontend served by Node/Express backend (port 4001)
- SQLite (dev) with PostgreSQL-ready schema; auto-init on boot; hash-chain on all critical events
- mock data stays as offline fallback; live.js layers backend Cases/Approvals/Entities/Dossier over it
- dark, polished investigation theme; responsive down to mobile (icon rail ≤900px)
- RBAC officer/police/admin; no public signup; JWT; Aadhaar AES-256-GCM; audit log

## §I

- `index.html`: login entry
- `dashboard.html`: dashboard entry
- `assets/css/`: shared styles
- `assets/js/`: data + interactions

## §V

- V1: Login must validate demo credentials and open dashboard.
- V2: Dashboard must show KPI, alerts, network, entity, activity and AI insights.
- V3: Dashboard controls must work with local mock data; no API dependency.
- V4: Entity cards and network nodes must open a usable detail panel.
- V5: UI must remain readable at 1024px and above.
- V6: Each screen module must be separable without changing shared data contract.

## §T

|id|status|task|cites|
|---|---|---|---|
|T1|x|Create shared theme, asset structure and demo-data contract.|V3,V5,V6|
|T2|x|Build validated login screen and session handoff.|V1,V5|
|T3|x|Build dashboard layout, insights, charts, activity and alerts.|V2,V3,V5|
|T4|x|Build interactive relationship network and entity detail panel.|V2,V3,V4|
|T5|x|Verify navigation, interactions and responsive layout.|V1,V2,V3,V4,V5,V6|
|T6|x|Seed live demo intel (6 entities, 7 rels, NTF-043 sharing Riya, chain+timeline).|V2,V3|
|T7|x|Cases UI: list/create/activate/close-request + closed badges + per-case entities/activity/report.|V2,V3|
|T8|x|Approvals inbox UI + two-person decide; E2E verified (create→close→approve→reopen).|V2,V3|
|T9|x|Live dossier: profile, identifiers, risk-why, cross-case chips, add-entity with dedupe→link.|V2,V3,V4|
|T10|x|Boot animation + logo, ≤900px responsive, Dockerfile/render.yaml, boot schema auto-init.|V5|
|T11|x|Shirpur content seed (NTF-044, FIR-SHP-2026-014, 25 entities, 31 rels) + boot ensure + entities LIST identifiers/ID-search; UI unchanged, case switch changes content.|V2,V3,V4|

## §B

|id|date|cause|fix|
|---|---|---|---|
|B1|2026-09-15|Closed side-drawer peeked ~212px on wide screens (`left:246px` + `translateX(-110%)` = spans -128..212px), covering sidebar nav tabs with cut-off content|Closed transform → `translateX(calc(-100% - 260px))` + `visibility:hidden` (delayed on close); removed duplicate `.side-drawer.open` rule|
|B2|2026-09-15|risk-strip + scrubber nested inside network card made left column ~590px tall, alerts card stretched with empty gap|Moved both to full-width grid rows (`grid-column:1/-1`); `.grid{align-items:start}`|
|B3|2026-09-15|Fresh deploys would boot with empty DB (schema only via manual db:init)|Auto-exec SCHEMA on server boot (idempotent); Dockerfile + render.yaml with /data disk|
|B4|2026-09-15|Entities table TYPE showed `-` for all rows (missing `type` in data.js); Vehicle row showed FIR:-/CNR:-/CR:- (missing firNumber)|Added type person/person/device/location/account/vehicle + vehicle FIR-MH-2026-0147 in data.js; bumped data.js/app.js to ?v=3|
|B5|2026-09-15|Entity dossier panel (detail-panel) clipped at viewport bottom, no scroll — Why-score/cross-case/Delete hidden behind Copilot FAB|detail-panel → overflow-y:auto + overscroll contain + 100px bottom pad; styles.css ?v=2→?v=3|
|B6|2026-09-15|Dossier showed phones only, no dedicated FIR/CNR/Criminal-ID block — user asked for IDs in every profile|Added Identifiers section (#entity-ids) in detail-panel; app.js fills from mock, live.js from backend identifiers; app.js ?v=4, live.js ?v=2|
