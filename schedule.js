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
/** Eelmine päev ISO-kujul. Kuupäev ehitame osadest, et ajavöönd ei nihutaks. */
const dayBefore = (isoDay) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return iso(addDays(new Date(y, m - 1, d), -1));
};
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
  const years = holidays.schoolYears || [];
  let exemptFromBreak = false;
  for (const y of years) {
    for (const b of y.breaks || []) {
      if (day < b.from || day > b.to) continue;
      if (b.exceptGrades?.includes(grade)) { exemptFromBreak = true; continue; }  // nt 12. klassil kevadvaheaega pole
      return { name: b.name, until: b.to, kind: 'break' };
    }
  }
  // 9. ja 12. klass käivad suvevaheajal veel eksamitel — nende jaoks on see
  // koolipäev, ka siis kui õppeaasta ametlik lõpp on möödas.
  if (exemptFromBreak) return null;

  // Väljaspool õppeaastat koolipäevi pole. `start` ja `end` olid failis juba
  // olemas, aga kasutamata — ilma selle kontrollita oleks 31. august tavaline
  // koolipäev ja rakendus näitaks tunde, mida pole.
  if (years.length && !years.some((y) => day >= y.start && day <= y.end)) {
    const next = years.map((y) => y.start).filter((s) => s > day).sort()[0];
    // Nimi käib bänneri pealkirjaks, kehatekst ütleb juba "Koolivaheaeg kuni…",
    // seega üldnimi kordaks ennast. Õppeaasta ette jääb Eestis alati suvi.
    return { name: 'Suvevaheaeg', until: next ? dayBefore(next) : day, kind: 'break' };
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

/**
 * Erandpäev: aktus, klassijuhatajatund vms, mida kooli tunniplaanis ei ole.
 * Tagastab selle klassi sündmused või null, kui päev on tavaline.
 */
export function overrideOn(overrides, date, klass) {
  const day = overrides?.days?.[iso(date)];
  const events = day?.classes?.[klass];
  if (!events?.length) return null;
  return { notice: day.notice ?? null, events };
}

/** Selle päeva nimepäevad. */
export function namesOn(namedays, date) {
  return namedays?.days?.[MD(date)] ?? [];
}

/* ---------- Söögivahetund ---------- */

/**
 * Kooli reegel (tundide-ajad leht): söögivahetund kestab 30 minutit ja
 * söömise aken selle sees 15. Tunniplaani tabelis on aken, mitte vahetund.
 *   :30 algus -> vahetund :30–:00 (söömine alguses)
 *   :45 algus -> vahetund :45–:15 (söömine alguses)
 *   :00 algus -> vahetund :45–:15 (söömine lõpus, vahetund algab 15 min varem)
 *
 * 1.–2. klassil (1A–1E, 2C, 2D) on aken 20 minutit ja algused :40/:50 —
 * need ei mahu kooli ametlikku üheksa sloti loendisse. Neil tagastame null
 * ja näitame ainult akent, nagu koolil kirjas: parem vähem kui vale.
 */
function breakAround(eat) {
  if (eat.end - eat.start !== 15) return null;
  const m = eat.start % 60;
  if (m === 30 || m === 45) return { start: eat.start, end: eat.start + 30 };
  if (m === 0) return { start: eat.start - 15, end: eat.start + 15 };
  return null;
}

const HHMM = /(\d{1,2})[:.](\d{2})/g;
const toMin = (h, m) => Number(h) * 60 + Number(m);

/**
 * Söögiaja lahter kooli tunniplaanist. Kolm kuju:
 *   "11:00 - 11:20"
 *   "11:00 - 11:15 4. tund algab ja lõppeb 15 min hiljem 4. tund kestab 11.15-12.00"
 *   "11:30 - 11:45 Söömine on pärast paaristundi. 5. tund algab kell 12.00"
 * Kellaaja eraldaja on enamasti koolon, aga ühes kirjes on punkt — mõlemad käivad.
 *
 * -> { eat: {start, end}, break: {start, end}|null, note, shift: {periodN, start, end}|null }
 */
export function parseLunch(str) {
  const s = String(str ?? '').trim();
  if (!s) return null;

  HHMM.lastIndex = 0;
  const eatFrom = HHMM.exec(s);
  const eatTo = HHMM.exec(s);
  if (!eatFrom || !eatTo) return null;

  const eat = { start: toMin(eatFrom[1], eatFrom[2]), end: toMin(eatTo[1], eatTo[2]) };

  // Nihe: kool ütleb tunni uue kestuse ("4. tund kestab 11.15-12.00") või
  // ainult uue alguse ("5. tund algab kell 12.00", paaristunni järel).
  let shift = null;
  const kestab = /(\d+)\. tund kestab\s*(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})/.exec(s);
  if (kestab) {
    shift = {
      periodN: Number(kestab[1]),
      start: toMin(kestab[2], kestab[3]),
      end: toMin(kestab[4], kestab[5]),
    };
  }

  // Kooli märkus ilma kellaaegadeta — söömise akna järelt, ilma nihkelauseta.
  const note = s
    .slice(eatTo.index + eatTo[0].length)
    .replace(/\d+\. tund kestab[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim() || null;

  return { eat, break: breakAround(eat), note, shift };
}
