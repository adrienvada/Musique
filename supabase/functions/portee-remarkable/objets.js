/**
 * LE STOCKAGE SUPABASE, EN OBJETS JSON
 *
 * Un petit client du stockage Supabase (compartiment privé, clé de service
 * donnée d'office à la fonction, supabase.js) : lire, écrire, supprimer un
 * objet JSON, lister un dossier avec la date de dernière écriture de chaque
 * objet. La bibliothèque synchronisée s'en sert (bibliotheque.js). Aucun
 * schéma à créer dans la base du site : juste des fichiers dans un
 * compartiment privé.
 */
import { entetesSupabase, MANQUE_CLE } from "./supabase.js";

const COMPARTIMENT = "portee-remarkable";

/**
 * Les réglages du compartiment (S4), posés à sa création. Une taille
 * maximale par objet : le stockage refuse lui-même ce qui la dépasse, même
 * si une borne du code venait à manquer. 6 Mo : rien de plus gros n'entre
 * par la porte du connecteur (TAILLE_MAX, http.js), et le plus gros objet
 * rangé, les pages d'une partition, en fait 5 au plus (bibliotheque.js).
 * Aucune liste de types (allowed_mime_types) : le coffre range le jeton en
 * text/plain, la bibliothèque en JSON.
 */
export const REGLAGES_COMPARTIMENT = { public: false, file_size_limit: 6 * 1024 * 1024 };

/** « Déjà là » : HTTP 409, ou 400 avec « 409 / Duplicate » dans la réponse (versions plus anciennes du stockage). */
const dejaLa = (statut, texte) => statut === 409 || (statut === 400 && /"409"|Duplicate|already exists/i.test(texte));

export function objetsSupabase(url, cle, compartiment = COMPARTIMENT) {
  if (!url || !cle) throw new Error(MANQUE_CLE);
  const entetes = entetesSupabase(cle);
  const adresse = (chemin) => `${url}/storage/v1/object/${compartiment}/${chemin}`;
  let preparation = null;

  /**
   * Avant la première écriture du client (index.ts en garde un par
   * démarrage) : une seule préparation, même pour deux écritures
   * simultanées. Si le stockage ne répond pas, l'écriture suivante la refait.
   */
  function preparerCompartiment() {
    preparation ??= creerCompartiment().catch((e) => { preparation = null; throw e; });
    return preparation;
  }

  async function creerCompartiment() {
    const r = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...entetes, "content-type": "application/json" },
      body: JSON.stringify({ id: compartiment, name: compartiment, ...REGLAGES_COMPARTIMENT }),
    });
    if (r.ok) { await r.body?.cancel(); return; }
    // Déjà là : on lui redit ses réglages. Un autre refus (une clé
    // refusée…) : l'écriture qui suit dira le sien.
    if (dejaLa(r.status, await r.text().catch(() => ""))) await reglerCompartiment();
  }

  /**
   * Redit ses réglages au compartiment qui existe déjà : c'est ce qui borne
   * un compartiment créé avant la borne, et c'est sans effet sur les autres.
   * Un échec n'empêche ni de lire ni d'écrire : on réessaiera au démarrage
   * suivant.
   */
  async function reglerCompartiment() {
    try {
      const r = await fetch(`${url}/storage/v1/bucket/${compartiment}`, {
        method: "PUT",
        headers: { ...entetes, "content-type": "application/json" },
        body: JSON.stringify(REGLAGES_COMPARTIMENT),
      });
      await r.body?.cancel();
    } catch {
      // Une coupure : la borne attendra le prochain démarrage.
    }
  }

  /** Tout ce que le stockage range sous `dossier`, objets et sous-dossiers, page par page. */
  async function listerTout(dossier) {
    const sortie = [];
    for (let decalage = 0; ; decalage += 1000) {
      const r = await fetch(`${url}/storage/v1/object/list/${compartiment}`, {
        method: "POST",
        headers: { ...entetes, "content-type": "application/json" },
        body: JSON.stringify({ prefix: dossier, limit: 1000, offset: decalage, sortBy: { column: "name", order: "asc" } }),
      });
      if (!r.ok) {
        await r.body?.cancel();
        if (r.status === 400 || r.status === 404) return sortie; // pas encore de compartiment
        throw new Error(`Le stockage Supabase refuse de lister ${dossier} (HTTP ${r.status}).`);
      }
      const page = await r.json();
      sortie.push(...page);
      if (page.length < 1000) return sortie;
    }
  }

  return {
    /** L'objet JSON, ou null s'il n'existe pas. */
    async lire(chemin) {
      const r = await fetch(adresse(chemin), { headers: entetes });
      if (r.ok) return r.json();
      await r.body?.cancel();
      if (r.status === 400 || r.status === 404) return null;
      throw new Error(`Le stockage Supabase refuse la lecture de ${chemin} (HTTP ${r.status}).`);
    },
    async ecrire(chemin, objet) {
      await preparerCompartiment();
      const r = await fetch(adresse(chemin), {
        method: "POST",
        headers: { ...entetes, "content-type": "application/json", "x-upsert": "true" },
        body: JSON.stringify(objet),
      });
      await r.body?.cancel();
      if (!r.ok) throw new Error(`Le stockage Supabase refuse d'écrire ${chemin} (HTTP ${r.status}).`);
    },
    /**
     * Crée l'objet seulement s'il n'existe pas encore (sans « x-upsert ») :
     * rend false s'il existe déjà. Le stockage ne laisse réussir qu'une
     * création à la fois : c'est le verrou de la bibliothèque (bibliotheque.js).
     */
    async creer(chemin, objet) {
      await preparerCompartiment();
      const r = await fetch(adresse(chemin), {
        method: "POST",
        headers: { ...entetes, "content-type": "application/json" },
        body: JSON.stringify(objet),
      });
      if (r.ok) { await r.body?.cancel(); return true; }
      if (dejaLa(r.status, await r.text().catch(() => ""))) return false;
      throw new Error(`Le stockage Supabase refuse de créer ${chemin} (HTTP ${r.status}).`);
    },
    async supprimer(chemin) {
      const r = await fetch(adresse(chemin), { method: "DELETE", headers: entetes });
      await r.body?.cancel();
      if (!r.ok && r.status !== 400 && r.status !== 404) throw new Error(`Le stockage Supabase refuse de supprimer ${chemin} (HTTP ${r.status}).`);
    },
    /** Les objets d'un dossier : [{ nom, maj }] (maj : date ISO de la dernière écriture). */
    async lister(dossier) {
      // Les sous-dossiers reviennent avec un id nul : on ne garde que les objets.
      return (await listerTout(dossier)).filter((o) => o.id).map((o) => ({ nom: o.name, maj: o.updated_at || o.created_at }));
    },
    /** Les sous-dossiers d'un dossier : leurs noms (les suggestions, rangées par partition). */
    async listerDossiers(dossier) {
      return (await listerTout(dossier)).filter((o) => !o.id).map((o) => o.name);
    },
  };
}
