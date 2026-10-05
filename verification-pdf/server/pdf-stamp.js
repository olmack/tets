'use strict';
// Ajout d'un QR code de vérification sur un PDF existant, sans dépendance.
// Le fichier d'origine n'est pas réécrit : on ajoute une « mise à jour incrémentale » à la fin
// (nouvelle version des pages concernées + nouveau contenu dessiné par-dessus), comme le font Acrobat
// et les outils de signature. Gère les PDF classiques et les PDF compressés (flux d'objets, xref en flux).
const zlib = require('node:zlib');
const { encodeQr } = require('./qrcode');

class UserError extends Error {}

class Ref { constructor(num, gen) { this.num = num; this.gen = gen; } }
class Name { constructor(name) { this.name = name; } }
class PdfStr { constructor(bytes) { this.bytes = bytes; } }
class Keyword { constructor(word) { this.word = word; } }
class Stream { constructor(dict, raw) { this.dict = dict; this.raw = raw; } }

// ---------- Analyse lexicale ----------

function isWhite(c) { return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0; }
function isDelim(c) { return c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37; }
function isRegular(c) { return !Number.isNaN(c) && !isWhite(c) && !isDelim(c); }

function skipWs(s, i) {
  for (;;) {
    const c = s.charCodeAt(i);
    if (isWhite(c)) { i++; continue; }
    if (c === 37) { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    return i;
  }
}

function readToken(s, i) {
  let j = i;
  while (j < s.length && isRegular(s.charCodeAt(j))) j++;
  return s.slice(i, j);
}

function parseLiteralString(s, i) {
  // s[i] === '('
  const out = [];
  let depth = 1;
  i++;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const n = s[i + 1];
      const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }[n];
      if (esc !== undefined) { out.push(esc); i += 2; continue; }
      if (n >= '0' && n <= '7') {
        let j = i + 1; let oct = '';
        while (j < s.length && oct.length < 3 && s[j] >= '0' && s[j] <= '7') oct += s[j++];
        out.push(parseInt(oct, 8) & 0xff);
        i = j;
        continue;
      }
      if (n === '\r') { i += s[i + 2] === '\n' ? 3 : 2; continue; }
      if (n === '\n') { i += 2; continue; }
      i++; // barre oblique inverse ignorée
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')' && --depth === 0) return [new PdfStr(Buffer.from(out)), i + 1];
    out.push(s.charCodeAt(i));
    i++;
  }
  throw new Error('Chaîne non terminée');
}

function parseValue(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === '<') {
    if (s[i + 1] === '<') {
      i += 2;
      const dict = new Map();
      for (;;) {
        i = skipWs(s, i);
        if (s[i] === '>' && s[i + 1] === '>') return [dict, i + 2];
        if (s[i] !== '/') throw new Error(`Dictionnaire invalide à la position ${i}`);
        const [key, j] = parseValue(s, i);
        const [val, k] = parseValue(s, j);
        if (!(val instanceof Keyword)) dict.set(key.name, val);
        i = k;
      }
    }
    const end = s.indexOf('>', i);
    if (end === -1) throw new Error('Chaîne hexadécimale non terminée');
    let hex = s.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
    if (hex.length % 2) hex += '0';
    return [new PdfStr(Buffer.from(hex, 'hex')), end + 1];
  }
  if (c === '[') {
    i++;
    const arr = [];
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === ']') return [arr, i + 1];
      if (i >= s.length) throw new Error('Tableau non terminé');
      const [val, j] = parseValue(s, i);
      arr.push(val);
      i = j;
    }
  }
  if (c === '(') return parseLiteralString(s, i);
  if (c === '/') {
    let j = i + 1;
    while (j < s.length && isRegular(s.charCodeAt(j))) j++;
    return [new Name(s.slice(i + 1, j)), j];
  }
  const tok = readToken(s, i);
  if (!tok) throw new Error(`Caractère inattendu à la position ${i}`);
  const end = i + tok.length;
  if (tok === 'true') return [true, end];
  if (tok === 'false') return [false, end];
  if (tok === 'null') return [null, end];
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
    if (/^\d+$/.test(tok)) {
      const j = skipWs(s, end);
      const tok2 = readToken(s, j);
      if (/^\d+$/.test(tok2)) {
        const k = skipWs(s, j + tok2.length);
        if (s[k] === 'R' && !isRegular(s.charCodeAt(k + 1))) return [new Ref(Number(tok), Number(tok2)), k + 1];
      }
    }
    return [Number(tok), end];
  }
  return [new Keyword(tok), end];
}

// ---------- Décodage des flux ----------

function inflate(data) {
  try { return zlib.inflateSync(data); } catch { /* flux tronqué : on tente une lecture tolérante */ }
  try { return zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { /* idem */ }
  return zlib.inflateRawSync(data.subarray(2), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
}

function unpredict(data, parms) {
  const predictor = parms instanceof Map ? parms.get('Predictor') || 1 : 1;
  if (predictor < 10) {
    if (predictor === 1) return data;
    throw new Error('Prédicteur TIFF non pris en charge');
  }
  const colors = parms.get('Colors') || 1;
  const bpc = parms.get('BitsPerComponent') || 8;
  const columns = parms.get('Columns') || 1;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = Buffer.alloc(rows * rowLen);
  const prev = Buffer.alloc(rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
    const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
    for (let i = 0; i < rowLen; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (type === 1) v += left;
      else if (type === 2) v += up;
      else if (type === 3) v += (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      cur[i] = v & 0xff;
    }
    cur.copy(prev);
  }
  return out;
}

// ---------- Lecteur PDF ----------

class PdfReader {
  constructor(buf) {
    this.buf = buf;
    this.s = buf.toString('latin1');
    const header = this.s.indexOf('%PDF-');
    if (header === -1 || header > 1024) throw new UserError("Ce fichier n'est pas un PDF valide.");
    this.entries = new Map();
    this.cache = new Map();
    this.objStms = new Map();
    this.trailer = null;
    this.xrefKind = 'table';
    const m = /startxref\s+(\d+)/.exec(this.s.slice(Math.max(0, this.s.lastIndexOf('startxref'))));
    this.startxref = m ? Number(m[1]) : null;
    try {
      if (this.startxref === null) throw new Error('startxref absent');
      this.loadXrefChain();
      if (!(this.trailer && this.trailer.get('Root') instanceof Ref)) throw new Error('Racine absente');
      this.resolve(this.trailer.get('Root')).get('Pages');
    } catch {
      this.reconstruct();
    }
  }

  loadXrefChain() {
    const seen = new Set();
    let off = this.startxref;
    let first = true;
    while (off !== null && !seen.has(off)) {
      seen.add(off);
      const i = skipWs(this.s, off);
      let trailer;
      let kind;
      if (this.s.startsWith('xref', i)) {
        trailer = this.parseXrefTable(i + 4);
        kind = 'table';
        const xs = trailer.get('XRefStm');
        if (typeof xs === 'number') this.parseXrefStream(xs);
      } else {
        trailer = this.parseXrefStream(off);
        kind = 'stream';
      }
      if (first) { this.trailer = trailer; this.xrefKind = kind; first = false; }
      const prev = trailer.get('Prev');
      off = typeof prev === 'number' ? prev : null;
    }
  }

  parseXrefTable(i) {
    const s = this.s;
    for (;;) {
      i = skipWs(s, i);
      if (s.startsWith('trailer', i)) return parseValue(s, i + 7)[0];
      const head = /(\d+)\s+(\d+)/y;
      head.lastIndex = i;
      const m = head.exec(s);
      if (!m) throw new Error('Table xref invalide');
      const start = Number(m[1]);
      const count = Number(m[2]);
      i = head.lastIndex;
      const line = /\s*(\d{1,10})\s+(\d{1,5})\s+([nf])/y;
      for (let k = 0; k < count; k++) {
        line.lastIndex = i;
        const e = line.exec(s);
        if (!e) throw new Error('Entrée xref invalide');
        i = line.lastIndex;
        const num = start + k;
        if (!this.entries.has(num)) this.entries.set(num, e[3] === 'n' ? { type: 1, offset: Number(e[1]), gen: Number(e[2]) } : { type: 0 });
      }
    }
  }

  parseXrefStream(off) {
    const { value: st } = this.parseIndirectAt(off);
    if (!(st instanceof Stream) || st.dict.get('Type')?.name !== 'XRef') throw new Error('Flux xref invalide');
    const d = st.dict;
    const W = d.get('W').map(Number);
    const index = d.get('Index') || [0, d.get('Size')];
    const data = this.decodeStream(st);
    let p = 0;
    const field = (w) => { let v = 0; for (let b = 0; b < w; b++) v = v * 256 + data[p++]; return v; };
    for (let n = 0; n + 1 < index.length; n += 2) {
      for (let k = 0; k < index[n + 1]; k++) {
        if (p >= data.length) break;
        const type = W[0] ? field(W[0]) : 1;
        const f1 = field(W[1]);
        const f2 = field(W[2]);
        const num = index[n] + k;
        if (this.entries.has(num)) continue;
        if (type === 1) this.entries.set(num, { type: 1, offset: f1, gen: f2 });
        else if (type === 2) this.entries.set(num, { type: 2, stm: f1, idx: f2 });
        else this.entries.set(num, { type: 0 });
      }
    }
    return d;
  }

  // Si la table des références est absente ou abîmée : on parcourt tout le fichier
  reconstruct() {
    this.entries = new Map();
    this.cache = new Map();
    this.objStms = new Map();
    const re = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(this.s))) {
      const offset = m.index + m[0].length - m[0].trimStart().length;
      this.entries.set(Number(m[1]), { type: 1, offset, gen: Number(m[2]) });
    }
    const direct = [...this.entries.keys()];
    for (const num of direct) {
      const e = this.entries.get(num);
      if (!/\/ObjStm\b/.test(this.s.slice(e.offset, e.offset + 300))) continue;
      try {
        const parsed = this.loadObjStm(num);
        parsed.pairs.forEach(([n], idx) => { if (!this.entries.has(n)) this.entries.set(n, { type: 2, stm: num, idx }); });
      } catch { /* flux d'objets illisible : ignoré */ }
    }
    let trailer = null;
    const tre = /trailer\s*<</g;
    while ((m = tre.exec(this.s))) {
      try {
        const [d] = parseValue(this.s, m.index + 7);
        if (d.get('Root') instanceof Ref) trailer = d;
      } catch { /* bloc trailer abîmé */ }
    }
    if (!trailer) {
      for (const num of this.entries.keys()) {
        try {
          const v = this.getObject(num);
          const dict = v instanceof Stream ? v.dict : v;
          if (dict instanceof Map && dict.get('Root') instanceof Ref) { trailer = new Map(dict); break; }
        } catch { /* objet illisible */ }
      }
    }
    if (!trailer) {
      for (const [num, e] of this.entries) {
        try {
          const v = this.getObject(num);
          if (v instanceof Map && v.get('Type')?.name === 'Catalog') { trailer = new Map([['Root', new Ref(num, e.gen || 0)]]); break; }
        } catch { /* objet illisible */ }
      }
    }
    if (!trailer) throw new UserError('PDF illisible : structure du document introuvable.');
    for (const k of ['Prev', 'XRefStm', 'Type', 'W', 'Index', 'Length', 'Filter', 'DecodeParms']) trailer.delete(k);
    this.trailer = trailer;
    this.xrefKind = 'table';
    this.reconstructed = true;
  }

  parseIndirectAt(offset) {
    const s = this.s;
    const head = /(\d+)\s+(\d+)\s+obj\b/y;
    head.lastIndex = skipWs(s, offset);
    const m = head.exec(s);
    if (!m) throw new Error(`Objet introuvable à la position ${offset}`);
    const [value, j] = parseValue(s, head.lastIndex);
    const k = skipWs(s, j);
    if (value instanceof Map && s.startsWith('stream', k)) {
      let p = k + 6;
      if (s[p] === '\r') p++;
      if (s[p] === '\n') p++;
      let len = value.get('Length');
      if (len instanceof Ref) { try { len = this.getObject(len.num); } catch { len = null; } }
      let end;
      if (typeof len === 'number' && len >= 0 && s.startsWith('endstream', skipWs(s, p + len))) end = p + len;
      else {
        end = s.indexOf('endstream', p);
        if (end === -1) throw new Error('Flux non terminé');
        if (s[end - 1] === '\n') end--;
        if (s[end - 1] === '\r') end--;
      }
      return { num: Number(m[1]), gen: Number(m[2]), value: new Stream(value, this.buf.subarray(p, end)) };
    }
    return { num: Number(m[1]), gen: Number(m[2]), value: value instanceof Keyword ? null : value };
  }

  decodeStream(st) {
    let filters = this.resolve(st.dict.get('Filter'));
    let parms = this.resolve(st.dict.get('DecodeParms'));
    if (!filters) return st.raw;
    if (!Array.isArray(filters)) { filters = [filters]; parms = [parms]; }
    if (!Array.isArray(parms)) parms = [];
    let data = st.raw;
    filters.forEach((f, i) => {
      const name = this.resolve(f).name;
      if (name !== 'FlateDecode' && name !== 'Fl') throw new Error(`Filtre non pris en charge : ${name}`);
      data = unpredict(inflate(data), this.resolve(parms[i]));
    });
    return data;
  }

  loadObjStm(num) {
    if (this.objStms.has(num)) return this.objStms.get(num);
    const st = this.getObject(num);
    if (!(st instanceof Stream)) throw new Error("Flux d'objets invalide");
    const data = this.decodeStream(st).toString('latin1');
    const n = this.resolve(st.dict.get('N'));
    const first = this.resolve(st.dict.get('First'));
    const pairs = [];
    let pos = 0;
    for (let k = 0; k < n; k++) {
      const [a, p1] = parseValue(data, pos);
      const [b, p2] = parseValue(data, p1);
      pairs.push([a, b]);
      pos = p2;
    }
    const parsed = { data, first, pairs };
    this.objStms.set(num, parsed);
    return parsed;
  }

  getObject(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    const e = this.entries.get(num);
    let value = null;
    if (e && e.type === 1) {
      let o = null;
      try { o = this.parseIndirectAt(e.offset); } catch { /* décalage faux : recherche ci-dessous */ }
      if (!o || o.num !== num) o = this.findObject(num);
      value = o ? o.value : null;
    } else if (e && e.type === 2) {
      const parsed = this.loadObjStm(e.stm);
      let pair = parsed.pairs[e.idx];
      if (!pair || pair[0] !== num) pair = parsed.pairs.find((p) => p[0] === num);
      if (pair) {
        value = parseValue(parsed.data, parsed.first + pair[1])[0];
        if (value instanceof Keyword) value = null;
      }
    }
    this.cache.set(num, value);
    return value;
  }

  findObject(num) {
    const re = new RegExp(`(?:^|[\\r\\n\\s])${num}\\s+\\d+\\s+obj\\b`, 'g');
    let last = null;
    let m;
    while ((m = re.exec(this.s))) last = m.index + m[0].length - m[0].trimStart().length;
    return last === null ? null : this.parseIndirectAt(last);
  }

  resolve(v) {
    for (let depth = 0; v instanceof Ref; depth++) {
      if (depth > 32) throw new Error('Références circulaires');
      v = this.getObject(v.num);
    }
    return v;
  }

  getPages() {
    const root = this.resolve(this.trailer.get('Root'));
    if (!(root instanceof Map)) throw new UserError('PDF illisible : catalogue introuvable.');
    const pages = [];
    const seen = new Set();
    const visit = (ref, node, inherited, depth) => {
      if (!(node instanceof Map) || depth > 64) return;
      const kids = this.resolve(node.get('Kids'));
      if (node.get('Type')?.name !== 'Page' && Array.isArray(kids)) {
        const next = { ...inherited };
        for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) if (node.has(k)) next[k] = node.get(k);
        for (const kid of kids) {
          if (!(kid instanceof Ref) || seen.has(kid.num)) continue;
          seen.add(kid.num);
          visit(kid, this.resolve(kid), next, depth + 1);
        }
      } else if (ref instanceof Ref) {
        pages.push({ ref, dict: node, inherited });
      }
    };
    const pagesRef = root.get('Pages');
    visit(pagesRef, this.resolve(pagesRef), {}, 0);
    return pages;
  }

  maxObjectNumber() {
    let max = 0;
    for (const n of this.entries.keys()) if (n > max) max = n;
    return max;
  }
}

// ---------- Écriture ----------

function fmt(n) {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

function serialize(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return fmt(v);
  if (v instanceof Ref) return `${v.num} ${v.gen} R`;
  if (v instanceof Name) return `/${v.name}`;
  if (v instanceof PdfStr) return `<${v.bytes.toString('hex')}>`;
  if (Array.isArray(v)) return `[${v.map(serialize).join(' ')}]`;
  if (v instanceof Map) return `<<${[...v].map(([k, val]) => `/${k} ${serialize(val)}`).join(' ')}>>`;
  throw new Error('Valeur PDF non sérialisable');
}

// Encodage WinAnsi pour la police Helvetica standard (accents français OK)
function pdfText(str) {
  let out = '';
  for (const ch of String(str)) {
    let code = ch.codePointAt(0);
    if (code > 255) code = 63;
    if (code === 40 || code === 41 || code === 92) out += '\\';
    out += String.fromCharCode(code);
  }
  return out;
}

const HELV = { ' ': 278, '-': 333, '.': 278, ':': 278, '°': 400, 0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, a: 556, b: 556, c: 500, d: 556, e: 556, 'é': 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500 };
function textWidth(str, size) {
  let w = 0;
  for (const ch of String(str)) w += HELV[ch] || 556;
  return (w / 1000) * size;
}

// Matrice qui passe des coordonnées « visuelles » (page telle qu'affichée) à celles du PDF
function visualMatrix(box, rotate) {
  const [x0, y0, x1, y1] = box;
  switch (rotate) {
    case 90: return { m: [0, 1, -1, 0, x1, y0], w: y1 - y0, h: x1 - x0 };
    case 180: return { m: [-1, 0, 0, -1, x1, y1], w: x1 - x0, h: y1 - y0 };
    case 270: return { m: [0, -1, 1, 0, x0, y1], w: y1 - y0, h: x1 - x0 };
    default: return { m: [1, 0, 0, 1, x0, y0], w: x1 - x0, h: y1 - y0 };
  }
}

// Panneau blanc : QR code + « Scannez pour vérifier » + numéro du document
function stampOps(qr, { box, rotate, position, fontName, code, size }) {
  const { m, w, h } = visualMatrix(box, rotate);
  const qrSide = size;
  const unit = qrSide / qr.size;
  const pad = Math.max(6, unit * 4); // zone de silence exigée par la norme
  const textH = 19;
  const panelW = qrSide + pad * 2;
  const panelH = qrSide + pad + Math.max(pad, textH);
  const margin = Math.min(18, w * 0.03, h * 0.03);
  const x = position.endsWith('gauche') ? margin : w - margin - panelW;
  const y = position.startsWith('haut') ? h - margin - panelH : margin;
  const ops = ['q', `${m.map(fmt).join(' ')} cm`, `1 0 0 1 ${fmt(x)} ${fmt(y)} cm`];
  ops.push('1 g 0 0 ' + `${fmt(panelW)} ${fmt(panelH)} re f`);
  ops.push(`0.7 G 0.5 w 0.25 0.25 ${fmt(panelW - 0.5)} ${fmt(panelH - 0.5)} re S`);
  ops.push('0 g');
  const qrBottom = panelH - pad - qrSide;
  for (let r = 0; r < qr.size; r++) {
    const yy = qrBottom + (qr.size - 1 - r) * unit;
    let c = 0;
    while (c < qr.size) {
      if (!qr.modules[r][c]) { c++; continue; }
      let e = c;
      while (e < qr.size && qr.modules[r][e]) e++;
      // léger chevauchement vertical pour éviter les filets blancs à l'affichage
      ops.push(`${fmt(pad + c * unit)} ${fmt(yy - 0.02)} ${fmt((e - c) * unit)} ${fmt(unit + 0.04)} re`);
      c = e;
    }
  }
  ops.push('f');
  const line1 = 'Scannez pour vérifier';
  const line2 = `N° ${code}`;
  const fs1 = 5.6;
  const fs2 = 5.6;
  ops.push(`BT /${fontName} ${fs1} Tf ${fmt((panelW - textWidth(line1, fs1)) / 2)} ${fmt(qrBottom - 7.5)} Td (${pdfText(line1)}) Tj ET`);
  ops.push(`BT /${fontName} ${fs2} Tf ${fmt((panelW - textWidth(line2, fs2)) / 2)} ${fmt(qrBottom - 14.5)} Td (${pdfText(line2)}) Tj ET`);
  ops.push('Q');
  // Position du QR code dans la page affichée (utile pour les tests)
  const geom = { x: x + pad, y: y + qrBottom, side: qrSide, modules: qr.size, pageWidth: w, pageHeight: h };
  return { ops: ops.join('\n'), geom };
}

function numbers(arr, reader) {
  const a = reader.resolve(arr);
  if (!Array.isArray(a) || a.length < 4) return null;
  const n = a.slice(0, 4).map((v) => Number(reader.resolve(v)));
  if (n.some((v) => !Number.isFinite(v))) return null;
  return [Math.min(n[0], n[2]), Math.min(n[1], n[3]), Math.max(n[0], n[2]), Math.max(n[1], n[3])];
}

/**
 * Ajoute le QR code au PDF.
 * @param {Buffer} buf PDF d'origine
 * @param {{url:string, code:string, position?:string, pages?:string, size?:number}} opts
 *   position : 'bas-droite' | 'bas-gauche' | 'haut-droite' | 'haut-gauche'
 *   pages : 'premiere' | 'derniere' | 'toutes'
 * @returns {{pdf: Buffer, pageCount: number, placements: object[]}}
 */
function stampPdf(buf, { url, code, position = 'bas-droite', pages = 'premiere', size = 62 }) {
  const reader = new PdfReader(buf);
  if (reader.trailer.get('Encrypt')) throw new UserError('Ce PDF est protégé (chiffré) : impossible d\'y ajouter le QR code. Enregistrez-le sans protection puis réessayez.');
  const all = reader.getPages();
  if (!all.length) throw new UserError('Aucune page trouvée dans ce PDF.');
  const targets = pages === 'toutes' ? all : pages === 'derniere' ? [all[all.length - 1]] : [all[0]];
  const qr = encodeQr(url);

  let next = Math.max(Number(reader.trailer.get('Size')) || 0, reader.maxObjectNumber() + 1);
  const objects = [];
  const fontNum = next++;
  objects.push({ num: fontNum, gen: 0, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' });
  const streamBody = (data) => `<< /Length ${Buffer.byteLength(data, 'latin1')} >>\nstream\n${data}\nendstream`;
  const preNum = next++;
  objects.push({ num: preNum, gen: 0, body: streamBody('q') });

  const placements = [];
  for (const page of targets) {
    const dict = new Map(page.dict);
    const inh = page.inherited;
    const box = numbers(dict.get('CropBox') ?? inh.CropBox, reader) || numbers(dict.get('MediaBox') ?? inh.MediaBox, reader) || [0, 0, 595.28, 841.89];
    let rotate = Number(reader.resolve(dict.get('Rotate') ?? inh.Rotate)) || 0;
    rotate = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360;

    const res = reader.resolve(dict.get('Resources') ?? inh.Resources);
    const resources = res instanceof Map ? new Map(res) : new Map();
    const f = reader.resolve(resources.get('Font'));
    const fonts = f instanceof Map ? new Map(f) : new Map();
    let fontName = 'VerifQR';
    while (fonts.has(fontName)) fontName += 'x';
    fonts.set(fontName, new Ref(fontNum, 0));
    resources.set('Font', fonts);
    dict.set('Resources', resources);

    let contents = dict.get('Contents');
    if (contents instanceof Ref) {
      const target = reader.resolve(contents);
      contents = Array.isArray(target) ? target : [contents];
    } else if (!Array.isArray(contents)) contents = [];

    const postNum = next++;
    const { ops, geom } = stampOps(qr, { box, rotate, position, fontName, code, size });
    placements.push({ page: all.indexOf(page) + 1, ...geom });
    objects.push({ num: postNum, gen: 0, body: streamBody(`Q\n${ops}`) });
    dict.set('Contents', [new Ref(preNum, 0), ...contents, new Ref(postNum, 0)]);
    objects.push({ num: page.ref.num, gen: page.ref.gen, body: serialize(dict) });
  }

  // ----- Mise à jour incrémentale -----
  const parts = [buf];
  let pos = buf.length;
  const push = (str) => { const b = Buffer.from(str, 'latin1'); parts.push(b); pos += b.length; };
  if (buf[buf.length - 1] !== 0x0a && buf[buf.length - 1] !== 0x0d) push('\n');
  const written = new Map();
  for (const o of objects) {
    written.set(o.num, { type: 1, num: o.num, gen: o.gen, offset: pos });
    push(`${o.num} ${o.gen} obj\n${o.body}\nendobj\n`);
  }

  const trailer = new Map();
  trailer.set('Root', reader.trailer.get('Root'));
  if (reader.trailer.has('Info')) trailer.set('Info', reader.trailer.get('Info'));
  if (reader.trailer.has('ID')) trailer.set('ID', reader.trailer.get('ID'));

  // Normalement, la nouvelle table ne liste que les objets ajoutés et renvoie (/Prev) vers l'ancienne.
  // Si l'ancienne table était abîmée, on écrit une table complète, sans renvoi.
  const full = reader.reconstructed || reader.startxref === null;
  const entries = new Map();
  if (full) {
    entries.set(0, { type: 0, num: 0, gen: 65535 });
    for (const [num, e] of reader.entries) if (e.type === 1 || e.type === 2) entries.set(num, { ...e, num });
  } else {
    trailer.set('Prev', reader.startxref);
  }
  for (const [num, e] of written) entries.set(num, e);
  const useStream = full ? [...entries.values()].some((e) => e.type === 2) : reader.xrefKind === 'stream';

  const groups = (list) => {
    const sorted = [...list].sort((a, b) => a.num - b.num);
    const out = [];
    for (const e of sorted) {
      const g = out[out.length - 1];
      if (g && g.start + g.items.length === e.num) g.items.push(e);
      else out.push({ start: e.num, items: [e] });
    }
    return out;
  };

  const xrefOffset = pos;
  if (useStream) {
    const xrefNum = next++;
    entries.set(xrefNum, { type: 1, num: xrefNum, gen: 0, offset: pos });
    const gs = groups(entries.values());
    const rows = [];
    for (const g of gs) {
      for (const e of g.items) {
        const row = Buffer.alloc(7);
        row[0] = e.type;
        row.writeUInt32BE(e.type === 1 ? e.offset : e.type === 2 ? e.stm : 0, 1);
        row.writeUInt16BE(e.type === 2 ? e.idx : e.gen, 5);
        rows.push(row);
      }
    }
    const data = Buffer.concat(rows);
    const d = new Map([['Type', new Name('XRef')], ['Size', next], ['W', [1, 4, 2]], ['Index', gs.flatMap((g) => [g.start, g.items.length])], ...trailer, ['Length', data.length]]);
    push(`${xrefNum} 0 obj\n${serialize(d)}\nstream\n`);
    parts.push(data); pos += data.length;
    push('\nendstream\nendobj\n');
  } else {
    let table = 'xref\n';
    for (const g of groups(entries.values())) {
      table += `${g.start} ${g.items.length}\n`;
      for (const e of g.items) {
        table += e.type === 0 ? '0000000000 65535 f\r\n' : `${String(e.offset).padStart(10, '0')} ${String(e.gen).padStart(5, '0')} n\r\n`;
      }
    }
    push(`${table}trailer\n${serialize(new Map([['Size', next], ...trailer]))}\n`);
  }
  push(`startxref\n${xrefOffset}\n%%EOF\n`);
  return { pdf: Buffer.concat(parts), pageCount: all.length, placements };
}

module.exports = { stampPdf, PdfReader, UserError, parseValue, Ref, Name, Stream };
