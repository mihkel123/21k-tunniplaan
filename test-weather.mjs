// Ilmaloogika testid: node test-weather.mjs
import {
  forecastUrl, indexHourly, summarize, windLabel, precipWord, iconFor,
  formatWeather, isPeSubject, peWeatherSeason, eventStartMin,
} from './weather.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

/** Kerge abiline: tunnid ühe päeva kohta -> indeks nagu indexHourly annab. */
const day = '2026-09-01';
const build = (rows) => {
  const hours = {};
  for (const [h, temp, feels, pop, code, wind] of rows) {
    hours[`${day}T${String(h).padStart(2, '0')}:00`] = [temp, feels, pop, code, wind];
  }
  return hours;
};

// --- päringu kuju ---
t('päring küsib kõik viis välja ja meetrid sekundis', () => {
  const u = new URL(forecastUrl());
  assert.equal(u.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(u.searchParams.get('timezone'), 'Europe/Tallinn');
  assert.equal(u.searchParams.get('forecast_days'), '7');
  const fields = u.searchParams.get('hourly').split(',');
  assert.deepEqual(fields, ['temperature_2m', 'apparent_temperature',
    'precipitation_probability', 'weather_code', 'wind_speed_10m']);
});

t('koordinaadid on kooli omad, mitte linna keskpunkt', () => {
  const u = new URL(forecastUrl());
  assert.equal(u.searchParams.get('latitude'), '59.4352');
  assert.equal(u.searchParams.get('longitude'), '24.7665');
});

// --- vastuse indekseerimine ---
t('rööpmassiivid saavad tunnivõtmed', () => {
  const hours = indexHourly({
    hourly: {
      time: ['2026-09-01T09:00', '2026-09-01T10:00'],
      temperature_2m: [16.7, 17.9],
      apparent_temperature: [15.1, 16.2],
      precipitation_probability: [8, 12],
      weather_code: [1, 2],
      wind_speed_10m: [3.4, 3.5],
    },
  });
  assert.deepEqual(hours['2026-09-01T09:00'], [16.7, 15.1, 8, 1, 3.4]);
  assert.deepEqual(hours['2026-09-01T10:00'], [17.9, 16.2, 12, 2, 3.5]);
});

t('tühi või katkine vastus ei lõhu midagi', () => {
  assert.equal(indexHourly(null), null);
  assert.equal(indexHourly({}), null);
  assert.equal(indexHourly({ hourly: { time: [] } }), null);
});

// --- akna arvutus ---
t('45-minutine tund puudutab ühte täistundi', () => {
  const hours = build([[8, 10, 10, 0, 0, 0], [9, 20, 20, 0, 0, 0]]);
  const s = summarize(hours, day, 8 * 60, 8 * 60 + 45);
  assert.equal(s.tempMin, 10);
  assert.equal(s.tempMax, 10);
});

t('üle täistunni ulatuv aken võtab mõlemad tunnid', () => {
  const hours = build([[10, 12, 12, 0, 0, 0], [11, 18, 18, 0, 0, 0]]);
  const s = summarize(hours, day, 10 * 60, 11 * 60 + 45);
  assert.equal(s.tempMin, 12);
  assert.equal(s.tempMax, 18);
});

t('täpselt täistunnil lõppev aken ei haara järgmist tundi', () => {
  const hours = build([[10, 12, 12, 0, 0, 0], [11, 30, 30, 0, 100, 0]]);
  const s = summarize(hours, day, 10 * 60, 11 * 60);
  assert.equal(s.tempMax, 12, 'kell 11 algav tund jääb välja');
});

t('puuduv päev annab null', () => {
  const hours = build([[8, 10, 10, 0, 0, 0]]);
  assert.equal(summarize(hours, '2026-12-24', 8 * 60, 8 * 60 + 45), null);
  assert.equal(summarize(null, day, 480, 525), null);
});

t('halvim väärtus akna sees võidab', () => {
  const hours = build([
    [10, 12, 12, 20, 3, 4],
    [11, 18, 18, 60, 63, 9],
  ]);
  const s = summarize(hours, day, 10 * 60, 11 * 60 + 45);
  assert.equal(s.pop, 60);
  assert.equal(s.code, 63);
  assert.equal(s.wind, 9);
});

// --- tajutav temperatuur ---
t('tundub näidatakse alates kolmest kraadist, mitte enne', () => {
  const near = build([[8, 16, 13.1, 0, 0, 0]]);
  assert.equal(summarize(near, day, 480, 525).feels, null, '2,9 kraadi jääb näitamata');
  const far = build([[8, 16, 13, 0, 0, 0]]);
  assert.equal(summarize(far, day, 480, 525).feels, 13, '3,0 kraadi näidatakse');
});

t('kuumal päeval võib tunduda soojem', () => {
  const hours = build([[12, 27, 31, 0, 0, 1]]);
  assert.equal(summarize(hours, day, 720, 765).feels, 31);
});

t('tundub jääb näidatud kraadidest välja', () => {
  // 16–20°, tundub 13° — mitte kunagi "tundub 17°", mis oleks segadus.
  const hours = build([[10, 16, 12, 0, 0, 0], [11, 20, 17, 0, 0, 0]]);
  const s = summarize(hours, day, 600, 705);
  assert.equal(s.feels, 12);
  assert.ok(s.feels < s.tempMin);
});

// --- tuul ---
t('tuule läved on täpselt piiril', () => {
  assert.equal(windLabel(5.4), null);
  assert.equal(windLabel(5.5), 'mõõdukas tuul');
  assert.equal(windLabel(7.9), 'mõõdukas tuul');
  assert.equal(windLabel(8), 'tugev tuul');
  assert.equal(windLabel(13.8), 'tugev tuul');
  assert.equal(windLabel(13.9), 'väga tugev tuul');
  assert.equal(windLabel(null), null);
});

// --- sademed ja ikoon ---
t('sademete sõna tuleb ilmakoodist', () => {
  assert.equal(precipWord(63), 'vihma');
  assert.equal(precipWord(81), 'vihma');
  assert.equal(precipWord(73), 'lund');
  assert.equal(precipWord(86), 'lund');
  assert.equal(precipWord(67), 'lörtsi');
  assert.equal(precipWord(57), 'lörtsi');
});

t('ikoon katab kogu koodivahemiku', () => {
  assert.equal(iconFor(0), '☀️');
  assert.equal(iconFor(2), '🌤️');
  assert.equal(iconFor(3), '☁️');
  assert.equal(iconFor(48), '🌫️');
  assert.equal(iconFor(53), '🌦️');
  assert.equal(iconFor(63), '🌧️');
  assert.equal(iconFor(82), '🌧️');
  assert.equal(iconFor(73), '❄️');
  assert.equal(iconFor(95), '⛈️');
  assert.equal(iconFor(null), '🌤️');
});

// --- rida ekraanil ---
t('ühekraadine vahemik kirjutatakse ühe numbriga', () => {
  const hours = build([[8, 16.6, 16.6, 0, 0, 0], [9, 17.4, 17.4, 0, 0, 0]]);
  const line = formatWeather(summarize(hours, day, 480, 585));
  assert.equal(line.text, '17°');
});

t('täisrida paneb osad õigesse järjekorda', () => {
  const hours = build([[11, 16, 13, 60, 63, 9]]);
  const line = formatWeather(summarize(hours, day, 660, 705));
  assert.equal(line.icon, '🌧️');
  assert.equal(line.text, '16° · tundub 13° · vihma 60% · tugev tuul');
});

t('sademed alates 10%, alla selle ei mainita', () => {
  const nine = formatWeather(summarize(build([[11, 16, 16, 9, 61, 0]]), day, 660, 705));
  assert.equal(nine.text, '16°');
  const ten = formatWeather(summarize(build([[11, 16, 16, 10, 61, 0]]), day, 660, 705));
  assert.equal(ten.text, '16° · vihma 10%');
});

t('vaiksel ilmal jääb alles ainult kraad', () => {
  const line = formatWeather(summarize(build([[11, 16, 15, 0, 1, 2]]), day, 660, 705));
  assert.equal(line.text, '16°');
  assert.equal(line.icon, '🌤️');
});

t('olematust kokkuvõttest rida ei teki', () => {
  assert.equal(formatWeather(null), null);
});

// --- kus ilma näidata ---
t('liikumisõpetus tunneb end ära', () => {
  assert.ok(isPeSubject('liikumisõpetus'));
  assert.ok(isPeSubject('kehaline kasvatus'));
  assert.ok(!isPeSubject('matemaatika'));
  assert.ok(!isPeSubject(''));
  assert.ok(!isPeSubject(undefined));
});

t('talvel liikumisõpetuse ilma ei näidata', () => {
  assert.ok(peWeatherSeason(new Date(2026, 10, 30)), '30. november näitab');
  assert.ok(!peWeatherSeason(new Date(2026, 11, 1)), '1. detsember ei näita');
  assert.ok(!peWeatherSeason(new Date(2027, 0, 15)), 'jaanuar ei näita');
  assert.ok(!peWeatherSeason(new Date(2027, 2, 31)), '31. märts ei näita');
  assert.ok(peWeatherSeason(new Date(2027, 3, 1)), '1. aprill näitab');
});

t('sündmuse kellaaeg loetakse, lause mitte', () => {
  assert.equal(eventStartMin('10:00'), 600);
  assert.equal(eventStartMin('9:05'), 545);
  assert.equal(eventStartMin('pärast aktust'), null);
  assert.equal(eventStartMin(''), null);
  assert.equal(eventStartMin(undefined), null);
  assert.equal(eventStartMin('25:00'), null);
});

// --- päris andmed ---
t('väliüritused on erandpäeval õueks märgitud', () => {
  const ov = JSON.parse(readFileSync(new URL('./overrides.json', import.meta.url), 'utf8'));
  const events = Object.values(ov.days).flatMap((d) => Object.values(d.classes).flat());
  const outside = events.filter((e) => /koolimaja ees|spordiväljak/i.test(e.room || ''));
  assert.ok(outside.length > 0, 'õues toimuvaid sündmusi peab olema');
  const puudu = outside.filter((e) => e.outdoor !== true);
  assert.deepEqual(puudu.map((e) => `${e.title} @ ${e.room}`), [], 'igal õuesündmusel peab olema outdoor');
  // Ja vastupidi: siseruumis toimuvale lippu ei panda.
  const vale = events.filter((e) => e.outdoor && !/koolimaja ees|spordiväljak/i.test(e.room || ''));
  assert.deepEqual(vale.map((e) => `${e.title} @ ${e.room}`), []);
});

t('igal õuesündmusel on kellaaeg, muidu ilma küsida ei saa', () => {
  const ov = JSON.parse(readFileSync(new URL('./overrides.json', import.meta.url), 'utf8'));
  const events = Object.values(ov.days).flatMap((d) => Object.values(d.classes).flat());
  for (const e of events.filter((x) => x.outdoor)) {
    assert.ok(eventStartMin(e.at) != null, `${e.title} @ ${e.at}`);
  }
});

console.log(`\n${pass} testi läbitud.`);
