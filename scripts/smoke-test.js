// End-to-end smoke test for every endpoint, old and new.
// Starts the app on an ephemeral port, exercises it, prints a pass/fail table.
// Run: node scripts/smoke-test.js
//
// Covers the Large App Build bank APIs (so a refactor can't silently break the
// URLs a running cohort already configured) and both Mobile Club Nord services,
// including every documented test-data trigger.

// 10s per step: the status assertions below mint order numbers with a known age
// rather than sleeping, so a larger step costs no test time and keeps the
// half-step arithmetic clear of rounding boundaries.
process.env.MCN_CARD_STEP_SECONDS = process.env.MCN_CARD_STEP_SECONDS || "10";
process.env.MCN_SLOW_RESPONSE_MS = process.env.MCN_SLOW_RESPONSE_MS || "300";

const app = require("../server");

const BANK_KEY = "pega-team01-8f2c1a";
const MCN_KEY = "mcn-team01-4ab19c";

let base;
let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? " — " + detail : ""}`);
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

async function call(path, { method = "GET", key, body, form, headers = {}, bearer } = {}) {
  const h = { ...headers };
  if (key) h["x-api-key"] = key;
  if (bearer) h["Authorization"] = `Bearer ${bearer}`;
  let payload;
  if (body) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  } else if (form) {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    /* non-JSON */
  }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log("\n--- Large App Build: Mock Bank APIs ---");

  let r = await call("/health");
  check("GET /health", r.status === 200 && r.json.status === "ok");

  r = await call("/");
  check("GET / lists both use cases",
    r.status === 200 && r.json.useCases && r.json.useCases.largeAppBuild && r.json.useCases.aiWeek);

  r = await call("/applicants/v1/search?lastName=Berger");
  check("Applicant search without key → 401", r.status === 401, `got ${r.status}`);

  r = await call("/applicants/v1/search?lastName=Berger", { key: BANK_KEY });
  check("Applicant search by lastName → results", r.status === 200 && r.json.matchCount > 1,
    `status ${r.status}, matchCount ${r.json && r.json.matchCount}`);

  r = await call("/applicants/v1/search?lastName=Berger&dateOfBirth=1992-02-03", { key: BANK_KEY });
  check("Applicant search narrowed by DOB → 1 match", r.status === 200 && r.json.matchCount === 1,
    `matchCount ${r.json && r.json.matchCount}`);

  r = await call("/applicants/v1/search", { key: BANK_KEY });
  check("Applicant search without name → 400", r.status === 400);

  r = await call("/oauth/token", {
    method: "POST",
    form: { grant_type: "client_credentials", client_id: "pega-bank-client", client_secret: "pega-bank-secret" },
  });
  check("OAuth token issued", r.status === 200 && !!r.json.access_token);
  const token = r.json && r.json.access_token;

  r = await call("/oauth/token", {
    method: "POST",
    form: { grant_type: "client_credentials", client_id: "wrong", client_secret: "wrong" },
  });
  check("OAuth bad credentials → 401", r.status === 401);

  r = await call("/credit-bureau/v1/creditscore/111-22-1002");
  check("Credit score without token → 401", r.status === 401);

  r = await call("/credit-bureau/v1/creditscore/111-22-1002", { bearer: token });
  check("Credit score with token → score + band",
    r.status === 200 && typeof r.json.creditScore === "number" && !!r.json.riskBand,
    `status ${r.status}`);

  r = await call("/credit-bureau/v1/creditscore/999-99-9999", { bearer: token });
  check("Credit score unknown SSN → 404", r.status === 404);

  console.log("\n--- AI Week: MCN Bestandssystem ---");

  r = await call("/mcn/mitglieder/v1/mitglieder/suche", { method: "POST", body: { nachname: "Petersen" } });
  check("Suche without key → 401", r.status === 401);

  r = await call("/mcn/mitglieder/v1/mitglieder/suche", {
    method: "POST", key: MCN_KEY, body: { nachname: "Petersen" },
  });
  check("Suche by Nachname → Treffer", r.status === 200 && r.json.anzahl >= 2,
    `anzahl ${r.json && r.json.anzahl}`);

  r = await call("/mcn/mitglieder/v1/mitglieder/suche", {
    method: "POST", key: MCN_KEY,
    body: { nachname: "Dublettski", geburtsdatum: "1981-04-17" },
  });
  check("Suche mit Geburtsdatum → Treffergüte 95+",
    r.status === 200 && r.json.treffer[0] && r.json.treffer[0].trefferguete >= 95,
    JSON.stringify(r.json && r.json.treffer && r.json.treffer[0]));

  r = await call("/mcn/mitglieder/v1/mitglieder/suche", { method: "POST", key: MCN_KEY, body: {} });
  check("Suche ohne Nachname → 400", r.status === 400);

  r = await call("/mcn/mitglieder/v1/mitglieder", {
    method: "POST", key: MCN_KEY,
    body: { hauptmitglied: { vorname: "Dirk", nachname: "Dublettski", geburtsdatum: "1981-04-17" } },
  });
  check("Trigger 'Dublettski' → 409 DUBLETTE",
    r.status === 409 && r.json.fehlercode === "DUBLETTE" &&
    r.json.bestehendeMitgliedsnummer === "MCN-2023-000001", `status ${r.status}`);

  r = await call("/mcn/mitglieder/v1/mitglieder", {
    method: "POST", key: MCN_KEY,
    body: { hauptmitglied: { vorname: "Sue", nachname: "Systemfehler", geburtsdatum: "1990-01-01" } },
  });
  check("Trigger 'Systemfehler' → 503",
    r.status === 503 && r.json.fehlercode === "SYSTEM_NICHT_ERREICHBAR", `status ${r.status}`);

  const tSlow = Date.now();
  r = await call("/mcn/mitglieder/v1/mitglieder", {
    method: "POST", key: MCN_KEY,
    body: { hauptmitglied: { vorname: "Lang", nachname: "Langsam", geburtsdatum: "1990-01-01" } },
  });
  check("Trigger 'Langsam' → verzögerte Antwort",
    r.status === 201 && Date.now() - tSlow >= 250, `status ${r.status}, ${Date.now() - tSlow}ms`);

  r = await call("/mcn/mitglieder/v1/mitglieder", {
    method: "POST", key: MCN_KEY,
    body: {
      hauptmitglied: { vorname: "Test", nachname: "Neumitglied", geburtsdatum: "1994-03-12" },
      tarif: "Plus", eintrittsdatum: "2026-11-01", zahlungsart: "SEPA",
      iban: "DE02120300000000202051",
      familienmitglieder: [{ vorname: "Kind", nachname: "Neumitglied", geburtsdatum: "2015-08-04", beziehung: "Kind" }],
    },
  });
  check("Anlage → 201 mit Mitgliedsnummer",
    r.status === 201 && /^MCN-\d{4}-\d{6}$/.test(r.json.mitgliedsnummer), JSON.stringify(r.json));
  check("Anlage → Altersklasse gesetzt",
    r.json.familienmitglieder && r.json.familienmitglieder[0].altersklasse === "Kind");
  check("Anlage → Monatsbeitrag Plus/Erwachsen = 18 (Kind 0)",
    r.json.monatsbeitrag === 18, `beitrag ${r.json && r.json.monatsbeitrag}`);
  const neueNr = r.json.mitgliedsnummer;

  r = await call("/mcn/mitglieder/v1/mitglieder", {
    method: "POST", key: MCN_KEY,
    body: { hauptmitglied: { vorname: "Test", nachname: "Neumitglied", geburtsdatum: "1994-03-12" } },
  });
  check("Zweite Anlage OHNE Idempotency-Key → 409 DUBLETTE",
    r.status === 409 && r.json.fehlercode === "DUBLETTE", `status ${r.status}`);

  r = await call("/mcn/mitglieder/v1/mitglieder", {
    method: "POST", key: MCN_KEY, headers: { "Idempotency-Key": "CASE-4711" },
    body: { hauptmitglied: { vorname: "Ida", nachname: "Idempotent", geburtsdatum: "1988-05-05" } },
  });
  const idemNr = r.json.mitgliedsnummer;
  check("Anlage mit Idempotency-Key → 201", r.status === 201 && !!idemNr);

  r = await call("/mcn/mitglieder/v1/mitglieder", {
    method: "POST", key: MCN_KEY, headers: { "Idempotency-Key": "CASE-4711" },
    body: { hauptmitglied: { vorname: "Ida", nachname: "Idempotent", geburtsdatum: "1988-05-05" } },
  });
  check("Wiederholung mit gleichem Key → 200, gleiche Nummer",
    r.status === 200 && r.json.mitgliedsnummer === idemNr && r.json.idempotent === true,
    `status ${r.status}, nr ${r.json && r.json.mitgliedsnummer}`);

  r = await call("/mcn/mitglieder/v1/mitglieder", {
    method: "POST", key: MCN_KEY,
    body: { hauptmitglied: { vorname: "X", nachname: "SepaOhneIban", geburtsdatum: "1990-01-01" }, zahlungsart: "SEPA" },
  });
  check("SEPA ohne IBAN → 400 IBAN_FEHLT",
    r.status === 400 && r.json.fehlercode === "IBAN_FEHLT", `status ${r.status}`);

  r = await call("/mcn/mitglieder/v1/mitglieder/" + neueNr, { key: MCN_KEY });
  check("GET angelegte Mitgliedschaft → 200", r.status === 200 && r.json.mitgliedsnummer === neueNr);

  r = await call("/mcn/mitglieder/v1/mitglieder/MCN-2024-000004", { key: MCN_KEY });
  check("GET Familienmitgliedschaft (Seed) → 3 Familienmitglieder",
    r.status === 200 && r.json.familienmitglieder.length === 3);
  check("Seed-Datensatz enthält keinen testhinweis nach außen", r.json.testhinweis === undefined);

  r = await call("/mcn/mitglieder/v1/mitglieder/MCN-2022-000002", { key: MCN_KEY });
  check("GET gekündigte Mitgliedschaft → Status Beendet",
    r.status === 200 && r.json.status === "Beendet");

  r = await call("/mcn/mitglieder/v1/mitglieder/MCN-9999-999999", { key: MCN_KEY });
  check("GET unbekannte Nummer → 404", r.status === 404 && r.json.fehlercode === "NICHT_GEFUNDEN");

  console.log("\n--- AI Week: MCN Kartenproduktion ---");

  r = await call("/mcn/karten/v1/kartenauftraege", {
    method: "POST", key: MCN_KEY,
    body: { mitgliedsnummer: "MCN-2024-000004", name: "Famke Familjen", tarif: "Plus" },
  });
  check("Kartenauftrag anlegen → 202 ANGENOMMEN",
    r.status === 202 && r.json.status === "ANGENOMMEN" && /^KA-\d{4}-[0-9A-Z]+-P04$/.test(r.json.auftragsnummer),
    JSON.stringify(r.json));
  const auftrag = r.json.auftragsnummer;

  // The status is a pure function of (order number, clock), and the order number
  // format is public — so instead of sleeping past step boundaries (which races),
  // we mint order numbers with a KNOWN age and assert the exact expected status.
  const schritt = parseInt(process.env.MCN_CARD_STEP_SECONDS, 10);
  const nummerMitAlter = (sekunden, tarif, suffix) => {
    const epoch = Math.floor(Date.now() / 1000) - sekunden;
    const jahr = new Date(epoch * 1000).getFullYear();
    return `KA-${jahr}-${epoch.toString(36).toUpperCase()}-${tarif === "Plus" ? "P" : "B"}${suffix}`;
  };
  // Query at the MIDDLE of each step so clock drift during the test can't flip it.
  const beiStufe = (n) => Math.round(schritt * (n + 0.5));

  const erwartetBasis = ["ANGENOMMEN", "IN_PRODUKTION", "VERSENDET", "ZUGESTELLT"];
  for (let i = 0; i < erwartetBasis.length; i++) {
    r = await call("/mcn/karten/v1/kartenauftraege/" + nummerMitAlter(beiStufe(i), "Basis", "04"), { key: MCN_KEY });
    check(`Basis, Stufe ${i} → ${erwartetBasis[i]}`, r.json.status === erwartetBasis[i], r.json.status);
  }

  const erwartetPlus = ["ANGENOMMEN", "IN_PRODUKTION", "PERSONALISIERUNG", "VERSENDET", "ZUGESTELLT"];
  for (let i = 0; i < erwartetPlus.length; i++) {
    r = await call("/mcn/karten/v1/kartenauftraege/" + nummerMitAlter(beiStufe(i), "Plus", "04"), { key: MCN_KEY });
    check(`Plus, Stufe ${i} → ${erwartetPlus[i]}`, r.json.status === erwartetPlus[i], r.json.status);
  }

  const versendet = nummerMitAlter(beiStufe(3), "Plus", "04");
  r = await call("/mcn/karten/v1/kartenauftraege/" + versendet, { key: MCN_KEY });
  check("Ab VERSENDET gibt es eine Sendungsnummer",
    /^DHL\d{8}$/.test(r.json.sendungsnummer || ""), JSON.stringify(r.json));

  r = await call("/mcn/karten/v1/kartenauftraege/" + nummerMitAlter(beiStufe(1), "Basis", "04"), { key: MCN_KEY });
  check("Vor Versand gibt es KEINE Sendungsnummer", r.json.sendungsnummer === undefined);

  r = await call("/mcn/karten/v1/kartenauftraege/" + versendet + "/stornierung", { method: "POST", key: MCN_KEY });
  check("Stornierung nach Versand → 409", r.status === 409, `status ${r.status}`);

  r = await call("/mcn/karten/v1/kartenauftraege", {
    method: "POST", key: MCN_KEY, body: { mitgliedsnummer: "MCN-2025-000099", tarif: "Basis" },
  });
  const stau = r.json.auftragsnummer;
  r = await call("/mcn/karten/v1/kartenauftraege/" + nummerMitAlter(beiStufe(9), "Basis", "99"), { key: MCN_KEY });
  check("Trigger '…99' bleibt in IN_PRODUKTION", r.json.status === "IN_PRODUKTION", r.json.status);

  r = await call("/mcn/karten/v1/kartenauftraege/" + stau + "/stornierung", { method: "POST", key: MCN_KEY });
  check("Stornierung vor Versand → STORNIERT", r.status === 200 && r.json.status === "STORNIERT");

  r = await call("/mcn/karten/v1/kartenauftraege/" + stau, { key: MCN_KEY });
  check("Stornierter Auftrag meldet STORNIERT", r.json.status === "STORNIERT");

  r = await call("/mcn/karten/v1/kartenauftraege", {
    method: "POST", key: MCN_KEY, body: { mitgliedsnummer: "MCN-2025-000098" },
  });
  check("Trigger '…98' → 503",
    r.status === 503 && r.json.fehlercode === "PRODUKTION_NICHT_ERREICHBAR", `status ${r.status}`);

  r = await call("/mcn/karten/v1/kartenauftraege", {
    method: "POST", key: MCN_KEY, body: { mitgliedsnummer: "FALSCH" },
  });
  check("Ungültige Mitgliedsnummer → 404", r.status === 404);

  r = await call("/mcn/karten/v1/kartenauftraege", {
    method: "POST", key: MCN_KEY, body: { mitgliedsnummer: "MCN-2024-000004", tarif: "Gold" },
  });
  check("Ungültiger Tarif → 400", r.status === 400 && r.json.fehlercode === "UNGUELTIGER_TARIF");

  r = await call("/mcn/karten/v1/kartenauftraege/KA-2026-ZZZ", { key: MCN_KEY });
  check("Unbekannte Auftragsnummer → 404", r.status === 404);

  // Statelessness: a well-formed order number still resolves after a "restart".
  r = await call("/mcn/karten/v1/kartenauftraege/" + auftrag.replace(/-P04$/, "-B04"), { key: MCN_KEY });
  check("Auftragsnummer ist zustandslos auflösbar (Basis-Variante)",
    r.status === 200 && r.json.tarif === "Basis", `status ${r.status}`);

  console.log("\n--- OpenAPI ---");
  r = await call("/mcn/mitglieder/v1/openapi.json");
  check("OpenAPI Bestandssystem ohne Key erreichbar",
    r.status === 200 && r.json.openapi === "3.0.3" && !!r.json.paths["/mitglieder"]);
  r = await call("/mcn/karten/v1/openapi.json");
  check("OpenAPI Kartenproduktion ohne Key erreichbar",
    r.status === 200 && r.json.openapi === "3.0.3" && !!r.json.paths["/kartenauftraege"]);

  console.log("\n" + "=".repeat(60));
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log("   - " + f));
  }
  console.log("=".repeat(60) + "\n");
  return fail;
}

const server = app.listen(0, async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  let code = 1;
  try {
    code = await run();
  } catch (err) {
    console.error("Smoke test crashed:", err);
    code = 1;
  }
  server.close();
  process.exit(code ? 1 : 0);
});
