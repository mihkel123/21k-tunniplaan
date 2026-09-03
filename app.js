/* Tunniplaan — Tallinna 21. Kool. Vanilla ES-moodul, ehitusprotsessi pole. */

import {
  DAY_LETTER, DAY_NAME,
  iso, addDays, startOfDay, weekdayIndex, minutesOf, gradeOf, formatDay,
  holidayOn as holidayIn, isSchoolDay as isSchoolDayIn, defaultDate as defaultDateIn,
  relativeLabel, isFreshChange,
  notableOn as notableIn, namesOn as namesIn,
  overrideOn as overrideIn, parseLunch, eatingHalf,
} from './schedule.js';
import {
  DEFAULT_WALK_MIN, TO_SCHOOL, TO_HOME, searchStops, idsByName, matchRoutes, parseSiri,
  nextDepartures, morningDepartures, arrivalOf, fromSchedule, minutesUntil,
  leaveInMinutes, scheduleKeyForDay,
} from './bus.js';
import {
  REFRESH_AFTER_MS, CACHE_MAX_AGE_MS, forecastUrl, indexHourly, summarize,
  formatWeather, isPeSubject, peWeatherSeason, eventStartMin,
  adviceTemp, clothingFor,
} from './weather.js';
import { screen as trackScreen, leaving as trackLeaving } from './stats.js';

const LS_CLASS = 'tp.klass';
const LS_PICKS = 'tp.picks';
const LS_BUS = 'tp.bus';
const LS_BUS_SHUT = 'tp.busShut';
const LS_INSTALL = 'tp.installSeen';
const LS_INSTALL_TRIED = 'tp.installTried';

// Kestus, mida statistikale saadame, loetakse sellest hetkest. Moodul jookseb
// kohe lehe laadimisel, mil leht on tavajuhul juba nähtaval.
let visibleSince = Date.now();
const LS_WX = 'tp.wx';
const LS_THEME = 'tp.theme';

/* ---------- Väikesed abifunktsioonid ---------- */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* Süsteemikontrollid (menüü, rühma vahetus) kannavad joonikoone, samas kui
   sisu (ained, tähtpäevad, sündmused) kannab emojisid — sama jaotus, mis
   burgerinupu SVG-l juba on. Kaks noolt vastassuundades: "vaheta teise
   valiku peale", mitte segi minev "muudatus" 🔄 tähisega mujal kaardil. */
const SWAP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M3 7h15M14 3l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M21 17H6M10 21l-4-4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const svgEl = (tag, cls, svg) => { const n = el(tag, cls); n.innerHTML = svg; return n; };


const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* privaatrežiim */ } },
};

/* ---------- Aineikoonid ---------- */

const EMOJI = [
  ['inglise', '🇬🇧'], ['vene keel', '🇷🇺'], ['saksa', '🇩🇪'], ['prantsuse', '🇫🇷'], ['hispaania', '🇪🇸'],
  ['eesti keel', '📖'], ['kirjandus', '📚'], ['matemaatika', '📐'], ['arvuteooria', '📐'],
  ['keemia', '⚗️'], ['füüsika', '🔭'], ['bioloogia', '🌱'], ['loodus', '🍃'], ['geograafia', '🌍'],
  ['ajalugu', '🏛️'], ['ühiskonna', '🗳️'], ['inimese', '💬'], ['filosoofia', '🤔'], ['religioon', '🕊️'],
  ['kristlus', '🕊️'], ['mütoloogia', '🐉'], ['õiguse', '⚖️'], ['diplomaatia', '🤝'],
  ['rahvusvahelised', '🌐'], ['regionaal', '🌐'], ['riigikaitse', '🎖️'],
  ['majandus', '💰'], ['ettevõtlus', '💼'], ['õpilasfirma', '💼'], ['karjääri', '🧭'],
  ['koor', '🎶'], ['ansambel', '🎶'], ['orkestri', '🎻'], ['muusika', '🎵'],
  ['kunst', '🎨'], ['disain', '🎨'], ['kirjakunst', '✒️'], ['arhitektuur', '🏗️'],
  ['liikumis', '⚽'], ['kehaline', '⚽'], ['ujumine', '🏊'],
  ['informaatika', '💻'], ['arvuti', '💻'], ['programmeerimine', '💻'], ['digi', '💻'],
  ['küberturve', '🔐'], ['robootika', '🤖'], ['multimeedia', '🎬'], ['produktsioon', '🎬'],
  ['meedia', '📰'], ['koolileht', '📰'], ['giidi', '🗺️'],
  ['käsitöö', '🧵'], ['tehnoloogia', '🔧'], ['inseneeria', '🔧'],
  ['klassijuhataja', '🧑‍🏫'], ['uurimistöö', '🔎'], ['tugiõpe', '🤝'],
  ['kõne', '🗣️'], ['väitlus', '🗣️'], ['conversation', '🗣️'], ['teamwork', '🤝'],
  ['writing', '✍️'], ['reading', '📚'], ['english', '🇬🇧'], ['kultuur', '🎭'],
];

function emojiFor(name) {
  const s = (name || '').toLowerCase();
  for (const [needle, icon] of EMOJI) if (s.includes(needle)) return icon;
  return '📘';
}

/* Koolilõuna road. Esimene vaste võidab, seega järjekord on kogu reegel.
   Kõige tähtsam: VORM käib koostisosa ees. Koostisosa ütleb, millest roog
   on, aga ikoon näitab, mis kujul see lauale tuleb — "Hakkliha-koorekaste"
   on kaste, mitte konditükk, ja "kanakaste" on kaste, mitte praetud koib.
   Eesti koolitoit on valdavalt kaste, pada või supp, seega vorm on
   visuaalselt iseloomulikum kui loom. Koostisosa otsustab ainult siis, kui
   vormisõna puudub ("Ahjupraad", "Keedetud kana"). */
const DISH_EMOJI = [
  // 1. Magustoit
  ['kohupiim', '🍮'], ['kissell', '🍮'], ['magustoit', '🍮'], ['kreem', '🍮'],
  ['moos', '🍮'], ['vahukoor', '🍮'], ['pannkook', '🥞'], ['kook', '🍰'],
  // 2. Supp
  ['supp', '🍲'], ['borš', '🍲'], ['seljanka', '🍲'], ['puljong', '🍲'],
  // 3. Puder
  ['puder', '🥣'], ['kama', '🥣'], ['manna', '🥣'],
  // 4. Roog, mis on juba nime järgi valmis roog
  ['pitsa', '🍕'], ['pasta', '🍝'], ['makaron', '🍝'], ['spagett', '🍝'], ['lasanje', '🍝'],
  ['riso', '🍚'], ['pilaff', '🍚'], ['salat', '🥗'],
  // 5. Vorm — käib koostisosade ees
  ['karri', '🍛'], ['kaste', '🍛'],
  ['pada', '🥘'], ['hautis', '🥘'], ['raguu', '🥘'], ['vormiroog', '🥘'],
  ['kotlet', '🧆'], ['frikadell', '🧆'], ['lihapall', '🧆'],
  ['praad', '🍖'],
  // 6. Koostisosa
  ['kala', '🐟'], ['lõhe', '🐟'], ['tursk', '🐟'], ['räim', '🐟'], ['heeringas', '🐟'],
  ['kana', '🍗'], ['broiler', '🍗'], ['kalkun', '🍗'],
  ['vorst', '🌭'], ['viiner', '🌭'],
  ['sealiha', '🥩'], ['veise', '🥩'], ['hakkliha', '🥩'], ['sink', '🥩'], ['liha', '🥩'],
  ['muna', '🥚'], ['omlett', '🥚'],
  ['uba', '🫘'], ['oad', '🫘'], ['läätse', '🫘'], ['herne', '🫘'],
  ['tatar', '🌾'], ['tatra', '🌾'], ['oder', '🌾'], ['kruubi', '🌾'],
  ['riis', '🍚'], ['kartul', '🥔'],
  ['juust', '🧀'], ['seen', '🍄'],
  ['köögivilja', '🥗'], ['kapsa', '🥗'], ['porgand', '🥗'],
];

function dishEmoji(name) {
  const s = (name || '').toLowerCase();
  for (const [needle, icon] of DISH_EMOJI) if (s.includes(needle)) return icon;
  return '🍽️';
}

/* ---------- Olek ---------- */

const state = {
  data: null,
  changes: {},
  holidays: null,
  klass: store.get(LS_CLASS, null),
  picks: store.get(LS_PICKS, {}),
  buses: busList(store.get(LS_BUS, null)),
  busShut: store.get(LS_BUS_SHUT, []) ?? [],
  busData: null,      // {stops, paths} — laetakse alles seadistamisel
  selected: null,   // valitud kuupäev (Date)
  now: new Date(),
  wx: null,         // ilmaprognoos tundide kaupa, vt weather.js
  wxAt: 0,          // millal see prognoos saadi
  wxTriedAt: 0,     // millal viimati võrku koputasime (ka ebaõnnestunult)
  theme: 'auto',    // auto | light | dark, vt allpool
  editingChoice: null,   // choiceKey, mille rühmavalikut hetkel muudetakse, või null
  menu: null,       // koolilõuna menüü kuupäevade kaupa, vt menu.mjs
};

const picksFor = (klass) => state.picks[klass] || {};

/* ---------- Teema ---------- */

const THEMES = ['auto', 'light', 'dark'];
const THEME_COLOR = { light: '#2563eb', dark: '#0b1220' };

/**
 * "auto" jätab otsuse süsteemile: eemaldame data-theme'i ja CSS-i media-päring
 * teeb ülejäänu. Nii töötab süsteemieelistus ka siis, kui JS pole veel jõudnud.
 */
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;

  // Olekuriba värv. Media-põhised sildid näitaksid käsitsi valiku korral vale
  // teemat, seega kirjutame käsitsi valikul mõlemad üle ja autol paneme
  // kummalegi tema oma värvi tagasi.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const own = meta.media.includes('dark') ? THEME_COLOR.dark : THEME_COLOR.light;
    meta.content = theme === 'auto' ? own : THEME_COLOR[theme];
  }
}

function renderThemeSeg() {
  for (const b of document.querySelectorAll('#theme-seg .seg-btn')) {
    const on = b.dataset.theme === state.theme;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  }
}

function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  state.theme = theme;
  store.set(LS_THEME, theme);
  applyTheme(theme);
  renderThemeSeg();
}

/* ---------- Ilm ---------- */

/** Salvestatud prognoos, kui see pole veel liiga vana. */
function weatherCache() {
  const c = store.get(LS_WX, null);
  if (!c?.at || !c.hours) return null;
  // Eilne prognoos on halvem kui tühi rida.
  return Date.now() - c.at > CACHE_MAX_AGE_MS ? null : c;
}

/**
 * Prognoos vahemälust ja vajadusel võrgust. Renderdust ei blokeeri: vahemälu
 * loetakse kohe (enne esimest await'i), võrgust tulnu joonistab kaardid uuesti.
 * Võrku koputame kõige rohkem korra poole tunni jooksul, ka siis kui vastus
 * jäi tulemata — muidu tembeldaks minutiline kell päringuid katkise ühenduse
 * taga lõputult.
 */
async function loadWeather() {
  if (!state.wx) {
    const cached = weatherCache();
    if (cached) { state.wx = cached.hours; state.wxAt = cached.at; }
  }
  if (Date.now() - Math.max(state.wxAt, state.wxTriedAt) < REFRESH_AFTER_MS) return;
  state.wxTriedAt = Date.now();

  try {
    const res = await fetch(forecastUrl(), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const hours = indexHourly(await res.json());
    if (!hours) return;
    state.wx = hours;
    state.wxAt = Date.now();
    store.set(LS_WX, { at: state.wxAt, hours });
    if (state.klass && !$('#app').hidden) render();
  } catch {
    // Ilm on lisa, mitte tuum. Rida jääb ära, muu töötab edasi.
  }
}

/** Liikumisõpetuse ilm — talvel mitte, siis on tund niikuinii sees. */
function lessonWeather(entry, period) {
  if (!state.wx || !peWeatherSeason(state.selected)) return null;
  if (!isPeSubject(entry.subjectFull || entry.subject)) return null;
  return formatWeather(summarize(state.wx, iso(state.selected),
    minutesOf(period.start), minutesOf(period.end)));
}

/** Väliürituse ilm. Kellaajata sündmusel ("pärast aktust") pole akent, mida küsida. */
function eventWeather(e) {
  if (!state.wx || !e.outdoor) return null;
  const start = eventStartMin(e.at);
  if (start == null) return null;
  return formatWeather(summarize(state.wx, iso(state.selected), start, start + 60));
}

function weatherRow(line) {
  const row = el('div', 'wx');
  row.append(el('span', 'wx-icon', line.icon), el('span', null, line.text));
  return row;
}

const clockLabel = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/**
 * Üks rida päeva ilmaribas: riietusnõuanne + päris ilm samas kohas, sest
 * mõlemad tulevad samast prognoosiaknast. Riietus ("Kerge jope") ja ilm
 * ("16° · Vihm 4%") taaskasutavad täpselt sama `formatWeather()`-it, mis
 * juba liikumisõpetuse ja väliürituste kaartidel töötab.
 */
function dayWeatherRow(label, timeMin, sum) {
  const line = formatWeather(sum);
  if (!line) return null;
  const cloth = clothingFor(adviceTemp(sum));
  const row = el('div', 'day-weather-row');
  row.append(el('div', 'day-weather-when', `${label} · ${clockLabel(timeMin)}`));
  const wx = el('div', 'wx');
  wx.append(
    el('span', 'wx-icon', cloth.icon), el('span', null, cloth.label),
    el('span', 'wx-sep', '·'),
    el('span', 'wx-icon', line.icon), el('span', null, line.text),
  );
  row.append(wx);
  return row;
}

/**
 * Päeva ilmariba: mis selga panna hommikul ja mis ilmaga koolist koju
 * minnes. Erinevalt liikumisõpetuse reast käib see aasta ringi, ka talvel —
 * just siis loeb "talvejope" kõige rohkem.
 */
function dailyWeatherBanner(firstStartMin, lastEndMin) {
  if (!state.wx) return null;
  const day = iso(state.selected);
  const morning = dayWeatherRow('Hommikul', firstStartMin - 30,
    summarize(state.wx, day, firstStartMin - 30, firstStartMin));
  const afternoon = dayWeatherRow('Kooli lõpuks', lastEndMin,
    summarize(state.wx, day, lastEndMin, lastEndMin));
  if (!morning && !afternoon) return null;
  const box = el('section', 'day-weather');
  if (morning) box.append(morning);
  if (afternoon) box.append(afternoon);
  return box;
}

/* ---------- Koolipäevad ja vaheajad ---------- */

const holidayOn = (date, klass) => holidayIn(state.holidays, date, klass);
const isSchoolDay = (date, klass) => isSchoolDayIn(state.holidays, date, klass);
const defaultDate = (now, klass) => defaultDateIn(state.holidays, now, klass);

/* ---------- Nädal ---------- */

// data.json ei sisalda kuupäevi: päevad on 'Esmaspäev'…'Reede' ja sama
// ruudustik kordub igal nädalal. "Järgmine nädal" on seega sama tunniplaan
// teiste kuupäevadega — päriselt erinevad ainult vaheajad, tähtpäevad, ilm ja
// menüü. Kaks viimast saavad nädala pärast otsa, seega peame teadma, kas
// vaadatav päev on jooksvas nädalas.
const mondayOf = (d) => startOfDay(addDays(d, -weekdayIndex(d)));
// Math.round, mitte jagatis: kellakeeramise nädal on 7 päeva ± tund.
const weekOffset = () => Math.round((mondayOf(state.selected) - mondayOf(state.now)) / 604800000);

/* ---------- Muudatused ---------- */

function changeFor(klass, period, day) {
  // Muudatuse võti on 'tund|nädalapäev', mitte kuupäev. Teisel nädalal
  // tähendaks sama kirje hoopis teist päeva, seega jääb see jooksvasse
  // nädalasse — muidu näitaks äpp järgmise nädala teisipäeval selle nädala
  // teisipäeva muudatust.
  if (weekOffset() !== 0) return null;
  const entry = state.changes?.[klass]?.[`${period}|${day}`];
  return isFreshChange(entry, state.now) ? entry : null;
}

function dayHasChanges(klass, day) {
  const slots = state.changes?.[klass];
  if (!slots) return false;
  return Object.keys(slots).some((k) => Number(k.split('|')[1]) === day && changeFor(klass, Number(k.split('|')[0]), day));
}

function changeText(c) {
  if (c.movedFrom) return `Tõstetud siia · oli ${c.movedFrom.slot}`;
  if (c.movedTo) return `Viidud ära · nüüd ${c.movedTo.slot}`;
  if (c.kind === 'added') return 'Uus tund';
  if (c.kind === 'removed') return `Tund ära jäetud${c.wasSubject ? ` · oli ${c.wasSubject}` : ''}`;
  return `Muudetud${c.wasSubject ? ` · oli ${c.wasSubject}` : ''}`;
}

/* ---------- Rühma- ja osalusvalikud ---------- */

/* Rühma tunnus peab sisaldama ka õpetajat: 7A esimeses tunnis on kaks eri
   lastekoori (Õmblus ja Urbel), mille ainekood on mõlemal 'LAK'. */
const entryKey = (e) => `${e.subject}·${e.teacher}`;
const choiceKey = (cell) => cell.map(entryKey).sort().join('|');

/* Ained, kus käiakse ainult siis, kui ise soovid. Tugiõpe on vajaduspõhine,
   ülejäänud on huvitegevus. Kontrollitud, et 82 aine seas vale vastet ei teki. */
const OPTIONAL = /koor|^(tugiõpe|ansambel|orkestriõpe)$/i;
const SKIP = '__ei__';

const isOptional = (e) => OPTIONAL.test(e.subjectFull || e.subject || '');
const cellIsOptional = (cell) => cell.length > 0 && cell.every(isOptional);

function setPick(klass, cell, value) {
  const picks = { ...picksFor(klass), [choiceKey(cell)]: value };
  state.picks = { ...state.picks, [klass]: picks };
  store.set(LS_PICKS, state.picks);
  state.editingChoice = null;   // valik tehtud, sulge vahetusplokk
  render();
}

const chooseGroup = (klass, cell, entry) => setPick(klass, cell, entryKey(entry));
const skipCell = (klass, cell) => setPick(klass, cell, SKIP);

/** -> { chosen, alts, undecided, optional, skipped } */
function splitCell(klass, cell) {
  const optional = cellIsOptional(cell);
  const pick = picksFor(klass)[choiceKey(cell)];

  if (optional && pick === SKIP) {
    return { chosen: null, alts: [], undecided: false, optional, skipped: true };
  }
  if (cell.length <= 1) {
    // Üksik valikuline tund vajab samuti vastust: käid või ei käi
    if (optional && !pick) {
      return { chosen: null, alts: cell, undecided: true, optional, skipped: false };
    }
    return { chosen: cell[0] ?? null, alts: [], undecided: false, optional, skipped: false };
  }
  const chosen = cell.find((e) => entryKey(e) === pick);
  if (!chosen) return { chosen: null, alts: cell, undecided: true, optional, skipped: false };
  return { chosen, alts: cell.filter((e) => e !== chosen), undecided: false, optional, skipped: false };
}

/* ---------- Renderdamine ---------- */

function lessonCard(entry, period, opts) {
  const card = el('article', 'card');
  if (entry.color) card.style.setProperty('--stripe', entry.color);
  if (opts.now) card.classList.add('is-now');
  else if (opts.next) card.classList.add('is-next');
  if (opts.change) card.classList.add('is-changed');

  const when = el('div', 'when');
  when.append(el('b', null, `${period.n}.`), el('span', null, period.start), el('span', null, period.end));
  card.append(when);

  const what = el('div', 'what');
  const subject = el('div', 'subject');
  subject.append(el('span', 'emoji', emojiFor(entry.subjectFull)), el('span', null, entry.subjectFull || entry.subject));
  what.append(subject);

  if (entry.teacherFull || entry.teacher) what.append(el('div', 'meta', entry.teacherFull || entry.teacher));
  if (entry.room) what.append(el('div', 'room', `Ruum ${entry.room}`));
  const wx = lessonWeather(entry, period);
  if (wx) what.append(weatherRow(wx));
  if (opts.change) {
    const c = el('div', 'changed');
    c.append(el('span', null, '🔄'), el('span', null, changeText(opts.change)));
    what.append(c);
  }
  card.append(what);

  const status = opts.now ? el('span', 'pill now', 'Praegu')
    : opts.next ? el('span', 'pill next', 'Järgmine') : null;

  if (opts.onSwap) {
    // Pill ja vahetusnupp koos ühes plokis, muidu kataks "Praegu" märk ikooni ära.
    const badges = el('div', 'card-badges');
    if (status) badges.append(status);
    const swap = svgEl('button', 'subject-swap', SWAP_ICON);
    swap.type = 'button';
    swap.setAttribute('aria-label', 'Vaheta rühma');
    swap.addEventListener('click', opts.onSwap);
    badges.append(swap);
    card.append(badges);
  } else if (status) {
    card.append(status);
  }
  return card;
}

function ghostCard(period, change) {
  const card = el('article', 'card is-changed is-ghost');
  const when = el('div', 'when');
  when.append(el('b', null, `${period.n}.`), el('span', null, period.start), el('span', null, period.end));
  card.append(when);

  const what = el('div', 'what');
  const subject = el('div', 'subject');
  const was = change.movedTo?.subject || change.wasSubject || 'Tund';
  subject.append(el('span', 'emoji', '🚫'), el('span', null, was));
  what.append(subject);
  // Pealkiri näitab juba aine nime — ära korda seda uuesti
  const note = change.movedTo ? `Viidud ära · nüüd ${change.movedTo.slot}` : 'Tund ära jäetud';
  const c = el('div', 'changed');
  c.append(el('span', null, '🔄'), el('span', null, note));
  what.append(c);
  card.append(what);
  return card;
}

/** Erandpäeva sündmus: kellaaeg vasakul, pealkiri ja koht paremal. */
function eventCard(e) {
  const card = el('section', 'card is-event');
  const when = el('div', 'when');
  when.append(el('b', null, e.at));
  card.append(when);

  const what = el('div', 'what');
  const subject = el('div', 'subject');
  subject.append(el('span', 'emoji', e.emoji ?? '🎓'), el('span', null, e.title));
  what.append(subject);
  if (e.teacher) what.append(el('div', 'meta', e.teacher));
  if (e.room) what.append(el('span', 'room', e.room));
  const wx = eventWeather(e);
  if (wx) what.append(weatherRow(wx));
  card.append(what);
  return card;
}

/**
 * Söögivahetund tundide vahel: vasakul aeg, all päeva menüü — ainult roa
 * nimed, ilma lisandite, jookide ja leivata.
 */
function lunchCard(lunch, menu) {
  const card = el('section', 'card is-lunch');

  // Kaardil on 30-minutiline vahetund, mitte 15-minutiline söömise aken.
  // Kooli tunniplaani lahtris on ainult aken, aga vaba aega on pool tundi
  // (vt parseLunch) — laps peab nägema seda, mis tal päriselt käes on.
  // Kus aken vahetunni sees on, ütleme sõnadega: teine kellaaeg kõrvuti
  // esimesega loeti kaardilt vastuoluna.
  // 1.–2. klassi 20-min aknad jäävad omaette: neil vahetundi tuletada ei saa.
  const span = lunch.break ?? lunch.eat;
  const when = el('div', 'when');
  when.append(el('b', null, clockLabel(span.start)), el('span', null, clockLabel(span.end)));
  card.append(when);

  const what = el('div', 'what');
  const subject = el('div', 'subject');
  subject.append(el('span', 'emoji', '🍽️'),
    el('span', null, lunch.break ? 'Söögivahetund' : 'Söömine'));
  what.append(subject);

  const half = eatingHalf(lunch);
  if (half) what.append(el('div', 'lunch-half', `Söömine vahetunni ${half === 'algus' ? 'alguses' : 'lõpus'}`));

  // Taimetoit ei saa eraldi märki — iga roog kannab lihtsalt oma ikooni.
  for (const roog of [...(menu?.tava ?? []), ...(menu?.taim ?? [])]) {
    const rida = el('div', 'dish');
    rida.append(el('span', 'dish-icon', dishEmoji(roog)), el('span', null, roog));
    what.append(rida);
  }

  card.append(what);
  return card;
}

function choiceBlock(klass, cell, period, change, { editing = false, chosenKey = null } = {}) {
  const box = el('section', 'choice');
  const optional = cellIsOptional(cell);
  const many = cell.length > 1;

  const head = el('div', 'choice-head');
  head.append(
    editing ? svgEl('span', 'choice-icon', SWAP_ICON) : el('span', 'choice-icon', optional ? '🙋' : '👥'),
    el('b', null, editing
      ? 'Vaheta rühma'
      : optional
        ? (many ? 'Kas käid? Vali oma rühm' : 'Kas käid selles tunnis?')
        : 'Vali oma rühm')
  );
  if (editing) {
    // Siin (erinevalt esmakordsest valikust) on midagi, kuhu tagasi minna.
    const close = el('button', 'choice-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Loobu');
    close.addEventListener('click', () => { state.editingChoice = null; render(); });
    head.append(close);
  }
  box.append(head);

  for (const entry of cell) {
    const card = lessonCard(entry, period, { change });
    card.classList.add('is-choice');
    if (editing && entryKey(entry) === chosenKey) {
      card.classList.add('is-picked');
      card.append(el('span', 'pill picked', 'Praegune'));
    }
    card.addEventListener('click', () => chooseGroup(klass, cell, entry));
    box.append(card);
  }

  if (optional) {
    const no = el('button', 'choice-no', many ? 'Ma ei käi üheski' : 'Ma ei käi siin');
    no.type = 'button';
    no.addEventListener('click', () => skipCell(klass, cell));
    box.append(no);
  }
  return box;
}

function renderLessons() {
  const main = $('#lessons');
  main.textContent = '';

  const { data, klass, selected } = state;
  const day = weekdayIndex(selected);
  const holiday = holidayOn(selected, klass);

  if (data.notice) {
    const n = el('div', 'banner notice');
    n.append(el('b', null, 'Kooli teade'), el('span', null, data.notice));
    main.append(n);
  }

  if (holiday) {
    const until = new Date(holiday.until);
    const b = el('div', 'banner holiday');
    b.append(
      el('b', null, holiday.kind === 'public' ? holiday.name : `${holiday.name} 🎉`),
      el('span', null, holiday.kind === 'public' ? 'Täna kooli ei ole.' : `Koolivaheaeg kuni ${formatDay(until)}.`)
    );
    main.append(b);
    return;
  }

  // Erandpäev (aktus, klassijuhatajatund): kooli tunniplaanis neid ei ole,
  // seega tavalised tunnid jäävad ära ja näitame päevakava.
  const special = overrideIn(state.overrides, selected, klass);
  if (special) {
    if (special.notice) {
      const n = el('div', 'banner special');
      n.append(el('b', null, '🎓 Esimene koolipäev'), el('span', null, special.notice));
      main.append(n);
    }
    for (const e of special.events) main.append(eventCard(e));
    return;
  }

  const grid = data.classes[klass].grid;
  const isToday = iso(selected) === iso(state.now);
  const nowMin = state.now.getHours() * 60 + state.now.getMinutes();

  // Söögivahetund nihutab ühte tundi 15 min hilisemaks (kooli tundide-ajad
  // leht loetleb tundidele 3.-7. kaks varianti). Ehitame selle päeva
  // tunniajad nihkega, et kaart, "Praegu" silt, bussikaart ja ilmariba
  // räägiksid kõik samast kellaajast. data.periods ise jääb puutumata.
  const lunch = parseLunch(data.classes[klass].lunch?.[day]);
  const periods = lunch?.shift
    ? data.periods.map((p) => (p.n === lunch.shift.periodN
      ? { ...p, start: clockLabel(lunch.shift.start), end: clockLabel(lunch.shift.end) }
      : p))
    : data.periods;

  // Leia praegu käiv ja järgmine tund
  let nowIdx = -1;
  let nextIdx = -1;
  if (isToday) {
    periods.forEach((p, i) => {
      if (!grid[i]?.[day]?.length) return;
      if (nowMin >= minutesOf(p.start) && nowMin <= minutesOf(p.end)) nowIdx = i;
      else if (nextIdx === -1 && nowMin < minutesOf(p.start)) nextIdx = i;
    });
  }

  let any = false;
  let lastEndMin = null;      // viimase NÄHTAVA tunni lõpp — kojusõidu kaardi jaoks
  let firstStartMin = null;   // esimese NÄHTAVA tunni algus — hommikuse kaardi jaoks
  let firstEl = null;         // ette käib hommikune kaart
  const gen = ++busGen;

  const put = (node) => { if (!firstEl) firstEl = node; main.append(node); };

  // Söögikaart läheb kronoloogiliselt õigesse kohta: enne esimest tundi,
  // mis algab hiljem kui söögivahetund.
  const lunchAt = lunch ? (lunch.break ?? lunch.eat).start : null;
  const menuToday = state.menu?.days?.[iso(selected)] ?? null;
  let lunchPlaced = false;
  const putLunchBefore = (startMin) => {
    if (lunchPlaced || lunchAt == null || lunchAt > startMin) return;
    lunchPlaced = true;
    put(lunchCard(lunch, menuToday));
  };

  periods.forEach((period, i) => {
    const cell = grid[i]?.[day] ?? [];
    const change = changeFor(klass, i, day);

    // Tühi pesa, kust tund kadus — näita kummituskaarti, muidu jääks muutus märkamata
    if (!cell.length) {
      if (change && (change.kind === 'removed' || change.movedTo)) {
        any = true;
        putLunchBefore(minutesOf(period.start));
        put(ghostCard(period, change));
      }
      return;
    }

    const { chosen, alts, undecided, skipped } = splitCell(klass, cell);
    if (skipped) return;        // laps ei käi siin — kaarti ei näidata

    any = true;
    putLunchBefore(minutesOf(period.start));
    lastEndMin = minutesOf(period.end);
    if (firstStartMin == null) firstStartMin = minutesOf(period.start);

    if (undecided) {
      put(choiceBlock(klass, cell, period, change));
      return;
    }

    if (state.editingChoice === choiceKey(cell)) {
      put(choiceBlock(klass, cell, period, change, { editing: true, chosenKey: entryKey(chosen) }));
      return;
    }

    const onSwap = alts.length
      ? () => { state.editingChoice = choiceKey(cell); render(); }
      : null;
    put(lessonCard(chosen, period, { now: i === nowIdx, next: i === nextIdx, change, onSwap }));
  });

  if (!any) {
    const e = el('div', 'empty');
    e.append(el('span', 'big', '🎈'), el('div', null, 'Sel päeval tunde pole.'));
    main.append(e);
    return;
  }

  // Ilmariba ja hommikune bussikaart käivad esimese tunni ette, sel
  // järjekorras — enne kõike muud "mida selga panna", siis "millal bussile".
  if (firstStartMin != null) {
    const weather = dailyWeatherBanner(firstStartMin, lastEndMin);
    if (weather) main.insertBefore(weather, firstEl);

    const before = document.createDocumentFragment();
    renderBusCards(before, { dir: TO_SCHOOL, day, anchorMin: firstStartMin, isToday, gen });
    if (before.childNodes.length) main.insertBefore(before, firstEl);
  }
  renderBusCards(main, { dir: TO_HOME, day, anchorMin: lastEndMin, isToday, gen });
}

function renderWeekstrip() {
  const strip = $('#weekstrip');
  strip.textContent = '';
  const monday = addDays(state.selected, -weekdayIndex(state.selected));

  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i);
    const b = el('button', 'wd');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(iso(d) === iso(state.selected)));
    if (!isSchoolDay(d, state.klass)) b.classList.add('is-off');
    b.append(el('b', null, DAY_LETTER[i]), el('span', null, String(d.getDate())));
    if (dayHasChanges(state.klass, i)) b.append(el('span', 'dot'));
    b.addEventListener('click', () => { state.selected = d; state.editingChoice = null; trackScreen('/paev'); render(); });
    strip.append(b);
  }
}

/**
 * Üks samm edasi ja tagasi, kaugemale mitte: tunnid korduvad niikuinii ja
 * kõik kuupäevapõhine (menüü, ilm, muudatused) saab nädala pärast otsa.
 */
function renderWeeknav() {
  const box = $('#weeknav');
  box.textContent = '';
  const ahead = weekOffset() !== 0;

  const b = el('button', 'weeknav-btn');
  b.type = 'button';
  b.textContent = ahead ? '‹ Tagasi sellele nädalale' : 'Järgmine nädal ›';
  b.addEventListener('click', () => {
    state.selected = ahead ? defaultDate(state.now, state.klass) : addDays(mondayOf(state.now), 7);
    state.editingChoice = null;
    trackScreen(ahead ? '/paev' : '/jargmine-nadal');
    render();
  });
  box.append(b);

  // Öelda välja, mida ei näidata — tühi koht tekitab küsimuse, rida vastab.
  if (ahead) {
    const menuKnown = Boolean(state.menu?.days?.[iso(state.selected)]);
    box.append(el('p', 'weeknav-note', menuKnown
      ? 'Tunnid on igal nädalal samad. Tunnimuudatusi järgmise nädala kohta veel ei ole.'
      : 'Tunnid on igal nädalal samad. Menüüd ja tunnimuudatusi järgmise nädala kohta veel ei ole.'));
  }
}

function renderHeader() {
  const { selected, now, klass } = state;
  $('#class-btn').textContent = `${klass} ▾`;
  $('#day-title').textContent = DAY_NAME[weekdayIndex(selected)] ?? '';

  const badge = $('#day-badge');
  const label = relativeLabel(selected, now);
  badge.textContent = label ?? formatDay(selected);
  badge.classList.toggle('is-date', !label);
  badge.hidden = false;

  renderDayNotes(selected);

  const d = state.data;
  $('#source-note').textContent = d.sourceUpdated
    ? `Kooli tunniplaan uuendatud ${d.sourceUpdated}`
    : 'Allikas: 21k.ee';
}

/** Riigipüha või tähtpäev ja nimepäevad päise all. */
function renderDayNotes(selected) {
  const box = $('#day-notes');
  box.textContent = '';

  const notable = notableIn(state.notable, selected);
  if (notable.length) {
    const row = el('div', 'day-note day-note--notable');
    // Riigipüha ja rahvuspüha on töövabad — need väärivad rohkem rõhku
    // kui emakeelepäev või mardipäev.
    const big = notable.some((n) => n.kind === 'riigipüha' || n.kind === 'rahvuspüha');
    row.classList.toggle('is-holiday', big);
    // Emoji tuleb andmefailist. Kui mõnel kirjel see puudub, jääb rida siiski
    // ikooniga — parem üldine märk kui tühi koht.
    const icon = notable.find((n) => n.emoji)?.emoji ?? (big ? '🇪🇪' : '📌');
    row.append(el('span', 'day-note-icon', icon));
    row.append(el('span', null, notable.map((n) => n.name).join(', ')));
    box.append(row);
  }

  const names = namesIn(state.namedays, selected);
  if (names.length) {
    const row = el('div', 'day-note day-note--names');
    row.append(el('span', 'day-note-icon', '🎂'));
    row.append(el('span', null, `Nimepäev: ${names.join(', ')}`));
    box.append(row);
  }

  box.hidden = !box.childNodes.length;
}

function render() {
  renderHeader();
  renderWeekstrip();
  renderWeeknav();
  renderLessons();
}

/* ---------- Bussiajad ---------- */

const SIRI = 'https://transport.tallinn.ee/siri-stop-departures.php?stopid=';
const hhmm = (secs) => {
  const s = ((secs % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
};

let busGen = 0;   // suureneb iga renderdusega; aeglane päring ei kirjuta uut vaadet üle

/**
 * Vana versioon hoidis ühte suunda, nüüd on neid loend. Vana salvestus
 * loeme sisse kojusõiduna, et lapse seadistus alles jääks.
 */
function busList(saved) {
  if (!saved) return [];
  const list = Array.isArray(saved) ? saved : [saved];
  return list
    .filter((b) => b?.fromIds?.length && b?.routes?.length)
    .map((b) => ({ dir: TO_HOME, walk: DEFAULT_WALK_MIN, rides: {}, ...b }));
}

const saveBuses = () => store.set(LS_BUS, state.buses);

/** Kokkuklapitud kaardid. Võti on suund ise, et see püsiks ka ümberjärjestamisel. */
const cardKey = (b) => `${b.dir}|${b.fromName}|${b.toName}`;
const isCollapsed = (b) => state.busShut.includes(cardKey(b));
function toggleCollapsed(b) {
  const k = cardKey(b);
  const i = state.busShut.indexOf(k);
  if (i === -1) state.busShut.push(k); else state.busShut.splice(i, 1);
  store.set(LS_BUS_SHUT, state.busShut);
}

/**
 * Enne sõiduaegade lisandumist salvestatud suundadel pole `rides` kirjas,
 * seega ei oskaks kaart saabumisaega näidata. Arvutame need korra nimede
 * järgi uuesti — nii ei pea laps oma vana seadistust käsitsi üle tegema.
 */
async function backfillRides() {
  if (!state.buses.some((b) => !b.rides || !Object.keys(b.rides).length)) return;
  if (!(await loadBusData())) return;

  let changed = false;
  for (const b of state.buses) {
    if (b.rides && Object.keys(b.rides).length) continue;
    const m = matchRoutes(
      state.busData.paths,
      idsByName(state.busData.stops, b.fromName),
      idsByName(state.busData.stops, b.toName),
    );
    if (!m.routes.length) continue;   // peatus või liin on vahepeal kadunud
    b.routes = m.routes;
    b.fromIds = m.fromIds;
    b.rides = m.rides;
    changed = true;
  }
  if (changed) { saveBuses(); render(); }
}

const busLabel = (b) => `${b.fromName} → ${b.toName}`;

function renderBusCards(main, { dir, day, anchorMin, isToday, gen }) {
  const list = state.buses.filter((b) => b.dir === dir);

  if (!list.length) {
    // Lisamisnupp ainult päeva lõpus ja ainult siis, kui ühtegi suunda pole.
    // Hommikuse saab lisada seadetest, et päeva algus jääks puhtaks.
    if (dir === TO_HOME && !state.buses.length) {
      const add = el('button', 'bus-add', '🚌  Lisa bussiajad');
      add.type = 'button';
      add.addEventListener('click', openBusSetup);
      main.append(add);
    }
    return;
  }

  for (const cfg of list) {
    const card = el('section', 'bus-card');
    const shut = isCollapsed(cfg);

    // Päis on nupp: pealkiri jääb alati näha, nii et suletud kaardi puhul
    // on ikka teada, mis seal all on.
    const head = el('button', 'bus-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!shut));
    const title = el('b');
    title.append(
      el('span', 'bus-caret', shut ? '▸' : '▾'),
      el('span', 'bus-emoji', '🚌'),
      el('span', null, busLabel(cfg)),
    );
    const when = anchorMin == null ? ''
      : dir === TO_SCHOOL ? `Tunnid algavad ${hhmm(anchorMin * 60)}`
      : `Tunnid lõpevad ${hhmm(anchorMin * 60)}`;
    head.append(title, el('span', null, when));
    head.addEventListener('click', () => { toggleCollapsed(cfg); render(); });
    card.append(head);
    main.append(card);

    if (shut) continue;

    const list_ = el('div', 'bus-list');
    list_.append(el('div', 'bus-note', 'Laen bussiaegu…'));
    card.append(list_);
    fillBus(list_, cfg, { day, anchorMin, isToday, gen });
  }
}

async function fillBus(list, cfg, { day, anchorMin, isToday, gen }) {
  const key = scheduleKeyForDay(day);

  const scheduled = [];
  await Promise.all(cfg.fromIds.map(async (id) => {
    const s = await loadJSON(`bus/stop/${id}.json`, null);
    if (s?.[key]) scheduled.push(...s[key].map(fromSchedule));
  }));

  // Reaalaeg ainult tänase kohta — homsel pole see midagi väärt
  let live = [];
  let serverNow = null;
  if (isToday) {
    const texts = await Promise.all(cfg.fromIds.map((id) =>
      fetch(SIRI + id).then((r) => (r.ok ? r.text() : null)).catch(() => null)));
    for (const t of texts) {
      if (!t) continue;
      const p = parseSiri(t);
      if (p.now != null) serverNow = p.now;
      live.push(...p.rows);
    }
  }

  if (gen !== busGen) return;   // vahepeal renderdati uuesti

  const walk = cfg.walk ?? DEFAULT_WALK_MIN;
  const walkSecs = walk * 60;
  const anchorSecs = (anchorMin ?? 0) * 60;
  const clock = serverNow ?? (state.now.getHours() * 3600 + state.now.getMinutes() * 60);

  let rows;
  let note = null;
  let markRow = null;   // real, mille juures näitame väljumishoiatust

  if (cfg.dir === TO_SCHOOL) {
    // Peab jõudma enne esimest tundi: buss + jalutus peatusest kooli.
    const arriveBy = anchorSecs - walkSecs;
    const r = morningDepartures({
      scheduled, live, routes: cfg.routes, rides: cfg.rides,
      afterSecs: isToday ? clock + walkSecs : 0,
      arriveBy, limit: 3,
    });
    if (!r.madeIt && isToday && clock > arriveBy) {
      rows = [];
      note = 'Hommikused bussid on läinud.';
    } else {
      rows = r.rows;
      markRow = r.best;
      if (!r.madeIt) note = 'Ükski buss ei jõua enne tundide algust.';
    }
  } else {
    const afterSecs = (isToday ? Math.max(anchorSecs, clock) : anchorSecs) + walkSecs;
    rows = nextDepartures({ scheduled, live, routes: cfg.routes, afterSecs, limit: 3 });
    markRow = rows[0];
  }

  list.textContent = '';
  if (!rows.length) {
    list.append(el('div', 'bus-note', note ?? (scheduled.length
      ? 'Rohkem busse täna ei lähe.'
      : 'Bussiaegu ei õnnestunud laadida.')));
    return;
  }
  if (note) list.append(el('div', 'bus-note', note));

  for (const r of rows) {
    const row = el('div', 'bus-row');
    row.append(el('span', 'bus-num', r.route));

    const mid = el('div', 'bus-mid');
    mid.append(el('b', null, r.head));
    if (r === markRow) {
      if (cfg.dir === TO_SCHOOL) mid.append(el('span', 'bus-last', 'jõuab kõige täpsemalt'));
      if (isToday) {
        const leave = leaveInMinutes(r.secs, clock, walk);
        mid.append(el('span', null, leave > 0 ? `Pead väljuma ${leave} min pärast` : 'Mine kohe!'));
      }
    }
    row.append(mid);

    const right = el('div', 'bus-when');
    right.append(el('b', null, hhmm(r.secs)));
    const arr = arrivalOf(r, cfg.rides);
    if (arr != null) right.append(el('span', null, `kohal ${hhmm(arr)}`));
    if (isToday) right.append(el('span', null, `${Math.max(0, minutesUntil(r.secs, clock))} min`));
    row.append(right);

    list.append(row);
  }
}

/* ---------- Bussi seadistamine ---------- */

const DIR_LABEL = { [TO_SCHOOL]: 'hommikul', [TO_HOME]: 'pärast tunde' };
const sameRoute = (a, b) => a.dir === b.dir && a.fromName === b.fromName && a.toName === b.toName;

async function loadBusData() {
  if (state.busData) return true;
  const [stops, paths] = await Promise.all([
    loadJSON('bus/stops.json', null),
    loadJSON('bus/routes.json', null),
  ]);
  if (!stops || !paths) return false;
  state.busData = { stops, paths };
  return true;
}

async function openBusSetup() {
  $('#sheet').close();
  const dlg = $('#bus-setup');
  const form = $('#bus-form');

  if (!(await loadBusData())) {
    const box = $('#bus-routes');
    box.textContent = '';
    box.append(el('p', 'field-error', 'Bussiandmeid ei õnnestunud laadida. Proovi internetiühendusega.'));
    $('#bus-add-open').hidden = true;
    form.hidden = true;
    dlg.showModal();
    return;
  }

  const draft = { dir: TO_HOME, from: '', to: '', walk: DEFAULT_WALK_MIN };

  function renderRoutes() {
    const box = $('#bus-routes');
    box.textContent = '';
    if (!state.buses.length) {
      box.append(el('p', 'sheet-lead', 'Ühtegi suunda pole veel lisatud.'));
      return;
    }
    state.buses.forEach((b, i) => {
      const row = el('div', 'route-row');
      const label = el('div', 'route-label');
      label.append(el('b', null, busLabel(b)), el('span', null, DIR_LABEL[b.dir]));
      const del = el('button', 'route-del', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', `Eemalda ${busLabel(b)}`);
      del.addEventListener('click', () => {
        state.buses.splice(i, 1);
        saveBuses();
        renderRoutes();
        render();
      });
      row.append(label, del);
      box.append(row);
    });
  }

  function setDir(dir) {
    draft.dir = dir;
    for (const b of $('#bus-dir').querySelectorAll('.seg-btn')) {
      const on = b.dataset.dir === dir;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
    $('#bus-from-label').textContent = dir === TO_SCHOOL
      ? 'Kust lähed (kodu juurest)' : 'Kust lähed (kooli juurest)';
    $('#bus-to-label').textContent = dir === TO_SCHOOL
      ? 'Kuhu sõidad (kooli juurde)' : 'Kuhu sõidad (kodu juurde)';
  }

  const bind = (inputSel, listSel, field) => {
    const input = $(inputSel);
    const list = $(listSel);
    input.oninput = () => {
      list.textContent = '';
      if (input.value === draft[field]) return;   // juba valitud
      for (const name of searchStops(state.busData.stops, input.value)) {
        const b = el('button', 'stop-hit', name);
        b.type = 'button';
        b.addEventListener('click', () => { draft[field] = name; input.value = name; list.textContent = ''; });
        list.append(b);
      }
    };
  };
  bind('#bus-from', '#bus-from-hits', 'from');
  bind('#bus-to', '#bus-to-hits', 'to');

  function openForm(pre = {}) {
    draft.from = pre.from ?? '';
    draft.to = pre.to ?? '';
    draft.walk = pre.walk ?? DEFAULT_WALK_MIN;
    $('#bus-from').value = draft.from;
    $('#bus-to').value = draft.to;
    $('#bus-walk').value = draft.walk;
    $('#bus-from-hits').textContent = '';
    $('#bus-to-hits').textContent = '';
    $('#bus-error').textContent = '';
    setDir(pre.dir ?? TO_HOME);
    form.hidden = false;
    $('#bus-add-open').hidden = true;
  }

  function closeForm() {
    form.hidden = true;
    $('#bus-add-open').hidden = false;
    $('#bus-error').textContent = '';
  }

  $('#bus-dir').onclick = (e) => {
    const b = e.target.closest('.seg-btn');
    if (b) setDir(b.dataset.dir);
  };
  $('#bus-add-open').onclick = () => openForm();
  $('#bus-cancel').onclick = closeForm;

  $('#bus-save').onclick = () => {
    const from = $('#bus-from').value.trim();
    const to = $('#bus-to').value.trim();
    const walk = Math.max(0, Math.min(60, Number($('#bus-walk').value) || 0));
    const fromIdsAll = idsByName(state.busData.stops, from);
    const toIds = idsByName(state.busData.stops, to);

    if (!fromIdsAll.length || !toIds.length) {
      $('#bus-error').textContent = 'Vali mõlemad peatused nimekirjast.';
      return;
    }
    const { routes, fromIds, rides } = matchRoutes(state.busData.paths, fromIdsAll, toIds);
    if (!routes.length) {
      $('#bus-error').textContent = `Otseliini ${from} → ${to} ei leidnud. Proovi mõnda lähedast peatust.`;
      return;
    }
    const cfg = { dir: draft.dir, fromName: from, toName: to, fromIds, routes, rides, walk };
    if (state.buses.some((b) => sameRoute(b, cfg))) {
      $('#bus-error').textContent = 'See suund on juba lisatud.';
      return;
    }

    state.buses.push(cfg);
    saveBuses();
    closeForm();
    renderRoutes();
    render();
  };

  renderRoutes();
  closeForm();
  if (!state.buses.length) openForm();
  dlg.showModal();
  trackScreen('/bussid');
}

/* ---------- Klassi valik ---------- */

function renderPicker() {
  const grid = $('#picker-grid');
  grid.textContent = '';
  const byGrade = new Map();
  for (const k of state.data.classOrder) {
    const g = gradeOf(k);
    if (!byGrade.has(g)) byGrade.set(g, []);
    byGrade.get(g).push(k);
  }
  for (const [grade, list] of [...byGrade].sort((a, b) => a[0] - b[0])) {
    const row = el('div', 'grade-row');
    row.append(el('h2', null, `${grade}. klass`));
    const inner = el('div', 'row');
    for (const k of list) {
      const b = el('button', 'class-btn', k);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(k === state.klass));
      b.addEventListener('click', () => {
        state.klass = k;
        store.set(LS_CLASS, k);
        state.selected = defaultDate(new Date(), k);
        showApp();
      });
      inner.append(b);
    }
    row.append(inner);
    grid.append(row);
  }
}

function showPicker() {
  renderPicker();
  $('#picker').hidden = false;
  $('#app').hidden = true;
  trackScreen('/klassivalik');
}

function showApp() {
  // Laps jõudis klassi valida enne kui juhend ilmus — ärme hüppa plaani peale.
  clearTimeout(installTimer);
  $('#picker').hidden = true;
  $('#app').hidden = false;
  state.editingChoice = null;
  trackScreen('/');
  render();
}

/* ---------- Avakuvale lisamine ---------- */

// Brauser pakub seda ainult siis, kui rakendus pole veel paigaldatud ja
// tingimused on täidetud. iOS ei saada seda kunagi.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // ära lase brauseril oma riba näidata
  installPrompt = e;
});

/** Kas rakendus juba käib avakuvalt? Siis pole juhendil mõtet. */
const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/**
 * Juhend seadme järgi. iOS-il pole paigaldamiseks mingit API-t, ainus tee on
 * näidata, kus Jaga-nupp asub; Androidil on see brauseri menüüs.
 */
function installSteps() {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) {
    // iOS-il on nupud brauseriti eri kohas. Chrome ja teised iOS-i brauserid
    // annavad end kasutajaagendis teada (CriOS, FxiOS, EdgiOS); ülejäänu on
    // Safari, kus jagamine käib ••• menüü alt.
    // Menüünimed inglise keeles: iOS-il ei ole eestikeelset varianti, seega
    // laps näeb ekraanil täpselt neid sõnu.
    if (/crios|fxios|edgios/i.test(ua)) {
      return ['Vajuta üleval jagamisikooni ⬆️',
              'Vali „Add to Home Screen”'];
    }
    return ['Vajuta ••• nuppu',
            'Vali „Share”',
            'Vali „Add to Home Screen”'];
  }
  if (/android/i.test(ua)) {
    return ['Vajuta paremal üleval kolme punkti ⋮',
            'Vali „Lisa avakuvale” või „Installi rakendus”'];
  }
  return ['Aadressiribal on paigaldamise ikoon',
          'Või vali brauseri menüüst „Installi”'];
}

function openInstall() {
  $('#sheet').close();
  const list = $('#install-steps');
  list.textContent = '';
  for (const step of installSteps()) list.append(el('li', null, step));

  // Päris paigaldusnupp ainult siis, kui brauser selle lubas.
  $('#install-now').hidden = !installPrompt;
  $('#install').showModal();
  trackScreen('/paigalda');
}

/**
 * Klassivaliku peale, kui laps on seal nähtaval oldud (mitte kella järgi
 * ka taustal olles). Esimesel korral 30s, kui see "sessioon" (nähtavaks
 * jäämine) enne seda taustale läheb, siis järgmisel korral juba 5s — ei
 * pea kohe uuesti kaua ootama, kui esimene kord peaaegu kohale jõudis.
 * Kutsutakse nii esimesel avamisel kui igal järgmisel nähtavaks-tulekul
 * (vt visibilitychange allpool); kui klass on juba valitud, ei tee midagi.
 */
let installTimer = null;
function maybeOfferInstall() {
  if (state.klass || store.get(LS_INSTALL, false) || isInstalled()) return;
  const delay = store.get(LS_INSTALL_TRIED, false) ? 5000 : 30000;
  store.set(LS_INSTALL_TRIED, true);
  installTimer = setTimeout(() => {
    // Kui laps jõudis vahepeal klassi valida, ei hüppa juhend enam ette.
    // showApp tühistab taimeri, aga see kontroll hoiab ka siis, kui
    // tühistus mingil põhjusel maha magatakse.
    if (state.klass) return;
    // Lipp läheb püsti näitamisel: juhend on ühekordne, ka siis kui laps
    // selle kohe kinni paneb.
    store.set(LS_INSTALL, true);
    openInstall();
  }, delay);
}

/* ---------- Infoleht ---------- */

function openSheet() {
  const info = $('#sheet-info');
  info.textContent = '';
  const cls = state.data.classes[state.klass];
  const rows = [
    ['Klass', state.klass],
    ['Klassijuhataja', cls?.homeroom || '—'],
    ['Tunniplaan uuendatud', state.data.sourceUpdated || 'teadmata'],
    ['Andmed laaditud', (state.data.scrapedAt || '').slice(0, 10) || '—'],
  ];
  for (const [k, v] of rows) {
    const d = el('div');
    d.append(el('dt', null, k), el('dd', null, v));
    info.append(d);
  }
  $('#sheet').showModal();
  trackScreen('/info');
}

/* ---------- Käivitus ---------- */

async function loadJSON(path, fallback) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return fallback;
  }
}

async function init() {
  const [data, changes, holidays, notable, namedays, overrides, menu] = await Promise.all([
    loadJSON('data.json', null),
    loadJSON('changes.json', {}),
    loadJSON('holidays.json', null),
    loadJSON('notabledays.json', null),
    loadJSON('namedays.json', null),
    loadJSON('overrides.json', null),
    loadJSON('menu.json', null),
  ]);

  if (!data) {
    document.body.innerHTML = '<div class="empty" style="padding-top:80px"><span class="big">📡</span>Tunniplaani ei õnnestunud laadida.<br>Ava rakendus korraks internetiühendusega.</div>';
    return;
  }

  state.data = data;
  state.changes = changes || {};
  state.holidays = holidays;
  state.notable = notable;
  state.namedays = namedays;
  state.overrides = overrides;
  state.menu = menu;

  // Sama võti loeb ka index.html-i sisemine skript, et teema jõuaks kohale
  // enne esimest värvimist. Siin normaliseerime rikutud väärtuse.
  const saved = store.get(LS_THEME, 'auto');
  state.theme = THEMES.includes(saved) ? saved : 'auto';
  applyTheme(state.theme);
  renderThemeSeg();
  for (const b of document.querySelectorAll('#theme-seg .seg-btn')) {
    b.addEventListener('click', () => setTheme(b.dataset.theme));
  }

  if (!state.klass || !data.classes[state.klass]) {
    state.klass = null;
    showPicker();
    maybeOfferInstall();
  } else {
    state.selected = defaultDate(new Date(), state.klass);
    loadWeather();          // vahemälu jõuab kohale enne esimest renderdust
    showApp();
  }

  $('#class-btn').addEventListener('click', showPicker);
  $('#info-btn').addEventListener('click', openSheet);
  $('#close-sheet').addEventListener('click', () => $('#sheet').close());
  $('#install-open').addEventListener('click', openInstall);
  $('#install-close').addEventListener('click', () => $('#install').close());
  $('#install-now').addEventListener('click', async () => {
    if (!installPrompt) return;
    $('#install').close();
    installPrompt.prompt();
    installPrompt = null;      // ühekordne, brauser ei luba sama sündmust uuesti
  });

  // Taustale vajutamine sulgeb paneeli — telefonis kõige loomulikum liigutus.
  // Sisu peale klõps läheb lapselemendile, seega siia jõuab ainult taust.
  for (const id of ['#sheet', '#bus-setup', '#install']) {
    const dlg = $(id);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }
  $('#bus-setup-open').addEventListener('click', openBusSetup);
  $('#bus-close').addEventListener('click', () => $('#bus-setup').close());
  $('#change-class').addEventListener('click', () => { $('#sheet').close(); showPicker(); });
  $('#reset-picks').addEventListener('click', () => {
    state.picks = { ...state.picks, [state.klass]: {} };
    store.set(LS_PICKS, state.picks);
    $('#sheet').close();
    render();
  });

  // Kui telefon on olnud taskus üle tunni, arvuta päev ja "praegu" uuesti
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      trackLeaving((Date.now() - visibleSince) / 1000);
      clearTimeout(installTimer);   // sessioon lõppes ilma juhendit näitamata
      return;
    }
    visibleSince = Date.now();
    maybeOfferInstall();   // uus nähtavaks-tulek — proovi uuesti, õige viivitusega
    if (!state.klass) return;
    const before = iso(state.selected);
    state.now = new Date();
    const fresh = defaultDate(state.now, state.klass);
    if (iso(fresh) !== before) state.selected = fresh;
    loadWeather();
    render();
  });
  setInterval(() => {
    state.now = new Date();
    loadWeather();          // ise otsustab, kas midagi küsida on
    if (state.klass && !$('#app').hidden) render();
  }, 60000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  backfillRides();
}

init();
