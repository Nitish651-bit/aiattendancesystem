
## Turn 1 — Dashboard fix + missing route stubs (this turn, small)

**Problem observed**
- Sirf `dashboard.tsx` exists under `_authenticated/`. Nav mein `/attendance`, `/students`, `/teachers`, `/face-enroll`, `/timetable`, `/leaves`, `/departments`, `/subjects`, `/holidays`, `/reports`, `/audit`, `/settings` sab links hain — koi bhi click 404 deta hai. "Dashboard failed to load" bhi shayad `<a href="/attendance">` type ke internal navigation ka side-effect hai, ya membership fetch silently fail ho raha hai.
- `/auth` pe Google OAuth ke baad session set hoti hai but koi auto-redirect nahi — user `/auth` pe fasa reh sakta hai.

**Fixes**
1. `AuthedLayout`: memberships query error ko screen pe visible karo (silent-fail band).
2. `/auth`: agar session already hai to `/dashboard` pe redirect (Google popup + hard-reload dono flows cover).
3. Har missing nav route ke liye ek "Coming soon" stub file create karo (`/attendance`, `/students`, `/teachers`, `/face-enroll`, `/timetable`, `/leaves`, `/departments`, `/subjects`, `/holidays`, `/reports`, `/audit`, `/settings`). Yeh 404 khatam karega aur nav clickable ho jayega.
4. Dashboard ke `<a href>` ko `<Link to>` mein convert karo (client-side nav, faster).

## Turn 2 — Admin settings + Audit log viewer (foundation)

- Migration: `org_settings` table (confidence_threshold, unknown_face_policy `reject|log`, duplicate_attendance_window_minutes, require_liveness, min_liveness_signals, geofence_radius_m, geofence lat/lng).
- Migration: extend `audit_logs` with face-event fields OR create `face_events` table (confidence, faces_detected, liveness_signals JSONB, decision, matched_student_id, ip, device, attendance_id).
- `/settings` page for admins to edit thresholds.
- `/audit` page listing face events with filters.

## Turn 3 — Face enroll page (`/face-enroll`)

- Install `@vladmandic/face-api` (browser-side, no server dependency).
- Load models from CDN.
- Capture 3-5 frames, average 128-D embedding, insert into `face_embeddings`.

## Turn 4 — Auto-attendance page (`/attendance`) — the big one

Flow per user request:
1. Camera permission + video preview.
2. Timetable check: current class slot for user's enrollment (day + time window).
3. Geofence: browser geolocation vs `org_settings` center/radius.
4. IP + device fingerprint capture.
5. Liveness sequence (blink detect + head-turn via face-api landmarks) — require N successful signals per `org_settings`.
6. Face match: cosine similarity vs enrolled embedding, must exceed `confidence_threshold`.
7. Duplicate check: last attendance within window → block.
8. Spoof rejection: low liveness score → block AND log `face_events` decision.
9. On success: insert `attendance_records` with ip, device, gps, confidence.
10. Every attempt (pass or fail) writes to `face_events`.

## Why phased
Ek turn mein 4 pages + 2 migrations + face-api integration + spoof logic = 2000+ lines. Alag turns mein karenge to har piece verify ho payega aur credits controlled rahenge.

**Confirm karo — kya main Turn 1 (dashboard fix + stubs) abhi karu?** Agar haan, next turn Turn 2 pe move karenge.
