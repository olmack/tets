'use strict';
// Décodeur QR minimal utilisé uniquement par les tests : vérifie les codes de format,
// les syndromes Reed-Solomon (aucune erreur tolérée) et relit le texte en mode octet.
const { functionPatterns, blockLayout, gfMul, REMAINDER_BITS } = require('../server/qrcode');

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function bch15(data) {
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function decodeMatrix(m) {
  const size = m.length;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 10) throw new Error(`taille invalide ${size}`);
  // Format : première copie (autour du repère haut-gauche)
  let raw = 0;
  const bitsAt = [];
  for (let i = 0; i <= 5; i++) bitsAt.push([8, i]);
  bitsAt.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) bitsAt.push([14 - i, 8]);
  bitsAt.forEach(([x, y], i) => { if (m[y][x]) raw |= 1 << i; });
  let raw2 = 0;
  for (let i = 0; i < 8; i++) if (m[8][size - 1 - i]) raw2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (m[size - 15 + i][8]) raw2 |= 1 << i;
  if (raw !== raw2) throw new Error('les deux copies du format diffèrent');
  let fmt = -1;
  for (let d = 0; d < 32; d++) if (bch15(d) === raw) fmt = d;
  if (fmt < 0) throw new Error('code de format invalide');
  const ecl = fmt >> 3;
  const mask = fmt & 7;
  if (ecl !== 0) throw new Error('niveau de correction inattendu');

  const { isFunction } = functionPatterns(version);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x]) bits.push(m[y][x] !== MASKS[mask](x, y) ? 1 : 0);
      }
    }
  }
  const { ecLen, blocks } = blockLayout(version);
  const total = blocks.reduce((a, b) => a + b + ecLen, 0);
  // Nombre total de mots de code selon la norme (indépendant des tables du générateur)
  if (total !== [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346][version]) throw new Error('table des blocs incohérente');
  if (bits.length !== total * 8 + REMAINDER_BITS[version]) throw new Error(`nombre de bits ${bits.length} ≠ ${total * 8 + REMAINDER_BITS[version]}`);
  const cw = [];
  for (let i = 0; i < total; i++) cw.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2));
  // Désentrelacement
  const blk = blocks.map((len) => ({ data: [], ecc: [], len }));
  let k = 0;
  const maxLen = Math.max(...blocks);
  for (let i = 0; i < maxLen; i++) for (const b of blk) if (i < b.len) b.data.push(cw[k++]);
  for (let i = 0; i < ecLen; i++) for (const b of blk) b.ecc.push(cw[k++]);
  // Syndromes : le polynôme (données + correction) doit s'annuler en α^0 … α^(ecLen-1)
  for (const b of blk) {
    const poly = [...b.data, ...b.ecc];
    let alpha = 1;
    for (let i = 0; i < ecLen; i++) {
      let acc = 0;
      for (const c of poly) acc = gfMul(acc, alpha) ^ c;
      if (acc !== 0) throw new Error('syndrome Reed-Solomon non nul');
      alpha = gfMul(alpha, 2);
    }
  }
  const data = blk.flatMap((b) => b.data);
  const dbits = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (byte >> s) & 1));
  let p = 0;
  const read = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | dbits[p++]; return v; };
  if (read(4) !== 0b0100) throw new Error('mode inattendu');
  const len = read(version < 10 ? 8 : 16);
  const out = [];
  for (let i = 0; i < len; i++) out.push(read(8));
  return Buffer.from(out).toString('utf8');
}

module.exports = { decodeMatrix };
