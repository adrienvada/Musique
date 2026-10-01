/**
 * Chanter une note : la hauteur se lit sur des sons fabriqués (sinus,
 * sons riches en harmoniques comme la voix, vibrato), et le bruit n'en
 * donne aucune.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detecterHauteur, midiDe } from "../app/micro.js";

const SR = 48000;
function son(f, { duree = 2048, harmoniques = [1], vibrato = 0, bruit = 0, graine = 1 } = {}) {
  let x = graine;
  const hasard = () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const t = new Float32Array(duree);
  let phase = 0;
  for (let i = 0; i < duree; i++) {
    const fi = f * (1 + vibrato * Math.sin((2 * Math.PI * 5.5 * i) / SR));
    phase += (2 * Math.PI * fi) / SR;
    let v = 0;
    harmoniques.forEach((a, k) => { v += a * Math.sin((k + 1) * phase); });
    t[i] = 0.3 * v + bruit * hasard();
  }
  return t;
}

test("sinus : la fréquence au demi-centième près, de la basse à la soprano", () => {
  for (const f of [82.41, 110, 196, 261.63, 440, 659.25, 987.77]) {
    const r = detecterHauteur(son(f), SR);
    assert.ok(r, `${f} Hz`);
    assert.ok(Math.abs(midiDe(r.hz) - midiDe(f)) < 0.05, `${f} Hz → ${r.hz}`);
    assert.ok(r.clarte > 0.9);
  }
});

test("une voix (harmoniques fortes, fondamentale faible) : la bonne octave", () => {
  // Une voix d'homme sur un la2 : le 2e et le 3e harmonique plus forts que la fondamentale.
  const r = detecterHauteur(son(110, { harmoniques: [0.4, 1, 0.8, 0.5, 0.3, 0.2] }), SR);
  assert.equal(Math.round(midiDe(r.hz)), 45);
  // Un sol4 chanté avec du vibrato et un peu de souffle.
  const v = detecterHauteur(son(392, { harmoniques: [1, 0.6, 0.3], vibrato: 0.012, bruit: 0.03 }), SR);
  assert.equal(Math.round(midiDe(v.hz)), 67);
  // Le même son à 44,1 kHz.
  const t = new Float32Array(2048);
  for (let i = 0; i < t.length; i++) t[i] = 0.3 * Math.sin((2 * Math.PI * 293.66 * i) / 44100);
  assert.equal(Math.round(midiDe(detecterHauteur(t, 44100).hz)), 62);
});

test("silence et bruit : pas de note", () => {
  assert.equal(detecterHauteur(new Float32Array(2048), SR), null);
  const bruit = son(440, { harmoniques: [0], bruit: 0.5, graine: 7 });
  const r = detecterHauteur(bruit, SR);
  assert.ok(r === null || r.clarte < 0.8, JSON.stringify(r));
});
