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
export const POP_MIN = 10;          // sademete tõenäosus, mille juures sõna üldse ilmub, %
/* Ikooni jaoks eraldi, veidi kõrgemad läved: "vihmapilv" peab tähendama
   päriselt suurt tõenäosust, mitte igasugust sadu. */
export const POP_MAYBE = 30;        // "võib sadada" — pilv koos päikesega
export const POP_LIKELY = 60;       // "vihma/lume/lörtsi" ikoon
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
const round = (n) => Math.round(n);

/**
 * Tunnetuslik temperatuur reale — ainult siis, kui see ümardatuna jääb
 * näidatud kraadivahemikust välja. Kui vahemik on juba "16–20°" ja tundub
 * jääb sinna sisse, ei ütle number midagi uut ja jääb ära. Kui akna sees
 * tunnetuslik nii jahedam kui soojem hälbib, valime suurema hälbega otsa.
 */
function pickFeel(tempMin, tempMax, feels) {
  if (!feels.length) return null;
  const feelMin = Math.min(...feels);
  const feelMax = Math.max(...feels);
  const lo = round(tempMin);
  const hi = round(tempMax);
  const diffLow = lo - round(feelMin);   // > 0: tundub näidatud alampiirist külmem
  const diffHigh = round(feelMax) - hi;  // > 0: tundub näidatud ülempiirist soojem
  if (diffLow > 0 && diffHigh > 0) return diffLow >= diffHigh ? feelMin : feelMax;
  if (diffLow > 0) return feelMin;
  if (diffHigh > 0) return feelMax;
  return null;
}

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const SLEET_CODES = new Set([56, 57, 66, 67]);
const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82]);

/**
 * Sademe liik. WMO kood ütleb liigi otse peaaegu alati; erand on siis, kui
 * kood ise sadu ei näita (selge/pilves/udu), aga sademetõenäosus on ikkagi
 * suur — ansambliprognoos ja "kõige tõenäolisem" kood lähevad mõnikord lahku.
 * Sel juhul otsustab kraad: alla +1° lumi, muidu vihm.
 */
export function precipKind(code, temp) {
  if (SNOW_CODES.has(code)) return 'snow';
  if (SLEET_CODES.has(code)) return 'sleet';
  if (RAIN_CODES.has(code)) return 'rain';
  return temp != null && temp < 1 ? 'snow' : 'rain';
}

export function precipWord(kind) {
  if (kind === 'snow') return 'Lumi';
  if (kind === 'sleet') return 'Lörts';
  return 'Vihm';
}

export function windLabel(ms) {
  if (ms == null) return null;
  if (ms >= WIND_VERY_STRONG) return 'Väga tugev tuul';
  if (ms >= WIND_STRONG) return 'Tugev tuul';
  if (ms >= WIND_MODERATE) return 'Mõõdukas tuul';
  return null;
}

/**
 * Ikoon käib alati sademetõenäosusega kokku — see on nii ka arvutatud, mitte
 * eraldi koodist tuletatud. Ilmakood üksi valetaks: "peamiselt selge" kood
 * kõrvuti 46% sajuvõimalusega näitaks päikest, kus tegelikult vihma oodata.
 * Äike on ainus erand — see on hoiatus sõltumata protsendist.
 */
export function iconFor(code, pop, kind) {
  if (code != null && code >= 95) return '⛈️';

  const p = pop ?? 0;
  if (p >= POP_LIKELY) {
    if (kind === 'snow') return '❄️';
    if (kind === 'sleet') return '🌨️';
    return '🌧️';
  }
  if (p >= POP_MAYBE) return '🌦️';

  if (code === 0) return '☀️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  return '🌤️';       // selge kuni kergelt pilves, ja tundmatu kood
}

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
  // WMO kood kasvab enam-vähem tõsiduse järgi (0 selge … 99 äike), seega
  // suurim kood on selle akna halvim ilm.
  const code = codes.length ? Math.max(...codes) : null;

  return {
    tempMin,
    tempMax,
    feels: pickFeel(tempMin, tempMax, feels),
    pop: pops.length ? Math.max(...pops) : null,
    code,
    kind: precipKind(code, tempMin),
    wind: winds.length ? Math.max(...winds) : null,
  };
}

/** Kokkuvõte reaks: { icon, text } või null, kui midagi öelda pole. */
export function formatWeather(sum) {
  if (!sum) return null;
  const lo = round(sum.tempMin);
  const hi = round(sum.tempMax);
  const parts = [lo === hi ? `${lo}°` : `${lo}–${hi}°`];

  if (sum.feels != null) parts.push(`Tundub ${round(sum.feels)}°`);
  if (sum.pop != null && sum.pop >= POP_MIN) parts.push(`${precipWord(sum.kind)} ${round(sum.pop)}%`);

  const wind = windLabel(sum.wind);
  if (wind) parts.push(wind);

  return { icon: iconFor(sum.code, sum.pop, sum.kind), text: parts.join(' · ') };
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
