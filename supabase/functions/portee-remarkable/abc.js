/**
 * UNE PARTITION DE SECOURS POUR UNE IDÉE SANS ABC
 *
 * Une idée notée par Claude (idee_ecrire) arrive sans ABC : c'est l'appli
 * qui l'écrit d'après les notes, avec tout son soin (couches, liaisons au
 * temps, épellation, accompagnement), quand elle la reçoit. Si Claude veut
 * la montrer tout de suite dans la conversation (partition_montrer), ce
 * module en écrit une version simple : la mélodie (la première piste), ses
 * accords, les silences, et les liaisons d'une mesure à l'autre.
 *
 * Simplifications, voulues : des notes qui partent ensemble font un accord
 * (de la plus longue durée du groupe) ; une note encore tenue quand la
 * suivante part s'arrête là. Le connecteur est déployé seul : il ne peut pas
 * reprendre app/sequence.js, et une seconde copie de tout ce code
 * divergerait. Un test vérifie qu'abcjs y relit les bonnes notes.
 */
const NATUREL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTRES = "CDEFGAB";
const QUINTES = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, "G#": 8, "D#": 9, "A#": 10, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const SIGNES = { "-2": "__", "-1": "_", 0: "=", 1: "^", 2: "^^" };
// Les durées d'un seul signe, en pas (double croche) : ronde, blanche
// pointée, blanche, noire pointée, noire, croche pointée, croche, double.
const NOTABLES = [16, 12, 8, 6, 4, 3, 2, 1];
const MAX_NOTES = 4000;
const MAX_PAS = 256 * 32; // 256 mesures de 8/4 au plus
const mod12 = (x) => ((x % 12) + 12) % 12;

function lireTonalite(t) {
  const m = /^([A-G][#b]?)(m?)$/.exec(t || "") || [null, "C", ""];
  const quintes = (QUINTES[m[1]] ?? 0) - (m[2] ? 3 : 0);
  const armure = {};
  for (let i = 0; i < Math.min(7, Math.abs(quintes)); i++) armure[(quintes > 0 ? "FCGDAEB" : "BEADGCF")[i]] = quintes > 0 ? 1 : -1;
  return { nom: m[0] || "C", quintes, armure };
}

/** La lettre et l'altération d'une hauteur : celle de l'armure, sinon naturelle, sinon un dièse (ou un bémol en ton à bémols). */
function epeler(h, k) {
  const pc = mod12(h);
  const sens = k.quintes < 0 ? -1 : 1;
  for (const alt of [(l) => k.armure[l] || 0, () => 0, () => sens, () => -sens]) {
    for (const l of LETTRES) {
      const a = alt(l);
      if (mod12(NATUREL[l] + a) === pc) return { lettre: l, alt: a, octave: Math.round((h - NATUREL[l] - a) / 12) - 1 };
    }
  }
}

const lettreAbc = ({ lettre, octave }) => (octave >= 5 ? lettre.toLowerCase() + "'".repeat(octave - 5) : lettre + ",".repeat(Math.max(0, 4 - octave)));
const duree = (l) => (l === 1 ? "" : String(l)); // L:1/16 : un pas, une double croche

/** L'ABC d'une idée (sa séquence), pour la graver et la jouer quand elle n'en a pas encore. */
export function abcDeSecours(sequence, titre = "") {
  const s = sequence || {};
  const [n, d] = Array.isArray(s.mesure) && s.mesure.length === 2 && s.mesure.every((x) => Number.isInteger(x) && x > 0) ? s.mesure : [4, 4];
  const mesure = (n * 16) / d;
  const k = lireTonalite(s.tonalite);
  const tempo = Number.isInteger(s.tempo) && s.tempo > 0 ? s.tempo : 90;
  const valide = (x) => x && Number.isInteger(x.d) && x.d >= 0 && Number.isInteger(x.l) && x.l > 0 && x.d + x.l <= MAX_PAS && Number.isInteger(x.h) && x.h >= 0 && x.h <= 127;
  const notes = (((s.pistes && s.pistes[0] && s.pistes[0].notes) || []).filter(valide)).slice(0, MAX_NOTES);

  // Les événements : ce qui part au même instant, coupé où le suivant commence.
  const groupes = new Map();
  for (const x of notes) {
    if (!groupes.has(x.d)) groupes.set(x.d, []);
    groupes.get(x.d).push(x);
  }
  const debuts = [...groupes.keys()].sort((a, b) => a - b);
  const evenements = debuts.map((debut, i) => ({
    d: debut,
    f: Math.min(Math.max(...groupes.get(debut).map((x) => x.d + x.l)), debuts[i + 1] ?? Infinity),
    hauteurs: [...new Set(groupes.get(debut).map((x) => x.h))].sort((a, b) => a - b),
  }));
  const accords = new Map((s.accords || []).filter((a) => a && Number.isInteger(a.d) && a.d >= 0 && a.d < MAX_PAS && /^[A-G][#b]?[a-z0-9#/]*$/i.test(a.nom || "")).map((a) => [a.d, a.nom]));
  const fin = Math.max(0, ...evenements.map((e) => e.f), ...[...accords.keys()].map((x) => x + 1));
  const total = Math.max(1, Math.ceil(fin / mesure)) * mesure;

  // Les bornes : les barres, les débuts et fins d'événements, les accords.
  const bornes = new Set([0, total, ...accords.keys()]);
  for (let x = mesure; x < total; x += mesure) bornes.add(x);
  for (const e of evenements) { bornes.add(e.d); bornes.add(e.f); }
  const liste = [...bornes].filter((x) => x >= 0 && x <= total).sort((a, b) => a - b);
  const mesures = Array.from({ length: total / mesure }, () => []);
  for (let i = 0; i + 1 < liste.length; i++) {
    const e = evenements.find((x) => x.d <= liste[i] && x.f > liste[i]) || null;
    for (let x = liste[i]; x < liste[i + 1];) {
      const l = NOTABLES.find((v) => v <= liste[i + 1] - x);
      mesures[Math.floor(x / mesure)].push({ a: x, l, e, lie: !!e && x + l < e.f });
      x += l;
    }
  }

  const lignes = ["X:1"];
  if (titre) lignes.push("T:" + String(titre).replace(/[\r\n]+/g, " "));
  lignes.push(`M:${n}/${d}`, "L:1/16", `Q:1/4=${tempo}`, `K:${k.nom}`);
  let corps = "";
  mesures.forEach((jetons, m) => {
    // Une altération vaut jusqu'à la barre, pour la même note à la même
    // octave. Comme dans l'appli (app/sequence.js) : la suite d'une liaison
    // garde sa hauteur sans redire l'altération, mais abcjs ne la compte pas
    // pour les notes suivantes ; la même note neuve, après, redit la sienne
    // (NaN : rien de sûr en vigueur).
    const enVigueur = new Map();
    for (const t of jetons) {
      corps += " ";
      if (accords.has(t.a)) corps += `"${accords.get(t.a)}"`;
      if (!t.e) { corps += "z" + duree(t.l); continue; }
      const suite = t.a > t.e.d;
      const ecrites = t.e.hauteurs.map((h) => {
        const ep = epeler(h, k);
        const cle = ep.lettre + ep.octave;
        if (suite) {
          if (!enVigueur.has(cle)) enVigueur.set(cle, NaN);
          return lettreAbc(ep);
        }
        const avant = enVigueur.has(cle) ? enVigueur.get(cle) : (k.armure[ep.lettre] || 0);
        enVigueur.set(cle, ep.alt);
        return (avant === ep.alt ? "" : SIGNES[ep.alt]) + lettreAbc(ep);
      });
      corps += (ecrites.length > 1 ? `[${ecrites.join("")}]` : ecrites[0]) + duree(t.l) + (t.lie ? "-" : "");
    }
    corps += m === mesures.length - 1 ? " |]\n" : (m + 1) % 4 === 0 ? " |\n" : " |";
  });
  return lignes.join("\n") + "\n" + corps.replace(/^ /gm, "");
}
