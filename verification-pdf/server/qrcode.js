'use strict';
// Générateur de QR code (sans dépendance) : mode octet, correction d'erreur M, versions 1 à 10.
// Suffisant pour une URL de vérification (jusqu'à 213 octets).

// Par version : [codes de correction par bloc, [nb blocs, octets de données par bloc], ...]
const BLOCKS_M = [
  null,
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
const ECL_M_FORMAT_BITS = 0; // L=1, M=0, Q=3, H=2

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

function blockLayout(version) {
  const [ecLen, ...groups] = BLOCKS_M[version];
  const blocks = [];
  for (const [count, dataLen] of groups) for (let i = 0; i < count; i++) blocks.push(dataLen);
  return { ecLen, blocks, dataCapacity: blocks.reduce((a, b) => a + b, 0) };
}

function encodeData(bytes, version) {
  const { dataCapacity } = blockLayout(version);
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); // mode octet
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capBits = dataCapacity * 8;
  put(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < dataCapacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function addEcc(data, version) {
  const { ecLen, blocks } = blockLayout(version);
  const divisor = rsDivisor(ecLen);
  const dataBlocks = [];
  const eccBlocks = [];
  let k = 0;
  for (const len of blocks) {
    const d = data.slice(k, k + len);
    k += len;
    dataBlocks.push(d);
    eccBlocks.push(rsRemainder(d, divisor));
  }
  const out = [];
  const maxLen = Math.max(...blocks);
  for (let i = 0; i < maxLen; i++) for (const d of dataBlocks) if (i < d.length) out.push(d[i]);
  for (let i = 0; i < ecLen; i++) for (const e of eccBlocks) out.push(e[i]);
  return out;
}

// Construit la matrice des motifs fixes ; renvoie { size, modules, isFunction }
function functionPatterns(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx; const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  const pos = ALIGN[version];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormat(modules, isFunction, 0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3); const b = Math.floor(i / 3);
      set(a, b, bit); set(b, a, bit);
    }
  }
  return { size, modules, isFunction };
}

function formatBits(mask) {
  const data = (ECL_M_FORMAT_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(modules, isFunction, mask) {
  const size = modules.length;
  const bits = formatBits(mask);
  const set = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

function placeData(modules, isFunction, codewords) {
  const size = modules.length;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

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

function applyMask(modules, isFunction, mask) {
  const size = modules.length;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFunction[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
}

// Pénalités de la norme (règles 1 à 4) pour choisir le masque le plus lisible
function penalty(m) {
  const size = m.length;
  let score = 0;
  const lines = [];
  for (let y = 0; y < size; y++) lines.push(m[y]);
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else { if (run >= 5) score += run - 2; run = 1; }
    }
    const s = line.map((v) => (v ? '1' : '0')).join('');
    for (const pat of ['10111010000', '00001011101']) {
      for (let k = s.indexOf(pat); k !== -1; k = s.indexOf(pat, k + 1)) score += 40;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  }
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

// Renvoie { size, version, modules } où modules[y][x] === true pour un module noir
function encodeQr(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const ccBits = v < 10 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= blockLayout(v).dataCapacity * 8) { version = v; break; }
  }
  if (!version) throw new Error('Texte trop long pour le QR code (213 octets maximum).');
  const codewords = addEcc(encodeData(bytes, version), version);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const { size, modules, isFunction } = functionPatterns(version);
    placeData(modules, isFunction, codewords);
    applyMask(modules, isFunction, mask);
    drawFormat(modules, isFunction, mask);
    const score = penalty(modules);
    if (!best || score < best.score) best = { score, size, version, mask, modules };
  }
  return { size: best.size, version: best.version, mask: best.mask, modules: best.modules };
}

// QR code en SVG (pour l'affichage dans l'administration)
function qrSvg(text, { scale = 4, margin = 4 } = {}) {
  const { size, modules } = encodeQr(text);
  const dim = (size + margin * 2) * scale;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) path += `M${(x + margin) * scale},${(y + margin) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

module.exports = { encodeQr, qrSvg, functionPatterns, blockLayout, gfMul, REMAINDER_BITS };
