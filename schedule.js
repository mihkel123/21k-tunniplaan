/* Kuupäeva- ja koolipäevaloogika. Ilma DOM-ita, et oleks testitav. */

export const DAY_LETTER = ['E', 'T', 'K', 'N', 'R'];
export const DAY_NAME = ['Esmaspäev', 'Teisipäev', 'Kolmapäev', 'Neljapäev', 'Reede'];
export const CUTOVER_HOUR = 16;
export const CHANGE_TTL_SCHOOL_DAYS = 5;

const MONTHS = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni',
  'juuli', 'august', 'september', 'oktoober', 'november', 'detsember'];

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/** 0 = esmaspäev … 6 = pühapäev */
export const weekdayIndex = (d) => (d.getDay() + 6) % 7;
/**
 * ISO-kuupäev kohalikuks Date'iks. new Date('2026-09-09') annaks UTC kesköö,
 * mis on Eesti suveajal 3 tundi varem kui kohalik kesköö — vahed kuupäevade
 * vahel tuleksid siis katki ja päevaarvestus nihkuks.
 */
export const fromIso = (isoDay) => {
  const [y, m, d] = String(isoDay ?? '').split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
    ? new Date(y, m - 1, d)
    : null;
};

/** Eelmine päev ISO-kujul. Kuupäev ehitame osadest, et ajavöönd ei nihutaks. */
const dayBefore = (isoDay) => iso(addDays(fromIso(isoDay), -1));
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

/**
 * Kas muudatus on veel värske? Aken on üks koolinädal: viis koolipäeva
 * alates muudatuse päevast, ja võrdlus on range.
 *
 * Muudatuse võti on 'tund|nädalapäev', mitte kuupäev. Kuues koolipäev on
 * sama nädalapäev nädal hiljem — see on juba tunni järgmine kordus, kus plaan
 * on ammu paigas ja märk valetaks.
 *
 * Koolipäevad, mitte kalendripäevad: 26.10.2026 vaheaja esimesel päeval
 * avaldatud uus plaan oleks kalendrinädalaga aegunud 2.11 hommikul — just
 * siis, kui lapsed tagasi tulid ja märke vajasid. Vaheaeg ja riigipüha
 * aknast ei söö. Ilma holidays-failita loetakse ainult nädalavahetusi.
 * Klassi ei arvestata (ühine changes.json), seega klassipõhine erand nagu
 * 12. klassi kevadvaheaeg pikendab märki seal mõne päeva võrra — ohutu suund.
 */
export function isFreshChange(entry, now, holidays = null) {
  const since = fromIso(entry?.since);
  if (!since) return false;
  const today = startOfDay(now);
  let schoolDays = 0;
  for (let d = since; d < today; d = addDays(d, 1)) {
    if (isSchoolDay(holidays, d)) schoolDays++;
    if (schoolDays >= CHANGE_TTL_SCHOOL_DAYS) return false;
  }
  return true;
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
 * Erandpäev, kahes kujus.
 *
 * 1. Terve päev asendatud (aktus, spordipäev): `classes[klass]` sisaldab
 *    sündmusi ja tavalisi tunde ei näidata.
 * 2. Teade tunniplaani peale (streik, muu teade): sündmusi pole, aga päeval
 *    on riba, ärajäävad tunnid (`cancel`) või infokaardid (`cards`).
 *    Tunniplaan jääb kehtima.
 *
 * -> { title, notice, events, cancel, cards } või null, kui päev on tavaline.
 */
export function overrideOn(overrides, date, klass) {
  const day = overrides?.days?.[iso(date)];
  if (!day) return null;

  const events = day.classes?.[klass] ?? [];
  const cancel = day.cancel ?? [];
  // classCards: ühe klassi teated, mis käivad tavalise plaani PEALE (nt
  // võõrkeelte nädala Kuldvillak 4B-le kell 9). Erinevalt `classes`-ist ei
  // asenda need päeva — tunnid jäävad alles.
  const cards = [...(day.cards ?? []), ...(day.classCards?.[klass] ?? [])];

  // Kui päev asendab tunniplaani, aga seda klassi kirjas pole, on tegu
  // andmelüngaga — parem näidata tavalist plaani kui riba "tunde ei ole"
  // koos tundidega. Teade käib seevastu kogu koolile.
  if (Object.keys(day.classes ?? {}).length && !events.length) return null;
  if (!events.length && !cancel.length && !cards.length && !day.notice) return null;

  return {
    title: day.title ?? 'Erandpäev',
    notice: day.notice ?? null,
    cancelNote: day.cancelNote ?? null,
    events,
    cancel,
    cards,
  };
}

/**
 * Teated, mis sel päeval veel kehtivad — riba päevavaate ülal, sõltumata
 * sellest, millist päeva parasjagu vaadatakse. Erinevalt erandpäevast ei ole
 * see seotud ühe kuupäevaga, vaid aknaga: koosolekust tuletatakse meelde
 * nädal ette, mitte alles koosoleku hommikul.
 *
 * `from` ja `to` on mõlemad kaasa arvatud. Puuduv ots tähendab lahtist otsa.
 */
export function noticesOn(overrides, today) {
  const day = iso(startOfDay(today));
  return (overrides?.notices ?? []).filter(
    (n) => n?.title && (!n.from || day >= n.from) && (!n.to || day <= n.to),
  );
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

/**
 * Kummas 30-minutilise vahetunni pooles see klass sööb.
 * Kool ütleb sedasama sõnadega ("4. tunni alguses" vs "pärast 3. tundi"),
 * aga tunniplaani lahtris on ainult söömise aeg — poole arvutame sellest.
 *   'algus' — söömine on vahetunni esimeses pooles
 *   'lõpp'  — teises pooles, vahetund algas 15 min varem
 * Null, kui vahetundi tuletada ei saanud (1.–2. klassi 20-min aknad).
 */
export function eatingHalf(lunch) {
  if (!lunch?.break) return null;
  return lunch.eat.start === lunch.break.start ? 'algus' : 'lõpp';
}

/* ---------- Rühma- ja osalusvalikud ---------- */

/* Rühma tunnus peab sisaldama ka õpetajat: 7A esimeses tunnis on kaks eri
   lastekoori (Õmblus ja Urbel), mille ainekood on mõlemal 'LAK'. */
export const entryKey = (e) => `${e.subject}·${e.teacher}`;
export const choiceKey = (cell) => cell.map(entryKey).sort().join('|');

/* Ained, kus käiakse ainult siis, kui ise soovid. Tugiõpe on vajaduspõhine,
   ülejäänud on huvitegevus. Kontrollitud, et 82 aine seas vale vastet ei teki.
   Arenguvestlus on Untises terve klassi ajana, aga igaüks käib ainult oma
   kokkulepitud ajal — muidu paistab, nagu koolipäev veniks 16:40-ni. */
const OPTIONAL = /koor|^(tugiõpe|ansambel|orkestriõpe|arenguvestlus)$/i;
export const SKIP = '__ei__';

export const isOptional = (e) => OPTIONAL.test(e.subjectFull || e.subject || '');
export const cellIsOptional = (cell) => cell.length > 0 && cell.every(isOptional);

/* Ära jäänud tund, mis oli ainult valikuline — nt arenguvestlused, mille kool
   pärast vestlusnädalat Untisest korraga eemaldab. Kummituskaarti pole siin
   mõtet näidata: enamik seal ei käinudki ja „Ei käi“ vastanutele ilmuks peidetud
   tund tagasi. Mitme rühma puhul on wasSubject komaga kokku pandud. */
export const wasOnlyOptional = (wasSubject) =>
  !!wasSubject && wasSubject.split(',').every((s) => OPTIONAL.test(s.trim()));

/**
 * Kõik selle klassi tunniplaani kohad, mis kasutajalt vastust ootavad:
 * mitme rühmaga lahtrid ja valikulised ained. Sama valik kordub tavaliselt
 * mitmes lahtris (inglise keel neljal korral nädalas) — võtme järgi kokku,
 * seega üks kirje valiku kohta, mitte tunni kohta.
 *
 * Järjekord on tunniplaani oma: tund tunni haaval, igas tunnis E–R.
 * -> [{ key, cell, optional }]
 */
export function collectChoices(data, klass) {
  const grid = data?.classes?.[klass]?.grid;
  if (!Array.isArray(grid)) return [];

  const seen = new Map();
  for (const row of grid) {
    for (const cell of row ?? []) {
      if (!cell?.length) continue;
      const optional = cellIsOptional(cell);
      // Üksik kohustuslik tund ei küsi midagi — seal pole, mida valida.
      if (cell.length < 2 && !optional) continue;
      const key = choiceKey(cell);
      if (!seen.has(key)) seen.set(key, { key, cell, optional });
    }
  }
  return [...seen.values()];
}

/* ---------- Ujumine ---------- */

/* Ujula plaan on kooli lehel pildina, ja sealt (swim.json) on näha, kelle
   liikumisõpetuse tund on sel nädalal ujulas. Untis seda ei tea: seal on alati
   "liikumisõpetus", kaks õpetajat ja ruum 118. Poisid ja tüdrukud käivad
   ujulas vaheldumisi, ja pildi tekstivärv ütleb, kumb õpetaja kaasas on. Laps
   on oma õpetaja (= rühma) äpis juba valinud, seega sugu küsima ei pea. */

const PE = /liikumisõpetus|kehaline/i;
export const isPE = (e) => e.subject === 'KK' || PE.test(e.subjectFull || '');

/** ISO nädal kujul '2026-W47' (nädal algab esmaspäeval, nädal 1 sisaldab 4. jaanuari). */
export function isoWeekKey(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));   // selle nädala neljapäev
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** '8DP/b' -> { klass: '8D', who: 'P', color: 'b' }; terve klass -> who: null */
export function parseSwimToken(tok) {
  const m = /^(\d{1,2}[A-Z])([PT])?\/(\w)$/.exec(tok);
  return m ? { klass: m[1], who: m[2] ?? null, color: m[3] } : null;
}

const swimTokens = (plan, day, period) =>
  String(plan.grid?.[period]?.[day] ?? '').split(/\s+/).map(parseSwimToken).filter(Boolean);

const peTeachers = (data, klass, day, period) =>
  (data?.classes?.[klass]?.grid?.[period]?.[day] ?? []).filter(isPE).map((e) => e.teacher);

const swimPlanFor = (swim, date) => {
  const wk = isoWeekKey(date);
  return swim?.plans?.find((p) => p.weeks?.includes(wk)) ?? null;
};

/**
 * Klassi soo ja õpetaja vastavus kõigi ujulatundide põhjal: { P: 'Raenok', T: 'ArutammAve' }.
 * Arvesse lähevad ainult lahtrid, kus värvi järgi õpetaja on Untises samas
 * pesas olemas — nii ei riku üksik valesti värvitud lahter (6CP must) kogu klassi.
 */
export function swimGroups(swim, data, klass) {
  const votes = { P: {}, T: {} };
  for (const plan of swim?.plans ?? []) {
    plan.grid?.forEach((row, period) => row.forEach((_, day) => {
      for (const t of swimTokens(plan, day, period)) {
        if (t.klass !== klass || !t.who) continue;
        const teacher = swim.colors?.[t.color];
        if (!peTeachers(data, klass, day, period).includes(teacher)) continue;
        votes[t.who][teacher] = (votes[t.who][teacher] ?? 0) + 1;
      }
    }));
  }
  const out = {};
  for (const who of ['P', 'T']) {
    const best = Object.entries(votes[who]).sort((a, b) => b[1] - a[1])[0];
    if (best) out[who] = best[0];
  }
  return out;
}

/**
 * Kas klassi liikumisõpetus sel päeval ja tunnil on ujulas?
 * -> null (pole ujulas või plaan ei kata seda nädalat)
 *  | { stale: true, url }               (pilt muutus kooli lehel, vana ülekirjutus ei kehti)
 *  | { who: 'P'|'T'|null, teacher, url } (who null = terve klass; teacher = ujulasse minev rühm)
 */
export function swimAt(swim, data, klass, date, period) {
  const plan = swimPlanFor(swim, date);
  if (!plan) return null;
  if (plan.stale) {
    const has = plan.grid?.some((row) => row.some((c) => String(c).split(/\s+/).some((x) => parseSwimToken(x)?.klass === klass)));
    return has ? { stale: true, url: plan.url } : null;
  }
  const day = weekdayIndex(date);
  const tok = swimTokens(plan, day, period).find((t) => t.klass === klass);
  if (!tok) return null;
  if (!tok.who) return { who: null, teacher: null, url: plan.url };
  const inSlot = peTeachers(data, klass, day, period);
  const byColor = swim.colors?.[tok.color];
  const teacher = inSlot.includes(byColor) ? byColor : (swimGroups(swim, data, klass)[tok.who] ?? null);
  return { who: tok.who, teacher, url: plan.url };
}

/** Ülekirjutuse vastuolud Untisega — hoiatuseks, mitte veaks. */
export function swimIssues(swim, data) {
  const out = [];
  for (const plan of swim?.plans ?? []) {
    plan.grid?.forEach((row, period) => row.forEach((cell, day) => {
      for (const raw of String(cell).split(/\s+/).filter(Boolean)) {
        const t = parseSwimToken(raw);
        const where = `${plan.name}, ${['E', 'T', 'K', 'N', 'R'][day]} ${period + 1}. tund`;
        if (!t) { out.push(`${where}: arusaamatu lahter "${raw}"`); continue; }
        if (!data?.classes?.[t.klass]) { out.push(`${where}: klassi ${t.klass} pole tunniplaanis`); continue; }
        const inSlot = peTeachers(data, t.klass, day, period);
        if (!inSlot.length) out.push(`${where}: ${raw} — Untises pole sel ajal liikumisõpetust`);
        else if (!inSlot.includes(swim.colors?.[t.color])) out.push(`${where}: ${raw} — värvi järgi ${swim.colors?.[t.color]}, Untises ${inSlot.join(', ')}`);
      }
    }));
  }
  return out;
}
