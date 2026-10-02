/**
 * LES PRÉFÉRENCES DE CET APPAREIL
 *
 * Ce qui tient à l'appareil plutôt qu'à une partition (l'ambiance de
 * l'éditeur, l'affichage choisi, le clavier MIDI branché…) se garde dans
 * le stockage local du navigateur. Il peut manquer (navigation privée,
 * page claude.ai qui le refuse) : chaque préférence a donc une valeur par
 * défaut, et rien ne casse sans elle.
 */
export const lirePref = (cle) => { try { return localStorage.getItem(cle); } catch { return null; } };
export const ecrirePref = (cle, valeur) => { try { localStorage.setItem(cle, valeur); } catch { /* facultatif */ } };

/** L'éditeur d'idée en ambiance Studio (sombre), sauf si l'on a choisi Papier. */
export const ambianceStudio = () => lirePref("portee:ambiance") !== "papier";
