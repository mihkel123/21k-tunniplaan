// Bussiloogika testid: node test-bus.mjs
import { matchRoutes, parseSiri, nextDepartures, morningDepartures, arrivalOf,
         fromSchedule, searchStops, idsByName,
         minutesUntil, leaveInMinutes, scheduleKeyForDay } from './bus.js';
import { activeOn, clean, countyName, stopName, splitRow, linesOf,
         routesTouchingTallinn } from './bus-data.mjs';
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

// s = peatuste järjekord, t = sekundid liini algusest (vt bus-data.mjs)
const P = (stops, mins) => ({ s: stops, t: mins.map((m) => m * 60) });
const paths = {
  '1|Vana-Pääsküla': P(['100', '200', '300', '400'], [0, 5, 10, 15]),   // 100 -> 400
  '1|Viru':          P(['400', '300', '200', '100'], [0, 5, 10, 15]),   // vastassuund
  '9|Kadriorg':      P(['100', '999'], [0, 8]),                         // ei jõua sihtkohta
  '36|Väike-Õismäe': P(['101', '300'], [0, 12]),                        // teine platvorm samas peatuses
};

t('suund arvestatakse: ainult õigetpidi liin sobib', () => {
  const r = matchRoutes(paths, [100], [300]);
  assert.deepEqual(r.routes, ['1|Vana-Pääsküla']);
});

t('vastassuunas sõitev liin EI sobi', () => {
  // 400 -> 300: liin 1|Vana-Pääsküla lõpeb 400-s, sealt tagasi ei saa.
  // Sama number vastassuunas (1|Viru) aga sobib.
  const r = matchRoutes(paths, [400], [300]);
  assert.ok(!r.routes.includes('1|Vana-Pääsküla'), 'lõpp-peatusest edasi ei sõida');
  assert.ok(r.routes.includes('1|Viru'), 'vastassuuna liin peab sobima');
});

t('sihtkohta mitte jõudev liin ei sobi', () => {
  const r = matchRoutes(paths, [100], [300]);
  assert.ok(!r.routes.includes('9|Kadriorg'));
});

t('õige platvorm leitakse automaatselt', () => {
  // Laps valib nime järgi; 100 ja 101 on sama peatuse kaks platvormi
  const r = matchRoutes(paths, [100, 101], [300]);
  assert.deepEqual(r.routes.sort(), ['1|Vana-Pääsküla', '36|Väike-Õismäe']);
  assert.deepEqual(r.fromIds.sort((a, b) => a - b), [100, 101]);
});

t('kasutu platvorm jäetakse välja', () => {
  const r = matchRoutes(paths, [100, 101], [999]);
  assert.deepEqual(r.fromIds, [100]);   // 101 ei vii kuhugi 999 poole
});

t('sama peatus alguses ja lõpus ei sobi', () => {
  assert.deepEqual(matchRoutes(paths, [100], [100]).routes, []);
});

const siri = [
  'Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,33159,version20201024',
  'stop,1290',
  'bus,36,33174,33098,Väike-Õismäe,15,Z',
  'bus,18,33297,33297,Urda,138,Z',
  'trol,4,33396,33340,Pelguranna,237,',
].join('\n');

t('SIRI: serveri kell ja read loetakse', () => {
  const p = parseSiri(siri);
  assert.equal(p.now, 33159);
  assert.equal(p.rows.length, 3);
  assert.deepEqual(p.rows[0],
    { kind: 'bus', route: '36', head: 'Väike-Õismäe', secs: 33174, schedSecs: 33098, live: true });
});

t('SIRI: minutid arvutatakse serveri kella järgi', () => {
  const p = parseSiri(siri);
  assert.equal(minutesUntil(p.rows[1].secs, p.now), 2);   // 138 s
});

t('SIRI: tühi vastus ei lõhu midagi', () => {
  const p = parseSiri('Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,100,v\nstop,1\n');
  assert.deepEqual(p.rows, []);
  assert.equal(p.now, 100);
});

t('väljumised: ainult lubatud liinid, ainult pärast tundide lõppu', () => {
  const scheduled = [['36', 'Väike-Õismäe', 1000], ['9', 'Mujale', 1100], ['36', 'Väike-Õismäe', 1200]].map(fromSchedule);
  const out = nextDepartures({ scheduled, routes: ['36|Väike-Õismäe'], afterSecs: 1050, limit: 3 });
  assert.equal(out.length, 1);
  assert.equal(out[0].secs, 1200);
});

t('hilinenud buss: oodatav aeg on hilisem kui graafikujärgne', () => {
  const p = parseSiri(siri);
  assert.equal(p.rows[0].secs - p.rows[0].schedSecs, 76, 'buss 36 hilineb 76 sekundit');
});

t('väljumised: reaalaeg kirjutab graafiku üle, duplikaati ei teki', () => {
  const scheduled = [['36', 'Väike-Õismäe', 33100], ['36', 'Väike-Õismäe', 33700]].map(fromSchedule);
  const live = parseSiri(siri).rows;
  const out = nextDepartures({ scheduled, live, routes: ['36|Väike-Õismäe'], afterSecs: 33000, limit: 5 });
  const at36 = out.filter((r) => r.route === '36');
  assert.ok(at36.some((r) => r.live), 'reaalajarida peab sees olema');
  assert.equal(at36.filter((r) => Math.abs(r.secs - 33174) < 120).length, 1, 'sama väljumine ei tohi korduda');
});

t('väljumised: ilma liinipiiranguta tulevad kõik', () => {
  const scheduled = [['1', 'A', 100], ['2', 'B', 200]].map(fromSchedule);
  assert.equal(nextDepartures({ scheduled, routes: [], afterSecs: 0 }).length, 2);
});

t('jalutusaeg lahutatakse', () => {
  assert.equal(leaveInMinutes(33159 + 720, 33159, 5), 7);   // 12 min bussini, 5 min jalutust
  assert.equal(leaveInMinutes(33159 + 120, 33159, 5), -3);  // juba hilja
});

t('reedel kasutatakse teist graafikut', () => {
  assert.equal(scheduleKeyForDay(0), 'w');
  assert.equal(scheduleKeyForDay(3), 'w');
  assert.equal(scheduleKeyForDay(4), 'f');
});

const stops = [[1, 'Viru', 0, 0], [2, 'Viru', 0, 0], [3, 'Vironia', 0, 0], [4, 'Kadriorg', 0, 0]];

t('otsing: unikaalsed nimed, algusvasted ees', () => {
  assert.deepEqual(searchStops(stops, 'vir'), ['Viru', 'Vironia']);
  assert.deepEqual(searchStops(stops, 'x'), []);
  assert.deepEqual(searchStops(stops, 'v'), [], 'ühetäheline päring ei otsi');
});

t('nime järgi leitakse kõik platvormid', () => {
  assert.deepEqual(idsByName(stops, 'Viru'), [1, 2]);
});

/* ---------- Sõiduaeg ja hommikune suund ---------- */

const H = (h, m = 0) => h * 3600 + m * 60;

t('sõiduaeg tuleb liini nihketest', () => {
  const r = matchRoutes(paths, [100], [300]);
  assert.equal(r.rides['1|Vana-Pääsküla'], 10 * 60, '100 -> 300 on 10 minutit');
  const back = matchRoutes(paths, [400], [200]);
  assert.equal(back.rides['1|Viru'], 10 * 60, 'vastassuunas sama');
});

t('saabumisaeg = väljumine pluss sõiduaeg', () => {
  const bus = fromSchedule(['1', 'Vana-Pääsküla', H(7, 30)]);
  assert.equal(arrivalOf(bus, { '1|Vana-Pääsküla': 10 * 60 }), H(7, 40));
  assert.equal(arrivalOf(bus, {}), null, 'sõiduajata ei oleta midagi');
});

const morn = {
  routes: ['1|Vana-Pääsküla'],
  rides: { '1|Vana-Pääsküla': 20 * 60 },
  scheduled: [H(6, 30), H(7, 0), H(7, 15), H(7, 30), H(7, 45), H(8, 0)]
    .map((secs) => fromSchedule(['1', 'Vana-Pääsküla', secs])),
};

t('hommik: näitab viimased bussid, millega veel jõuab', () => {
  // Sõit 20 min, tund algab 8:00, jalutus 5 min -> kohal olla 7:55.
  // 7:35 väljub liiga hilja (kohal 7:55 ei ole enam varuga), 7:30 on viimane.
  const r = morningDepartures({ ...morn, afterSecs: 0, arriveBy: H(7, 55), limit: 3 });
  assert.deepEqual(r.rows.map((x) => x.secs), [H(7, 0), H(7, 15), H(7, 30)]);
  assert.equal(r.last.secs, H(7, 30), 'viimane, mis jõuab');
  assert.ok(r.madeIt);
});

t('hommik: liiga vara väljunud bussid jäävad välja', () => {
  const r = morningDepartures({ ...morn, afterSecs: 0, arriveBy: H(7, 55), limit: 2 });
  assert.deepEqual(r.rows.map((x) => x.secs), [H(7, 15), H(7, 30)],
    'kolmest sobivast näitame kaks viimast, mitte kahte esimest');
});

t('hommik: juba läinud bussi ei pakuta', () => {
  // Kell on 7:05 ja peatusesse on 5 min jalutust — 7:00 buss on läinud.
  const r = morningDepartures({ ...morn, afterSecs: H(7, 10), arriveBy: H(7, 55), limit: 3 });
  assert.deepEqual(r.rows.map((x) => x.secs), [H(7, 15), H(7, 30)]);
});

t('hommik: kui ükski ei jõua, ütleme seda ausalt', () => {
  const r = morningDepartures({ ...morn, afterSecs: 0, arriveBy: H(6, 0), limit: 3 });
  assert.equal(r.madeIt, false);
  assert.equal(r.last, null);
  assert.ok(r.rows.length, 'järgmised näitame ikka ära');
});

/* ---------- Kahe GTFS-voo liitmine (bus-data.mjs) ---------- */

t('kehtivusaken: korraga käib ainult üks sõiduplaan', () => {
  // Liin 121 kannab augustis mõlemat plaani. Ilma alguskuupäevata satuks
  // mõlemad sisse ja iga väljumine tuleks kaks korda, paari minuti vahega.
  const vana = ['20260821', '20260831'];
  const uus  = ['20260901', '20261231'];
  assert.ok(activeOn(...vana, '20260829'), 'vana plaan kehtib 29.08');
  assert.ok(!activeOn(...uus, '20260829'), 'uus plaan EI tohi 29.08 kehtida');
  assert.ok(!activeOn(...vana, '20260901'), 'vana plaan on 01.09 läbi');
  assert.ok(activeOn(...uus, '20260901'), 'uus plaan kehtib 01.09');
});

t('kehtivusaken: puuduv kuupäev ei välista teenust', () => {
  assert.ok(activeOn('', '', '20260829'));
  assert.ok(activeOn('20260101', '', '20260829'));
});

t('ingliskeelne lisand kaob peatuse nimest', () => {
  // Ilma selleta oleks "Balti jaam" ja "Balti jaam (train station)" kaks
  // eri peatust ja idsByName leiaks kummastki ainult pooled platvormid.
  assert.equal(clean('Balti jaam (train station)'), 'Balti jaam');
  assert.equal(clean('Bussijaam (bus station)'), 'Bussijaam');
  assert.equal(clean('Viru keskus'), 'Viru keskus');
  assert.equal(clean('Jaama (Rae vald)'), 'Jaama (Rae vald)', 'eestikeelne sulg jääb alles');
});

t('maakonnapeatus saab valla nime juurde', () => {
  // "Kadaka" on nii Tallinnas kui Harku vallas — ilma vallata otsiks
  // idsByName mõlema platvormid ühte hunnikusse ja laps saaks vale bussi.
  assert.equal(countyName('Kadaka', 'Harku vald'), 'Kadaka (Harku vald)');
  assert.equal(countyName('Kadaka', ''), 'Kadaka', 'vallata jääb nimi endiseks');
});

t('linnavõrgu nimi võidab valla sufiksi', () => {
  // Tiskre ja Hansunõmme on registris Harjumaa peatused, aga TLT bussid
  // peatuvad seal. Kui need ümber nimetada, ei leia laps enam oma
  // salvestatud peatust — ja lapse jaoks on need lihtsalt linnapeatused.
  assert.equal(stopName('Hansunõmme', 'Hansunõmme', 'Viimsi vald'), 'Hansunõmme');
  assert.equal(stopName('Tiskre', 'Tiskre', 'Harku vald'), 'Tiskre');
  // Puhtalt maakonna peatus saab valla juurde.
  assert.equal(stopName(undefined, 'Jüri', 'Rae vald'), 'Jüri (Rae vald)');
  assert.equal(stopName('', 'Kadaka', 'Harku vald'), 'Kadaka (Harku vald)');
});

t('küla-sisene liin jäetakse välja, Tallinna puudutav mitte', () => {
  const inTallinn = new Set(['1285', '1771']);
  const trips = new Map([
    ['t1', { route: 'r138' }],   // Kose -> Tallinn
    ['t2', { route: 'r138' }],   // sama liini lühem sõit, Tallinnani ei jõua
    ['t3', { route: 'rSise' }],  // Rae sise, ei näe Tallinna
  ]);
  const seq = new Map([
    ['t1', [[1, '5116', 0], [2, '1285', 0]]],
    ['t2', [[1, '5116', 0], [2, '4448', 0]]],
    ['t3', [[1, '4448', 0], [2, '13140', 0]]],
  ]);
  const keep = routesTouchingTallinn(seq, trips, inTallinn);
  assert.ok(keep.has('r138'), 'üks Tallinna jõudev sõit hoiab kogu liini alles');
  assert.ok(!keep.has('rSise'), 'küla-sisene liin ei kõlba');
  assert.equal(keep.size, 1);
});

t('jutumärkides trip_id ei nihuta veerge', () => {
  // Riiklikus voos on trip_id kujul "50,53_kuni_31.08-Mo-..." — koma sees.
  // Lihtne split annaks stop_id-ks "53_kuni_31.08-Mo-..." asemel prügi.
  const rida = '"50,53_kuni_31.08-Mo-abc-1220",21360,1,12:20:00,12:20:00,1,1.07,0,0,,';
  const c = splitRow(rida);
  assert.equal(c[0], '50,53_kuni_31.08-Mo-abc-1220');
  assert.equal(c[1], '21360', 'stop_id');
  assert.equal(c[4], '12:20:00', 'departure_time');
});

t('jutumärgita rida läheb kiiret teed', () => {
  const c = splitRow('trip-1,21360,1,12:20:00,12:20:00,1,1.07,0,0,,');
  assert.equal(c[0], 'trip-1');
  assert.equal(c[1], '21360');
  assert.equal(c[4], '12:20:00');
});

t('ridade lugeja: CRLF ja lõputa fail', () => {
  const read = (s) => [...linesOf(Buffer.from(s, 'utf8'))];
  assert.deepEqual(read('a,1\r\nb,2\r\n'), ['a,1', 'b,2'], 'CR ei jää rea külge');
  assert.deepEqual(read('a,1\nb,2'), ['a,1', 'b,2'], 'viimane rida ilma reavahetuseta');
  assert.deepEqual(read('a,1\n\nb,2\n'), ['a,1', 'b,2'], 'tühi rida jäetakse vahele');
});

console.log(`\n${pass} testi läbitud.`);
