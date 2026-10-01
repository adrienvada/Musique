/**
 * L'ÉCRAN MORCEAU
 *
 * La liste des blocs d'un morceau (morceau.js) : on les ajoute depuis la
 * bibliothèque, on les nomme (Intro, Couplet…), on les répète, on les
 * réordonne en les glissant par leur poignée (ou avec ↑ ↓), on écoute un
 * bloc ou tout l'enchaînement. Tout s'enregistre tout seul.
 */
import { assembler, sourceDuMorceau, sectionSuivante, SECTIONS } from "./morceau.js";
import { nbMesures } from "./sequence.js";
import { dessinerApercu } from "./idee.js";

const $ = (id) => document.getElementById(id);
const COULEURS = ["#2B48B0", "#2F7A4D", "#9A5B00", "#7A3FA0", "#A5281B", "#2E7C8A", "#5B5F66"];

/** Une couleur par nom de section, la même partout (vignettes, liste). */
export function couleurSection(nom) {
  let h = 0;
  for (const c of nom || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COULEURS[h % COULEURS.length];
}

/** La vignette d'un morceau : ses blocs, de la longueur de leurs passages. */
export function dessinerApercuMorceau(svg, morceau, idees) {
  const a = assembler(morceau, idees);
  svg.setAttribute("viewBox", "0 0 240 120");
  svg.setAttribute("preserveAspectRatio", "none");
  if (!a.fin) { svg.innerHTML = ""; return; }
  const noms = new Map((morceau.blocs || []).map((b) => [b.id, b.nom]));
  svg.innerHTML = a.passages.map((p) => {
    const x = 6 + (p.debut / a.fin) * 228, w = Math.max(3, ((p.fin - p.debut) / a.fin) * 228 - 2);
    return `<rect x="${x}" y="40" width="${w}" height="40" rx="5" fill="${couleurSection(noms.get(p.bloc))}" opacity="${p.fois ? 0.6 : 0.9}"/>`;
  }).join("");
}

export function creerVueMorceau(deps) {
  const { transport, toast } = deps;
  const m = { id: null, titre: "", blocs: [], tempo: null, creeLe: null, minuterie: null, sauvegarde: Promise.resolve() };
  let glisse = null;

  const idees = () => new Map(deps.partitions().filter((p) => p.type === "idee").map((p) => [p.id, p]));
  const nouvelIdBloc = () => "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  $("morceau-sections").innerHTML = SECTIONS.map((s) => `<option value="${s}">`).join("");

  function ouvrir(p) {
    m.id = p ? p.id : null;
    m.titre = p ? p.titre : "Nouveau morceau";
    m.blocs = p ? JSON.parse(JSON.stringify(p.blocs || [])) : [];
    m.tempo = p ? p.tempo || null : null;
    m.creeLe = p ? p.creeLe : null;
    $("morceau-titre").value = m.titre;
    $("morceau-choix").hidden = true;
    $("morceau-etat").textContent = "";
    afficher();
    if (!m.blocs.length) montrerChoix();
  }

  async function fermer() {
    transport.arreter();
    if (m.minuterie) { clearTimeout(m.minuterie); m.minuterie = null; sauver(); }
    await m.sauvegarde;
  }

  /** Une idée de plus, en bloc (depuis l'éditeur d'idée ou la liste). */
  function ajouter(ideeId) {
    // Une idée qui s'appelle déjà « Refrain… » donne son nom au bloc.
    const titre = ((idees().get(ideeId) || {}).titre || "").toLowerCase();
    const section = SECTIONS.find((x) => titre.startsWith(x.toLowerCase()));
    m.blocs.push({ id: nouvelIdBloc(), idee: ideeId, nom: section || sectionSuivante(m.blocs), fois: 1 });
    changement();
  }

  function changement() {
    afficher();
    clearTimeout(m.minuterie);
    $("morceau-etat").textContent = "…";
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
        $("morceau-etat").textContent = "Enregistré";
      } catch (e) {
        console.error(e);
        $("morceau-etat").textContent = "Non enregistré : " + (e.message || e.code || "erreur");
      }
    });
    return m.sauvegarde;
  }

  function afficher() {
    const lesIdees = idees();
    const liste = $("morceau-blocs");
    liste.textContent = "";
    m.blocs.forEach((b, i) => {
      const p = lesIdees.get(b.idee);
      const li = document.createElement("li");
      li.className = "bloc";
      li.dataset.id = b.id;
      li.style.setProperty("--section", couleurSection(b.nom));
      const mesures = p ? nbMesures(p.sequence) : 0;
      li.innerHTML = `
        <span class="poignee" aria-hidden="true" title="Glisse pour déplacer">⠿</span>
        <svg class="bloc-apercu" role="img" aria-label="Aperçu"></svg>
        <div class="bloc-infos">
          <input class="bloc-nom" list="morceau-sections" aria-label="Nom de la section">
          <span class="remarque bloc-idee"></span>
        </div>
        <span class="bloc-fois" role="group" aria-label="Nombre de fois">
          <button class="btn btn-petit" data-action="moins" aria-label="Une fois de moins">−</button>
          <span class="val">× ${b.fois || 1}</span>
          <button class="btn btn-petit" data-action="plus" aria-label="Une fois de plus">+</button>
        </span>
        <span class="bloc-actions">
          <button class="btn btn-petit" data-action="haut" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="btn btn-petit" data-action="bas" aria-label="Descendre" ${i === m.blocs.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn btn-petit" data-action="ecouter" aria-label="Écouter ce bloc" ${p ? "" : "disabled"}>▶</button>
          <button class="btn btn-petit" data-action="ouvrir" ${p ? "" : "disabled"}>Ouvrir</button>
          <button class="btn btn-petit btn-danger" data-action="retirer" aria-label="Retirer ce bloc">✕</button>
        </span>`;
      li.querySelector(".bloc-nom").value = b.nom || "";
      li.querySelector(".bloc-idee").textContent = p ? `${p.titre} · ${mesures} mesure${mesures > 1 ? "s" : ""}` : "Idée supprimée : ce bloc ne s'entend plus";
      if (p) dessinerApercu(li.querySelector(".bloc-apercu"), p.sequence);
      liste.appendChild(li);
    });
    const a = assembler({ blocs: m.blocs, tempo: m.tempo }, lesIdees);
    const tempo = m.tempo || a.tempo;
    $("morceau-tempo").value = tempo;
    $("morceau-tempo-val").textContent = `♩ = ${tempo}`;
    const secondes = Math.round((a.fin / 4) * (60 / tempo));
    $("morceau-duree").textContent = m.blocs.length ? `${m.blocs.length} bloc${m.blocs.length > 1 ? "s" : ""} · ${Math.floor(secondes / 60)} min ${String(secondes % 60).padStart(2, "0")}` : "";
    $("morceau-vide").hidden = m.blocs.length > 0;
  }

  // --- Choisir une idée à ajouter -------------------------------------------------

  function montrerChoix() {
    $("morceau-choix").hidden = false;
    $("morceau-cherche").value = "";
    afficherChoix();
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
      const b = document.createElement("button");
      b.className = "choix-idee";
      b.innerHTML = `<svg role="img" aria-hidden="true"></svg><span class="titre"></span>`;
      b.querySelector(".titre").textContent = p.titre;
      dessinerApercu(b.querySelector("svg"), p.sequence);
      b.addEventListener("click", () => { ajouter(p.id); toast(`« ${p.titre} » ajoutée.`, 2000); });
      zone.appendChild(b);
    }
  }

  // --- Écouter -----------------------------------------------------------------------

  async function ecouter(blocs, bouton) {
    if (transport.actif) { const meme = transport.bouton === bouton; transport.arreter(); if (meme) return; }
    const a = assembler({ blocs, tempo: m.tempo }, idees());
    if (!a.fin) { toast("Rien à écouter : ajoute une idée."); return; }
    const libelle = bouton.textContent;
    bouton.textContent = "■";
    if (bouton.id === "morceau-ecouter") bouton.textContent = "■ Arrêter";
    transport.bouton = bouton;
    const lignes = () => [...$("morceau-blocs").children];
    try {
      await transport.jouer(sourceDuMorceau(a), {
        surPosition: (pas) => {
          const passage = a.passages.find((x) => pas >= x.debut && pas < x.fin);
          for (const li of lignes()) li.classList.toggle("joue", !!passage && li.dataset.id === passage.bloc);
        },
        surFin: () => { bouton.textContent = libelle; transport.bouton = null; for (const li of lignes()) li.classList.remove("joue"); },
      });
    } catch (e) {
      bouton.textContent = libelle;
      toast(e.message || "Le piano n'a pas pu se charger.");
    }
  }

  // --- Branchements ------------------------------------------------------------------

  $("morceau-titre").addEventListener("change", () => {
    m.titre = $("morceau-titre").value.trim() || "Morceau sans titre";
    $("morceau-titre").value = m.titre;
    changement();
  });
  $("morceau-ajouter").addEventListener("click", montrerChoix);
  $("morceau-choix-fermer").addEventListener("click", () => { $("morceau-choix").hidden = true; });
  $("morceau-cherche").addEventListener("input", afficherChoix);
  $("morceau-ecouter").addEventListener("click", (ev) => ecouter(m.blocs, ev.currentTarget));
  let minuterieTempo = null;
  $("morceau-tempo").addEventListener("input", () => {
    $("morceau-tempo-val").textContent = `♩ = ${$("morceau-tempo").value}`;
    transport.arreter();
    clearTimeout(minuterieTempo);
    minuterieTempo = setTimeout(() => { m.tempo = Number($("morceau-tempo").value); changement(); }, 300);
  });
  $("morceau-midi").addEventListener("click", async () => {
    await fermer();
    if (!m.id) { toast("Le morceau est vide : ajoute une idée."); return; }
    deps.partager({ id: m.id, type: "morceau", titre: m.titre, blocs: m.blocs, tempo: m.tempo });
  });
  $("morceau-supprimer").addEventListener("click", async () => {
    if (!m.id) { deps.quitter(); return; }
    if (!window.confirm(`Supprimer le morceau « ${m.titre} » ? Ses idées restent dans ta bibliothèque.`)) return;
    clearTimeout(m.minuterie); m.minuterie = null;
    await m.sauvegarde;
    await deps.stockage().supprimer(m.id, 0);
    toast(`« ${m.titre} » est supprimé.`);
    m.id = null;
    deps.quitter();
  });

  const liste = $("morceau-blocs");
  liste.addEventListener("change", (ev) => {
    const li = ev.target.closest(".bloc");
    if (!li || !ev.target.classList.contains("bloc-nom")) return;
    const b = m.blocs.find((x) => x.id === li.dataset.id);
    b.nom = ev.target.value.trim() || "Bloc";
    changement();
  });
  liste.addEventListener("click", (ev) => {
    const bouton = ev.target.closest("[data-action]");
    if (!bouton) return;
    const li = bouton.closest(".bloc");
    const i = m.blocs.findIndex((x) => x.id === li.dataset.id);
    const b = m.blocs[i];
    switch (bouton.dataset.action) {
      case "moins": b.fois = Math.max(1, (b.fois || 1) - 1); return changement();
      case "plus": b.fois = Math.min(16, (b.fois || 1) + 1); return changement();
      case "haut": if (i > 0) { m.blocs.splice(i - 1, 0, ...m.blocs.splice(i, 1)); changement(); } return undefined;
      case "bas": if (i < m.blocs.length - 1) { m.blocs.splice(i + 1, 0, ...m.blocs.splice(i, 1)); changement(); } return undefined;
      case "retirer": m.blocs.splice(i, 1); return changement();
      case "ecouter": return ecouter([b], bouton);
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
    rafraichir: () => { if (!document.activeElement || !document.activeElement.closest("#morceau-blocs")) afficher(); },
  };
}
