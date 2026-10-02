/**
 * L'ÉDITEUR D'IDÉE : LE JEU EN DIRECT
 *
 * Le bouton rouge du transport (#idee-enregistrer, ou R au clavier) : une
 * mesure de décompte (#idee-decompte, en grand sur la grille), le
 * métronome, et l'on joue ; chaque touche enfoncée (clavier à l'écran, de
 * l'ordinateur ou MIDI) est notée à l'instant près, puis recalée sur la
 * grille choisie dans la feuille Tempo (#idee-recalage) quand on arrête.
 * L'enregistrement part du début de la mesure du curseur ; les notes
 * jouées arrivent choisies, et « Annuler » les retire d'un coup.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, curseur, selection, recalage,
 *   mode, et e.enregistrement, que ce module seul écrit), $, sq, transport,
 *   toast, modifier(f), rafraichir(), source() (ce que joue le transport),
 *   suivreLecture(pas), avantSon(), apresSon() (le micro se tait puis
 *   reprend), choisirMode(mode).
 * Rend : { basculer(), arreter(), enfoncer(h, v) → true si la note est
 *   prise, relever(h), suivre(pas), maj(), enCours }.
 */
export function creerDirect(ctx) {
  const { e, $, sq, transport, toast } = ctx;

  async function demarrer() {
    if (e.enregistrement) return;
    transport.arreter();
    // On joue au clavier : celui de l'écran doit être là.
    if (e.mode !== "clavier") ctx.choisirMode("clavier");
    ctx.avantSon();
    const mesure = sq.pasParMesure(e.seq);
    const depuis = Math.floor(Math.min(e.curseur, sq.finSequence(e.seq)) / mesure) * mesure;
    e.selection.clear();
    e.enregistrement = { depuis, notes: [], ouvertes: new Map() };
    $("idee-enregistrer").setAttribute("aria-pressed", "true");
    $("idee-enregistrer").setAttribute("aria-label", "Arrêter le jeu en direct");
    $("idee-mode").textContent = "Jeu en direct : joue après le décompte";
    ctx.rafraichir();
    try {
      await transport.jouer(ctx.source, {
        depuis, decompte: 1, metronome: true, sansFin: true,
        surPosition: ctx.suivreLecture,
        surFin: () => { if (e.enregistrement) arreter(); },
      });
    } catch (err) {
      e.enregistrement = null;
      majBouton();
      ctx.apresSon();
      toast(err.message || "Le piano n'a pas pu se charger.");
    }
  }

  function majBouton() {
    $("idee-enregistrer").setAttribute("aria-pressed", String(!!e.enregistrement));
    $("idee-enregistrer").setAttribute("aria-label", e.enregistrement ? "Arrêter le jeu en direct" : "Jouer en direct (avec décompte)");
  }

  /** Arrête et écrit ce qui a été joué, recalé. */
  function arreter() {
    const r = e.enregistrement;
    if (!r) return;
    const fin = transport.position();
    for (const [h, o] of r.ouvertes) r.notes.push({ h, debut: o.debut, fin, v: o.v });
    e.enregistrement = null;
    transport.arreter();
    majBouton();
    $("idee-decompte").hidden = true;
    $("idee-mode").textContent = "";
    ctx.suivreLecture(null);
    ctx.apresSon();
    const notes = sq.quantifier(r.notes.map((n) => ({ ...n, debut: n.debut - r.depuis, fin: n.fin - r.depuis })), { grille: e.recalage, origine: r.depuis });
    if (!notes.length) { ctx.rafraichir(); return; }
    ctx.modifier(() => {
      const ids = notes.map((n) => sq.poser(e.seq, e.piste, n));
      e.selection = new Set(ids);
      e.curseur = Math.max(...notes.map((n) => n.d + n.l));
    });
    toast(`${notes.length} note${notes.length > 1 ? "s" : ""} enregistrée${notes.length > 1 ? "s" : ""}. Touche « Annuler » pour recommencer.`);
  }

  $("idee-enregistrer").addEventListener("click", () => (e.enregistrement ? arreter() : demarrer()));
  $("idee-recalage").addEventListener("change", () => { e.recalage = Number($("idee-recalage").value); });

  return {
    basculer: () => (e.enregistrement ? arreter() : demarrer()),
    arreter,
    /** Une touche s'enfonce : pendant l'enregistrement, on note l'instant. */
    enfoncer(h, v) {
      if (!e.enregistrement) return false;
      e.enregistrement.ouvertes.set(h, { debut: transport.position(), v });
      return true;
    },
    relever(h) {
      const r = e.enregistrement;
      const o = r && r.ouvertes.get(h);
      if (!o) return;
      r.notes.push({ h, debut: o.debut, fin: transport.position(), v: o.v });
      r.ouvertes.delete(h);
    },
    /** À chaque image de la lecture : le décompte, tant qu'on n'a pas commencé. */
    suivre(pas) {
      const r = e.enregistrement;
      if (!r) return;
      const avant = pas !== null && pas < r.depuis;
      const decompte = avant ? Math.ceil((r.depuis - pas) / sq.pasParTemps(e.seq)) : 0;
      $("idee-decompte").hidden = !avant;
      $("idee-decompte").textContent = decompte > 0 ? decompte : "";
    },
    maj() { $("idee-recalage").value = String(e.recalage); },
    get enCours() { return !!e.enregistrement; },
  };
}
