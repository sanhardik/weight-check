# Hemant Enterprise — Steel Sheet & Plate Inventory App

## Overview
Mobile app (iOS/Android/Web) for a steel sheets & plates trading business. Warehouse keepers (मुकादम) log inward/outward material entries; office staff enriches entries with invoice/party details. Real-time inventory, theoretical weight calculation, and weight-slip variance flagging (±0.35%).

## Problem Statement
Simple, bilingual (English/Hindi) inventory system usable by labourers with basic literacy. Steel comes in/out as sheets with Thickness×Width×Length×Pieces (supports 0.5 pieces). App calculates theoretical weight from dimensions and compares with actual weighment-slip reading; flags >0.2% mismatch. Role-based device access.

## Tech Stack
- **Frontend**: Expo SDK 57, React Native 0.86, Expo Router, TypeScript
- **Backend**: FastAPI + Motor (MongoDB) + JWT + bcrypt
- **Storage**: Emergent-managed Object Storage for weighment slip photos
- **Design**: Brutalist mobile — hard black 1.5pt borders, zero-radius, high-vis orange `#FF4500` accent

## Features Delivered (MVP)
1. **Role-based login** (Admin / Office / Labour) with seeded demo accounts
2. **Inward entry** – Thickness/Width/Length/Pieces (decimal, e.g. 0.5)/Grade/Vehicle No./Actual weight/Slip photo
3. **Outward entry** – Pick stock from available inventory, same fields + Broker name
4. **Theoretical weight** auto-calculated using steel density 7850 kg/m³
5. **Variance flag** – If |actual−theoretical|/theoretical > 0.2%, prominent red banner
6. **Weighment slip photo** – camera / gallery → uploaded to Object Storage
7. **Live inventory** grouped by Thickness×Width×Length×Grade, with pcs available & total weight
8. **Entries list** with filter chips (All / Inward / Outward / Pending Office)
9. **Office enrichment** – Office/Admin can add Invoice No, Party Name, Rate, Payment Terms, Remarks
10. **Unique entry numbers**: `INW-YYYYMMDD-NNNN` / `OUT-YYYYMMDD-NNNN`
11. **Language toggle** English / Hindi, persisted locally
12. **User management** (Admin only) – create new users with roles

## Roles & Permissions
| Role    | Create Entries | View Entries | Office Fields | Users Mgmt |
|---------|---------------|--------------|---------------|------------|
| Admin   | ✓             | ✓            | ✓             | ✓          |
| Office  | ✓             | ✓            | ✓             | ✗          |
| Labour  | ✓             | own view only (via screens) | ✗             | ✗          |

## Seed Accounts
- admin@steeltrack.com / admin123
- office@steeltrack.com / office123
- labour@steeltrack.com / labour123

## API Endpoints (all under `/api`)
- `POST /auth/login` → `{ token, user }`
- `GET /auth/me`
- `POST /auth/register` (admin)
- `GET /users` (admin)
- `POST /upload` – multipart `file`
- `GET /files/{path}` – requires Bearer token or `?token=` query
- `POST /entries/inward`
- `POST /entries/outward`
- `GET /entries?direction=inward|outward`
- `GET /entries/{id}`
- `PATCH /entries/{id}/office` (admin/office)
- `GET /inventory`
- `GET /calc/weight?thickness&width&length&pieces`

## Weight Formula
`theoretical_weight_kg = thickness_mm × width_mm × length_mm × pieces × 7.85e-6`

## Iteration 13 — Native Upload Bug Fix (shipped)
- **Bug**: On real phones (Expo Go / builds), photo upload crashed with "Unsupported FormData implementation" — Expo's winter `expo/fetch` runtime cannot convert React Native FormData.
- **Fix**: native uploads now bypass FormData entirely — base64 JSON instead. New endpoints: `POST /api/upload/base64`, `POST /api/vision/weight/path` (JSON), `POST /api/voice/transcribe/base64`. Shared `_store_upload` / `_transcribe_audio` helpers keep both paths identical. Frontend `uploadImageAsset(asset, token)` helper in `src/auth.tsx` picks multipart on web, base64 on native; swapped in EntryForm, verify, entry detail, office portal; VoiceInput native branch converted too; EntryForm OCR uses the JSON path route.
- **Verified**: 13/13 new backend tests, 213/214 regression (1 known OCR non-determinism flake), all web upload flows green. Native runtime needs one real-device smoke test by the user.

## Iteration 12 — Late Weighment Slip Attach (shipped)
- **`POST /api/entries/{id}/slip`**: attach (or office/admin replace) the weighment slip photo AFTER the entry was saved. Labour may only ADD when no slip exists (400 otherwise — prevents tampering); office/admin may replace anytime (audit-logged as `slip_photo_path` WAS→NOW). Slip is re-OCRed on attach (weight + vehicle) and `slip_mismatch_flag` recomputed — a late slip with wrong data still flags the entry for office review.
- Vision endpoint refactored to share `_ocr_slip_bytes` helper (iter9 slip tests stay green).
- **Frontend**: mobile entry detail "SLIP PHOTO" section shows a dashed "add it now" box for all roles when missing (labour can attach via camera/gallery with ATTACHING+READING overlay + OCR toast); office/admin get REPLACE buttons. Labour home gets a "MY ENTRIES" tile. Office portal entry detail has the same ADD/REPLACE block.
- **Server-side search**: `GET /entries?search=` matches entry no / vehicle / invoice / party / broker / driver (case-insensitive regex) — both mobile entries list and office portal table now search the WHOLE DB (debounced 350 ms), not just the first 200 rows.

201/201 backend tests pass (9 new iter12). Full E2E verified by testing agent: labour attach flow with real OCR (2500 kg + MH12AB1234 read from test slip), labour 400/403 blocks, office replace, history rows, portal + mobile UI.

## Iteration 11 — Office Web Portal + Tally Reminder (shipped)
- **Office Web Portal** at `/office/*` — dedicated desktop-first route tree with sidebar nav (Dashboard · Entries · Parties · Inventory · Verifications · Reports) and own login at `/office/login`. Office staff never need the mobile app or Expo Go; they just open the preview URL. `app/index.tsx` auto-redirects office users on web to `/office`; labour attempting `/office/*` are redirected to `/home`. Admin can use either portal.
  - Pages: KPI dashboard (today inward/outward kg + pending-office pile + tally-mismatch count), filterable entries table (direction chips, pending/flagged toggles, search by entry/vehicle/invoice/party/broker, CSV export), two-column entry detail (facts + office form + correction + edit history + weighment-slip image + email invoice PDF), parties ledger (per-party rollup — entries/invoiced/pending/weight/last-activity/WhatsApp deep link), live inventory table with last-verified column, verifications queue (admin review buttons), reports (CSV + Party Statement PDF).
  - New endpoint `GET /api/parties/ledger` (admin/office) returns per-party aggregated stats sorted with pending-office rows first, then by last activity desc.
- **Persistent tally reminder** at `src/ui/TallyReminder.tsx` — mounted globally in `app/_layout.tsx`. Red sticky banner at top of every labour-visible screen reading "⚠ DAILY TALLY · N ITEMS PENDING — TAP TO COMPLETE →"; hidden on `/verify` itself and auto-hides when done==total. Polls `/verifications/today` every 30s so the banner clears without a manual refresh.

192/192 backend tests after this iteration (6 new iter11). Frontend verified E2E for desktop portal + mobile banner.

## Iteration 10 — Daily Physical Tally + Admin Full Edit (shipped)
- **Daily tally**: 2 inventory groups per day must be physically verified (pieces + mandatory photo + optional note; NO weight). Admin pre-assigns via Verification Log (dropdowns from live stock); otherwise system auto-picks 2 random groups preferring least-recently-verified (`/api/verifications/today` idempotent auto-create).
- **Blind count**: system pieces hidden from labour until after submit. Mismatch → flagged + admins emailed (soft). Labour home shows DAILY TALLY card with x/2 progress; `/verify` screen handles the flow.
- **Admin review** at `/verifications`: APPROVE / REJECT / APPLY STOCK CORRECTION — correction creates an inward/outward adjustment entry (vehicle `PHYSICAL-TALLY`, broker `Stock Correction`) and only then changes stock. `last_verified_at/by` stamped per group (`inventory_meta`), shown on inventory screen.
- **Admin full edit**: `PATCH /api/entries/{id}/full-edit` — admin can change ANY field of ANY transaction (vehicle, driver, broker, mukadam, invoice, party, rate, terms, remarks, entry_date, actual weight, line_items with outward stock guardrail). All changes audit-logged. UI: collapsible "ADMIN FULL EDIT" block on entry detail.
- Tester fixes: entries.tsx conditional-hook crash (red screen), Hindi Poppins render-timing (set during render, not useEffect). Photo button copy fixed to "TAKE PHOTO OF ITEM"; assign 400s when today's tally fully submitted.

186/186 backend tests pass (33 new iter10). All frontend flows verified E2E by testing agent. NOTE: tally alert emails 422 on @steeltrack.com demo recipients (Resend blocks demo domains) — add a real admin email in production.

## Iteration 8 — Slip Validation, Fonts, Palette, Test Fixes (shipped)
- **Weighment slip smart validation**: `/api/vision/weight` now extracts BOTH NET weight AND vehicle number (Indian plate format) from the slip. Entry create (`/entries/inward|outward`) accepts `slip_ocr_weight_kg` + `slip_ocr_vehicle_number`; backend `compute_slip_mismatch()` cross-checks against entered values (plate normalised: case/spaces ignored; weight tolerance 0.35%). Mismatch → `slip_mismatch_flag=true` + human-readable `slip_mismatch_details[]` saved on the entry. Labour sees an amber warning but save is NOT blocked; entry is flagged for office/admin review. Office/admin correction (`PATCH /entries/{id}/correction`, now with vehicle input in UI) recomputes and CLEARS the flag automatically when fixed.
- Entry detail: red "⚠ SLIP MISMATCH — OFFICE REVIEW" banner (testID `slip-mismatch-banner`) with detail lines; green "SLIP OCR · Matches slip ✓" row when matched. Entries list shows "⚠ SLIP" badge.
- **Fonts**: Hindi → Poppins (Regular/SemiBold/Bold/ExtraBold, bundled TTFs with Devanagari, loaded via explicit FontFace on web / Font.loadAsync on native). English → San Francisco (system font on Apple, system sans elsewhere). Applied via render-patch on Text/TextInput (React 19 dropped defaultProps). Hardcoded `Courier` fontFamily removed app-wide.
- **Palette**: White surface, Light Blue brand (#3E8FD0), Light Green success (#3D9E66), dark-blue-slate text/borders (#17324D).
- **Flaky tests fixed**: iter3 `test_parties_sorted_deduplicated` (endpoint returns dicts since iter4 — test now maps names), iter7 `TestOutwardFIFO` (grade parameterized with uuid suffix per run).
- Bug found & fixed by testing agent: EntryForm OCR call sent JSON to the Form-only endpoint (400) — now multipart FormData; real OCR verified E2E (10000 kg + MH12AB1234 read from a generated slip).

170/170 backend tests pass (17 new iter9 + 153 regression). Frontend verified: banner, correction-clears-flag flow, Hindi=Poppins / English=SF, new theme.

## Iteration 7 — Multi-Line Entries, Catalog, Vehicle-First (shipped)
- **Settings → Catalog** screen (admin + office) with chip tabs for Mukadams / Brokers / Grades / Thickness / Width / Length. Admin can add + remove; office can add. Unified `/api/catalog/{kind}` endpoint handles numeric and string kinds.
- **Pre-fed catalogs**: 5 grades (IS2062, E350, SA516, S355, SS400), 10 thicknesses (3→25 mm), 6 widths, 6 lengths, 4 mukadams, 4 brokers.
- **Labour inputs are dropdown-only** on Inward & Outward — thickness, width, length, grade, broker all come from the catalog. Office / admin can add new values from the Settings screen.
- **Multi-line entries**: every inward and outward can have N product lines. Backend `line_items[]` is the source of truth; top-level fields are kept as a view of line_items[0] (pieces + weight are summed). Inventory, FIFO auto-match, stock guardrail and low-stock alerts all aggregate across `$unwind: line_items`.
- **Legacy entries migrated on startup** — existing single-item entries get lifted into `line_items`.
- **Entry Date** field — labour picks or edits the date, defaults to today; shown on entry detail and entries list.
- **Vehicle-first UI** — form now flows: Vehicle → Products → Date → Weight → Slip. Driver + QR scan moved to the vehicle section.

24/24 iter_8 backend tests + 110/112 full regression (2 pre-existing flaky tests unchanged).

## Iteration 6 — Hemant Enterprise rebrand + bug fix (shipped)
- **App renamed to Hemant Enterprise** (login brand, app.json name, email from_name)
- **Variance threshold 0.2% → 0.35%** (backend constant + all i18n labels + frontend inline check)
- **Mukadam (warehouse keeper) tile + picker** — pre-seeded Ravi Patil / Suresh Kadam / Kiran Mane / Mahesh Jadhav; selected name saved to AsyncStorage and auto-attached to every inward/outward entry; admin CRUD at `/api/mukadams`
- **Broker dropdown** — 4 pre-seeded brokers (`/api/brokers`), labour picks from a dropdown instead of typing
- **Outward is now one single form for labour** — fill dimensions and pieces, backend FIFO-picks the oldest matching inward entry as the source lot automatically
- **Voice bug fix** — dual-model fallback (gpt-4o-mini-transcribe → whisper-1), 422 "No audible speech detected" instead of silent 502, descriptive 502 detail if the SDK itself fails; works on web via MediaRecorder as well as native via expo-audio
- **Soothed palette & typography** — warm cream background (`#FAF9F6`), softer orange (`#D96A3A`), Nunito Sans font loaded via expo-font, reduced heavy 900 weights to 700/800

22/22 iter_7 tests pass; voice bug confirmed resolved by testing agent.

## Iteration 5 — Alerts, WhatsApp Memory, Invoice PDFs, Variance Trail, Vehicle Memory (shipped)
- Entry form: optional **Driver Name** + **Driver Phone**; typing a known vehicle plate shows a green "↩ Last: Suresh · 99999..." hint and auto-fills driver fields from `db.vehicles`
- `/api/vehicles/{plate}` recalls the latest driver + phone for a plate (case-insensitive)
- `/parties` returns `{name, whatsapp, whatsapp_digits, email}`; `/parties/{name}` PUT upserts WhatsApp phone (normalises 10-digit Indian numbers to `91…`). Report modal lets office save a party's WhatsApp inline, then the WhatsApp share button opens `wa.me/<digits>` directly
- Entry detail now shows a red **CORRECT ENTRY** block that writes actual_weight / pieces / vehicle / driver changes through `/entries/{id}/correction`; every change appears in the EDIT HISTORY audit trail with WAS → NOW, user, role, timestamp. Variance is recomputed and stock guardrail applies on pieces corrections.
- Entry detail: office/admin can tap **📧 EMAIL INVOICE PDF** (only enabled when Invoice No + Party Name are set); backend generates a brutalist A4 invoice via reportlab, uploads to Object Storage, emails a 48h signed link to the office user. If Resend 422s a demo address, the download URL is still returned so office can share manually.
- Low-stock email alerts: after each outward, `_check_low_stock_and_alert` emails all admins when the group drops to ≤ threshold; `db.low_stock_alerts` enforces a 24h cooldown per `t|w|l|grade` so admins aren't spammed.

96 cumulative backend tests pass (10 new iter_5 + prior) · one bug caught and fixed by testing agent at `server.py:1605`.

## Iteration 4 — WhatsApp, QR Scan, Reorder, History, Rate Hiding (shipped)
- Entry form: new **QR button** next to Vehicle input opens a full-screen `CameraView` scanner (QR, Code128, Code39, EAN13); scanned value fills the vehicle field. Shows a web-fallback modal because browsers can't open the native camera.
- Entry detail: office/admin now see an **EDIT HISTORY** block with every change to invoice/party/rate/terms/office_remarks (WAS → NOW, timestamp, user, role). Labour never sees `rate` — the backend strips it on every entries response.
- Analytics `low_stock[]` adds `avg_weekly_pcs`, `weeks_remaining`, `suggested_reorder_pcs` (28-day consumption ÷ 4). Dashboard low-stock card now shows "0.25 PCS/WK · 4WK LEFT · ORDER 3" directly.
- Report email modal: after the PDF is generated, a **SHARE ON WHATSAPP** button opens `wa.me/?text=…` with a prefilled message + the signed download link so office can forward directly to the party.

72/72 backend tests pass (10 new iter_4 + full regression).

## Not Yet Built (Future)
- Password reset flow
- Entry edit/soft-delete

## Iteration 3 — Grade Filter, Photo-OCR, Report Email, Low-Stock (shipped)
- Inventory screen: grade filter chips (ALL · IS2062 · TEST · …) with live totals
- Entry form: after uploading a weighment slip photo, backend `/api/vision/weight` (OpenAI `gpt-4o-mini` via Emergent LLM key) reads the NET kg and auto-fills `actual_weight`; shows raw snippet
- Entries screen: 📧 button opens picker modal → `/api/reports/party-statement` generates a brutalist A4 PDF, stores it, emails the logged-in user a 24-hour download link via Emergent-managed Resend. Download link also opens inline.
- `/api/settings/low-stock` (default 2 pcs, admin can PATCH) + analytics now ships `low_stock_threshold_pcs` and `low_stock[]`; home dashboard renders a red "LOW STOCK · कम स्टॉक" card tapping through to inventory

21/21 new backend tests + full regression pass (62/62 total).

Note: seeded demo emails (`office@steeltrack.com`) are not deliverable. For the email flow to reach a real inbox, add a user with your real email via Admin → Users; everything else works out of the box.

