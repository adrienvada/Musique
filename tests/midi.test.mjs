/**
 * Le MIDI d'une idée : relu octet par octet, il doit redonner les pistes,
 * leurs noms, le tempo, la mesure, l'armure (et leurs changements) et chaque
 * note au tic près ; chaque piste finit à la barre, et une même note n'est
 * jamais rejouée pendant qu'elle sonne.
 */
import test from "node:test";
import assert from "node:assert/strict";
import abcjs from "abcjs";
import { fichierMidi, texteMidi, midiDeLaPage } from "../app/midi.js";

/** Un petit lecteur de MIDI, juste ce qu'il faut pour vérifier (indépendant de celui de l'appli). */
function lireMidi(octets) {
  let i = 0;
  const u32 = () => (octets[i++] << 24 | octets[i++] << 16 | octets[i++] << 8 | octets[i++]) >>> 0;
  const u16 = () => (octets[i++] << 8) | octets[i++];
  const vlq = () => { let v = 0, b; do { b = octets[i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  const texte = (n) => new TextDecoder().decode(octets.slice(i, (i += n)));
  assert.equal(texte(4), "MThd");
  assert.equal(u32(), 6);
  const format = u16(), nb = u16(), ppq = u16();
  const pistes = [];
  for (let p = 0; p < nb; p++) {
    assert.equal(texte(4), "MTrk");
    const fin = u32() + i;
    const piste = { nom: null, notes: [], meta: {}, mesures: [], armures: [], programme: null, fin: null, octetsDuNom: null };
    const ouvertes = new Map();
    let t = 0;
    while (i < fin) {
      t += vlq();
      const statut = octets[i++];
      if (statut === 0xff) {
        const type = octets[i++], n = vlq();
        const donnees = octets.slice(i, i + n);
        if (type === 0x03) { piste.octetsDuNom = [...donnees]; piste.nom = texte(n); } else i += n;
        if (type === 0x51) piste.meta.tempo = Math.round(60000000 / ((donnees[0] << 16) | (donnees[1] << 8) | donnees[2]));
        if (type === 0x58) { piste.mesures.push([t, donnees[0], 2 ** donnees[1]]); piste.meta.mesure ??= [donnees[0], 2 ** donnees[1]]; }
        if (type === 0x59) { piste.armures.push([t, (donnees[0] << 24) >> 24, donnees[1]]); piste.meta.armure ??= [(donnees[0] << 24) >> 24, donnees[1]]; }
        if (type === 0x2f) { assert.equal(i, fin); piste.fin = t; }
      } else if ((statut & 0xf0) === 0x90 && octets[i + 1] > 0) {
        assert.ok(!ouvertes.has(octets[i]), `note ${octets[i]} rejouée à ${t} pendant qu'elle sonne`);
        ouvertes.set(octets[i], { t, h: octets[i], v: octets[i + 1], canal: statut & 15 });
        i += 2;
      } else if ((statut & 0xf0) === 0x80 || (statut & 0xf0) === 0x90) {
        const o = ouvertes.get(octets[i]);
        piste.notes.push([o.t, t - o.t, o.h, o.v, o.canal]);
        ouvertes.delete(octets[i]);
        i += 2;
      } else if ((statut & 0xf0) === 0xc0) {
        piste.programme = octets[i++];
      } else {
        throw new Error("événement inattendu " + statut.toString(16));
      }
    }
    pistes.push(piste);
  }
  return { format, ppq, pistes };
}

test("une piste de tempo, puis une piste nommée par voix", () => {
  const midi = lireMidi(fichierMidi([
    { nom: "Mélodie", notes: [{ d: 0, l: 4, h: 60 }, { d: 4, l: 2, h: 64, v: 110 }, { d: 6, l: 2, h: 64 }] },
    { nom: "Accords", notes: [{ d: 0, l: 16, h: 48 }, { d: 0, l: 16, h: 55 }] },
  ], { tempo: 132, mesure: [6, 8], quintes: -3, mineur: true, titre: "Idée du matin" }));
  assert.equal(midi.format, 1);
  assert.equal(midi.ppq, 480);
  assert.equal(midi.pistes.length, 3);
  const [conducteur, melodie, accords] = midi.pistes;
  // Les noms en ASCII : aucun logiciel ne peut les lire de travers.
  assert.equal(conducteur.nom, "Idee du matin");
  assert.deepEqual(conducteur.meta, { tempo: 132, mesure: [6, 8], armure: [-3, 1] });
  assert.equal(melodie.nom, "Melodie");
  assert.ok(melodie.octetsDuNom.every((o) => o < 128));
  assert.equal(melodie.programme, 0);
  // Une double croche = 120 tics ; la note répétée se rejoue (fin avant début).
  assert.deepEqual(melodie.notes, [[0, 480, 60, 90, 0], [480, 240, 64, 110, 0], [720, 240, 64, 90, 0]]);
  assert.deepEqual(accords.notes.map((n) => n.slice(0, 3)), [[0, 1920, 48], [0, 1920, 55]]);
  assert.ok(accords.notes.every((n) => n[4] === 1));
});

test("transposition, notes hors du clavier MIDI ignorées, canal 10 évité", () => {
  const voix = Array.from({ length: 11 }, (_, i) => ({ nom: `V${i}`, notes: [{ d: i, l: 1, h: 60 + i }] }));
  voix[0].notes.push({ d: 0, l: 1, h: 126 });
  const midi = lireMidi(fichierMidi(voix, { transposition: 2 }));
  assert.deepEqual(midi.pistes[1].notes.map((n) => n[2]), [62]);
  assert.deepEqual(midi.pistes.slice(1).map((p) => p.notes[0][4]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
});

test("chaque piste finit à la barre, pas à la dernière note", () => {
  // Une note qui finit au pas 22, en 4/4 : la musique finit à la barre du pas 32.
  const midi = lireMidi(fichierMidi([{ nom: "Mélodie", notes: [{ d: 0, l: 4, h: 60 }, { d: 18, l: 4, h: 62 }] }], { mesure: [4, 4] }));
  assert.deepEqual(midi.pistes.map((p) => p.fin), [32 * 120, 32 * 120]);
  // En 3/4 (12 pas par mesure) : la barre du pas 24.
  const valse = lireMidi(fichierMidi([{ nom: "Mélodie", notes: [{ d: 0, l: 14, h: 60 }] }], { mesure: [3, 4] }));
  assert.equal(valse.pistes[1].fin, 24 * 120);
  // Celui qui sait où finit l'idée le dit (une mesure de silence au bout, par exemple).
  assert.equal(lireMidi(fichierMidi([{ nom: "M", notes: [{ d: 0, l: 4, h: 60 }] }], { fin: 48 })).pistes[1].fin, 48 * 120);
});

test("une même note n'est jamais rejouée pendant qu'elle sonne : la première s'arrête juste avant", () => {
  // Deux do posés sur la grille qui se chevauchent, un mi de même début et de durées différentes.
  const midi = lireMidi(fichierMidi([{ nom: "M", notes: [{ d: 0, l: 8, h: 60 }, { d: 4, l: 8, h: 60 }, { d: 16, l: 4, h: 64 }, { d: 16, l: 8, h: 64 }] }]));
  assert.deepEqual(midi.pistes[1].notes.map((n) => n.slice(0, 3)), [[0, 480, 60], [480, 960, 60], [1920, 960, 64]]);
});

test("les changements de mesure et d'armure en cours de route, et les temps hors du pas (triolets)", () => {
  const midi = lireMidi(fichierMidi([{ nom: "M", notes: [{ d: 0, l: 4 / 3, h: 60 }, { d: 4 / 3, l: 4 / 3, h: 62 }, { d: 8 / 3, l: 4 / 3, h: 64 }, { d: 16, l: 12, h: 67 }] }], {
    mesure: [4, 4], quintes: 0, changements: [{ d: 16, mesure: [3, 4], quintes: 1, mineur: false }],
  }));
  const [conducteur, voix] = midi.pistes;
  assert.deepEqual(conducteur.mesures, [[0, 4, 4], [1920, 3, 4]]);
  assert.deepEqual(conducteur.armures, [[0, 0, 0], [1920, 1, 0]]);
  // Un triolet de croches : 160 tics chacune, exactement.
  assert.deepEqual(voix.notes.slice(0, 3).map((n) => n.slice(0, 2)), [[0, 160], [160, 160], [320, 160]]);
  // La fin suit la mesure en vigueur : la barre du 3/4 qui suit le pas 28.
  assert.equal(voix.fin, 28 * 120);
  // Mesure libre (M:none) : pas de chiffrage au début.
  assert.deepEqual(lireMidi(fichierMidi([{ nom: "M", notes: [{ d: 0, l: 4, h: 60 }] }], { mesure: null })).pistes[0].mesures, []);
});

test("une page lue : pistes nommées par main, sans piste vide, ses changements gardés", () => {
  // Deux mains : « Main droite », « Main gauche », et rien d'autre (abcjs ajoutait une piste vide, sans nom).
  const piano = lireMidi(midiDeLaPage("X:1\nM:4/4\nL:1/8\nQ:1/4=90\nK:C\n%%score {1 2}\nV:1 clef=treble\nV:2 clef=bass\n[V:1] GABc dcAG |\n[V:2] C,2 z2 G,,2 z2 ||\n", abcjs, { titre: "Page de piano" }));
  assert.deepEqual(piano.pistes.map((p) => p.nom), ["Page de piano", "Main droite", "Main gauche"]);
  assert.deepEqual(piano.pistes.map((p) => p.notes.length), [0, 8, 2]);
  // La page de mélodie : la gamme en mesure libre, puis mi♭ et 12/8 après une levée d'une croche.
  const melodie = lireMidi(midiDeLaPage("X:1\nM:none\nL:1/8\nQ:1/4=90\nK:C\nC2 D2 E2 F2 G2 A2 B2 c2\n[K:Eb][M:12/8]G |: c2 c2 edc g2 GG G :|\n", abcjs));
  const [conducteur, voix] = melodie.pistes;
  assert.equal(voix.nom, "Melodie");
  assert.deepEqual(conducteur.armures, [[0, 0, 0], [32 * 120, -3, 0]]);
  assert.deepEqual(conducteur.mesures, [[32 * 120, 1, 8], [34 * 120, 12, 8]], "la levée, puis le 12/8 à la barre");
  // Les notes à leur durée écrite, et la fin à la barre du 12/8.
  assert.deepEqual(voix.notes.slice(0, 2).map((n) => n.slice(0, 3)), [[0, 480, 60], [480, 480, 62]]);
  assert.equal((voix.fin - 34 * 120) % (24 * 120), 0);
  // Un triolet reste un triolet (160 tics la croche), la transposition et le tempo suivent les réglages.
  const triolet = lireMidi(midiDeLaPage("X:1\nM:2/4\nL:1/8\nQ:1/4=90\nK:C\n(3CDE G2|c4|]\n", abcjs, { tempo: 120, transposition: 2 }));
  assert.deepEqual(triolet.pistes[1].notes.slice(0, 3).map((n) => n.slice(0, 3)), [[0, 160, 62], [160, 160, 64], [320, 160, 66]]);
  assert.equal(triolet.pistes[0].meta.tempo, 120);
});

test("les textes en ASCII : accents, signes et guillemets", () => {
  assert.equal(texteMidi("Mélodie"), "Melodie");
  assert.equal(texteMidi("Basse des accords"), "Basse des accords");
  assert.equal(texteMidi("« Idée » — fa♯, si♭ ’n’ Œuvre"), '"Idee" - fa#, sib \'n\' OEuvre');
  assert.equal(texteMidi("Ça déménage 🎵"), "Ca demenage");
});
