/**
 * LA BIBLIOTHÈQUE SYNCHRONISÉE, CÔTÉ APPAREIL
 *
 * Chaque appareil garde toute la bibliothèque (IndexedDB) et note ce qu'il
 * change dans une file d'envois. Une synchronisation :
 *   1. reçoit d'abord ce qui a changé ailleurs depuis son curseur
 *      (bibliotheque_changements), et les pages qui lui manquent : ce qui
 *      part ensuite d'ici part de la version la plus récente, au lieu de
 *      l'écraser (audit du 04/10, D1) ;
 *   2. envoie la file (bibliotheque_ecrire), pages comprises quand elles
 *      sont nouvelles, en disant de quelle version elle part (`base`). Si la
 *      bibliothèque commune a changé entre-temps, elle refuse et rend la
 *      sienne : on fusionne, et on renvoie (D4, D10).
 *
 * Fusionner (fiche.js) : pour chaque champ, le côté qui l'a changé depuis la
 * base (la dernière version convenue, gardée par l'appareil) l'emporte ; les
 * notes d'une idée se fusionnent note par note ; le texte d'une page lue
 * changé des deux côtés donne une copie de conflit plutôt qu'un écrasement.
 * Une suppression voyage comme une « pierre tombale » ; une modification pas
 * encore partie l'emporte sur une suppression faite ailleurs.
 *
 * Hors ligne, la file attend : rien ne se perd. Une fiche que le connecteur
 * refuse, ou qu'on ne peut pas ranger ici, est mise de côté (la quarantaine,
 * avec sa raison) au lieu de tout bloquer (D2) : un envoi refusé repart dès
 * que la fiche change, ou à la session suivante ; une réception, à chaque
 * passage.
 *
 * `local` : le stockage (stockage.js) ; `appeler(outil, args)` : l'appel d'un
 * outil du connecteur, qui rend son résultat structuré et rejette avec
 * { code: "tool_error" } quand l'outil échoue (sinon, c'est le réseau) ;
 * `verrou(nom, f)` : un seul onglet synchronise à la fois (D7).
 */
import { dateIso, decompacter, egal, empreinte, fusionnerFiches, normaliserFiche, sansDates } from "./fiche.js";

const VERROU = "portee-synchro";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
// Envois d'affilée sur une partition que la bibliothèque refuse (elle a changé entre-temps) : au-delà, au prochain passage.
const ESSAIS = 4;
// Un envoi qui échoue côté connecteur (son stockage en panne…) retente ; à la cinquième fois dans la session, il est mis de côté.
const PANNES_AVANT_QUARANTAINE = 5;
// Les refus du connecteur d'avant le 04/10 : il levait une erreur au lieu de répondre { accepte: false, refus }.
const ANCIENS_REFUS = /Identifiant de partition invalide|Il faut la date de modification|Il faut les données/;
// Le connecteur refuse une requête de plus de 6 Mo (HTTP 413) avant même de la lire : on ne l'envoie
// pas, puisqu'elle serait refusée à chaque passage (256 Ko de fiche et 5 Mo de pages au plus, bibliotheque.js).
const ENVOI_MAX = 5.75 * 1024 * 1024;
const tropLourd = (e) => !!e && /HTTP 413/.test(e.message || "");

/** Un verrou entre les onglets (Web Locks) quand le navigateur en a un ; sinon, la synchro passe sans. */
export function verrouNavigateur(nom, f) {
  const locks = typeof navigator !== "undefined" ? navigator.locks : null;
  return locks && typeof locks.request === "function" ? locks.request(nom, () => f()) : f();
}

/** L'outil du connecteur a répondu par une erreur (il a vu la demande et l'a refusée). */
const refusOutil = (e) => !!e && typeof e === "object" && e.code === "tool_error";

/** Le texte d'une erreur (celui de l'outil, que connecteurDirect met dans result.content). */
function texteErreur(e) {
  const c = e && e.result && e.result.content;
  const t = Array.isArray(c) && c.find((x) => x && x.type === "text");
  const m = (t && t.text) || (e && e.message) || String(e);
  return m === "tool_error" ? "le connecteur a refusé cette partition" : m;
}

/**
 * @param {object} o
 * @param {any} o.local  le stockage d'ici (stockage.js)
 * @param {(outil: string, args: object) => Promise<any>} o.appeler  un outil du connecteur
 * @param {(etat: object) => void} [o.surEtat]  la synchro dit où elle en est (encours, ok, erreur)
 * @param {(nom: string, f: () => any) => any} [o.verrou]  une seule synchro à la fois, tous onglets confondus
 */
export function creerSynchro({ local, appeler, surEtat = () => {}, verrou = verrouNavigateur }) {
  let enCours = null;
  let encore = false;
  let premiere = true;
  const pannes = new Map(); // id → { numero, n } : les échecs passagers d'un envoi, dans cette session
  let receptionsDeCote = new Set(); // les réceptions en quarantaine, relues au début de chaque passe

  /** Un appel au connecteur. Une erreur qui n'est pas celle de l'outil vient du réseau : elle arrête la passe. */
  async function appel(outil, args) {
    try {
      return (await appeler(outil, args)) || {};
    } catch (e) {
      // Trop lourde (HTTP 413) : le connecteur a répondu, et refuse cette demande-là seulement.
      if (refusOutil(e) || tropLourd(e)) throw e;
      const err = e && typeof e === "object" ? e : new Error(String(e));
      err.reseau = true;
      throw err;
    }
  }

  // --- Recevoir -----------------------------------------------------------

  /**
   * Prend une fiche de la bibliothèque commune : lit l'état d'ici, décide,
   * puis range, seulement si rien n'a bougé ici entre-temps ; sinon, on
   * recommence avec l'état neuf. Une correction qui s'enregistre pendant la
   * synchro n'est donc jamais écrasée (S7).
   * @returns {Promise<{ recue: boolean, copie: boolean }>}  recue : quelque chose de là-bas
   *   est entré ; copie : une copie de conflit a été faite
   */
  async function recevoir(f) {
    for (let essai = 0; essai < 5; essai++) {
      const ici = await local.etatSynchro(f.id, { pages: true });
      const d = await decider(f, ici);
      if (d && d.copie) await local.creer(d.copie.id, d.copie.donnees, d.copie.traits);
      if (!d || (await local.appliquerSynchro(f.id, d.ecriture))) {
        // Reçue (ou déjà là) : une version plus ancienne mise de côté ne doit plus revenir.
        if (receptionsDeCote.has(f.id)) { await local.leverQuarantaine(f.id, "reception"); receptionsDeCote.delete(f.id); }
        return d ? { recue: d.recue, copie: !!d.copie } : { recue: false, copie: false };
      }
      // Changée ici pendant ce temps : on recommence avec l'état neuf.
    }
    throw new Error("Cette partition change sans cesse ici : elle sera reçue au prochain passage.");
  }

  /** La copie de conflit : la version de l'autre appareil, à part, sous un nom qui le dit. */
  function copieDeConflit(f, version, pages) {
    // Un identifiant tiré de la version reçue : refaire la même décision refait la même copie, pas une deuxième.
    const id = `${f.id.slice(0, 48)}-c${Date.parse(f.modifieLe).toString(36)}`;
    const maintenant = new Date().toISOString();
    return {
      id,
      donnees: { ...version, titre: `${version.titre} (version de l'autre appareil)`, conflitDe: f.id, creeLe: maintenant, modifieLe: maintenant },
      traits: (pages || []).filter(Array.isArray).map(decompacter),
    };
  }

  /** Que faire de la fiche `f` reçue, vu l'état d'ici ? null : rien. */
  async function decider(f, { fiche, pagesLeLocal, envoi, base, pages }) {
    const attendu = { numero: envoi ? envoi.numero ?? null : null, modifieLe: fiche ? fiche.modifieLe : null };
    const connue = !!base && typeof base.modifieLe === "string";
    // Déjà vue : le recouvrement du curseur la redonne (D10), ou c'est notre envoi
    // qui revient. Le numéro de révision départage deux versions de même date.
    const memeRev = !Number.isInteger(base && base.rev) || !Number.isInteger(f.rev) || base.rev === f.rev;
    if (connue && base.modifieLe === f.modifieLe && !!base.supprime === !!f.supprime && memeRev) return null;
    const changeeIci = !!envoi;

    if (f.supprime) {
      if (!fiche) return { ecriture: { attendu, donnees: null, base: f, envoyer: false, visible: false }, recue: false };
      if (!changeeIci || envoi.supprime) return { ecriture: { attendu, donnees: null, base: f, envoyer: false }, recue: true };
      // Modifiée ici depuis : elle reste (rien de ce que tu as écrit ne disparaît
      // sans toi) et repart, traits compris, par-dessus la pierre tombale.
      return { ecriture: { attendu, donnees: fiche, base: f, envoyer: { pages: true }, visible: false }, recue: false };
    }

    const distante = normaliserFiche(f.donnees);
    if (!distante) throw new Error("fiche illisible : ses données ne sont pas une partition");
    distante.modifieLe = dateIso(f.modifieLe) ?? distante.modifieLe; // la date de la fiche fait foi
    const pagesBase = connue ? base.pagesLe ?? null : pagesLeLocal;
    const pagesChangeesLa = !!f.pagesLe && f.pagesLe !== pagesBase;
    const pagesDeLa = async () => (await appel("bibliotheque_pages", { id: f.id })).pages || [];

    if (!fiche) {
      // Nouvelle ici ; ou supprimée ici, pas encore partie, mais modifiée là-bas
      // depuis : la modification l'emporte, la partition revient (D3).
      return { ecriture: { attendu, donnees: distante, pages: f.pagesLe ? await pagesDeLa() : [], base: f, envoyer: false }, recue: true };
    }
    if (!changeeIci) {
      if (!connue) {
        // D'avant les bases : une version plus récente ici reste, comme avant ; la même devient la base.
        if (fiche.modifieLe > distante.modifieLe) return null;
        if (egal(sansDates(fiche), sansDates(distante))) return { ecriture: { attendu, donnees: fiche, base: f, envoyer: false, visible: false }, recue: false };
      }
      return { ecriture: { attendu, donnees: distante, pages: pagesChangeesLa ? await pagesDeLa() : undefined, base: f, envoyer: false }, recue: true };
    }

    // Changée des deux côtés.
    const enVol = base && base.enVol;
    if (enVol && enVol.modifieLe === f.modifieLe && !enVol.supprime && enVol.empreinte === empreinte(distante)) {
      // Notre envoi, dont la réponse s'était perdue : la bibliothèque a ce qu'on
      // avait envoyé (même date, même contenu) ; ce qui a changé ici depuis
      // repartira, sans fusion.
      const rienDeNeuf = fiche.modifieLe === f.modifieLe;
      return { ecriture: { attendu, donnees: fiche, base: f, envoyer: rienDeNeuf ? false : { pages: !!envoi.pages }, visible: false }, recue: false };
    }
    if (fiche.modifieLe === distante.modifieLe && egal(sansDates(fiche), sansDates(distante))) {
      return { ecriture: { attendu, donnees: fiche, base: f, envoyer: false, visible: false }, recue: false };
    }
    const m = fusionnerFiches({ base: connue ? base.donnees : null, locale: fiche, distante });
    // Le son d'un mémo (les pages) suit le côté dont vient le mémo de la fiche.
    let pagesEcrites;
    let pagesAEnvoyer = !!envoi.pages;
    if (pagesChangeesLa && (m.memo === "distante" || !envoi.pages)) { pagesEcrites = await pagesDeLa(); pagesAEnvoyer = false; }
    const copie = m.copie ? copieDeConflit(f, m.copie, pages) : null;
    const commeLa = egal(sansDates(m.donnees), sansDates(distante)) && !pagesAEnvoyer;
    return {
      ecriture: { attendu, donnees: commeLa ? distante : m.donnees, pages: pagesEcrites, base: f, envoyer: commeLa ? false : { pages: pagesAEnvoyer } },
      recue: !egal(sansDates(m.donnees), sansDates(fiche)) || pagesEcrites !== undefined,
      copie,
    };
  }

  /** Reçoit une fiche sans arrêter la passe : ce qui ne peut pas se ranger ici est mis de côté, et le curseur avance (S12). */
  async function recevoirSansBloquer(f, bilan) {
    const id = f && typeof f.id === "string" && ID.test(f.id) ? f.id : null;
    if (!id) return null; // sans identifiant valable, rien à quoi la rattacher
    try {
      if (dateIso(f.modifieLe) === null) throw new Error("fiche sans date de modification");
      const r = await recevoir(f);
      if (r.recue) bilan.recues++;
      if (r.copie) bilan.conflits++;
    } catch (e) {
      if (e && e.reseau) throw e; // le réseau : la passe s'arrête, le curseur reste, tout sera relu
      await local.mettreEnQuarantaine({ id, sens: "reception", raison: texteErreur(e), le: new Date().toISOString(), modifieLe: f.modifieLe, fiche: f });
      receptionsDeCote.add(id);
    }
    return id;
  }

  // --- Envoyer ------------------------------------------------------------

  const mettreDeCote = (id, envoi, raison) => local.mettreEnQuarantaine({ id, sens: "envoi", numero: envoi.numero ?? null, modifieLe: envoi.modifieLe, raison, le: new Date().toISOString() });

  /** Envoie ce qui attend pour `id`, en fusionnant tant que la bibliothèque a changé entre-temps. */
  async function envoyer(id) {
    let conflits = 0;
    for (let essai = 0; essai < ESSAIS; essai++) {
      const { fiche, envoi, base, pages } = await local.etatSynchro(id, { pages: true });
      if (!envoi) return { envoyee: false, conflits }; // parti entre-temps (un autre onglet, une fusion)
      const args = envoi.supprime
        ? { id, supprime: true, modifieLe: envoi.modifieLe }
        : fiche ? { id, donnees: fiche, pages: envoi.pages ? pages || [] : null, modifieLe: fiche.modifieLe } : null;
      if (!args) { await local.envoye(id, envoi.numero ?? null); return { envoyee: false, conflits }; } // plus rien à envoyer
      // La version d'où part cet envoi (null : la bibliothèque ne doit pas l'avoir
      // encore), et son numéro de révision quand on le connaît.
      args.base = base && typeof base.modifieLe === "string" ? base.modifieLe : null;
      if (args.base && Number.isInteger(base.rev)) args.baseRev = base.rev;
      const taille = new TextEncoder().encode(JSON.stringify(args)).length;
      if (taille > ENVOI_MAX) {
        await mettreDeCote(id, envoi, `trop lourde pour la bibliothèque commune (${(taille / 1048576).toFixed(1)} Mo : 256 Ko de fiche et 5 Mo de traits ou de mémo au plus)`);
        return { envoyee: false, conflits };
      }
      await local.marquerEnVol(id, { modifieLe: args.modifieLe, supprime: !!args.supprime, empreinte: args.donnees ? empreinte(args.donnees) : null });
      const r = await appel("bibliotheque_ecrire", args);
      if (r.accepte) {
        await local.envoye(id, envoi.numero ?? null, r.fiche || { id, donnees: args.donnees || null, modifieLe: args.modifieLe, supprime: !!args.supprime, pagesLe: null });
        pannes.delete(id);
        return { envoyee: true, conflits };
      }
      if (r.refus) { await mettreDeCote(id, envoi, r.refus); return { envoyee: false, conflits }; }
      if (r.actuelle) {
        // La bibliothèque a changé depuis notre base : on prend sa version (fusion), et on renvoie.
        const rr = await recevoir(r.actuelle);
        if (rr.copie) conflits++;
        continue;
      }
      throw Object.assign(new Error("réponse inattendue du connecteur"), { code: "tool_error" });
    }
    return { envoyee: false, conflits };
  }

  /** Envoie sans arrêter la passe : un refus met la partition de côté, et les suivantes partent (S5). */
  async function envoyerSansBloquer(e, bilan) {
    try {
      const r = await envoyer(e.id);
      if (r.envoyee) bilan.envoyees++;
      bilan.conflits += r.conflits;
    } catch (err) {
      if (err && err.reseau) throw err;
      const raison = texteErreur(err);
      const p = pannes.get(e.id);
      const n = p && p.numero === e.numero ? p.n + 1 : 1;
      pannes.set(e.id, { numero: e.numero, n });
      // Un refus (format, taille, date, HTTP 413), une erreur d'ici, ou une panne qui se répète : de côté.
      // Une panne isolée du connecteur (son stockage) : la prochaine fois.
      if (!refusOutil(err) || ANCIENS_REFUS.test(raison) || n >= PANNES_AVANT_QUARANTAINE) {
        await mettreDeCote(e.id, e, raison);
        pannes.delete(e.id);
      }
    }
  }

  // --- Une passe ----------------------------------------------------------

  async function passe() {
    const bilan = { envoyees: 0, recues: 0, conflits: 0 };
    // Premier passage de cet appareil : tout ce qu'il a déjà rejoint la bibliothèque commune.
    if (!(await local.lireMeta("rejoint"))) {
      await local.toutEnvoyer();
      await local.ecrireMeta("rejoint", true);
    }
    let quarantaine = await local.quarantaine();
    if (premiere) {
      // Une session neuve : les envois mis de côté retentent leur chance (une panne a pu passer, l'appli a pu changer).
      for (const q of quarantaine) if (q.sens === "envoi") await local.leverQuarantaine(q.id, "envoi");
      quarantaine = quarantaine.filter((q) => q.sens !== "envoi");
      premiere = false;
    }
    receptionsDeCote = new Set(quarantaine.filter((q) => q.sens === "reception").map((q) => q.id));

    // 1. Recevoir (D1)
    const depuis = (await local.lireMeta("curseur")) || null;
    const r = await appel("bibliotheque_changements", { depuis });
    const essayees = new Set();
    for (const f of Array.isArray(r.partitions) ? r.partitions : []) essayees.add(await recevoirSansBloquer(f, bilan));
    if (typeof r.curseur === "string" && r.curseur) await local.ecrireMeta("curseur", r.curseur);
    // Ce qu'on n'avait pas pu ranger ici (stockage plein…) réessaie, sauf si une version plus récente est arrivée depuis.
    for (const q of quarantaine) {
      if (q.sens !== "reception" || !q.fiche || !receptionsDeCote.has(q.id) || essayees.has(q.id)) continue;
      const { base } = await local.etatSynchro(q.id);
      if (base && typeof base.modifieLe === "string" && base.modifieLe >= q.fiche.modifieLe) {
        await local.leverQuarantaine(q.id, "reception");
        receptionsDeCote.delete(q.id);
        continue;
      }
      await recevoirSansBloquer(q.fiche, bilan);
    }

    // 2. Envoyer
    const deCote = new Map((await local.quarantaine()).filter((q) => q.sens === "envoi").map((q) => [q.id, q.numero ?? null]));
    for (const e of await local.enAttente()) {
      // Mise de côté : elle repartira quand la fiche changera (un nouvel envoi, un autre numéro).
      if (deCote.has(e.id) && deCote.get(e.id) === (e.numero ?? null)) continue;
      await envoyerSansBloquer(e, bilan);
    }
    return bilan;
  }

  async function etatDeLaFile() {
    const [attente, quarantaine] = await Promise.all([local.enAttente().catch(() => []), local.quarantaine().catch(() => [])]);
    // Un envoi mis de côté n'attend plus (il attend que la fiche change) ; changée depuis, il attend de nouveau.
    const deCote = new Map(quarantaine.filter((q) => q.sens === "envoi").map((q) => [q.id, q.numero ?? null]));
    return { attente: attente.filter((e) => !(deCote.has(e.id) && deCote.get(e.id) === (e.numero ?? null))).length, quarantaine: quarantaine.length };
  }

  // --- Ce que l'appli peut demander ------------------------------------------

  const api = {
    /**
     * Une synchronisation ; si une autre est en cours (dans cet onglet), elle
     * repassera à la fin. Rend { envoyees, recues, conflits, quarantaine }.
     */
    synchroniser() {
      if (enCours) { encore = true; return enCours; }
      enCours = (async () => {
        surEtat({ etat: "encours" });
        let bilan = { envoyees: 0, recues: 0, conflits: 0 };
        try {
          await verrou(VERROU, async () => {
            do {
              encore = false;
              const b = await passe();
              bilan = { envoyees: bilan.envoyees + b.envoyees, recues: bilan.recues + b.recues, conflits: bilan.conflits + b.conflits };
            } while (encore);
          });
          const file = await etatDeLaFile();
          bilan = { ...bilan, quarantaine: file.quarantaine };
          surEtat({ etat: "ok", le: new Date().toISOString(), ...bilan, attente: file.attente });
          return bilan;
        } catch (e) {
          surEtat({ etat: "erreur", erreur: e, ...(await etatDeLaFile()) });
          throw e;
        } finally {
          enCours = null;
        }
      })();
      return enCours;
    },
    /** Ce qui a été mis de côté : [{ id, sens: "envoi" | "reception", raison, le, modifieLe }]. */
    async quarantaine() {
      return (await local.quarantaine()).map(({ fiche: _f, ...q }) => q);
    },
    /**
     * Réessaie tout de suite ce qui a été mis de côté (tout, ou seulement `id`).
     * Une réception mise de côté se réessaie déjà à chaque passage, avec la
     * fiche gardée : lever sa quarantaine la ferait oublier, puisque le
     * curseur est passé (trouvé en branchant le bouton « Réessayer », lot
     * « écrans des données »). Seuls les envois sont levés ; la passe qui
     * suit relit les réceptions.
     */
    async reessayer(id = null) {
      for (const q of await local.quarantaine()) if (q.sens === "envoi" && (!id || q.id === id)) await local.leverQuarantaine(q.id, "envoi");
      return api.synchroniser();
    },
    /** Les versions d'une partition gardées par la bibliothèque commune (D6), de la plus récente à la plus ancienne. */
    async versions(id) {
      return (await appel("bibliotheque_versions", { id })).versions || [];
    },
    /** Une version (la fiche entière) ; `rev` départage deux versions de même date. */
    async version(id, modifieLe, rev = null) {
      return (await appel("bibliotheque_version", { id, modifieLe, ...(Number.isInteger(rev) ? { rev } : {}) })).fiche || null;
    },
    /** Les partitions supprimées depuis moins de 30 jours : [{ id, titre, type, supprimeLe, modifieLe, rev, expireLe }]. */
    async corbeille() {
      return (await appel("bibliotheque_corbeille", {})).corbeille || [];
    },
    /**
     * Reprend une version précédente. Elle s'écrit comme une modification
     * neuve (la version d'aujourd'hui devient une version précédente à son
     * tour), puis part vers les autres appareils.
     */
    async recupererVersion(id, modifieLe, rev = null) {
      const v = await api.version(id, modifieLe, rev);
      const donnees = v && !v.supprime ? normaliserFiche(v.donnees) : null;
      if (!donnees) throw new Error("Cette version n'est plus dans la bibliothèque commune.");
      const ici = await local.lire(id);
      const maintenant = new Date().toISOString();
      if (ici) {
        // Tout le contenu de la version, sauf son mémo : la bibliothèque ne garde que le dernier son.
        const avant = Object.fromEntries(Object.keys(ici).filter((k) => k !== "id").map((k) => [k, undefined]));
        await local.modifier(id, { ...avant, ...donnees, memo: ici.memo ?? null, creeLe: ici.creeLe, modifieLe: maintenant });
      } else {
        // Supprimée ici : elle revient, avec ses traits ou son mémo (gardés 30 jours avec la corbeille).
        const pages = (await appel("bibliotheque_pages", { id })).pages || [];
        const avecMemo = pages.find((p) => p && p.memo);
        await local.creer(id, { ...donnees, modifieLe: maintenant }, avecMemo ? [] : pages.filter(Array.isArray).map(decompacter), { memo: avecMemo ? avecMemo.memo : null });
      }
      return api.synchroniser();
    },
    /** Fait revenir une partition de la corbeille. */
    async recupererSupprimee(id) {
      const entree = (await api.corbeille()).find((e) => e.id === id);
      if (!entree) throw new Error("Cette partition n'est plus dans la corbeille (elle y reste 30 jours).");
      return api.recupererVersion(id, entree.modifieLe, Number.isInteger(entree.rev) ? entree.rev : null);
    },
  };
  return api;
}
