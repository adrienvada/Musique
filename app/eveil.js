/**
 * GARDER LE SON ET L'ÉCRAN ÉVEILLÉS
 *
 * Ce que le navigateur ne fait pas tout seul, surtout sur l'iPhone (audit du
 * 04/10, M8), rangé ici pour ne pas disperser ces appels dans les écrans :
 *   - la SESSION AUDIO (Safari, iOS 16.4 et plus) : « playback » pour le
 *     piano, pour qu'il sonne même quand le téléphone est en silencieux
 *     (avant, il obéissait au bouton) ; « play-and-record » pendant que le
 *     micro écoute, puis « playback » de nouveau. Elle se règle avant de
 *     créer ou de réveiller le contexte audio ;
 *   - l'ÉCRAN ALLUMÉ (Screen Wake Lock) pendant l'écoute, le jeu en direct
 *     et le mode Chanter : sinon il s'éteint au bout de trente secondes sans
 *     toucher, en plein enregistrement. Le navigateur le relâche quand la
 *     page passe en arrière-plan : on le redemande au retour ;
 *   - les COMMANDES DE L'ÉCRAN VERROUILLÉ (Media Session) : le titre de ce
 *     qui joue, lecture, pause, arrêt. Le navigateur ne les montre que pour
 *     un élément <audio> qui joue : un son muet d'une seconde, en boucle,
 *     tient ce rôle pendant l'écoute (le piano, lui, passe par Web Audio) ;
 *   - le RETOUR D'ARRIÈRE-PLAN ou d'un appel : le son reprend
 *     (piano.reveiller()), le verrou de l'écran revient.
 *
 * Tout est facultatif : un navigateur qui ne sait pas (la session audio
 * n'existe que dans Safari) ou une page qui n'y a pas droit (claude.ai,
 * cadre isolé) ne voit rien, et rien ne casse.
 */

/** Le type de session audio voulu : "playback" (le piano) ou "play-and-record" (le micro). */
export function sessionAudio(type) {
  try {
    const s = globalThis.navigator && navigator.audioSession;
    if (s && s.type !== type) s.type = type;
  } catch { /* Safari seulement, et seulement hors d'un cadre isolé */ }
}

// --- L'écran allumé -----------------------------------------------------------------

const raisons = new Set(); // "lecture", "direct", "chant" : tant qu'il en reste une, l'écran reste allumé
let verrou = null;
let demande = null;

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

function verrouiller() {
  if (verrou || demande || !raisons.size || !visible()) return;
  const wl = globalThis.navigator && navigator.wakeLock;
  if (!wl || typeof wl.request !== "function") return;
  try {
    demande = wl.request("screen").then((v) => {
      demande = null;
      if (!raisons.size) { v.release().catch(() => {}); return; }
      verrou = v;
      // Le navigateur le relâche de lui-même (page cachée, batterie faible) : on le saura.
      v.addEventListener("release", () => { if (verrou === v) verrou = null; });
    }, () => { demande = null; /* refusé : cadre isolé, économie d'énergie */ });
  } catch { demande = null; }
}

function liberer() {
  const v = verrou;
  verrou = null;
  if (v) v.release().catch(() => {});
}

/** L'écran reste allumé pour cette raison, jusqu'à laisserDormir(raison). */
export function garderEveille(raison) {
  raisons.add(raison);
  verrouiller();
}

export function laisserDormir(raison) {
  raisons.delete(raison);
  if (!raisons.size) liberer();
}

/** Pour les tests : les raisons en cours. */
export const raisonsEveil = () => new Set(raisons);

// --- Les commandes de l'écran verrouillé ------------------------------------------------

let tenant = null; // l'élément <audio> muet
let annonce = null; // { titre, arreter, relancer }

/** Une seconde de silence, en WAV (16 bits, 8 kHz, mono) : quelques kilo-octets. */
function silenceWav() {
  const n = 8000, octets = new DataView(new ArrayBuffer(44 + n * 2));
  const texte = (pos, t) => { for (let i = 0; i < t.length; i++) octets.setUint8(pos + i, t.charCodeAt(i)); };
  texte(0, "RIFF"); octets.setUint32(4, 36 + n * 2, true); texte(8, "WAVE");
  texte(12, "fmt "); octets.setUint32(16, 16, true); octets.setUint16(20, 1, true); octets.setUint16(22, 1, true);
  octets.setUint32(24, 8000, true); octets.setUint32(28, 16000, true); octets.setUint16(32, 2, true); octets.setUint16(34, 16, true);
  texte(36, "data"); octets.setUint32(40, n * 2, true);
  return new Blob([octets.buffer], { type: "audio/wav" });
}

function lancerTenant() {
  try {
    if (!globalThis.navigator || !navigator.mediaSession || typeof Audio === "undefined") return;
    if (!tenant) {
      tenant = new Audio(URL.createObjectURL(silenceWav()));
      tenant.loop = true;
      tenant.setAttribute("aria-hidden", "true");
    }
    const p = tenant.play();
    if (p && p.catch) p.catch(() => { /* pas de geste : les commandes ne s'afficheront pas, le son joue quand même */ });
  } catch { /* facultatif */ }
}

/**
 * À appeler dans le geste qui lance l'écoute, avant toute attente : Safari ne
 * laisse un élément <audio> jouer que dans le geste lui-même.
 */
export function preparerLecture() {
  lancerTenant();
}

/**
 * Ce qui joue : son titre, et ce que font les boutons de l'écran verrouillé.
 * @param o { titre, arreter() (pause et arrêt), relancer() (lecture ; facultatif) }
 */
export function annoncerLecture({ titre, arreter, relancer = null }) {
  annonce = { titre, arreter, relancer };
  const ms = globalThis.navigator && navigator.mediaSession;
  if (!ms) return;
  lancerTenant();
  try {
    if (typeof MediaMetadata !== "undefined") ms.metadata = new MediaMetadata({ title: titre || "Portée", artist: "Portée" });
    ms.playbackState = "playing";
    ms.setActionHandler("pause", () => annonce && annonce.arreter());
    ms.setActionHandler("stop", () => annonce && annonce.arreter());
    ms.setActionHandler("play", relancer ? () => relancer() : null);
  } catch { /* une action que ce navigateur ne connaît pas */ }
}

/** L'écoute s'arrête : les commandes restent (lecture relance), le son muet se tait. */
export function finLecture() {
  try { if (tenant) tenant.pause(); } catch { /* facultatif */ }
  const ms = globalThis.navigator && navigator.mediaSession;
  if (!ms || !annonce) return;
  try {
    ms.playbackState = "paused";
    ms.setActionHandler("pause", null);
    ms.setActionHandler("stop", null);
  } catch { /* facultatif */ }
}

/** Pour les tests : ce qui est annoncé. */
export const lectureAnnoncee = () => annonce;

// --- Le retour d'arrière-plan ---------------------------------------------------------

/**
 * Au retour sur la page (arrière-plan, appel, verrouillage) : le piano se
 * réveille, et l'écran se reverrouille si quelque chose le demandait.
 * @param o { piano }
 */
export function installerEveil({ piano }) {
  if (typeof document === "undefined") return;
  const revenir = () => {
    if (!visible()) return;
    if (piano && piano.reveiller) piano.reveiller().catch(() => {});
    verrouiller();
  };
  document.addEventListener("visibilitychange", revenir);
  // Une page reprise du cache « précédent » (iPhone) : même chose.
  window.addEventListener("pageshow", (e) => { if (e.persisted) revenir(); });
}
