/**
 * LIRE LES TRAITS D'UNE PAGE .rm (format v6, logiciel 3.x de la reMarkable)
 *
 * Portage minimal de rmscene (ricklupton, MIT) : on ne garde que les traits
 * (« lignes »). Le fichier est une suite de blocs ; chaque bloc de type 5
 * décrit une ligne : outil, couleur, épaisseur, puis ses points.
 *
 * Les coordonnées de la tablette ont leur abscisse centrée sur la page et
 * leur ordonnée partant du haut. Sur un document PDF, elles comptent 227
 * unités par pouce, pas 226 comme l'écran : mesuré le 30/09 sur les deux
 * pages d'essai d'Adrien, trait pour trait contre leur export PDF (écart
 * résiduel 0,2 px). Sans cette correction, le bas de la page glisse de
 * 3 à 4 px, assez pour lire une note un cran trop bas. On les ramène dans
 * le repère des modèles Portée : pixels de l'écran à 226 ppp, origine en
 * haut à gauche.
 *
 * Le module est en JavaScript pur : le connecteur (Deno, Supabase) et les
 * tests (Node) l'utilisent tel quel.
 */

const ENTETE = "reMarkable .lines file, version=6          ";
const BLOC_LIGNE = 0x05;
// Outils à ignorer : ils n'écrivent pas de musique.
const GOMMES = new Set([6, 8]);
const SURLIGNEURS = new Set([5, 18]);
const DEMI_LARGEUR = 702;
const ECHELLE = 226 / 227;

class Flux {
  constructor(octets) {
    this.o = octets;
    this.v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
    this.p = 0;
  }
  reste() { return this.o.length - this.p; }
  u8() { return this.o[this.p++]; }
  u16() { const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  u32() { const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  f32() { const x = this.v.getFloat32(this.p, true); this.p += 4; return x; }
  f64() { const x = this.v.getFloat64(this.p, true); this.p += 8; return x; }
  varuint() {
    let r = 0, decalage = 0;
    for (;;) {
      const b = this.u8();
      r += (b & 0x7f) * 2 ** decalage;
      if (!(b & 0x80)) return r;
      decalage += 7;
    }
  }
  etiquette(index, type) {
    const x = this.varuint();
    if (x >> 4 !== index || (x & 0xf) !== type) throw new Error(`étiquette inattendue à ${this.p}`);
  }
  /** Regarde l'étiquette suivante sans avancer. */
  prochaine(index, type) {
    const p = this.p;
    try { const x = this.varuint(); return x >> 4 === index && (x & 0xf) === type; }
    catch { return false; }
    finally { this.p = p; }
  }
  id(index) { this.etiquette(index, 0xf); return [this.u8(), this.varuint()]; }
  entier(index) { this.etiquette(index, 0x4); return this.u32(); }
  reel(index) { this.etiquette(index, 0x4); return this.f32(); }
  double(index) { this.etiquette(index, 0x8); return this.f64(); }
  sousBloc(index) { this.etiquette(index, 0xc); return this.u32(); }
}

/**
 * @param octets   contenu du fichier .rm (Uint8Array)
 * @returns {{outil:number, couleur:number, points:number[][]}[]} lignes
 *   visibles, points [x, y] dans le repère de la tablette (x centré).
 */
export function lireLignes(octets) {
  const f = new Flux(octets);
  const entete = new TextDecoder("latin1").decode(octets.subarray(0, ENTETE.length));
  if (entete !== ENTETE) throw new Error("Ce n'est pas une page .rm v6 (logiciel 3.x de la reMarkable).");
  f.p = ENTETE.length;
  const lignes = new Map(); // identifiant → ligne (la dernière écriture l'emporte)
  while (f.reste() >= 8) {
    const longueur = f.u32();
    f.u8(); // inconnu, toujours 0
    f.u8(); // version minimale
    const version = f.u8();
    const type = f.u8();
    const debut = f.p, fin = debut + longueur;
    if (type === BLOC_LIGNE) {
      try {
        f.id(1); // parent (calque)
        const [a, b] = f.id(2);
        f.id(3); f.id(4);
        f.entier(5); // longueur effacée
        const cle = `${a}:${b}`;
        if (f.p < fin && f.prochaine(6, 0xc)) {
          f.sousBloc(6);
          f.u8(); // type d'élément (3 = ligne)
          const outil = f.entier(1);
          const couleur = f.entier(2);
          f.double(3); // épaisseur
          f.reel(4);   // longueur de départ
          const taille = f.sousBloc(5);
          const parPoint = version === 1 ? 24 : 14;
          const n = Math.floor(taille / parPoint);
          const points = [];
          for (let i = 0; i < n; i++) {
            const x = f.f32(), y = f.f32();
            f.p += parPoint - 8; // vitesse, largeur, direction, pression : inutiles ici
            points.push([x, y]);
          }
          lignes.set(cle, { outil, couleur, points });
        } else {
          lignes.delete(cle); // ligne effacée
        }
      } catch {
        // Bloc illisible : on passe au suivant plutôt que d'abandonner la page.
      }
    }
    f.p = fin;
  }
  return [...lignes.values()].filter((l) => !GOMMES.has(l.outil) && !SURLIGNEURS.has(l.outil) && l.points.length > 1);
}

/** Traits d'une page, dans le repère des modèles Portée (pixels, origine en haut à gauche). */
/** Un point de la tablette → le repère des modèles Portée. */
export const versPage = ([x, y]) => [DEMI_LARGEUR + x * ECHELLE, y * ECHELLE];

export function traitsDePage(octets) {
  return lireLignes(octets).map((l) => l.points.map(versPage));
}
