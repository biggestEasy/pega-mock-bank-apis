const express = require("express");
const morgan = require("morgan");
const jwt = require("jsonwebtoken");
const { applicants } = require("./data");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

// ---------------------------------------------------------------------------
// Configuration (env vars let the instructor rotate credentials per class,
// or run several isolated instances). Defaults are printed at startup.
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

// 10 API keys — one per junior/team — so the instructor can tell who's calling,
// revoke a single student's key without affecting the class, or hand out a
// fresh batch for the next cohort. Override with a comma-separated
// SEARCH_API_KEYS env var to use different values; otherwise these defaults apply.
const SEARCH_API_KEYS = (
  process.env.SEARCH_API_KEYS ||
  [
    "pega-team01-8f2c1a",
    "pega-team02-3d9e7b",
    "pega-team03-b1a4f6",
    "pega-team04-e6c2d9",
    "pega-team05-77af03",
    "pega-team06-c94b1e",
    "pega-team07-2a8d5c",
    "pega-team08-f03e91",
    "pega-team09-4b7c2a",
    "pega-team10-9e1f68",
  ].join(",")
)
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "pega-bank-client";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "pega-bank-secret";
const JWT_SECRET = process.env.JWT_SECRET || "training-jwt-signing-secret-change-me";
const TOKEN_TTL_SECONDS = parseInt(process.env.TOKEN_TTL_SECONDS || "3600", 10);

// ---------------------------------------------------------------------------
// Landing page — lists everything so students can sanity-check the base URL
// in a browser before they build the Pega connectors.
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    service: "Pega Training Mock Bank APIs",
    seededApplicantIds: Object.keys(applicants),
    endpoints: [
      {
        step: 1,
        name: "Applicant Search",
        method: "GET",
        path: "/applicants/v1/search?firstName=&lastName=&dateOfBirth=",
        auth: "API Key header (x-api-key)",
      },
      {
        step: 2,
        name: "OAuth2 Token",
        method: "POST",
        path: "/oauth/token",
        auth: "none (this IS the auth call)",
      },
      {
        step: 3,
        name: "Credit Bureau Score",
        method: "GET",
        path: "/credit-bureau/v1/creditscore/:ssn",
        auth: "OAuth2 Bearer token from /oauth/token",
      },
    ],
    docs: "See README.md in the delivered project for full request/response examples.",
  });
});

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// SERVICE 1 — Applicant Search — API Key — GET (query params)
// Maps to Pega "API Key" authentication profile on a Connect REST rule.
//
// Business role: the loan officer only has what the applicant said on the
// phone (name, maybe DOB) — no stable ID yet. This search resolves that into
// an applicantId + ssn, which step 3 (Credit Bureau) requires. A name-only
// search can legitimately return more than one match (see APP1002/APP1007
// and APP1006/APP1008 in data.js), so the case needs a "select the right
// match" step — same as a real MDM/CIF lookup would require.
// ---------------------------------------------------------------------------
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || !SEARCH_API_KEYS.includes(key)) {
    return res.status(401).json({ error: "unauthorized", message: "Missing or invalid x-api-key header" });
  }
  next();
}

app.get("/applicants/v1/search", requireApiKey, (req, res) => {
  const { firstName, lastName, dateOfBirth } = req.query;

  if (!firstName && !lastName) {
    return res.status(400).json({
      error: "bad_request",
      message: "Provide at least firstName or lastName to search",
    });
  }

  const norm = (s) => (s || "").trim().toLowerCase();

  const matches = Object.values(applicants).filter((a) => {
    if (firstName && norm(a.firstName) !== norm(firstName)) return false;
    if (lastName && norm(a.lastName) !== norm(lastName)) return false;
    if (dateOfBirth && a.dateOfBirth !== dateOfBirth) return false;
    return true;
  });

  res.json({
    query: { firstName: firstName || null, lastName: lastName || null, dateOfBirth: dateOfBirth || null },
    matchCount: matches.length,
    results: matches.map((a) => ({
      applicantId: a.applicantId,
      ssn: a.ssn,
      firstName: a.firstName,
      lastName: a.lastName,
      dateOfBirth: a.dateOfBirth,
      address: a.address,
      employmentStatus: a.employmentStatus,
      annualIncome: a.annualIncome,
    })),
  });
});

// ---------------------------------------------------------------------------
// SERVICE 2 — Credit Bureau — OAuth2 Client Credentials — POST /oauth/token, GET score
// Maps to Pega "OAuth 2.0" authentication profile, grant type Client Credentials.
// ---------------------------------------------------------------------------
app.post("/oauth/token", (req, res) => {
  const grantType = req.body.grant_type;
  const clientId = req.body.client_id || req.headers["x-client-id"];
  const clientSecret = req.body.client_secret || req.headers["x-client-secret"];

  if (grantType !== "client_credentials") {
    return res.status(400).json({ error: "unsupported_grant_type", message: "Use grant_type=client_credentials" });
  }
  if (clientId !== OAUTH_CLIENT_ID || clientSecret !== OAUTH_CLIENT_SECRET) {
    return res.status(401).json({ error: "invalid_client", message: "Invalid client_id or client_secret" });
  }

  const accessToken = jwt.sign({ client_id: clientId, scope: "creditscore.read" }, JWT_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
  });

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: "creditscore.read",
  });
});

function requireBearerToken(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "unauthorized", message: "Bearer token required. Call POST /oauth/token first." });
  }
  try {
    req.tokenPayload = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token", message: "Token is invalid or expired. Fetch a new one from /oauth/token." });
  }
}

app.get("/credit-bureau/v1/creditscore/:ssn", requireBearerToken, (req, res) => {
  const applicant = Object.values(applicants).find((a) => a.ssn === req.params.ssn);
  if (!applicant) {
    return res.status(404).json({ error: "not_found", message: `No credit record for SSN ${req.params.ssn}` });
  }
  res.json({
    ssn: applicant.ssn,
    applicantId: applicant.applicantId,
    creditScore: applicant.creditScore,
    riskBand: applicant.riskBand,
    bureau: "Pega Training Mock Bureau",
    scoreModel: "FICO-Mock-8",
    asOfDate: new Date().toISOString().slice(0, 10),
  });
});

// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.path}` });
});

app.listen(PORT, () => {
  console.log(`Pega Mock Bank APIs listening on port ${PORT}`);
  console.log(`API Keys (Applicant Search, ${SEARCH_API_KEYS.length} total): ${SEARCH_API_KEYS.join(", ")}`);
  console.log(`OAuth2 Client Credentials:  ${OAUTH_CLIENT_ID} / ${OAUTH_CLIENT_SECRET}`);
  console.log(`Seeded applicants: ${Object.keys(applicants).length}`);
});
