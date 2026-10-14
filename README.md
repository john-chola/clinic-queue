# Clinic Queue

Take a number from your phone and watch your place in the clinic queue, instead of asking "who is the last person?" and guessing how fast the line is moving.

| Who | What they get |
|---|---|
| **Patient** | Scan the QR code at the entrance, take a number (A-024), see *"You are number 6 · about 25 minutes"* live, and get a buzz when it is their turn. They can wait outside. |
| **Reception** | Add walk-in patients (no smartphone needed: write the number on their card), give priority with a reason, return patients who missed their call |
| **Room / counter** | One big button: **Done · Next patient**. Also *Call again* and *Not here* |
| **Waiting-room screen** | Any TV or old laptop: now serving, next three, queue length, a chime and the number read aloud |

## How it works

- **Tickets** are numbered per service per day (A-001, P-001…), restarting at midnight Lusaka time. The counter is incremented atomically, so two patients joining at the same moment never get the same number.
- **Calling the next patient** finishes whoever is in that room and claims the next ticket with a single atomic `findOneAndUpdate` (priority first, then first come, first served). Two rooms pressing *Next* at the same moment can never call the same patient.
- **The wait estimate** = (people ahead + 1) × average minutes per patient ÷ rooms working. The average comes from the last 10 patients served today (outliers ignored), and falls back to the service's default until three patients have been seen. See `backend/utils/queue.js`.
- **Live updates** use Socket.io. The server only announces *"queue X changed"*; each screen re-fetches what it is allowed to see, so patient names never travel to the public screens. A slow poll keeps working if the socket drops on mobile data.
- **Privacy**: the patient's link uses a random id (`/t/Xy3…`), not the database id. Public screens show ticket codes only.
- **Accountability**: every change is logged in `QueueEvent` (who, what, when), the raw data for reports later.

## Project structure

```
backend/   Node.js + Express + MongoDB (Mongoose) + Socket.io
  models/        Service, Ticket, Counter, Staff, QueueEvent
  services/      queueService.js: every queue rule lives here
  utils/queue.js pure helpers: day key, ticket codes, wait estimate
  tests/         Jest: helpers, queue rules (with in-memory fakes), HTTP routes
frontend/  React + Vite
  pages/   JoinPage, TicketPage, StaffLoginPage, StaffPage, DisplayPage
  lib/     api client, live updates, sound and speech for the display
```

## Run it on your laptop

You need Node.js 18+ and a free MongoDB Atlas database (allow access from your IP, or 0.0.0.0/0).

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env          # then fill in MONGODB_URI and JWT_SECRET
npm run seed -- --patients    # demo services, staff and today's patients
npm run dev                   # http://localhost:5000/api/health

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Open three windows to see it working together:

| Page | Address | Log in |
|---|---|---|
| Patient | http://localhost:5173/ | none |
| Staff | http://localhost:5173/staff | reception `0970000002`, clinician `0970000003`, admin `0970000001`; password `clinic123` |
| Waiting-room screen | http://localhost:5173/display | none: tap once to turn on sound |

Press **Done · Next patient** on the staff page and watch the display and the patient's ticket change instantly.

## Tests

```bash
cd backend && npm test        # 23 tests
cd frontend && npm run lint && npm run build
```

GitHub Actions runs both on every push (`.github/workflows/ci.yml`).

## Deploy (same as ZamMarket)

- **Backend on Render**: root directory `backend`, build `npm install`, start `npm start`; environment `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV=production`, `FRONTEND_URL=https://<your-app>.vercel.app`.
- **Frontend on Vercel**: root directory `frontend`; environment `VITE_API_URL=https://<your-api>.onrender.com/api` and `VITE_SOCKET_URL=https://<your-api>.onrender.com`. Redeploy after changing them.
- Print the QR code from the waiting-room screen and stick it at the entrance.

## Roadmap

- [x] Tickets, call next, recall, no-show and return, priority with reason, cancel
- [x] Live patient ticket page with position and wait estimate
- [x] Staff console and waiting-room display with chime, speech and QR code
- [ ] SMS: "You are 3rd in line, please come back" (reuse ZamMarket's `sms.js`)
- [ ] Patient moves on to the next service (OPD → Lab → Pharmacy) keeping their place
- [ ] Admin page: services, rooms, staff accounts, open/close a queue
- [ ] Daily report: patients served, average wait, busiest hours, no-shows
- [ ] Offline reception: keep adding patients when the internet drops, sync later
- [ ] Measure estimate accuracy: estimated vs actual wait for every ticket

## What I learned

*(Fill this in as you go: problems you hit and how you solved them. It makes great interview material.)*
