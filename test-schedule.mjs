// Päevaloogika testid: node test-schedule.mjs
import { defaultDate, holidayOn, isSchoolDay, relativeLabel, isFreshChange, weekdayIndex, iso, easterSunday, nthWeekday, notableOn, namesOn, overrideOn, parseLunch } from './schedule.js';
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

t('õppeaasta väliseid päevi koolipäevaks ei loeta', () => {
  // 31. august 2026 on esmaspäev, aga õppeaasta algab 1. septembril.
  // Ilma selle kontrollita näitas rakendus tunde päeval, mida polnud.
  const enne = at('2026-08-31T12:00:00');
  assert.equal(isSchoolDay(H, enne, '1A'), false);
  assert.equal(isSchoolDay(H, enne, '12A'), false);
  assert.equal(holidayOn(H, enne, '1A').name, 'Suvevaheaeg');
  assert.equal(holidayOn(H, enne, '1A').until, '2026-08-31', 'vaheaeg lõpeb päev enne algust');

  // Esimene koolipäev on tavaline päev.
  const algus = at('2026-09-01T12:00:00');
  assert.equal(isSchoolDay(H, algus, '1A'), true);
  assert.equal(holidayOn(H, algus, '1A'), null);
});

t('enne õppeaasta algust avades näidatakse esimest koolipäeva', () => {
  assert.equal(d('2026-08-30T10:00:00'), '2026-09-01');
  assert.equal(d('2026-08-31T10:00:00'), '2026-09-01', 'ka 31. augustil, mis on esmaspäev');
});

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
  assert.deepEqual(notableOn(notable, on('2026-02-24')).map((x) => x.name), ['Iseseisvuspäev']);
  assert.deepEqual(notableOn(notable, on('2026-03-14')).map((x) => x.name), ['Emakeelepäev']);
  assert.deepEqual(notableOn(notable, on('2026-11-10')).map((x) => x.name), ['Mardipäev']);
  assert.deepEqual(notableOn(notable, on('2026-08-28')), [], 'tavaline päev on tühi');
});

t('liikuvad tähtpäevad tulevad ülestõusmispühadest', () => {
  // 2027: ülestõusmispühad 28.03, seega suur reede 26.03 ja vastlapäev 09.02.
  assert.deepEqual(notableOn(notable, on('2027-03-26')).map((x) => x.name), ['Suur reede']);
  assert.deepEqual(notableOn(notable, on('2027-03-28')).map((x) => x.name), ['Ülestõusmispühad']);
  assert.deepEqual(notableOn(notable, on('2027-02-09')).map((x) => x.name), ['Vastlapäev']);
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

t('tähtpäeva nimi algab suurtähega', () => {
  // Nimi läheb ekraanile sellisena, nagu ta failis on — väiketähega kirje
  // paistaks reas kohe välja.
  const vale = notable.days.filter((d) => d.name[0] !== d.name[0].toUpperCase());
  assert.deepEqual(vale.map((d) => d.name), []);
});

t('nimepäevad on igal päeval, ka liigaastal', () => {
  assert.deepEqual(namesOn(namedays, on('2026-08-29')), ['Õnne', 'Õnnela']);
  assert.ok(namesOn(namedays, on('2024-02-29')).length, 'liigapäeval on samuti nimed');
  assert.equal(Object.keys(namedays.days).length, 366);
});

/* ---------- Erandpäevad ---------- */

const OV = JSON.parse(readFileSync(new URL('./overrides.json', import.meta.url), 'utf8'));

t('erandpäev asendab tavalise päeva', () => {
  const sept1 = at('2026-09-01T12:00:00');
  const r = overrideOn(OV, sept1, '1A');
  assert.ok(r, '1. septembril peab erand olema');
  assert.match(r.notice, /Tavalisi tunde ei ole/);
  assert.deepEqual(r.events.map((e) => `${e.at} ${e.title}`),
    ['10:00 Aktus', 'pärast aktust Klassijuhatajatund']);
});

t('klassijuhatajatund enne aktust jääb ka järjekorras ette', () => {
  // 2AB ja 3.-4. klassidel on klassijuhatajatund kell 11.00, aktus 12.00.
  const r = overrideOn(OV, at('2026-09-01T12:00:00'), '3A');
  assert.deepEqual(r.events.map((e) => e.at), ['11:00', '12:00']);
  assert.equal(r.events[0].title, 'Klassijuhatajatund');
});

t('12. klass käib kahel aktusel', () => {
  const r = overrideOn(OV, at('2026-09-01T12:00:00'), '12A');
  assert.equal(r.events.length, 3);
  assert.deepEqual(r.events.map((e) => e.at), ['10:00', '12:00', 'pärast aktust']);
});

t('tavalisel päeval erandit ei ole', () => {
  assert.equal(overrideOn(OV, at('2026-09-02T12:00:00'), '1A'), null);
  assert.equal(overrideOn(OV, at('2026-09-01T12:00:00'), 'puudub'), null, 'tundmatu klass');
  assert.equal(overrideOn(null, at('2026-09-01T12:00:00'), '1A'), null, 'faili puudumine ei lõhu');
});

t('kõik klassid on erandpäeval kaetud', () => {
  // Kui kool lisab klassi, peab see siin välja tulema, mitte lapse ekraanil.
  const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));
  const day = OV.days['2026-09-01'].classes;
  const puudu = data.classOrder.filter((k) => !day[k]?.length);
  assert.deepEqual(puudu, []);
});

/* ---------- Söögivahetund ---------- */

const hhmm = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const vahemik = (v) => (v ? `${hhmm(v.start)}-${hhmm(v.end)}` : null);

t('lihtne söömise aken ilma märkuseta', () => {
  const r = parseLunch('11:30 - 11:45');
  assert.equal(vahemik(r.eat), '11:30-11:45');
  assert.equal(r.note, null);
  assert.equal(r.shift, null);
});

t('30-min vahetund tuletatakse kooli reegli järgi', () => {
  // :30 ja :45 algus -> söömine vahetunni alguses
  assert.equal(vahemik(parseLunch('11:30 - 11:45').break), '11:30-12:00');
  assert.equal(vahemik(parseLunch('11:45 - 12:00').break), '11:45-12:15');
  // :00 algus -> vahetund algab 15 min enne söömist
  assert.equal(vahemik(parseLunch('11:00 - 11:15').break), '10:45-11:15');
});

t('1.-2. klassi 20-minutilisest aknast vahetundi ei tuletata', () => {
  // Need ei mahu kooli ametlikku üheksa sloti loendisse — parem vähem kui vale.
  assert.equal(parseLunch('11:00 - 11:20').break, null, '20 min aken, kuigi algus :00');
  assert.equal(parseLunch('11:40 - 12:00').break, null);
  assert.equal(parseLunch('10:50 - 11:10').break, null);
});

t('nihe loetakse välja koos tunni numbriga', () => {
  const r = parseLunch('11:00 - 11:15 4. tund algab ja lõppeb 15 min hiljem 4. tund kestab 11.15-12.00');
  assert.deepEqual(r.shift, { periodN: 4, start: 11 * 60 + 15, end: 12 * 60 });
  assert.equal(r.note, '4. tund algab ja lõppeb 15 min hiljem');
});

t('punkt kooloni asemel ei sega — kool kirjutab ühes kirjes 13.15', () => {
  const r = parseLunch('13:00 - 13.15 6. tund algab ja lõppeb 15 min hiljem 6. tund kestab 13.15-14.00');
  assert.equal(vahemik(r.eat), '13:00-13:15');
  assert.equal(vahemik(r.break), '12:45-13:15');
  assert.deepEqual(r.shift, { periodN: 6, start: 13 * 60 + 15, end: 14 * 60 });
});

t('paaristunni märkus jääb alles, nihet ei ole', () => {
  const r = parseLunch('11:30 - 11:45 Söömine on pärast paaristundi. 5. tund algab kell 12.00');
  assert.equal(vahemik(r.break), '11:30-12:00');
  assert.equal(r.shift, null, 'kool ütleb ainult algusaja, mis on standardne');
  assert.equal(r.note, 'Söömine on pärast paaristundi. 5. tund algab kell 12.00');
});

t('tühi või vigane lahter annab null', () => {
  assert.equal(parseLunch(''), null);
  assert.equal(parseLunch(null), null);
  assert.equal(parseLunch('Söömist ei ole'), null, 'kellaaegadeta tekst');
  assert.equal(parseLunch('11:00'), null, 'ainult üks kellaaeg');
});

t('kõik 230 päris kirjet parsivad ja vahetunnid langevad kooli loendisse', () => {
  const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));
  // Kooli tundide-ajad lehe ametlikud üheksa söögivahetundi.
  const ametlik = new Set(['09:45-10:15', '10:30-11:00', '10:45-11:15', '11:30-12:00',
    '11:45-12:15', '12:30-13:00', '12:45-13:15', '13:30-14:00', '13:45-14:15']);
  let parsis = 0, vahetunde = 0, ilma = 0;
  for (const k of data.classOrder) {
    for (const l of data.classes[k].lunch) {
      const r = parseLunch(l);
      assert.ok(r, `${k}: ei parsinud "${l}"`);
      parsis++;
      if (r.break) {
        vahetunde++;
        assert.ok(ametlik.has(vahemik(r.break)), `${k}: vahetund ${vahemik(r.break)} pole kooli loendis`);
      } else {
        ilma++;
        assert.equal(r.eat.end - r.eat.start, 20, `${k}: vahetunnita kirje peaks olema 20-min aken`);
      }
    }
  }
  assert.equal(parsis, 230);
  assert.equal(vahetunde, 195);
  assert.equal(ilma, 35, '1A-1E, 2C, 2D viie päeva kohta');
});

console.log(`\n${pass} testi läbitud.`);
