/**
 * VERS UN AUTRE LOGICIEL : LA SORTIE MIDI (audit du 04/10, M10)
 *
 * Ce que joue le transport (une idée, un morceau, une page lue) part aussi,
 * note à note, vers un port MIDI de l'ordinateur ; dans Live, une piste MIDI
 * qui écoute ce port le joue avec son propre son. Sur Mac, le port est le
 * « Gestionnaire IAC » (Configuration audio et MIDI › Studio MIDI) ; sur
 * Windows, un port créé avec loopMIDI. Chrome et Edge sur ordinateur
 * seulement : sur le téléphone et dans claude.ai, rien ne se montre.
 *
 * Les notes arrivent du transport un peu d'avance, avec l'instant où le
 * piano de Portée les jouerait, et partent horodatées (send(octets,
 * instant)) : le pilote MIDI les tient à l'heure, quoi que fasse la page.
 * Mais un message parti ne se rattrape pas (MIDIOutput.clear() n'existe pas
 * dans Chrome) : on n'envoie que ce qui tombe dans les 100 ms à venir. À
 * l'arrêt, ce qui n'est pas parti ne part pas, et tout s'éteint après le
 * dernier message parti (note par note, puis « All Notes Off »).
 *
 * IAC et loopMIDI sont à la fois une sortie et une entrée du même nom :
 * l'entrée renverrait à Portée ses propres notes, que le clavier écrirait
 * dans l'idée. idee-clavier.js ignore donc l'entrée de ce nom (enBoucle).
 */
import { lirePref, ecrirePref } from "./preferences.js";

/** On n'envoie que ce qui tombe dans les 100 ms à venir (en secondes, sur l'horloge du son). */
export const HORIZON = 0.1;
/** Le port choisi sur cet appareil : { id, nom }. */
const CLE = "portee:sortie-midi";
/** Le piano de Portée se tait quand la sortie joue : "1". */
const CLE_MUET = "portee:sortie-midi-muet";
/** Canal 1 : une piste de Live, réglée sur « All Channels » ou « Ch. 1 », reçoit tout. */
const CANAL = 0;

/** Chrome ou Edge sur ordinateur, hors d'un cadre (claude.ai) : la sortie MIDI s'y propose. */
export function sortieMidiPossible(g = globalThis) {
  const nav = g.navigator;
  return !!(nav && typeof nav.requestMIDIAccess === "function" && nav.userAgentData && nav.userAgentData.mobile === false && g.top === g.self);
}

/** Le port choisi la dernière fois sur cet appareil, ou null. */
export function portRetenu() {
  try { return JSON.parse(lirePref(CLE) || "null"); } catch { return null; }
}

/** Une entrée MIDI qui porte le nom de notre sortie : ce qu'elle dit, c'est nous. */
export function enBoucle(entree) {
  const p = portRetenu();
  return !!(p && p.nom && entree && entree.name === p.nom);
}

const force = (v) => Math.max(1, Math.min(127, Math.round(v || 90)));

export class SortieMidi {
  /**
   * @param o { acces() → Promise<MIDIAccess> (navigator.requestMIDIAccess),
   *            maintenant() → l'heure de la page (performance.now) }
   */
  constructor({ acces = () => navigator.requestMIDIAccess(), maintenant = () => performance.now() } = {}) {
    this.demanderAcces = acces;
    this.maintenant = maintenant;
    this.acces = null;
    this.port = null;
    this.file = []; // { t, on, h, v, note } sur l'horloge du son, pas encore envoyés
    this.allumees = new Map(); // hauteur → les notes qui la tiennent (une voix d'accords, la mélodie)
    this.dernierEnvoi = -Infinity; // l'heure de la page du dernier message parti
    /** Appelé quand le port change, se débranche ou revient (l'écran des réglages). */
    this.surEtat = () => {};
  }

  /** Un port choisi et branché : le transport lui envoie ce qu'il joue. */
  get active() { return !!(this.port && this.port.state !== "disconnected"); }
  /** Le réglage « piano de Portée muet », tel qu'il est choisi. */
  get muetVoulu() { return lirePref(CLE_MUET) === "1"; }
  set muetVoulu(oui) { ecrirePref(CLE_MUET, oui ? "1" : "0"); }
  /** Le piano se tait seulement si la sortie joue vraiment : un port débranché ne rend pas Portée muette. */
  get pianoMuet() { return this.active && this.muetVoulu; }
  /** Le nom du port choisi (même débranché), ou null. */
  get nom() { return this.port ? this.port.name : (portRetenu() || {}).nom || null; }

  async ouvrir() {
    if (this.acces) return this.acces;
    const a = await this.demanderAcces();
    if (this.acces) return this.acces;
    this.acces = a;
    // Un port qui se débranche (Live fermé ne ferme pas IAC, mais un câble, loopMIDI…) ou revient.
    const suivre = () => this.retrouver();
    if (typeof a.addEventListener === "function") a.addEventListener("statechange", suivre);
    else a.onstatechange = suivre;
    return a;
  }

  /** Les sorties MIDI de l'ordinateur : [{ id, nom }]. */
  async ports() {
    const a = await this.ouvrir();
    return [...a.outputs.values()].filter((o) => o.state !== "disconnected").map((o) => ({ id: o.id, nom: o.name }));
  }

  /** Au démarrage : le port choisi la dernière fois, s'il est là (l'accès a déjà été donné, rien n'est demandé). */
  async rebrancher() {
    if (!portRetenu()) return false;
    try { await this.ouvrir(); } catch { return false; }
    this.retrouver();
    return this.active;
  }

  /** Retrouve le port retenu parmi les sorties (son identifiant, ou à défaut son nom). */
  retrouver() {
    const voulu = portRetenu();
    const sorties = this.acces ? [...this.acces.outputs.values()] : [];
    const o = voulu ? sorties.find((x) => x.id === voulu.id) || sorties.find((x) => x.name === voulu.nom) || null : null;
    const branche = o && o.state !== "disconnected" ? o : null;
    if (branche !== this.port) {
      // Un port qui vient de partir n'entend plus rien : on oublie ce qu'il tenait.
      if (this.active) this.toutEteindre();
      this.file = [];
      this.allumees.clear();
      this.port = branche;
    }
    this.surEtat();
  }

  /** Choisit la sortie (son identifiant), ou aucune (null). */
  async choisir(id) {
    this.toutEteindre();
    if (!id) {
      ecrirePref(CLE, "");
      this.port = null;
      this.surEtat();
      return;
    }
    const a = await this.ouvrir();
    const o = [...a.outputs.values()].find((x) => x.id === id);
    if (!o) throw new Error("Ce port MIDI n'est plus branché.");
    ecrirePref(CLE, JSON.stringify({ id: o.id, nom: o.name }));
    this.port = o;
    // Ouvert tout de suite plutôt qu'au premier message : la première note ne part pas en retard.
    try { const r = o.open && o.open(); if (r && r.catch) r.catch(() => {}); } catch { /* il s'ouvrira au premier envoi */ }
    this.surEtat();
  }

  /** Une note du transport : de `debut` à `fin`, sur l'horloge du son, à la force `v`. */
  programmer(h, debut, fin, v = 90) {
    if (!this.active) return;
    const note = {};
    this.file.push({ t: debut, on: true, h, v, note }, { t: fin, on: false, h, note });
  }

  /**
   * Envoie ce qui tombe d'ici HORIZON (`maintenant` : l'heure du son),
   * horodaté par `versPage` (l'heure du son → l'heure de la page où on
   * l'entendra). `maintenant` = Infinity : tout ce qui reste (la fin
   * naturelle, où la dernière note doit finir).
   */
  pousser(maintenant, versPage) {
    if (!this.active) { this.file = []; this.allumees.clear(); return; }
    if (!this.file.length) return;
    const limite = maintenant + HORIZON;
    // Dans l'ordre du temps ; à égalité, les fins d'abord (une note redite juste après elle-même).
    this.file.sort((a, b) => a.t - b.t || a.on - b.on);
    let i = 0;
    for (; i < this.file.length && this.file[i].t <= limite; i++) {
      const e = this.file[i];
      const quand = versPage(e.t);
      const tenues = this.allumees.get(e.h);
      if (e.on) {
        // La même hauteur déjà tenue (les accords et la mélodie s'y croisent) : on la relance,
        // et elle ne s'éteint qu'avec la dernière des notes qui la tiennent.
        if (tenues && tenues.size) this.envoyer([0x80 | CANAL, e.h, 0], quand);
        if (tenues) tenues.add(e.note); else this.allumees.set(e.h, new Set([e.note]));
        this.envoyer([0x90 | CANAL, e.h, force(e.v)], quand);
      } else if (tenues && tenues.delete(e.note) && !tenues.size) {
        this.allumees.delete(e.h);
        this.envoyer([0x80 | CANAL, e.h, 0], quand);
      }
    }
    if (i) this.file.splice(0, i);
  }

  envoyer(octets, quand) {
    if (!this.port) return;
    try {
      this.port.send(octets, quand);
      if (quand > this.dernierEnvoi) this.dernierEnvoi = quand;
    } catch {
      // Le port a disparu entre-temps : on attend qu'il revienne (statechange).
      this.port = null;
      this.file = [];
      this.allumees.clear();
      this.surEtat();
    }
  }

  /** Arrêt : ce qui n'est pas parti ne part pas, ce qui sonne s'éteint, après le dernier message parti. */
  toutEteindre() {
    this.file = [];
    // Rien ne sonne ni n'est parti d'avance (une écoute finie d'elle-même, une autre qui commence) :
    // pas d'All Notes Off, qui couperait dans Live la fin de la dernière note.
    if (!this.port || !this.allumees.size) { this.allumees.clear(); return; }
    // Une note partie avec un horodatage à venir arriverait sinon après son extinction, et tiendrait.
    const quand = Math.max(this.maintenant(), this.dernierEnvoi + 1);
    try { if (typeof this.port.clear === "function") this.port.clear(); } catch { /* Chrome ne sait pas */ }
    const hauteurs = [...this.allumees.keys()];
    this.allumees.clear();
    for (const h of hauteurs) this.envoyer([0x80 | CANAL, h, 0], quand);
    this.envoyer([0xb0 | CANAL, 123, 0], quand);
  }
}
