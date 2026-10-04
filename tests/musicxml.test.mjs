/**
 * Le MusicXML d'une idée : bien formé, chaque voix remplit chaque mesure,
 * les liaisons vont par paires, et les hauteurs écrites redonnent les notes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { ecrireMusicXml, musicXmlDeLaPage } from "../app/musicxml.js";
import { nouvelleSequence, poser, pasParMesure } from "../app/sequence.js";
import { voixCompletes } from "../app/harmonie.js";
import { musicXmlDuMorceau, assembler } from "../app/morceau.js";

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

test("les notes de l'accompagnement s'épellent comme leur accord", () => {
  // Ré 7 en fa majeur, E7 et B7 en do : fa♯, sol♯, ré♯ (MuseScore recevait sol♭, la♭, mi♭).
  const hauteurs = (xml) => [...xml.matchAll(/<step>([A-G])<\/step>(?:<alter>(-?\d)<\/alter>)?/g)].map((m) => m[1] + ({ "-1": "b", 1: "#" }[m[2]] || ""));
  const enFa = idee([[0, 16, 72]], { tonalite: "F" });
  enFa.accords = [{ d: 0, nom: "D7" }];
  enFa.accompagnement = "plaque";
  const fa = hauteurs(ecrireMusicXml(enFa, { voix: voixCompletes(enFa) }));
  assert.ok(fa.includes("F#") && !fa.includes("Gb"), fa.join(" "));
  const enDo = idee([[0, 16, 76], [16, 16, 75]]);
  enDo.accords = [{ d: 0, nom: "E7" }, { d: 16, nom: "B7" }];
  enDo.accompagnement = "arpege";
  const ut = hauteurs(ecrireMusicXml(enDo, { voix: voixCompletes(enDo) }));
  assert.ok(ut.includes("G#") && ut.includes("D#") && ut.includes("F#"), ut.join(" "));
  assert.ok(!ut.some((n) => n.endsWith("b")), ut.join(" "));
});

test("12/8 : la mesure entière en ronde pointée, et chaque temps visible", () => {
  const seq = idee([[0, 24, 63], [24, 16, 66], [40, 8, 65]], { mesure: [12, 8], tonalite: "Ebm" });
  const score = lireXml(ecrireMusicXml(seq));
  const [m1, m2] = enfants(enfants(score, "part")[0], "measure");
  const notes = (m) => enfants(m, "note").map((n) => [Number(enfant(n, "duration").texte), enfant(n, "type").texte + (enfant(n, "dot") ? "." : "")]);
  assert.deepEqual(notes(m1), [[24, "whole."]]);
  // Trois temps (blanche pointée) liés à une noire, puis une croche liée au dernier temps.
  assert.deepEqual(notes(m2), [[12, "half."], [4, "quarter"], [2, "eighth"], [6, "quarter."]]);
});

/**
 * Relit une partition MusicXML : chaque voix remplit chaque mesure (sauf une
 * levée, « implicit »), les liaisons se referment, et rend les notes jouées
 * [début, durée, hauteur], les chiffrages et armures par mesure, les accords.
 */
function relire(xml) {
  const score = lireXml(xml);
  const entendues = [], attributs = [], symboles = [];
  for (const partie of enfants(score, "part")) {
    const ouvertes = new Map();
    let debutMesure = 0, longueur = 16;
    enfants(partie, "measure").forEach((m, i) => {
      for (const at of enfants(m, "attributes")) {
        const time = enfant(at, "time"), key = enfant(at, "key");
        if (time) longueur = (Number(enfant(time, "beats").texte) * 16) / Number(enfant(time, "beat-type").texte);
        attributs.push([i + 1, time ? `${enfant(time, "beats").texte}/${enfant(time, "beat-type").texte}` : null, key ? Number(enfant(key, "fifths").texte) : null]);
      }
      const parVoix = new Map();
      let t = 0;
      for (const el of m.enfants) {
        if (el.nom === "harmony") symboles.push(enfant(enfant(el, "root"), "root-step").texte + enfant(el, "kind").attributs.text);
        if (el.nom === "backup") t -= Number(enfant(el, "duration").texte);
        if (el.nom === "forward") { const d = Number(enfant(el, "duration").texte); parVoix.set(enfant(el, "voice").texte, (parVoix.get(enfant(el, "voice").texte) || 0) + d); t += d; }
        if (el.nom !== "note") continue;
        const d = Number(enfant(el, "duration").texte), v = enfant(el, "voice").texte, accord = !!enfant(el, "chord");
        const debut = accord ? t - d : t;
        if (!accord) { parVoix.set(v, (parVoix.get(v) || 0) + d); t += d; }
        const p = enfant(el, "pitch");
        if (!p) continue;
        const h = 12 * (Number(enfant(p, "octave").texte) + 1) + PAS[enfant(p, "step").texte] + Number((enfant(p, "alter") || { texte: "0" }).texte);
        const liens = enfants(el, "tie").map((x) => x.attributs.type);
        if (liens.includes("stop")) { const o = ouvertes.get(h); assert.ok(o, `liaison sans début (${h})`); o.l += d; if (!liens.includes("start")) { entendues.push(o); ouvertes.delete(h); } }
        else { const n = { d: debutMesure + debut, l: d, h }; if (liens.includes("start")) ouvertes.set(h, n); else entendues.push(n); }
      }
      const pleine = Math.max(...parVoix.values(), 0);
      if (m.attributs.implicit !== "yes") for (const [v, total] of parVoix) assert.equal(total, longueur, `voix ${v}, mesure ${i + 1}`);
      debutMesure += m.attributs.implicit === "yes" ? pleine : longueur;
    });
    assert.equal(ouvertes.size, 0, "liaison jamais refermée");
  }
  const trier = (a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1];
  return { notes: entendues.map((n) => [n.d, n.l, n.h]).sort(trier), attributs, symboles, xml };
}

test("les symboles d'accords que MusicXML n'a pas : 7sus4, add9, madd9 (avec leurs degrés)", () => {
  const seq = idee([[0, 16, 67], [16, 16, 64], [32, 16, 74], [48, 16, 72]]);
  seq.accords = [{ d: 0, nom: "G7sus4" }, { d: 16, nom: "Cadd9" }, { d: 32, nom: "Dmadd9" }, { d: 48, nom: "Gsus4" }];
  const xml = ecrireMusicXml(seq);
  // music21 relisait « Gsus » pour G7sus4 et un do majeur pour Cadd9 : il lit maintenant « Gsus add b7 », « C add 9 », « Dm add 9 ».
  assert.match(xml, /<kind text="7sus4">suspended-fourth<\/kind><degree><degree-value>7<\/degree-value><degree-alter>-1<\/degree-alter><degree-type>add<\/degree-type><\/degree>/);
  assert.match(xml, /<kind text="add9">major<\/kind><degree><degree-value>9<\/degree-value><degree-alter>0<\/degree-alter><degree-type>add<\/degree-type><\/degree>/);
  assert.match(xml, /<kind text="madd9">minor<\/kind><degree><degree-value>9<\/degree-value>/);
  assert.match(xml, /<kind text="sus4">suspended-fourth<\/kind><\/harmony>/, "un sus4 simple n'a pas de degré");
});

test("le tempo dans l'unité du temps : la noire pointée en 6/8 et 12/8", () => {
  const six = ecrireMusicXml(idee([[0, 12, 62]], { mesure: [6, 8], tempo: 90 }));
  assert.match(six, /<metronome><beat-unit>quarter<\/beat-unit><beat-unit-dot\/><per-minute>60<\/per-minute><\/metronome><\/direction-type><sound tempo="90"\/>/);
  assert.match(ecrireMusicXml(idee([[0, 24, 62]], { mesure: [12, 8], tempo: 100 })), /<beat-unit-dot\/><per-minute>67<\/per-minute>.*<sound tempo="100"\/>/s);
  assert.match(ecrireMusicXml(idee([[0, 12, 62]], { mesure: [3, 4], tempo: 90 })), /<beat-unit>quarter<\/beat-unit><per-minute>90<\/per-minute>/);
});

test("un morceau en MusicXML : ses blocs bout à bout, chacun avec sa mesure, sa tonalité et ses accords", () => {
  const bloc = (id, notes, options, accords) => {
    const s = idee(notes, options);
    s.accords = accords;
    s.accompagnement = "plaque";
    return { id, type: "idee", titre: id, sequence: s };
  };
  const idees = new Map([
    ["a", bloc("a", [[0, 16, 60], [16, 16, 64]], {}, [{ d: 0, nom: "C" }, { d: 16, nom: "Am" }])],
    ["b", bloc("b", [[0, 4, 67], [4, 4, 71], [8, 4, 74], [12, 12, 79]], { mesure: [3, 4], tonalite: "G" }, [{ d: 0, nom: "G" }, { d: 12, nom: "D7" }])],
  ]);
  const morceau = { titre: "Chanson", tempo: 100, blocs: [{ id: 1, idee: "a", nom: "Couplet", fois: 2 }, { id: 2, idee: "b", nom: "Refrain", fois: 1 }] };
  const lu = relire(musicXmlDuMorceau(morceau, idees));
  // Le 3/4 et l'armure de sol à la 5ᵉ mesure (deux fois deux mesures de 4/4 avant), pour chaque portée.
  assert.deepEqual(lu.attributs.filter((a) => a[0] === 5).map((a) => [a[1], a[2]]), [["3/4", 1], ["3/4", 1]]);
  assert.deepEqual(lu.symboles, ["C", "Am", "C", "Am", "G", "D7"]);
  // Toutes les notes de l'assemblage, accompagnement compris.
  const attendues = assembler(morceau, idees).voix.flatMap((v) => v.notes.map((n) => [n.d, n.l, n.h]));
  const trier = (a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1];
  assert.deepEqual(lu.notes, attendues.sort(trier));
  assert.match(lu.xml, /<work-title>Chanson<\/work-title>/);
});

test("une page lue en MusicXML : ses changements, sa levée, et la transposition de l'écoute", () => {
  const abc = "X:1\nM:none\nL:1/8\nQ:1/4=90\nK:C\nC2 D2 E2 F2 G2 A2 B2 c2\n[K:Eb][M:12/8]G |: c2 c2 edc g2 GG G :|\n";
  const lu = relire(musicXmlDeLaPage(abc, abcjs, { titre: "Page" }));
  // La gamme en 4/4 (mesure libre), puis mi♭ et 12/8 sur la levée (une mesure incomplète, la 3ᵉ).
  assert.deepEqual(lu.attributs.map((a) => [a[0], a[1], a[2]]), [[1, "4/4", 0], [3, "12/8", -3]]);
  assert.match(lu.xml, /<measure number="3" implicit="yes">/);
  assert.match(lu.xml, /<beat-unit-dot\/><per-minute>60<\/per-minute>/, "le tempo repasse à la noire pointée");
  assert.equal(lu.notes.length, 8 + 1 + 2 * 9);
  // Transposée de deux demi-tons, comme à l'écoute : ré majeur, puis fa majeur ; chaque note deux demi-tons plus haut.
  const haut = relire(musicXmlDeLaPage(abc, abcjs, { transposition: 2 }));
  assert.deepEqual(haut.attributs.map((a) => a[2]), [2, -1]);
  assert.deepEqual(haut.notes, lu.notes.map(([d, l, h]) => [d, l, h + 2]));
  // Un triolet s'arrondit sans trou (double, croche, double) : la mise en mesures vit au pas.
  const triolet = relire(musicXmlDeLaPage("X:1\nM:2/4\nL:1/8\nQ:1/4=90\nK:C\n(3CDE G2|c4|]\n", abcjs));
  assert.deepEqual(triolet.notes.slice(0, 3), [[0, 1, 60], [1, 2, 62], [3, 1, 64]]);
});
