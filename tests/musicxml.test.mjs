/**
 * Le MusicXML d'une idée : bien formé, chaque voix remplit chaque mesure,
 * les liaisons vont par paires, et les hauteurs écrites redonnent les notes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ecrireMusicXml } from "../app/musicxml.js";
import { nouvelleSequence, poser, pasParMesure } from "../app/sequence.js";
import { voixCompletes } from "../app/harmonie.js";

/** Un lecteur de XML minimal : vérifie que les balises s'emboîtent, rend l'arbre. */
function lireXml(texte) {
  const racine = { nom: "#", enfants: [], texte: "" };
  const pile = [racine];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  const corps = texte.replace(/<\?xml[^>]*>/, "").replace(/<!DOCTYPE[^>]*>/, "");
  while ((m = re.exec(corps))) {
    if (m[5] !== undefined) { pile.at(-1).texte += m[5].trim(); continue; }
    const [, ferme, nom, attributs, vide] = m;
    if (ferme) { assert.equal(pile.pop().nom, nom, `balise </${nom}> mal placée`); continue; }
    const el = { nom, attributs: Object.fromEntries([...attributs.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])), enfants: [], texte: "" };
    pile.at(-1).enfants.push(el);
    if (!vide) pile.push(el);
  }
  assert.equal(pile.length, 1, "balises non fermées");
  return racine.enfants[0];
}
const enfants = (el, nom) => el.enfants.filter((x) => x.nom === nom);
const enfant = (el, nom) => el.enfants.find((x) => x.nom === nom);

function idee(notes, options = {}) {
  const seq = nouvelleSequence(options);
  for (const [d, l, h] of notes) poser(seq, 0, { d, l, h });
  return seq;
}

const PAS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

test("une idée avec syncopes, accord tenu, altérations et symboles d'accords", () => {
  const seq = idee([[0, 2, 60], [2, 4, 62], [6, 2, 66], [8, 12, 67], [8, 16, 48], [20, 4, 65]], { tonalite: "G" });
  seq.accords = [{ d: 0, nom: "G" }, { d: 16, nom: "F#m7/E" }];
  seq.accompagnement = "basse";
  const xml = ecrireMusicXml(seq, { voix: voixCompletes(seq), titre: "Essai & co" });
  const score = lireXml(xml);
  assert.equal(score.nom, "score-partwise");
  assert.equal(enfant(enfant(score, "work"), "work-title").texte, "Essai &amp; co");
  const parties = enfants(score, "part");
  assert.equal(parties.length, 2); // mélodie, accompagnement
  const mesure = pasParMesure(seq);
  const entendues = [];
  for (const partie of parties) {
    const ouvertes = new Map();
    let debutMesure = 0;
    for (const m of enfants(partie, "measure")) {
      const parVoix = new Map();
      let t = 0;
      for (const el of m.enfants) {
        if (el.nom === "backup") t -= Number(enfant(el, "duration").texte);
        if (el.nom === "forward") { const d = Number(enfant(el, "duration").texte); const v = enfant(el, "voice").texte; parVoix.set(v, (parVoix.get(v) || 0) + d); t += d; }
        if (el.nom !== "note") continue;
        const d = Number(enfant(el, "duration").texte);
        const v = enfant(el, "voice").texte;
        const accord = !!enfant(el, "chord");
        const debut = accord ? t - d : t;
        if (!accord) { parVoix.set(v, (parVoix.get(v) || 0) + d); t += d; }
        const p = enfant(el, "pitch");
        if (!p) continue;
        const h = 12 * (Number(enfant(p, "octave").texte) + 1) + PAS[enfant(p, "step").texte] + Number((enfant(p, "alter") || { texte: "0" }).texte);
        const liens = enfants(el, "tie").map((x) => x.attributs.type);
        // Une note liée continue la précédente de même hauteur.
        if (liens.includes("stop")) { const o = ouvertes.get(h); assert.ok(o, `liaison sans début (${h})`); o.l += d; if (!liens.includes("start")) { entendues.push(o); ouvertes.delete(h); } }
        else { const n = { d: debutMesure + debut, l: d, h }; if (liens.includes("start")) ouvertes.set(h, n); else entendues.push(n); }
      }
      for (const [v, total] of parVoix) assert.equal(total, mesure, `voix ${v}, mesure ${m.attributs.number}`);
      debutMesure += mesure;
    }
    assert.equal(ouvertes.size, 0, "liaison jamais refermée");
  }
  const attendues = voixCompletes(seq).flatMap((v) => v.notes.map((n) => [n.d, n.l, n.h]));
  const trier = (a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1];
  assert.deepEqual(entendues.map((n) => [n.d, n.l, n.h]).sort(trier), attendues.sort(trier));
  assert.match(xml, /<accidental>natural<\/accidental>/);     // fa bécarre en sol majeur
  assert.match(xml, /<root-step>F<\/root-step><root-alter>1<\/root-alter><\/root><kind text="m7">minor-seventh<\/kind><bass><bass-step>E<\/bass-step>/);
  assert.match(xml, /<fifths>1<\/fifths><mode>major<\/mode>/);
  assert.match(xml, /<per-minute>90<\/per-minute>/);
});
