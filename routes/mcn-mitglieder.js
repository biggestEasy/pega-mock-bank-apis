// ---------------------------------------------------------------------------
// MOBILE CLUB NORD — Mitglieder-Bestandssystem
// Mounted at /mcn/mitglieder/v1 — API Key auth (x-api-key, MCN key set).
//
// Teaching role: this is the "führendes System" behind US 4 and US 7. The
// training application must not invent a Mitgliedsnummer — it has to ask this
// service, and it has to cope with the three answers a real registry gives:
// success, duplicate, and "I'm not available right now".
//
// Everything here is DETERMINISTIC: the same input always produces the same
// answer, which is what makes the trainees' Cucumber scenarios reproducible.
// ---------------------------------------------------------------------------

const express = require("express");
const { mitglieder: seeded } = require("../data-mcn");

const router = express.Router();

// Created members live here. Seeded members always exist; created ones are lost
// if Render spins the instance down (documented in the README). The generated
// Mitgliedsnummer is derived from the applicant data, so a repeated create after
// a restart still yields the SAME number — tests stay reproducible either way.
const angelegt = {};
const idempotenz = {}; // Idempotency-Key -> Mitgliedsnummer

const TRIGGER_DUBLETTE = "dublettski";
const TRIGGER_FEHLER = "systemfehler";
const TRIGGER_LANGSAM = "langsam";
const LANGSAM_MS = parseInt(process.env.MCN_SLOW_RESPONSE_MS || "25000", 10);

const norm = (s) => (s || "").trim().toLowerCase();
const alle = () => ({ ...seeded, ...angelegt });

function fehler(res, code, status, meldung, extra = {}) {
  return res.status(status).json({ fehlercode: code, meldung, ...extra });
}

/** Stable 6-digit suffix derived from surname + date of birth (FNV-1a). */
function ableitungsNummer(nachname, geburtsdatum) {
  const s = `${norm(nachname)}|${geburtsdatum || ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // 200000–999999 keeps generated numbers clearly apart from the seeded range.
  return String(200000 + (h % 800000));
}

function oeffentlich(m) {
  const { testhinweis, ...rest } = m;
  return rest;
}

// ---------------------------------------------------------------------------
// POST /mitglieder/suche — Dublettensuche
// Treffergüte: Nachname + Geburtsdatum = 95, Nachname + PLZ = 60, Nachname = 30.
// Treffer unter 30 werden nicht zurückgegeben.
// ---------------------------------------------------------------------------
router.post("/mitglieder/suche", (req, res) => {
  const { vorname, nachname, geburtsdatum, postleitzahl } = req.body || {};

  if (!nachname) {
    return fehler(res, "PFLICHTFELD_FEHLT", 400,
      "Für die Dublettensuche wird mindestens der Nachname benötigt.");
  }

  const treffer = [];
  Object.values(alle()).forEach((m) => {
    const h = m.hauptmitglied;
    if (norm(h.nachname) !== norm(nachname)) return;

    let guete = 30;
    if (geburtsdatum && h.geburtsdatum === geburtsdatum) guete = 95;
    else if (postleitzahl && m.adresse.postleitzahl === postleitzahl) guete = 60;
    if (vorname && norm(h.vorname) === norm(vorname)) guete = Math.min(99, guete + 4);

    treffer.push({
      mitgliedsnummer: m.mitgliedsnummer,
      name: `${h.vorname} ${h.nachname}`,
      geburtsdatum: h.geburtsdatum,
      status: m.status,
      eintrittsdatum: m.eintrittsdatum,
      trefferguete: guete,
    });
  });

  treffer.sort((a, b) => b.trefferguete - a.trefferguete);
  res.json({ anzahl: treffer.length, treffer });
});

// ---------------------------------------------------------------------------
// POST /mitglieder — Mitgliedschaft anlegen
//
// Reihenfolge der Prüfungen ist Absicht:
//   1. Trigger-Nachnamen (Systemfehler / Langsam / Dublettski)
//   2. Idempotency-Key — ein wiederholter Aufruf mit demselben Schlüssel
//      liefert 200 und DIESELBE Nummer, ohne eine zweite Mitgliedschaft.
//   3. echte Dublettenprüfung gegen den Bestand
//
// Wer ohne Idempotency-Key zweimal dieselbe Person anlegt, bekommt beim
// zweiten Mal 409 — genau die Lektion, die US 4 und US 7 vermitteln sollen.
// ---------------------------------------------------------------------------
router.post("/mitglieder", (req, res) => {
  const body = req.body || {};
  const h = body.hauptmitglied || {};
  const nachname = norm(h.nachname);

  if (nachname === TRIGGER_FEHLER) {
    return fehler(res, "SYSTEM_NICHT_ERREICHBAR", 503,
      "Das Bestandssystem ist derzeit nicht erreichbar. Bitte später erneut versuchen.");
  }

  if (nachname === TRIGGER_LANGSAM) {
    return setTimeout(() => {
      if (res.headersSent) return;
      res.status(201).json(anlegen(body, req.headers["idempotency-key"]));
    }, LANGSAM_MS);
  }

  if (nachname === TRIGGER_DUBLETTE) {
    return fehler(res, "DUBLETTE", 409,
      "Zu dieser Person besteht bereits eine Mitgliedschaft.",
      { bestehendeMitgliedsnummer: "MCN-2023-000001" });
  }

  if (!h.nachname || !h.geburtsdatum) {
    return fehler(res, "PFLICHTFELD_FEHLT", 400,
      "hauptmitglied.nachname und hauptmitglied.geburtsdatum sind Pflichtangaben.");
  }
  if (body.tarif && !["Basis", "Plus"].includes(body.tarif)) {
    return fehler(res, "UNGUELTIGER_TARIF", 400,
      "Tarif muss 'Basis' oder 'Plus' sein.");
  }
  if (body.zahlungsart === "SEPA" && !body.iban) {
    return fehler(res, "IBAN_FEHLT", 400,
      "Bei Zahlungsart SEPA ist eine IBAN erforderlich.");
  }

  const key = req.headers["idempotency-key"];
  if (key && idempotenz[key]) {
    const nr = idempotenz[key];
    return res.status(200).json({
      ...oeffentlich(alle()[nr]),
      idempotent: true,
      meldung: "Bereits mit diesem Idempotency-Key angelegt — keine zweite Mitgliedschaft.",
    });
  }

  // Echte Dublettenprüfung: gleicher Nachname UND gleiches Geburtsdatum.
  const bestehend = Object.values(alle()).find(
    (m) =>
      norm(m.hauptmitglied.nachname) === nachname &&
      m.hauptmitglied.geburtsdatum === h.geburtsdatum
  );
  if (bestehend) {
    return fehler(res, "DUBLETTE", 409,
      "Zu dieser Person besteht bereits eine Mitgliedschaft.",
      { bestehendeMitgliedsnummer: bestehend.mitgliedsnummer });
  }

  res.status(201).json(anlegen(body, key));
});

function anlegen(body, key) {
  const h = body.hauptmitglied || {};
  const jahr = new Date().getFullYear();
  const mitgliedsnummer = `MCN-${jahr}-${ableitungsNummer(h.nachname, h.geburtsdatum)}`;

  const eintritt = body.eintrittsdatum || new Date().toISOString().slice(0, 10);
  const familie = (body.familienmitglieder || []).map((m) => ({
    ...m,
    altersklasse: altersklasse(m.geburtsdatum, eintritt),
  }));

  const datensatz = {
    mitgliedsnummer,
    status: "Aktiv",
    tarif: body.tarif || "Basis",
    eintrittsdatum: eintritt,
    zahlungsart: body.zahlungsart || "Rechnung",
    hauptmitglied: {
      vorname: h.vorname,
      nachname: h.nachname,
      geburtsdatum: h.geburtsdatum,
      email: h.email || null,
    },
    adresse: body.adresse || null,
    familienmitglieder: familie,
    monatsbeitrag:
      beitrag(body.tarif, h.geburtsdatum, eintritt) +
      familie.reduce((s, m) => s + beitrag(body.tarif, m.geburtsdatum, eintritt), 0),
    angelegtAm: new Date().toISOString(),
  };

  angelegt[mitgliedsnummer] = datensatz;
  if (key) idempotenz[key] = mitgliedsnummer;
  return datensatz;
}

function altersklasse(geburtsdatum, stichtag) {
  if (!geburtsdatum) return null;
  const g = new Date(geburtsdatum);
  const s = new Date(stichtag);
  let alter = s.getFullYear() - g.getFullYear();
  const m = s.getMonth() - g.getMonth();
  if (m < 0 || (m === 0 && s.getDate() < g.getDate())) alter--;
  if (alter <= 17) return "Kind";
  if (alter <= 27) return "Junger Erwachsener";
  return "Erwachsener";
}

function beitrag(tarif, geburtsdatum, eintrittsdatum) {
  const k = altersklasse(geburtsdatum, eintrittsdatum);
  if (!k || k === "Kind") return 0;
  if (k === "Junger Erwachsener") return tarif === "Plus" ? 12 : 8;
  return tarif === "Plus" ? 18 : 12;
}

// ---------------------------------------------------------------------------
// GET /mitglieder/:mitgliedsnummer
// ---------------------------------------------------------------------------
router.get("/mitglieder/:mitgliedsnummer", (req, res) => {
  const m = alle()[req.params.mitgliedsnummer];
  if (!m) {
    return fehler(res, "NICHT_GEFUNDEN", 404,
      `Keine Mitgliedschaft zur Nummer ${req.params.mitgliedsnummer} gefunden.`);
  }
  res.json(oeffentlich(m));
});

module.exports = router;
