// ---------------------------------------------------------------------------
// MOBILE CLUB NORD — Kartenproduktion
// Mounted at /mcn/karten/v1 — API Key auth (x-api-key, MCN key set).
//
// Teaching role: US 8 needs a child case that waits for an external process to
// progress through states. So this service returns a status that changes over
// time, fast enough to watch inside one exercise.
//
// STATELESS BY DESIGN: the Auftragsnummer encodes the creation timestamp, the
// tariff and the member-number suffix, so the status is a pure function of the
// order number and the current clock. Render's free tier destroys the container
// after ~15 minutes of inactivity — with an in-memory store, every order created
// before a lunch break would 404 afterwards, which is exactly the kind of thing
// that derails a demo. Here it simply keeps working.
//
// Only cancellations need real state; those are kept in memory and are lost on
// restart (documented in the README).
// ---------------------------------------------------------------------------

const express = require("express");

const router = express.Router();

const STUFEN_SEKUNDEN = parseInt(process.env.MCN_CARD_STEP_SECONDS || "60", 10);
const storniert = new Set();
const details = {}; // Auftragsnummer -> Name/Adresse, best effort

const ABLAUF_BASIS = ["ANGENOMMEN", "IN_PRODUKTION", "VERSENDET", "ZUGESTELLT"];
const ABLAUF_PLUS = ["ANGENOMMEN", "IN_PRODUKTION", "PERSONALISIERUNG", "VERSENDET", "ZUGESTELLT"];

function fehler(res, code, status, meldung, extra = {}) {
  return res.status(status).json({ fehlercode: code, meldung, ...extra });
}

/**
 * Auftragsnummer: KA-<YYYY>-<base36 epoch seconds>-<B|P><2 Ziffern Mitgliedsnr>
 * Beispiel: KA-2026-M8X2K9-P12
 */
function baueNummer(epochSekunden, tarif, mitgliedsnummer) {
  const jahr = new Date(epochSekunden * 1000).getFullYear();
  const t = tarif === "Plus" ? "P" : "B";
  const suffix = (String(mitgliedsnummer || "").replace(/\D/g, "").slice(-2) || "00");
  return `KA-${jahr}-${epochSekunden.toString(36).toUpperCase()}-${t}${suffix}`;
}

function leseNummer(nr) {
  const m = /^KA-(\d{4})-([0-9A-Z]+)-([BP])(\d{2})$/.exec(nr || "");
  if (!m) return null;
  const epoch = parseInt(m[2], 36);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return {
    erstelltEpoch: epoch,
    tarif: m[3] === "P" ? "Plus" : "Basis",
    mitgliedSuffix: m[4],
  };
}

function statusFuer(info) {
  const ablauf = info.tarif === "Plus" ? ABLAUF_PLUS : ABLAUF_BASIS;
  // Trigger: Mitgliedsnummer endet auf 99 → bleibt dauerhaft in IN_PRODUKTION
  if (info.mitgliedSuffix === "99") return "IN_PRODUKTION";
  const vergangen = Math.floor(Date.now() / 1000) - info.erstelltEpoch;
  const stufe = Math.min(ablauf.length - 1, Math.floor(vergangen / STUFEN_SEKUNDEN));
  return ablauf[Math.max(0, stufe)];
}

function zustelldatum(epoch) {
  const d = new Date(epoch * 1000);
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

function sendungsnummer(nr) {
  let h = 0;
  for (let i = 0; i < nr.length; i++) h = (h * 31 + nr.charCodeAt(i)) >>> 0;
  return "DHL" + String(h % 100000000).padStart(8, "0");
}

function antwort(nr, info) {
  const status = storniert.has(nr) ? "STORNIERT" : statusFuer(info);
  const body = {
    auftragsnummer: nr,
    status,
    tarif: info.tarif,
    erstelltAm: new Date(info.erstelltEpoch * 1000).toISOString(),
    aktualisiertAm: new Date().toISOString(),
    voraussichtlicheZustellung: zustelldatum(info.erstelltEpoch),
  };
  if (["VERSENDET", "ZUGESTELLT"].includes(status)) {
    body.sendungsnummer = sendungsnummer(nr);
  }
  if (details[nr]) Object.assign(body, details[nr]);
  return body;
}

// ---------------------------------------------------------------------------
// POST /kartenauftraege
// ---------------------------------------------------------------------------
router.post("/kartenauftraege", (req, res) => {
  const { mitgliedsnummer, name, adresse, tarif } = req.body || {};

  if (!mitgliedsnummer) {
    return fehler(res, "PFLICHTFELD_FEHLT", 400, "mitgliedsnummer ist eine Pflichtangabe.");
  }
  if (!/^MCN-\d{4}-\d{6}$/.test(mitgliedsnummer)) {
    return fehler(res, "MITGLIED_UNBEKANNT", 404,
      `Die Mitgliedsnummer ${mitgliedsnummer} ist dem Kartensystem nicht bekannt.`);
  }
  if (tarif && !["Basis", "Plus"].includes(tarif)) {
    return fehler(res, "UNGUELTIGER_TARIF", 400, "Tarif muss 'Basis' oder 'Plus' sein.");
  }

  // Trigger: Mitgliedsnummer endet auf 98 → Auftragsanlage schlägt fehl
  if (mitgliedsnummer.endsWith("98")) {
    return fehler(res, "PRODUKTION_NICHT_ERREICHBAR", 503,
      "Die Kartenproduktion ist derzeit nicht erreichbar.");
  }

  const epoch = Math.floor(Date.now() / 1000);
  const nr = baueNummer(epoch, tarif || "Basis", mitgliedsnummer);
  details[nr] = { mitgliedsnummer, name: name || null, adresse: adresse || null };

  const info = leseNummer(nr);
  res.status(202).json({
    ...antwort(nr, info),
    meldung: "Kartenauftrag angenommen.",
  });
});

// ---------------------------------------------------------------------------
// GET /kartenauftraege/:auftragsnummer
// ---------------------------------------------------------------------------
router.get("/kartenauftraege/:auftragsnummer", (req, res) => {
  const nr = req.params.auftragsnummer;
  const info = leseNummer(nr);
  if (!info) {
    return fehler(res, "AUFTRAG_UNBEKANNT", 404,
      `Kein Kartenauftrag zur Nummer ${nr} gefunden.`);
  }
  res.json(antwort(nr, info));
});

// ---------------------------------------------------------------------------
// POST /kartenauftraege/:auftragsnummer/stornierung
// ---------------------------------------------------------------------------
router.post("/kartenauftraege/:auftragsnummer/stornierung", (req, res) => {
  const nr = req.params.auftragsnummer;
  const info = leseNummer(nr);
  if (!info) {
    return fehler(res, "AUFTRAG_UNBEKANNT", 404,
      `Kein Kartenauftrag zur Nummer ${nr} gefunden.`);
  }
  if (storniert.has(nr)) {
    return res.json({ auftragsnummer: nr, status: "STORNIERT", meldung: "Bereits storniert." });
  }
  const status = statusFuer(info);
  if (["VERSENDET", "ZUGESTELLT"].includes(status)) {
    return fehler(res, "STORNIERUNG_NICHT_MOEGLICH", 409,
      `Der Auftrag ist bereits im Status ${status} und kann nicht mehr storniert werden.`);
  }
  storniert.add(nr);
  res.json({ auftragsnummer: nr, status: "STORNIERT", storniertAm: new Date().toISOString() });
});

module.exports = router;
