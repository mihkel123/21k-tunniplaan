// Päevaloogika testid: node test-schedule.mjs
import { defaultDate, holidayOn, isSchoolDay, relativeLabel, isFreshChange, weekdayIndex, iso, easterSunday, nthWeekday, notableOn, namesOn } from './schedule.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const H = JSON.parse(readFileSync('./holidays.json', 'utf8'));
const at = (s) => new Date(s);           // kohalik aeg
const d = (s) => iso(defaultDate(H, at(s), '7A'));

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

// --- 16:00 lävi ---
t('kolmapäev 15:59 -> täna', () => assert.equal(d('2026-09-02T15:59'), '2026-09-02'));
t('kolmapäev 16:00 -> homme', () => assert.equal(d('2026-09-02T16:00'), '2026-09-03'));
t('kolmapäev 16:01 -> homme', () => assert.equal(d('2026-09-02T16:01'), '2026-09-03'));
t('kolmapäev 23:59 -> homme', () => assert.equal(d('2026-09-02T23:59'), '2026-09-03'));
t('neljapäev 00:30 -> ikka neljapäev (mitte reede)', () => assert.equal(d('2026-09-03T00:30'), '2026-09-03'));
t('neljapäev 02:00 -> neljapäev (kasutaja 4pm-2am aken)', () => assert.equal(d('2026-09-03T02:00'), '2026-09-03'));
t('neljapäev 03:00 -> neljapäev', () => assert.equal(d('2026-09-03T03:00'), '2026-09-03'));
t('neljapäev 08:00 -> neljapäev', () => assert.equal(d('2026-09-03T08:00'), '2026-09-03'));

// --- nädalavahetus ---
t('reede 16:00 -> esmaspäev', () => assert.equal(d('2026-09-04T16:00'), '2026-09-07'));
t('laupäev keskpäev -> esmaspäev', () => assert.equal(d('2026-09-05T12:00'), '2026-09-07'));
t('pühapäev 20:00 -> esmaspäev', () => assert.equal(d('2026-09-06T20:00'), '2026-09-07'));
t('pühapäev 09:00 -> esmaspäev', () => assert.equal(d('2026-09-06T09:00'), '2026-09-07'));

// --- koolivaheajad ---
t('sügisvaheaja esimene päev on vaba', () => assert.ok(holidayOn(H, at('2026-10-26T09:00'), '7A')));
t('sügisvaheaja viimane päev on vaba', () => assert.ok(holidayOn(H, at('2026-11-01T09:00'), '7A')));
t('sügisvaheaja eelne reede on koolipäev', () => assert.ok(isSchoolDay(H, at('2026-10-23T09:00'), '7A')));
t('reede enne sügisvaheaega 16:00 -> vaheaja järgne esmaspäev', () =>
  assert.equal(d('2026-10-23T16:00'), '2026-11-02'));
t('vaheaja sees -> esimene koolipäev pärast vaheaega', () =>
  assert.equal(d('2026-10-28T10:00'), '2026-11-02'));
t('jõuluvaheaeg katab uusaasta', () => assert.ok(holidayOn(H, at('2027-01-01T10:00'), '7A')));
t('3. jaanuar veel vaheaeg, 4. jaanuar juba kool', () => {
  assert.ok(holidayOn(H, at('2027-01-03T10:00'), '7A'));
  assert.ok(!holidayOn(H, at('2027-01-04T10:00'), '7A'));
});

// --- klassipõhised erandid ---
t('kevadvaheaeg kehtib 7. klassile', () => assert.ok(holidayOn(H, at('2027-04-13T10:00'), '7A')));
t('kevadvaheaeg EI kehti 12. klassile', () => assert.ok(!holidayOn(H, at('2027-04-13T10:00'), '12A')));
t('suvevaheaeg EI kehti 9. ega 12. klassile', () => {
  assert.ok(!holidayOn(H, at('2027-06-10T10:00'), '9B'));
  assert.ok(!holidayOn(H, at('2027-06-10T10:00'), '12A'));
  assert.ok(holidayOn(H, at('2027-06-10T10:00'), '8B'));
});

// --- riigipüha ---
t('suur reede on vaba', () => assert.ok(holidayOn(H, at('2027-03-26T09:00'), '7A')));
t('neljapäev enne suurt reedet 16:00 -> hüppab üle esmaspäeva', () =>
  assert.equal(d('2027-03-25T16:00'), '2027-03-29'));

// --- sildid ja värskus ---
t('sildid Täna/Homme', () => {
  const now = at('2026-09-02T10:00');
  assert.equal(relativeLabel(at('2026-09-02T00:00'), now), 'Täna');
  assert.equal(relativeLabel(at('2026-09-03T00:00'), now), 'Homme');
  assert.equal(relativeLabel(at('2026-09-04T00:00'), now), null);
});
t('muudatus aegub 14 päevaga', () => {
  const now = at('2026-09-20T10:00');
  assert.ok(isFreshChange({ since: '2026-09-07' }, now), '13 päeva -> värske');
  assert.ok(isFreshChange({ since: '2026-09-06' }, now), '14 päeva -> veel värske');
  assert.ok(!isFreshChange({ since: '2026-09-05' }, now), '15 päeva -> aegunud');
});
t('nädalapäeva indeks: E=0 … P=6', () => {
  assert.equal(weekdayIndex(at('2026-08-31T00:00')), 0);  // esmaspäev
  assert.equal(weekdayIndex(at('2026-09-06T00:00')), 6);  // pühapäev
});

/* ---------- Riigipühad, tähtpäevad, nimepäevad ---------- */

const notable = JSON.parse(readFileSync(new URL('./notabledays.json', import.meta.url), 'utf8'));
const namedays = JSON.parse(readFileSync(new URL('./namedays.json', import.meta.url), 'utf8'));
const on = (s) => new Date(`${s}T12:00:00`);

t('ülestõusmispühad arvutatakse õigesti', () => {
  // Teadaolevad kuupäevad; 2027 langeb kokku holidays.json-i suure reedega.
  assert.equal(iso(easterSunday(2024)), '2024-03-31');
  assert.equal(iso(easterSunday(2025)), '2025-04-20');
  assert.equal(iso(easterSunday(2026)), '2026-04-05');
  assert.equal(iso(easterSunday(2027)), '2027-03-28');
});

t('kuu n-s nädalapäev', () => {
  assert.equal(iso(nthWeekday(2026, 5, 0, 2)), '2026-05-10', 'emadepäev');
  assert.equal(iso(nthWeekday(2026, 11, 0, 2)), '2026-11-08', 'isadepäev');
  assert.equal(iso(nthWeekday(2026, 10, 6, 3)), '2026-10-17', 'hõimupäev');
});

t('kindla kuupäevaga tähtpäevad', () => {
  assert.deepEqual(notableOn(notable, on('2026-02-24')).map((x) => x.name), ['iseseisvuspäev']);
  assert.deepEqual(notableOn(notable, on('2026-03-14')).map((x) => x.name), ['emakeelepäev']);
  assert.deepEqual(notableOn(notable, on('2026-11-10')).map((x) => x.name), ['mardipäev']);
  assert.deepEqual(notableOn(notable, on('2026-08-28')), [], 'tavaline päev on tühi');
});

t('liikuvad tähtpäevad tulevad ülestõusmispühadest', () => {
  // 2027: ülestõusmispühad 28.03, seega suur reede 26.03 ja vastlapäev 09.02.
  assert.deepEqual(notableOn(notable, on('2027-03-26')).map((x) => x.name), ['suur reede']);
  assert.deepEqual(notableOn(notable, on('2027-03-28')).map((x) => x.name), ['ülestõusmispühad']);
  assert.deepEqual(notableOn(notable, on('2027-02-09')).map((x) => x.name), ['vastlapäev']);
});

t('suur reede klapib holidays.json-iga', () => {
  // Kaks sõltumatut allikat peavad sama päeva ütlema, muidu on üks vale.
  for (const h of H.publicHolidays ?? []) {
    const names = notableOn(notable, on(h.date)).map((x) => x.name.toLowerCase());
    assert.ok(names.includes(h.name.toLowerCase()),
      `${h.date} ${h.name} peaks olema ka notabledays.json-is, sain: ${names}`);
  }
});

t('igal tähtpäeval on emoji', () => {
  // Ilma selleta jääb uue päeva lisamisel emoji vaikselt puudu ja rida
  // kukub tagasi üldisele ikoonile, ilma et keegi seda märkaks.
  const ilma = notable.days.filter((d) => !d.emoji).map((d) => d.name);
  assert.deepEqual(ilma, [], `emojita: ${ilma.join(', ')}`);
});

t('nimepäevad on igal päeval, ka liigaastal', () => {
  assert.deepEqual(namesOn(namedays, on('2026-08-29')), ['Õnne', 'Õnnela']);
  assert.ok(namesOn(namedays, on('2024-02-29')).length, 'liigapäeval on samuti nimed');
  assert.equal(Object.keys(namedays.days).length, 366);
});

console.log(`\n${pass} testi läbitud.`);
