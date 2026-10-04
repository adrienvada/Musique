/**
 * LA CLÉ DE SERVICE DU PROJET SUPABASE
 *
 * Supabase retire les clés `anon` et `service_role` d'ici fin 2026, et un
 * projet restauré depuis le 1er novembre 2025 revient même sans elles. Les
 * fonctions reçoivent désormais SUPABASE_SECRET_KEYS, un dictionnaire JSON
 * des clés secrètes (`sb_secret_…`) rangées par nom, « default » en tête.
 * On la prend d'abord, et l'ancienne SUPABASE_SERVICE_ROLE_KEY seulement à
 * défaut : la même fonction marche avant, pendant et après la migration,
 * sans que personne ait à y toucher.
 *
 * Les deux sortes de clés ne voyagent pas pareil :
 *   - une clé secrète n'est pas un JWT : elle va dans l'en-tête `apikey`, et
 *     seulement là. Dans `Authorization: Bearer`, la plateforme essaie de la
 *     lire comme un JWT et répond « Invalid JWT » ;
 *   - l'ancienne clé, un JWT, garde ses deux en-têtes, comme avant : c'est
 *     ce que le stockage attendait d'elle.
 *
 * En JavaScript standard : Deno (Supabase) et Node (tests).
 */

/**
 * La clé de service, lue par `lire(nom)` (Deno.env.get dans la fonction) ;
 * null s'il n'y en a aucune.
 */
export function cleDeService(lire) {
  const brut = lire("SUPABASE_SECRET_KEYS");
  if (brut) {
    try {
      const cles = JSON.parse(brut);
      if (cles && typeof cles === "object") {
        // « default » d'abord ; sinon la première, si quelqu'un l'a renommée.
        const cle = typeof cles.default === "string" && cles.default ? cles.default : Object.values(cles).find((v) => typeof v === "string" && v);
        if (cle) return cle;
      }
    } catch {
      // Illisible : l'ancienne clé, si elle est encore là, fait l'affaire.
    }
  }
  return lire("SUPABASE_SERVICE_ROLE_KEY") || null;
}

/** Un JWT : trois segments base64url, l'en-tête JSON commençant par « eyJ ». */
export const estJwt = (cle) => typeof cle === "string" && /^eyJ[\w-]*\.[\w-]+\.[\w-]*$/.test(cle);

/** Les en-têtes qui ouvrent le stockage avec cette clé. */
export function entetesSupabase(cle) {
  return estJwt(cle) ? { apikey: cle, authorization: `Bearer ${cle}` } : { apikey: cle };
}

export const MANQUE_CLE = "Il manque SUPABASE_URL ou la clé de service (SUPABASE_SECRET_KEYS, ou l'ancienne SUPABASE_SERVICE_ROLE_KEY) à la fonction.";
