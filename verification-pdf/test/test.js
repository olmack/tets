'use strict';
// Tests automatiques : npm test
// 1. QR code : encodage puis relecture (toutes les versions)
// 2. Tampon PDF : PDF classiques, compressés (flux d'objets + xref en flux), pages tournées, xref abîmée.
//    Si Poppler (pdftoppm) est installé, la page est rendue en image et le QR code est relu depuis les pixels.
// 3. Serveur : émission, page de vérification, contrôle du fichier, révocation, suppression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { encodeQr } = require('../server/qrcode');
const { stampPdf, PdfReader, Ref } = require('../server/pdf-stamp');
const { decodeMatrix } = require('./qr-decode');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-pdf-test-'));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (err) { console.error(`  ✗ ${name}\n`, err); process.exitCode = 1; }
}

// ---------- PDF de test ----------

function buildClassicPdf({ rotate = 0, brokenXref = false, mediaBox = [0, 0, 595, 842], pageCount = 1 } = {}) {
  const objs = [];
  const kids = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objs[4] = '<< /Font << /F1 3 0 R >> >>';
  for (let i = 0; i < pageCount; i++) {
    const pageNum = 5 + i * 2;
    const content = `BT /F1 20 Tf 72 700 Td (Page ${i + 1} - document de test) Tj ET 0 0 1 rg 3 w 0 0 m 600 840 l S`;
    objs[pageNum] = `<< /Type /Page /Parent 2 0 R /Resources 4 0 R /Contents [${pageNum + 1} 0 R]${rotate ? ` /Rotate ${rotate}` : ''} >>`;
    objs[pageNum + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    kids.push(`${pageNum} 0 R`);
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} /MediaBox [${mediaBox.join(' ')}] >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += `${String(offsets[n] + (brokenXref ? 7 : 0)).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] >>\nstartxref\n${brokenXref ? xref + 3 : xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// PDF 1.5 « moderne » : objets dans un flux d'objets compressé, table xref en flux avec prédicteur PNG
function buildCompressedPdf() {
  const parts = [];
  let pos = 0;
  const push = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(buf); pos += buf.length; };
  push('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');
  const content = zlib.deflateSync(Buffer.from('BT /F1 24 Tf 72 700 Td (Document compress\xe9) Tj ET', 'latin1'));
  const off4 = pos;
  push(`4 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`); push(content); push('\nendstream\nendobj\n');
  const inner = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
  ];
  let body = '';
  const header = [];
  for (const [n, txt] of inner) { header.push(`${n} ${body.length}`); body += `${txt}\n`; }
  const headerStr = `${header.join(' ')}\n`;
  const objstm = zlib.deflateSync(Buffer.from(headerStr + body, 'latin1'));
  const off6 = pos;
  push(`6 0 obj\n<< /Type /ObjStm /N ${inner.length} /First ${headerStr.length} /Length ${objstm.length} /Filter /FlateDecode >>\nstream\n`); push(objstm); push('\nendstream\nendobj\n');
  const off7 = pos;
  const rows = [[0, 0, 255], [2, 6, 0], [2, 6, 1], [2, 6, 2], [1, off4, 0], [2, 6, 3], [1, off6, 0], [1, off7, 0]];
  const raw = [];
  let prev = [0, 0, 0, 0, 0];
  for (const [t, f2, f3] of rows) {
    const row = [t, (f2 >> 16) & 255, (f2 >> 8) & 255, f2 & 255, f3];
    raw.push(2, ...row.map((b, i) => (b - prev[i] + 256) & 255)); // prédicteur PNG « Up »
    prev = row;
  }
  const xdata = zlib.deflateSync(Buffer.from(raw));
  push(`7 0 obj\n<< /Type /XRef /Size 8 /W [1 3 1] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Columns 5 /Predictor 12 >> /Length ${xdata.length} >>\nstream\n`);
  push(xdata); push(`\nendstream\nendobj\nstartxref\n${off7}\n%%EOF\n`);
  return Buffer.concat(parts);
}

// ---------- Rendu et relecture du QR code (Poppler) ----------

const hasPoppler = spawnSync('pdftoppm', ['-v']).status === 0;

function renderPage(file, page, dpi) {
  const prefix = path.join(tmp, `r${Math.random().toString(36).slice(2)}`);
  const r = spawnSync('pdftoppm', ['-gray', '-r', String(dpi), '-f', String(page), '-l', String(page), file, prefix], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/error/i.test(r.stderr), `Poppler signale une erreur : ${r.stderr}`);
  const out = fs.readdirSync(tmp).find((f) => path.join(tmp, f).startsWith(prefix));
  const buf = fs.readFileSync(path.join(tmp, out));
  const header = buf.toString('latin1', 0, 64).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  return { width: Number(header[1]), height: Number(header[2]), pixels: buf.subarray(header[0].length) };
}

function readQrFromRender(file, placement, dpi = 200) {
  const img = renderPage(file, placement.page, dpi);
  const k = dpi / 72;
  const unit = placement.side / placement.modules;
  const m = [];
  for (let r = 0; r < placement.modules; r++) {
    const row = [];
    for (let c = 0; c < placement.modules; c++) {
      const vx = placement.x + (c + 0.5) * unit;
      const vy = placement.y + placement.side - (r + 0.5) * unit;
      const px = Math.round(vx * k);
      const py = Math.round((placement.pageHeight - vy) * k);
      row.push(img.pixels[py * img.width + px] < 128);
    }
    m.push(row);
  }
  return decodeMatrix(m);
}

function pdfText(file) {
  const r = spawnSync('pdftotext', [file, '-'], { encoding: 'utf8' });
  return r.stdout || '';
}

async function checkStamp(name, input, opts = {}) {
  const url = 'https://verif.exemple.fr/v/K7Q2M9XD4TPA';
  const { pdf, placements } = stampPdf(input, { url, code: 'K7Q2-M9XD-4TPA', ...opts });
  assert.ok(pdf.subarray(0, input.length).equals(input), 'le PDF d\'origine doit rester intact (mise à jour incrémentale)');
  // Relecture par notre propre analyseur : les pages tamponnées pointent vers le nouveau contenu
  const reader = new PdfReader(pdf);
  assert.ok(!reader.reconstructed, 'la nouvelle table xref doit être lisible sans reconstruction');
  const pages = reader.getPages();
  for (const pl of placements) {
    const contents = pages[pl.page - 1].dict.get('Contents');
    assert.ok(Array.isArray(contents) && contents.length >= 3 && contents.every((c) => c instanceof Ref));
  }
  const file = path.join(tmp, `${name}.pdf`);
  fs.writeFileSync(file, pdf);
  if (hasPoppler) {
    for (const pl of placements) assert.equal(readQrFromRender(file, pl), url);
    const text = pdfText(file);
    assert.match(text, /Scannez pour vérifier/);
    assert.match(text, /K7Q2-M9XD-4TPA/);
  }
  return { pdf, placements, file };
}

// ---------- Serveur ----------

async function serverTests() {
  const dataDir = path.join(tmp, 'data');
  Object.assign(process.env, { DATA_DIR: dataDir, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'secret-test', BASE_URL: 'https://verif.exemple.fr/', ISSUER_NAME: 'Organisme Test', PORT: '0' });
  const { server } = require('../server/index');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: `Basic ${Buffer.from('admin:secret-test').toString('base64')}` };
  try {
    await test('serveur : accueil et fichiers statiques', async () => {
      const home = await fetch(`${base}/`);
      assert.equal(home.status, 200);
      assert.match(await home.text(), /Vérifier un document/);
      assert.equal((await fetch(`${base}/style.css`)).status, 200);
    });

    await test('serveur : l\'administration exige le mot de passe', async () => {
      assert.equal((await fetch(`${base}/admin`)).status, 401);
      assert.equal((await fetch(`${base}/api/admin/documents`, { headers: { Authorization: `Basic ${Buffer.from('admin:faux').toString('base64')}` } })).status, 401);
      assert.equal((await fetch(`${base}/admin`, { headers: auth })).status, 200);
    });

    let doc;
    let stamped;
    await test('serveur : émission d\'un document', async () => {
      const q = new URLSearchParams({ title: 'Attestation de stage', recipient: 'Marie <b>Dupont</b>', issuedAt: '2026-10-01', filename: 'attestation.pdf' });
      const res = await fetch(`${base}/api/admin/documents?${q}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/pdf' }, body: buildCompressedPdf() });
      doc = await res.json();
      assert.equal(res.status, 201, JSON.stringify(doc));
      assert.match(doc.id, /^[A-HJ-NP-Z2-9]{12}$/);
      assert.equal(doc.url, `https://verif.exemple.fr/v/${doc.id}`);
      const dl = await fetch(`${base}/api/admin/documents/${doc.id}/pdf`, { headers: auth });
      assert.equal(dl.status, 200);
      assert.match(dl.headers.get('content-disposition'), /attestation-verifiable\.pdf/);
      stamped = Buffer.from(await dl.arrayBuffer());
      if (hasPoppler) {
        const file = path.join(tmp, 'server.pdf');
        fs.writeFileSync(file, stamped);
        const pl = stampPdf(buildCompressedPdf(), { url: doc.url, code: doc.code }).placements[0];
        assert.equal(readQrFromRender(file, pl), doc.url);
      }
    });

    await test('serveur : erreurs d\'émission (intitulé manquant, fichier non PDF)', async () => {
      let res = await fetch(`${base}/api/admin/documents?title=`, { method: 'POST', headers: auth, body: buildClassicPdf() });
      assert.equal(res.status, 400);
      res = await fetch(`${base}/api/admin/documents?title=X`, { method: 'POST', headers: auth, body: 'pas un pdf' });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /pas un PDF/);
    });

    await test('serveur : page de vérification d\'un document valide', async () => {
      const res = await fetch(`${base}/v/${doc.id}`);
      const html = await res.text();
      assert.equal(res.status, 200);
      assert.match(html, /Document authentique/);
      assert.match(html, /Attestation de stage/);
      assert.match(html, /Marie &lt;b&gt;Dupont&lt;\/b&gt;/, 'les données doivent être échappées');
      assert.match(html, /01\/10\/2026/);
      // le code saisi à la main (minuscules, tirets) fonctionne aussi
      const lookup = await fetch(`${base}/v?code=${doc.code.toLowerCase()}`, { redirect: 'manual' });
      assert.equal(lookup.headers.get('location'), `/v/${doc.id}`);
    });

    await test('serveur : contrôle du fichier PDF (identique / modifié)', async () => {
      let res = await fetch(`${base}/v/${doc.id}/fichier`, { method: 'POST', body: stamped });
      assert.deepEqual(await res.json(), { identique: true, etat: 'valide' });
      const altered = Buffer.from(stamped);
      altered[altered.length - 20] ^= 1;
      res = await fetch(`${base}/v/${doc.id}/fichier`, { method: 'POST', body: altered });
      assert.equal((await res.json()).identique, false);
    });

    await test('serveur : code inconnu → document non reconnu', async () => {
      const res = await fetch(`${base}/v/AAAABBBBCCCC`);
      assert.equal(res.status, 404);
      assert.match(await res.text(), /Document non reconnu/);
    });

    await test('serveur : révocation puis réactivation', async () => {
      let res = await fetch(`${base}/api/admin/documents/${doc.id}/revoke`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Erreur de saisie' }) });
      assert.equal((await res.json()).state, 'revoque');
      let html = await (await fetch(`${base}/v/${doc.id}`)).text();
      assert.match(html, /Document révoqué/);
      assert.match(html, /Erreur de saisie/);
      res = await fetch(`${base}/api/admin/documents/${doc.id}/restore`, { method: 'POST', headers: auth });
      assert.equal((await res.json()).state, 'valide');
      html = await (await fetch(`${base}/v/${doc.id}`)).text();
      assert.match(html, /Document authentique/);
    });

    await test('serveur : document expiré', async () => {
      const q = new URLSearchParams({ title: 'Carte annuelle', issuedAt: '2020-01-01', expiresAt: '2020-12-31' });
      const d = await (await fetch(`${base}/api/admin/documents?${q}`, { method: 'POST', headers: auth, body: buildClassicPdf() })).json();
      assert.match(await (await fetch(`${base}/v/${d.id}`)).text(), /Document expiré/);
    });

    await test('serveur : registre, compteur de scans et suppression', async () => {
      const list = await (await fetch(`${base}/api/admin/documents`, { headers: auth })).json();
      assert.equal(list.length, 2);
      assert.ok(list.find((d) => d.id === doc.id).scans >= 3);
      assert.equal((await fetch(`${base}/api/admin/documents/${doc.id}`, { method: 'DELETE', headers: auth })).status, 200);
      assert.equal((await fetch(`${base}/v/${doc.id}`)).status, 404);
      assert.ok(!fs.existsSync(path.join(dataDir, 'pdf', `${doc.id}.pdf`)));
    });
  } finally {
    server.close();
  }
}

(async () => {
  console.log('QR code');
  await test('encodage puis relecture, versions 1 à 10', () => {
    for (let n = 1; n <= 213; n += 4) {
      const text = `https://exemple.fr/v/${'ABCDEFGHJK'.repeat(30)}`.slice(0, n);
      assert.equal(decodeMatrix(encodeQr(text).modules), text);
    }
    assert.throws(() => encodeQr('x'.repeat(214)), /trop long/);
  });

  console.log(`Tampon PDF${hasPoppler ? ' (vérification du rendu avec Poppler)' : ' (Poppler absent : rendu non vérifié)'}`);
  await test('PDF classique', () => checkStamp('classique', buildClassicPdf()));
  await test('PDF compressé (flux d\'objets, xref en flux, prédicteur PNG)', async () => {
    const { pdf } = await checkStamp('compresse', buildCompressedPdf());
    assert.match(pdf.toString('latin1').slice(-400), /\/Type \/XRef/, 'la mise à jour doit utiliser une xref en flux');
  });
  for (const rotate of [90, 180, 270]) {
    await test(`page tournée de ${rotate}°`, () => checkStamp(`rot${rotate}`, buildClassicPdf({ rotate })));
  }
  await test('table xref abîmée (reconstruction)', () => checkStamp('casse', buildClassicPdf({ brokenXref: true })));
  await test('PDF compressé avec xref abîmée (reconstruction des flux d\'objets)', async () => {
    const broken = Buffer.from(buildCompressedPdf().toString('latin1').replace(/startxref\n(\d+)/, (m, n) => `startxref\n${Number(n) + 5}`), 'latin1');
    const { pdf } = await checkStamp('compresse-casse', broken);
    assert.match(pdf.toString('latin1').slice(-400), /\/Type \/XRef/);
  });
  await test('format paysage, QR en haut à gauche', () => checkStamp('paysage', buildClassicPdf({ mediaBox: [0, 0, 842, 595] }), { position: 'haut-gauche' }));
  await test('toutes les pages / dernière page', async () => {
    const all = await checkStamp('toutes', buildClassicPdf({ pageCount: 3 }), { pages: 'toutes' });
    assert.deepEqual(all.placements.map((p) => p.page), [1, 2, 3]);
    const last = await checkStamp('derniere', buildClassicPdf({ pageCount: 3 }), { pages: 'derniere' });
    assert.deepEqual(last.placements.map((p) => p.page), [3]);
  });
  await test('PDF tamponné deux fois (mises à jour successives)', async () => {
    const once = stampPdf(buildCompressedPdf(), { url: 'https://a.fr/v/1', code: '1' }).pdf;
    await checkStamp('deux-fois', once, { position: 'haut-droite' });
  });
  await test('PDF chiffré refusé', () => {
    const pdf = buildClassicPdf().toString('latin1').replace('/Root 1 0 R', '/Root 1 0 R /Encrypt 99 0 R');
    assert.throws(() => stampPdf(Buffer.from(pdf, 'latin1'), { url: 'x', code: 'x' }), /protégé/);
  });
  for (const extra of (process.env.EXTRA_PDFS || '').split(path.delimiter).filter(Boolean)) {
    await test(`fichier externe ${path.basename(extra)}`, () => checkStamp(path.basename(extra, '.pdf'), fs.readFileSync(extra), { pages: 'toutes' }));
  }

  console.log('Serveur');
  await serverTests();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(process.exitCode ? '\nCertains tests ont échoué.' : `\n${passed} tests réussis.`);
})();
