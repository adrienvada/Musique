/**
 * LE CONNECTEUR, CÔTÉ PROTOCOLE (MCP, transport HTTP « streamable »)
 *
 * claude.ai parle aux connecteurs en JSON-RPC : `initialize`, puis
 * `tools/list` et `tools/call`. On répond en JSON simple, sans session ni
 * flux. Deux outils lisent la tablette (arborescence, document) ; le
 * troisième (relier) ne sert qu'une fois, pour lui présenter Portée. Trois
 * autres tiennent la bibliothèque synchronisée entre les appareils
 * d'Adrien (bibliotheque.js).
 *
 * Les traits voyagent en entiers au demi-pixel (comme dans la base de
 * l'appli) : une page dense tient ainsi dans une soixantaine de kilo-octets.
 */
import { NonReliee } from "./remarkable.js";

const OUTILS = [
  {
    name: "arborescence",
    title: "Arborescence de la reMarkable",
    description: "Liste les dossiers et documents de la reMarkable d'Adrien (sans la corbeille). Renvoie { connectee: true, noeuds } ; chaque nœud : id, nom, type (dossier|document), parent (id du dossier, vide à la racine), modifie, pdf, pages. Si la tablette n'est pas reliée : { connectee: false, raison: jamais|revoquee }.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "document",
    title: "Traits d'un document",
    description: "Télécharge un document de la reMarkable et renvoie son nom, le modèle Portée sur lequel il a été écrit, et les traits de chaque page écrite (entiers au demi-pixel, x et y alternés, repère de l'écran 1404×1872).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Identifiant du document, tel que donné par l'arborescence." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
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
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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

async function arborescence(cloud) {
  try {
    return { connectee: true, noeuds: await cloud.arborescence() };
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
    const d = await cloud.document(args.id);
    return { ...d, pages: d.pages.map((p) => ({ numero: p.numero, traits: compacter(p.traits) })) };
  }
  throw new Error(`Outil inconnu : ${nom}`);
}

// Le texte d'un résultat répète la version structurée, sauf quand elle est
// lourde (des traits) : on ne la ferait voyager que deux fois.
function texteDe(resultat) {
  const json = JSON.stringify(resultat);
  return json.length <= 20000 ? json : `Résultat structuré de ${Math.round(json.length / 1024)} Ko (voir structuredContent).`;
}

async function repondre(msg, cloud, bibliotheque) {
  const { id, method, params } = msg || {};
  const estNotification = id === undefined || id === null;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const erreur = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "portee-remarkable", version: "1.0.0" },
        instructions: "La reMarkable d'Adrien pour l'appli Portée : arborescence, puis document. relier ne sert qu'à relier la tablette, avec un code de my.remarkable.com. Les outils bibliotheque_* tiennent la bibliothèque de partitions synchronisée entre ses appareils.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: OUTILS });
    case "tools/call": {
      try {
        const resultat = await appeler((params && params.name) || "", params && params.arguments, cloud, bibliotheque);
        return ok({ content: [{ type: "text", text: texteDe(resultat) }], structuredContent: resultat });
      } catch (e) {
        return ok({ content: [{ type: "text", text: e.message || String(e) }], isError: true });
      }
    }
    default:
      if (estNotification) return null; // notifications/initialized et consorts
      return erreur(-32601, `Méthode inconnue : ${method}`);
  }
}

/**
 * Un message ou un lot de messages JSON-RPC → la réponse (null s'il n'y a
 * rien à répondre). `bibliotheque` est facultative (tests du protocole).
 */
export async function traiter(message, cloud, bibliotheque = null) {
  if (Array.isArray(message)) {
    const reponses = (await Promise.all(message.map((m) => repondre(m, cloud, bibliotheque)))).filter(Boolean);
    return reponses.length ? reponses : null;
  }
  return repondre(message, cloud, bibliotheque);
}
