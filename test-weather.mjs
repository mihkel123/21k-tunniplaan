// Ilmaloogika testid: node test-weather.mjs
import {
  forecastUrl, indexHourly, summarize, windLabel, precipKind, precipWord, iconFor,
  formatWeather, isPeSubject, peWeatherSeason, eventStartMin,
  POP_MAYBE, POP_LIKELY, adviceTemp, clothingFor,
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

// --- tunnetuslik temperatuur: nähtav alati, kui erineb näidatud vahemikust ---
t('Tundub ilmub, kui ümardatuna erineb näidatud kraadist', () => {
  const hours = build([[12, 20.1, 20.5, 0, 1, 1]]);
  const s = summarize(hours, day, 720, 765);
  assert.equal(Math.round(s.tempMin), 20);
  assert.equal(Math.round(s.feels), 21, 'sama päris ilm, mis 1. septembril kell 12');
});

t('Tundub ei ilmu, kui ümardatuna langeb näidatud vahemikku', () => {
  const same = build([[8, 16, 16.3, 0, 0, 0]]);
  assert.equal(summarize(same, day, 480, 525).feels, null, 'ümardub samaks kraadiks');
});

t('Tundub ei ilmu, kui langeb näidatud vahemiku SISSE (mitte ainult võrdseks)', () => {
  // 16–20°, tundub 18° — 18 on juba vahemiku sees, ei lisa infot.
  const hours = build([[10, 16, 16, 0, 0, 0], [11, 20, 18, 0, 0, 0]]);
  const s = summarize(hours, day, 600, 705);
  assert.equal(s.feels, null);
});

t('kuumal päeval võib tunduda soojem kui näidatud ülempiir', () => {
  const hours = build([[12, 27, 31, 0, 0, 1]]);
  assert.equal(summarize(hours, day, 720, 765).feels, 31);
});

t('külmal päeval võib tunduda külmem kui näidatud alampiir', () => {
  const hours = build([[8, 2, -3, 0, 71, 8]]);
  assert.equal(summarize(hours, day, 480, 525).feels, -3);
});

t('kui mõlemad otsad hälbivad, võidab suurem hälve', () => {
  // Näidatud 10–20°. Hommikutund tundub palju külmem (hälve 8), pärastlõunane
  // veidi soojem (hälve 1) — kokkuvõte peab valima külmema.
  const hours = build([[10, 10, 2, 0, 0, 6], [11, 20, 21, 0, 0, 1]]);
  const s = summarize(hours, day, 600, 705);
  assert.equal(s.feels, 2);
});

// --- tuul ---
t('tuule läved on täpselt piiril ja sildid suurtähelised', () => {
  assert.equal(windLabel(5.4), null);
  assert.equal(windLabel(5.5), 'Mõõdukas tuul');
  assert.equal(windLabel(7.9), 'Mõõdukas tuul');
  assert.equal(windLabel(8), 'Tugev tuul');
  assert.equal(windLabel(13.8), 'Tugev tuul');
  assert.equal(windLabel(13.9), 'Väga tugev tuul');
  assert.equal(windLabel(null), null);
});

// --- sademe liik ---
t('sademe liik tuleb koodist', () => {
  assert.equal(precipKind(63, 15), 'rain');
  assert.equal(precipKind(81, 15), 'rain');
  assert.equal(precipKind(73, 15), 'snow');
  assert.equal(precipKind(86, 15), 'snow');
  assert.equal(precipKind(67, 15), 'sleet');
  assert.equal(precipKind(57, 15), 'sleet');
});

t('kui kood sadu ei näita, otsustab kraad', () => {
  assert.equal(precipKind(3, 5), 'rain', 'pilves ja soe -> vihm');
  assert.equal(precipKind(3, 0.5), 'snow', 'pilves ja külm -> lumi');
  assert.equal(precipKind(3, 1), 'rain', 'täpselt +1° -> veel vihm');
  assert.equal(precipKind(0, null), 'rain', 'kraad puudub -> vaikimisi vihm');
});

t('sademe sõna on nimetavas käändes ja suure algustähega', () => {
  assert.equal(precipWord('rain'), 'Vihm');
  assert.equal(precipWord('snow'), 'Lumi');
  assert.equal(precipWord('sleet'), 'Lörts');
});

// --- ikoon käib alati protsendiga kokku, mitte koodiga ---
t('ikoon ei tohi numbriga vastuollu minna: sinu nähtud 46% ja 28%', () => {
  // 46% sadu, kood ütleb "peamiselt selge" (1) — ikoon pidi enne näitama päikest.
  assert.equal(iconFor(1, 46, 'rain'), '🌦️', '46% on "võib sadada" tsoonis');
  // 28% sadu, kood ütleb vihma (63) — ikoon pidi enne näitama vihma.
  assert.equal(iconFor(63, 28, 'rain'), '🌤️', '28% jääb alla 30% läve, ikoon ei tohi vihma näidata');
});

t('ikooniläved on täpselt piiril', () => {
  assert.equal(iconFor(1, 29, 'rain'), '🌤️');
  assert.equal(iconFor(1, 30, 'rain'), '🌦️');
  assert.equal(iconFor(1, 59, 'rain'), '🌦️');
  assert.equal(iconFor(61, 60, 'rain'), '🌧️');
});

t('äike võidab igasuguse protsendi', () => {
  assert.equal(iconFor(95, 5, 'rain'), '⛈️');
  assert.equal(iconFor(99, 0, 'rain'), '⛈️');
});

t('suure tõenäosuse juures käib ikoon sademe liigiga kaasas', () => {
  assert.equal(iconFor(61, 80, 'rain'), '🌧️');
  assert.equal(iconFor(73, 80, 'snow'), '❄️');
  assert.equal(iconFor(67, 80, 'sleet'), '🌨️');
});

t('madala tõenäosuse juures tuleb ikoon taevast, mitte sademest', () => {
  assert.equal(iconFor(0, 5, 'rain'), '☀️');
  assert.equal(iconFor(3, 5, 'rain'), '☁️');
  assert.equal(iconFor(48, 5, 'rain'), '🌫️');
  assert.equal(iconFor(2, 5, 'rain'), '🌤️');
  assert.equal(iconFor(null, 0, 'rain'), '🌤️');
});

// --- rida ekraanil ---
t('ühekraadine vahemik kirjutatakse ühe numbriga', () => {
  const hours = build([[8, 16.6, 16.6, 0, 0, 0], [9, 17.4, 17.4, 0, 0, 0]]);
  const line = formatWeather(summarize(hours, day, 480, 585));
  assert.equal(line.text, '17°');
});

t('täisrida paneb osad õigesse järjekorda, suured algustähed', () => {
  const hours = build([[11, 16, 13, 60, 63, 9]]);
  const line = formatWeather(summarize(hours, day, 660, 705));
  assert.equal(line.icon, '🌧️');
  assert.equal(line.text, '16° · Tundub 13° · Vihm 60% · Tugev tuul');
});

t('sademed alates 10%, alla selle ei mainita', () => {
  const nine = formatWeather(summarize(build([[11, 16, 16, 9, 61, 0]]), day, 660, 705));
  assert.equal(nine.text, '16°');
  const ten = formatWeather(summarize(build([[11, 16, 16, 10, 61, 0]]), day, 660, 705));
  assert.equal(ten.text, '16° · Vihm 10%');
});

t('vaiksel ilmal jääb alles ainult kraad', () => {
  const line = formatWeather(summarize(build([[11, 16, 16, 0, 1, 2]]), day, 660, 705));
  assert.equal(line.text, '16°');
  assert.equal(line.icon, '🌤️');
});

t('olematust kokkuvõttest rida ei teki', () => {
  assert.equal(formatWeather(null), null);
});

t('päris andmete näide: 1. september kell 12, 20,1° tundub 20,5°, sadu 25%', () => {
  const hours = build([[12, 20.1, 20.5, 25, 2, 3.2]]);
  const line = formatWeather(summarize(hours, day, 720, 765));
  assert.equal(line.text, '20° · Tundub 21° · Vihm 25%');
  assert.equal(line.icon, '🌤️', '25% on alla 30% läve, seega ikoon jääb taevast, mitte sademest');
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

// --- konstandid, et läved ei liiguks vaikselt ---
t('ikoonilävede konstandid on need, mida testid eeldavad', () => {
  assert.equal(POP_MAYBE, 30);
  assert.equal(POP_LIKELY, 60);
});

// --- päeva ilmariba: riietuse nõuanne ---
t('adviceTemp valib külmema kahest kraadist', () => {
  assert.equal(adviceTemp({ tempMin: 10, feels: 6 }), 6, 'tunnetuslik külmem -> tema');
  assert.equal(adviceTemp({ tempMin: 10, feels: 14 }), 10, 'tunnetuslik soojem -> päris kraad jääb');
  assert.equal(adviceTemp({ tempMin: 10, feels: 10 }), 10, 'võrdne -> päris kraad');
  assert.equal(adviceTemp({ tempMin: 10, feels: null }), 10, 'tunnetuslik puudub -> päris kraad');
  assert.equal(adviceTemp(null), null);
});

t('riietusebandid on täpselt piiril: 0 / 10 / 21', () => {
  assert.deepEqual(clothingFor(-0.1), { icon: '🧊', label: 'Talvejope' });
  assert.deepEqual(clothingFor(0), { icon: '🧥', label: 'Soe jope' });
  assert.deepEqual(clothingFor(9.9), { icon: '🧥', label: 'Soe jope' });
  assert.deepEqual(clothingFor(10), { icon: '🧢', label: 'Kerge jope' });
  assert.deepEqual(clothingFor(20), { icon: '🧢', label: 'Kerge jope' });
  assert.deepEqual(clothingFor(21), { icon: '👕', label: 'Õhuke riietus' });
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
