# Testing the whole system

Clinic Queue is tested in three layers. Each catches mistakes the others miss.

| Layer | What it proves | How long |
|---|---|---|
| **1. Automated tests** | Every queue rule, report figure and permission works, with the database faked | 10 seconds, on every push |
| **2. Manual end-to-end test** | The real pages, real MongoDB, live updates and several devices work together | about 1 hour |
| **3. Smoke test after deploying** | The hosted version is wired up correctly (database, CORS, sockets) | 10 minutes, after every deploy |

---

## 1. Automated tests

```bash
cd backend && npm test                       # 88 tests
cd frontend && npm run lint && npm run build # no frontend unit tests yet: lint + a clean build
```

GitHub Actions runs the same commands on every push and pull request (`.github/workflows/ci.yml`). A red cross on a commit means one of them failed. Open the run, then the failed step, to see which test failed and why.

| File | What it covers |
|---|---|
| `tests/queue.test.js` | Pure helpers: the Lusaka day, ticket codes, wait estimate, queue order (priority, then arrival time) |
| `tests/queueService.test.js` | Queue rules with an in-memory fake database: joining, calling next, two rooms at once, recall / no-show / return, SMS "nearly up", sending a patient on to another service |
| `tests/report.test.js` | Report helpers (minutes, no-show rate, hour gaps), the route's permissions, the final report shape |
| `tests/admin.test.js` | Admin rules (rooms, ticket letter, delete, last admin, own account) and that every admin route refuses non-admins |
| `tests/api.test.js` | HTTP layer: unknown routes, tokens, roles, login |

Useful variations:

```bash
npx jest tests/admin.test.js            # one file
npx jest -t "last admin"                # tests whose name matches
npx jest --coverage                     # which lines the tests reach (open coverage/lcov-report/index.html)
```

**What the automated tests do not prove:** that the MongoDB queries are right (the database is faked), that the pages look and behave correctly, and that live updates arrive. That is what layer 2 is for.

---

## 2. Manual end-to-end test

### Set up

You need a MongoDB database. Either:

- **MongoDB Atlas** (the free cluster you will use for deployment, but with a *separate* database name such as `clinicqueue-test`), or
- **MongoDB on your laptop with Docker:** `docker run -d --name mongo -p 27017:27017 mongo:7`, then
  `MONGODB_URI=mongodb://127.0.0.1:27017/clinicqueue` in `backend/.env`.

```bash
# Terminal 1
cd backend
npm run seed -- --patients     # 3 services, 3 staff, today's demo patients
npm run dev                    # leave it running: SMS messages are printed here

# Terminal 2
cd frontend
npm run dev -- --host          # --host lets phones on the same Wi-Fi open it
```

Vite prints a `Network:` address such as `http://192.168.1.20:5180`. **Use that address everywhere, even on the laptop.** The QR code on the waiting-room screen points to whatever address the screen was opened at, so a screen opened at `localhost` shows a QR code your phone cannot use.

Demo logins (password `clinic123`):

| Role | Phone |
|---|---|
| Admin | 0970000001 |
| Receptionist | 0970000002 |
| Clinician | 0970000003 |

To start again from a clean day, run `npm run seed -- --patients` again (it deletes **today's** tickets).

Things that will trip you up while testing:

- **"Too many tickets from this device"**: one device may join 20 times per 10 minutes. Restart the backend (the counts are kept in memory), or add patients as walk-ins from the reception page instead.
- **"Too many login attempts"**: 10 logins per 15 minutes per device. Restart the backend.
- **Two staff windows in one browser share their saved room.** For two rooms side by side, use a second browser or a private window.
- **The waiting-room screen is silent until you tap it once** (browsers block sound until someone interacts with the page).

### Devices to have open

| Window | Address | As |
|---|---|---|
| Phone (or a narrow window) | `http://<network-address>:5180/` | patient |
| Laptop browser | `/staff` | receptionist, later clinician and admin |
| Second browser or private window | `/staff` | clinician in another room |
| Another window or a TV | `/display` | waiting room |

### Test script

Work through the cases in order and tick each one. "You should see" is the pass condition. Anything else is a bug: write down what happened (see the record sheet at the end).

#### A. Patients joining

| ID | Do this | You should see |
|---|---|---|
| A1 | Scan the QR code on `/display` with your phone | The join page opens on the phone |
| A2 | Choose OPD, give a name and your phone number, take a number | A ticket such as A-009, "You are number N in line", a wait estimate |
| A3 | Go back and join OPD again with the same phone number | The **same** ticket comes back. No second number |
| A4 | Enter a phone number like `12345` | "Enter a valid Zambian phone number…" and no ticket |
| A5 | Close the phone's browser, open the join page again | "Your tickets today" lists the ticket; tapping it opens it |
| A6 | On the ticket page, tap **Leave the queue**, confirm | "This ticket was cancelled"; the staff waiting list loses it within a second |

#### B. Calling patients (clinician and receptionist)

| ID | Do this | You should see |
|---|---|---|
| B1 | Log in as reception; add a walk-in with no phone | A big ticket number to write on the patient's card |
| B2 | Add a walk-in with **Priority** and reason "Pregnant" | They go to the top of the waiting list with a Priority badge |
| B3 | Log in as clinician, choose OPD / Room 1, press **Call next patient** | The priority patient is called. The display chimes and reads the number and room aloud. That patient's phone buzzes and shows "It's your turn" |
| B4 | Press **Done · Next patient** | The previous patient disappears from "now serving"; the next one is called |
| B5 | In the second window choose Room 2 and press Next **at the same moment** as Room 1 | Two **different** patients are called |
| B6 | Press **Not here**, then (as reception) **Return** in "Missed their call" | The patient goes back to the front of the queue marked priority |
| B7 | Patients' ticket pages while you call others | "You are number N" counts down live, without refreshing |

#### C. SMS "you're nearly up"

With `SMS_PROVIDER=console` the messages are printed in Terminal 1 instead of sent.

| ID | Do this | You should see |
|---|---|---|
| C1 | In **Laboratory** (empty in the demo data), add four walk-ins **with phone numbers**, then press **Call next patient** | The first is called. In Terminal 1: `SMS to +260…: Clinic Queue: L-002, you are 1st in line for Laboratory…`, then 2nd and 3rd for the next two |
| C2 | Add a fifth walk-in with a phone, press **Done · Next patient** | Only the fifth patient is texted ("3rd in line"). Nobody is texted twice |

#### D. Sending a patient on to another service

| ID | Do this | You should see |
|---|---|---|
| D1 | As clinician in OPD with a patient in the room, choose **Laboratory** under "Send on to another service" and press **Done · send on** | "A-0xx sent to Laboratory as L-00y" |
| D2 | Switch the staff page to Laboratory | The patient is in the waiting list with a "from OPD" badge, placed by when they **arrived at the clinic**, ahead of Lab patients who arrived later |
| D3 | If that patient joined from your phone: look at their old OPD ticket page | It moves to the new Lab ticket by itself: "Sent on from OPD…" |
| D4 | Double-click **Done · send on** quickly | Only one Lab ticket is made |
| D5 | (As admin) close the Laboratory queue, then try to send someone there | "Laboratory is not taking patients right now". Reopen it afterwards |

#### E. Daily report (admin)

| ID | Do this | You should see |
|---|---|---|
| E1 | Log in as admin, open **Daily report** | Today's numbers: joined, served, no-shows, average wait; a table per service; the busiest-hours chart |
| E2 | Check one number by hand: count the OPD tickets you made today | "Joined" for OPD matches |
| E3 | Pick an earlier day with no patients | "Nobody joined a queue on this day", zeros, and "—" for averages (not 0 min) |
| E4 | Log in as clinician and type `/staff/report` in the address bar | Sent back to the staff page |

#### F. Admin page

| ID | Do this | You should see |
|---|---|---|
| F1 | **Add a service**: "Dental", letter D, room "Chair 1" | It appears in the list, and on the patients' join page without refreshing |
| F2 | Try to add another service with letter P | "The letter P is already used by Pharmacy" |
| F3 | Edit OPD: remove a room that has a patient in it right now | "Room 2 has a patient (A-0xx). Finish with them before removing the room." |
| F4 | Edit OPD: change the letter to O | Refused: tickets have gone out as A today |
| F5 | **Close queue** on Dental, then try to join it from the phone | The join page shows it closed; joining is refused. **Open queue** again |
| F6 | Edit OPD → Delete | Refused: it has patient records. Delete Dental (no patients) → it goes |
| F7 | **Add a staff member** (clinician, your own second phone number); log in as them | They can call patients but see no Admin or Daily report links |
| F8 | Edit them: new password; log in with the old one, then the new one | Old refused, new accepted |
| F9 | Disable them while they are logged in, then have them press anything | "Account not found or disabled", and the page goes to the login screen (straight away, or at the next refresh within 15 seconds). Logging in says "This account is disabled" |
| F10 | Edit your own account | Role and "Account active" are locked. Saving your name works |

#### G. Security and roles

| ID | Do this | You should see |
|---|---|---|
| G1 | As receptionist, type `/staff/admin` in the address bar | Sent back to the staff page |
| G2 | In a terminal: `curl http://localhost:5050/api/admin/staff` | `401 Please log in` |
| G3 | Same with a receptionist's token: log in with `curl -X POST …/api/auth/login -H 'Content-Type: application/json' -d '{"phone":"0970000002","password":"clinic123"}'`, then `curl -H "Authorization: Bearer <token>" …/api/admin/staff` | `403 You do not have permission to do this` |
| G4 | Open the waiting-room screen and the public `/api/services/<id>/queue` | Ticket codes only. **No names or phone numbers** |
| G5 | Wrong password 11 times | After 10: "Too many login attempts. Try again in 15 minutes." |
| G6 | Change the end of a ticket link (`/t/abc…`) to random letters | "Ticket not found". Ticket links cannot be guessed from each other |

#### H. When things go wrong

| ID | Do this | You should see |
|---|---|---|
| H1 | Stop the backend (Ctrl+C), press a button on the staff page | "The server is not answering. Try again in a minute." No crash. (On the hosted site with the phone offline: "No connection to the server…") |
| H2 | Start the backend again; leave the patient page open | It catches up by itself within about 20 seconds |
| H3 | Turn the phone's Wi-Fi off for a minute while waiting, then on | The ticket page catches up (the slow poll works even if the live connection dropped) |
| H4 | Set `JWT_EXPIRES_IN=1m` in `backend/.env`, restart, log in, wait 2 minutes, press Next | "Your session has expired. Please log in again.", then the login page. Set it back to `12h` |

### Record sheet

Keep a copy of this table for your project report: it is your evidence that the system was tested.

| ID | Date | Device / browser | Result (pass / fail) | What happened if it failed | Fixed in commit |
|---|---|---|---|---|---|
| A1 | | | | | |
| … | | | | | |

---

## 3. Smoke test after every deploy

Run this against the **hosted** addresses (see `DEPLOYMENT.md`) every time you deploy. Use a test service or test patients, and cancel them afterwards.

1. `https://<your-api>.onrender.com/api/health` → `"status":"ok"` and `"database":"connected"`.
2. Open the Vercel address on your phone **using mobile data** (not the clinic Wi-Fi): the services list loads.
3. Take a number. Log in as staff on a laptop, call that number: the phone buzzes **within a second or two**. If it only updates after ~20 seconds, the live connection is not reaching the backend (check `VITE_SOCKET_URL`).
4. Open `/display`, tap once, call another patient: chime and spoken number.
5. Open the daily report and the admin page as admin.
6. Cancel the test tickets.

## Optional: how much load can it take?

Before a clinic relies on it, check that the free hosting copes with a busy morning:

```bash
npx autocannon -c 20 -d 30 https://<your-api>.onrender.com/api/services
```

This sends 20 users' worth of requests for 30 seconds. Look at the latency (`p99`) and errors. A waiting room of 50 phones polling every 20 seconds is about 3 requests per second, which the free tier handles easily. Do not run this against a clinic that is using the system.
