# Balendly MVP (interne Calendly-ähnliche Booking-App)

Node.js + TypeScript + Express + SQLite MVP für **eine Organisation** mit **einem Organizer-Outlook-Kalender**.

## Features (MVP)
- Slots auf Basis konfigurierbarer Zeitfenster in `Europe/Berlin`.
- Busy/Free-Abgleich über Microsoft Graph `calendar/getSchedule`.
- Buchung erstellt Outlook-Termin und sendet n8n Webhook `BOOKING_CREATED`.
- Reschedule über Token-Link, Outlook Event Update + Webhook `BOOKING_RESCHEDULED`.
- Cancel über Token-Link, Outlook Event Delete + Webhook `BOOKING_CANCELLED`.
- Persistenz in SQLite (`./data/app.db`).
- Erster Start erzwingt Admin-Erstellung (`/admin/setup`).

## Projektstruktur
- `src/` Anwendungscode (Config, Slots, Bookings, Graph, Webhooks)
- `config/availability.json` Arbeitszeitfenster + Slot-Regeln
- `data/` SQLite Datei

## Setup
```bash
npm install
cp .env.example .env
npm run dev
```

## Konfiguration (`.env`)
Siehe `.env.example`.

Wichtig:
- `ADMIN_SESSION_SECRET`: langer Zufallswert.
- `MICROSOFT_*`: Entra / Graph App + Organizer Mailbox.
- `N8N_WEBHOOK_URL`: Endpoint für BOOKING_* Events.
- `N8N_WEBHOOK_SECRET` optional, dann Header `X-Balendly-Signature` (HMAC SHA-256).

## Microsoft Entra App Registration
1. App in Entra erstellen.
2. Redirect URI (Web): `http://localhost:3000/auth/callback`.
3. API Permissions (delegated):
   - `User.Read`
   - `Calendars.Read`
   - `Calendars.ReadWrite`
   - `offline_access`
4. Client Secret erstellen und in `.env` setzen.
5. App starten, Admin erstellen (`/admin/setup`), dann login (`/admin/login`).
6. In `/admin` auf **Microsoft Connect** klicken und OAuth abschließen.

## Availability anpassen (ohne Codeänderung)
Bearbeite `config/availability.json`:
- `workingHours` pro Wochentag (`0=Sonntag ... 6=Samstag`)
- `slotLengthMinutes`
- `bufferBeforeMinutes` / `bufferAfterMinutes`
- `minimumLeadTimeHours`
- `maxDaysInAdvance`

Validierung prüft `start < end` und keine überlappenden Zeitfenster.

## n8n Webhook Setup
n8n Webhook URL in `N8N_WEBHOOK_URL` hinterlegen.

Payload enthält u. a.:
- `eventType`: `BOOKING_CREATED` | `BOOKING_RESCHEDULED` | `BOOKING_CANCELLED`
- Booking-Felder inkl. Zeit, Kontakt, Outlook Event ID, Token-Links (bei create)

## HTTP Beispiele
Slots für Datum:
```bash
curl 'http://localhost:3000/api/slots?date=2026-01-15'
```

Booking:
```bash
curl -X POST 'http://localhost:3000/api/book' \
  -H 'Content-Type: application/json' \
  -d '{
    "slotStartUtc":"2026-01-15T10:00:00.000Z",
    "slotEndUtc":"2026-01-15T10:30:00.000Z",
    "timezone":"Europe/Berlin",
    "invitee":{
      "firstName":"Max",
      "lastName":"Mustermann",
      "company":"ACME GmbH",
      "postalCode":"10115",
      "email":"max@example.com",
      "phone":"+49170123456"
    }
  }'
```

Reschedule:
```bash
curl -X POST 'http://localhost:3000/api/reschedule' \
  -H 'Content-Type: application/json' \
  -d '{
    "bookingId":"BOOKING_ID",
    "token":"RESCHEDULE_TOKEN",
    "slotStartUtc":"2026-01-16T11:00:00.000Z",
    "slotEndUtc":"2026-01-16T11:30:00.000Z"
  }'
```

Cancel:
```bash
curl -X POST 'http://localhost:3000/api/cancel' \
  -H 'Content-Type: application/json' \
  -d '{"bookingId":"BOOKING_ID","token":"CANCEL_TOKEN"}'
```
