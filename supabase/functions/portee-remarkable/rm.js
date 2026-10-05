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
 * CE QUI COMPTE COMME DE L'ÉCRITURE. Le PDF exporté par la tablette ne garde
 * que l'encre noire (lecteur/extraction.js) : le gris, le blanc, les
 * couleurs, le surligneur et l'outil « ombrage » n'y sont pas lus. Les
 * traits venus du cloud suivent la même règle (traitsDePage) : sinon une
 * page lue par la tablette et la même page lue par son PDF pouvaient
 * différer (audit du 04/10, C7). lireLignes, elle, rend tout ce que rmscene
 * rend (outil, couleur), pour les tests et le diagnostic.
 *
 * UN FICHIER ABÎMÉ. Un point non fini ou absurde est écarté ; une ligne dont
 * les points annoncent plus d'octets que son bloc n'en contient est sautée
 * (elle lisait le bloc suivant) ; un bloc qui dépasse la fin du fichier
 * arrête la lecture. Le reste de la page se lit.
 *
 * Le module est en JavaScript pur : le connecteur (Deno, Supabase) et les
 * tests (Node) l'utilisent tel quel.
 */

const ENTETE = "reMarkable .lines file, version=6          ";
const BLOC_LIGNE = 0x05;
// Outils à ignorer : ils n'écrivent pas de musique (numéros de rmscene).
const GOMMES = new Set([6, 8]);
const SURLIGNEURS = new Set([5, 18]);
const OMBRAGE = 23; // l'outil « shader » : un aplat translucide, absent de l'export PDF en noir
const NOIR = 0;     // PenColor.BLACK ; 1 gris, 2 blanc, 3 et plus : les couleurs
const DEMI_LARGEUR = 702;
const ECHELLE = 226 / 227;
// Au-delà, un point ne peut pas venir de l'écran (1404 × 1872, abscisse centrée) :
// des octets abîmés. Large, pour ne rien perdre d'une page plus haute que l'écran.
const LIMITE_X = 5000, LIMITE_Y = 10000;

class Flux {
  constructor(octets) {
    this.o = octets;
    this.v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
    this.p = 0;
  }
  reste() { return this.o.length - this.p; }
  u8() {
    if (this.p >= this.o.length) throw new RangeError("fin du fichier");
    return this.o[this.p++];
  }
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
      if (decalage > 63) throw new RangeError("entier trop long");
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

const pointValide = ([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < LIMITE_X && y > -LIMITE_Y && y < LIMITE_Y;

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
    // Un bloc qui finirait au-delà du fichier : le fichier est tronqué ou abîmé, on s'arrête là.
    if (fin > octets.length) break;
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
          // Les points doivent tenir dans leur bloc, en nombre entier : sinon on
          // lirait les octets du bloc suivant comme des coordonnées.
          if (taille % parPoint !== 0 || f.p + taille > fin) throw new Error("points hors de leur bloc");
          const n = taille / parPoint;
          const points = [];
          for (let i = 0; i < n; i++) {
            const x = f.f32(), y = f.f32();
            f.p += parPoint - 8; // vitesse, largeur, direction, pression : inutiles ici
            if (pointValide([x, y])) points.push([x, y]);
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

/** Une ligne compte comme de l'écriture si le PDF exporté la garderait : noire, au stylo. */
export function estEncre(ligne) {
  return ligne.couleur === NOIR && ligne.outil !== OMBRAGE && !GOMMES.has(ligne.outil) && !SURLIGNEURS.has(ligne.outil);
}

/** Un point de la tablette → le repère des modèles Portée. */
export const versPage = ([x, y]) => [DEMI_LARGEUR + x * ECHELLE, y * ECHELLE];

/** Traits d'une page, dans le repère des modèles Portée (pixels, origine en haut à gauche). */
export function traitsDePage(octets) {
  return lireLignes(octets).filter(estEncre).map((l) => l.points.map(versPage));
}

/**
 * Comme traitsDePage, sans jamais lever d'erreur : { traits, erreur }. Une
 * page illisible (en-tête inconnu…) rend erreur et aucun trait, pour que le
 * connecteur lise les autres pages du document au lieu d'échouer en entier.
 */
export function lirePageRm(octets) {
  try {
    return { traits: traitsDePage(octets), erreur: null };
  } catch (e) {
    return { traits: [], erreur: e && e.message ? e.message : String(e) };
  }
}
