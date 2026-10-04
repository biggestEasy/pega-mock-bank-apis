// Generates data-mcn.js — the seeded member base for the Mobile Club Nord
// (Pega AI Week) use case.
//
// Deterministic (seeded PRNG), so re-running produces byte-identical output and
// is safe at any time. Run: node scripts/generate-mcn-data.js

const fs = require("fs");
const path = require("path");

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261004);

const vornamen = [
  "Anna", "Lars", "Mareike", "Jonas", "Svenja", "Hauke", "Birte", "Nils",
  "Frauke", "Thies", "Imke", "Ole", "Wiebke", "Malte", "Antje", "Sönke",
  "Heike", "Jannik", "Silke", "Broder",
];

const nachnamen = [
  "Petersen", "Jansen", "Boysen", "Hinrichs", "Lorenzen", "Thomsen", "Carstens",
  "Nissen", "Paulsen", "Momsen", "Hansen", "Clausen", "Ketelsen", "Rohwedder",
  "Struve", "Timm", "Wulff", "Bahnsen", "Detlefsen", "Harms",
];

const strassen = [
  "Mühlenkamp", "Osterstraße", "Eppendorfer Landstraße", "Große Bergstraße",
  "Fuhlsbüttler Straße", "Holstenstraße", "Barmbeker Markt", "Winterhuder Weg",
  "Alsterchaussee", "Billstedter Hauptstraße", "Rübenkamp", "Lange Reihe",
];

// Hamburg + Umland
const plzOrt = [
  ["20249", "Hamburg"], ["20357", "Hamburg"], ["22303", "Hamburg"],
  ["22089", "Hamburg"], ["22765", "Hamburg"], ["21073", "Hamburg"],
  ["24103", "Kiel"], ["23552", "Lübeck"], ["25524", "Itzehoe"],
  ["21682", "Stade"],
];

const beziehungen = ["Partner", "Partnerin", "Kind", "Kind", "Kind"];

const pick = (a) => a[Math.floor(rand() * a.length)];
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pad = (n, w) => String(n).padStart(w, "0");

function altersklasse(geburtsdatum, stichtag) {
  const g = new Date(geburtsdatum);
  const s = new Date(stichtag);
  let alter = s.getFullYear() - g.getFullYear();
  const m = s.getMonth() - g.getMonth();
  if (m < 0 || (m === 0 && s.getDate() < g.getDate())) alter--;
  if (alter <= 17) return "Kind";
  if (alter <= 27) return "Junger Erwachsener";
  return "Erwachsener";
}

// Beitrag nach US 2: 18–27 Jahre → Basis 8 €, Plus 12 €; ab 28 → Basis 12 €, Plus 18 €
function beitrag(tarif, geburtsdatum, eintrittsdatum) {
  const k = altersklasse(geburtsdatum, eintrittsdatum);
  if (k === "Kind") return 0;
  if (k === "Junger Erwachsener") return tarif === "Plus" ? 12 : 8;
  return tarif === "Plus" ? 18 : 12;
}

const MEMBER_COUNT = 60;
const mitglieder = {};

// ---------------------------------------------------------------------------
// Feste Testfälle zuerst — auf diese beziehen sich die User Stories und die
// Cucumber-Szenarien. Sie dürfen sich bei einer Neugenerierung NICHT ändern.
// ---------------------------------------------------------------------------
const feste = [
  {
    mitgliedsnummer: "MCN-2023-000001",
    vorname: "Dirk", nachname: "Dublettski", geburtsdatum: "1981-04-17",
    plz: "20249", ort: "Hamburg", strasse: "Osterstraße", hausnummer: "14",
    tarif: "Plus", eintrittsdatum: "2023-05-01", status: "Aktiv",
    zahlungsart: "SEPA", email: "dirk.dublettski@example.de",
    zweck: "Löst bei POST /mitglieder immer 409 DUBLETTE aus (Nachname-Trigger).",
    familie: [],
  },
  {
    mitgliedsnummer: "MCN-2022-000002",
    vorname: "Greta", nachname: "Beendet", geburtsdatum: "1969-11-02",
    plz: "22765", ort: "Hamburg", strasse: "Große Bergstraße", hausnummer: "3",
    tarif: "Basis", eintrittsdatum: "2022-01-01", status: "Beendet",
    zahlungsart: "Rechnung", email: "greta.beendet@example.de",
    zweck: "Gekündigte Mitgliedschaft — für US 10 (Pannenmeldung ohne gültige Mitgliedschaft).",
    familie: [],
  },
  {
    mitgliedsnummer: "MCN-2021-000003",
    vorname: "Ruth", nachname: "Ruhend", geburtsdatum: "1988-07-23",
    plz: "22089", ort: "Hamburg", strasse: "Barmbeker Markt", hausnummer: "9",
    tarif: "Plus", eintrittsdatum: "2021-09-15", status: "Ruhend",
    zahlungsart: "SEPA", email: "ruth.ruhend@example.de",
    zweck: "Ruhende Mitgliedschaft nach Zahlungsausfall — für US 15.",
    familie: [],
  },
  {
    mitgliedsnummer: "MCN-2024-000004",
    vorname: "Famke", nachname: "Familjen", geburtsdatum: "1985-02-11",
    plz: "22303", ort: "Hamburg", strasse: "Mühlenkamp", hausnummer: "17",
    tarif: "Plus", eintrittsdatum: "2024-03-01", status: "Aktiv",
    zahlungsart: "SEPA", email: "famke.familjen@example.de",
    zweck: "Familienmitgliedschaft mit drei zugeordneten Personen — für US 5 und US 13.",
    familie: [
      { vorname: "Bo", nachname: "Familjen", geburtsdatum: "1983-06-30", beziehung: "Partner" },
      { vorname: "Mia", nachname: "Familjen", geburtsdatum: "2012-04-08", beziehung: "Kind" },
      { vorname: "Tjark", nachname: "Familjen", geburtsdatum: "2016-09-19", beziehung: "Kind" },
    ],
  },
  {
    mitgliedsnummer: "MCN-2025-000099",
    vorname: "Karl", nachname: "Kartenstau", geburtsdatum: "1976-12-05",
    plz: "21073", ort: "Hamburg", strasse: "Winterhuder Weg", hausnummer: "41",
    tarif: "Basis", eintrittsdatum: "2025-02-01", status: "Aktiv",
    zahlungsart: "SEPA", email: "karl.kartenstau@example.de",
    zweck: "Mitgliedsnummer endet auf 99 — Kartenauftrag bleibt in IN_PRODUKTION (US 8, SLA-Test).",
    familie: [],
  },
  {
    mitgliedsnummer: "MCN-2025-000098",
    vorname: "Sven", nachname: "Störfall", geburtsdatum: "1990-03-28",
    plz: "24103", ort: "Kiel", strasse: "Holstenstraße", hausnummer: "22",
    tarif: "Plus", eintrittsdatum: "2025-06-01", status: "Aktiv",
    zahlungsart: "SEPA", email: "sven.stoerfall@example.de",
    zweck: "Mitgliedsnummer endet auf 98 — POST /kartenauftraege antwortet 503 (US 8).",
    familie: [],
  },
];

feste.forEach((f) => {
  mitglieder[f.mitgliedsnummer] = {
    mitgliedsnummer: f.mitgliedsnummer,
    status: f.status,
    tarif: f.tarif,
    eintrittsdatum: f.eintrittsdatum,
    zahlungsart: f.zahlungsart,
    hauptmitglied: {
      vorname: f.vorname,
      nachname: f.nachname,
      geburtsdatum: f.geburtsdatum,
      email: f.email,
    },
    adresse: {
      strasse: f.strasse,
      hausnummer: f.hausnummer,
      postleitzahl: f.plz,
      ort: f.ort,
    },
    familienmitglieder: f.familie.map((m) => ({
      ...m,
      altersklasse: altersklasse(m.geburtsdatum, f.eintrittsdatum),
    })),
    monatsbeitrag:
      beitrag(f.tarif, f.geburtsdatum, f.eintrittsdatum) +
      f.familie.reduce((s, m) => s + beitrag(f.tarif, m.geburtsdatum, f.eintrittsdatum), 0),
    testhinweis: f.zweck,
  };
});

// ---------------------------------------------------------------------------
// Zufälliger Bestand. Zwei absichtliche Namensdubletten (gleicher Nachname,
// unterschiedliches Geburtsdatum), damit die Dublettensuche aus US 4/US 7 auch
// Treffer mit mittlerer Treffergüte liefert.
// ---------------------------------------------------------------------------
const kollisionen = [
  ["Anna", "Petersen"],
  ["Anna", "Petersen"],
  ["Lars", "Jansen"],
  ["Lars", "Jansen"],
];

let laufend = 100;
for (let i = 1; i <= MEMBER_COUNT; i++) {
  laufend += 1;
  const jahr = randInt(2019, 2026);
  const mitgliedsnummer = `MCN-${jahr}-${pad(laufend, 6)}`;

  const [vorname, nachname] =
    i <= kollisionen.length ? kollisionen[i - 1] : [pick(vornamen), pick(nachnamen)];

  const gj = randInt(1955, 2006);
  const geburtsdatum = `${gj}-${pad(randInt(1, 12), 2)}-${pad(randInt(1, 28), 2)}`;
  const eintrittsdatum = `${jahr}-${pad(randInt(1, 12), 2)}-01`;
  const [plz, ort] = pick(plzOrt);
  const tarif = rand() < 0.42 ? "Plus" : "Basis";
  const zahlungsart = rand() < 0.8 ? "SEPA" : "Rechnung";

  const r = rand();
  const status = r < 0.86 ? "Aktiv" : r < 0.95 ? "Beendet" : "Ruhend";

  const familie = [];
  if (rand() < 0.3) {
    const n = randInt(1, 3);
    for (let k = 0; k < n; k++) {
      const kj = randInt(1960, 2020);
      familie.push({
        vorname: pick(vornamen),
        nachname,
        geburtsdatum: `${kj}-${pad(randInt(1, 12), 2)}-${pad(randInt(1, 28), 2)}`,
        beziehung: pick(beziehungen),
      });
    }
  }

  mitglieder[mitgliedsnummer] = {
    mitgliedsnummer,
    status,
    tarif,
    eintrittsdatum,
    zahlungsart,
    hauptmitglied: {
      vorname,
      nachname,
      geburtsdatum,
      email: `${vorname}.${nachname}`.toLowerCase().replace(/[äöüß]/g, "x") + "@example.de",
    },
    adresse: {
      strasse: pick(strassen),
      hausnummer: String(randInt(1, 120)),
      postleitzahl: plz,
      ort,
    },
    familienmitglieder: familie.map((m) => ({
      ...m,
      altersklasse: altersklasse(m.geburtsdatum, eintrittsdatum),
    })),
    monatsbeitrag:
      beitrag(tarif, geburtsdatum, eintrittsdatum) +
      familie.reduce((s, m) => s + beitrag(tarif, m.geburtsdatum, eintrittsdatum), 0),
  };
}

const banner = `// AUTO-GENERATED by scripts/generate-mcn-data.js — do not hand-edit.
// Regenerate with: node scripts/generate-mcn-data.js
//
// Seeded member base for the Mobile Club Nord use case (Pega AI Week).
// ${Object.keys(mitglieder).length} members, deterministic (fixed PRNG seed).
//
// Fixed test cases that the user stories and Cucumber scenarios rely on —
// these must stay stable across regenerations:
${feste.map((f) => `//   ${f.mitgliedsnummer}  ${f.vorname} ${f.nachname} — ${f.zweck}`).join("\n")}
//
// Plus deliberate name collisions (Anna Petersen x2, Lars Jansen x2) so the
// duplicate search returns medium-confidence matches.
`;

const output =
  banner +
  "\nconst mitglieder = " +
  JSON.stringify(mitglieder, null, 2) +
  ";\n\nmodule.exports = { mitglieder };\n";

fs.writeFileSync(path.join(__dirname, "..", "data-mcn.js"), output);

// CSV-Referenz für die Coaches
const rows = [
  "mitgliedsnummer,vorname,nachname,geburtsdatum,status,tarif,eintrittsdatum,zahlungsart,plz,ort,familienmitglieder,monatsbeitrag,testhinweis",
];
Object.values(mitglieder).forEach((m) => {
  rows.push(
    [
      m.mitgliedsnummer,
      m.hauptmitglied.vorname,
      m.hauptmitglied.nachname,
      m.hauptmitglied.geburtsdatum,
      m.status,
      m.tarif,
      m.eintrittsdatum,
      m.zahlungsart,
      m.adresse.postleitzahl,
      m.adresse.ort,
      m.familienmitglieder.length,
      m.monatsbeitrag,
      `"${m.testhinweis || ""}"`,
    ].join(",")
  );
});
fs.writeFileSync(path.join(__dirname, "..", "mcn-mitglieder-reference.csv"), rows.join("\n") + "\n");

console.log(`Wrote ${Object.keys(mitglieder).length} members to data-mcn.js`);
console.log("Wrote mcn-mitglieder-reference.csv");
