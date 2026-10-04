/**
 * UNE PARTITION JOUABLE DANS LA CONVERSATION (extension MCP Apps)
 *
 * claude.ai sait afficher une petite page fournie par un connecteur, à la
 * place du résultat d'un outil : l'outil partition_montrer porte
 * `_meta.ui.resourceUri`, et l'hôte lit cette ressource (`ui://`) puis la
 * met dans un cadre isolé. La page grave l'ABC avec abcjs, et le joue.
 *
 * Le protocole (JSON-RPC par postMessage, spécification MCP Apps du
 * 2026-01-26) est écrit à la main, sans dépendance : `ui/initialize`, puis
 * `ui/notifications/initialized` ; l'hôte envoie les arguments de l'outil
 * (`ui/notifications/tool-input`) puis son résultat (`…/tool-result`) ; la
 * page dit sa hauteur (`…/size-changed`) et répond à `ping` et à
 * `ui/resource-teardown`. Si le résultat n'apporte pas l'ABC, elle le
 * redemande à l'outil, par l'hôte.
 *
 * Ce qu'elle charge d'ailleurs est déclaré (`_meta.ui.csp`), sinon l'hôte le
 * bloque : abcjs sur cdnjs (vérifié par son empreinte, SRI), et les sons de
 * piano du synthé d'abcjs (paulrosen.github.io).
 */
export const URI_VUE = "ui://portee/partition";
export const TYPE_VUE = "text/html;profile=mcp-app";
export const ABCJS = {
  adresse: "https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.7.1/abcjs-basic-min.js",
  // L'empreinte du fichier publié sur cdnjs (le même que node_modules/abcjs,
  // un test le vérifie) : un CDN détourné ne pourrait rien glisser.
  integrite: "sha512-Kh8r7Q73zLzatMPCf47u7rplr6Y38/0ugyICmtB7YGbMC1ndh3odgXm393hlEq+fehv5hdI/cDp161+xWDaiEg==",
};
export const META_VUE = {
  ui: {
    csp: {
      resourceDomains: ["https://cdnjs.cloudflare.com"],
      connectDomains: ["https://paulrosen.github.io"],
    },
    prefersBorder: true,
  },
};

/** L'entrée de resources/list. */
export const RESSOURCE_VUE = {
  uri: URI_VUE,
  name: "partition",
  title: "Partition jouable",
  description: "Une partition de la bibliothèque Portée, gravée et jouable au piano (abcjs).",
  mimeType: TYPE_VUE,
  _meta: META_VUE,
};

// Les icônes de l'appli (app/icones.js), au trait, de la couleur du texte.
const ICONE_LIRE = '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>';
const ICONE_STOP = '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>';

export const HTML_VUE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Portée — partition</title>
<style>
  /* Les jetons de l'hôte d'abord (ils suivent son clair ou sombre), les nôtres à défaut. */
  :root {
    color-scheme: light dark;
    --texte: var(--color-text-primary, CanvasText);
    --texte-doux: var(--color-text-secondary, color-mix(in srgb, CanvasText 65%, transparent));
    --danger: var(--color-text-danger, #c0392b);
    --bord: var(--color-border-primary, color-mix(in srgb, CanvasText 22%, transparent));
    --fond-bouton: var(--color-background-secondary, color-mix(in srgb, CanvasText 6%, transparent));
    --accent: var(--color-ring-primary, #2f6fd6);
    --police: var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
    --rayon: var(--border-radius-md, 10px);
  }
  html, body { margin: 0; background: transparent; color: var(--texte); font-family: var(--police); }
  main { padding: 12px 16px 16px; box-sizing: border-box; }
  .tete { display: flex; align-items: center; gap: 12px; }
  h1 { margin: 0; font-size: var(--font-heading-sm-size, 1.05rem); line-height: 1.3; font-weight: var(--font-weight-semibold, 600); }
  .infos { color: var(--texte-doux); font-size: var(--font-text-sm-size, 0.875rem); }
  button {
    min-width: 44px; min-height: 44px; padding: 0 16px; flex: none;
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: 1px solid var(--bord); border-radius: var(--border-radius-full, 999px);
    background: var(--fond-bouton); color: var(--texte); font: inherit; cursor: pointer;
  }
  button:disabled { opacity: 0.45; cursor: default; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ico { width: 20px; height: 20px; }
  #etat { min-height: 1.4em; margin: 8px 0 0; color: var(--texte-doux); font-size: var(--font-text-sm-size, 0.875rem); }
  #etat.erreur { color: var(--danger); }
  #partition { margin-top: 4px; color: var(--texte); }
  #partition svg { display: block; max-width: 100%; height: auto; }
  #partition .joue { fill: var(--accent); }
  .squelette { height: 112px; border-radius: var(--rayon); background: color-mix(in srgb, CanvasText 7%, transparent); animation: battre 1.4s ease-in-out infinite; }
  @keyframes battre { 50% { opacity: 0.45; } }
  @media (prefers-reduced-motion: reduce) { .squelette { animation: none; } }
</style>
<script src="${ABCJS.adresse}" integrity="${ABCJS.integrite}" crossorigin="anonymous"></script>
</head>
<body>
<main id="principal">
  <div class="tete">
    <button id="lire" type="button" aria-label="Écouter la partition" disabled><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONE_LIRE}</svg><span>Écouter</span></button>
    <div><h1 id="titre">Partition</h1><div class="infos" id="infos"></div></div>
  </div>
  <p id="etat" role="status" aria-live="polite">Chargement de la partition…</p>
  <div id="partition" class="squelette" role="img" aria-label="Partition"></div>
</main>
<script>
(function () {
  "use strict";
  var ICONES = { lire: '${ICONE_LIRE}', stop: '${ICONE_STOP}' };
  var $ = function (id) { return document.getElementById(id); };
  var hote = window.parent;
  var numero = 0;
  var attentes = {};
  var etat = { id: null, abc: null, visuel: null, synthe: null, minuteur: null, joue: false, outils: false, redemande: false };

  function envoyer(message) { hote.postMessage(message, "*"); }
  function demander(method, params) {
    var id = ++numero;
    envoyer({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (ok, ko) { attentes[id] = { ok: ok, ko: ko }; });
  }
  function notifier(method, params) {
    var m = { jsonrpc: "2.0", method: method };
    if (params) m.params = params;
    envoyer(m);
  }
  function dire(texte, erreur) {
    $("etat").textContent = texte || "";
    $("etat").className = erreur ? "erreur" : "";
  }

  // --- Le contexte de l'hôte : thème, jetons, polices, marges sûres ----------
  function appliquerContexte(c) {
    if (!c) return;
    var racine = document.documentElement;
    if (c.theme === "light" || c.theme === "dark") { racine.style.colorScheme = c.theme; racine.setAttribute("data-theme", c.theme); }
    var v = c.styles && c.styles.variables;
    if (v) Object.keys(v).forEach(function (k) { if (/^--[a-z0-9-]+$/.test(k) && typeof v[k] === "string") racine.style.setProperty(k, v[k]); });
    var polices = c.styles && c.styles.css && c.styles.css.fonts;
    if (typeof polices === "string" && polices) {
      var s = document.getElementById("polices-hote") || document.head.appendChild(document.createElement("style"));
      s.id = "polices-hote";
      s.textContent = polices;
    }
    var m = c.safeAreaInsets;
    if (m) $("principal").style.padding = (12 + (m.top || 0)) + "px " + (16 + (m.right || 0)) + "px " + (16 + (m.bottom || 0)) + "px " + (16 + (m.left || 0)) + "px";
  }

  // --- La hauteur : l'hôte ajuste le cadre, sans défilement dans le cadre ----
  var derniere = { w: 0, h: 0 };
  function direTaille() {
    var w = Math.ceil(window.innerWidth), h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (w === derniere.w && h === derniere.h) return;
    derniere = { w: w, h: h };
    notifier("ui/notifications/size-changed", { width: w, height: h });
  }

  // --- Graver et jouer ----------------------------------------------------------
  function bouton(lecture) {
    var b = $("lire");
    b.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + (lecture ? ICONES.stop : ICONES.lire) + "</svg><span>" + (lecture ? "Arrêter" : "Écouter") + "</span>";
    b.setAttribute("aria-label", lecture ? "Arrêter l'écoute" : "Écouter la partition");
  }

  function arreter() {
    if (etat.minuteur) { try { etat.minuteur.stop(); } catch (e) { /* déjà arrêté */ } etat.minuteur = null; }
    if (etat.synthe) { try { etat.synthe.stop(); } catch (e) { /* déjà arrêté */ } }
    marquer(null);
    etat.joue = false;
    bouton(false);
  }

  var marquees = [];
  function marquer(elements) {
    marquees.forEach(function (el) { el.classList.remove("joue"); });
    marquees = [];
    (elements || []).forEach(function (groupe) { (groupe || []).forEach(function (el) { el.classList.add("joue"); marquees.push(el); }); });
  }

  function afficher(r) {
    var p = r || {};
    if (!window.ABCJS) { dire("La partition n'a pas pu se charger (abcjs ne répond pas).", true); return; }
    if (!p.abc) { dire("Cette partition n'a pas encore de notes à graver.", true); return; }
    arreter();
    etat.abc = p.abc;
    $("titre").textContent = p.titre || "Partition";
    $("infos").textContent = [p.type === "idee" ? "Idée" : p.type === "page" ? "Page manuscrite" : "", p.tempo ? p.tempo + " à la noire" : "", p.mesure || "", p.tonalite || ""].filter(Boolean).join(" · ");
    var zone = $("partition");
    zone.className = "";
    zone.setAttribute("aria-label", "Partition de « " + (p.titre || "sans titre") + " »");
    try {
      // Le titre est déjà en tête de la carte : la gravure ne le redit pas.
      var sansTitre = p.abc.split("\\n").filter(function (l) { return l.indexOf("T:") !== 0; }).join("\\n");
      etat.visuel = window.ABCJS.renderAbc("partition", sansTitre, { responsive: "resize", add_classes: true, paddingleft: 0, paddingright: 0, paddingbottom: 8 })[0];
    } catch (e) {
      dire("Cette partition ne se grave pas : " + (e && e.message ? e.message : e), true);
      return;
    }
    var audio = window.ABCJS.synth && window.ABCJS.synth.supportsAudio();
    $("lire").disabled = !audio;
    dire(audio ? "" : "Ce navigateur ne sait pas jouer la partition.");
    direTaille();
  }

  function ecouter() {
    if (etat.joue) { arreter(); return; }
    if (!etat.visuel) return;
    var Contexte = window.AudioContext || window.webkitAudioContext;
    var contexte = new Contexte();
    etat.joue = true;
    bouton(true);
    dire("Le piano se prépare…");
    etat.synthe = new window.ABCJS.synth.CreateSynth();
    contexte.resume().then(function () {
      return etat.synthe.init({ audioContext: contexte, visualObj: etat.visuel, options: { program: 0 } });
    }).then(function () {
      return etat.synthe.prime();
    }).then(function () {
      if (!etat.joue) return;
      dire("");
      etat.synthe.start();
      etat.minuteur = new window.ABCJS.TimingCallbacks(etat.visuel, {
        eventCallback: function (ev) {
          if (!ev) { arreter(); return; } // la fin
          marquer(ev.elements);
        },
      });
      etat.minuteur.start();
    }).catch(function (e) {
      arreter();
      dire("Le piano n'a pas pu jouer : " + (e && e.message ? e.message : "son indisponible") + ".", true);
    });
  }
  $("lire").addEventListener("click", ecouter);

  // Le résultat de l'outil, ou sa redemande à l'outil par l'hôte.
  function resultat(r) {
    if (!r) return;
    if (r.isError) {
      var t = (r.content || []).filter(function (c) { return c && c.type === "text"; }).map(function (c) { return c.text; }).join(" ");
      $("partition").className = "";
      dire(t || "La partition n'a pas pu être lue.", true);
      direTaille();
      return;
    }
    var s = r.structuredContent;
    if (s && s.abc) { afficher(s); return; }
    if (etat.id && etat.outils && !etat.redemande) {
      etat.redemande = true;
      demander("tools/call", { name: "partition_montrer", arguments: { id: etat.id } }).then(resultat, function () {
        dire("La partition n'a pas pu être lue.", true);
      });
      return;
    }
    dire("La partition n'est pas arrivée.", true);
  }

  // --- Les messages de l'hôte -----------------------------------------------------
  window.addEventListener("message", function (ev) {
    if (ev.source !== hote) return; // rien d'autre que l'hôte ne parle à la page
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.method === undefined && m.id !== undefined) {
      var a = attentes[m.id];
      if (!a) return;
      delete attentes[m.id];
      if (m.error) a.ko(m.error); else a.ok(m.result);
      return;
    }
    if (m.id !== undefined) {
      if (m.method === "ping") envoyer({ jsonrpc: "2.0", id: m.id, result: {} });
      else if (m.method === "ui/resource-teardown") { arreter(); envoyer({ jsonrpc: "2.0", id: m.id, result: {} }); }
      else envoyer({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Méthode inconnue : " + m.method } });
      return;
    }
    var p = m.params || {};
    if (m.method === "ui/notifications/tool-input") {
      etat.id = p.arguments && typeof p.arguments.id === "string" ? p.arguments.id : null;
      dire("Lecture de la partition…");
    } else if (m.method === "ui/notifications/tool-result") {
      resultat(p);
    } else if (m.method === "ui/notifications/tool-cancelled") {
      $("partition").className = "";
      dire("L'affichage a été annulé.", true);
      direTaille();
    } else if (m.method === "ui/notifications/host-context-changed") {
      appliquerContexte(p);
    }
  });

  // --- La poignée de main ---------------------------------------------------------
  demander("ui/initialize", {
    appInfo: { name: "Portée — partition", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: "2026-01-26",
  }).then(function (r) {
    etat.outils = !!(r && r.hostCapabilities && r.hostCapabilities.serverTools);
    appliquerContexte(r && r.hostContext);
    notifier("ui/notifications/initialized");
    direTaille();
    if (window.ResizeObserver) new ResizeObserver(direTaille).observe(document.body);
  }, function () {
    dire("L'hôte n'a pas ouvert la conversation avec la partition.", true);
  });
})();
</script>
</body>
</html>
`;
