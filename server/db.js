'use strict';
// Base de données SQLite (module intégré à Node.js, aucune installation nécessaire)
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nouveau',
  ip TEXT
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  vehicle_brand TEXT,
  vehicle_model TEXT,
  vehicle_year TEXT,
  vehicle_plate TEXT,
  vehicle_km TEXT,
  items_json TEXT NOT NULL,
  total_ht REAL NOT NULL,
  total_tva REAL NOT NULL,
  total_ttc REAL NOT NULL,
  message TEXT,
  photos_json TEXT,
  status TEXT NOT NULL DEFAULT 'nouveau',
  ip TEXT
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle TEXT,
  plate TEXT,
  service TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'en_attente',
  cancel_token TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date, time);
CREATE TABLE IF NOT EXISTS closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`);

function nextReference(prefix) {
  const year = new Date().getFullYear();
  const name = `${prefix}-${year}`;
  db.prepare('INSERT INTO counters(name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(name);
  db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
  const { value } = db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
  return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
}

module.exports = { db, nextReference };
