/**
 * LES EXPORTS : MIDI, MusicXML, ABC, « Tout en MIDI », le partage
 *
 * Une idée part de ses notes, un morceau de ses blocs assemblés, une page
 * lue de son ABC joué en notes (avec le tempo et la transposition choisis
 * à l'écoute). Les trois sortent par le même écrivain MIDI (midi.js) et le
 * même écrivain MusicXML (musicxml.js), pour MuseScore, Live ou GarageBand.
 *
 * Sur claude.ai, les téléchargements suivent une liste fermée de formats,
 * sans .mid ni .musicxml : ils partent dans un .zip (zip.js).
 *
 * Une seule gestion des erreurs (audit du 04/10, T3) : chaque export était
 * écrit avec la sienne, et « Tout en MIDI » fabriquait ses fichiers hors de
 * la sienne (une partition illisible y devenait une erreur sans message).
 * Un téléchargement refusé sur claude.ai (`declined`) n'en est pas une.
 */
import { zipper } from "./zip.js";
import { midiDeLaPage, midiDeLIdee } from "./midi.js";
import { ecrireMusicXml, musicXmlDeLaPage } from "./musicxml.js";
import { midiDuMorceau, musicXmlDuMorceau } from "./morceau.js";
import { voixCompletes } from "./harmonie.js";
import { echec } from "./erreurs.js";
import { toast } from "./ui.js";

const SANS_ABCJS = "abcjs n'a pas pu se charger (connexion ?).";

/** Un nom de fichier tiré du titre : sans les caractères que refusent Windows ou macOS. */
export const nomDeFichier = (p) => (p.titre || "").replace(/[\\/:*?"<>|]+/g, " ").trim() || "partition";

/**
 * @param deps {
 *   stockage() → le stockage ouvert (enregistrerFichier, midiDirect),
 *   partitions() → la bibliothèque, idees() → les idées par identifiant (pour les morceaux),
 *   abcjs() → window.ABCJS, dansClaude() → vrai dans la page claude.ai
 * }
 */
export function creerExports({ stockage, partitions, idees, abcjs, dansClaude }) {
  /**
   * Fabrique puis enregistre un fichier ; toute erreur, d'un côté comme de
   * l'autre, devient un message qui dit quoi faire.
   * @param {string} quoi  « L'export MIDI »… (ce qui n'a pas abouti)
   * @param {() => { nom: string, contenu: any }} fabriquer
   */
  async function exporter(quoi, fabriquer) {
    try {
      const { nom, contenu } = fabriquer();
      await stockage().enregistrerFichier(nom, contenu);
    } catch (e) {
      if (e && e.code === "declined") return;
      console.error(e);
      toast(echec(quoi, e));
    }
  }

  /** Le fichier, tel quel sur le site ; dans un .zip sur claude.ai. */
  const direct = (nom, octets, type, format) => (stockage().midiDirect
    ? { nom, contenu: new Blob([octets], { type }) }
    : { nom: nom.replace(/\.[^.]+$/, ` (${format}).zip`), contenu: zipper([{ nom, donnees: octets }]) });

  /**
   * Le MIDI de n'importe quelle partition : une idée part de ses notes, un
   * morceau de ses blocs, une page lue de son ABC (une piste par main,
   * tempo, transposition et changements de la page compris, par le même
   * écrivain que les idées : abcjs écrivait des pistes sans nom).
   */
  function midiDePartition(p, reglages = {}) {
    if (p.type === "idee") return midiDeLIdee(p);
    if (p.type === "morceau") return midiDuMorceau(p, idees());
    return midiDeLaPage(p.abc, abcjs(), { tempo: reglages.tempo ?? p.tempo, transposition: reglages.transposition ?? p.transposition ?? 0, titre: p.titre });
  }

  /** Télécharge le .mid (dans un .zip sur claude.ai, dont la liste des formats ignore .mid). */
  function exporterMidi(p, reglages = {}) {
    if (!p.type && !abcjs()) { toast(SANS_ABCJS); return Promise.resolve(); }
    return exporter("L'export MIDI", () => direct(`${nomDeFichier(p)}.mid`, midiDePartition(p, reglages), "audio/midi", "MIDI"));
  }

  /** Toutes les partitions en MIDI, dans un seul .zip (deux titres pareils ne s'écrasent pas). */
  function toutEnMidi() {
    if (!abcjs() && partitions().some((p) => !p.type)) { toast(SANS_ABCJS); return Promise.resolve(); }
    return exporter("L'export", () => {
      const pris = new Set();
      const fichiers = partitions().map((p) => {
        let nom = nomDeFichier(p), n = 2;
        while (pris.has(nom)) nom = `${nomDeFichier(p)} (${n++})`;
        pris.add(nom);
        return { nom: `${nom}.mid`, donnees: midiDePartition(p) };
      });
      return { nom: "Portée - MIDI.zip", contenu: zipper(fichiers) };
    });
  }

  /**
   * Envoie le MIDI là où on veut (AirDrop, Fichiers, mail…) avec le partage
   * du téléphone ; sinon (ordinateur, claude.ai), le télécharge.
   */
  async function partagerMidi(p) {
    try {
      const fichier = new File([midiDePartition(p)], `${nomDeFichier(p)}.mid`, { type: "audio/midi" });
      if (!dansClaude() && navigator.canShare && navigator.canShare({ files: [fichier] })) {
        await navigator.share({ files: [fichier], title: p.titre });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
      console.warn("Partage impossible, téléchargement à la place", e);
    }
    await exporterMidi(p);
  }

  /**
   * Le MusicXML (MuseScore) : une idée part de ses notes, un morceau de ses
   * blocs assemblés (comme pour le MIDI), une page lue de son ABC joué en
   * notes, avec la transposition choisie à l'écoute (le MIDI la prenait, le
   * MusicXML l'oubliait). Sur claude.ai, dans un .zip (liste fermée des formats).
   */
  function exporterMusicXml(p) {
    if (!p.type && !abcjs()) { toast(SANS_ABCJS); return Promise.resolve(); }
    return exporter("L'export MusicXML", () => {
      let texte;
      if (p.type === "idee") texte = ecrireMusicXml(p.sequence, { voix: voixCompletes(p.sequence), titre: p.titre });
      else if (p.type === "morceau") texte = musicXmlDuMorceau(p, idees());
      else texte = musicXmlDeLaPage(p.abc, abcjs(), { tempo: p.tempo, transposition: p.transposition || 0, titre: p.titre });
      return direct(`${nomDeFichier(p)}.musicxml`, new TextEncoder().encode(texte), "application/vnd.recordare.musicxml+xml", "MusicXML");
    });
  }

  /** Le texte ABC d'une page lue (« Autres formats »). */
  function exporterAbc(p) {
    return exporter("L'export", () => ({ nom: `${nomDeFichier(p)}.txt`, contenu: p.abc }));
  }

  return { midiDePartition, exporterMidi, toutEnMidi, partagerMidi, exporterMusicXml, exporterAbc };
}
