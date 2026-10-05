/**
 * UN FAUX CLAUDE DANS LA PAGE (`sample`), POUR LA VERSION CLAUDE.AI SIMULÉE
 *
 * La page publiée sur claude.ai peut interroger Claude
 * (`claude.use("sample")`, sample.d.ts) et ouvrir ses autorisations
 * (`claude.use("permissions")`, permissions.d.ts). On les imite par-dessus le
 * faux claude.ai de faux-claude.mjs (la base, les téléchargements, les
 * connecteurs), quel que soit l'ordre des scripts d'initialisation, que
 * Playwright ne garantit pas. C'est l'essai qui joue Claude, et rien ne
 * quitte la machine :
 *  - `sample.json(input, opts)` demande à l'essai quoi répondre
 *    (`repondre({ input, opts, n })`, côté Node) : `{ json }` pour une
 *    réponse ; `{ erreur: { code, message } }` pour un échec ; `{ attendre:
 *    true }` pour un Claude qui réfléchit jusqu'à ce qu'on l'arrête ; et
 *    `{ outils: [{ name, input }], json }` pour les outils de la page qu'il
 *    appelle avant de répondre. Comme le vrai, il appelle `onText` avant de
 *    répondre, rejette un objet `{ code, message }` (pas une Error), et
 *    `{ code: "cancelled" }` quand le signal s'arrête ;
 *  - `sample.limits()` : `{ maxPromptBytes, tools }` (`outils: false` : une
 *    vue sans outils de page) ;
 *  - `permissions` : `state(nom)` (« denied » tant que le panneau n'a pas été
 *    ouvert, puis `etatApres`) et `manage()`, qui notent ce qu'on leur
 *    demande (`permissions: false` : pas de panneau).
 * Ce que la page a envoyé (`appels` : le texte, le modèle, le cache, les
 * outils offerts, et ce que chaque outil a rendu) reste côté Node, pour les
 * vérifications.
 */

/**
 * @param ctx  le contexte Playwright (avant d'ouvrir la page)
 * @param {{ repondre: (demande: { input: string, opts: object, n: number }) => object | Promise<object>, outils?: boolean, permissions?: boolean, etatApres?: string }} options
 */
export async function installerFauxSample(ctx, { repondre, outils = true, permissions = true, etatApres = "granted" }) {
  const appels = [];
  const autorisations = { manage: 0, state: [] };
  await ctx.exposeBinding("__fauxSample", async (_source, operation, ...args) => {
    switch (operation) {
      case "demande": {
        const [input, opts] = args;
        appels.push({ input, opts, outils: [] });
        return (await repondre({ input, opts, n: appels.length })) ?? { erreur: { code: "upstream_error", message: "no scripted answer" } };
      }
      case "outil": appels.at(-1).outils.push(args[0]); return true;
      case "manage": autorisations.manage++; return true;
      case "state": autorisations.state.push(args[0]); return autorisations.manage ? etatApres : "denied";
      default: throw new Error(`opération inconnue : ${operation}`);
    }
  });
  await ctx.addInitScript(({ outils, permissions }) => {
    const appel = (...a) => window.__fauxSample(...a);
    const arrete = () => ({ code: "cancelled", message: "The call was cancelled." });
    // Comme le vrai : une seule promesse, rejetée par un objet { code, message } (sample.d.ts).
    async function json(input, opts = {}) {
      const { signal, onText, tools = [] } = opts;
      if (signal && signal.aborted) return Promise.reject(arrete());
      const script = await appel("demande", input, { modelTier: opts.modelTier, cache: opts.cache, outils: tools.map((t) => t.name) });
      if (signal && signal.aborted) return Promise.reject(arrete());
      if (script.attendre) await new Promise((_ok, ko) => signal.addEventListener("abort", () => ko(arrete()), { once: true }));
      if (script.erreur) return Promise.reject({ ...script.erreur });
      for (const { name, input: entree } of script.outils || []) {
        const outil = tools.find((t) => t.name === name);
        let rendu;
        try { rendu = await outil.execute(entree, { signal: signal || new AbortController().signal }); } catch (e) { rendu = `Error: ${e.message}`; }
        await appel("outil", { name, rendu });
      }
      const texte = JSON.stringify(script.json);
      if (onText) onText({ text: texte, delta: texte });
      return JSON.parse(texte);
    }
    const sample = Object.assign(
      (input, opts) => json(input, opts).then((x) => ({ text: JSON.stringify(x), truncated: false, modelTierApplied: (opts && opts.modelTier) || "default" })),
      { json, limits: async () => ({ maxPromptBytes: 262144, ...(outils ? { tools: { maxCount: 16 } } : {}) }) },
    );
    const panneau = permissions ? { state: (nom) => appel("state", nom), request: async () => ({}), manage: () => appel("manage").then(() => undefined) } : null;
    // Par-dessus le faux claude.ai, qu'il soit posé avant ou après ce script.
    let base = window.claude;
    const claude = { use: (nom) => (nom === "sample" ? Promise.resolve(sample) : nom === "permissions" ? Promise.resolve(panneau) : base ? base.use(nom) : Promise.resolve(null)) };
    Object.defineProperty(window, "claude", { configurable: true, get: () => claude, set: (v) => { base = v; } });
  }, { outils, permissions });
  return { appels, autorisations };
}
