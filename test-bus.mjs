// Bussiloogika testid: node test-bus.mjs
import { matchRoutes, parseSiri, nextDepartures, fromSchedule, searchStops, idsByName,
         minutesUntil, leaveInMinutes, scheduleKeyForDay } from './bus.js';
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

const paths = {
  '1|Vana-Pääsküla': ['100', '200', '300', '400'],   // 100 -> 400
  '1|Viru':          ['400', '300', '200', '100'],   // vastassuund
  '9|Kadriorg':      ['100', '999'],                 // ei jõua sihtkohta
  '36|Väike-Õismäe': ['101', '300'],                 // teine platvorm samas peatuses
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

console.log(`\n${pass} testi läbitud.`);
