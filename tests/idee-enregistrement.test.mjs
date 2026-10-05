/**
 * Tests d'idee-enregistrement.js : une idée vide ne laisse rien, la
 * première note la crée, la suite la modifie en disant d'où elle part (S8),
 * ce qui part est l'idée du moment du geste (T4), une écriture manquée se
 * dit en français (I13), et la copie de secours garde une idée neuve sous
 * l'identifiant qu'elle aura.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as sq from "../app/sequence.js";
import { creerEnregistrementIdee, vide, instantane } from "../app/idee-enregistrement.js";
import { viderTout } from "../app/enregistreur.js";

/** L'état d'un éditeur qui vient d'ouvrir une idée neuve. */
function etatNeuf() {
  return {
    id: null, creeLe: null, titre: "Idée du 5 oct.", seq: sq.nouvelleSequence(), note: "", etiquettes: [], favori: false, memo: null,
    ouverte: true, session: { id: null, creeLe: null, cree: false, derniere: null },
  };
}

/** Un faux stockage qui note ses écritures ; `panne` : chaque écriture échoue avec cette erreur. */
function fauxStockage({ panne = null } = {}) {
  const ecrits = [];
  return {
    ecrits,
    creer: async (id, fiche, pages) => { if (panne) throw panne; ecrits.push(["creer", id, fiche, pages]); },
    modifier: async (id, fiche, options) => { if (panne) throw panne; ecrits.push(["modifier", id, fiche, options]); },
  };
}

function essai({ panne = null } = {}) {
  const e = etatNeuf();
  const stockage = fauxStockage({ panne });
  const etats = [], messages = [];
  let n = 0;
  const ecritures = creerEnregistrementIdee({
    e, stockage: () => stockage, nouvelId: () => `idee-${++n}`, delai: 20,
    etat: (t) => etats.push(t), toast: (t) => messages.push(t),
  });
  return { e, stockage, etats, messages, ecritures };
}

test("une idée neuve sans rien dedans ne s'enregistre pas", async () => {
  const { e, stockage, etats, ecritures } = essai();
  assert.equal(vide(instantane(e)), true);
  ecritures.planifier(0);
  await ecritures.vider();
  assert.deepEqual(stockage.ecrits, []);
  assert.equal(e.id, null);
  assert.deepEqual(etats, ["Enregistrement…", ""]);
  assert.equal(ecritures.fiche(), null, "rien à exporter tant qu'elle n'est pas enregistrée");
});

test("la première note crée l'idée ; la suite la modifie en disant d'où elle part (S8)", async () => {
  const { e, stockage, etats, ecritures } = essai();
  sq.poser(e.seq, 0, { d: 0, l: 4, h: 60 });
  ecritures.planifier();
  assert.equal(ecritures.occupe, true);
  await ecritures.vider();
  const [[quoi, id, fiche, pages]] = stockage.ecrits;
  assert.equal(quoi, "creer");
  assert.equal(id, "idee-1");
  assert.deepEqual(pages, []);
  assert.equal(fiche.type, "idee");
  assert.equal(fiche.statut, "idee");
  assert.match(fiche.abc, /^T:Idée du 5 oct\.$/m, "l'ABC est écrit d'après l'idée");
  assert.match(fiche.abc, /^C2 z6 \|\]$/m);
  assert.equal(fiche.creeLe, fiche.modifieLe);
  assert.equal(e.id, "idee-1", "l'idée ouverte a reçu son identifiant");
  assert.equal(e.session.derniere, fiche, "la version écrite devient la dernière connue");

  e.titre = "Refrain";
  ecritures.planifier(0);
  await ecritures.vider();
  const [quoi2, id2, fiche2, options] = stockage.ecrits[1];
  assert.deepEqual([quoi2, id2, fiche2.titre], ["modifier", "idee-1", "Refrain"]);
  assert.equal(options.depuis, fiche, "elle part de la version qu'elle connaissait");
  assert.equal(e.session.derniere, fiche2);
  assert.equal(etats.at(-1), "Enregistrée");
  assert.equal(ecritures.fiche().titre, "Refrain");
  assert.equal(ecritures.fiche().id, "idee-1");
});

test("ce qui part est l'idée du moment du geste, dans l'idée de ce moment-là (T4)", async () => {
  const { e, stockage, etats, ecritures } = essai();
  sq.poser(e.seq, 0, { d: 0, l: 4, h: 60 });
  ecritures.planifier(1000);
  // Une autre idée s'ouvre avant que l'écriture parte : elle ne la reçoit pas.
  const avant = e.session;
  e.session = { id: "autre", creeLe: "2026-10-01T00:00:00.000Z", cree: true, derniere: null };
  e.id = "autre";
  sq.poser(e.seq, 0, { d: 4, l: 4, h: 64 });
  await ecritures.vider();
  const [[quoi, id, fiche]] = stockage.ecrits;
  assert.deepEqual([quoi, id], ["creer", "idee-1"]);
  assert.equal(fiche.sequence.pistes[0].notes.length, 1, "le contenu pris au moment du geste");
  assert.equal(avant.id, "idee-1");
  assert.equal(e.id, "autre", "l'idée ouverte garde son identifiant");
  assert.equal(etats.includes("Enregistrée"), false, "la barre de l'autre idée n'en dit rien");
});

test("une écriture manquée se dit en français, dans la barre et tout haut (I13)", async (t) => {
  t.mock.method(console, "error", () => {});
  const { e, etats, messages, ecritures } = essai({ panne: new TypeError("Failed to fetch") });
  sq.poser(e.seq, 0, { d: 0, l: 4, h: 60 });
  ecritures.planifier(0);
  await ecritures.vider();
  assert.equal(etats.at(-1), "Non enregistrée : pas de connexion");
  assert.deepEqual(messages, ["L'idée n'a pas pu être enregistrée : pas de connexion. Réessaie quand le réseau sera revenu."]);
});

test("la copie de secours garde une idée neuve sous l'identifiant qu'elle aura", async (t) => {
  const cles = new Map();
  globalThis.localStorage = { getItem: (k) => cles.get(k) ?? null, setItem: (k, v) => cles.set(k, String(v)), removeItem: (k) => cles.delete(k) };
  t.after(() => { delete globalThis.localStorage; });
  const { e, stockage, ecritures } = essai();
  sq.poser(e.seq, 0, { d: 0, l: 4, h: 60 });
  ecritures.planifier(1000);
  viderTout({ fermeture: true });
  const [copie] = JSON.parse(cles.get("portee:secours"));
  assert.equal(copie.id, "idee-1");
  assert.equal(copie.creer, true);
  assert.equal(copie.donnees.type, "idee");
  assert.equal(e.id, "idee-1", "l'écriture qui suit prend le même identifiant");
  await ecritures.vider();
  assert.equal(stockage.ecrits[0][1], "idee-1");
});
