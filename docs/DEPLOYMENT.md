# Deploying Clinic Queue

Three free services, one for each part:

```
 patients' phones, staff laptops, the waiting-room TV
                      │
                      ▼
   Vercel  ── frontend (React)        https://clinic-queue.vercel.app
                      │  API calls + live updates (Socket.io)
                      ▼
   Render  ── backend (Node/Express)  https://clinic-queue-api.onrender.com
                      │
                      ▼
   MongoDB Atlas ── the database
```

Deploy them **in this order**: database, then backend, then frontend, then tell the backend the frontend's address. Each step needs an address from the step before.

Before you start: everything is pushed to GitHub, CI is green on `main`, and `npm test` passes on your laptop.

---

## Step 1. Database: MongoDB Atlas

1. Sign in at <https://cloud.mongodb.com> → **Create** a cluster → **M0 (free)**. Pick a region close to Render's (Frankfurt, `eu-central-1`, is a good choice for Zambia: Render offers Frankfurt too).
2. **Database Access** → Add user, e.g. `clinicqueue`, with an auto-generated password. Role: *Read and write to any database* (or, stricter, `readWrite` on `clinicqueue` only). Copy the password now.
3. **Network Access** → Add IP address → **0.0.0.0/0** (allow from anywhere). Render's free instances do not have a fixed IP address, so you cannot list it. The username and password protect the database.
4. **Connect** → Drivers → copy the connection string and put the database name before the `?`:

   ```
   mongodb+srv://clinicqueue:<password>@cluster0.abcde.mongodb.net/clinicqueue?retryWrites=true&w=majority
   ```

   If the password contains `@ : / ? #`, either generate one without them or URL-encode them (`@` → `%40`).

This is your **production** `MONGODB_URI`. Keep it out of GitHub.

## Step 2. Backend: Render

1. Sign in at <https://render.com> with GitHub → **New** → **Web Service** → choose the `clinic-queue` repository.
2. Settings:

   | Setting | Value |
   |---|---|
   | Name | `clinic-queue-api` (becomes `clinic-queue-api.onrender.com`) |
   | Region | Frankfurt (same as Atlas) |
   | Branch | `main` |
   | Root directory | `backend` |
   | Runtime | Node |
   | Build command | `npm ci` |
   | Start command | `npm start` |
   | Instance type | Free (see "Before a real clinic uses it" below) |
   | Health check path (Advanced) | `/api/health` |

3. **Environment variables:**

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `MONGODB_URI` | the connection string from step 1 |
   | `JWT_SECRET` | a long random string: run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste the result. **Not** the one from your laptop's `.env` |
   | `JWT_EXPIRES_IN` | `12h` (staff log in once per shift) |
   | `FRONTEND_URL` | leave empty for now; you fill it in at step 4 |
   | `SMS_PROVIDER` | `console` for now (see step 6) |

   Do not set `PORT`: Render provides it.

4. **Create Web Service.** Watch the log until you see `MongoDB connected` and `Clinic Queue API on …`.
5. Open `https://clinic-queue-api.onrender.com/api/health`. You want `"status":"ok"` and `"database":"connected"`.

If the log says *MongoDB connection failed*, check Atlas Network Access (step 1.3) and the password in `MONGODB_URI`.

## Step 3. Frontend: Vercel

1. Sign in at <https://vercel.com> with GitHub → **Add New** → **Project** → import `clinic-queue`.
2. Settings:

   | Setting | Value |
   |---|---|
   | Root directory | `frontend` |
   | Framework preset | Vite (detected) |
   | Build command / output | leave the defaults (`npm run build`, `dist`) |

3. **Environment variables** (both point to your Render address):

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://clinic-queue-api.onrender.com/api` |
   | `VITE_SOCKET_URL` | `https://clinic-queue-api.onrender.com` |

   `VITE_` variables are copied into the JavaScript **when it is built**. After changing them you must **redeploy** (Deployments → ⋯ → Redeploy). Saving them alone changes nothing.

4. **Deploy.** Note the address, e.g. `https://clinic-queue.vercel.app`.

`frontend/vercel.json` sends every page address (`/staff`, `/t/abc…`) to `index.html`, so refreshing any page works.

## Step 4. Let the frontend talk to the backend (CORS)

The backend only answers browsers on addresses it knows. On Render → your service → **Environment**:

```
FRONTEND_URL = https://clinic-queue.vercel.app
```

Exactly the address in the browser bar: `https://`, no trailing `/`. For more than one address (for example a custom domain too), separate them with commas. **Save, rebuild and deploy.**

Signs this is wrong: the site loads but every list says *"No connection to the server"*, and the browser console (F12) shows a **CORS** error.

## Step 5. First data, and lock down the demo accounts

The production database is empty. Load the services and the three demo staff accounts **once**, from your laptop:

```bash
cd backend
# macOS / Linux / Git Bash:
MONGODB_URI="<production connection string>" npm run seed
# Windows PowerShell:
$env:MONGODB_URI="<production connection string>"; npm run seed
```

Note: **no `--patients`**. That option deletes today's tickets and adds fake patients.

Then, straight away (the demo password `clinic123` is printed in the README for anyone to read):

1. Log in at `https://clinic-queue.vercel.app/staff/login` as `0970000001` / `clinic123`.
2. **Admin** → **Add a staff member**: yourself, role **Admin**, your real phone number and a strong password.
3. Log out, log in as **yourself**.
4. Disable the three demo accounts (Edit → untick *Account active*), or give them real names, phone numbers and new passwords.
5. Add the real staff, and set the services, rooms and minutes per patient to match the clinic.

> **Never run `npm run seed` against production again.** It resets the demo accounts' passwords to `clinic123` and overwrites the A, P and L services with the demo settings. Use the Admin page from now on.

## Step 6. Real SMS (optional)

With `SMS_PROVIDER=console` the "you are nearly up" messages only appear in Render's log. To send real ones through Africa's Talking (works on MTN, Airtel and Zamtel):

| Name | Value |
|---|---|
| `SMS_PROVIDER` | `africastalking` |
| `AT_USERNAME` | your Africa's Talking username (`sandbox` to test without sending real messages) |
| `AT_API_KEY` | the API key from your Africa's Talking dashboard |
| `AT_SENDER_ID` | optional: an approved sender name |

`/api/health` shows whether SMS is configured. Each message costs money, so watch your balance during the first week.

## Step 7. Run the smoke test

Follow **"Smoke test after every deploy"** in [`TESTING.md`](TESTING.md). Do it on a phone **on mobile data**, so you know it works from outside your own network.

## Step 8. Setting up at the clinic

- **Waiting-room screen:** on the TV's browser or an old laptop, open `https://clinic-queue.vercel.app/display`, tap the screen once (to allow sound), and make it full screen (F11). Keep the device plugged in and stop it from sleeping.
- **QR code:** the screen shows a QR code for joining. Print one large copy for the entrance and the waiting area. Open `/display` from the **hosted** address before printing, so the code points there and not at your laptop.
- **Staff devices:** each room's laptop or phone logs in at `/staff`, chooses its service and room once (remembered), and stays logged in for the shift (12 hours).

---

## Updating the live system

Push to `main` (or merge a pull request). Render and Vercel both deploy it automatically; CI runs the tests on the same push. Afterwards, run the smoke test.

- **Change a setting:** Render → Environment (redeploys the backend); Vercel → Settings → Environment Variables, then Redeploy.
- **Something broke after a deploy:** Render → **Events** → roll back to the previous deploy; Vercel → **Deployments** → the previous one → **Promote to Production**. Then fix the problem on a branch.
- **Logs:** Render → **Logs** (errors, and SMS when using the console provider). Atlas → **Metrics** for the database.

## Before a real clinic uses it

These are fine for a demo or a project defence, but matter for a real clinic:

| Issue | Why it matters | What to do |
|---|---|---|
| **Render's free instance sleeps** after 15 minutes without requests, and the next request takes about a minute to wake it | The first patient of the morning waits, and live updates drop while it sleeps | Use a paid instance (Starter) for a clinic. For a demo, open `/api/health` a minute before you start |
| **Rate limits count per IP address** (20 joins per 10 minutes, 10 logins per 15 minutes) | On clinic Wi-Fi every phone shares one public address, so a busy morning can hit "Too many tickets from this device" | Raise the limits in `backend/middleware/rateLimiter.js`, or count per device instead of per IP, before going live |
| **Atlas free tier has no automatic backups** | A mistake or an outage loses the records | Back up weekly: `mongodump --uri "<production uri>" --out backup-2026-10-22` (MongoDB Database Tools), or use a paid cluster with backups |
| **Demo password in the README** | Anyone can try `clinic123` | Done in step 5: disable or change the demo accounts |
| **Secrets** | A leaked `JWT_SECRET` lets anyone make staff tokens | Keep secrets only in Render's environment. `.env` is in `.gitignore`: keep it that way. If one leaks, change it on Render (this logs everyone out) |

## Problems and fixes

| Problem | Likely cause | Fix |
|---|---|---|
| `/api/health` does not load, or Render shows "Deploy failed" | Build or start error | Render → Logs. Usually a missing `MONGODB_URI` / `JWT_SECRET` ("Set MONGODB_URI and JWT_SECRET…") |
| Health says `"database":"not connected"` | Atlas refuses Render | Atlas → Network Access → 0.0.0.0/0; check the password in the URI |
| Site loads, everything says "No connection to the server" | CORS, or the wrong API address |
| "The server is not answering. Try again in a minute." | Render is deploying, restarting or waking up | Wait a minute; if it lasts, check Render → Logs | `FRONTEND_URL` on Render matches the Vercel address exactly; `VITE_API_URL` ends in `/api`; Vercel redeployed after changing it |
| Works, but screens only update every ~20 seconds | Live connection not reaching the backend | `VITE_SOCKET_URL` is the Render address **without** `/api`; redeploy Vercel |
| Refreshing `/staff` shows Vercel's 404 page | Root directory wrong, so `vercel.json` is not used | Vercel → Settings → Root Directory = `frontend` |
| Logged out of the staff page every time the backend restarts | `JWT_SECRET` changes between deploys | Set it once on Render; never generate it in code |
| First request of the day takes ~1 minute | Free instance waking up | Expected on the free tier (see the table above) |
