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
  services/      queueService.js (queue rules), reportService.js, adminService.js
  utils/queue.js pure helpers: day key, ticket codes, wait estimate
  tests/         Jest: helpers, queue rules (with in-memory fakes), reports, admin, HTTP routes
docs/      TESTING.md, DEPLOYMENT.md
frontend/  React + Vite
  pages/   JoinPage, TicketPage, StaffLoginPage, StaffPage, DisplayPage, ReportPage, AdminPage
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
npm run dev                   # http://localhost:5050/api/health

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5180
```

Open three windows to see it working together:

| Page | Address | Log in |
|---|---|---|
| Patient | http://localhost:5180/ | none |
| Staff | http://localhost:5180/staff | reception `0970000002`, clinician `0970000003`, admin `0970000001`; password `clinic123` |
| Waiting-room screen | http://localhost:5180/display | none: tap once to turn on sound |

Press **Done · Next patient** on the staff page and watch the display and the patient's ticket change instantly.

### Troubleshooting

| Problem | Fix |
|---|---|
| Blank page; console says *"Invalid hook call"* or mentions a `<Provider>` | Another project's service worker is serving its cached files at this address. DevTools → Application → Service workers → **Unregister**, then Storage → **Clear site data**, then reload with Ctrl+Shift+R. This project uses port 5180 to avoid it. |
| `Port 5180 is already in use` | Another Vite server is running. Stop it, or change `server.port` in `frontend/vite.config.js` (and the allowed address in `backend/app.js`). |
| Pages load but say *"No connection to the server"* | The backend is not running on port 5050. Check `PORT=5050` in `backend/.env` and that `npm run dev` in `backend/` says *MongoDB connected*. |
| Backend says *MongoDB connection failed* | In Atlas → Network Access, allow your IP (or 0.0.0.0/0), and check the password in `MONGODB_URI`. |

## Tests

```bash
cd backend && npm test        # 88 tests
cd frontend && npm run lint && npm run build
```

GitHub Actions runs both on every push (`.github/workflows/ci.yml`).

**[docs/TESTING.md](docs/TESTING.md)** is the full guide: what each test file covers, a step-by-step manual test of every screen (patients, staff, display, SMS, transfers, report, admin, roles, failures), a record sheet for your results, and the smoke test to run after each deploy.

## Deploy

MongoDB Atlas (database) → Render (backend) → Vercel (frontend), all on free plans. **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** walks through every setting, the first data and locking down the demo accounts, real SMS, setting up the clinic's screens, updating and rolling back, and what to change before a real clinic relies on it.

In short:

- **Backend on Render**: root directory `backend`, build `npm ci`, start `npm start`, health check `/api/health`; environment `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV=production`, `FRONTEND_URL=https://<your-app>.vercel.app`.
- **Frontend on Vercel**: root directory `frontend`; environment `VITE_API_URL=https://<your-api>.onrender.com/api` and `VITE_SOCKET_URL=https://<your-api>.onrender.com`. Redeploy after changing them.
- Seed once **without** `--patients`, then change or disable the demo accounts from the Admin page.

## Roadmap

- [x] Tickets, call next, recall, no-show and return, priority with reason, cancel
- [x] Live patient ticket page with position and wait estimate
- [x] Staff console and waiting-room display with chime, speech and QR code
- [x] SMS: "You are 3rd in line, please come back"
- [x] Patient moves on to the next service (OPD → Lab → Pharmacy) keeping their place
- [x] Admin page: services, rooms, staff accounts, open/close a queue
- [x] Daily report: patients served, average wait, busiest hours, no-shows
- [ ] Offline reception: keep adding patients when the internet drops, sync later
- [ ] Measure estimate accuracy: estimated vs actual wait for every ticket

## What I learned

- **The backwards `if`.** My first version used `if (ticket.phone || ticket.notifiedAt) continue;` — the wrong way round, so it skipped the people *with* phones and tried to text the ones without. It looked reasonable when I wrote it, and the tests I hadn't written yet would have caught it in one run. Now I read every skip condition aloud: "if there is no phone, or they've already been notified, skip."
- **Field names matter more than logic.** The service function was correct, but it queried `serviceId` when the model calls the field `service`, so it silently found nobody. The controller had the same mistake (`ticket.serviceId`), and `callNext` had no `serviceId` variable at all — it's `req.params.id`. Lesson: before using a field, open the model and copy the name exactly.
- **`jest.mock` vs `jest.spyOn` with destructured imports.** `queueService.js` does `const { sendSms } = require('../utils/sms')` — that copies the function reference at module load. A later `jest.spyOn(sms, 'sendSms')` replaces the property on the *module object*, but `queueService` is still holding the original reference, so the spy never fires and the real SMS runs. `jest.mock('../utils/sms', factory)` replaces the whole module *before* `queueService` loads, so its destructure grabs the `jest.fn()`. That's the interview answer: destructuring captures a value, spying replaces a property — they point at different things.
