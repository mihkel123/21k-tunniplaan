/* Ilm kooli asukohas. Ilma DOM-ita, et oleks testitav.
   Allikas: Open-Meteo — võtmeta, CORS lubatud, tunnipõhine prognoos. */

/** Tallinna 21. Kool, Raua 6. Koolimaja ise, mitte linna keskpunkt. */
export const SCHOOL = { lat: 59.4352, lon: 24.7665 };

/** Prognoos uuesti, kui salvestatu on sellest vanem. Open-Meteo ise arvutab
    kord tunnis, seega tihedamalt küsimine ei annaks uut infot. */
export const REFRESH_AFTER_MS = 30 * 60 * 1000;
/** Sellest vanem vahemälu visatakse ära: vana prognoos on halvem kui tühi rida. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/* Läved. Alla nende jääb vastav osa reast välja — pool rida infot on parem
   kui terve rida müra. */
export const POP_MIN = 10;          // sademete tõenäosus, %
export const FEELS_GAP = 3;         // kraadi, millest alates "tundub" midagi ütleb
/* Ilmateenistuse skaala: mõõdukas 3,4–7,9; tugev 8,0–13,8; väga tugev alates 13,9.
   Näitame mõõdukast alles ülemisest poolest — 4 m/s pole märkimisväärne. */
export const WIND_MODERATE = 5.5;
export const WIND_STRONG = 8;
export const WIND_VERY_STRONG = 13.9;

/* Väljade järjekord vahemälus. Massiiv, mitte objekt: localStorage'i läheb
   168 tundi ja võtmenimede kordamine kolmekordistaks mahu. */
const TEMP = 0, FEELS = 1, POP = 2, CODE = 3, WIND = 4;

export function forecastUrl({ lat = SCHOOL.lat, lon = SCHOOL.lon, days = 7 } = {}) {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m',
    wind_speed_unit: 'ms',
    timezone: 'Europe/Tallinn',
    forecast_days: String(days),
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Vastuse rööpmassiivid -> { '2026-09-01T09:00': [temp, tundub, sadu%, kood, tuul] } */
export function indexHourly(json) {
  const h = json?.hourly;
  if (!h?.time?.length) return null;
  const out = {};
  for (let i = 0; i < h.time.length; i++) {
    out[h.time[i]] = [
      h.temperature_2m?.[i] ?? null,
      h.apparent_temperature?.[i] ?? null,
      h.precipitation_probability?.[i] ?? null,
      h.weather_code?.[i] ?? null,
      h.wind_speed_10m?.[i] ?? null,
    ];
  }
  return out;
}

/** Täistunnid, mida ajavahemik puudutab. 8:00–8:45 -> [8]; 10:00–11:45 -> [10, 11]. */
function hoursTouched(startMin, endMin) {
  const first = Math.floor(startMin / 60);
  const last = Math.floor((Math.max(endMin, startMin + 1) - 1) / 60);
  const out = [];
  for (let h = first; h <= last && h < 24; h++) if (h >= 0) out.push(h);
  return out;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Kokkuvõte ühe ajavahemiku kohta või null, kui prognoosi ei ulatu.
 * Vahemikust võtame halvima: madalaima ja kõrgeima kraadi, suurima
 * sademetõenäosuse, tugevaima tuule ja tõsiseima ilmakoodi.
 */
export function summarize(hours, isoDay, startMin, endMin) {
  if (!hours) return null;
  const temps = [], feels = [], pops = [], codes = [], winds = [];

  for (const h of hoursTouched(startMin, endMin)) {
    const row = hours[`${isoDay}T${String(h).padStart(2, '0')}:00`];
    if (!row) continue;
    const t = num(row[TEMP]);
    if (t != null) temps.push(t);
    const f = num(row[FEELS]);
    if (f != null) feels.push(f);
    const p = num(row[POP]);
    if (p != null) pops.push(p);
    const c = num(row[CODE]);
    if (c != null) codes.push(c);
    const w = num(row[WIND]);
    if (w != null) winds.push(w);
  }
  if (!temps.length) return null;

  const tempMin = Math.min(...temps);
  const tempMax = Math.max(...temps);

  // "Tundub" ainult siis, kui tuul või niiskus asja päriselt muudab. Võrdleme
  // vahemikku vahemikuga, et number ei satuks näidatud kraadide sisse —
  // "16–20°, tundub 17°" oleks segadus, "16–20°, tundub 13°" on riietumisotsus.
  let feel = null;
  if (feels.length) {
    const feelMin = Math.min(...feels);
    const feelMax = Math.max(...feels);
    if (tempMin - feelMin >= FEELS_GAP) feel = feelMin;
    else if (feelMax - tempMax >= FEELS_GAP) feel = feelMax;
  }

  return {
    tempMin,
    tempMax,
    feels: feel,
    pop: pops.length ? Math.max(...pops) : null,
    // WMO kood kasvab enam-vähem tõsiduse järgi (0 selge … 99 äike), seega
    // suurim kood on selle akna halvim ilm.
    code: codes.length ? Math.max(...codes) : null,
    wind: winds.length ? Math.max(...winds) : null,
  };
}

export function windLabel(ms) {
  if (ms == null) return null;
  if (ms >= WIND_VERY_STRONG) return 'väga tugev tuul';
  if (ms >= WIND_STRONG) return 'tugev tuul';
  if (ms >= WIND_MODERATE) return 'mõõdukas tuul';
  return null;
}

const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const SLEET = new Set([56, 57, 66, 67]);

/** Sademete liik ilmakoodist: osastav kääne, sest käib koos protsendiga. */
export function precipWord(code) {
  if (SNOW.has(code)) return 'lund';
  if (SLEET.has(code)) return 'lörtsi';
  return 'vihma';
}

export function iconFor(code) {
  if (code == null) return '🌤️';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 95) return '⛈️';
  if (SNOW.has(code)) return '❄️';
  if (code >= 51 && code <= 57) return '🌦️';
  return '🌧️';
}

const round = (n) => Math.round(n);

/** Kokkuvõte reaks: { icon, text } või null, kui midagi öelda pole. */
export function formatWeather(sum) {
  if (!sum) return null;
  const lo = round(sum.tempMin);
  const hi = round(sum.tempMax);
  const parts = [lo === hi ? `${lo}°` : `${lo}–${hi}°`];

  if (sum.feels != null) parts.push(`tundub ${round(sum.feels)}°`);
  if (sum.pop != null && sum.pop >= POP_MIN) parts.push(`${precipWord(sum.code)} ${round(sum.pop)}%`);

  const wind = windLabel(sum.wind);
  if (wind) parts.push(wind);

  return { icon: iconFor(sum.code), text: parts.join(' · ') };
}

/* ---------- Kus ilma üldse näidata ---------- */

export const isPeSubject = (name) => /liikumis|kehaline/i.test(name || '');

/**
 * 1. detsembrist 31. märtsini toimub liikumisõpetus sees — siis ei ütle
 * õuetemperatuur tunni kohta midagi. Väliüritustele see reegel ei laiene:
 * need on käsitsi õueks märgitud, seega ilm loeb ka detsembris.
 */
export function peWeatherSeason(date) {
  const month = date.getMonth() + 1;
  return !(month === 12 || month <= 3);
}

/** Sündmuse algus minutites või null, kui aeg pole kellaaeg ("pärast aktust"). */
export function eventStartMin(at) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(at ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
