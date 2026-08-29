/* Tunniplaan — Tallinna 21. Kool. Vanilla ES-moodul, ehitusprotsessi pole. */

import {
  DAY_LETTER, DAY_NAME,
  iso, addDays, startOfDay, weekdayIndex, minutesOf, gradeOf, formatDay,
  holidayOn as holidayIn, isSchoolDay as isSchoolDayIn, defaultDate as defaultDateIn,
  relativeLabel, isFreshChange,
} from './schedule.js';

const LS_CLASS = 'tp.klass';
const LS_PICKS = 'tp.picks';

/* ---------- Väikesed abifunktsioonid ---------- */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};


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

/* ---------- Olek ---------- */

const state = {
  data: null,
  changes: {},
  holidays: null,
  klass: store.get(LS_CLASS, null),
  picks: store.get(LS_PICKS, {}),
  selected: null,   // valitud kuupäev (Date)
  now: new Date(),
};

const picksFor = (klass) => state.picks[klass] || {};

/* ---------- Koolipäevad ja vaheajad ---------- */

const holidayOn = (date, klass) => holidayIn(state.holidays, date, klass);
const isSchoolDay = (date, klass) => isSchoolDayIn(state.holidays, date, klass);
const defaultDate = (now, klass) => defaultDateIn(state.holidays, now, klass);

/* ---------- Muudatused ---------- */

function changeFor(klass, period, day) {
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

/* ---------- Rühmavalikud ---------- */

/* Rühma tunnus peab sisaldama ka õpetajat: 7A esimeses tunnis on kaks eri
   lastekoori (Õmblus ja Urbel), mille ainekood on mõlemal 'LAK'. */
const entryKey = (e) => `${e.subject}·${e.teacher}`;
const choiceKey = (cell) => cell.map(entryKey).sort().join('|');

function chooseGroup(klass, cell, entry) {
  const picks = { ...picksFor(klass), [choiceKey(cell)]: entryKey(entry) };
  state.picks = { ...state.picks, [klass]: picks };
  store.set(LS_PICKS, state.picks);
  render();
}

/** -> { chosen, alts, undecided } */
function splitCell(klass, cell) {
  if (cell.length <= 1) return { chosen: cell[0] ?? null, alts: [], undecided: false };
  const pick = picksFor(klass)[choiceKey(cell)];
  const chosen = cell.find((e) => entryKey(e) === pick);
  if (!chosen) return { chosen: null, alts: cell, undecided: true };
  return { chosen, alts: cell.filter((e) => e !== chosen), undecided: false };
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
  if (opts.change) {
    const c = el('div', 'changed');
    c.append(el('span', null, '🔄'), el('span', null, changeText(opts.change)));
    what.append(c);
  }
  card.append(what);

  if (opts.now) card.append(el('span', 'pill now', 'Praegu'));
  else if (opts.next) card.append(el('span', 'pill next', 'Järgmine'));
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

function altRow(entry, onPick) {
  const b = el('button', 'alt');
  b.type = 'button';
  const label = el('span', 'alt-label');
  label.append(el('b', null, entry.subjectFull || entry.subject));
  if (entry.teacherFull || entry.teacher) {
    label.append(el('span', null, entry.teacherFull || entry.teacher));
  }
  b.append(el('span', 'emoji', emojiFor(entry.subjectFull)), label, el('span', 'swap', 'vali'));
  b.addEventListener('click', onPick);
  return b;
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

  const grid = data.classes[klass].grid;
  const isToday = iso(selected) === iso(state.now);
  const nowMin = state.now.getHours() * 60 + state.now.getMinutes();

  // Leia praegu käiv ja järgmine tund
  let nowIdx = -1;
  let nextIdx = -1;
  if (isToday) {
    data.periods.forEach((p, i) => {
      if (!grid[i]?.[day]?.length) return;
      if (nowMin >= minutesOf(p.start) && nowMin <= minutesOf(p.end)) nowIdx = i;
      else if (nextIdx === -1 && nowMin < minutesOf(p.start)) nextIdx = i;
    });
  }

  let any = false;
  data.periods.forEach((period, i) => {
    const cell = grid[i]?.[day] ?? [];
    const change = changeFor(klass, i, day);

    // Tühi pesa, kust tund kadus — näita kummituskaarti, muidu jääks muutus märkamata
    if (!cell.length) {
      if (change && (change.kind === 'removed' || change.movedTo)) {
        any = true;
        main.append(ghostCard(period, change));
      }
      return;
    }
    any = true;

    const { chosen, alts, undecided } = splitCell(klass, cell);

    if (undecided) {
      main.append(el('p', 'group-hint', 'Vali oma rühm:'));
      for (const entry of cell) {
        const card = lessonCard(entry, period, { change });
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => chooseGroup(klass, cell, entry));
        main.append(card);
      }
      return;
    }

    main.append(lessonCard(chosen, period, { now: i === nowIdx, next: i === nextIdx, change }));
    for (const a of alts) main.append(altRow(a, () => chooseGroup(klass, cell, a)));
  });

  if (!any) {
    const e = el('div', 'empty');
    e.append(el('span', 'big', '🎈'), el('div', null, 'Sel päeval tunde pole.'));
    main.append(e);
  }
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
    b.addEventListener('click', () => { state.selected = d; render(); });
    strip.append(b);
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

  const d = state.data;
  $('#source-note').textContent = d.sourceUpdated
    ? `Kooli tunniplaan uuendatud ${d.sourceUpdated}`
    : 'Allikas: 21k.ee';
}

function render() {
  renderHeader();
  renderWeekstrip();
  renderLessons();
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
}

function showApp() {
  $('#picker').hidden = true;
  $('#app').hidden = false;
  render();
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
  const [data, changes, holidays] = await Promise.all([
    loadJSON('data.json', null),
    loadJSON('changes.json', {}),
    loadJSON('holidays.json', null),
  ]);

  if (!data) {
    document.body.innerHTML = '<div class="empty" style="padding-top:80px"><span class="big">📡</span>Tunniplaani ei õnnestunud laadida.<br>Ava rakendus korraks internetiühendusega.</div>';
    return;
  }

  state.data = data;
  state.changes = changes || {};
  state.holidays = holidays;

  if (!state.klass || !data.classes[state.klass]) {
    state.klass = null;
    showPicker();
  } else {
    state.selected = defaultDate(new Date(), state.klass);
    showApp();
  }

  $('#class-btn').addEventListener('click', showPicker);
  $('#info-btn').addEventListener('click', openSheet);
  $('#close-sheet').addEventListener('click', () => $('#sheet').close());
  $('#change-class').addEventListener('click', () => { $('#sheet').close(); showPicker(); });
  $('#reset-picks').addEventListener('click', () => {
    state.picks = { ...state.picks, [state.klass]: {} };
    store.set(LS_PICKS, state.picks);
    $('#sheet').close();
    render();
  });

  // Kui telefon on olnud taskus üle tunni, arvuta päev ja "praegu" uuesti
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.klass) return;
    const before = iso(state.selected);
    state.now = new Date();
    const fresh = defaultDate(state.now, state.klass);
    if (iso(fresh) !== before) state.selected = fresh;
    render();
  });
  setInterval(() => { state.now = new Date(); if (state.klass && !$('#app').hidden) render(); }, 60000);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
