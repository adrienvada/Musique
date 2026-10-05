/**
 * UN DOSSIER POUR LIVE (audit du 04/10, M10)
 *
 * Portée écrit le .mid de chaque idée et de chaque morceau dans un dossier
 * de l'ordinateur, et le réécrit quand il change, une seconde après le
 * dernier changement (une idée qu'on écrit change à chaque note). Ajouté aux
 * Emplacements (Places) du navigateur de Live, ce dossier y montre toujours
 * les dernières versions, à glisser sur une piste. Chrome et Edge sur
 * ordinateur seulement (showDirectoryPicker) ; ailleurs, et dans claude.ai,
 * rien ne se montre.
 *
 * Le dossier choisi se garde sur cet appareil seulement, dans une petite
 * base à part (« portee-appareil ») : la bibliothèque se synchronise entre
 * les appareils, et un dossier de cet ordinateur n'aurait pas de sens sur le
 * téléphone ; on ne touche pas non plus à la base de la bibliothèque, ni à
 * ses magasins. Le navigateur redemande la permission d'écrire à chaque
 * visite (sauf « toujours autoriser ») : un toucher la rend (autoriser()).
 *
 * Portée sait ce qu'elle a écrit (le nom et l'empreinte de chaque fichier) :
 * elle ne réécrit que ce qui a changé, renomme le fichier quand le titre
 * change, efface celui d'une idée effacée, et ne touche à aucun autre
 * fichier du dossier. Elle écrit dans deux sous-dossiers, « Idées » et
 * « Morceaux ». Un fichier effacé à la main revient avec « Tout réécrire »
 * (ou au prochain changement de son idée).
 */
import { explication, expliquer } from "./erreurs.js";

/** Une seconde après le dernier changement : une idée qu'on écrit change à chaque note. */
export const ATTENTE = 1000;
const SOUS_DOSSIERS = { idee: "Idées", morceau: "Morceaux" };
const CLE_DOSSIER = "dossier-midi";
const CLE_FICHIERS = "fichiers-midi";

/** Chrome ou Edge sur ordinateur, hors d'un cadre (claude.ai) : le dossier s'y propose. */
export function dossierMidiPossible(g = globalThis) {
  return typeof g.showDirectoryPicker === "function" && typeof g.indexedDB !== "undefined" && g.top === g.self;
}

/**
 * La petite base de cet appareil, à part de la bibliothèque (pas
 * synchronisée) : le dossier choisi, et ce qu'on y a écrit. Un magasin,
 * « reglages », créé à la première ouverture (version 1).
 */
export function baseAppareil(idb = globalThis.indexedDB) {
  let ouverte = null;
  const ouvrir = () => ouverte || (ouverte = new Promise((ok, ko) => {
    const r = idb.open("portee-appareil", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("reglages"); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  }).catch((e) => { ouverte = null; throw e; }));
  const faire = async (mode, f) => {
    const db = await ouvrir();
    return new Promise((ok, ko) => {
      const t = db.transaction("reglages", mode);
      const r = f(t.objectStore("reglages"));
      t.oncomplete = () => ok(r ? r.result : undefined);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error);
    });
  };
  return {
    lire: (cle) => faire("readonly", (s) => s.get(cle)),
    ecrire: (cle, valeur) => faire("readwrite", (s) => { s.put(valeur, cle); return null; }),
    effacer: (cle) => faire("readwrite", (s) => { s.delete(cle); return null; }),
  };
}

/**
 * Un nom de fichier qui passe sur Mac et sur Windows : sans / \ : * ? " < > |
 * ni caractère de contrôle, sans point ni espace au bout, 100 caractères au
 * plus, et pas un nom que Windows se réserve (CON, NUL, COM1…).
 */
export function nomSur(titre, repli) {
  let n = [...String(titre || "")].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || '\\/:*?"<>|'.includes(c) ? " " : c)).join("");
  n = n.replace(/\s+/g, " ").trim().slice(0, 100).replace(/[. ]+$/, "");
  return !n || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n) ? repli : n;
}

/** « Refrain.mid » ou « Refrain (2).mid » : le nom que donne ce titre. */
const deCeTitre = (nom, base) => nom === `${base}.mid` || (nom.startsWith(`${base} (`) && /^ \(\d+\)\.mid$/.test(nom.slice(base.length)));
/** Le Mac et Windows ne distinguent pas les majuscules dans les noms de fichiers. */
const cleDe = (dossier, nom) => `${dossier}/${nom.toLowerCase()}`;

/**
 * Le fichier de chaque idée et de chaque morceau : id → { dossier, nom }.
 * Un titre déjà pris dans le même sous-dossier prend « (2) », « (3) »… ; un
 * fichier déjà écrit garde son nom tant que son titre ne change pas, pour
 * que les noms ne valsent pas quand une autre idée prend le même titre ; et
 * entre deux nouveaux, la plus ancienne garde le nom sans numéro.
 */
export function nomsDesFichiers(partitions, dejaEcrits = {}) {
  const pris = new Set();
  const noms = new Map();
  const a = partitions.filter((p) => SOUS_DOSSIERS[p.type]);
  const base = (p) => nomSur(p.titre, p.type === "idee" ? "Idée" : "Morceau");
  for (const p of a) {
    const avant = dejaEcrits[p.id], dossier = SOUS_DOSSIERS[p.type];
    if (avant && avant.dossier === dossier && deCeTitre(avant.nom, base(p)) && !pris.has(cleDe(dossier, avant.nom))) {
      pris.add(cleDe(dossier, avant.nom));
      noms.set(p.id, { dossier, nom: avant.nom });
    }
  }
  const reste = a.filter((p) => !noms.has(p.id)).sort((x, y) => String(x.creeLe || "").localeCompare(String(y.creeLe || "")) || String(x.id).localeCompare(String(y.id)));
  for (const p of reste) {
    const dossier = SOUS_DOSSIERS[p.type], b = base(p);
    let nom = `${b}.mid`, n = 2;
    while (pris.has(cleDe(dossier, nom))) nom = `${b} (${n++}).mid`;
    pris.add(cleDe(dossier, nom));
    noms.set(p.id, { dossier, nom });
  }
  return noms;
}

/** L'empreinte d'un fichier (FNV-1a sur 32 bits, et sa taille) : a-t-il changé depuis la dernière écriture ? */
export function empreinte(octets) {
  let h = 0x811c9dc5;
  for (let i = 0; i < octets.length; i++) { h ^= octets[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16).padStart(8, "0")}:${octets.length}`;
}

async function ecrireFichier(racine, sous, nom, octets) {
  const d = await racine.getDirectoryHandle(sous, { create: true });
  const f = await d.getFileHandle(nom, { create: true });
  // createWritable écrit à côté et remplace d'un coup à la fermeture : Live ne lit jamais un fichier à moitié écrit.
  const w = await f.createWritable();
  try {
    await w.write(octets);
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch { /* déjà fermé */ }
    throw e;
  }
}

async function effacerFichier(racine, sous, nom) {
  let d;
  try { d = await racine.getDirectoryHandle(sous); } catch (e) { if (e && e.name === "NotFoundError") return; throw e; }
  try { await d.removeEntry(nom); } catch (e) { if (!e || e.name !== "NotFoundError") throw e; }
}

/**
 * Ce dont dépend le fichier d'une partition : sa date de modification, et
 * pour un morceau celles de ses idées. Sans date (une partition d'avant les
 * dates), null : le fichier se refait à chaque passe.
 */
export function versionDe(p, idees) {
  if (!p.modifieLe) return null;
  if (p.type !== "morceau") return String(p.modifieLe);
  return [p.modifieLe, ...(p.blocs || []).map((b) => (idees.get(b && b.idee) || {}).modifieLe || "")].join("|");
}

/** Le calcul se fait par tranches de 8 ms au plus : une grosse bibliothèque ne bloque pas le jeu en direct. */
const TRANCHE = 8;

// Ce que dit le navigateur (en anglais) se dit en français (I13) : ce qui
// est propre à un dossier ici, le reste par erreurs.js.
const messageErreur = (e) => {
  const nom = e && e.name;
  if (nom === "NotAllowedError") return "Portée n'a plus le droit d'écrire dans ce dossier.";
  if (nom === "NotFoundError") return "Ce dossier n'est plus là (déplacé ou supprimé ?) : choisis-le de nouveau.";
  if (nom === "QuotaExceededError") return "Le disque est plein : fais de la place, puis réessaie.";
  return expliquer(e);
};

/**
 * @param o {
 *   base             la base de cet appareil (baseAppareil()) ;
 *   fabriquer(p, idees) → les octets du .mid d'une idée ou d'un morceau
 *                    (midiDeLIdee, midiDuMorceau ; idees : id → idée) ;
 *   choisirDossier() → un FileSystemDirectoryHandle (showDirectoryPicker) ;
 *   surEtat(e)       à chaque changement : { nom, permission, dernier,
 *                    attendPermission } (l'écran des réglages) ;
 *   attente          ms entre le dernier changement et l'écriture ;
 *   version(p, idees) ce dont dépend le fichier (versionDe).
 * }
 * Ce qui n'a pas changé depuis la dernière passe de cette visite n'est pas
 * refait (330 fichiers d'une grosse bibliothèque coûtent 230 ms à refaire) ;
 * la première passe d'une visite refait tout, une fois, par tranches, et ne
 * réécrit que ce qui diffère (le .mid d'une nouvelle version de Portée).
 */
export function creerDossierMidi({
  base,
  fabriquer,
  choisirDossier = () => globalThis.showDirectoryPicker({ id: "portee-midi", mode: "readwrite", startIn: "music" }),
  surEtat = () => {},
  attente = ATTENTE,
  version = versionDe,
}) {
  let dossier = null; // le FileSystemDirectoryHandle choisi
  let permission = null; // "granted", "prompt", "denied", ou null sans dossier
  let liste = null; // la bibliothèque, telle que l'a donnée le dernier changement
  let minuterie = null;
  let file = Promise.resolve(); // une écriture à la fois
  let dernier = null; // { ecrits, effaces, total, erreur, quand }
  let attendPermission = false; // des changements attendent que la permission revienne
  const vus = new Map(); // id → la version dont le fichier est à jour, pendant cette visite

  const etat = () => ({ nom: dossier ? dossier.name : null, permission, dernier, attendPermission });
  const annoncer = () => { try { surEtat(etat()); } catch { /* l'écran s'en remettra */ } };
  const lirePermission = async (d) => { try { return await d.queryPermission({ mode: "readwrite" }); } catch { return "prompt"; } };

  async function charger() {
    let d;
    try { d = (await base.lire(CLE_DOSSIER)) || null; } catch { d = null; }
    const p = d ? await lirePermission(d) : null;
    dossier = d;
    permission = p;
    annoncer();
  }
  const pret = charger();

  /** Écrit ce qui a changé depuis la dernière fois (tout, avec `force`). */
  async function passe({ force = false } = {}) {
    await pret;
    if (!dossier || !liste) return;
    const ici = dossier, partitions = liste;
    permission = await lirePermission(ici);
    if (permission !== "granted") { attendPermission = true; annoncer(); return; }
    attendPermission = false;
    const deja = (await base.lire(CLE_FICHIERS)) || {};
    const idees = new Map(partitions.filter((p) => p.type === "idee").map((p) => [p.id, p]));
    const noms = nomsDesFichiers(partitions, deja);
    // Les noms que cette passe écrit : un ancien nom repris par une autre idée (deux titres
    // échangés) ne s'efface pas, il vient d'être réécrit.
    const cibles = new Set([...noms.values()].map((n) => cleDe(n.dossier, n.nom)));
    const nouveaux = {};
    const anciens = [];
    let ecrits = 0, effaces = 0, erreur = null;
    let tranche = performance.now();
    for (const p of partitions) {
      const n = noms.get(p.id);
      if (!n) continue;
      const avant = deja[p.id];
      const meme = avant && avant.dossier === n.dossier && avant.nom === n.nom;
      const v = version(p, idees);
      if (!force && meme && v !== null && vus.get(p.id) === v) { nouveaux[p.id] = avant; continue; }
      if (performance.now() - tranche > TRANCHE) {
        await new Promise((ok) => setTimeout(ok, 0));
        tranche = performance.now();
      }
      let octets;
      try { octets = fabriquer(p, idees); } catch (e) {
        erreur = erreur || `« ${p.titre || "Sans titre"} » : ${explication(e)}`;
        if (avant) nouveaux[p.id] = avant;
        continue;
      }
      const e = empreinte(octets);
      if (!force && meme && avant.empreinte === e) { nouveaux[p.id] = avant; vus.set(p.id, v); continue; }
      try {
        await ecrireFichier(ici, n.dossier, n.nom, octets);
        ecrits++;
        nouveaux[p.id] = { ...n, empreinte: e };
        vus.set(p.id, v);
        if (avant && !meme) anciens.push(avant);
      } catch (err) {
        erreur = erreur || messageErreur(err);
        if (avant) nouveaux[p.id] = avant;
      }
    }
    // Les idées et morceaux effacés, et les anciens noms des renommés : seulement ce que Portée a écrit.
    for (const [id, avant] of Object.entries(deja)) if (!noms.has(id)) anciens.push(avant);
    for (const a of anciens) {
      if (cibles.has(cleDe(a.dossier, a.nom))) continue;
      try { await effacerFichier(ici, a.dossier, a.nom); effaces++; } catch (err) { erreur = erreur || messageErreur(err); }
    }
    await base.ecrire(CLE_FICHIERS, nouveaux);
    dernier = { ecrits, effaces, total: Object.keys(nouveaux).length, erreur, quand: Date.now() };
    annoncer();
  }

  /** Une chose à la fois : une écriture, un changement de dossier, un oubli. */
  function enFile(f) {
    file = file.then(f).catch((e) => {
      dernier = { ecrits: 0, effaces: 0, total: dernier ? dernier.total : 0, erreur: messageErreur(e), quand: Date.now() };
      annoncer();
    });
    return file;
  }
  const ecrire = (options) => enFile(() => passe(options));

  /** Dans un geste : le navigateur redemande la permission d'écrire, puis ce qui attendait s'écrit. */
  async function autoriser() {
    await pret;
    if (!dossier) return false;
    try { permission = await dossier.requestPermission({ mode: "readwrite" }); } catch { permission = "denied"; }
    annoncer();
    if (permission === "granted") await ecrire();
    return permission === "granted";
  }

  return {
    etat,
    pret,
    autoriser,
    /** La bibliothèque a changé : on écrit une seconde après le dernier changement. */
    surListe(l) {
      liste = l;
      clearTimeout(minuterie);
      minuterie = setTimeout(() => { minuterie = null; ecrire(); }, attente);
    },
    /** Choisir le dossier (dans un geste) ; tout y est écrit aussitôt. Rend false si l'on renonce. */
    async choisir() {
      let d;
      try { d = await choisirDossier(); } catch (e) { if (e && e.name === "AbortError") return false; throw e; }
      await enFile(async () => {
        await base.ecrire(CLE_DOSSIER, d);
        // Un autre dossier : ce qu'on a écrit dans l'ancien y reste, et tout s'écrit dans le nouveau.
        await base.ecrire(CLE_FICHIERS, {});
        vus.clear();
        dossier = d;
        permission = await lirePermission(d);
        annoncer();
      });
      await ecrire({ force: true });
      return true;
    },
    /** Réécrit tous les fichiers (un fichier effacé à la main revient). */
    async toutReecrire() {
      await pret;
      if (dossier && permission !== "granted" && !(await autoriser())) return false;
      await ecrire({ force: true });
      return true;
    },
    /** Ne plus écrire de .mid : les fichiers déjà écrits restent dans le dossier. */
    async oublier() {
      await pret;
      clearTimeout(minuterie);
      minuterie = null;
      await enFile(async () => {
        dossier = null;
        permission = null;
        dernier = null;
        attendPermission = false;
        await base.effacer(CLE_DOSSIER);
        await base.effacer(CLE_FICHIERS);
        vus.clear();
        annoncer();
      });
    },
    /** Pour les essais : attendre que l'écriture en cours (et celle qui attend) soient faites. */
    async finir() {
      if (minuterie) { clearTimeout(minuterie); minuterie = null; ecrire(); }
      await file;
    },
  };
}
