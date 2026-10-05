/**
 * L'APPLI INSTALLABLE, HORS LIGNE, ET SES MISES À JOUR (le site seulement)
 *
 * Le service worker (sw.js) garde l'appli pour le hors-ligne. Une version
 * mise en ligne s'installe en arrière-plan, puis prend la main ; si la page
 * ouverte n'est pas de cette version, un message passager propose de
 * recharger. Rien ne se recharge tout seul : on peut être au milieu d'une
 * prise ou d'une correction.
 *
 * Une appli installée reste ouverte des jours : en y revenant (au plus une
 * fois toutes les dix minutes), on demande s'il y a une nouvelle version,
 * sans attendre que le navigateur y pense.
 *
 * L'inscription attend que la page soit chargée : la copie de l'appli ne
 * lui dispute pas le réseau. Ce qui est lourd et ne sert pas au démarrage
 * (pdf.js, le piano) se copie ensuite, en tâche de fond.
 */
import { $, el } from "./ui.js";

/** « Une nouvelle version est prête » : un message passager, avec de quoi recharger. */
function proposerRechargement() {
  if ($("toast-version")) return;
  const m = el("div", "toast toast-action");
  m.id = "toast-version";
  m.setAttribute("role", "status");
  m.setAttribute("popover", "manual");
  const recharger = el("button", "btn btn-petit", "Recharger");
  recharger.addEventListener("click", () => location.reload());
  m.append(el("span", "", "Une nouvelle version de Portée est prête."), recharger);
  document.body.appendChild(m);
  // En « popover », comme les autres messages : au-dessus d'une feuille ouverte.
  if (m.showPopover) { try { m.showPopover(); } catch { /* sans popover : il s'affiche quand même */ } }
  setTimeout(() => m.remove(), 20000);
}

function brancherServiceWorker() {
  // La version de la page : celle de l'adresse de ce module (…?v=…, la même pour tous les modules).
  const maVersion = new URL(import.meta.url).searchParams.get("v");
  const copierEnFond = (sw) => sw && sw.postMessage({ type: "portee-precharger" });
  navigator.serviceWorker.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.type !== "portee-version") return;
    copierEnFond(e.source); // une version qui vient de prendre la main
    if (maVersion && m.version !== maVersion) proposerRechargement();
  });
  let verifiee = Date.now();
  const inscrire = () => navigator.serviceWorker.register("sw.js").then((inscription) => {
    navigator.serviceWorker.ready.then((r) => copierEnFond(r.active));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || Date.now() - verifiee < 10 * 60 * 1000) return;
      verifiee = Date.now();
      inscription.update().catch(() => {}); // hors ligne : la prochaine fois
    });
  }).catch(() => {});
  if (document.readyState === "complete") inscrire();
  else addEventListener("load", inscrire, { once: true });
}

/**
 * Le bouton « Installer » : le navigateur propose, on le montre ; une fois
 * la réponse donnée, il s'en va. À brancher dès le démarrage : la
 * proposition peut arriver avant que la bibliothèque soit ouverte.
 */
export function brancherInstallation() {
  let invitation = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); invitation = e; $("installer").hidden = false; });
  const oublier = () => { invitation = null; $("installer").hidden = true; };
  $("installer").addEventListener("click", () => {
    if (!invitation) return;
    invitation.prompt();
    invitation.userChoice.catch(() => null).then(oublier);
  });
}

/**
 * Hors ligne, hors de claude.ai (sw.js n'existe que sur le site). Un
 * contexte sûr : https, ou l'ordinateur lui-même (les essais de bout en bout).
 */
export function brancherHorsLigne({ dansClaude }) {
  if (!dansClaude && "serviceWorker" in navigator && window.isSecureContext) brancherServiceWorker();
}
