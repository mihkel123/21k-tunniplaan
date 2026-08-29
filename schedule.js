/* Kuupäeva- ja koolipäevaloogika. Ilma DOM-ita, et oleks testitav. */

export const DAY_LETTER = ['E', 'T', 'K', 'N', 'R'];
export const DAY_NAME = ['Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede'];
export const CUTOVER_HOUR = 16;
export const CHANGE_TTL_DAYS = 14;

const MONTHS = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni',
  'juuli', 'august', 'september', 'oktoober', 'november', 'detsember'];

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/** 0 = esmaspäev … 6 = pühapäev */
export const weekdayIndex = (d) => (d.getDay() + 6) % 7;
export const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const gradeOf = (klass) => parseInt(klass, 10) || 0;
export const formatDay = (d) => `${d.getDate()}. ${MONTHS[d.getMonth()]}`;

/** Vaheaeg või riigipüha sel kuupäeval, arvestades klassi. Muidu null. */
export function holidayOn(holidays, date, klass) {
  if (!holidays) return null;
  const day = iso(date);
  const grade = gradeOf(klass);

  for (const p of holidays.publicHolidays || []) {
    if (p.date === day) return { name: p.name, until: p.date, kind: 'public' };
  }
  for (const y of holidays.schoolYears || []) {
    for (const b of y.breaks || []) {
      if (day < b.from || day > b.to) continue;
      if (b.exceptGrades?.includes(grade)) continue;  // nt 12. klassil kevadvaheaega pole
      return { name: b.name, until: b.to, kind: 'break' };
    }
  }
  return null;
}

export const isSchoolDay = (holidays, date, klass) =>
  weekdayIndex(date) < 5 && !holidayOn(holidays, date, klass);

/**
 * Vaikimisi näidatav päev.
 * Enne 16:00 -> täna; alates 16:00 -> järgmine päev.
 * Seejärel hüppa üle nädalavahetuste ja vaheaegade.
 */
export function defaultDate(holidays, now, klass) {
  let d = startOfDay(now);
  if (now.getHours() >= CUTOVER_HOUR) d = addDays(d, 1);
  for (let i = 0; i < 400 && !isSchoolDay(holidays, d, klass); i++) d = addDays(d, 1);
  return d;
}

/** "Täna" / "Homme" / null */
export function relativeLabel(selected, now) {
  const diff = Math.round((startOfDay(selected) - startOfDay(now)) / 86400000);
  return diff === 0 ? 'Täna' : diff === 1 ? 'Homme' : null;
}

/** Kas muudatus on veel värske (14 päeva)? */
export function isFreshChange(entry, now) {
  if (!entry?.since) return false;
  return (startOfDay(now) - new Date(entry.since)) / 86400000 <= CHANGE_TTL_DAYS;
}

/* ---------- Riigipühad, tähtpäevad ja nimepäevad ---------- */

/**
 * Ülestõusmispühade 1. püha (gregoriuse anonüümne algoritm).
 * Sellest tuletatakse suur reede, nelipühad ja vastlapäev.
 */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Kuu n-s nädalapäev, nt mai teine pühapäev (weekday 0 = pühapäev). */
export function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + shift + (n - 1) * 7);
}

const MD = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Sellele päevale langevad riigipühad ja tähtpäevad.
 * Tagastab loendi, sest üks päev võib kanda mitut nime (23. juuni on
 * võidupüha ja mõnel aastal ka nelipühad).
 */
export function notableOn(notable, date) {
  if (!notable?.days?.length) return [];
  const year = date.getFullYear();
  const key = MD(date);
  const easter = easterSunday(year);
  const out = [];

  for (const d of notable.days) {
    if (d.date) {
      if (d.date === key) out.push(d);
    } else if (d.easter !== undefined) {
      if (MD(addDays(easter, d.easter)) === key) out.push(d);
    } else if (d.nth) {
      const { month, weekday, n } = d.nth;
      if (MD(nthWeekday(year, month, weekday, n)) === key) out.push(d);
    }
  }
  return out;
}

/** Selle päeva nimepäevad. */
export function namesOn(namedays, date) {
  return namedays?.days?.[MD(date)] ?? [];
}
