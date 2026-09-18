'use strict';
// Jours fériés français (calcul automatique, Pâques inclus)

function easterDate(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(d) { return d.toISOString().slice(0, 10); }
function plusDays(d, n) { return new Date(d.getTime() + n * 86400000); }

const cache = new Map();
function frenchHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const easter = easterDate(year);
  const set = new Set([
    `${year}-01-01`, `${year}-05-01`, `${year}-05-08`, `${year}-07-14`,
    `${year}-08-15`, `${year}-11-01`, `${year}-11-11`, `${year}-12-25`,
    iso(plusDays(easter, 1)), iso(plusDays(easter, 39)), iso(plusDays(easter, 50)),
  ]);
  cache.set(year, set);
  return set;
}

function isFrenchHoliday(dateStr) {
  return frenchHolidays(Number(dateStr.slice(0, 4))).has(dateStr);
}

module.exports = { frenchHolidays, isFrenchHoliday };
