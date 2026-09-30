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
 * façon de faire.
 */
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
      } catch {
        throw { code: "server_unavailable", message: "Le connecteur ne répond pas (connexion ?)." };
      }
      if (r.status === 404) throw { code: "adresse_invalide", message: "Cette adresse ne mène à aucun connecteur : vérifie-la." };
      if (!r.ok) throw { code: "server_unavailable", message: `Le connecteur répond HTTP ${r.status}.` };
      const reponse = await r.json();
      if (reponse.error) throw { code: "tool_error", message: reponse.error.message, result: reponse };
      if (reponse.result.isError) throw { code: "tool_error", message: "tool_error", result: reponse.result };
      return { payload: reponse.result.structuredContent, content: reponse.result.content };
    },
  };
}
