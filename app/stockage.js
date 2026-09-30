/**
 * OÙ VIVENT TES PARTITIONS
 *
 * Publiée sur claude.ai, l'appli range tout dans la base de sa page : tes
 * partitions te suivent sur chaque appareil où tu ouvres le lien. Ouverte
 * ailleurs (fichier local, autre hébergement), elle se replie sur le
 * stockage de ce navigateur ; le reste de l'appli ne voit pas la différence.
 *
 * Une partition = un document `partitions/<id>` (titre, ABC, doutes…) ;
 * ses traits, page par page, dans `partitions/<id>/pages/<n>` : une page
 * dense pèse ~60 Ko, on ne les charge qu'à l'ouverture de l'atelier.
 */

const CLE_LOCALE = "portee:partitions";

/** Traits → entiers au demi-pixel près : deux fois plus léger, aucune perte utile. */
export function compacter(traits) {
  return traits.map((t) => t.flatMap(([x, y]) => [Math.round(x * 2), Math.round(y * 2)]));
}
export function decompacter(compacts) {
  return compacts.map((t) => {
    const pts = [];
    for (let i = 0; i < t.length; i += 2) pts.push([t[i] / 2, t[i + 1] / 2]);
    return pts;
  });
}

export function nouvelId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function ouvrirStockage() {
  const claude = window.claude;
  const use = claude && typeof claude.use === "function" ? (n) => claude.use(n).catch(() => null) : async () => null;
  const [db, downloads] = await Promise.all([use("db"), use("downloads")]);
  return db ? stockageClaude(db, downloads) : stockageLocal();
}

function stockageClaude(db, downloads) {
  const col = db.collection("partitions");
  return {
    mode: "claude",
    ecouter(rappel, erreur) {
      return col.orderBy("modifieLe", "desc").onSnapshot(
        (snap) => rappel(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => erreur && erreur(e),
      );
    },
    async lire(id) {
      const d = await col.doc(id).get();
      return d.exists ? { id, ...d.data() } : null;
    },
    async pages(id, nb) {
      const sortie = [];
      for (let n = 1; n <= nb; n++) {
        const d = await db.doc(`partitions/${id}/pages/${n}`).get();
        sortie.push(d.exists ? decompacter(d.data().traits) : []);
      }
      return sortie;
    },
    async creer(id, donnees, pages) {
      // Les pages d'abord : une partition visible a toujours ses traits.
      for (let n = 0; n < pages.length; n++) {
        await db.doc(`partitions/${id}/pages/${n + 1}`).set({ traits: compacter(pages[n]) });
      }
      await col.doc(id).set(donnees);
    },
    async modifier(id, patch) {
      await col.doc(id).update(patch);
    },
    async supprimer(id, nb) {
      await col.doc(id).delete();
      for (let n = 1; n <= nb; n++) await db.doc(`partitions/${id}/pages/${n}`).delete();
    },
    async enregistrerFichier(nom, donnees) {
      if (!downloads) return telechargerNavigateur(nom, donnees);
      return downloads.save({ filename: nom, data: donnees });
    },
  };
}

function stockageLocal() {
  const abonnes = new Set();
  const lireTout = () => {
    try { return JSON.parse(localStorage.getItem(CLE_LOCALE) || "{}"); } catch { return {}; }
  };
  const ecrireTout = (tout) => {
    try { localStorage.setItem(CLE_LOCALE, JSON.stringify(tout)); }
    catch { throw new Error("Le stockage de ce navigateur est plein : supprime une partition ou ouvre l'appli sur claude.ai."); }
    const liste = Object.entries(tout).map(([id, d]) => ({ id, ...d })).sort((a, b) => (b.modifieLe || "").localeCompare(a.modifieLe || ""));
    abonnes.forEach((f) => f(liste));
  };
  return {
    mode: "local",
    ecouter(rappel) {
      abonnes.add(rappel);
      const tout = lireTout();
      rappel(Object.entries(tout).map(([id, d]) => ({ id, ...d })).sort((a, b) => (b.modifieLe || "").localeCompare(a.modifieLe || "")));
      return () => abonnes.delete(rappel);
    },
    async lire(id) {
      const d = lireTout()[id];
      return d ? { id, ...d } : null;
    },
    async pages(id) {
      try { return JSON.parse(localStorage.getItem(`portee:pages:${id}`) || "[]").map(decompacter); } catch { return []; }
    },
    async creer(id, donnees, pages) {
      try { localStorage.setItem(`portee:pages:${id}`, JSON.stringify(pages.map(compacter))); } catch { /* sans traits, la partition reste lisible */ }
      const tout = lireTout(); tout[id] = donnees; ecrireTout(tout);
    },
    async modifier(id, patch) {
      const tout = lireTout(); if (!tout[id]) return;
      tout[id] = { ...tout[id], ...patch }; ecrireTout(tout);
    },
    async supprimer(id) {
      const tout = lireTout(); delete tout[id]; ecrireTout(tout);
      try { localStorage.removeItem(`portee:pages:${id}`); } catch { /* rien à faire */ }
    },
    async enregistrerFichier(nom, donnees) {
      return telechargerNavigateur(nom, donnees);
    },
  };
}

function telechargerNavigateur(nom, donnees) {
  const blob = donnees instanceof Blob ? donnees : new Blob([donnees]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nom; a.hidden = true;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return Promise.resolve({ status: "saved" });
}
