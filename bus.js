/* Bussiloogika. Ilma DOM-ita, et oleks testitav.
   Andmed: bus/stops.json, bus/routes.json, bus/stop/<id>.json (vt bus-data.mjs). */

/** Suunad: hommikul kooli, pärast tunde koju. */
export const TO_SCHOOL = 'am';
export const TO_HOME = 'pm';

export const DEFAULT_WALK_MIN = 5;

/** Kõik peatuse-id-d, mis kannavad sama nime (Virul on viis platvormi). */
export function idsByName(stops, name) {
  return stops.filter((s) => s[1] === name).map((s) => s[0]);
}

/** Unikaalsed peatusenimed otsingu jaoks. */
export function searchStops(stops, query, limit = 12) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const seen = new Set();
  const out = [];
  for (const s of stops) {
    const name = s[1];
    const lower = name.toLowerCase();
    if (!lower.includes(q) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= limit) break;
  }
  // Nime algusest leitud vasted ette, siis lühemad — "vir" peaks andma
  // enne "Viru" kui "Vironia".
  return out.sort((a, b) => {
    const ai = a.toLowerCase().startsWith(q) ? 0 : 1;
    const bi = b.toLowerCase().startsWith(q) ? 0 : 1;
    return ai - bi || a.length - b.length || a.localeCompare(b, 'et');
  });
}

/**
 * Leia liinid, mis läbivad lähtepeatust ja SEEJÄREL sihtpeatust.
 * Tagastab ka need lähteplatvormid, mis päriselt õiges suunas sõidavad —
 * nii ei pea laps teadma, kumbal pool teed seista — ning iga liini sõiduaja
 * lähtepeatusest sihtpeatuseni, millest saab saabumisaja.
 */
export function matchRoutes(paths, fromIds, toIds) {
  const from = new Set(fromIds.map(String));
  const to = new Set(toIds.map(String));
  const routes = [];
  const usable = new Set();
  const rides = {};

  for (const [key, path] of Object.entries(paths)) {
    const stops = path.s;
    let firstFrom = -1;
    for (let i = 0; i < stops.length; i++) {
      if (firstFrom === -1 && from.has(stops[i])) { firstFrom = i; continue; }
      if (firstFrom !== -1 && to.has(stops[i])) {
        routes.push(key);
        usable.add(Number(stops[firstFrom]));
        // Sõiduaeg = vahe sihtpeatuse ja lähtepeatuse nihkes liini algusest.
        if (path.t) rides[key] = path.t[i] - path.t[firstFrom];
        break;
      }
    }
  }
  return { routes: [...new Set(routes)], fromIds: [...usable], rides };
}

/* ---------- Reaalaja vastuse parsimine ---------- */

/**
 * transport.tallinn.ee/siri-stop-departures.php?stopid=N
 *   päis: Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,<serveri kell>,version
 *   rida: bus,36,33174,33098,Väike-Õismäe,15,Z
 * Serveri kella kasutame telefoni kella asemel — see on usaldusväärsem.
 */
export function parseSiri(text) {
  const lines = String(text).replace(/\r/g, '').trim().split('\n');
  if (!lines.length) return { now: null, rows: [] };

  const head = lines[0].split(',');
  const now = Number(head[4]);
  const rows = [];

  for (const line of lines.slice(1)) {
    const c = line.split(',');
    if (c.length < 6 || c[0] === 'stop') continue;
    const expected = Number(c[2]);
    if (!Number.isFinite(expected)) continue;
    const scheduled = Number(c[3]);
    rows.push({
      kind: c[0],                 // bus | trol | tram
      route: c[1],
      head: c[4] || '',
      secs: expected,
      // Graafikujärgne aeg — selle abil seome reaalajarea küpsetatud graafikuga.
      // Ilma selleta tekiks hilinevast bussist kaks kirjet.
      schedSecs: Number.isFinite(scheduled) ? scheduled : expected,
      live: true,
    });
  }
  rows.sort((a, b) => a.secs - b.secs);
  return { now: Number.isFinite(now) ? now : null, rows };
}

/* ---------- Väljumiste valik ---------- */

const keyOf = (r) => `${r.route}|${r.head}`;

/** Graafikurida [liin, suund, sekundid] -> ühtne kuju. */
export const fromSchedule = ([route, head, secs]) => ({ kind: 'bus', route, head, secs, live: false });

/**
 * Järgmised `limit` väljumist, mis sobivad lubatud liinidega ja väljuvad
 * pärast `afterSecs`. Reaalajarida kirjutab sama liini graafikurea üle.
 */
const SAME_TRIP_TOLERANCE = 90;   // sekundit

export function nextDepartures({ scheduled = [], live = [], routes, afterSecs, limit = 3 }) {
  const allow = routes?.length ? new Set(routes) : null;
  const ok = (r) => (!allow || allow.has(keyOf(r))) && r.secs >= afterSecs;

  const picked = live.filter(ok);

  // Graafikust täidame puudujäägi, aga jätame välja need väljumised, mis on
  // reaalajas juba olemas. Võrdleme graafikujärgset aega, mitte oodatavat —
  // hilinenud buss on ikka sama buss.
  for (const r of scheduled.filter(ok)) {
    const dup = picked.some(
      (l) => l.live && keyOf(l) === keyOf(r) && Math.abs(l.schedSecs - r.secs) <= SAME_TRIP_TOLERANCE
    );
    if (!dup) picked.push(r);
  }

  return picked.sort((a, b) => a.secs - b.secs).slice(0, limit);
}

/** Millal buss sihtpeatusse jõuab. Ilma sõiduajata tagastab null. */
export function arrivalOf(r, rides) {
  const ride = rides?.[keyOf(r)];
  return Number.isFinite(ride) ? r.secs + ride : null;
}

/**
 * Hommikused väljumised: need, millega laps jõuab enne `arriveBy` kohale.
 * Näitame VIIMASED `limit` sobivat — hommikul on tähtis teada, kui kaua veel
 * venitada saab, mitte see, mis läks kell kuus.
 * Kui ükski enam ei jõua, anname ikka järgmised, aga ütleme seda ausalt.
 */
export function morningDepartures({ scheduled = [], live = [], routes, rides, afterSecs, arriveBy, limit = 3 }) {
  const all = nextDepartures({ scheduled, live, routes, afterSecs, limit: Infinity });
  const inTime = all.filter((r) => {
    const a = arrivalOf(r, rides);
    return a == null || a <= arriveBy;
  });
  const rows = inTime.length ? inTime.slice(-limit) : all.slice(0, limit);
  return { rows, madeIt: inTime.length > 0, last: inTime.length ? inTime[inTime.length - 1] : null };
}

/** Mitu minutit on väljumiseni (ümardatud allapoole). */
export const minutesUntil = (secs, now) => Math.floor((secs - now) / 60);

/** Millal peab peatuse poole liikuma hakkama. */
export const leaveInMinutes = (secs, now, walkMin) => minutesUntil(secs, now) - walkMin;

/** Graafikuvariant: reedel on Tallinnas rohkem hilisõhtuseid väljumisi. */
export const scheduleKeyForDay = (dayIndex) => (dayIndex === 4 ? 'f' : 'w');
