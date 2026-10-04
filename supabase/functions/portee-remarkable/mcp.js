/**
 * LE CONNECTEUR, CÔTÉ PROTOCOLE (MCP, transport HTTP « streamable »)
 *
 * claude.ai et le site parlent au connecteur en JSON-RPC. On répond en JSON
 * simple, sans session ni flux. Deux outils lisent la tablette
 * (arborescence, document) ; le troisième (relier) ne sert qu'une fois, pour
 * lui présenter Portée. Trois autres tiennent la bibliothèque synchronisée
 * entre les appareils d'Adrien (bibliotheque.js).
 *
 * DEUX ÉPOQUES SUR LA MÊME ADRESSE. La version 2026-07-28 du protocole n'a
 * plus de poignée de main : chaque requête porte sa version dans
 * params._meta, redite par l'en-tête MCP-Protocol-Version, avec sa méthode
 * et son nom dans Mcp-Method et Mcp-Name. Les versions d'avant (jusqu'à
 * 2025-11-25) commencent par `initialize`. On sert les deux, requête par
 * requête : claude.ai passe à la nouvelle version quand il veut, et le site
 * Portée continue d'appeler `tools/call` directement, sans `initialize` ni
 * en-tête, comme il l'a toujours fait.
 *
 * Les traits voyagent en entiers au demi-pixel (comme dans la base de
 * l'appli) : une page dense tient ainsi dans une soixantaine de kilo-octets.
 */
import { NonReliee } from "./remarkable.js";
import { appelerConversation, INVITES, NOMS_CONVERSATION, OUTILS_CONVERSATION, texteConversation, texteInvite } from "./conversation.js";
import { HTML_VUE, META_VUE, RESSOURCE_VUE, TYPE_VUE, URI_VUE } from "./vue-partition.js";

const OUTILS = [
  {
    name: "arborescence",
    title: "Arborescence de la reMarkable",
    description: "Liste les dossiers et documents de la reMarkable d'Adrien (sans la corbeille). Renvoie { connectee: true, noeuds, illisibles } ; chaque nœud : id, nom, type (dossier|document), parent (id du dossier, vide à la racine), modifie, pdf, pages. Un document que le cloud n'a pas su rendre est dans illisibles ({ id, raison }), sans empêcher les autres. Si la tablette n'est pas reliée : { connectee: false, raison: jamais|revoquee }.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "document",
    title: "Traits d'un document",
    description: "Télécharge un document de la reMarkable : son nom, le modèle Portée sur lequel il a été écrit (null sinon), son nombre de pages (nombrePages), celles qui ont de l'encre (pagesEcrites), et les traits de chaque page écrite (entiers au demi-pixel, x et y alternés, repère de l'écran 1404×1872). Sans pages : toutes d'un coup. Avec pages (par exemple [1, 2] ou { de: 3, a: 5 }) : seulement celles-là, et la réponse s'arrête avant 140 000 caractères environ ; les pages qui n'y tenaient pas sont dans pagesRestantes, à demander ensuite. Une page illisible est dans pagesIllisibles, sans empêcher les autres.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Identifiant du document, tel que donné par l'arborescence." },
        pages: {
          description: "Facultatif : les numéros de page voulus (à partir de 1, dans l'ordre du document), en liste ou en plage.",
          anyOf: [
            { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, maxItems: 500, uniqueItems: true },
            {
              type: "object",
              properties: { de: { type: "integer", minimum: 1 }, a: { type: "integer", minimum: 1, description: "Dernière page comprise ; sans lui, la seule page « de »." } },
              required: ["de"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "relier",
    title: "Relier la tablette",
    description: "Relie la reMarkable d'Adrien à Portée avec le code à usage unique de my.remarkable.com/device/desktop/connect (8 lettres). Le jeton obtenu reste côté connecteur. Renvoie l'arborescence, comme l'outil « arborescence ».",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string", description: "Le code à 8 lettres affiché par my.remarkable.com." } },
      required: ["code"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "bibliotheque_changements",
    title: "Bibliothèque : ce qui a changé",
    description: "Les partitions de la bibliothèque Portée écrites depuis un curseur (toutes sans curseur). Renvoie { partitions: [{ id, donnees, modifieLe, supprime, pagesLe }], curseur } ; donnees contient titre, abc, doutes, statut, tempo… Les traits sont à part (bibliotheque_pages).",
    inputSchema: {
      type: "object",
      properties: { depuis: { type: ["string", "null"], description: "Le curseur rendu par l'appel précédent." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "bibliotheque_pages",
    title: "Bibliothèque : traits d'une partition",
    description: "Les traits compactés d'une partition de la bibliothèque (entiers au demi-pixel, x et y alternés), page par page.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "bibliotheque_ecrire",
    title: "Bibliothèque : enregistrer une partition",
    description: "Enregistre une partition (ou sa suppression) dans la bibliothèque commune. Le plus récent gagne : si la bibliothèque a plus récent, renvoie { accepte: false, actuelle }.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        donnees: { type: ["object", "null"] },
        pages: { type: ["array", "null"], description: "Traits compactés, page par page ; absent si inchangés." },
        supprime: { type: "boolean" },
        modifieLe: { type: "string", description: "Date ISO de la modification, sur l'appareil." },
      },
      required: ["id", "modifieLe"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

const compacter = (traits) => traits.map((t) => t.flatMap(([x, y]) => [Math.round(x * 2), Math.round(y * 2)]));

// Ce qu'un document peut peser quand on en demande quelques pages : claude.ai
// coupe un résultat d'outil vers 150 000 caractères, et une page dense en
// fait 60 000. Sans choix de pages, l'appli reçoit tout, comme avant.
const BUDGET_DOCUMENT = 140000;

/** Le paramètre `pages` de l'outil document → des numéros triés, ou une erreur lisible. */
function lirePages(pages) {
  const entier = (n) => Number.isInteger(n) && n >= 1 && n <= 10000;
  if (Array.isArray(pages)) {
    if (!pages.length || pages.length > 500 || !pages.every(entier)) throw new Error("pages : une liste de 1 à 500 numéros de page (entiers à partir de 1).");
    return [...new Set(pages)].sort((a, b) => a - b);
  }
  if (pages && typeof pages === "object" && Object.keys(pages).every((k) => k === "de" || k === "a") && entier(pages.de)) {
    const a = pages.a === undefined ? pages.de : pages.a;
    if (!entier(a) || a < pages.de || a - pages.de >= 500) throw new Error("pages : « a » est un numéro de page, au moins égal à « de », 500 pages au plus.");
    return Array.from({ length: a - pages.de + 1 }, (_, i) => pages.de + i);
  }
  throw new Error("pages : une liste de numéros ([1, 2]) ou une plage ({ de: 1, a: 3 }).");
}

async function arborescence(cloud) {
  try {
    const { noeuds, illisibles } = await cloud.arborescence();
    return { connectee: true, noeuds, illisibles };
  } catch (e) {
    if (e instanceof NonReliee) return { connectee: false, raison: e.raison };
    throw e;
  }
}

async function appeler(nom, args, cloud, bibliotheque) {
  if (nom.startsWith("bibliotheque_")) {
    if (!bibliotheque) throw new Error("La bibliothèque synchronisée n'est pas disponible sur ce connecteur.");
    if (nom === "bibliotheque_changements") return bibliotheque.changements((args && args.depuis) || null);
    if (nom === "bibliotheque_pages") return { pages: await bibliotheque.pages(args && args.id) };
    if (nom === "bibliotheque_ecrire") return bibliotheque.ecrire(args || {});
  }
  if (nom === "arborescence") return arborescence(cloud);
  if (nom === "relier") {
    await cloud.relier(args && args.code);
    return arborescence(cloud);
  }
  if (nom === "document") {
    if (!args || typeof args.id !== "string") throw new Error("Il faut l'identifiant du document.");
    const voulues = args.pages === undefined || args.pages === null ? null : lirePages(args.pages);
    const options = voulues ? { pages: voulues, budget: BUDGET_DOCUMENT, mesure: (traits) => JSON.stringify(compacter(traits)).length } : {};
    const d = await cloud.document(args.id, options);
    if (voulues && !voulues.some((n) => n <= d.nombrePages)) throw new Error(`Ce document n'a que ${d.nombrePages} page${d.nombrePages > 1 ? "s" : ""}.`);
    return { ...d, pages: d.pages.map((p) => ({ numero: p.numero, traits: compacter(p.traits) })) };
  }
  throw new Error(`Outil inconnu : ${nom}`);
}

// ------------------------------------------------------------------------
// Le texte d'un résultat
// ------------------------------------------------------------------------

const pluriel = (n, un, plusieurs = un + "s") => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Le texte qui accompagne le résultat structuré. La spécification demande d'y
 * redire le JSON, pour les clients qui ne lisent que le texte : on le fait
 * pour un petit résultat. Les traits d'un document et les échanges de la
 * synchro, eux, ne servent qu'à l'appli, qui lit le résultat structuré : les
 * redire en texte les faisait voyager deux fois (et sérialiser deux fois).
 * Un mot les résume.
 */
function texteDe(nom, resultat) {
  const r = resultat || {};
  if (nom === "document") {
    const pages = (r.pages || []).map((p) => p.numero);
    const reste = (r.pagesRestantes || []).length ? ` ; à demander ensuite : ${r.pagesRestantes.join(", ")}` : "";
    const illisibles = (r.pagesIllisibles || []).length ? ` ; illisibles : ${r.pagesIllisibles.map((p) => p.numero).join(", ")}` : "";
    return `« ${r.nom} » : ${pluriel(pages.length, "page")} (${pages.join(", ") || "aucune"}) sur ${r.nombrePages ?? "?"}, modèle ${r.modele || "inconnu"}${reste}${illisibles}. Traits dans structuredContent.`;
  }
  if (nom.startsWith("bibliotheque_")) {
    if (Array.isArray(r.partitions)) return `${pluriel(r.partitions.length, "partition écrite", "partitions écrites")} depuis le curseur (détail dans structuredContent).`;
    if (Array.isArray(r.pages)) return `Traits de ${pluriel(r.pages.length, "page")} (dans structuredContent).`;
    if ("accepte" in r) return r.accepte ? "Enregistrée dans la bibliothèque commune." : "Refusée : la bibliothèque commune a plus récent (voir structuredContent).";
    return "Fait (détail dans structuredContent).";
  }
  const json = JSON.stringify(resultat);
  return json.length <= 20000 ? json : `Résultat structuré de ${Math.round(json.length / 1024)} Ko (voir structuredContent).`;
}

// ------------------------------------------------------------------------
// Le protocole : deux époques sur la même adresse
// ------------------------------------------------------------------------

/** La version d'aujourd'hui : plus d'`initialize`, chaque requête porte la sienne. */
export const VERSION_MODERNE = "2026-07-28";
/** Les versions à poignée de main, de la plus récente à la plus ancienne. */
export const VERSIONS_ANCIENNES = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const VERSIONS = [VERSION_MODERNE, ...VERSIONS_ANCIENNES];

const SERVEUR = { name: "portee-remarkable", version: "2.0.0" };
const INSTRUCTIONS = "La reMarkable d'Adrien pour l'appli Portée : arborescence, puis document. relier ne sert qu'à relier la tablette, avec un code de my.remarkable.com. Les outils bibliotheque_* tiennent la bibliothèque de partitions synchronisée entre ses appareils : ne t'en sers pas dans une conversation. Pour parler musique avec Adrien : partitions_lister et partition_lire lisent sa bibliothèque ; idee_ecrire note une idée neuve, seulement s'il le demande ; suggestion_ecrire range une proposition qu'il appliquera lui-même dans Portée. Adrien ne lit pas l'ABC : parle-lui en noms de notes, en mesures et en temps.";

const CLE_VERSION = "io.modelcontextprotocol/protocolVersion";
const CLE_SERVEUR = "io.modelcontextprotocol/serverInfo";

// Ce qu'un client peut garder un moment. Les listes ne changent qu'à un
// déploiement : cinq minutes suffisent. « private » : l'adresse porte une
// clé, aucun cache partagé n'a à garder ces réponses.
const CACHE = { ttlMs: 5 * 60 * 1000, cacheScope: "private" };
const EN_CACHE = new Set(["server/discover", "tools/list", "prompts/list", "resources/list", "resources/templates/list", "resources/read"]);

// Où l'en-tête Mcp-Name prend sa valeur, selon la méthode.
const NOM_DANS = { "tools/call": "name", "prompts/get": "name", "resources/read": "uri" };

/** Une erreur de protocole : son code JSON-RPC et le statut HTTP qui va avec. */
class ErreurMcp extends Error {
  constructor(code, message, statut = 200, data = undefined) {
    super(message);
    this.code = code;
    this.statut = statut;
    this.data = data;
  }
}

const reponseErreur = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } });

/** Un identifiant de requête : une chaîne ou un nombre (jamais null, dit MCP). */
const idValide = (id) => typeof id === "string" || (typeof id === "number" && Number.isFinite(id));

/** La valeur d'un en-tête Mcp-Name, décodée si elle est en « =?base64?…?= ». */
function decoderNom(valeur) {
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(valeur);
  if (!m) return valeur;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return undefined; // mal encodée : ne correspond à rien
  }
}

/**
 * L'époque d'une requête, et les en-têtes qui vont avec. `entetes` est null
 * hors HTTP (tests du protocole seul) : on ne vérifie alors que le corps.
 *   - Moderne : la requête porte sa version dans params._meta. L'en-tête
 *     MCP-Protocol-Version doit la redire, Mcp-Method la méthode, Mcp-Name
 *     le nom (tools/call, prompts/get) ou l'adresse (resources/read).
 *   - D'avant : `initialize`, ou rien dans _meta (le site, claude.ai avant
 *     2026-07-28). L'en-tête, s'il est là, nomme une version connue.
 */
function lireEpoque(msg, entetes) {
  const meta = msg.params && msg.params._meta && typeof msg.params._meta === "object" ? msg.params._meta : null;
  const version = meta ? meta[CLE_VERSION] : undefined;
  const entete = entetes ? entetes.get("mcp-protocol-version") : null;
  if (msg.method !== "initialize" && typeof version === "string" && !VERSIONS_ANCIENNES.includes(version)) {
    if (entetes) {
      if (entete === null) throw new ErreurMcp(-32020, "Il manque l'en-tête MCP-Protocol-Version.", 400);
      if (entete !== version) throw new ErreurMcp(-32020, `L'en-tête MCP-Protocol-Version (${entete}) ne redit pas la version du corps (${version}).`, 400);
    }
    // Le message est celui de la spécification, mot pour mot.
    if (version !== VERSION_MODERNE) throw new ErreurMcp(-32022, "Unsupported protocol version", 400, { supported: VERSIONS, requested: version });
    if (entetes) {
      const methode = entetes.get("mcp-method");
      if (methode === null) throw new ErreurMcp(-32020, "Il manque l'en-tête Mcp-Method.", 400);
      if (methode !== msg.method) throw new ErreurMcp(-32020, `L'en-tête Mcp-Method (${methode}) ne redit pas la méthode du corps (${msg.method}).`, 400);
      const champ = NOM_DANS[msg.method];
      if (champ) {
        const brut = entetes.get("mcp-name");
        if (brut === null) throw new ErreurMcp(-32020, "Il manque l'en-tête Mcp-Name.", 400);
        if (decoderNom(brut) !== msg.params[champ]) throw new ErreurMcp(-32020, `L'en-tête Mcp-Name ne redit pas params.${champ}.`, 400);
      }
    }
    // La spécification veut aussi io.modelcontextprotocol/clientCapabilities
    // dans chaque requête. On ne la réclame pas : ce serveur ne dépend
    // d'aucune capacité du client, et un client un peu en retard sur ce
    // point ne doit pas perdre la tablette pour autant.
    return { moderne: true };
  }
  if (entete !== null && !VERSIONS_ANCIENNES.includes(entete)) {
    if (entete === VERSION_MODERNE) throw new ErreurMcp(-32602, `Une requête ${VERSION_MODERNE} porte sa version dans params._meta (${CLE_VERSION}).`, 400);
    throw new ErreurMcp(-32022, "Unsupported protocol version", 400, { supported: VERSIONS, requested: entete });
  }
  return { moderne: false };
}

/**
 * Ce que sait faire le serveur. `extensions` n'existe qu'à partir de
 * 2026-07-28 : on y dit l'interface (MCP Apps). Avant, l'hôte la découvre
 * par `_meta.ui` sur l'outil partition_montrer.
 */
function capacites(moderne) {
  const c = { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } };
  return moderne ? { ...c, extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [TYPE_VUE] } } } : c;
}

// La tablette et la synchro d'abord, puis ce qui sert dans une conversation.
const outils = () => [...OUTILS, ...OUTILS_CONVERSATION];
const resoudre = (x) => (typeof x === "function" ? x() : x ?? null);

async function appelOutil(params, ctx) {
  const nom = params.name;
  if (typeof nom !== "string" || !outils().some((o) => o.name === nom)) {
    // Erreur de protocole, pas d'outil : le modèle n'y peut rien corriger.
    throw new ErreurMcp(-32602, `Outil inconnu : ${typeof nom === "string" ? nom : "(sans nom)"}`);
  }
  const args = params.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args)) throw new ErreurMcp(-32602, "Les arguments d'un outil forment un objet.");
  try {
    // Créés seulement maintenant : sans stockage configuré, `initialize` et
    // `tools/list` répondent quand même, et l'outil dit ce qui manque.
    if (NOMS_CONVERSATION.has(nom)) {
      const resultat = await appelerConversation(nom, args, { bibliotheque: resoudre(ctx.bibliotheque), suggestions: resoudre(ctx.suggestions) });
      return { content: [{ type: "text", text: texteConversation(nom, resultat) }], structuredContent: resultat };
    }
    const resultat = await appeler(nom, args, resoudre(ctx.cloud), resoudre(ctx.bibliotheque));
    return { content: [{ type: "text", text: texteDe(nom, resultat) }], structuredContent: resultat };
  } catch (e) {
    return { content: [{ type: "text", text: (e && e.message) || String(e) }], isError: true };
  }
}

async function executer(msg, epoque, ctx) {
  const p = msg.params || {};
  const inconnue = () => new ErreurMcp(-32601, `Méthode inconnue : ${msg.method}`, epoque.moderne ? 404 : 200);
  switch (msg.method) {
    case "initialize":
      // Négociation d'avant : la version demandée si on la connaît, sinon la
      // plus récente de celles d'avant (le client décide alors s'il continue).
      return {
        protocolVersion: VERSIONS_ANCIENNES.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS_ANCIENNES[0],
        capabilities: capacites(false),
        serverInfo: SERVEUR,
        instructions: INSTRUCTIONS,
      };
    case "ping":
      // Retiré en 2026-07-28 : une méthode comme une autre, inconnue.
      if (epoque.moderne) throw inconnue();
      return {};
    case "server/discover":
      return { supportedVersions: VERSIONS, capabilities: capacites(epoque.moderne), instructions: INSTRUCTIONS };
    case "tools/list":
      // Toujours le même ordre : un client garde la liste, et le modèle
      // retrouve le même début de contexte d'une conversation à l'autre.
      return { tools: outils() };
    case "tools/call":
      return appelOutil(p, ctx);
    case "resources/list":
      return { resources: [RESSOURCE_VUE] };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read":
      // Introuvable : -32002 jusqu'en 2025-11-25, -32602 ensuite.
      if (p.uri !== URI_VUE) throw new ErreurMcp(epoque.moderne ? -32602 : -32002, `Ressource introuvable : ${p.uri}`);
      return { contents: [{ uri: URI_VUE, mimeType: TYPE_VUE, text: HTML_VUE, _meta: META_VUE }] };
    case "prompts/list":
      return { prompts: INVITES };
    case "prompts/get":
      if (typeof p.name !== "string" || !INVITES.some((i) => i.name === p.name)) throw new ErreurMcp(-32602, `Prompt inconnu : ${p.name}`);
      try {
        return texteInvite(p.name, p.arguments || {});
      } catch (e) {
        throw new ErreurMcp(-32602, e.message);
      }
    default:
      throw inconnue();
  }
}

/** Le résultat moderne : son type, l'identité du serveur, et la durée de garde. */
function envelopper(resultat, methode, epoque) {
  if (!epoque.moderne) return resultat;
  return {
    resultType: "complete",
    ...resultat,
    ...(EN_CACHE.has(methode) ? CACHE : {}),
    _meta: { ...(resultat._meta || {}), [CLE_SERVEUR]: SERVEUR },
  };
}

/** Un message → { statut, corps } (corps null : 202, rien à répondre). */
async function repondreUn(msg, ctx) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0") {
    return { statut: 400, corps: reponseErreur(null, -32600, "Requête JSON-RPC invalide.") };
  }
  if (typeof msg.method !== "string") {
    // Une réponse du client (ce serveur ne lui demande pourtant jamais
    // rien) : reçue, sans suite.
    if (msg.id !== undefined && ("result" in msg || "error" in msg)) return { statut: 202, corps: null };
    return { statut: 400, corps: reponseErreur(idValide(msg.id) ? msg.id : null, -32600, "Requête JSON-RPC invalide : il manque la méthode.") };
  }
  // Une notification n'attend pas de réponse et ne déclenche rien : aucune
  // n'a de sens ici (notifications/initialized…). Surtout pas un
  // tools/call sans identifiant, qui écrivait dans la bibliothèque.
  if (!("id" in msg)) return { statut: 202, corps: null };
  if (!idValide(msg.id)) return { statut: 400, corps: reponseErreur(null, -32600, "Identifiant de requête invalide : une chaîne ou un nombre.") };
  if (msg.params !== undefined && (msg.params === null || typeof msg.params !== "object" || Array.isArray(msg.params))) {
    return { statut: 400, corps: reponseErreur(msg.id, -32602, "Les paramètres forment un objet.") };
  }
  try {
    const epoque = lireEpoque(msg, ctx.entetes || null);
    const resultat = await executer(msg, epoque, ctx);
    return { statut: 200, corps: { jsonrpc: "2.0", id: msg.id, result: envelopper(resultat, msg.method, epoque) } };
  } catch (e) {
    if (e instanceof ErreurMcp) return { statut: e.statut, corps: reponseErreur(msg.id, e.code, e.message, e.data) };
    return { statut: 500, corps: reponseErreur(msg.id, -32603, `Erreur interne : ${(e && e.message) || e}`) };
  }
}

/**
 * Un message (ou un lot, en 2025-03-26) → { statut, corps }. Le contexte :
 * { entetes (Headers, ou null hors HTTP), cloud, bibliotheque }, chacun
 * objet ou fonction qui le crée.
 */
export async function repondreMcp(message, ctx = {}) {
  if (Array.isArray(message)) {
    if (!message.length) return { statut: 400, corps: reponseErreur(null, -32600, "Lot vide.") };
    if (message.some((m) => m && m.params && m.params._meta && m.params._meta[CLE_VERSION] === VERSION_MODERNE)) {
      return { statut: 400, corps: reponseErreur(null, -32600, `Pas de lot en ${VERSION_MODERNE} : une requête par appel.`) };
    }
    // L'un après l'autre : deux écritures d'un même lot gardent leur ordre.
    const corps = [];
    for (const m of message) {
      const r = await repondreUn(m, ctx);
      if (r.corps) corps.push(r.corps);
    }
    return corps.length ? { statut: 200, corps } : { statut: 202, corps: null };
  }
  return repondreUn(message, ctx);
}

/**
 * Un message ou un lot de messages JSON-RPC → la réponse (null s'il n'y a
 * rien à répondre), sans HTTP. `bibliotheque` est facultative (tests du
 * protocole), `contexte` aussi (en-têtes…).
 */
export async function traiter(message, cloud, bibliotheque = null, contexte = {}) {
  return (await repondreMcp(message, { ...contexte, cloud, bibliotheque })).corps;
}
