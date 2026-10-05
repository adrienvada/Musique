/**
 * LE COFFRE DU JETON D'APPAREIL
 *
 * Quand Adrien relie sa tablette depuis l'appli (code à 8 lettres), le
 * connecteur obtient un jeton d'appareil reMarkable et le range ici : un
 * compartiment privé du stockage Supabase, que seule la clé de service
 * (donnée d'office à la fonction, supabase.js) peut lire. Le jeton ne passe
 * ainsi ni par la conversation, ni par l'appli, ni par le dépôt.
 *
 * CHIFFRÉ. Ce jeton permettrait d'écrire dans le cloud reMarkable d'Adrien
 * (Portée ne le fait jamais) : il ne dort pas en clair. Il est chiffré en
 * AES-GCM avec une clé tirée du secret PORTEE_COFFRE de la fonction, que le
 * script de déploiement crée une fois pour toutes. Quelqu'un qui lirait le
 * compartiment (une clé de service qui fuit, une sauvegarde) n'en tirerait
 * rien sans ce secret, rangé ailleurs.
 *   - Un jeton encore en clair (relié avant le chiffrement) se lit, puis se
 *     range chiffré : rien à refaire pour Adrien.
 *   - Si le secret change ou se perd, le jeton ne se déchiffre plus : la
 *     tablette apparaît « à relier », comme après une révocation, sans
 *     erreur incompréhensible.
 *   - Sans PORTEE_COFFRE (fonction déployée à la main, sans le script), le
 *     coffre range le jeton en clair, comme avant.
 *
 * WebCrypto : le même code sous Deno (Supabase) et Node (tests).
 */
import { REGLAGES_COMPARTIMENT } from "./objets.js";
import { entetesSupabase, MANQUE_CLE } from "./supabase.js";

const COMPARTIMENT = "portee-remarkable";
const OBJET = "jeton-appareil";
const PREFIXE = "portee-coffre:v1:";

/** Le jeton du coffre ne se déchiffre plus (secret perdu ou changé, objet abîmé). */
export class JetonIlisible extends Error {}

const code = new TextEncoder();
// Lie le chiffré à son usage : le même secret ne pourrait pas servir à
// faire passer un autre objet pour ce jeton.
const CONTEXTE = code.encode("portee-remarkable:jeton-appareil");

/** La clé AES-GCM, tirée du secret par HKDF (le secret ne sert jamais tel quel). */
async function cleDuCoffre(secret) {
  const brute = await crypto.subtle.importKey("raw", code.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: code.encode("portee-remarkable/coffre"), info: code.encode("jeton-appareil v1") },
    brute,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const enBase64Url = (octets) => btoa(String.fromCharCode(...octets)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const depuisBase64Url = (t) => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Le jeton chiffré, prêt à ranger : « portee-coffre:v1:<iv>.<chiffré> ». */
export async function chiffrer(jeton, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // jamais deux fois le même
  const chiffre = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: CONTEXTE }, await cleDuCoffre(secret), code.encode(jeton));
  return `${PREFIXE}${enBase64Url(iv)}.${enBase64Url(new Uint8Array(chiffre))}`;
}

/** Le jeton en clair ; JetonIlisible si le secret n'est pas le bon ou si l'objet est abîmé. */
export async function dechiffrer(texte, secret) {
  try {
    const [iv, chiffre] = texte.slice(PREFIXE.length).split(".");
    const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: depuisBase64Url(iv), additionalData: CONTEXTE }, await cleDuCoffre(secret), depuisBase64Url(chiffre));
    return new TextDecoder("utf-8", { fatal: true }).decode(clair);
  } catch {
    throw new JetonIlisible("Le jeton de la tablette ne se déchiffre plus (la clé du coffre a changé) : relie à nouveau la tablette.");
  }
}

export const estChiffre = (texte) => typeof texte === "string" && texte.startsWith(PREFIXE);

/**
 * Le coffre dans le stockage Supabase. `secret` : la valeur de PORTEE_COFFRE
 * (null : le jeton reste en clair, comme avant le chiffrement).
 * @param {string | undefined} url
 * @param {string | null | undefined} cle
 * @param {{ secret?: string | null }} [options]
 */
export function coffreSupabase(url, cle, { secret = null } = {}) {
  if (!url || !cle) throw new Error(MANQUE_CLE);
  const entetes = entetesSupabase(cle);
  const adresse = `${url}/storage/v1/object/${COMPARTIMENT}/${OBJET}`;

  async function lireBrut() {
    const r = await fetch(adresse, { headers: entetes });
    if (r.ok) return (await r.text()).trim() || null;
    await r.body?.cancel();
    // Ni jeton ni compartiment : la tablette n'a jamais été reliée.
    if (r.status === 400 || r.status === 404) return null;
    throw new Error(`Le stockage Supabase refuse la lecture du jeton (HTTP ${r.status}).`);
  }

  async function ecrireBrut(texte) {
    // Crée le compartiment privé au premier passage, avec les réglages de la
    // bibliothèque (sa taille maximale, objets.js). S'il existe déjà (400 ou
    // 409), la bibliothèque les lui redit à sa première écriture.
    const c = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...entetes, "content-type": "application/json" },
      body: JSON.stringify({ id: COMPARTIMENT, name: COMPARTIMENT, ...REGLAGES_COMPARTIMENT }),
    });
    await c.body?.cancel();
    const r = await fetch(adresse, {
      method: "POST",
      headers: { ...entetes, "content-type": "text/plain", "x-upsert": "true" },
      body: texte,
    });
    await r.body?.cancel();
    if (!r.ok) throw new Error(`Le stockage Supabase refuse de ranger le jeton (HTTP ${r.status}).`);
  }

  return {
    async lire() {
      const texte = await lireBrut();
      if (!texte) return null;
      if (estChiffre(texte)) {
        if (!secret) throw new JetonIlisible("Le jeton de la tablette est chiffré, mais la fonction n'a pas PORTEE_COFFRE : relie à nouveau la tablette.");
        return dechiffrer(texte, secret);
      }
      // Un jeton rangé en clair avant le chiffrement : on le chiffre au passage.
      // Si l'écriture échoue, on réessaiera à la prochaine lecture.
      if (secret) await ecrireBrut(await chiffrer(texte, secret)).catch(() => {});
      return texte;
    },
    async ecrire(jeton) {
      await ecrireBrut(secret ? await chiffrer(jeton, secret) : jeton);
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
