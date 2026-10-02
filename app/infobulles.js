/**
 * LES INFOBULLES : CE QUE FAIT UNE ICÔNE, D'UN APPUI LONG
 *
 * Au doigt, une icône ne dit pas ce qu'elle fait, et il n'y a pas de survol
 * pour faire apparaître son titre comme à la souris. Laisser le doigt une
 * demi-seconde sur un bouton à icône montre sa description dans une bulle,
 * au-dessus du doigt (dessous s'il n'y a pas la place). En levant le doigt,
 * le bouton ne se déclenche pas : on voulait savoir, pas faire. Glisser
 * avant la demi-seconde (pour faire défiler) annule tout.
 *
 * La description est celle que lit un lecteur d'écran : le titre ou
 * l'aria-label, le plus long des deux (le titre en dit souvent plus :
 * « Envoyer le MIDI (AirDrop, Fichiers, mail…) ou le télécharger »), sans
 * les raccourcis clavier, qui ne servent à rien au doigt ; à défaut, le
 * texte du bouton. Un élément qui a déjà son propre appui long (le bouton
 * rouge, le clavier qui tient la note) porte `data-sans-infobulle`.
 *
 * À la souris, rien ne change : le navigateur montre déjà le titre au survol.
 * Les deux fonctions de calcul sont sans dépendance (testées sous Node).
 */

const DELAI = 500; // ms : le temps de l'appui long (celui d'Android)
const BOUGE = 10; // px : au-delà, le doigt fait défiler, ce n'est plus un appui
const RESTE = 1500; // ms : la bulle reste ce temps une fois le doigt levé, pour finir de la lire
const INTERACTIFS = "button, a[href], [role='button'], [role='tab'], [role='menuitem'], [role='switch']";
const borne = (x, a, b) => Math.max(a, Math.min(b, x));

// Un raccourci clavier entre parenthèses : « (R) », « (Ctrl+Z) », « (Maj + ↑) »,
// « (Retour arrière) ». Pas « (piano roll) » ni « (AirDrop, Fichiers, mail…) ».
const TOUCHE = "(?:Ctrl|Maj|Alt|Cmd|⌘|Espace|Échap|Entrée|Retour arrière|Suppr|Tab|[A-Z0-9.]|[←→↑↓])";
const RACCOURCI = new RegExp(`\\s*\\(${TOUCHE}(?:\\s*\\+\\s*${TOUCHE})*\\)`, "gu");

/** Ce que dit la bulle : le titre ou l'aria-label (le plus long), sans raccourci clavier ; sinon le texte. */
export function texteInfobulle(titre, etiquette, texte = "") {
  const propre = (t) => (t || "").replace(RACCOURCI, "").replace(/\s+/g, " ").trim();
  const a = propre(titre), b = propre(etiquette);
  return (a.length >= b.length ? a : b) || propre(texte);
}

/**
 * Où poser la bulle (coordonnées de la fenêtre) : centrée au-dessus de la
 * cible, sans sortir de l'écran ; dessous si elle n'a pas la place au-dessus
 * (une icône de la barre du haut). `fleche` : l'abscisse de la pointe dans la
 * bulle, qui reste sous le milieu de la cible quand la bulle est poussée.
 * `fenetre.haut` : ce que cache le haut de l'écran (l'encoche), en px.
 */
export function placerInfobulle({ cible, largeur, hauteur, fenetre, marge = 8, ecart = 10 }) {
  const milieu = (cible.left + cible.right) / 2;
  const left = borne(milieu - largeur / 2, marge, fenetre.largeur - largeur - marge);
  let top = cible.top - ecart - hauteur;
  const dessous = top < (fenetre.haut || 0) + marge;
  if (dessous) top = Math.min(cible.bottom + ecart, fenetre.hauteur - hauteur - marge);
  return { left, top, dessous, fleche: borne(milieu - left, 12, largeur - 12) };
}

/** Branche les infobulles sur toute la page (une fois). */
export function installerInfobulles(doc = document) {
  const fen = doc.defaultView;
  const bulle = doc.createElement("div");
  bulle.className = "infobulle";
  bulle.setAttribute("role", "tooltip");
  // En « popover », la bulle passe au-dessus d'une feuille du bas ouverte, comme les messages.
  bulle.setAttribute("popover", "manual");
  bulle.hidden = true;
  doc.body.append(bulle);
  // Ce que cache l'encoche en haut de l'écran : la bulle ne s'y glisse pas.
  const sonde = doc.createElement("div");
  sonde.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-top,0px)";
  doc.body.append(sonde);

  let appui = null; // { el, x, y, id, minuterie } : un doigt posé sur une icône
  let montree = null; // l'élément dont la bulle est affichée
  let avaler = null; // { el, jusqua } : le clic qui suit le doigt levé ne déclenche pas le bouton
  let minuterieCacher = null;

  const cible = (t) => {
    const el = t && t.closest ? t.closest(INTERACTIFS) : null;
    if (!el || el.closest("[data-sans-infobulle]") || !el.querySelector(".ico")) return null;
    return el;
  };

  function montrer(el) {
    if (!el.isConnected) return;
    const texte = texteInfobulle(el.getAttribute("title"), el.getAttribute("aria-label"), el.textContent);
    if (!texte) return;
    bulle.textContent = texte;
    bulle.hidden = false;
    if (bulle.showPopover) { try { if (bulle.matches(":popover-open")) bulle.hidePopover(); bulle.showPopover(); } catch { /* sans popover */ } }
    const b = bulle.getBoundingClientRect();
    const p = placerInfobulle({
      cible: el.getBoundingClientRect(), largeur: b.width, hauteur: b.height,
      fenetre: { largeur: fen.innerWidth, hauteur: fen.innerHeight, haut: sonde.offsetHeight },
    });
    bulle.style.left = `${Math.round(p.left)}px`;
    bulle.style.top = `${Math.round(p.top)}px`;
    bulle.style.setProperty("--fleche", `${Math.round(p.fleche)}px`);
    bulle.classList.toggle("dessous", p.dessous);
    montree = el;
    // Un petit coup sous le doigt, là où le téléphone sait le faire (Android).
    try { fen.navigator.vibrate?.(8); } catch { /* facultatif */ }
  }

  function cacher() {
    clearTimeout(minuterieCacher);
    if (!montree) return;
    montree = null;
    bulle.hidden = true;
    if (bulle.hidePopover) { try { bulle.hidePopover(); } catch { /* déjà fermée */ } }
  }

  function lacher() {
    if (appui) clearTimeout(appui.minuterie);
    appui = null;
  }

  // En capture, sur tout le document : rien à brancher bouton par bouton, et
  // le clic avalé n'atteint pas le bouton.
  doc.addEventListener("pointerdown", (e) => {
    cacher();
    lacher();
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    const el = cible(e.target);
    if (!el) return;
    appui = { el, x: e.clientX, y: e.clientY, id: e.pointerId, minuterie: setTimeout(() => montrer(el), DELAI) };
  }, true);
  doc.addEventListener("pointermove", (e) => {
    if (!appui || e.pointerId !== appui.id) return;
    if (Math.hypot(e.clientX - appui.x, e.clientY - appui.y) > BOUGE) { lacher(); cacher(); }
  }, true);
  doc.addEventListener("pointerup", (e) => {
    if (!appui || e.pointerId !== appui.id) return;
    const { el } = appui;
    lacher();
    if (montree !== el) return;
    avaler = { el, jusqua: performance.now() + 700 };
    minuterieCacher = setTimeout(cacher, RESTE);
  }, true);
  doc.addEventListener("pointercancel", (e) => {
    if (!appui || e.pointerId !== appui.id) return;
    // Le navigateur a pris la main (le défilement) : sans bulle encore, on oublie l'appui.
    const montreeIci = montree === appui.el;
    lacher();
    if (montreeIci) minuterieCacher = setTimeout(cacher, RESTE);
  }, true);
  doc.addEventListener("click", (e) => {
    if (!avaler) return;
    const { el, jusqua } = avaler;
    avaler = null;
    if (performance.now() > jusqua || !el.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  // Pas de menu du navigateur (ni de loupe) sous le doigt qui lit une bulle.
  doc.addEventListener("contextmenu", (e) => { if (appui || montree) e.preventDefault(); }, true);
  doc.addEventListener("scroll", () => { if (!appui) cacher(); }, true);
}
