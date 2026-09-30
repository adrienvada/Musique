/**
 * LE COFFRE DU JETON D'APPAREIL
 *
 * Quand Adrien relie sa tablette depuis l'appli (code à 8 lettres), le
 * connecteur obtient un jeton d'appareil reMarkable et le range ici : un
 * compartiment privé du stockage Supabase, que seule la clé de service
 * (donnée d'office à la fonction) peut lire. Le jeton ne passe ainsi ni
 * par la conversation, ni par l'appli, ni par le dépôt.
 */
const COMPARTIMENT = "portee-remarkable";
const OBJET = "jeton-appareil";

export function coffreSupabase(url, cle) {
  if (!url || !cle) throw new Error("Il manque SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY à la fonction.");
  const entetes = { apikey: cle, authorization: `Bearer ${cle}` };
  const adresse = `${url}/storage/v1/object/${COMPARTIMENT}/${OBJET}`;
  return {
    async lire() {
      const r = await fetch(adresse, { headers: entetes });
      if (r.ok) return (await r.text()).trim() || null;
      await r.body?.cancel();
      // Ni jeton ni compartiment : la tablette n'a jamais été reliée.
      if (r.status === 400 || r.status === 404) return null;
      throw new Error(`Le stockage Supabase refuse la lecture du jeton (HTTP ${r.status}).`);
    },
    async ecrire(jeton) {
      // Crée le compartiment privé au premier passage (400 ou 409 s'il existe déjà).
      const c = await fetch(`${url}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...entetes, "content-type": "application/json" },
        body: JSON.stringify({ id: COMPARTIMENT, name: COMPARTIMENT, public: false }),
      });
      await c.body?.cancel();
      const r = await fetch(adresse, {
        method: "POST",
        headers: { ...entetes, "content-type": "text/plain", "x-upsert": "true" },
        body: jeton,
      });
      await r.body?.cancel();
      if (!r.ok) throw new Error(`Le stockage Supabase refuse de ranger le jeton (HTTP ${r.status}).`);
    },
  };
}

/** Un coffre en mémoire, pour les tests (ou un jeton fixé d'avance). */
export function coffreMemoire(jeton = null) {
  return {
    async lire() { return jeton; },
    async ecrire(j) { jeton = j; },
  };
}
