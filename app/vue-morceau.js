/**
 * L'ÉCRAN MORCEAU
 *
 * Les blocs d'un morceau (morceau.js), vus d'abord de haut : une frise, un
 * segment par bloc, aussi long que son passage, de la couleur de son idée.
 * En dessous, une carte par bloc : compacte, sauf celle qu'on a choisie, qui
 * montre ses gestes (plus tôt, plus tard, une fois de plus, écouter, ouvrir
 * l'idée, retirer). On ajoute une partie depuis une feuille « Quelle idée ? »,
 * on règle le tempo, le MIDI, le MusicXML et la suppression depuis « ••• ».
 * Tout s'enregistre tout seul.
 *
 * Les cartes ne sont reconstruites que quand le morceau change : choisir une
 * carte ou lire un bloc ne touche qu'à des classes. Reconstruire sous le
 * doigt, c'est perdre le toucher qui allait suivre.
 */
import { assembler, sourceDuMorceau, sectionSuivante, structure, couleursDesIdees, dureeEnTexte, SECTIONS } from "./morceau.js";
import { nbMesures } from "./sequence.js";
import { dessinerApercu } from "./idee.js";
import { ico } from "./icones.js";
import { ouvrirFeuille, fermerFeuille } from "./feuilles.js";

const $ = (id) => document.getElementById(id);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/**
 * La vignette d'un morceau dans la bibliothèque : sa frise en miniature, les
 * couleurs de l'écran Morceau. Un trait fin sépare les passages d'un même
 * bloc répété, un trait plus large les blocs entre eux ; elle se lit aussi
 * bien à 56 × 46 qu'à 240 × 120 (le dessin s'étire, sans rien de fin).
 */
export function dessinerApercuMorceau(svg, morceau, idees) {
  const a = assembler(morceau, idees);
  svg.setAttribute("viewBox", "0 0 240 120");
  svg.setAttribute("preserveAspectRatio", "none");
  if (!a.fin) {
    svg.innerHTML = `<rect class="mini-vide" x="8" y="32" width="224" height="56" rx="6"/>`;
    return;
  }
  const couleurs = couleursDesIdees(morceau.blocs);
  const ideeDuBloc = new Map((morceau.blocs || []).map((b) => [b.id, b.idee]));
  const X = 8, L = 224;
  svg.innerHTML = a.passages.map((p, i) => {
    const suite = a.passages[i + 1];
    const trait = !suite ? 0 : suite.bloc === p.bloc ? 1.5 : 4;
    const x = X + (p.debut / a.fin) * L;
    const w = Math.max(2.5, ((p.fin - p.debut) / a.fin) * L - trait);
    return `<rect class="mini-seg section-${couleurs.get(ideeDuBloc.get(p.bloc)) || 1}" x="${x.toFixed(2)}" y="32" width="${w.toFixed(2)}" height="56" rx="4"/>`;
  }).join("");
}

export function creerVueMorceau(deps) {
  const { transport, toast } = deps;
  const m = { id: null, titre: "", blocs: [], tempo: null, creeLe: null, minuterie: null, sauvegarde: Promise.resolve(), choisi: null };
  let glisse = null;
  let lecture = null; // { cle: "tout" | id d'un bloc } tant que cet écran fait sonner le transport
  let joue = null;    // le bloc qui sonne

  const idees = () => new Map(deps.partitions().filter((p) => p.type === "idee").map((p) => [p.id, p]));
  const nouvelIdBloc = () => "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const lignes = () => [...$("morceau-blocs").children];
  const ligne = (id) => lignes().find((li) => li.dataset.id === id);
  const segment = (id) => [...$("morceau-frise").querySelectorAll(".frise-seg")].find((s) => s.dataset.id === id);
  const reduireMouvement = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  $("morceau-sections").innerHTML = SECTIONS.map((s) => `<option value="${s}">`).join("");

  function ouvrir(p) {
    m.id = p ? p.id : null;
    m.titre = p ? p.titre : "Nouveau morceau";
    m.blocs = p ? JSON.parse(JSON.stringify(p.blocs || [])) : [];
    m.tempo = p ? p.tempo || null : null;
    m.creeLe = p ? p.creeLe : null;
    m.choisi = null;
    $("morceau-titre").value = m.titre;
    fermerFeuilles();
    afficherEtat("");
    afficher();
    if (!m.blocs.length) montrerChoix();
  }

  async function fermer() {
    transport.arreter();
    lecture = null;
    joue = null;
    fermerFeuilles();
    if (m.minuterie) { clearTimeout(m.minuterie); m.minuterie = null; sauver(); }
    await m.sauvegarde;
  }

  function fermerFeuilles() {
    fermerFeuille($("morceau-choix"));
    fermerFeuille($("morceau-menu"));
  }

  /** Le nom de section d'une idée qu'on ajoute : le sien si elle s'appelle déjà « Refrain… », sinon le suivant. */
  function nomPourIdee(ideeId) {
    const titre = ((idees().get(ideeId) || {}).titre || "").toLowerCase();
    return SECTIONS.find((x) => titre.startsWith(x.toLowerCase())) || sectionSuivante(m.blocs);
  }

  /** Une idée de plus, en bloc (depuis l'éditeur d'idée ou la feuille). */
  function ajouter(ideeId) {
    const bloc = { id: nouvelIdBloc(), idee: ideeId, nom: nomPourIdee(ideeId), fois: 1 };
    m.blocs.push(bloc);
    m.choisi = bloc.id;
    fermerFeuille($("morceau-choix"));
    changement();
    const li = ligne(bloc.id);
    if (li) defiler(li);
  }

  /** Le morceau a changé : on redessine, on arrête l'écoute (elle ne l'entendrait plus), et on enregistre. */
  function changement() {
    arreterEcoute();
    afficher();
    planifier();
  }

  /** L'enregistrement, une demi-seconde après le dernier geste. */
  function planifier() {
    clearTimeout(m.minuterie);
    afficherEtat("attente");
    m.minuterie = setTimeout(() => { m.minuterie = null; sauver(); }, 500);
  }

  function sauver() {
    m.sauvegarde = m.sauvegarde.then(async () => {
      const stockage = deps.stockage();
      const maintenant = new Date().toISOString();
      const donnees = { type: "morceau", titre: m.titre, blocs: m.blocs, tempo: m.tempo, statut: "morceau", nbPages: 0, modele: null };
      try {
        if (!m.id) {
          if (!m.blocs.length) return;
          m.id = deps.nouvelId();
          m.creeLe = maintenant;
          await stockage.creer(m.id, { ...donnees, creeLe: maintenant, modifieLe: maintenant }, []);
        } else {
          await stockage.modifier(m.id, { ...donnees, modifieLe: maintenant });
        }
        afficherEtat("ok");
      } catch (e) {
        console.error(e);
        const texte = "Non enregistré : " + (e.message || e.code || "erreur");
        afficherEtat("erreur", texte);
        toast(texte, 7000);
      }
    });
    return m.sauvegarde;
  }

  /**
   * L'état d'enregistrement, discret : un point de suspension qui attend, une
   * coche quand c'est fait, un signe d'alerte (et un message) sinon. Le texte
   * reste lisible pour qui n'a pas l'œil.
   */
  function afficherEtat(genre, texte = "") {
    const e = $("morceau-etat");
    e.dataset.genre = genre;
    if (genre === "ok") e.innerHTML = `${ico("ok", "s")}<span class="sr">Enregistré</span>`;
    else if (genre === "erreur") { e.innerHTML = `${ico("attention", "s")}<span class="sr"></span>`; e.querySelector(".sr").textContent = texte; }
    else e.textContent = genre === "attente" ? "…" : "";
  }

  // --- Dessiner -----------------------------------------------------------------------

  function afficher() {
    // Le doigt peut être sur un geste d'une carte : on le lui rend après la reconstruction.
    const actif = document.activeElement;
    const li0 = actif && actif.closest && actif.closest("#morceau-blocs > li");
    const garder = li0 ? { id: li0.dataset.id, action: actif.dataset.action || (actif.classList.contains("poignee") ? "poignee" : "choisir") } : null;

    const lesIdees = idees();
    const s = structure({ blocs: m.blocs, tempo: m.tempo }, lesIdees);
    if (m.choisi && !m.blocs.some((b) => b.id === m.choisi)) m.choisi = null;

    const liste = $("morceau-blocs");
    liste.textContent = "";
    m.blocs.forEach((b, i) => liste.appendChild(creerCarte(b, i, lesIdees.get(b.idee), s.segments[i])));
    if (garder) {
      const cible = ligne(garder.id);
      const geste = cible && (cible.querySelector(garder.action === "poignee" ? ".poignee" : `[data-action="${garder.action}"]`));
      const bon = geste && !geste.disabled ? geste : cible && cible.querySelector(".bloc-ouvrir");
      if (bon) bon.focus({ preventScroll: true });
    }

    afficherFrise(s);
    afficherResume(s);
    $("morceau-vide").hidden = m.blocs.length > 0;
    $("morceau-aide").hidden = !m.blocs.length;
    majLecture();
    marquerJoue(joue);
  }

  function creerCarte(b, i, p, seg) {
    const li = document.createElement("li");
    li.className = "bloc" + (seg.manque ? " saute" : ` section-${seg.couleur}`) + (b.id === m.choisi ? " choisi" : "");
    li.dataset.id = b.id;
    const fois = Math.max(1, b.fois || 1);
    li.innerHTML = `
      <div class="bloc-tete">
        <span class="languette" aria-hidden="true"></span>
        <button class="bloc-ouvrir" data-action="choisir" aria-expanded="${b.id === m.choisi}"></button>
        <div class="bloc-infos">
          <input class="bloc-nom" list="morceau-sections" aria-label="Nom de la section" autocomplete="off" enterkeyhint="done">
          <span class="remarque bloc-idee"></span>
        </div>
        <span class="fois" ${fois > 1 ? "" : "hidden"}>×${fois}</span>
        <button class="poignee" aria-label="Déplacer cette partie : glisse la poignée, ou utilise les flèches haut et bas" title="Glisse pour déplacer">${ico("poignee")}</button>
      </div>
      <div class="bloc-gestes">
        <div class="gestes-rang">
          <button class="btn rond" data-action="haut" aria-label="Plus tôt" ${i === 0 ? "disabled" : ""}>${ico("haut")}</button>
          <button class="btn rond" data-action="bas" aria-label="Plus tard" ${i === m.blocs.length - 1 ? "disabled" : ""}>${ico("bas")}</button>
          <span class="bloc-fois pousse" role="group" aria-label="Nombre de fois">
            <button class="btn rond" data-action="moins" aria-label="Une fois de moins" ${fois <= 1 ? "disabled" : ""}>${ico("moins")}</button>
            <span class="val">×${fois}</span>
            <button class="btn rond" data-action="plus" aria-label="Une fois de plus" ${fois >= 16 ? "disabled" : ""}>${ico("plus")}</button>
          </span>
        </div>
        <div class="gestes-rang">
          <button class="btn" data-action="ecouter" ${p ? "" : "disabled"}></button>
          <button class="btn" data-action="ouvrir" ${p ? "" : "disabled"}>${ico("crayon", "s")}Ouvrir l'idée</button>
          <button class="btn rond btn-danger pousse" data-action="retirer" aria-label="Retirer cette partie">${ico("corbeille")}</button>
        </div>
      </div>`;
    li.querySelector(".bloc-nom").value = b.nom || "";
    const detail = li.querySelector(".bloc-idee");
    // Dans un <span> : c'est lui qui s'abrège (…) quand le titre de l'idée est long.
    if (p) {
      detail.innerHTML = "<span></span>";
      detail.firstChild.textContent = `${p.titre} · ${pluriel(nbMesures(p.sequence), "mesure")}`;
    } else {
      detail.innerHTML = `${ico("attention", "s")}<span>Idée supprimée : partie sautée</span>`;
    }
    // Le nom d'abord, puis le reste : renommer ne change que le début du libellé.
    const ouvrirBloc = li.querySelector(".bloc-ouvrir");
    ouvrirBloc.dataset.reste = `, ${seg.manque ? "idée supprimée" : detail.textContent}${fois > 1 ? `, ${fois} fois` : ""}. Régler cette partie.`;
    ouvrirBloc.setAttribute("aria-label", (b.nom || "Partie") + ouvrirBloc.dataset.reste);
    return li;
  }

  function afficherFrise(s) {
    const zone = $("morceau-frise-zone"), frise = $("morceau-frise"), tete = $("morceau-frise-tete");
    zone.hidden = !m.blocs.length;
    frise.querySelectorAll(".frise-seg").forEach((x) => x.remove());
    for (const seg of s.segments) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.id = seg.bloc;
      b.className = "frise-seg " + (seg.manque ? "saute" : `section-${seg.couleur}`) + (seg.bloc === m.choisi ? " choisi" : "");
      b.setAttribute("aria-pressed", String(seg.bloc === m.choisi));
      if (seg.manque) {
        b.innerHTML = ico("attention", "s");
        b.dataset.reste = " : idée supprimée, partie sautée";
        b.setAttribute("aria-label", (seg.nom || "Partie") + b.dataset.reste);
      } else {
        b.style.flexGrow = String(Math.max(seg.pas, 0));
        b.innerHTML = `<span class="frise-texte"><span class="frise-nom"></span><span class="frise-fois"></span></span><span class="frise-initiale"></span>`;
        b.querySelector(".frise-nom").textContent = seg.nom || "";
        b.querySelector(".frise-initiale").textContent = (seg.nom || "").trim().charAt(0).toUpperCase();
        b.querySelector(".frise-fois").textContent = seg.fois > 1 ? ` ×${seg.fois}` : "";
        b.dataset.reste = `, ${pluriel(seg.mesures, "mesure")}${seg.fois > 1 ? `, ${seg.fois} fois` : ""}`;
        b.setAttribute("aria-label", (seg.nom || "Partie") + b.dataset.reste);
      }
      frise.insertBefore(b, tete);
    }
    $("morceau-frise-fin").textContent = dureeEnTexte(s.secondes);
    ajusterFrise();
  }

  /**
   * Dans un segment : le nom et « ×2 » s'il y a la place ; le nom seul sinon ;
   * son initiale quand c'est étroit ; rien du tout en deçà. Le libellé complet
   * reste dans aria-label, et un toucher choisit la carte qui le dit.
   */
  function ajusterFrise() {
    for (const seg of $("morceau-frise").querySelectorAll(".frise-seg:not(.saute)")) {
      const texte = seg.querySelector(".frise-texte");
      seg.classList.remove("sans-fois", "sans-nom", "sans-texte");
      const place = seg.clientWidth - 10;
      if (texte.offsetWidth <= place) continue;
      seg.classList.add("sans-fois");
      if (texte.offsetWidth <= place) continue;
      seg.classList.add("sans-nom");
      if (place < 9) seg.classList.add("sans-texte"); // une lettre de 11 px en demande neuf
    }
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(() => ajusterFrise()).observe($("morceau-frise"));

  function afficherResume(s) {
    const tempo = m.tempo || s.tempo;
    $("morceau-duree").innerHTML = m.blocs.length
      ? `${pluriel(s.mesures, "mesure")} · ${dureeEnTexte(s.secondes)} · ${ico("d4", "s")}${tempo}`
      : "Morceau vide";
    $("morceau-tempo").value = tempo;
    $("morceau-tempo-val").textContent = `♩ = ${tempo}`;
  }

  /** Choisir une partie (ou aucune) : on n'y touche que par des classes. */
  function choisir(id, { defile = false } = {}) {
    m.choisi = id;
    for (const li of lignes()) {
      const on = li.dataset.id === id;
      li.classList.toggle("choisi", on);
      li.querySelector(".bloc-ouvrir").setAttribute("aria-expanded", String(on));
    }
    for (const seg of $("morceau-frise").querySelectorAll(".frise-seg")) {
      const on = seg.dataset.id === id;
      seg.classList.toggle("choisi", on);
      seg.setAttribute("aria-pressed", String(on));
    }
    const li = id && ligne(id);
    if (defile && li) defiler(li);
  }

  /** Amène une carte sous les yeux, sans toucher à la page si elle y est déjà. */
  function defiler(li) {
    li.scrollIntoView({ block: "nearest", behavior: reduireMouvement() ? "auto" : "smooth" });
  }

  // --- Choisir une idée à ajouter ---------------------------------------------------

  function montrerChoix() {
    const dlg = $("morceau-choix");
    // app.js cache cette feuille après « Ajouter à un morceau » : on la rend à chaque ouverture.
    dlg.hidden = false;
    $("morceau-cherche").value = "";
    afficherChoix();
    ouvrirFeuille(dlg);
  }

  function afficherChoix() {
    const q = $("morceau-cherche").value.trim().toLowerCase();
    const zone = $("morceau-idees");
    zone.textContent = "";
    const liste = deps.partitions().filter((p) => p.type === "idee" && (!q || (p.titre || "").toLowerCase().includes(q)));
    if (!liste.length) {
      zone.innerHTML = `<p class="remarque">${q ? "Aucune idée ne porte ce nom." : "Pas encore d'idée : note-en une (« Nouvelle idée »), puis reviens ici."}</p>`;
      return;
    }
    for (const p of liste) {
      // La couleur que l'idée aura dans le morceau : la sienne si elle y est déjà.
      const couleur = couleursDesIdees([...m.blocs, { idee: p.id }]).get(p.id);
      const mesures = nbMesures(p.sequence);
      const b = document.createElement("button");
      b.className = `choix-idee section-${couleur}`;
      b.innerHTML = `<span class="choix-vignette"><svg role="img" aria-hidden="true"></svg></span>
        <span class="choix-textes"><span class="titre"></span><span class="detail"></span></span>${ico("plus")}`;
      b.querySelector(".titre").textContent = p.titre;
      b.querySelector(".detail").textContent = `devient « ${nomPourIdee(p.id)} » · ${pluriel(mesures, "mesure")}`;
      dessinerApercu(b.querySelector("svg"), p.sequence);
      b.addEventListener("click", () => ajouter(p.id));
      zone.appendChild(b);
    }
  }

  // --- Écouter -----------------------------------------------------------------------

  /**
   * Arrête ce que cet écran fait sonner. On efface `lecture` avant d'arrêter : si le
   * piano se charge encore, il n'y a rien à arrêter, et c'est ecouter() qui, au
   * réveil, voit que la lecture n'est plus la sienne.
   */
  function arreterEcoute() {
    if (!lecture) return;
    lecture = null;
    transport.arreter();
    majLecture();
    marquerJoue(null);
  }

  /** Les boutons d'écoute disent où on en est : lire ou arrêter. */
  function majLecture() {
    const tout = !!lecture && lecture.cle === "tout";
    const grand = $("morceau-ecouter");
    grand.disabled = !m.blocs.length;
    grand.innerHTML = ico(tout ? "stop" : "lire");
    grand.setAttribute("aria-label", tout ? "Arrêter l'écoute" : "Écouter l'enchaînement");
    for (const li of lignes()) {
      const bouton = li.querySelector('[data-action="ecouter"]');
      const ici = !!lecture && lecture.cle === li.dataset.id;
      bouton.innerHTML = `${ico(ici ? "stop" : "lire", "s")}${ici ? "Arrêter" : "Écouter"}`;
      bouton.setAttribute("aria-label", ici ? "Arrêter ce bloc" : "Écouter ce bloc");
    }
    $("morceau-frise").classList.toggle("lecture", !!lecture);
    $("morceau-frise-tete").hidden = !lecture;
  }

  /** Le bloc qui sonne s'allume, sur sa carte comme sur la frise. */
  function marquerJoue(id) {
    joue = id;
    for (const li of lignes()) li.classList.toggle("joue", li.dataset.id === id);
    for (const seg of $("morceau-frise").querySelectorAll(".frise-seg")) seg.classList.toggle("joue", seg.dataset.id === id);
  }

  /**
   * Fait sonner l'enchaînement ou un seul bloc. La tête de lecture avance sur
   * la frise au rythme du transport (sa position, en pas, à chaque image).
   * @param cle  "tout" ou l'identifiant du bloc écouté
   */
  async function ecouter(cle, blocs) {
    if (lecture && lecture.cle === cle) { arreterEcoute(); return; }
    const a = assembler({ blocs, tempo: m.tempo }, idees());
    if (!a.fin) { toast("Rien à écouter : ajoute une idée."); return; }
    const moi = { cle };
    lecture = moi;
    majLecture();
    // Le piano se charge au premier toucher : si on a rappuyé entre-temps, on ne joue plus.
    try { await transport.piano.pret(); } catch (e) { if (lecture === moi) { lecture = null; majLecture(); } toast(e.message || "Le piano n'a pas pu se charger."); return; }
    if (lecture !== moi) return;

    const plages = new Map(); // bloc → où il commence et finit dans ce qu'on joue
    for (const x of a.passages) plages.set(x.bloc, { debut: plages.has(x.bloc) ? plages.get(x.bloc).debut : x.debut, fin: x.fin });
    const tete = $("morceau-frise-tete");
    let dernier = null;
    const placer = (pas) => {
      const passage = a.passages.find((x) => pas >= x.debut && pas < x.fin);
      if (!passage) return; // après la dernière note : la tête reste au bout
      if (passage.bloc !== dernier) {
        dernier = passage.bloc;
        marquerJoue(dernier);
        if (cle === "tout") { const li = ligne(dernier); if (li) defiler(li); }
      }
      const seg = segment(passage.bloc), r = plages.get(passage.bloc);
      if (!seg) return;
      const f = Math.min(1, Math.max(0, (pas - r.debut) / Math.max(1, r.fin - r.debut)));
      tete.style.transform = `translateX(${seg.offsetLeft + f * seg.offsetWidth}px)`;
    };
    try {
      placer(a.passages[0].debut); // la tête part du début, avant la première image
      await transport.jouer(sourceDuMorceau(a), {
        surPosition: placer,
        surFin: () => {
          if (lecture !== moi) return;
          lecture = null;
          majLecture();
          marquerJoue(null);
        },
      });
    } catch (e) {
      if (lecture === moi) { lecture = null; majLecture(); marquerJoue(null); }
      toast(e.message || "Le piano n'a pas pu se charger.");
    }
  }

  // --- Branchements ------------------------------------------------------------------

  $("morceau-titre").addEventListener("change", () => {
    m.titre = $("morceau-titre").value.trim() || "Morceau sans titre";
    $("morceau-titre").value = m.titre;
    planifier();
  });
  $("morceau-titre").addEventListener("keydown", (ev) => { if (ev.key === "Enter") ev.currentTarget.blur(); });
  $("morceau-ajouter").addEventListener("click", montrerChoix);
  $("morceau-choix-fermer").addEventListener("click", () => fermerFeuille($("morceau-choix")));
  $("morceau-cherche").addEventListener("input", afficherChoix);
  $("morceau-ecouter").addEventListener("click", () => ecouter("tout", m.blocs));
  $("morceau-plus").addEventListener("click", () => ouvrirFeuille($("morceau-menu")));
  $("morceau-menu-fermer").addEventListener("click", () => fermerFeuille($("morceau-menu")));
  $("morceau-frise").addEventListener("click", (ev) => {
    const seg = ev.target.closest(".frise-seg");
    if (seg) choisir(seg.dataset.id, { defile: true });
  });

  let minuterieTempo = null;
  $("morceau-tempo").addEventListener("input", () => {
    $("morceau-tempo-val").textContent = `♩ = ${$("morceau-tempo").value}`;
    arreterEcoute();
    clearTimeout(minuterieTempo);
    minuterieTempo = setTimeout(() => { m.tempo = Number($("morceau-tempo").value); changement(); }, 300);
  });
  // − et + : un battement de plus ou de moins, pour qui n'a pas le doigt assez fin pour la glissière.
  for (const [id, pas] of [["morceau-tempo-moins", -1], ["morceau-tempo-plus", 1]]) {
    $(id).addEventListener("click", () => {
      const t = $("morceau-tempo");
      t.value = Math.min(Number(t.max), Math.max(Number(t.min), Number(t.value) + pas));
      t.dispatchEvent(new Event("input"));
    });
  }
  $("morceau-midi").addEventListener("click", async () => {
    await fermer();
    if (!m.id) { toast("Le morceau est vide : ajoute une idée."); return; }
    deps.partager({ id: m.id, type: "morceau", titre: m.titre, blocs: m.blocs, tempo: m.tempo });
  });
  // Le morceau entier pour MuseScore : ses blocs bout à bout, chacun avec sa mesure et sa tonalité.
  $("morceau-musicxml").addEventListener("click", async () => {
    await fermer();
    if (!m.id) { toast("Le morceau est vide : ajoute une idée."); return; }
    deps.exporterMusicXml({ id: m.id, type: "morceau", titre: m.titre, blocs: m.blocs, tempo: m.tempo });
  });
  $("morceau-supprimer").addEventListener("click", async () => {
    if (!m.id) { deps.quitter(); return; }
    if (!(await deps.veutSupprimer({ id: m.id, type: "morceau", titre: m.titre }))) return;
    clearTimeout(m.minuterie); m.minuterie = null;
    await m.sauvegarde;
    await deps.stockage().supprimer(m.id, 0);
    toast(`« ${m.titre} » est supprimé.`);
    m.id = null;
    deps.quitter();
  });

  const liste = $("morceau-blocs");
  // Renommer ne reconstruit rien : un toucher qui suit (sur un autre geste) ne doit pas se perdre.
  liste.addEventListener("change", (ev) => {
    const li = ev.target.closest(".bloc");
    if (!li || !ev.target.classList.contains("bloc-nom")) return;
    const b = m.blocs.find((x) => x.id === li.dataset.id);
    b.nom = ev.target.value.trim() || "Bloc";
    ev.target.value = b.nom;
    const seg = segment(b.id);
    if (seg) {
      if (seg.querySelector(".frise-nom")) seg.querySelector(".frise-nom").textContent = b.nom;
      seg.setAttribute("aria-label", b.nom + seg.dataset.reste);
      ajusterFrise();
    }
    const ouvrirBloc = li.querySelector(".bloc-ouvrir");
    ouvrirBloc.setAttribute("aria-label", b.nom + ouvrirBloc.dataset.reste);
    planifier();
  });
  // Entrer dans le nom d'une carte (au clavier) la choisit.
  liste.addEventListener("focusin", (ev) => {
    const li = ev.target.closest && ev.target.closest(".bloc");
    if (li && ev.target.classList.contains("bloc-nom") && m.choisi !== li.dataset.id) choisir(li.dataset.id);
  });
  liste.addEventListener("keydown", (ev) => {
    if (ev.target.classList.contains("bloc-nom") && ev.key === "Enter") { ev.target.blur(); return; }
    // La poignée au clavier : flèche haut ou bas déplace la partie.
    if (!ev.target.classList.contains("poignee") || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
    ev.preventDefault();
    const li = ev.target.closest(".bloc");
    deplacer(li.dataset.id, ev.key === "ArrowUp" ? -1 : 1);
  });

  function deplacer(id, sens) {
    const i = m.blocs.findIndex((x) => x.id === id), j = i + sens;
    if (i < 0 || j < 0 || j >= m.blocs.length) return;
    m.blocs.splice(j, 0, ...m.blocs.splice(i, 1));
    changement();
    const li = ligne(id);
    if (li) defiler(li);
  }

  liste.addEventListener("click", (ev) => {
    const bouton = ev.target.closest("[data-action]");
    if (!bouton) return;
    const li = bouton.closest(".bloc");
    const i = m.blocs.findIndex((x) => x.id === li.dataset.id);
    const b = m.blocs[i];
    switch (bouton.dataset.action) {
      case "choisir": return choisir(m.choisi === b.id ? null : b.id, { defile: true });
      case "moins": b.fois = Math.max(1, (b.fois || 1) - 1); return changement();
      case "plus": b.fois = Math.min(16, (b.fois || 1) + 1); return changement();
      case "haut": return deplacer(b.id, -1);
      case "bas": return deplacer(b.id, 1);
      case "retirer": m.blocs.splice(i, 1); m.choisi = null; return changement();
      case "ecouter": return ecouter(b.id, [b]);
      case "ouvrir": return deps.ouvrirIdee(b.idee);
      default: return undefined;
    }
  });

  // Glisser un bloc par sa poignée : il suit le doigt, les autres s'écartent au lâcher.
  liste.addEventListener("pointerdown", (ev) => {
    const poignee = ev.target.closest(".poignee");
    if (!poignee) return;
    ev.preventDefault();
    const li = poignee.closest(".bloc");
    poignee.setPointerCapture(ev.pointerId);
    glisse = { li, y0: ev.clientY, depuis: m.blocs.findIndex((x) => x.id === li.dataset.id) };
    li.classList.add("glisse");
  });
  liste.addEventListener("pointermove", (ev) => {
    if (!glisse) return;
    glisse.li.style.transform = `translateY(${ev.clientY - glisse.y0}px)`;
  });
  const lacher = (ev) => {
    if (!glisse) return;
    const { li, depuis } = glisse;
    glisse = null;
    li.classList.remove("glisse");
    li.style.transform = "";
    const autres = [...liste.children].filter((x) => x !== li);
    let vers = autres.findIndex((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
    if (vers < 0) vers = autres.length;
    if (vers === depuis) return;
    m.blocs.splice(vers, 0, ...m.blocs.splice(depuis, 1));
    changement();
  };
  liste.addEventListener("pointerup", lacher);
  liste.addEventListener("pointercancel", lacher);

  /** Le morceau a changé sur un autre appareil : on le reprend, sauf changement en cours ici. */
  function recharger(p) {
    if (!p || p.id !== m.id || m.minuterie) return false;
    m.titre = p.titre;
    m.blocs = JSON.parse(JSON.stringify(p.blocs || []));
    m.tempo = p.tempo || null;
    $("morceau-titre").value = m.titre;
    afficher();
    return true;
  }

  return {
    ouvrir, fermer, ajouter, recharger,
    get id() { return m.id; },
    // Une idée a changé : on redessine, sauf si on est en train de nommer un bloc.
    rafraichir: () => {
      const actif = document.activeElement;
      if (actif && actif.classList && actif.classList.contains("bloc-nom")) return;
      afficher();
      if ($("morceau-choix").open) afficherChoix();
    },
  };
}
