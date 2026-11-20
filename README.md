# CivicLens

**Smarter Cities. Faster Action. Better Communities.**

CivicLens is an agentic, AI-powered civic issue platform for Tier 2 and Tier 3 cities in India. A citizen uploads a photo of a pothole, garbage pile, broken streetlight, leak or open drain. Two Google Gemini agents then analyse it, check the database for duplicate complaints, assign a priority and recommend a department. Every decision is explained, logged and shown on a live map and admin dashboard.

> CivicLens **recommends**. It is not connected to any government system and never claims that a department has been notified or has acted.

---

## Contents
1. [Quick start](#1-quick-start)
2. [Connect your Google Gemini API key](#2-connect-your-google-gemini-api-key)
3. [How the agents work](#3-how-the-agents-work)
4. [Pages](#4-pages)
5. [Project structure](#5-project-structure)
6. [Real data only](#6-real-data-only)
7. [Testing](#7-testing)
8. [Security](#8-security)
9. [Configuration reference](#9-configuration-reference)
10. [Deployment (standard Node.js hosting)](#10-deployment-standard-nodejs-hosting)
11. [Contact messages](#11-contact-messages)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Quick start

**Requirements:** Node.js **22.13 or newer** (the database uses Node's built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm run install:all     # installs root, server and client dependencies
npm run dev             # starts API on :4000 and the React app on :5173
```

Open **http://localhost:5173**.

The app runs without any API key. Until you add one, it runs in a clearly labelled **development mode** (see the next section). There is **no sample or static data**: the map, dashboard and home-page figures start empty and fill up only from real submissions.

| Command | What it does |
|---|---|
| `npm run dev` | API (auto-restart) + Vite dev server with hot reload |
| `npm run build` | Production build of the React app → `client/dist` |
| `npm start` | Production server: API **and** the built frontend on one port (default 4000) |
| `npm test` | Backend test suite (Vitest + Supertest) |
| `npm run test:report` | Runs tests and writes `docs/TEST_REPORT.md` |
| `npm run test:e2e` | Playwright browser tests (needs `npx playwright install chromium` once) |
| `npm run smoke:gemini` | Live end-to-end test against the real Gemini API (only runs with your key) |

## 2. Connect your Google Gemini API key

CivicLens uses **only** Google Gemini, through the official `@google/genai` SDK. The key lives on the backend only and is never sent to the browser.

1. Go to **https://aistudio.google.com/apikey** and sign in with **your own** Google account.
2. Click **Create API key** and copy it.
3. In the project root, copy the example environment file:
   ```bash
   cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
   ```
4. Open `.env` and set:
   ```env
   GEMINI_API_KEY=your-key-here
   GEMINI_MODEL=gemini-3.8-flash   # any Gemini model with image input + function calling
   ```
5. Restart `npm run dev`. The yellow "Development mode" banner disappears, the header shows **Gemini live**, and the server logs `AI provider: Google Gemini API`.
6. Optional: confirm it works end to end:
   ```bash
   npm run smoke:gemini                                   # synthetic test image
   npm run smoke:gemini -- path/to/pothole.jpg "Pothole near school"
   ```

`AI_MODE` controls the switch: `auto` (the default) uses Gemini when a key is present. `gemini` always uses Gemini and fails loudly if the key is missing. `development` always uses sample responses.

### What "development mode" means
Without a key, a deterministic stand-in model (`server/src/ai/devModel.js`) speaks the same function-calling protocol as Gemini. The real agent loops, database tools, validation, orchestration and logging all still run. Its "reasoning" is a transparent keyword heuristic over the citizen's description, and it **does not look at the photo**. Every output is prefixed `[Development mode]`, each run is stored with `ai_mode = development`, and the UI labels it everywhere. It never claims to be Gemini.

## 3. How the agents work

```
Citizen submits photo + description + location
        │
        ▼
 ┌──────────────── Orchestrator (server/src/ai/orchestrator.js) ────────────────┐
 │ workflow_started → handoff                                                   │
 │   ┌───────────── Agent 1 · Civic Issue Intelligence ──────────────┐          │
 │   │ Gemini vision: category, description, severity, confidence,    │          │
 │   │ image quality (clear / unclear / irrelevant)                  │          │
 │   │ tool search_nearby_reports → real SQL + haversine distances   │          │
 │   │ tool compare_candidates   → distance, image dHash, text sim   │          │
 │   │ submit_findings (schema-validated)                            │          │
 │   └────────────────────────────────────────────────────────────────┘          │
 │ validate: discard duplicate claims not returned by the DB; persist links     │
 │ handoff with evidence                                                        │
 │   ┌───────────── Agent 2 · Civic Action & Prioritisation ─────────┐          │
 │   │ tool get_priority_policy (required) · get_department_directory │          │
 │   │ tool get_area_backlog → open reports nearby (SQL)              │          │
 │   │ submit_assessment: priority, department, action, explanation,  │          │
 │   │ safety risk, human-review flags (schema-validated)             │          │
 │   └────────────────────────────────────────────────────────────────┘          │
 │ guardrails → final_decision → store → dashboard & map update                 │
 └──────────────────────────────────────────────────────────────────────────────┘
```

Key design points:
- **Real function calling.** Each agent runs a Gemini tool loop (`server/src/ai/agentRunner.js`) with `functionCallingConfig: ANY`. The backend executes each tool and sends the result back to the model. Each agent finishes by calling a "submit" function whose arguments are validated with Zod. If the arguments are invalid, they go back to the model so it can correct itself (up to 3 attempts).
- **No invented facts.** Coordinates are fixed by the backend, and distances and similarity scores are computed in code. Any duplicate the model claims that the database didn't return is discarded and logged.
- **Guardrails.** Not a civic issue → priority forced to Low. Critical severity → at least High. Unclear image, low confidence, a Critical priority, a contradiction or a possible duplicate → human review.
- **Model fallback.** If the primary Gemini model is overloaded (503/429) or times out, the client switches to `GEMINI_FALLBACK_MODELS`, logs a `model_fallback` step, records the model actually used on the run, and tries the primary again after 10 minutes.
- **Resilience.** HTTP retries with exponential backoff for 429/5xx/timeouts, plus one whole-agent retry. If Agent 1 fails, the report is still saved and queued for manual review. If Agent 2 fails, Agent 1's results are kept, a rule-based department is suggested and priority is left for a human (`partial` run).
- **Transparency.** Every model turn, tool call, tool result, handoff, validation and decision is stored in `agent_steps` with a timestamp and shown on the Agent Activity page.

## 4. Pages: citizen portal and admin portal
It's one website with two areas. The header menu shows them separately.

**Citizen portal** (anyone): Home, Report Issue, Issue Map, Contact, and public issue detail pages.
**Admin portal** (municipal staff): Dashboard, Agent Activity, Messages, and the admin actions on an issue page (change status, add notes, review flag, approve or reject duplicates, re-run agents). Admin pages show a dark "Admin portal" banner. Set `ADMIN_TOKEN` in `.env` to require a login; without it, admin pages are open (development only) and the banner warns you.

| Route | Page |
|---|---|
| `/` | Landing page: hero, how it works, the two agents, features, benefits |
| `/report` | Upload a photo, describe it, use browser geolocation or pick on the map, then watch the agents live and see the results |
| `/map` | Leaflet + OpenStreetMap, priority-coloured clustered markers, category/priority/status/data-source filters, search, duplicate-group lines |
| `/dashboard` | **Admin.** KPIs, charts (category, priority, area, 30-day trend), human-review queue, duplicate approval, recent reports, agent activity |
| `/reports/:id` | Issue details: photo, AI analysis, duplicate evidence, status history, admin actions (status, notes, review flag, duplicates, re-run agents) |
| `/agents` | **Admin.** Agent Activity: three-lane workflow view and full execution log for every run |
| `/contact` | Contact form. Messages go to the admin **Messages** inbox |
| `/messages` | **Admin.** Messages inbox: read, mark read or unread, reply, delete |

## 5. Project structure
```
CivicLens/
├── client/                    React 19 + Vite + Tailwind 4
│   └── src/
│       ├── pages/             Landing, ReportIssue, MapPage, Dashboard, ReportDetail, AgentActivity, Contact, Messages
│       ├── components/        Layout, AgentWorkflow, AnalysisPanel, ClusterLayer, LocationPicker, AdminGate, ui
│       └── lib/               api (axios), constants, leaflet helpers, AppContext
├── server/                    Express 5 + node:sqlite
│   ├── src/
│   │   ├── ai/                modelClient (Gemini + retries), agentRunner, schemas, devModel,
│   │   │   ├── agents/        issueIntelligenceAgent.js, actionPrioritisationAgent.js
│   │   │   └── orchestrator.js
│   │   ├── config/            env config, domain vocabulary & priority policy
│   │   ├── controllers/ routes/ middleware/ models/ services/
│   │   └── db/                schema and connection
│   ├── tests/                 Vitest + Supertest scenarios
│   └── scripts/               test report builder, Gemini smoke test
├── e2e/                       Playwright browser tests
├── docs/TEST_REPORT.md        Generated scenario report
└── .env.example
```

**Database tables:** `reports`, `report_images`, `duplicate_links`, `agent_runs`, `agent_steps` (execution records), `agent_results` (structured analysis outputs), `status_history`, `admin_notes`, `contact_messages`. All are indexed on their lookup columns.

## 6. Real data only
- Every number on the site (home-page live figures, map markers, dashboard KPIs and charts, agent statistics) is calculated from reports that citizens actually submitted.
- No sample, seeded or hardcoded records exist. Maps frame themselves around real reports, or show all of India when there are none.
- **Area names** for new reports come from OpenStreetMap Nominatim reverse geocoding (free, rate-limited to 1 request per second, cached).
- **No government integration** is simulated.

## 7. Testing
```bash
npm test               # 36 backend tests (21 numbered scenarios + supporting unit/security tests)
npm run test:report    # also writes docs/TEST_REPORT.md (ID, scenario, input, expected, actual, pass/fail)
npm run test:e2e       # 7 Playwright tests on an isolated production build (port 4400, throwaway DB)
```
Automated tests use **mocked Gemini function-call responses** at the model-client boundary. The orchestrator, agent loops, tools, SQLite and validation all run unmodified. The live Gemini check (`npm run smoke:gemini`) is separate and runs only with your own key.

Scenarios covered: pothole, garbage and streetlight identification · non-civic image · unclear image → review · duplicate inside the radius · similar issue outside the radius · invented duplicate discarded · high-risk pothole · critical safety issue and guardrail · department routing · missing location · invalid images (fake, wrong type, too large, missing) · successful submission · Gemini API failure and recovery · admin status update and auth · duplicate approval and rejection · orchestration failure (invalid output, early submit) · contact form validation and admin inbox.

## 8. Security
- `GEMINI_API_KEY` and `ADMIN_TOKEN` are read only by the server. `.env` is git-ignored, and `/api/config` exposes only non-secret flags (there's a test for this).
- **Images:** checked by magic bytes (not the client's MIME type), decoded with sharp, size-capped (`MAX_UPLOAD_MB`), re-encoded to JPEG with **all metadata stripped** (including GPS EXIF), and saved under random server-generated names.
- **Input validation** with Zod on every endpoint. Text is sanitised (control characters and HTML tags removed), and React escapes all output.
- **Rate limiting:** global, reports (20 per 15 min) and contact form (5 per 15 min) per IP.
- **Helmet** security headers with a strict CSP (self, OpenStreetMap tiles, Google Fonts).
- **CORS** is applied to `/api` only: same-origin is always allowed, and other origins must be listed in `CORS_ORIGINS`.
- **Admin endpoints** require `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time. In production they are **disabled** until `ADMIN_TOKEN` is set.
- Errors return generic messages, with no stack traces or SQL. Uncertain AI decisions are routed to human review.

## 9. Configuration reference
Everything is documented in [`.env.example`](.env.example). The values you'll most likely change:

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | – | Your Gemini key (backend only) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model used by both agents |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.5-flash-lite` | Backups used automatically if the primary is overloaded or times out (empty = off) |
| `AI_MODE` | `auto` | `auto` / `gemini` / `development` |
| `ADMIN_TOKEN` | – | Required in production for admin features |
| `PORT` | `4000` | Server port |
| `CORS_ORIGINS` | Vite dev origins | Extra allowed browser origins |
| `DATABASE_PATH` / `UPLOAD_DIR` | `server/data/…` | Persistent storage locations |
| `DUPLICATE_RADIUS_METERS` | `75` | Suggested duplicate search radius |
| `REVIEW_CONFIDENCE_THRESHOLD` | `0.6` | Below this, a report goes to human review |

## 10. Deployment (standard Node.js hosting)
CivicLens is a single Node process that serves the API and the built React app. It works on any VPS (DigitalOcean, Lightsail, Hetzner, an Indian cloud provider) or a Node host with a **persistent disk**.

> Nothing has been deployed or purchased. These steps are for when you're ready.

```bash
# on the server (Node 22.13+)
git clone <your-repo> civiclens && cd civiclens
npm run install:all
cp .env.example .env    # set NODE_ENV=production, GEMINI_API_KEY, ADMIN_TOKEN, CORS_ORIGINS=https://your-domain
npm run build
npm start               # or: npx pm2 start "npm start" --name civiclens && npx pm2 save
```

- **Persistence:** keep `server/data/` (the SQLite database and uploads) on a persistent volume, or point `DATABASE_PATH` and `UPLOAD_DIR` at one. Back it up regularly (copy `civiclens.db` while the app is stopped, or use `sqlite3 .backup`).
- **Domain:** create an `A` record for `civiclens.yourcity.in` pointing at the server's IP.
- **HTTPS:** put Nginx or Caddy in front.
  - Caddy (automatic Let's Encrypt): `civiclens.yourcity.in { reverse_proxy localhost:4000 }`
  - Nginx: `proxy_pass http://localhost:4000;` with `client_max_body_size 10m;`, then `sudo certbot --nginx -d civiclens.yourcity.in`.
  - Set `TRUST_PROXY=true` behind a proxy so rate limiting sees real client IPs.
- **Scaling note:** SQLite suits a single instance. To run several instances, move to PostgreSQL and object storage for images.

## 11. Contact messages
Messages from the public **Contact** page are saved in the database (`contact_messages` table) and shown in the admin portal under **Messages** (`/messages`), protected by `ADMIN_TOKEN`. Admins can read them, mark them read or unread, reply via their own email app (a `mailto:` link) and delete them. The dashboard shows the unread count. No email is sent and no SMTP setup is needed.

## 12. Troubleshooting
- **"Cannot reach the CivicLens server"**: the API isn't running on port 4000. Run `npm run dev` from the project root.
- **Gemini 503 "high demand" or timeouts:** a temporary Google capacity issue. The fallback model handles it automatically; you can also point `GEMINI_MODEL` at a less busy model.
- **Gemini errors (400 / 403):** check the key and that `GEMINI_MODEL` is available to your account. The run is marked failed and the report goes to manual review; nothing is lost.
- **Windows "Application Control policy has blocked this file"**: CivicLens deliberately uses Node's built-in `node:sqlite` instead of a native SQLite addon, so this policy doesn't affect it.
- **Location button does nothing:** browsers allow geolocation only on `https://` or `localhost`. Users can always tap the map instead.
