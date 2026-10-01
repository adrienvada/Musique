/**
 * LE FICHIER MIDI D'UNE IDÉE
 *
 * Une partition lue sur la tablette part en MIDI par abcjs. Une idée,
 * elle, a déjà ses notes au pas près : on écrit le fichier directement.
 * Format 1 : une piste de tempo (tempo, mesure, armure), puis une piste par
 * voix, nommée (« Mélodie », « Basse », « Accords »), chacune sur son canal.
 * Glissé dans Ableton, chaque voix arrive sur sa propre piste, au tempo de
 * l'idée.
 *
 * Sans dépendance (appli et tests).
 */
const PPQ = 480; // tics par noire ; un pas (double croche) = 120 tics

function vlq(n) {
  const octets = [n & 0x7f];
  while ((n >>= 7)) octets.unshift((n & 0x7f) | 0x80);
  return octets;
}

const texte = (s) => [...new TextEncoder().encode(s)];

function piste(evenements) {
  // evenements : [{ t (tics), octets }], triés ; on écrit les écarts.
  const corps = [];
  let avant = 0;
  for (const e of evenements) {
    corps.push(...vlq(e.t - avant), ...e.octets);
    avant = e.t;
  }
  corps.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...[24, 16, 8, 0].map((s) => (corps.length >>> s) & 0xff), ...corps];
}

const meta = (type, donnees) => [0xff, type, ...vlq(donnees.length), ...donnees];

/**
 * @param voix  [{ nom, notes: [{ d, l, h, v }] }] (d, l en pas)
 * @param options { tempo, mesure: [n, d], quintes, mineur, titre, transposition }
 * @returns Uint8Array
 */
export function fichierMidi(voix, { tempo = 90, mesure = [4, 4], quintes = 0, mineur = false, titre = "", transposition = 0 } = {}) {
  const tics = PPQ / 4;
  const microsecondes = Math.round(60000000 / tempo);
  const conducteur = [
    { t: 0, octets: meta(0x03, texte(titre || "Portée")) },
    { t: 0, octets: meta(0x51, [(microsecondes >> 16) & 0xff, (microsecondes >> 8) & 0xff, microsecondes & 0xff]) },
    { t: 0, octets: meta(0x58, [mesure[0], Math.round(Math.log2(mesure[1])), 24, 8]) },
    { t: 0, octets: meta(0x59, [(quintes + 256) & 0xff, mineur ? 1 : 0]) },
  ];
  const pistes = [piste(conducteur)];
  voix.forEach((v, i) => {
    const canal = i >= 9 ? i + 1 : i; // le canal 10 est celui des percussions
    const ev = [
      { t: 0, ordre: 0, octets: meta(0x03, texte(v.nom || `Voix ${i + 1}`)) },
      { t: 0, ordre: 0, octets: [0xc0 | canal, 0] }, // piano acoustique
    ];
    for (const n of v.notes) {
      const h = n.h + transposition;
      if (h < 0 || h > 127 || n.l <= 0) continue;
      const force = Math.max(1, Math.min(127, Math.round(n.v || 90)));
      ev.push({ t: n.d * tics, ordre: 2, octets: [0x90 | canal, h, force] });
      ev.push({ t: (n.d + n.l) * tics, ordre: 1, octets: [0x80 | canal, h, 0] });
    }
    // À tic égal : les fins de notes avant les débuts (une note répétée se rejoue).
    ev.sort((a, b) => a.t - b.t || a.ordre - b.ordre);
    pistes.push(piste(ev));
  });
  const entete = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, pistes.length, (PPQ >> 8) & 0xff, PPQ & 0xff];
  return new Uint8Array([...entete, ...pistes.flat()]);
}
