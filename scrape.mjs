#!/usr/bin/env node
// Loeb Tallinna 21. Kooli tunniplaani (Untis) ja kirjutab data.json.
// Kasutus:  node scrape.mjs
// Andmed on staatilised — rakendus ise internetti ei vaja.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'https://21k.ee/oppetoo/tunniplaan/';
const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, 'data.json');
const CHANGES = join(DIR, 'changes.json');
const CHANGE_TTL_DAYS = 14;
const CONCURRENCY = 6;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
};

function decode(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .trim();
}

const stripTags = (s) => decode(String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'tunniplaan-pwa/1.0 (isiklik kasutus)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

// --- Pesastatud <td>-de jaotamine (regexiga ei saa, sisemised tabelid segavad) ---
// Tagastab põhitabeli HTML-i koos õige lõpuga (sisemised tabelid arvestatud)
function extractTable(html, from) {
  const tagRe = /<(\/?)table\b[^>]*>/gi;
  tagRe.lastIndex = from;
  let depth = 0, m;
  while ((m = tagRe.exec(html))) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index + m[0].length);
  }
  return html.slice(from);
}

function splitTopLevelCells(chunk) {
  const cells = [];
  const tagRe = /<(\/?)(td|table)\b[^>]*>/gi;
  let depth = 0, cellStart = -1, m;
  while ((m = tagRe.exec(chunk))) {
    const closing = m[1] === '/';
    const isTd = m[2].toLowerCase() === 'td';
    if (!closing) {
      if (isTd && depth === 0) cellStart = m.index + m[0].length;
      depth++;
    } else {
      depth--;
      if (isTd && depth === 0 && cellStart !== -1) {
        cells.push(chunk.slice(cellStart, m.index));
        cellStart = -1;
      }
    }
  }
  return cells;
}

// --- Ühe lahtri sisu: võib olla mitu paralleelset rühma (nt VK / PK / SK) ---
function parseCell(html) {
  const out = [];
  const rowRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html))) {
    const [, attrs, inner] = row;
    const pick = (cls) => {
      const m = new RegExp(`<td class='${cls}'([^>]*)>([\\s\\S]*?)</td>`, 'i').exec(inner);
      if (!m) return null;
      const t = /title='([^']*)'/i.exec(m[1]);
      return { title: decode(t ? t[1] : ''), text: stripTags(m[2]) };
    };
    const subject = pick('l');
    const teacher = pick('c');
    const room = pick('r');
    if (!subject && !teacher && !room) continue;
    if (!subject?.text && !teacher?.text && !room?.text) continue;
    const colorM = /background-color:\s*(#[0-9a-f]{3,8})/i.exec(attrs);
    out.push({
      subject: subject?.text || '',
      subjectFull: subject?.title || '',
      teacher: teacher?.text || '',
      teacherFull: teacher?.title || '',
      room: room?.text || '',
      color: colorM ? colorM[1] : '',
    });
  }
  // Lahter ilma sisemise tabelita, aga tekstiga (nt märkus)
  if (!out.length) {
    const text = stripTags(html);
    if (text) out.push({ subject: text, subjectFull: '', teacher: '', teacherFull: '', room: '', color: '' });
  }
  return out;
}

const DAYS_ET = ['Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede'];

function parseClassPage(html, klass) {
  const tableStart = html.indexOf("<table class='tunniplaan'>");
  if (tableStart === -1) return null;
  const table = extractTable(html, tableStart);

  const titleM = /<h2 class='tunniplaan'>\s*([^<]*?)\s*klass\s*-\s*([^<]*?)\s*(?:<br>\s*<small>\((.*?)\)<\/small>)?\s*<\/h2>/is.exec(html);
  const homeroom = titleM ? decode(titleM[2]) : '';
  const homeroomSubject = titleM ? decode(titleM[3] || '') : '';

  // Päevade nimed: põhitabeli esimene rida, esimene <th> on klassi nimi
  let days = null;
  const headM = /<tr>\s*<th>[^<]*<\/th>((?:\s*<th>[^<]*<\/th>)+)\s*<\/tr>/i.exec(table);
  if (headM) {
    const d = [...headM[1].matchAll(/<th>([^<]*)<\/th>/gi)].map((x) => decode(x[1])).filter(Boolean);
    if (d.length >= 5 && d.slice(0, 5).every((x) => /[a-zäöüõA-ZÄÖÜÕ]/.test(x))) days = d.slice(0, 5);
  }

  const lunchM = /<tr class='soomine'>([\s\S]*?)<\/tr>/i.exec(table);
  const lunch = lunchM
    ? [...lunchM[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => stripTags(m[1])).slice(1, 6)
    : [];

  const periodRe = /<th>(\d+)\.<br>\s*([\d:]+)-<br>\s*([\d:]+)<\/th>([\s\S]*?)(?=<th>\d+\.<br>|$)/gi;
  const periods = [];
  const grid = [];
  let m;
  while ((m = periodRe.exec(table))) {
    periods.push({ n: Number(m[1]), start: m[2], end: m[3] });
    const cells = splitTopLevelCells(m[4]).map(parseCell);
    while (cells.length < 5) cells.push([]);
    grid.push(cells.slice(0, 5));
  }
  if (!periods.length) return null;

  return { klass, homeroom, homeroomSubject, lunch, periods, grid, days };
}

// --- Muudatuste tuvastamine: võrdleb uut kraabitud plaani eelmisega ---
const DAY_SHORT = ['E', 'T', 'K', 'N', 'R'];

const cellSig = (cell) =>
  cell.map((e) => `${e.subject}|${e.teacher}|${e.room}`).sort().join(';');

const namesOf = (cell) => cell.map((e) => e.subjectFull || e.subject).filter(Boolean);

const slotLabel = (p, d, periods) => `${DAY_SHORT[d] ?? '?'} ${periods[p]?.n ?? p + 1}. tund`;

function diffClass(oldGrid, newGrid, periods) {
  const out = {};
  const lost = [];
  const gained = [];
  const P = Math.max(oldGrid.length, newGrid.length);

  for (let p = 0; p < P; p++) {
    for (let d = 0; d < 5; d++) {
      const o = oldGrid[p]?.[d] ?? [];
      const n = newGrid[p]?.[d] ?? [];
      const so = cellSig(o);
      const sn = cellSig(n);
      if (so === sn) continue;

      const key = `${p}|${d}`;
      const oNames = namesOf(o);
      const nNames = namesOf(n);
      const lostNames = oNames.filter((x) => !nNames.includes(x));
      const gainedNames = nNames.filter((x) => !oNames.includes(x));

      out[key] = { kind: !so ? 'added' : !sn ? 'removed' : 'changed' };
      if (oNames.length) out[key].wasSubject = oNames.join(', ');
      if (lostNames.length) lost.push({ key, p, d, names: lostNames });
      if (gainedNames.length) gained.push({ key, p, d, names: gainedNames });
    }
  }

  // Kolimine: aine kadus ühest pesast ja tekkis teise — märgi mõlemad otsad.
  // Kehtib ka siis, kui pesa ei jäänud tühjaks, vaid sinna tuli muu aine.
  const usedGains = new Set();
  for (const l of lost) {
    const hit = gained.find(
      (g) => g.key !== l.key && !usedGains.has(g.key) && g.names.some((s) => l.names.includes(s))
    );
    if (!hit) continue;
    const subject = hit.names.find((s) => l.names.includes(s));
    usedGains.add(hit.key);
    out[l.key].movedTo = { subject, slot: slotLabel(hit.p, hit.d, periods) };
    out[hit.key].movedFrom = { subject, slot: slotLabel(l.p, l.d, periods) };
  }
  return out;
}

function mergeLedger(previous, fresh, today) {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - CHANGE_TTL_DAYS);
  const iso = (d) => d.toISOString().slice(0, 10);
  const merged = {};

  // Vanad kirjed, mis pole veel aegunud
  for (const [klass, slots] of Object.entries(previous)) {
    for (const [slot, entry] of Object.entries(slots)) {
      if (!entry.since || entry.since < iso(cutoff)) continue;
      (merged[klass] ??= {})[slot] = entry;
    }
  }
  // Tänased muudatused kirjutavad vanad üle
  for (const [klass, slots] of Object.entries(fresh)) {
    for (const [slot, entry] of Object.entries(slots)) {
      (merged[klass] ??= {})[slot] = { ...entry, since: today };
    }
  }
  return merged;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx], idx);
      }
    })
  );
  return results;
}

async function main() {
  const previousData = await readJson(OUT, null);
  const previousLedger = await readJson(CHANGES, {});
  const today = new Date().toISOString().slice(0, 10);

  process.stdout.write('Laen klasside nimekirja... ');
  const index = await get(BASE);
  const classes = [...new Set([...index.matchAll(/[?&]klass=([A-Za-zÀ-ÿ0-9]+)/g)].map((m) => decode(m[1])))];
  if (!classes.length) throw new Error('Klasside nimekirja ei leitud — kas lehe struktuur muutus?');
  console.log(`${classes.length} klassi`);

  const updM = /Viimati uuendatud:\s*([\d.]+\s+\d{2}:\d{2}:\d{2})/i.exec(index);
  const notice = /<p style='text-align: center;'>\s*([^<]*koostamisel[^<]*)/i.exec(index);

  const data = {};
  let periods = null;
  let days = DAYS_ET;

  const failures = [];
  await pool(classes, CONCURRENCY, async (klass) => {
    try {
      const html = await get(`${BASE}?klass=${encodeURIComponent(klass)}`);
      const parsed = parseClassPage(html, klass);
      if (!parsed) throw new Error('tabelit ei leitud');

      if (parsed.days) days = parsed.days;
      if (!periods) periods = parsed.periods;
      else {
        const sig = (ps) => ps.map((p) => `${p.n}:${p.start}-${p.end}`).join(',');
        if (sig(parsed.periods) !== sig(periods)) {
          console.warn(`  HOIATUS: ${klass} tundide ajad erinevad teistest klassidest!`);
        }
      }

      data[klass] = {
        homeroom: parsed.homeroom,
        homeroomSubject: parsed.homeroomSubject,
        lunch: parsed.lunch,
        grid: parsed.grid,
      };
      process.stdout.write(`  ${klass}\n`);
    } catch (err) {
      failures.push(`${klass}: ${err.message}`);
    }
  });

  if (!Object.keys(data).length) throw new Error('Ühtegi klassi ei õnnestunud lugeda.');

  const sorted = Object.keys(data).sort(
    (a, b) => (parseInt(a) - parseInt(b)) || a.localeCompare(b, 'et')
  );

  const payload = {
    source: BASE,
    sourceUpdated: updM ? decode(updM[1]) : null,
    notice: notice ? decode(notice[1]).replace(/\s*Viimati uuendatud.*$/i, '').trim() : null,
    scrapedAt: new Date().toISOString(),
    days: days.slice(0, 5),
    periods: periods ?? [],
    classOrder: sorted,
    classes: Object.fromEntries(sorted.map((k) => [k, data[k]])),
  };

  // Muudatuste võrdlus eelmise kraapimisega
  let ledger = {};
  if (previousData?.classes) {
    const fresh = {};
    for (const k of sorted) {
      const before = previousData.classes[k]?.grid;
      if (!before) continue; // uus klass — ära märgi kõike muutunuks
      const slots = diffClass(before, data[k].grid, payload.periods);
      if (Object.keys(slots).length) fresh[k] = slots;
    }
    ledger = mergeLedger(previousLedger, fresh, today);
    const n = Object.values(fresh).reduce((a, s) => a + Object.keys(s).length, 0);
    console.log(`Muudatusi eelmisest korrast: ${n}`);
  } else {
    console.log('Esmakordne kraapimine — muudatusi ei märgita.');
  }
  await writeFile(CHANGES, JSON.stringify(ledger, null, 2) + '\n', 'utf8');

  await writeFile(OUT, JSON.stringify(payload), 'utf8');
  const lessons = sorted.reduce(
    (n, k) => n + data[k].grid.flat(2).length, 0);
  console.log(`\nValmis: ${sorted.length} klassi, ${lessons} tunnikirjet -> data.json`);
  console.log(`Allika ajatempel: ${payload.sourceUpdated ?? 'teadmata'}`);
  if (failures.length) console.warn(`\nEbaõnnestus (${failures.length}):\n  ${failures.join('\n  ')}`);
}

export { diffClass, mergeLedger, parseClassPage, parseCell, splitTopLevelCells, cellSig };

const runDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (runDirectly) {
  main().catch((err) => {
    console.error(`\nViga: ${err.message}`);
    process.exit(1);
  });
}
