'use strict';
// Générateur PDF minimaliste (sans dépendance) : texte Helvetica, lignes, encodage WinAnsi (accents OK).

const WINANSI_EXTRA = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, 'œ': 0x9c, 'Œ': 0x8c };

function encodeText(str) {
  const bytes = [];
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    let b;
    if (WINANSI_EXTRA[ch] !== undefined) b = WINANSI_EXTRA[ch];
    else if (code < 256) b = code;
    else b = 0x3f; // '?'
    if (b === 0x28 || b === 0x29 || b === 0x5c) bytes.push(0x5c); // échappe ( ) \
    bytes.push(b);
  }
  return Buffer.from(bytes);
}

// Largeurs approximatives Helvetica (unités /1000) pour aligner à droite et couper les lignes
const HELV_WIDTHS = { ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '€': 556 };
function textWidth(str, size) {
  let w = 0;
  for (const ch of String(str)) w += HELV_WIDTHS[ch] || 556;
  return (w / 1000) * size;
}

class PdfDoc {
  constructor() {
    this.pages = [];
    this.width = 595.28; // A4
    this.height = 841.89;
    this.margin = 50;
    this.newPage();
  }
  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.height - this.margin;
  }
  ensureSpace(h) {
    if (this.y - h < this.margin) this.newPage();
  }
  text(str, x, y, { size = 10, bold = false, align = 'left', color = '0 0 0' } = {}) {
    let px = x;
    if (align === 'right') px = x - textWidth(str, size);
    if (align === 'center') px = x - textWidth(str, size) / 2;
    const font = bold ? '/F2' : '/F1';
    this.ops.push(`BT ${color} rg ${font} ${size} Tf ${px.toFixed(2)} ${y.toFixed(2)} Td (`);
    this.ops.push(encodeText(str));
    this.ops.push(`) Tj ET`);
  }
  line(x1, y1, x2, y2, { width = 0.5, color = '0.6 0.6 0.6' } = {}) {
    this.ops.push(`${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }
  rect(x, y, w, h, color = '0.95 0.95 0.95') {
    this.ops.push(`${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  wrap(str, size, maxWidth) {
    const words = String(str).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (textWidth(test, size) > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  paragraph(str, x, maxWidth, { size = 10, bold = false, color = '0 0 0', lineHeight = 1.4 } = {}) {
    for (const raw of String(str).split(/\r?\n/)) {
      const lines = raw ? this.wrap(raw, size, maxWidth) : [''];
      for (const l of lines) {
        this.ensureSpace(size * lineHeight);
        this.y -= size * lineHeight;
        if (l) this.text(l, x, this.y, { size, bold, color });
      }
    }
  }
  toBuffer() {
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pagesId = objects.length + 1 + this.pages.length * 2; // réservé après contenus et pages
    const pageIds = [];
    for (const ops of this.pages) {
      const chunks = ops.map((o) => (Buffer.isBuffer(o) ? o : Buffer.from(o + '\n', 'latin1')));
      const content = Buffer.concat(chunks);
      const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]));
      const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>`);
      pageIds.push(pageId);
    }
    const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    if (realPagesId !== pagesId) throw new Error('PDF: incohérence interne');
    const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets = [];
    let length = parts[0].length;
    objects.forEach((body, i) => {
      offsets.push(length);
      const buf = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
        Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'),
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      parts.push(buf);
      length += buf.length;
    });
    const xrefPos = length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}

const euro = (n) => `${n.toFixed(2).replace('.', ',')} €`;

/**
 * Génère le PDF d'un devis estimatif.
 */
function buildQuotePdf(quote, garage) {
  const doc = new PdfDoc();
  const m = doc.margin;
  const right = doc.width - m;

  // En-tête
  doc.rect(0, doc.height - 90, doc.width, 90, '0.07 0.09 0.15');
  doc.text(garage.name, m, doc.height - 45, { size: 22, bold: true, color: '1 1 1' });
  doc.text(garage.tagline, m, doc.height - 62, { size: 10, color: '0.85 0.85 0.85' });
  doc.text('DEVIS ESTIMATIF', right, doc.height - 45, { size: 16, bold: true, align: 'right', color: '0.98 0.75 0.14' });
  doc.text(`N° ${quote.reference}`, right, doc.height - 62, { size: 10, align: 'right', color: '1 1 1' });
  doc.y = doc.height - 115;

  // Coordonnées garage / client
  const colY = doc.y;
  doc.text('Garage', m, colY, { size: 9, bold: true, color: '0.4 0.4 0.4' });
  doc.text(garage.legalName, m, colY - 14, { size: 10, bold: true });
  doc.text(garage.address.street, m, colY - 27, { size: 10 });
  doc.text(`${garage.address.postalCode} ${garage.address.city}`, m, colY - 40, { size: 10 });
  doc.text(`Tél. ${garage.phone} · ${garage.email}`, m, colY - 53, { size: 10 });

  const cx = doc.width / 2 + 20;
  doc.text('Client', cx, colY, { size: 9, bold: true, color: '0.4 0.4 0.4' });
  doc.text(quote.name, cx, colY - 14, { size: 10, bold: true });
  doc.text(quote.email, cx, colY - 27, { size: 10 });
  doc.text(quote.phone, cx, colY - 40, { size: 10 });
  doc.text(`Date : ${quote.dateLabel}`, cx, colY - 53, { size: 10 });
  doc.y = colY - 75;

  // Véhicule
  doc.rect(m, doc.y - 30, right - m, 30, '0.95 0.95 0.96');
  doc.text('Véhicule', m + 10, doc.y - 12, { size: 9, bold: true, color: '0.4 0.4 0.4' });
  const veh = [quote.vehicleTypeLabel, quote.vehicle_brand, quote.vehicle_model, quote.vehicle_year ? `(${quote.vehicle_year})` : '', quote.vehicle_plate ? `· ${quote.vehicle_plate}` : '', quote.vehicle_km ? `· ${quote.vehicle_km} km` : ''].filter(Boolean).join(' ');
  doc.text(veh, m + 10, doc.y - 24, { size: 10 });
  doc.y -= 50;

  // Tableau
  const cols = { desc: m, qty: right - 190, unit: right - 100, total: right };
  doc.rect(m, doc.y - 18, right - m, 18, '0.07 0.09 0.15');
  doc.text('Prestation', cols.desc + 6, doc.y - 12, { size: 9, bold: true, color: '1 1 1' });
  doc.text('Qté', cols.qty, doc.y - 12, { size: 9, bold: true, align: 'right', color: '1 1 1' });
  doc.text('P.U. TTC', cols.unit, doc.y - 12, { size: 9, bold: true, align: 'right', color: '1 1 1' });
  doc.text('Total TTC', cols.total - 6, doc.y - 12, { size: 9, bold: true, align: 'right', color: '1 1 1' });
  doc.y -= 18;

  for (const item of quote.items) {
    const lines = doc.wrap(item.label, 10, cols.qty - cols.desc - 60);
    const h = 8 + lines.length * 13;
    doc.ensureSpace(h);
    lines.forEach((l, i) => doc.text(l, cols.desc + 6, doc.y - 13 - i * 13, { size: 10 }));
    doc.text(String(item.quantity), cols.qty, doc.y - 13, { size: 10, align: 'right' });
    doc.text(euro(item.unitPrice), cols.unit, doc.y - 13, { size: 10, align: 'right' });
    doc.text(euro(item.total), cols.total - 6, doc.y - 13, { size: 10, align: 'right' });
    doc.y -= h;
    doc.line(m, doc.y, right, doc.y);
  }

  // Totaux
  doc.ensureSpace(80);
  doc.y -= 10;
  const tx = right - 200;
  doc.text('Total HT', tx, doc.y - 12, { size: 10 });
  doc.text(euro(quote.total_ht), right - 6, doc.y - 12, { size: 10, align: 'right' });
  doc.text(`TVA (${Math.round(quote.vatRate * 100)} %)`, tx, doc.y - 27, { size: 10 });
  doc.text(euro(quote.total_tva), right - 6, doc.y - 27, { size: 10, align: 'right' });
  doc.rect(tx - 6, doc.y - 62, right - tx + 6, 24, '0.98 0.75 0.14');
  doc.text('TOTAL TTC estimé', tx, doc.y - 54, { size: 12, bold: true });
  doc.text(euro(quote.total_ttc), right - 6, doc.y - 54, { size: 12, bold: true, align: 'right' });
  doc.y -= 80;

  if (quote.message) {
    doc.paragraph('Précisions du client :', m, right - m, { size: 9, bold: true, color: '0.4 0.4 0.4' });
    doc.paragraph(quote.message, m, right - m, { size: 10 });
    doc.y -= 10;
  }

  doc.paragraph('Conditions :', m, right - m, { size: 9, bold: true, color: '0.4 0.4 0.4' });
  doc.paragraph(
    `Ce document est une estimation indicative générée automatiquement à partir de nos tarifs forfaitaires. ${quote.pricingNote} Estimation valable 30 jours. Pièces et main d'œuvre garanties. Prix TTC.`,
    m, right - m, { size: 9, color: '0.3 0.3 0.3' }
  );

  // Pied de page
  doc.line(m, m + 20, right, m + 20);
  doc.text(`${garage.legalName} · SIREN ${garage.siren} · ${garage.fullAddress} · ${garage.phone}`, doc.width / 2, m + 8, { size: 8, align: 'center', color: '0.45 0.45 0.45' });

  return doc.toBuffer();
}

module.exports = { PdfDoc, buildQuotePdf };
