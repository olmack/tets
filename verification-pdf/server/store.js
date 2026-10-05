'use strict';
// Stockage des documents émis : un fichier JSON (data/documents.json) + les PDF tamponnés (data/pdf/).
// Facile à sauvegarder : il suffit de copier le dossier data/.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Alphabet sans caractères ambigus (pas de 0/O, 1/I) : 12 caractères = 60 bits, impossible à deviner
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newId() {
  const bytes = crypto.randomBytes(12);
  let id = '';
  for (const b of bytes) id += ALPHABET[b % 32];
  return id;
}

function normalizeId(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}

function formatId(id) {
  return id.match(/.{1,4}/g).join('-');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.pdfDir = path.join(dir, 'pdf');
    this.file = path.join(dir, 'documents.json');
    fs.mkdirSync(this.pdfDir, { recursive: true });
    this.docs = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')).documents || [] : [];
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ documents: this.docs }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list() {
    return [...this.docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id) {
    return this.docs.find((d) => d.id === id) || null;
  }

  newId() {
    let id;
    do id = newId(); while (this.get(id));
    return id;
  }

  add(doc, pdf) {
    fs.writeFileSync(this.pdfPath(doc.id), pdf);
    this.docs.push(doc);
    this.save();
    return doc;
  }

  update(id, changes) {
    const doc = this.get(id);
    if (!doc) return null;
    Object.assign(doc, changes);
    this.save();
    return doc;
  }

  remove(id) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => d.id !== id);
    if (this.docs.length === before) return false;
    fs.rmSync(this.pdfPath(id), { force: true });
    this.save();
    return true;
  }

  pdfPath(id) {
    return path.join(this.pdfDir, `${id}.pdf`);
  }
}

module.exports = { Store, normalizeId, formatId, sha256 };
