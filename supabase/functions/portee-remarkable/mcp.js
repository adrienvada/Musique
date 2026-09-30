/**
 * LE CONNECTEUR, CÔTÉ PROTOCOLE (MCP, transport HTTP « streamable »)
 *
 * claude.ai parle aux connecteurs en JSON-RPC : `initialize`, puis
 * `tools/list` et `tools/call`. On répond en JSON simple, sans session ni
 * flux. Deux outils lisent la tablette (arborescence, document) ; le
 * troisième (relier) ne sert qu'une fois, pour lui présenter Portée.
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

async function appeler(nom, args, cloud) {
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

async function repondre(msg, cloud) {
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
        instructions: "La reMarkable d'Adrien pour l'appli Portée : arborescence, puis document. relier ne sert qu'à relier la tablette, avec un code de my.remarkable.com.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: OUTILS });
    case "tools/call": {
      try {
        const resultat = await appeler(params && params.name, params && params.arguments, cloud);
        return ok({ content: [{ type: "text", text: JSON.stringify(resultat) }], structuredContent: resultat });
      } catch (e) {
        return ok({ content: [{ type: "text", text: e.message || String(e) }], isError: true });
      }
    }
    default:
      if (estNotification) return null; // notifications/initialized et consorts
      return erreur(-32601, `Méthode inconnue : ${method}`);
  }
}

/** Un message ou un lot de messages JSON-RPC → la réponse (null s'il n'y a rien à répondre). */
export async function traiter(message, cloud) {
  if (Array.isArray(message)) {
    const reponses = (await Promise.all(message.map((m) => repondre(m, cloud)))).filter(Boolean);
    return reponses.length ? reponses : null;
  }
  return repondre(message, cloud);
}
