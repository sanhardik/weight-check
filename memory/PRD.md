# SteelTrack — Steel Sheet & Plate Inventory App

## Overview
Mobile app (iOS/Android/Web) for a steel sheets & plates trading business. Warehouse workers log inward/outward material entries; office staff enriches entries with invoice/party details. Real-time inventory, theoretical weight calculation, and weight-slip variance flagging.

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

## Not Yet Built (Future)
- Password reset flow
- Entry edit/soft-delete
- Push notifications

## Iteration 3 — Grade Filter, Photo-OCR, Report Email, Low-Stock (shipped)
- Inventory screen: grade filter chips (ALL · IS2062 · TEST · …) with live totals
- Entry form: after uploading a weighment slip photo, backend `/api/vision/weight` (OpenAI `gpt-4o-mini` via Emergent LLM key) reads the NET kg and auto-fills `actual_weight`; shows raw snippet
- Entries screen: 📧 button opens picker modal → `/api/reports/party-statement` generates a brutalist A4 PDF, stores it, emails the logged-in user a 24-hour download link via Emergent-managed Resend. Download link also opens inline.
- `/api/settings/low-stock` (default 2 pcs, admin can PATCH) + analytics now ships `low_stock_threshold_pcs` and `low_stock[]`; home dashboard renders a red "LOW STOCK · कम स्टॉक" card tapping through to inventory

21/21 new backend tests + full regression pass (62/62 total).

Note: seeded demo emails (`office@steeltrack.com`) are not deliverable. For the email flow to reach a real inbox, add a user with your real email via Admin → Users; everything else works out of the box.

