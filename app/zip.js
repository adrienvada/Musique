/**
 * Un .zip minimal (fichiers stockés sans compression).
 *
 * POURQUOI. Sur claude.ai, une page ne peut proposer au téléchargement
 * qu'une liste fermée de formats, où .mid ne figure pas. Le fichier MIDI
 * part donc dans un .zip : un double-clic l'en sort, prêt pour Ableton.
 */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(octets) {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) c = TABLE[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipper(fichiers) {
  const enc = new TextEncoder();
  const morceaux = [], central = [];
  let decalage = 0;
  for (const { nom, donnees } of fichiers) {
    const n = enc.encode(nom);
    const crc = crc32(donnees);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // noms en UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, donnees.length, true);
    local.setUint32(22, donnees.length, true);
    local.setUint16(26, n.length, true);
    morceaux.push(new Uint8Array(local.buffer), n, donnees);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, donnees.length, true);
    c.setUint32(24, donnees.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, decalage, true);
    central.push(new Uint8Array(c.buffer), n);
    decalage += 30 + n.length + donnees.length;
  }
  const tailleCentral = central.reduce((a, b) => a + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, fichiers.length, true);
  fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCentral, true);
  fin.setUint32(16, decalage, true);
  const tout = [...morceaux, ...central, new Uint8Array(fin.buffer)];
  const sortie = new Uint8Array(tout.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const m of tout) { sortie.set(m, o); o += m.length; }
  return sortie;
}
