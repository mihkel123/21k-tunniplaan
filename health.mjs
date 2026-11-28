#!/usr/bin/env node
// Igapäevane terviseülevaade: kas öine uuendus läks läbi ja kas live-andmed on
// mõistlikud. Kasutus:  node health.mjs   (vajab gh CLI-d ja internetti)
//
// Väljund on JSON: { level: 'ok' | 'problem', newProblems, ongoing, resolved, info }.
// "Probleem" on ainult suur või segane seis (uuendus katki, kooli andmed
// kadunud, massiline muutus, ujula pilt vahetus) — tavalised tunnimuudatused ei
// ole. Sama probleemi teatatakse uuesti alles 7 päeva pärast; olek on failis
// ~/.config/tunniplaan/health-state.json (mitte repos).

import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SITE = 'https://tunniplaan.pages.dev';
const WORKFLOW = 'Uuenda tunniplaan';
const STATE_DIR = join(homedir(), '.config', 'tunniplaan');
const STATE = join(STATE_DIR, 'health-state.json');
const REALERT_MS = 7 * 86400000;
const MASS_CHANGE = 100;          // nii palju muutunud pesi ühe korraga = midagi on lahti

const problems = [];
const info = [];
const problem = (key, text) => problems.push({ key, text });

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

async function getJson(path) {
  const res = await fetch(`${SITE}/${path}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- 1. CI jooksud ---
let runs = [];
try {
  runs = JSON.parse(gh('run', 'list', '--workflow', WORKFLOW, '--limit', '15',
    '--json', 'databaseId,conclusion,status,createdAt,event,displayTitle'));
} catch (err) {
  problem('gh', `GitHubi jookse ei saanud lugeda: ${err.message.split('\n')[0]}`);
}
const done = runs.filter((r) => r.status === 'completed');
const last = done[0];
if (last && last.conclusion !== 'success') {
  problem('ci-failed', `Viimane uuendus (${last.createdAt}, ${last.event}) lõppes: ${last.conclusion}.`);
}
const lastOk = done.find((r) => r.conclusion === 'success');
if (runs.length && (!lastOk || Date.now() - Date.parse(lastOk.createdAt) > 30 * 3600000)) {
  problem('ci-stale', `Ühtegi õnnestunud uuendust pole olnud üle 30 tunni (viimane: ${lastOk?.createdAt ?? 'puudub'}).`);
}

// --- 2. Viimase õnnestunud jooksu logi hoiatused ---
if (lastOk) {
  let log = '';
  try { log = gh('run', 'view', String(lastOk.databaseId), '--log'); } catch { /* logi pole veel valmis */ }
  const lines = log.split('\n').map((l) => l.replace(/^.*?\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''));
  for (const l of lines) {
    if (/HOIATUS: kooli tunniplaanis pole õpetajaid/.test(l)) {
      problem('teachers-missing', 'Kooli tunniplaanis pole õpetajaid ega ruume — äpp kasutab viimaseid teadaolevaid. Kui kool muudab õpetajat või ruumi, me seda ei näe.');
    } else if (/HOIATUS: (ujula plaan|uus ujula plaan)/.test(l)) {
      problem('swim-source', `Ujula plaan kooli lehel muutus: ${l.replace(/^\s*HOIATUS:\s*/, '')}`);
    } else if (/tundide ajad erinevad/.test(l)) {
      problem('periods', `Tundide ajad erinevad klassiti: ${l.trim()}`);
    } else if (/^Ebaõnnestus \(\d+\)/.test(l.trim())) {
      problem('scrape-failures', `Osa klasse jäi lugemata: ${l.trim()}`);
    } else if (/^\s*HOIATUS/.test(l) && !/HOIATUS\s+ujula:/.test(l)) {
      info.push(l.trim());
    }
    const m = /Muudatusi eelmisest korrast: (\d+)/.exec(l);
    if (m && Number(m[1]) >= MASS_CHANGE) {
      problem('mass-change', `Ühe uuendusega muutus ${m[1]} tunnipesa — kooli andmetes võib olla midagi valesti.`);
    }
  }
}

// --- 3. Live-andmed ---
try {
  const data = await getJson('data.json');
  const classes = Object.values(data.classes ?? {});
  const entries = classes.flatMap((c) => c.grid.flat(2));
  if (classes.length < 40) problem('classes', `Live'is on ainult ${classes.length} klassi.`);
  const noTeacher = entries.filter((e) => !e.teacher).length;
  if (entries.length && noTeacher / entries.length > 0.05) {
    problem('live-no-teachers', `Live'is on ${noTeacher}/${entries.length} tunnil õpetaja puudu.`);
  }
  if (data.notice) info.push(`Kooli teade tunniplaanis: ${data.notice}`);
} catch (err) {
  problem('live-data', `Live data.json ei laadinud: ${err.message}`);
}
try {
  const swim = await getJson('swim.json');
  for (const p of swim.plans ?? []) if (p.stale) problem('swim-stale', `Ujula plaan "${p.name}" on vananenud — vaja üle kirjutada.`);
  const lastWeek = (swim.plans ?? []).flatMap((p) => p.weeks ?? []).sort().pop();
  if (lastWeek) info.push(`Ujula plaan kehtib kuni nädalani ${lastWeek}.`);
} catch (err) {
  info.push(`swim.json ei laadinud: ${err.message}`);
}
try {
  const menu = await getJson('menu.json');
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = Object.keys(menu.days ?? {});
  if (d.getDay() >= 1 && d.getDay() <= 5 && !days.includes(today)) info.push('Tänase päeva söökla menüüd pole.');
} catch { /* menüü on lisa */ }

// --- 4. Olek: teata uuest, mitte iga päev samast ---
let state = {};
try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch { /* esimene kord */ }
const now = Date.now();
const next = {};
const newProblems = [];
const ongoing = [];
for (const p of problems) {
  const prev = state[p.key];
  const alert = !prev || now - prev.alertedAt > REALERT_MS;
  next[p.key] = { firstSeen: prev?.firstSeen ?? new Date(now).toISOString(), alertedAt: alert ? now : prev.alertedAt };
  (alert ? newProblems : ongoing).push(p);
}
const resolved = Object.keys(state).filter((k) => !next[k]);
await mkdir(STATE_DIR, { recursive: true });
await writeFile(STATE, JSON.stringify(next, null, 2) + '\n', 'utf8');

const level = newProblems.length || resolved.length ? 'problem' : 'ok';
console.log(JSON.stringify({ level, newProblems, ongoing, resolved, info, lastRun: last ? `${last.createdAt} ${last.conclusion}` : null }, null, 2));
