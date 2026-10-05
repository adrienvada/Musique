/**
 * LE CONNECTEUR REMARKABLE, VU DE L'APPLI
 *
 * Sur claude.ai, la page passe par la capacité `mcp` : c'est claude.ai qui
 * appelle le connecteur « Portée reMarkable ». Ailleurs (GitHub Pages), la
 * page l'appelle elle-même : même fonction Supabase, mêmes outils, en
 * JSON-RPC. Son adresse contient la clé qui protège la tablette : elle ne
 * peut pas figurer dans le code d'un site public, alors Adrien la colle une
 * fois dans chaque navigateur, qui la garde.
 *
 * Les deux chemins rendent la même chose (`payload`) et rejettent avec les
 * mêmes codes d'erreur que la capacité `mcp`, pour que l'appli n'ait qu'une
 * façon de faire. Ce sont de vraies Error (avec leur pile, et la cause
 * d'origine quand il y en a une), qui portent ce `code` (audit du 04/10, T4).
 */
import { erreur } from "./erreurs.js";

const CLE_ADRESSE = "portee:connecteur";
export const FORME_ADRESSE = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/portee-remarkable\/[A-Za-z0-9_-]{24,}$/;

export function adresseEnregistree() {
  try { return localStorage.getItem(CLE_ADRESSE) || ""; } catch { return ""; }
}

export function enregistrerAdresse(adresse) {
  try {
    if (adresse) localStorage.setItem(CLE_ADRESSE, adresse);
    else localStorage.removeItem(CLE_ADRESSE);
  } catch { /* navigation privée : l'adresse ne sera pas gardée */ }
}

/**
 * Un document de la tablette, par tranches (audit du 04/10, C3). claude.ai
 * coupe un résultat d'outil au-delà d'environ 150 000 caractères, et trois
 * pages denses suffisaient à le dépasser : l'import échouait. Avec `pages`,
 * le connecteur s'arrête avant (140 000) et dit ce qui reste à lire
 * (`pagesRestantes`, des numéros) : on le redemande jusqu'à la dernière page,
 * 500 au plus par demande (sa limite). Un connecteur d'avant ignore `pages`
 * et rend tout d'un coup : la boucle s'arrête au premier tour.
 *
 * Rend la réponse du premier tour, avec toutes les pages (dans l'ordre) et
 * toutes les pages illisibles.
 * @param {{ callTool: (serveur: string, outil: string, args: object, options?: object) => Promise<any> }} m  la capacité `mcp`, ou connecteurDirect
 * @param {string} serveur  le nom du connecteur (« Portée reMarkable »)
 * @param {string} id  le document
 */
export async function documentParTranches(m, serveur, id, { tranche = 500, toursMax = 400 } = {}) {
  /** @type {any} */
  let premier = null;
  const pages = new Map(), illisibles = new Map();
  // Une page sans numéro (aucun connecteur connu n'en rend, mais on ne la perd pas) : à la suite, dans l'ordre.
  const sansNumero = [];
  /** @type {number[] | { de: number, a: number } | null} */
  let demande = { de: 1, a: tranche };
  let fin = tranche; // la dernière page de la plage demandée en dernier
  for (let tour = 0; demande && tour < toursMax; tour++) {
    const r = await m.callTool(serveur, "document", { id, pages: demande }, { cache: false });
    const d = (r && r.payload) || {};
    premier ??= d;
    const avant = pages.size + illisibles.size;
    for (const p of Array.isArray(d.pages) ? d.pages : []) {
      if (p && Number.isInteger(p.numero)) pages.set(p.numero, p);
      else if (p) sansNumero.push(p);
    }
    for (const p of Array.isArray(d.pagesIllisibles) ? d.pagesIllisibles : []) if (p && Number.isInteger(p.numero)) illisibles.set(p.numero, p);
    const restantes = (Array.isArray(d.pagesRestantes) ? d.pagesRestantes : []).filter((n) => Number.isInteger(n) && !pages.has(n) && !illisibles.has(n));
    // Rien de neuf à ce tour : on ne redemande pas la même chose sans fin.
    if (pages.size + illisibles.size === avant && tour > 0) break;
    if (restantes.length) demande = restantes.slice(0, tranche);
    else if (Number.isInteger(d.nombrePages) && fin < d.nombrePages) {
      demande = { de: fin + 1, a: Math.min(fin + tranche, d.nombrePages) };
      fin = demande.a;
    } else demande = null;
  }
  const parNumero = (/** @type {any} */ x, /** @type {any} */ y) => x.numero - y.numero;
  return { ...(premier || {}), pages: [...[...pages.values()].sort(parNumero), ...sansNumero], pagesIllisibles: [...illisibles.values()].sort(parNumero), pagesRestantes: [] };
}

/** Un connecteur appelé directement, avec l'interface de la capacité `mcp`. */
export function connecteurDirect(adresse) {
  let numero = 0;
  return {
    direct: true,
    async callTool(_serveur, outil, args = {}) {
      let r;
      try {
        r = await fetch(adresse, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++numero, method: "tools/call", params: { name: outil, arguments: args } }),
        });
      } catch (cause) {
        throw erreur("server_unavailable", "Le connecteur ne répond pas (connexion ?).", { cause });
      }
      if (r.status === 404) throw erreur("adresse_invalide", "Cette adresse ne mène à aucun connecteur : vérifie-la.");
      if (!r.ok) throw erreur("server_unavailable", `Le connecteur répond HTTP ${r.status}.`);
      const reponse = await r.json();
      if (reponse.error) throw erreur("tool_error", reponse.error.message, { result: reponse });
      if (reponse.result.isError) throw erreur("tool_error", "tool_error", { result: reponse.result });
      return { payload: reponse.result.structuredContent, content: reponse.result.content };
    },
  };
}
