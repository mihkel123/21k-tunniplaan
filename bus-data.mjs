#!/usr/bin/env node
/**
 * Laeb Tallinna ühistranspordi GTFS-i ja kirjutab kausta ./bus/ :
 *   stops.json      - peatused otsinguks
 *   routes.json     - liin|suund -> peatuste järjekord (suunatuvastuseks)
 *   stop/<id>.json  - ühe peatuse graafik (E-N ja reede eraldi)
 *
 * Neid faile ei commitita — need on tuletatud andmed, mis tekivad iga deploy'ga.
 * Kasutus: node bus-data.mjs
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const GTFS_URL = 'https://transport.tallinn.ee/data/gtfs.zip';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'bus');

/* ---------- Minimaalne ZIP-lugeja (ilma väliste teekideta) ---------- */

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
    const raw = buf.subarray(start, start + compSize);

    files.set(name, method === 0 ? raw : inflateRawSync(raw));
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

function table(text) {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const head = splitCsv(lines[0].replace(/^﻿/, ''));
  const ix = Object.fromEntries(head.map((h, i) => [h, i]));
  return { ix, rows: lines.slice(1) };
}

const toSecs = (hhmmss) => {
  const [h, m, s] = hhmmss.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

/* ---------- Peamine ---------- */

async function main() {
  process.stdout.write(`Laen ${GTFS_URL} ... `);
  const res = await fetch(GTFS_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`GTFS HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const zip = unzip(buf);
  const read = (name) => {
    const b = zip.get(name);
    if (!b) throw new Error(`GTFS: ${name} puudub`);
    return b.toString('utf8');
  };

  // --- Millised teenused kehtivad E-N ja reedel ---
  const cal = table(read('calendar.txt'));
  const monThu = new Set();
  const fri = new Set();
  for (const l of cal.rows) {
    const c = splitCsv(l);
    const id = c[cal.ix.service_id];
    if (c[cal.ix.monday] === '1') monThu.add(id);
    if (c[cal.ix.friday] === '1') fri.add(id);
  }

  // --- Liinid ---
  const routes = table(read('routes.txt'));
  const routeNum = new Map();
  for (const l of routes.rows) {
    const c = splitCsv(l);
    routeNum.set(c[routes.ix.route_id], c[routes.ix.route_short_name]);
  }

  // --- Sõidud ---
  const trips = table(read('trips.txt'));
  const tripInfo = new Map();
  for (const l of trips.rows) {
    const c = splitCsv(l);
    const svc = c[trips.ix.service_id];
    const inW = monThu.has(svc);
    const inF = fri.has(svc);
    if (!inW && !inF) continue;
    tripInfo.set(c[trips.ix.trip_id], {
      num: routeNum.get(c[trips.ix.route_id]) ?? '?',
      head: c[trips.ix.trip_headsign] ?? '',
      w: inW,
      f: inF,
    });
  }

  // --- Peatuste ajad ---
  const stimes = table(read('stop_times.txt'));
  const { trip_id: TI, departure_time: DI, stop_id: SI, stop_sequence: QI } = stimes.ix;
  const perStop = new Map();       // stop -> {w:[], f:[]}
  const seqByTrip = new Map();     // trip -> [[seq, stop]]

  for (const l of stimes.rows) {
    const c = l.split(',');
    const info = tripInfo.get(c[TI]);
    if (!info) continue;
    const stop = c[SI];
    const secs = toSecs(c[DI]);

    if (!perStop.has(stop)) perStop.set(stop, { w: [], f: [] });
    const row = [info.num, info.head, secs];
    if (info.w) perStop.get(stop).w.push(row);
    if (info.f) perStop.get(stop).f.push(row);

    if (!seqByTrip.has(c[TI])) seqByTrip.set(c[TI], []);
    seqByTrip.get(c[TI]).push([+c[QI], stop]);
  }

  // --- Liin|suund -> peatuste järjekord (pikim sõit võidab) ---
  const paths = {};
  for (const [trip, seq] of seqByTrip) {
    const info = tripInfo.get(trip);
    if (!info) continue;
    const key = `${info.num}|${info.head}`;
    seq.sort((a, b) => a[0] - b[0]);
    const stops = seq.map((x) => x[1]);
    if (!paths[key] || stops.length > paths[key].length) paths[key] = stops;
  }

  // --- Peatuste nimekiri ---
  const stopsT = table(read('stops.txt'));
  const stopList = [];
  for (const l of stopsT.rows) {
    const c = splitCsv(l);
    const id = c[stopsT.ix.stop_id];
    if (!perStop.has(id)) continue;   // ilma väljumisteta peatust pole vaja
    stopList.push([
      +id,
      c[stopsT.ix.stop_name],
      +(+c[stopsT.ix.stop_lat]).toFixed(5),
      +(+c[stopsT.ix.stop_lon]).toFixed(5),
    ]);
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

main().catch((err) => {
  console.error(`\nViga bussiandmete laadimisel: ${err.message}`);
  process.exit(1);
});
