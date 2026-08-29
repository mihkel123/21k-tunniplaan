#!/usr/bin/env node
/**
 * Laeb ühistranspordi GTFS-id ja kirjutab kausta ./bus/ :
 *   stops.json      - peatused otsinguks
 *   routes.json     - liin|suund -> {s: peatuste järjekord, t: sõiduajad}
 *   stop/<id>.json  - ühe peatuse graafik (E-N ja reede eraldi)
 *
 * Kaks allikat:
 *   1. Tallinna linnaliinid (TLT) — bussid, trollid, trammid.
 *   2. Harjumaa maakonnaliinid riiklikust registrist — ainult need liinid,
 *      mis peatuvad kuskil Tallinnas. Küla-sisesed liinid (Rae sise, Saue
 *      sise jt) jäävad välja: laps neile koolist koju sõites ei satu.
 *
 * Mõlemas voos on peatuse-id sama riiklik number, nii et need liituvad
 * otse — Vabaduse väljak on 1285 nii TLT-s kui registris.
 *
 * Neid faile ei commitita — need on tuletatud andmed, mis tekivad iga deploy'ga.
 * Kasutus: node bus-data.mjs
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TLT_GTFS = 'https://transport.tallinn.ee/data/gtfs.zip';
const EE_GTFS = 'https://eu-gtfs.remix.com/estonia_unified_gtfs.zip';

// Harjumaa vedajad riiklikus voos: GoBus, Hansabuss, SEBE.
const COUNTY_AGENCY = /^HARJUMAA_/;
// stops.txt veerg `authority` ütleb, kas peatus on Tallinna oma.
const TALLINN = 'Tallinna linn';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'bus');

/* ---------- Minimaalne ZIP-lugeja (ilma väliste teekideta) ---------- */

/**
 * Tagastab nime -> {method, raw}. Lahti pakime alles lugemisel: riiklikus
 * voos on shapes.txt 175 MB, mida me kunagi ei vaja.
 */
function unzip(buf) {
  // Otsi lõpust "end of central directory" kirjet
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('ZIP: keskkataloogi ei leitud');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP: vigane kirje');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // Andmete algus tuleb lugeda kohalikust päisest (extra võib erineda)
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;

    files.set(name, { method, raw: buf.subarray(start, start + compSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------- CSV ---------- */

function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * stop_times.txt on miljoneid ridu, seega tasub odav tee.
 * Aga riiklikus voos on trip_id vahel jutumärkides ja sisaldab koma
 * ("50,53_kuni_31.08-Mo-..."); lihtne split nihutaks seal kõik veerud paigast.
 * Selline rida algab alati jutumärgiga — muid jutumärke esimestes veergudes pole.
 */
const splitRow = (line) => (line.charCodeAt(0) === 34 ? splitCsv(line) : line.split(','));

/** Ridade kaupa üle puhvri, ilma kogu faili stringiks tegemata. */
function* linesOf(buf) {
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue;
    const end = i > start && buf[i - 1] === 0x0d ? i - 1 : i;
    if (end > start) yield buf.toString('utf8', start, end);
    start = i + 1;
  }
  if (start < buf.length) yield buf.toString('utf8', start);
}

/** Päis veeruindeksiteks + ridade generaator. */
function table(zip, name) {
  const entry = zip.get(name);
  if (!entry) throw new Error(`GTFS: ${name} puudub`);
  const buf = entry.method === 0 ? entry.raw : inflateRawSync(entry.raw);
  const it = linesOf(buf);
  const first = it.next();
  if (first.done) throw new Error(`GTFS: ${name} on tühi`);
  const head = splitCsv(first.value.replace(/^﻿/, ''));
  return { ix: Object.fromEntries(head.map((h, i) => [h, i])), rows: it };
}

const toSecs = (hhmmss) => {
  const [h, m, s] = hhmmss.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

/**
 * Riiklikus registris on rongipeatustel ingliskeelne lisand
 * ("Balti jaam (train station)"). Eestikeelses äpis pole sel kohta ja
 * ilma selleta kattub nimi TLT voo omaga.
 */
const clean = (name) => name.replace(/\s*\((?:train|bus) station\)\s*$/i, '');

/**
 * Kas teenus kehtib sel kuupäeval? Maakonnaliinil käib korraga kaks
 * sõiduplaani — vana (kuni 31.08) ja uus (alates 01.09) — ja mõlema
 * läbilaskmine tekitaks igast väljumisest kaks kirjet paari minuti vahega.
 */
const activeOn = (from, to, today) => !((from && from > today) || (to && to < today));

/**
 * Maakonnapeatuse nimi saab valla juurde: "Kadaka" on nii Tallinnas kui
 * Harku vallas, ja idsByName otsib täpse nime järgi — ilma vallata
 * segataks kaks eri kohta üheks peatuseks.
 */
const countyName = (name, area) => (area ? `${name} (${area})` : name);

/**
 * Peatuse lõplik nimi. Linnavõrgu nimi võidab: linnaliin käib ka üle valla
 * piiri — Tiskre, Harkujärve ja Hansunõmme on registris Harjumaa peatused,
 * aga lapse jaoks tavalised linnapeatused. Valla lisame ainult mujal.
 */
const stopName = (tltName, name, area) => tltName || countyName(name, area);

/* ---------- Kogutav seis (mõlemad vood valavad siia) ---------- */

const perStop = new Map();   // peatus -> {w:[], f:[]}
const paths = {};            // "liin|suund" -> peatuste järjekord
const names = new Map();     // peatus -> nimi
const coords = new Map();    // peatus -> [lat, lon]

function addDeparture(stop, row, w, f) {
  let v = perStop.get(stop);
  if (!v) perStop.set(stop, (v = { w: [], f: [] }));
  if (w) v.w.push(row);
  if (f) v.f.push(row);
}

/**
 * Pikim sõit võidab: see läbib suunast kõige rohkem peatusi.
 * `t` on sekundid esimesest peatusest — sellest saab sõiduaja kahe peatuse
 * vahel, ilma et peaks iga sõidu aegu eraldi hoidma. Hommikune kaart vajab
 * seda, et öelda, kas laps jõuab enne esimest tundi kohale.
 */
function addPath(num, head, stops, offsets) {
  const key = `${num}|${head}`;
  if (!paths[key] || stops.length > paths[key].s.length) paths[key] = { s: stops, t: offsets };
}

/** Millised teenused kehtivad E-N ja reedel. */
function weekdayServices(zip, today) {
  const cal = table(zip, 'calendar.txt');
  const monThu = new Set();
  const fri = new Set();
  for (const l of cal.rows) {
    const c = splitCsv(l);
    if (!activeOn(c[cal.ix.start_date], c[cal.ix.end_date], today)) continue;
    const id = c[cal.ix.service_id];
    if (c[cal.ix.monday] === '1') monThu.add(id);
    if (c[cal.ix.friday] === '1') fri.add(id);
  }
  return { monThu, fri };
}

/** trip_id -> {num, head, w, f} nende liinide kohta, mille `keep` läbi laseb. */
function weekdayTrips(zip, today, keepRoute) {
  const { monThu, fri } = weekdayServices(zip, today);

  const routes = table(zip, 'routes.txt');
  const routeNum = new Map();
  for (const l of routes.rows) {
    const c = splitCsv(l);
    if (!keepRoute(c, routes.ix)) continue;
    routeNum.set(c[routes.ix.route_id], c[routes.ix.route_short_name]);
  }

  const trips = table(zip, 'trips.txt');
  const info = new Map();
  for (const l of trips.rows) {
    const c = splitCsv(l);
    const rid = c[trips.ix.route_id];
    if (!routeNum.has(rid)) continue;
    const svc = c[trips.ix.service_id];
    const w = monThu.has(svc);
    const f = fri.has(svc);
    if (!w && !f) continue;
    info.set(c[trips.ix.trip_id], {
      route: rid,
      num: routeNum.get(rid) ?? '?',
      head: clean(c[trips.ix.trip_headsign] ?? ''),
      w,
      f,
    });
  }
  return { routeCount: routeNum.size, trips: info };
}

/** trip -> [[järjekord, peatus, sekundid]], ainult teadaolevate sõitude kohta. */
function tripStopTimes(zip, trips) {
  const st = table(zip, 'stop_times.txt');
  const { trip_id: TI, departure_time: DI, stop_id: SI, stop_sequence: QI } = st.ix;
  const seq = new Map();
  for (const l of st.rows) {
    const c = splitRow(l);
    if (!trips.has(c[TI])) continue;
    let rows = seq.get(c[TI]);
    if (!rows) seq.set(c[TI], (rows = []));
    rows.push([+c[QI], c[SI], toSecs(c[DI])]);
  }
  for (const rows of seq.values()) rows.sort((a, b) => a[0] - b[0]);
  return seq;
}

/* ---------- Voog 1: Tallinna linnaliinid ---------- */

function harvestTallinn(zip, today) {
  const { routeCount, trips } = weekdayTrips(zip, today, () => true);
  const seq = tripStopTimes(zip, trips);

  for (const [trip, rows] of seq) {
    const info = trips.get(trip);
    for (const [, stop, secs] of rows) {
      addDeparture(stop, [info.num, info.head, secs], info.w, info.f);
    }
    addPath(info.num, info.head, rows.map((r) => r[1]), rows.map((r) => r[2] - rows[0][2]));
  }

  // Nimed siit on kanoonilised — riiklik register lisab neile "(train station)".
  const stops = table(zip, 'stops.txt');
  for (const l of stops.rows) {
    const c = splitCsv(l);
    const id = c[stops.ix.stop_id];
    names.set(id, clean(c[stops.ix.stop_name]));
    coords.set(id, [+c[stops.ix.stop_lat], +c[stops.ix.stop_lon]]);
  }
  return { routeCount, tripCount: trips.size };
}

/* ---------- Voog 2: Harjumaa maakonnaliinid ---------- */

/**
 * Liinid, mille kasvõi üks sõit peatub Tallinnas. Küla-sisesed liinid
 * (Rae sise, Saue sise jt) kukuvad siin välja — laps neile koolist koju
 * sõites ei satu, aga nad kolmekordistaksid andmemahu.
 */
function routesTouchingTallinn(seq, trips, inTallinn) {
  const keep = new Set();
  for (const [trip, rows] of seq) {
    if (rows.some((r) => inTallinn.has(r[1]))) keep.add(trips.get(trip).route);
  }
  return keep;
}

function harvestCounty(zip, today) {
  // Peatused enne sõite: nende järgi otsustame, mis on "Tallinnas".
  const stops = table(zip, 'stops.txt');
  const inTallinn = new Set();
  const county = new Map();   // peatus -> [nimi, vald, lat, lon]
  for (const l of stops.rows) {
    const c = splitCsv(l);
    const id = c[stops.ix.stop_id];
    const name = clean(c[stops.ix.stop_name]);
    const lat = +c[stops.ix.stop_lat];
    const lon = +c[stops.ix.stop_lon];
    if (c[stops.ix.authority] === TALLINN) {
      inTallinn.add(id);
      // Kui TLT voog seda peatust ei tundnud, võtame nime siit.
      if (!names.has(id)) { names.set(id, name); coords.set(id, [lat, lon]); }
      continue;
    }
    county.set(id, [name, c[stops.ix.stop_area], lat, lon]);
  }

  const { routeCount, trips } = weekdayTrips(zip, today, (c, ix) =>
    COUNTY_AGENCY.test(c[ix.agency_id]));
  const seq = tripStopTimes(zip, trips);

  const keep = routesTouchingTallinn(seq, trips, inTallinn);

  let kept = 0;
  for (const [trip, rows] of seq) {
    const info = trips.get(trip);
    if (!keep.has(info.route)) continue;
    kept++;
    for (const [, stop, secs] of rows) {
      addDeparture(stop, [info.num, info.head, secs], info.w, info.f);
    }
    addPath(info.num, info.head, rows.map((r) => r[1]), rows.map((r) => r[2] - rows[0][2]));
  }

  let named = 0;
  for (const [id, [name, area, lat, lon]] of county) {
    if (!perStop.has(id)) continue;
    if (!names.has(id)) { coords.set(id, [lat, lon]); named++; }
    names.set(id, stopName(names.get(id), name, area));
  }

  return { routeCount, keptRoutes: keep.size, tripCount: kept, countyStops: named };
}

/* ---------- Peamine ---------- */

async function load(url) {
  process.stdout.write(`Laen ${url} ... `);
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`GTFS HTTP ${res.status} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  return unzip(buf);
}

async function main() {
  // BUS_DATE=20260901 laseb kontrollida, mis seis on tulevasel kuupäeval —
  // maakonnaliinide sõiduplaanid vahetuvad õppeaasta alguses.
  const today = process.env.BUS_DATE || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (!/^\d{8}$/.test(today)) throw new Error(`BUS_DATE peab olema YYYYMMDD, sai "${today}"`);

  const tlt = harvestTallinn(await load(TLT_GTFS), today);
  console.log(`  Tallinn: ${tlt.routeCount} liini, ${tlt.tripCount} sõitu`);

  const cty = harvestCounty(await load(EE_GTFS), today);
  console.log(`  Harjumaa: ${cty.keptRoutes}/${cty.routeCount} liini puudutab Tallinna, ` +
              `${cty.tripCount} sõitu, ${cty.countyStops} maakonnapeatust`);

  // Kui voo kuju muutub, on kahjutum siin katkeda kui avaldada sait, kust
  // lapse buss on vaikselt kadunud — deploy jääb tegemata ja vana jääb püsti.
  const floors = [
    ['Tallinna liine', tlt.routeCount, 50],
    ['Tallinna sõite', tlt.tripCount, 2000],
    ['maakonnaliine', cty.keptRoutes, 50],
    ['maakonnasõite', cty.tripCount, 1000],
    ['peatusi graafikuga', perStop.size, 1500],
  ];
  for (const [what, got, min] of floors) {
    if (got < min) throw new Error(`Liiga vähe: ${what} ${got}, ootasin vähemalt ${min}`);
  }

  // --- Peatuste nimekiri ---
  const stopList = [];
  for (const id of perStop.keys()) {
    const name = names.get(id);
    const xy = coords.get(id);
    if (!name || !xy) continue;   // graafikuta või tundmatu peatus jääb otsingust välja
    stopList.push([+id, name, +xy[0].toFixed(5), +xy[1].toFixed(5)]);
  }
  stopList.sort((a, b) => a[1].localeCompare(b[1], 'et'));

  // --- Kirjuta ---
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'stop'), { recursive: true });

  await writeFile(join(OUT, 'stops.json'), JSON.stringify(stopList), 'utf8');
  await writeFile(join(OUT, 'routes.json'), JSON.stringify(paths), 'utf8');

  let bytes = 0;
  for (const [stop, v] of perStop) {
    const byTime = (a, b) => a[2] - b[2];
    v.w.sort(byTime);
    v.f.sort(byTime);
    const j = JSON.stringify(v);
    bytes += j.length;
    await writeFile(join(OUT, 'stop', `${stop}.json`), j, 'utf8');
  }

  console.log(`Peatusi: ${stopList.length}`);
  console.log(`Liini-suundi: ${Object.keys(paths).length}`);
  console.log(`Graafikufaile: ${perStop.size}, kokku ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`-> ${OUT}`);
}

export { activeOn, clean, countyName, stopName, splitCsv, splitRow, linesOf, routesTouchingTallinn };

const runDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (runDirectly) {
  main().catch((err) => {
    console.error(`\nViga bussiandmete laadimisel: ${err.message}`);
    process.exit(1);
  });
}
