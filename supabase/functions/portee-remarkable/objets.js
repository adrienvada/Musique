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

export function objetsSupabase(url, cle, compartiment = COMPARTIMENT) {
  if (!url || !cle) throw new Error(MANQUE_CLE);
  const entetes = entetesSupabase(cle);
  const adresse = (chemin) => `${url}/storage/v1/object/${compartiment}/${chemin}`;
  let compartimentPret = false;

  async function creerCompartiment() {
    if (compartimentPret) return;
    const r = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...entetes, "content-type": "application/json" },
      body: JSON.stringify({ id: compartiment, name: compartiment, public: false }),
    });
    await r.body?.cancel(); // 200, ou 400/409 s'il existe déjà
    compartimentPret = true;
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
      await creerCompartiment();
      const r = await fetch(adresse(chemin), {
        method: "POST",
        headers: { ...entetes, "content-type": "application/json", "x-upsert": "true" },
        body: JSON.stringify(objet),
      });
      await r.body?.cancel();
      if (!r.ok) throw new Error(`Le stockage Supabase refuse d'écrire ${chemin} (HTTP ${r.status}).`);
    },
    async supprimer(chemin) {
      const r = await fetch(adresse(chemin), { method: "DELETE", headers: entetes });
      await r.body?.cancel();
      if (!r.ok && r.status !== 400 && r.status !== 404) throw new Error(`Le stockage Supabase refuse de supprimer ${chemin} (HTTP ${r.status}).`);
    },
    /** Les objets d'un dossier : [{ nom, maj }] (maj : date ISO de la dernière écriture). */
    async lister(dossier) {
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
        // Les sous-dossiers reviennent avec un id nul : on ne garde que les objets.
        for (const o of page) if (o.id) sortie.push({ nom: o.name, maj: o.updated_at || o.created_at });
        if (page.length < 1000) return sortie;
      }
    },
  };
}
