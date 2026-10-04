# Pega Training — Mock APIs

One Express app serving **two independent sets** of mock services, deployed as a
single Render web service (one cold start instead of several):

| Use case | Prefix | Language | Auth |
|---|---|---|---|
| **Large App Build** — loan origination | `/applicants/v1`, `/oauth/token`, `/credit-bureau/v1` | English | API Key + OAuth2 |
| **Pega AI Week** — Mobile Club Nord | `/mcn/mitglieder/v1`, `/mcn/karten/v1` | German | API Key (separate key set) |

They share a process and nothing else: separate data, separate API keys, separate
OpenAPI documents. `GET /` returns a JSON index of everything.

Run `npm test` after any change — the smoke test exercises every endpoint of both
use cases, including all documented test-data triggers.

---

# Part 1 — Mock Bank APIs (Large App Build)

Two chained REST services for a "loan application" training exercise. Juniors build
two Pega Connect REST rules (an Integration category, or two connectors in one flow)
that call these in sequence, each demonstrating a different Pega authentication
profile. Loan decisioning itself stays inside Pega (a Decision Table/Tree in the
case), driven by the credit score these services return — these mocks only supply
the external facts a bank would actually have to fetch from outside systems.

## The story

A loan officer starts a case with only what the applicant told them on the phone —
first name, last name, maybe date of birth. Pega does not yet have a stable
applicant/customer ID. So the case has to:

1. **Search** an external applicant/customer master (like a bank's CIF or MDM
   system) by name to resolve a stable `applicantId` + `ssn`. A name-only search can
   legitimately return more than one person — the case then needs a step to either
   auto-resolve (if only one match) or let the officer pick from a list / add DOB to
   narrow it down. This is a very common real-world integration pattern and a good
   teaching moment for handling a List-structured Data Page.
2. **Fetch the credit score** for that resolved applicant from a credit bureau,
   which — realistically — is a separately secured, higher-trust system requiring
   its own OAuth2 client credentials, not just an API key.
3. Pega's own case logic (Decision Table keyed on credit score + income + requested
   amount) then makes the Approve/Decline/Manual-Review call — no external service
   needed for that part, since it's the bank's own business policy, not a fact
   fetched from a third party.

| # | Service | Method | Path | Auth (Pega profile) |
|---|---------|--------|------|----------------------|
| 1 | Applicant Search | GET | `/applicants/v1/search?firstName=&lastName=&dateOfBirth=` | **API Key** header |
| 2 | OAuth2 Token | POST | `/oauth/token` | n/a — issues the token |
| 3 | Credit Bureau Score | GET | `/credit-bureau/v1/creditscore/{ssn}` | **OAuth 2.0 Client Credentials** (Bearer) |

## Seeded test applicants

**100 applicants** (`APP1001`–`APP1100`), generated deterministically by
`scripts/generate-data.js` — re-running it always produces the exact same data, so
it's safe to regenerate without breaking anything students have already tested. The
full list (name, DOB, SSN, credit score, income, etc.) is in
`applicants-reference.csv` — open it in Excel/Sheets to pick specific test cases or
hand rows out to individual students.

The first 10 applicants (`APP1001`–`APP1010`) are 5 deliberate name-collision pairs,
so searching by last name alone reliably returns multiple matches:
Jonas Berger, Anna Huber, Maria Novak, Tom Fischer, Lena Wolf. With 100 randomized
names on top of that, plenty of *other* incidental collisions show up too (e.g.
searching `lastName=Berger` alone currently returns 6 people) — a realistic touch
for teaching disambiguation. Add `dateOfBirth` to the query to narrow to one match.
Unknown names return an empty result (`matchCount: 0`), and an unknown SSN on the
credit score call returns a 404 — both good for teaching error handling.

Credit scores are generated with a loose correlation to income plus randomness
(unemployed applicants skew toward lower scores), clamped to a realistic 300–850
range, so the data behaves plausibly without being hand-crafted per row.

## Default credentials

10 API keys are seeded for Applicant Search — hand one to each junior or team so you
can tell who's calling, revoke a single one without affecting the class, or swap in a
fresh batch for the next cohort.

| Purpose | Value |
|---|---|
| API Key header (Applicant Search) | `x-api-key: pega-team01-8f2c1a` (through `pega-team10-9e1f68` — full list below) |
| OAuth2 client_id | `pega-bank-client` |
| OAuth2 client_secret | `pega-bank-secret` |

All 10 API keys:
```
pega-team01-8f2c1a   pega-team06-c94b1e
pega-team02-3d9e7b   pega-team07-2a8d5c
pega-team03-b1a4f6   pega-team08-f03e91
pega-team04-e6c2d9   pega-team09-4b7c2a
pega-team05-77af03   pega-team10-9e1f68
```

All of these are environment variables (see `render.yaml`) — change them before class
if you want each cohort/session to use its own credentials, or to rotate one team's
key mid-day as a "your API key just changed" exercise. Set `SEARCH_API_KEYS` as a
comma-separated list to override the defaults.

## 1. Applicant Search — GET, API Key, query params

```
GET /applicants/v1/search?lastName=Berger
x-api-key: pega-team01-8f2c1a
```
Returns `matchCount` and a `results` array. Add `&dateOfBirth=1992-02-03` (see
`applicants-reference.csv` for exact values) to narrow multiple matches down to one.
Each result includes `applicantId` and `ssn`, which step 3 needs.

At least one of `firstName` / `lastName` is required (400 if both are omitted).

## 2. Get an OAuth2 token — POST

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=pega-bank-client&client_secret=pega-bank-secret
```
Returns `{ access_token, token_type: "Bearer", expires_in }`. Tokens are signed JWTs
that expire after 3600s by default (`TOKEN_TTL_SECONDS`) — good for teaching token
refresh / caching in the OAuth2 profile.

## 3. Credit Bureau Score — GET, Bearer token

```
GET /credit-bureau/v1/creditscore/111-22-1002
Authorization: Bearer <access_token from step 2>
```
Returns `creditScore` and `riskBand` for the `ssn` resolved in step 1. This is the
value that feeds Pega's own Decision Table for the loan approval logic.

---

# Part 2 — Mobile Club Nord (Pega AI Week)

Two services for the German membership use case. The club digitises the path from
a sales conversation to an active membership; these mocks supply the two things
Pega cannot invent for itself — the **Mitgliedsnummer** from the system of record,
and the **status of a card order** that progresses outside Pega.

| # | Service | Method | Path | Auth |
|---|---------|--------|------|------|
| 1 | Dublettensuche | POST | `/mcn/mitglieder/v1/mitglieder/suche` | **API Key** (`x-api-key`) |
| 2 | Mitgliedschaft anlegen | POST | `/mcn/mitglieder/v1/mitglieder` | **API Key** |
| 3 | Mitgliedschaft lesen | GET | `/mcn/mitglieder/v1/mitglieder/{nr}` | **API Key** |
| 4 | Kartenauftrag anlegen | POST | `/mcn/karten/v1/kartenauftraege` | **API Key** |
| 5 | Kartenstatus | GET | `/mcn/karten/v1/kartenauftraege/{nr}` | **API Key** |
| 6 | Kartenauftrag stornieren | POST | `/mcn/karten/v1/kartenauftraege/{nr}/stornierung` | **API Key** |

MCN uses its **own** 10 API keys (`MCN_API_KEYS`), separate from the bank keys, so
the two cohorts can be managed and revoked independently:

```
mcn-team01-4ab19c   mcn-team06-5c6a13
mcn-team02-7fe30d   mcn-team07-e4719b
mcn-team03-c25b84   mcn-team08-20fd58
mcn-team04-19da6f   mcn-team09-96c3e7
mcn-team05-b8027e   mcn-team10-d781f2
```

## OpenAPI — point the integration wizard at these

```
GET /mcn/mitglieder/v1/openapi.json
GET /mcn/karten/v1/openapi.json
```

Both are served **without** an API key on purpose: trainees paste these URLs into
Pega's REST integration wizard (or hand them to an AI assistant) to generate the
connector, and that fetch carries no credentials. Generating the connector from
the spec and then checking every mapping by hand is part of the AI Week exercise.

## Everything is deterministic

The same input always produces the same answer. That is not convenience — it is
what makes the trainees' Cucumber scenarios reproducible, which is a Friday
deliverable. The triggers are chosen so a scenario can request a specific
outcome just by picking a surname or a member number.

### Bestandssystem triggers

| Input | Behaviour |
|---|---|
| Nachname `Dublettski` | `409 DUBLETTE` with `bestehendeMitgliedsnummer: MCN-2023-000001` |
| Nachname `Systemfehler` | `503 SYSTEM_NICHT_ERREICHBAR` |
| Nachname `Langsam` | responds only after 25 s (`MCN_SLOW_RESPONSE_MS`) — for connector timeouts |
| Zahlungsart `SEPA` without `iban` | `400 IBAN_FEHLT` |
| anything else | `201` with a freshly derived Mitgliedsnummer |

### Kartenproduktion triggers

| Input | Behaviour |
|---|---|
| Mitgliedsnummer ends `99` | order stays in `IN_PRODUKTION` forever — for the SLA/escalation criterion in US 8 |
| Mitgliedsnummer ends `98` | `POST` returns `503 PRODUKTION_NICHT_ERREICHBAR` |
| Tarif `Plus` | extra `PERSONALISIERUNG` stage before `VERSENDET` |
| anything else | one status step every `MCN_CARD_STEP_SECONDS` (default 60) |

Status sequence: `ANGENOMMEN → IN_PRODUKTION → [PERSONALISIERUNG] → VERSENDET → ZUGESTELLT`.
A `sendungsnummer` appears from `VERSENDET` onwards.

## Idempotency — the lesson US 4 and US 7 are built around

`POST /mcn/mitglieder/v1/mitglieder` honours an `Idempotency-Key` header:

- **With** the key, a repeated call returns `200` and the **same** Mitgliedsnummer,
  with `"idempotent": true`, and creates nothing.
- **Without** it, a repeated call for the same person returns `409 DUBLETTE` —
  because the first call already created them.

That contrast is the point. Recommend trainees use the Pega case ID as the key.

## Seeded members

**66 members**, generated by `scripts/generate-mcn-data.js` (deterministic — safe
to re-run). Full list in `mcn-mitglieder-reference.csv`. Six fixed records that
the user stories depend on and that must stay stable:

| Mitgliedsnummer | Name | Purpose |
|---|---|---|
| `MCN-2023-000001` | Dirk Dublettski | the duplicate the `Dublettski` trigger points at |
| `MCN-2022-000002` | Greta Beendet | cancelled membership — US 10 (Pannenmeldung without valid membership) |
| `MCN-2021-000003` | Ruth Ruhend | dormant after payment failure — US 15 |
| `MCN-2024-000004` | Famke Familjen | family membership with three members — US 5, US 13 |
| `MCN-2025-000099` | Karl Kartenstau | card order never leaves `IN_PRODUKTION` — US 8 |
| `MCN-2025-000098` | Sven Störfall | card order creation always fails — US 8 |

Plus deliberate name collisions (Anna Petersen ×2, Lars Jansen ×2) so the
duplicate search returns medium-confidence matches worth disambiguating.
Beiträge follow US 2: ages 18–27 pay Basis 8 € / Plus 12 €, 28+ pay Basis 12 € /
Plus 18 €, children 0 €.

## Why the card service is stateless

The Auftragsnummer encodes creation time, tariff and the member-number suffix
(`KA-2026-M8X2K9-P12`), so the status is a pure function of the order number and
the clock. Render's free tier destroys the container after ~15 minutes idle — with
an in-memory store, every order created before a lunch break would 404 afterwards,
which is exactly the kind of thing that derails a demo. This way it keeps working.

Two things *are* in-memory and are lost on restart: **cancellations** and
**members created during the session**. The seeded members always exist, so build
exercises around those where you need something stable. A created member's number
is derived from surname + date of birth, so recreating the same person after a
restart yields the same number — tests stay reproducible either way.

---

## Running locally

```
npm install
npm start
npm test      # smoke test: every endpoint of both use cases
```
Server listens on `PORT` (default `3000`). Visit `http://localhost:3000/` for a
JSON index of every endpoint.

Regenerate seed data (both are deterministic, so this is always safe):
```
npm run generate:bank    # data.js + applicants-reference.csv
npm run generate:mcn     # data-mcn.js + mcn-mitglieder-reference.csv
```

## Deploying so it's reachable all day (Render, free tier, ~5 minutes)

1. Push this folder to a new GitHub repo (private is fine).
2. Go to https://render.com → sign up / log in (free, no credit card needed for the
   free web service tier) → **New +** → **Blueprint**.
3. Connect the GitHub repo. Render will detect `render.yaml` in this project and
   pre-fill one web service with the credentials above as environment variables.
4. Click **Apply**. First deploy takes 1-2 minutes. You'll get a public URL like
   `https://pega-mock-bank-apis.onrender.com`.
5. Give that base URL to the class — that's what goes into the Pega Connect REST
   "Service URL" field.

Notes for the training day:
- Free Render web services spin down after ~15 minutes of no traffic and take a few
  seconds to wake back up on the next request — the first call of the morning (or
  after a break) may be slow. If you want zero cold-start delay, upgrade that one
  service to the $7/mo Starter plan for the day, or ping the health endpoint
  (`GET /health`) every 10 minutes with a free uptime monitor (e.g. UptimeRobot) to
  keep it warm.
- To change credentials mid-class (e.g. simulate a rotated API key), edit the
  environment variables in the Render dashboard and redeploy — no code changes needed.
- Railway (railway.app) works the same way if you prefer it — create a project,
  deploy from GitHub, and set the same environment variables from `render.yaml`
  manually (Railway doesn't read `render.yaml`).

## Testing

**Smoke test** — `npm test` starts the app on an ephemeral port and exercises
every endpoint of both use cases, including all triggers and the idempotency
behaviour. Run it after any change; it is the fastest way to confirm a refactor
did not break URLs a cohort has already configured.

**Postman** — `pega-mock-bank-apis.postman_collection.json` is organised into four
folders: the bank APIs, MCN Bestandssystem, MCN Kartenproduktion, and the OpenAPI
documents. Import it and set `baseUrl` to your deployed URL.

- Bank: run 1a/1b → 2 → 3 in order (request 2 auto-saves the token into `accessToken`).
- MCN: run Bestandssystem 3 → 4 to see idempotency, then 5 and 6 for the error
  paths. Request 3 saves the new number into `mitgliedsnummer`; Kartenproduktion
  request 1 saves `auftragsnummer`, then re-send request 2 every minute to watch
  the status advance.

You can also just use `curl` — see the request examples above.
