/**
 * LE CARNET D'UNE IDÉE : SA NOTE, SES ÉTIQUETTES, LE FAVORI, LE MÉMO VOCAL
 *
 * La feuille « Carnet » de l'éditeur (`#idee-infos`) : ce qu'on écrit ou dit
 * autour d'une idée, pour la retrouver. Le mémo vocal (une minute au plus)
 * s'enregistre au micro et se réécoute ; son son voyage à part de la fiche
 * (stockage.ecrireMemo), la fiche n'en garde que la durée et le format.
 *
 * Il vivait dans idee.js, qui en faisait une seule fermeture de ≈770 lignes
 * (audit du 04/10, T3). Il reçoit son contexte de l'éditeur, comme les
 * autres modules du pupitre.
 */
import { ico } from "./icones.js";
import { echapper } from "./ui.js";
import { confirmer } from "./dialogue.js";
import { explication } from "./erreurs.js";
import { fermerFeuille } from "./feuilles.js";
import { messageMicro } from "./idee-chant.js";
import { sessionAudio, garderEveille, laisserDormir } from "./eveil.js";

const enBase64 = (blob) => new Promise((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => ko(r.error);
  r.readAsDataURL(blob);
});
const depuisBase64 = (memo) => {
  const octets = Uint8Array.from(atob(memo.base64), (c) => c.charCodeAt(0));
  return new Blob([octets], { type: memo.type || "audio/mp4" });
};

/**
 * @param ctx {
 *   e (l'état de l'éditeur : note, étiquettes, favori, mémo), $, toast, transport,
 *   etiquettes() → celles de la bibliothèque, stockage() → le stockage ouvert,
 *   planifierSauvegarde(delai), sauverMaintenant() → la promesse des écritures,
 *   choisirMode(mode)
 * }
 */
export function creerCarnet(ctx) {
  const { e, $, toast } = ctx;
  let enregistreur = null, lecteurMemo = null;

  function afficher() {
    $("info-note").value = e.note;
    $("info-favori").setAttribute("aria-pressed", String(e.favori));
    $("info-favori").innerHTML = `${ico(e.favori ? "etoile-pleine" : "etoile", "s")}Favori`;
    $("info-favori").setAttribute("aria-label", e.favori ? "Favori (toucher pour retirer)" : "Mettre en favori");
    const zone = $("info-etiquettes");
    zone.textContent = "";
    for (const t of e.etiquettes) {
      const span = document.createElement("span");
      span.className = "etiquette";
      span.textContent = t;
      const x = document.createElement("button");
      x.type = "button"; x.innerHTML = ico("fermer", "s"); x.setAttribute("aria-label", `Retirer l'étiquette ${t}`);
      x.addEventListener("click", () => { e.etiquettes = e.etiquettes.filter((y) => y !== t); afficher(); ctx.planifierSauvegarde(0); });
      span.appendChild(x);
      zone.appendChild(span);
    }
    const connues = ctx.etiquettes ? ctx.etiquettes().filter((t) => !e.etiquettes.includes(t)) : [];
    $("info-etiquettes-connues").innerHTML = connues.map((t) => `<option value="${echapper(t)}">`).join("");
    $("memo-ecouter").hidden = $("memo-effacer").hidden = !e.memo || !!enregistreur;
    if (!enregistreur) {
      $("memo-enregistrer-texte").textContent = e.memo ? "Refaire le mémo" : "Enregistrer un mémo";
      $("memo-etat").textContent = e.memo ? `${e.memo.duree} s` : "";
    }
  }

  /** Enregistre un mémo (ou l'arrête, s'il s'enregistre déjà). */
  async function enregistrerMemo() {
    if (enregistreur) { enregistreur.stop(); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices) { toast("Ce navigateur ne sait pas enregistrer de son."); return; }
    ctx.transport.arreter();
    // Le mémo prend le micro : l'accordeur le rend (il reprendra en revenant au mode Chanter).
    if (e.modeOuvert && e.mode === "chanter") ctx.choisirMode("clavier");
    // Sur l'iPhone, le micro demande une session « enregistrer et jouer », rendue à « jouer » à la fin :
    // sans quoi le piano obéirait de nouveau au bouton silencieux (eveil.js, M8).
    sessionAudio("play-and-record");
    let flux;
    try {
      flux = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      sessionAudio("playback");
      toast(messageMicro(err), 9000);
      return;
    }
    commencerMemo(flux);
  }

  /** Le micro est là : une minute au plus, en morceaux d'une seconde. */
  function commencerMemo(flux) {
    // Le format que lisent tous les appareils d'abord (Safari enregistre en MP4).
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(flux, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    const bouts = [];
    const debut = Date.now();
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) bouts.push(ev.data); };
    const montre = setInterval(() => {
      const s = Math.round((Date.now() - debut) / 1000);
      $("memo-etat").textContent = `0:${String(s).padStart(2, "0")} / 1:00`;
      if (s >= 60) rec.stop();
    }, 250);
    rec.onstop = async () => {
      clearInterval(montre);
      for (const piste of flux.getTracks()) piste.stop();
      sessionAudio("playback");
      laisserDormir("memo");
      enregistreur = null;
      $("memo-enregistrer").setAttribute("aria-pressed", "false");
      const blob = new Blob(bouts, { type: rec.mimeType || type || "audio/webm" });
      const duree = Math.max(1, Math.round((Date.now() - debut) / 1000));
      if (!blob.size) { afficher(); return; }
      await garderMemo({ type: blob.type, base64: await enBase64(blob), duree });
      toast("Mémo gardé avec l'idée.");
    };
    rec.start(1000);
    // Une minute sans toucher l'écran : il s'éteindrait en plein mémo, et l'iPhone couperait le micro.
    garderEveille("memo");
    enregistreur = rec;
    $("memo-enregistrer").setAttribute("aria-pressed", "true");
    $("memo-enregistrer-texte").textContent = "Arrêter le mémo";
    $("memo-ecouter").hidden = $("memo-effacer").hidden = true;
  }

  /** Garde le mémo (ou l'efface, avec null) : la fiche d'abord, puis le son. */
  async function garderMemo(memo) {
    e.memo = memo ? { duree: memo.duree, type: memo.type } : null;
    ctx.planifierSauvegarde(0);
    await ctx.sauverMaintenant();
    if (e.id) await ctx.stockage().ecrireMemo(e.id, memo).catch((err) => toast(`Le mémo n'a pas pu être gardé : ${explication(err)}`));
    afficher();
  }

  const boutonMemo = (lit) => { $("memo-ecouter").innerHTML = `${ico(lit ? "stop" : "lire", "s")}<span>${lit ? "Arrêter" : "Écouter"}</span>`; };

  async function ecouterMemo() {
    if (lecteurMemo) { arreterMemo(); return; }
    const memo = e.id ? await ctx.stockage().lireMemo(e.id).catch(() => null) : null;
    if (!memo) { toast("Le son de ce mémo n'est pas encore arrivé sur cet appareil (synchronisation)."); return; }
    jouerMemo(memo);
  }

  function jouerMemo(memo) {
    const lecteur = new Audio(URL.createObjectURL(depuisBase64(memo)));
    lecteurMemo = lecteur;
    boutonMemo(true);
    lecteur.onended = () => { if (lecteurMemo === lecteur) arreterMemo(); };
    lecteur.play().catch(() => { if (lecteurMemo === lecteur) arreterMemo(); toast("Ce navigateur ne sait pas lire ce mémo."); });
  }

  function arreterMemo() {
    if (lecteurMemo) lecteurMemo.pause();
    lecteurMemo = null;
    boutonMemo(false);
  }

  $("info-fermer").addEventListener("click", () => fermerFeuille($("idee-infos")));
  $("info-favori").addEventListener("click", () => { e.favori = !e.favori; afficher(); ctx.planifierSauvegarde(0); });
  $("info-note").addEventListener("input", () => { e.note = $("info-note").value; ctx.planifierSauvegarde(); });
  $("info-etiquette-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = $("info-etiquette").value.trim().toLowerCase();
    if (t && !e.etiquettes.includes(t)) { e.etiquettes = [...e.etiquettes, t]; ctx.planifierSauvegarde(0); }
    $("info-etiquette").value = "";
    afficher();
  });
  $("memo-enregistrer").addEventListener("click", enregistrerMemo);
  $("memo-ecouter").addEventListener("click", ecouterMemo);
  // La même question que partout ailleurs (dialogue.js), dans l'ambiance de l'appli.
  $("memo-effacer").addEventListener("click", async () => {
    if (await confirmer({ titre: "Effacer le mémo vocal ?", texte: "Son enregistrement part avec lui. C'est définitif.", oui: "Effacer" })) garderMemo(null);
  });

  return {
    afficher, enregistrerMemo,
    /** L'éditeur se ferme : le mémo qui s'enregistre s'arrête (et se garde), celui qui joue se tait. */
    fermer() {
      if (enregistreur) enregistreur.stop();
      if (lecteurMemo) { lecteurMemo.pause(); lecteurMemo = null; }
    },
  };
}
