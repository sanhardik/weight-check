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

