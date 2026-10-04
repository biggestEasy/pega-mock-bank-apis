// ---------------------------------------------------------------------------
// Pega Training Mock APIs
//
// One Express app serving two independent sets of mock services:
//
//   1. Mock Bank APIs      — Large App Build (loan origination, English)
//      /applicants/v1, /oauth/token, /credit-bureau/v1
//
//   2. Mobile Club Nord    — Pega AI Week (membership + card, German)
//      /mcn/mitglieder/v1, /mcn/karten/v1
//
// They share a process (one Render free-tier instance = one cold start instead
// of three) but nothing else: separate data, separate API key sets, separate
// OpenAPI documents.
// ---------------------------------------------------------------------------

const express = require("express");
const morgan = require("morgan");

const bank = require("./routes/bank");
const mcnMitglieder = require("./routes/mcn-mitglieder");
const mcnKarten = require("./routes/mcn-karten");
const { loadKeys, apiKeyGuard } = require("./lib/auth");
const { applicants } = require("./data");
const { mitglieder } = require("./data-mcn");
const openapiMitglieder = require("./openapi/mcn-mitglieder.json");
const openapiKarten = require("./openapi/mcn-karten.json");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("tiny"));

const PORT = process.env.PORT || 3000;

// Mobile Club Nord keys are a SEPARATE set from the bank keys, so the AI Week
// cohort and the LAB cohort can be managed (and revoked) independently.
const MCN_API_KEYS = loadKeys("MCN_API_KEYS", [
  "mcn-team01-4ab19c",
  "mcn-team02-7fe30d",
  "mcn-team03-c25b84",
  "mcn-team04-19da6f",
  "mcn-team05-b8027e",
  "mcn-team06-5c6a13",
  "mcn-team07-e4719b",
  "mcn-team08-20fd58",
  "mcn-team09-96c3e7",
  "mcn-team10-d781f2",
]);

// ---------------------------------------------------------------------------
// Landing page — lets trainees sanity-check the base URL in a browser before
// they build any connector.
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    service: "Pega Training Mock APIs",
    useCases: {
      largeAppBuild: {
        name: "Mock Bank APIs — loan origination",
        auth: "x-api-key (SEARCH_API_KEYS) and OAuth2 client credentials",
        seededApplicants: Object.keys(applicants).length,
        endpoints: [
          { step: 1, method: "GET", path: "/applicants/v1/search?firstName=&lastName=&dateOfBirth=", auth: "API Key (x-api-key)" },
          { step: 2, method: "POST", path: "/oauth/token", auth: "none — this IS the auth call" },
          { step: 3, method: "GET", path: "/credit-bureau/v1/creditscore/:ssn", auth: "OAuth2 Bearer" },
        ],
      },
      aiWeek: {
        name: "Mobile Club Nord — Mitgliedschaft und Kartenproduktion",
        auth: "x-api-key (MCN_API_KEYS)",
        seededMembers: Object.keys(mitglieder).length,
        endpoints: [
          { method: "POST", path: "/mcn/mitglieder/v1/mitglieder/suche", auth: "API Key (x-api-key)" },
          { method: "POST", path: "/mcn/mitglieder/v1/mitglieder", auth: "API Key (x-api-key)" },
          { method: "GET", path: "/mcn/mitglieder/v1/mitglieder/:mitgliedsnummer", auth: "API Key (x-api-key)" },
          { method: "POST", path: "/mcn/karten/v1/kartenauftraege", auth: "API Key (x-api-key)" },
          { method: "GET", path: "/mcn/karten/v1/kartenauftraege/:auftragsnummer", auth: "API Key (x-api-key)" },
          { method: "POST", path: "/mcn/karten/v1/kartenauftraege/:auftragsnummer/stornierung", auth: "API Key (x-api-key)" },
        ],
        openapi: [
          "/mcn/mitglieder/v1/openapi.json",
          "/mcn/karten/v1/openapi.json",
        ],
      },
    },
    health: "/health",
    docs: "See README.md in the delivered project for full request/response examples.",
  });
});

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// --- Large App Build ---------------------------------------------------------
app.use("/", bank.router);

// --- Pega AI Week ------------------------------------------------------------
// OpenAPI documents are served WITHOUT auth on purpose: trainees point Pega's
// REST integration wizard (or an AI assistant) at these URLs to generate the
// connector, and that fetch carries no API key.
app.get("/mcn/mitglieder/v1/openapi.json", (req, res) => res.json(openapiMitglieder));
app.get("/mcn/karten/v1/openapi.json", (req, res) => res.json(openapiKarten));

app.use("/mcn/mitglieder/v1", apiKeyGuard(MCN_API_KEYS, "MCN Bestandssystem"), mcnMitglieder);
app.use("/mcn/karten/v1", apiKeyGuard(MCN_API_KEYS, "MCN Kartenproduktion"), mcnKarten);

// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: "not_found", message: `No route for ${req.method} ${req.path}` });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Pega Training Mock APIs listening on port ${PORT}`);
    console.log("");
    console.log("  Large App Build — Mock Bank APIs");
    console.log(`    API keys (${bank.SEARCH_API_KEYS.length}): ${bank.SEARCH_API_KEYS.join(", ")}`);
    console.log(`    OAuth2: ${bank.OAUTH_CLIENT_ID} / ${bank.OAUTH_CLIENT_SECRET}`);
    console.log(`    Seeded applicants: ${Object.keys(applicants).length}`);
    console.log("");
    console.log("  Pega AI Week — Mobile Club Nord");
    console.log(`    API keys (${MCN_API_KEYS.length}): ${MCN_API_KEYS.join(", ")}`);
    console.log(`    Seeded members: ${Object.keys(mitglieder).length}`);
    console.log("");
  });
}

module.exports = app;
