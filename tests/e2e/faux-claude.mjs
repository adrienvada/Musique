/**
 * UN FAUX CLAUDE.AI, POUR LA VERSION CLAUDE.AI DE PORTÉE
 *
 * La page publiée sur claude.ai reçoit `window.claude.use(nom)` : « db » (la
 * base de l'artefact), « downloads » (les téléchargements) et « mcp » (les
 * connecteurs de claude.ai, dont « Portée reMarkable »). On les imite avec
 * ce que l'appli en emploie (app/stockage.js, app/app.js) :
 *  - db : collection("partitions").orderBy().onSnapshot(), doc(chemin).get,
 *    set, update, delete ; les données vivent côté Node, comme sur
 *    claude.ai elles vivent hors de la page (elles survivent au
 *    rechargement) ;
 *  - downloads : save({ filename, data }) ; on garde le fichier ;
 *  - mcp : callTool(serveur, outil, args) ; l'appel passe par `traiter()`,
 *    le vrai connecteur, branché sur le faux cloud des tests.
 */

/**
 * @param ctx  le contexte Playwright (avant d'ouvrir la page)
 * @param appelerOutil (serveur, outil, args) => { payload } | { erreur: { code, message } }
 * @returns {{ base: Map<string, object>, telechargements: { nom: string, octets: Buffer }[] }}
 */
export async function installerFauxClaude(ctx, { appelerOutil }) {
  const base = new Map();
  const telechargements = [];
  await ctx.exposeBinding("__fauxClaude", async (_source, operation, ...args) => {
    switch (operation) {
      case "lire": return base.has(args[0]) ? base.get(args[0]) : null;
      case "ecrire": base.set(args[0], args[1]); return true;
      case "completer": {
        if (!base.has(args[0])) throw new Error(`${args[0]} : document introuvable`);
        base.set(args[0], { ...base.get(args[0]), ...args[1] });
        return true;
      }
      case "effacer": base.delete(args[0]); return true;
      case "lister": {
        const prefixe = `${args[0]}/`;
        return [...base].filter(([k]) => k.startsWith(prefixe) && !k.slice(prefixe.length).includes("/")).map(([k, v]) => ({ id: k.slice(prefixe.length), donnees: v }));
      }
      case "telecharger": telechargements.push({ nom: args[0], octets: Buffer.from(args[1], "base64") }); return { status: "saved" };
      case "outil": return appelerOutil(...args);
      default: throw new Error(`opération inconnue : ${operation}`);
    }
  });
  await ctx.addInitScript(() => {
    const appel = (...a) => window.__fauxClaude(...a);
    const abonnes = new Set();
    const prevenir = async () => {
      const docs = (await appel("lister", "partitions"))
        .sort((a, b) => String(b.donnees.modifieLe || "").localeCompare(String(a.donnees.modifieLe || "")))
        .map(({ id, donnees }) => ({ id, data: () => donnees }));
      for (const rappel of abonnes) rappel({ docs });
    };
    const doc = (chemin) => ({
      get: async () => { const d = await appel("lire", chemin); return { exists: d !== null, data: () => d }; },
      set: async (d) => { await appel("ecrire", chemin, d); await prevenir(); },
      update: async (patch) => { await appel("completer", chemin, patch); await prevenir(); },
      delete: async () => { await appel("effacer", chemin); await prevenir(); },
    });
    const db = {
      doc,
      collection: (nom) => ({
        doc: (id) => doc(`${nom}/${id}`),
        orderBy: () => ({
          onSnapshot(rappel, erreur) {
            abonnes.add(rappel);
            prevenir().catch((e) => erreur && erreur(e));
            return () => abonnes.delete(rappel);
          },
        }),
      }),
    };
    const enBase64 = async (blob) => {
      const octets = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const downloads = {
      save: async ({ filename, data }) => appel("telecharger", filename, await enBase64(data instanceof Blob ? data : new Blob([data]))),
    };
    const mcp = {
      async callTool(serveur, outil, args) {
        const r = await appel("outil", serveur, outil, args);
        if (r.erreur) throw r.erreur;
        return { payload: r.payload };
      },
    };
    const capacites = { db, downloads, mcp };
    window.claude = {
      use: async (nom) => {
        if (!capacites[nom]) throw Object.assign(new Error(nom), { code: "not_in_manifest" });
        return capacites[nom];
      },
    };
  });
  return { base, telechargements };
}

/** Lit un .zip sans compression (celui de app/zip.js) : { nom: octets }. */
export function lireZip(octets) {
  const fichiers = {};
  let i = 0;
  while (octets.readUInt32LE(i) === 0x04034b50) {
    const taille = octets.readUInt32LE(i + 18);
    const longueurNom = octets.readUInt16LE(i + 26);
    const extra = octets.readUInt16LE(i + 28);
    const nom = octets.subarray(i + 30, i + 30 + longueurNom).toString("utf8");
    const debut = i + 30 + longueurNom + extra;
    fichiers[nom] = octets.subarray(debut, debut + taille);
    i = debut + taille;
  }
  return fichiers;
}
