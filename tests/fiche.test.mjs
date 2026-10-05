/**
 * Une fiche de la bibliothèque : remise en forme (S6) et fusion de deux
 * versions modifiées chacune de son côté (D4). Module pur (app/fiche.js).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EPOQUE, dateIso, egal, fusionnerFiches, normaliserChamps, normaliserFiche, sansDates } from "../app/fiche.js";

const seq = (notes, extra = {}) => ({ version: 1, tempo: 100, mesure: [4, 4], tonalite: "C", pistes: [{ nom: "Mélodie", notes }], accords: [], accompagnement: "aucun", suivant: 9, ...extra });
const idee = (extra = {}) => normaliserFiche({ type: "idee", titre: "Thème", sequence: seq([{ id: 1, d: 0, l: 4, h: 60 }]), etiquettes: [], favori: false, note: "", memo: null, creeLe: "2026-10-01T10:00:00.000Z", modifieLe: "2026-10-01T10:00:00.000Z", ...extra });
const page = (extra = {}) => normaliserFiche({ titre: "Valse", modele: "melodie-standard", abc: "X:1\nK:C\nC2|", abcLu: "X:1\nK:C\nC2|", doutes: [{ type: "mesure", message: "Il manque une croche", leve: false }], statut: "a-relire", nbPages: 1, creeLe: "2026-10-01T10:00:00.000Z", modifieLe: "2026-10-01T10:00:00.000Z", ...extra });
// Une version modifiée `minutes` plus tard. Comme l'éditeur, une idée refait son ABC quand ses notes ou son titre changent.
const plusTard = (f, minutes, extra = {}) => normaliserFiche({ ...f, ...extra, ...(f.type === "idee" && (extra.sequence || extra.titre) ? { abc: "" } : {}), modifieLe: new Date(Date.parse(f.modifieLe) + minutes * 60000).toISOString() });

test("S6 · une fiche empoisonnée ressort lisible : chaque champ reprend son type", () => {
  const f = normaliserFiche({
    type: "idee", titre: 42, etiquettes: 5, favori: "oui", note: 7, memo: { duree: "<img src=x onerror=alert(1)>", type: "text/html", base64: "AAAA" },
    sequence: "pas une séquence", tempo: "vite", transposition: 99, nbPages: -3, doutes: "aucun", blocs: { a: 1 }, modele: 3, modifieLe: "zzz",
  });
  assert.equal(f.titre, "42");
  assert.deepEqual(f.etiquettes, []);
  assert.equal(f.favori, false);
  assert.equal(f.note, "7");
  assert.deepEqual(f.memo, { duree: 0, type: "audio/webm" }, "ni texte dans la durée, ni son dans la fiche");
  assert.deepEqual(f.sequence.pistes, [{ nom: "Mélodie", notes: [] }]);
  assert.equal(f.tempo, undefined);
  assert.equal(f.transposition, 24);
  assert.equal(f.nbPages, 0);
  assert.deepEqual(f.doutes, []);
  assert.deepEqual(f.blocs, []);
  assert.equal(f.modele, null);
  assert.equal(f.modifieLe, EPOQUE, "une date illisible devient la plus ancienne");
  assert.match(f.abc, /^X:1/, "et l'ABC est refait");
  assert.equal(normaliserFiche(null), null);
  assert.equal(normaliserFiche([1, 2]), null);
  assert.equal(normaliserFiche("fiche"), null);
});

test("S6 · ce qui est déjà en forme ressort identique, et deux passages valent un", () => {
  for (const f of [idee({ etiquettes: ["jazz"], memo: { duree: 3, type: "audio/mp4" }, note: "au métro" }), page({ transposition: -2, tempo: 96, source: { remarkable: "abc", modifie: null }, apercu: [[[1, 2], [3, 4]]] }), normaliserFiche({ type: "morceau", titre: "Chanson", blocs: [{ id: "b1", idee: "i1", nom: "Intro", fois: 2 }], tempo: null, statut: "morceau", nbPages: 0, modele: null })]) {
    assert.deepEqual(normaliserFiche(f), f);
  }
  // Des fiches au hasard (graine fixe) : la remise en forme est idempotente.
  let graine = 7;
  const hasard = () => { graine = (graine * 16807) % 2147483647; return graine / 2147483647; };
  const valeurs = [null, undefined, 0, -1, 3.7, 1e9, "", "x", "2026-10-04T10:00:00.000Z", true, [], [1, "a"], {}, { a: 1 }, NaN];
  const choix = () => valeurs[Math.floor(hasard() * valeurs.length)];
  for (let k = 0; k < 300; k++) {
    const brute = { type: hasard() < 0.5 ? "idee" : hasard() < 0.5 ? "morceau" : undefined, titre: choix(), etiquettes: hasard() < 0.5 ? choix() : ["a", choix(), "A "], favori: choix(), note: choix(), memo: hasard() < 0.5 ? choix() : { duree: choix(), type: choix() }, modifieLe: choix(), creeLe: choix(), tempo: choix(), doutes: [choix(), { leve: choix(), message: choix() }], blocs: [choix(), { id: choix(), idee: choix(), fois: choix() }],
      sequence: hasard() < 0.3 ? choix() : seq([{ id: choix(), d: choix(), l: choix(), h: choix(), v: choix() }, { id: 1, d: 0, l: 4, h: 60 }, { id: 1, d: 4, l: 4, h: 62 }], { mesure: [choix(), choix()], tonalite: choix(), accords: [{ d: choix(), nom: choix() }, choix()] }), inconnu: choix() };
    const une = normaliserFiche(brute);
    assert.deepEqual(normaliserFiche(une), une, JSON.stringify(brute));
    if (une.sequence) assert.equal(new Set(une.sequence.pistes.flatMap((p) => p.notes.map((x) => x.id))).size, une.sequence.pistes.flatMap((p) => p.notes).length, "chaque note a son numéro");
  }
});

test("S6 · bornes et formes : dates sur 24 caractères, notes dans le clavier, un accord par position, des blocs distincts", () => {
  assert.equal(dateIso("2026-10-04"), "2026-10-04T00:00:00.000Z");
  assert.equal(dateIso("+275760-09-13T00:00:00.000Z"), "9999-12-31T23:59:59.999Z");
  assert.equal(dateIso("1900-01-01T00:00:00.000Z"), EPOQUE);
  assert.equal(dateIso({}), null);
  const f = normaliserFiche({ type: "idee", titre: "x", sequence: seq([{ id: 3, d: 0, l: 4, h: 200 }, { id: 3, d: 4, l: 0, h: 60 }, { id: "a", d: "8", l: 2.6, h: 64 }, { d: -5, l: 4, h: 62 }], { accords: [{ d: 0, nom: "C" }, { d: 0, nom: "Am" }, { d: 16, nom: "" }], mesure: [7, 3] }) });
  const notes = f.sequence.pistes[0].notes;
  assert.deepEqual(notes.map((x) => x.h), [108, 60, 64, 62], "les hauteurs restent sur le clavier du piano");
  assert.deepEqual(notes.map((x) => x.l), [4, 1, 3, 4]);
  assert.equal(notes[3].d, 0);
  assert.equal(new Set(notes.map((x) => x.id)).size, 4);
  assert.ok(f.sequence.suivant > Math.max(...notes.map((x) => x.id)));
  assert.deepEqual(f.sequence.accords, [{ d: 0, nom: "Am" }]);
  assert.deepEqual(f.sequence.mesure, [7, 4]);
  const m = normaliserFiche({ type: "morceau", titre: "M", blocs: [{ id: "b", idee: "i", nom: "Intro", fois: 40 }, { id: "b", idee: "j" }] });
  assert.deepEqual(m.blocs.map((b) => [b.id, b.fois]), [["b", 16], ["b-1", 1]]);
});

test("S6 · une idée écrite sans ABC (par Claude, par le connecteur) le retrouve depuis ses notes", () => {
  const f = normaliserFiche({ type: "idee", titre: "De Claude", abc: "", sequence: seq([{ id: 1, d: 0, l: 4, h: 60 }, { id: 2, d: 4, l: 4, h: 64 }], { accords: [{ d: 0, nom: "C" }], accompagnement: "plaque" }) });
  assert.match(f.abc, /T:De Claude/);
  assert.match(f.abc, /"C"C2 E2/);
  assert.match(f.abc, /V:2 clef=bass/, "l'accompagnement calculé est gravé, comme dans l'éditeur");
  assert.equal(f.statut, "idee");
  assert.equal(f.nbPages, 0);
  // Une page lue sans ABC reprend celui de la lecture.
  assert.equal(normaliserFiche({ titre: "Page", abcLu: "X:1\nK:C\nG2|" }).abc, "X:1\nK:C\nG2|");
});

test("S6 · un champ inconnu reste (une version plus récente l'a peut-être ajouté) ; ce qui est interne à la synchro part", () => {
  const f = normaliserFiche({ titre: "x", suggestions: [{ accords: ["C", "G"] }], pagesLe: "2026-10-01T10:00:00.000Z", id: "p1", fonction: () => 1, enorme: "x".repeat(200 * 1024) });
  assert.deepEqual(f.suggestions, [{ accords: ["C", "G"] }]);
  assert.equal("pagesLe" in f, false);
  assert.equal("id" in f, false);
  assert.equal("fonction" in f, false);
  assert.equal("enorme" in f, false, "trop lourd pour un champ inconnu");
  // Une modification partielle : seulement ses champs, remis en forme.
  assert.deepEqual(normaliserChamps({ favori: 1, etiquettes: "Jazz", pagesLe: "x" }), { favori: true, etiquettes: ["jazz"] });
});

test("egal et sansDates : l'ordre des clés et les dates ne comptent pas", () => {
  assert.ok(egal({ a: 1, b: [1, { c: 2, d: undefined }] }, { b: [1, { c: 2 }], a: 1 }));
  assert.ok(!egal({ a: [1, 2] }, { a: [2, 1] }));
  const f = idee();
  assert.ok(egal(sansDates(f), sansDates({ ...f, modifieLe: "2027-01-01T00:00:00.000Z", creeLe: EPOQUE })));
});

test("D4 · sans base, la plus récente gagne entière, comme avant", () => {
  const base = null, locale = idee({ titre: "Ici" }), distante = plusTard(idee({ titre: "Là-bas", favori: true }), 5);
  const r = fusionnerFiches({ base, locale, distante });
  assert.equal(r.donnees, distante);
  assert.equal(r.memo, "distante");
  assert.equal(r.copie, null);
});

test("D4 · chaque champ : celui qui l'a changé l'emporte ; changé des deux côtés, le plus récent", () => {
  const base = idee();
  const locale = plusTard(base, 1, { favori: true, titre: "Titre d'ici" });
  const distante = plusTard(base, 2, { note: "noté là-bas", titre: "Titre de là-bas" });
  const r = fusionnerFiches({ base, locale, distante });
  assert.equal(r.donnees.favori, true);
  assert.equal(r.donnees.note, "noté là-bas");
  assert.equal(r.donnees.titre, "Titre de là-bas", "le plus récent");
  assert.match(r.donnees.abc, /T:Titre de là-bas/, "l'ABC suit le titre gardé");
  assert.ok(r.donnees.modifieLe > distante.modifieLe, "plus récente que les deux");
  assert.equal(r.donnees.creeLe, base.creeLe);
});

test("D4 · les étiquettes : ajouts et retraits des deux côtés", () => {
  const base = idee({ etiquettes: ["jazz", "brouillon", "matin"] });
  const locale = plusTard(base, 1, { etiquettes: ["jazz", "matin", "pluie"] }); // retire brouillon, ajoute pluie
  const distante = plusTard(base, 2, { etiquettes: ["brouillon", "jazz", "soir"] }); // retire matin, ajoute soir
  assert.deepEqual(fusionnerFiches({ base, locale, distante }).donnees.etiquettes, ["jazz", "pluie", "soir"]);
});

test("D4 · les notes, une par une : ajouts gardés, retrait appliqué sauf si l'autre côté l'a changée, conflit au plus récent", () => {
  const n = (id, d, h, l = 4) => ({ id, d, l, h });
  const base = idee({ sequence: seq([n(1, 0, 60), n(2, 4, 62), n(3, 8, 64), n(4, 12, 65)], { suivant: 5 }) });
  // Ici : la 2 retirée, la 3 allongée, la 4 montée, une 5 ajoutée.
  const locale = plusTard(base, 1, { sequence: seq([n(1, 0, 60), n(3, 8, 64, 8), n(4, 12, 66), n(5, 16, 67)], { suivant: 6 }) });
  // Là-bas : la 3 retirée (mais elle a changé ici : elle reste), la 4 descendue (conflit), la 2 inchangée, une 5 à elle.
  const distante = plusTard(base, 2, { sequence: seq([n(1, 0, 60), n(2, 4, 62), n(4, 12, 64), n(5, 20, 69)], { suivant: 6 }) });
  const r = fusionnerFiches({ base, locale, distante }).donnees.sequence;
  const notes = r.pistes[0].notes;
  assert.deepEqual(notes.map((x) => [x.d, x.h, x.l]), [[0, 60, 4], [8, 64, 8], [12, 64, 4], [16, 67, 4], [20, 69, 4]]);
  assert.equal(new Set(notes.map((x) => x.id)).size, 5, "la 5 de là-bas a reçu un numéro neuf");
  assert.ok(r.suivant > Math.max(...notes.map((x) => x.id)));
  // La même note posée des deux côtés (même place, même hauteur) : une seule, la plus longue.
  const ici = plusTard(base, 1, { sequence: seq([...base.sequence.pistes[0].notes, n(5, 16, 67)], { suivant: 6 }) });
  const la = plusTard(base, 2, { sequence: seq([...base.sequence.pistes[0].notes, n(7, 16, 67, 8)], { suivant: 8 }) });
  const deux = fusionnerFiches({ base, locale: ici, distante: la }).donnees.sequence.pistes[0].notes;
  assert.deepEqual(deux.filter((x) => x.d === 16).map((x) => x.l), [8]);
});

test("D4 · une piste de basse ajoutée des deux côtés : ses notes se réunissent ; les accords, position par position", () => {
  const base = idee({ sequence: seq([{ id: 1, d: 0, l: 4, h: 60 }], { accords: [{ d: 0, nom: "C" }, { d: 16, nom: "F" }] }) });
  const basse = (notes) => ({ nom: "Basse", cle: "fa", notes });
  const locale = plusTard(base, 1, { sequence: { ...base.sequence, pistes: [...base.sequence.pistes, basse([{ id: 9, d: 0, l: 16, h: 36 }])], accords: [{ d: 0, nom: "C" }, { d: 16, nom: "Dm" }], suivant: 10 } });
  const distante = plusTard(base, 2, { sequence: { ...base.sequence, pistes: [...base.sequence.pistes, basse([{ id: 9, d: 16, l: 16, h: 41 }])], accords: [{ d: 0, nom: "Am" }, { d: 16, nom: "F" }, { d: 32, nom: "G" }], suivant: 10 } });
  const r = fusionnerFiches({ base, locale, distante }).donnees.sequence;
  assert.equal(r.pistes.length, 2);
  assert.deepEqual(r.pistes[1].notes.map((x) => x.h), [36, 41]);
  assert.deepEqual(r.accords, [{ d: 0, nom: "Am" }, { d: 16, nom: "Dm" }, { d: 32, nom: "G" }]);
});

test("D4 · le texte d'une page lue changé des deux côtés : la fiche garde celui d'ici, la version de là-bas part en copie", () => {
  const base = page();
  const locale = plusTard(base, 1, { abc: "X:1\nK:C\nE2|", statut: "prete" });
  const distante = plusTard(base, 2, { abc: "X:1\nK:C\nD2|", titre: "Valse lente", doutes: [{ type: "mesure", message: "Il manque une croche", leve: true }] });
  const r = fusionnerFiches({ base, locale, distante });
  assert.equal(r.donnees.abc, "X:1\nK:C\nE2|");
  assert.deepEqual(r.donnees.doutes, base.doutes, "les doutes vont avec le texte d'ici");
  assert.equal(r.donnees.statut, "prete");
  assert.equal(r.donnees.titre, "Valse lente", "le reste fusionne quand même");
  assert.equal(r.copie, distante);
  // Changé d'un seul côté : pas de copie.
  const seulement = fusionnerFiches({ base, locale: plusTard(base, 1, { favori: true }), distante });
  assert.equal(seulement.copie, null);
  assert.equal(seulement.donnees.abc, "X:1\nK:C\nD2|");
  assert.equal(seulement.donnees.favori, true);
});

test("D4 · le mémo : il vient du côté qui l'a changé (et le son, les pages, le suivent)", () => {
  const base = idee({ memo: null });
  const avec = (f, m) => plusTard(f, m, { memo: { duree: m, type: "audio/mp4" } });
  assert.equal(fusionnerFiches({ base, locale: avec(base, 1), distante: plusTard(base, 2, { favori: true }) }).memo, "locale");
  assert.equal(fusionnerFiches({ base, locale: plusTard(base, 2, { favori: true }), distante: avec(base, 1) }).memo, "distante");
  const r = fusionnerFiches({ base, locale: avec(base, 1), distante: avec(base, 3) });
  assert.equal(r.memo, "distante", "les deux : le plus récent");
  assert.deepEqual(r.donnees.memo, { duree: 3, type: "audio/mp4" });
});
