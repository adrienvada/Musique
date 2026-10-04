/**
 * Le dossier des .mid pour Live (audit du 04/10, M10), sans navigateur : un
 * faux dossier en mémoire (l'API File System Access), la petite base de
 * l'appareil sur fake-indexeddb. Ce qu'on vérifie : les noms de fichiers
 * (sûrs sur Mac et Windows, sans doublon, stables), l'écriture groupée une
 * seconde après le dernier changement et seulement de ce qui a changé, les
 * renommages et les effacements (de ce que Portée a écrit, rien d'autre), la
 * permission qui revient d'un toucher, « Tout réécrire » et « Ne plus écrire ».
 */
import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { nomSur, nomsDesFichiers, empreinte, creerDossierMidi, baseAppareil, dossierMidiPossible, ATTENTE } from "../app/dossier-midi.js";

const erreur = (name) => Object.assign(new Error(name), { name });

/** Un dossier en mémoire, comme un FileSystemDirectoryHandle. */
class FauxDossier {
  constructor(name) { this.name = name; this.kind = "directory"; this.entrees = new Map(); this.permission = "granted"; this.reponse = "granted"; this.demandes = 0; }
  async queryPermission() { return this.permission; }
  async requestPermission() { this.demandes++; this.permission = this.reponse; return this.permission; }
  async getDirectoryHandle(nom, { create = false } = {}) {
    if (this.permission !== "granted") throw erreur("NotAllowedError");
    let d = this.entrees.get(nom);
    if (!d) { if (!create) throw erreur("NotFoundError"); d = new FauxDossier(nom); this.entrees.set(nom, d); }
    return d;
  }
  async getFileHandle(nom, { create = false } = {}) {
    let f = this.entrees.get(nom);
    if (!f) {
      if (!create) throw erreur("NotFoundError");
      f = { kind: "file", name: nom, octets: null, ecritures: 0 };
      f.createWritable = async () => {
        let tampon = null;
        return { write: async (o) => { tampon = new Uint8Array(o); }, close: async () => { f.octets = tampon; f.ecritures++; }, abort: async () => {} };
      };
      this.entrees.set(nom, f);
    }
    return f;
  }
  async removeEntry(nom) { if (!this.entrees.delete(nom)) throw erreur("NotFoundError"); }
  /** Pour les essais : les fichiers d'un sous-dossier, { nom: texte }. */
  contenu(sous) {
    const d = this.entrees.get(sous);
    return d ? Object.fromEntries([...d.entrees].map(([n, f]) => [n, new TextDecoder().decode(f.octets)])) : {};
  }
  fichier(sous, nom) { const d = this.entrees.get(sous); return d && d.entrees.get(nom); }
}

/** Une base en mémoire (le vrai dossier ne passe pas par fake-indexeddb : il n'est pas clonable ici). */
function fausseBase() {
  const m = new Map();
  return { m, lire: async (k) => m.get(k), ecrire: async (k, v) => { m.set(k, v); }, effacer: async (k) => { m.delete(k); } };
}

/** Le .mid d'essai : le titre et les notes ; un morceau, celles de ses idées (il change avec elles). */
const fabriquer = (p, idees) => new TextEncoder().encode(p.type === "idee" ? `${p.titre}:${p.notes}` : `${p.titre}:${p.blocs.map((b) => (idees.get(b.idee) || {}).notes).join("|")}`);
const idee = (id, titre, notes, creeLe = id) => ({ id, type: "idee", titre, notes, creeLe });

function essai({ base = fausseBase(), dossier = new FauxDossier("Live") } = {}) {
  const etats = [];
  const d = creerDossierMidi({ base, fabriquer, choisirDossier: async () => dossier, surEtat: (e) => etats.push(e), attente: 20 });
  return { d, base, dossier, etats };
}
const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

test("là où le navigateur sait choisir un dossier (Chrome, Edge sur ordinateur), hors d'un cadre (claude.ai)", () => {
  const g = { showDirectoryPicker() {}, indexedDB: {} };
  g.self = g; g.top = g;
  assert.equal(dossierMidiPossible(g), true);
  assert.equal(dossierMidiPossible({ ...g, top: {} }), false);
  assert.equal(dossierMidiPossible({ indexedDB: {}, self: 1, top: 1 }), false, "Safari, Firefox, le téléphone");
});

test("des noms de fichiers qui passent sur Mac et sur Windows", () => {
  assert.equal(nomSur("Refrain : version 2/3 ?", "Idée"), "Refrain version 2 3");
  assert.equal(nomSur("Fin...", "Idée"), "Fin");
  assert.equal(nomSur("  ", "Idée"), "Idée");
  assert.equal(nomSur("CON", "Idée"), "Idée");
  assert.equal(nomSur("a\u0007b\tc", "Idée"), "a b c");
  assert.equal(nomSur("x".repeat(300), "Idée").length, 100);
  assert.equal(nomSur("Idée du 4 oct., 23:47", "Idée"), "Idée du 4 oct., 23 47");
});

test("pas deux fichiers du même nom, et des noms qui ne valsent pas", () => {
  const a = idee("a", "Refrain", "", "2026-10-01");
  const b = idee("b", "refrain", "", "2026-10-02");
  const m = { id: "m", type: "morceau", titre: "Refrain", blocs: [], creeLe: "2026-10-03" };
  const page = { id: "p", titre: "Refrain", abc: "X:1" };
  const noms = nomsDesFichiers([b, page, m, a]);
  // Le plus ancien garde le nom sans numéro ; les majuscules ne distinguent pas (Mac, Windows) ; un morceau a son dossier.
  assert.deepEqual(noms.get("a"), { dossier: "Idées", nom: "Refrain.mid" });
  assert.deepEqual(noms.get("b"), { dossier: "Idées", nom: "refrain (2).mid" });
  assert.deepEqual(noms.get("m"), { dossier: "Morceaux", nom: "Refrain.mid" });
  assert.equal(noms.has("p"), false, "les pages lues ne vont pas dans le dossier");
  // Une idée plus ancienne prend ensuite le même titre : les fichiers déjà écrits gardent leur nom.
  const deja = { a: { dossier: "Idées", nom: "Refrain.mid" }, b: { dossier: "Idées", nom: "refrain (2).mid" } };
  const c = idee("c", "Refrain", "", "2026-09-01");
  const apres = nomsDesFichiers([a, b, c], deja);
  assert.equal(apres.get("a").nom, "Refrain.mid");
  assert.equal(apres.get("b").nom, "refrain (2).mid");
  assert.equal(apres.get("c").nom, "Refrain (3).mid");
  // Un titre qui change : le nom suit.
  assert.equal(nomsDesFichiers([{ ...a, titre: "Couplet" }], deja).get("a").nom, "Couplet.mid");
  assert.notEqual(empreinte(new Uint8Array([1, 2, 3])), empreinte(new Uint8Array([1, 2, 4])));
});

test("choisir le dossier y écrit tout ; ensuite, seulement ce qui change, une fois après une rafale", async () => {
  const { d, dossier, etats } = essai();
  const liste = [idee("a", "Refrain", "do ré"), idee("b", "Couplet", "mi"), { id: "m", type: "morceau", titre: "Chanson", blocs: [{ idee: "a" }, { idee: "b" }], creeLe: "z" }];
  d.surListe(liste);
  assert.equal(await d.choisir(), true);
  assert.deepEqual(dossier.contenu("Idées"), { "Refrain.mid": "Refrain:do ré", "Couplet.mid": "Couplet:mi" });
  assert.deepEqual(dossier.contenu("Morceaux"), { "Chanson.mid": "Chanson:do ré|mi" });
  assert.deepEqual(etats.at(-1).dernier && [etats.at(-1).dernier.ecrits, etats.at(-1).dernier.total], [3, 3]);
  // Cinq notes écrites coup sur coup dans « Refrain » : une seule écriture, après la dernière.
  for (const n of ["do ré mi", "do ré mi fa", "do ré mi fa sol", "do", "do ré"]) d.surListe([{ ...liste[0], notes: n }, liste[1], liste[2]]);
  await d.finir();
  assert.equal(dossier.fichier("Idées", "Refrain.mid").ecritures, 1, "revenu au même contenu : rien à réécrire");
  d.surListe([{ ...liste[0], notes: "sol la" }, liste[1], liste[2]]);
  await attendre(5);
  assert.equal(dossier.fichier("Idées", "Refrain.mid").ecritures, 1, "pas avant la fin de l'attente");
  await attendre(40);
  await d.finir();
  assert.equal(dossier.fichier("Idées", "Refrain.mid").ecritures, 2);
  assert.equal(dossier.fichier("Idées", "Couplet.mid").ecritures, 1, "inchangé, pas réécrit");
  // Le morceau change avec son idée.
  assert.equal(dossier.contenu("Morceaux")["Chanson.mid"], "Chanson:sol la|mi");
  assert.ok(ATTENTE >= 500 && ATTENTE <= 2000);
});

test("renommer, échanger deux titres, effacer : le dossier suit, sans toucher aux autres fichiers", async () => {
  const { d, dossier } = essai();
  const a = idee("a", "Refrain", "1"), b = idee("b", "Couplet", "2");
  d.surListe([a, b]);
  await d.choisir();
  // Un fichier qu'Adrien a mis là lui-même.
  (await (await dossier.getDirectoryHandle("Idées")).getFileHandle("À moi.mid", { create: true })).octets = new Uint8Array([7]);
  d.surListe([{ ...a, titre: "Pont" }, b]);
  await d.finir();
  assert.deepEqual(Object.keys(dossier.contenu("Idées")).sort(), ["Couplet.mid", "Pont.mid", "À moi.mid"]);
  // Deux titres échangés : chacun retrouve son contenu, aucun ne disparaît.
  d.surListe([{ ...a, titre: "Couplet" }, { ...b, titre: "Pont" }]);
  await d.finir();
  assert.deepEqual(dossier.contenu("Idées"), { "Couplet.mid": "Couplet:1", "Pont.mid": "Pont:2", "À moi.mid": "\u0007" });
  // Une idée effacée : son fichier aussi ; celui d'Adrien reste.
  d.surListe([{ ...b, titre: "Pont" }]);
  await d.finir();
  assert.deepEqual(Object.keys(dossier.contenu("Idées")).sort(), ["Pont.mid", "À moi.mid"]);
});

test("à la visite suivante, la permission revient d'un toucher, et ce qui attendait s'écrit", async () => {
  const base = fausseBase(), dossier = new FauxDossier("Live");
  const premier = essai({ base, dossier });
  premier.d.surListe([idee("a", "Refrain", "1")]);
  await premier.d.choisir();
  // Une autre visite : le navigateur a oublié la permission (sauf « Autoriser à chaque visite »).
  dossier.permission = "prompt";
  const { d, etats } = essai({ base, dossier });
  await d.pret;
  assert.equal(etats.at(-1).nom, "Live");
  assert.equal(etats.at(-1).permission, "prompt");
  d.surListe([idee("a", "Refrain", "1 2"), idee("b", "Couplet", "3")]);
  await d.finir();
  assert.equal(etats.at(-1).attendPermission, true, "l'écran le dit (une fois par visite)");
  assert.deepEqual(dossier.contenu("Idées"), { "Refrain.mid": "Refrain:1" }, "rien n'est écrit sans permission");
  // Refusée : rien. Accordée : tout ce qui attendait.
  dossier.reponse = "denied";
  assert.equal(await d.autoriser(), false);
  dossier.reponse = "granted";
  assert.equal(await d.autoriser(), true);
  assert.deepEqual(dossier.contenu("Idées"), { "Refrain.mid": "Refrain:1 2", "Couplet.mid": "Couplet:3" });
  assert.equal(etats.at(-1).attendPermission, false);
});

test("« Tout réécrire » remet un fichier effacé à la main ; « Ne plus écrire » laisse les fichiers et n'écrit plus", async () => {
  const { d, dossier, base } = essai();
  d.surListe([idee("a", "Refrain", "1"), idee("b", "Couplet", "2")]);
  await d.choisir();
  await (await dossier.getDirectoryHandle("Idées")).removeEntry("Refrain.mid");
  d.surListe([idee("a", "Refrain", "1"), idee("b", "Couplet", "2")]);
  await d.finir();
  assert.deepEqual(Object.keys(dossier.contenu("Idées")), ["Couplet.mid"], "rien n'a changé : rien n'est réécrit");
  await d.toutReecrire();
  assert.deepEqual(Object.keys(dossier.contenu("Idées")).sort(), ["Couplet.mid", "Refrain.mid"]);
  await d.oublier();
  assert.equal(d.etat().nom, null);
  assert.equal(base.m.size, 0, "le dossier et la liste des fichiers sont oubliés");
  d.surListe([idee("a", "Refrain", "changé")]);
  await d.finir();
  assert.equal(dossier.contenu("Idées")["Refrain.mid"], "Refrain:1");
});

test("une idée qui ne s'écrit pas n'empêche pas les autres, et le problème se dit", async () => {
  const etats = [];
  const dossier = new FauxDossier("Live");
  const d = creerDossierMidi({
    base: fausseBase(), choisirDossier: async () => dossier, surEtat: (e) => etats.push(e), attente: 10,
    fabriquer: (p, idees) => { if (p.id === "x") throw new Error("séquence illisible"); return fabriquer(p, idees); },
  });
  d.surListe([idee("x", "Cassée", ""), idee("a", "Refrain", "1")]);
  await d.choisir();
  assert.deepEqual(Object.keys(dossier.contenu("Idées")), ["Refrain.mid"]);
  assert.match(etats.at(-1).dernier.erreur, /Cassée.*séquence illisible/);
  // Renoncer au choix du dossier n'est pas une erreur.
  const d2 = creerDossierMidi({ base: fausseBase(), fabriquer, choisirDossier: async () => { throw erreur("AbortError"); } });
  assert.equal(await d2.choisir(), false);
});

test("la base de l'appareil : à part de la bibliothèque, un magasin, lire, écrire, effacer", async () => {
  const base = baseAppareil();
  assert.equal(await base.lire("dossier-midi"), undefined);
  await base.ecrire("fichiers-midi", { a: { dossier: "Idées", nom: "Refrain.mid", empreinte: "x" } });
  assert.deepEqual(await base.lire("fichiers-midi"), { a: { dossier: "Idées", nom: "Refrain.mid", empreinte: "x" } });
  await base.effacer("fichiers-midi");
  assert.equal(await base.lire("fichiers-midi"), undefined);
  const bases = (await indexedDB.databases()).map((b) => b.name);
  assert.deepEqual(bases, ["portee-appareil"], "la base de la bibliothèque (portee) n'est ni ouverte ni changée");
});

test("dans une même visite, ce qui n'a pas changé n'est pas refait ; un morceau se refait avec ses idées", async () => {
  const faits = [];
  const dossier = new FauxDossier("Live");
  const d = creerDossierMidi({
    base: fausseBase(), choisirDossier: async () => dossier, attente: 10,
    fabriquer: (p, idees) => { faits.push(p.id); return fabriquer(p, idees); },
  });
  const a = { ...idee("a", "Refrain", "1"), modifieLe: "t1" }, b = { ...idee("b", "Couplet", "2"), modifieLe: "t1" };
  const m = { id: "m", type: "morceau", titre: "Chanson", blocs: [{ idee: "a" }, { idee: "b" }], creeLe: "z", modifieLe: "t1" };
  d.surListe([a, b, m]);
  await d.choisir();
  assert.deepEqual(faits.sort(), ["a", "b", "m"]);
  // Une autre partition change (une page lue) : rien n'est refait.
  faits.length = 0;
  d.surListe([a, b, m, { id: "p", titre: "Page", modifieLe: "t2" }]);
  await d.finir();
  assert.deepEqual(faits, []);
  // Une idée change : elle, et le morceau qui la contient ; le fichier du morceau suit.
  faits.length = 0;
  d.surListe([{ ...a, notes: "1 1", modifieLe: "t3" }, b, m]);
  await d.finir();
  assert.deepEqual(faits.sort(), ["a", "m"]);
  assert.equal(dossier.contenu("Morceaux")["Chanson.mid"], "Chanson:1 1|2");
});
