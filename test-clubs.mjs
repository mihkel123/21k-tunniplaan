// Huviringide parsimise testid: node test-clubs.mjs
import { normalize, clubId, parseGrades, fitsClass, parseTime, parseFee, parseClubs, mergeClubs, deadlineOn } from './clubs.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

const read = (f) => JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'));

/* ---------- Üksikud väljad ---------- */

t('sisetühik muudetakse tavaliseks — ilma selleta ei haaku ükski muster', () => {
  // Kooli tabelis on päeva ja kellaaja vahel U+00A0, mitte tühik.
  assert.equal(normalize('E 14.00–14.45'), 'E 14.00–14.45');
  assert.equal(normalize('  mitu   tühikut \n ja rida '), 'mitu tühikut ja rida');
  assert.equal(normalize('<b>Ring</b>&nbsp;nimi'), 'Ring nimi');
  assert.equal(normalize(null), '');
});

t('klassiveerg: astmevahemikud', () => {
  assert.deepEqual(parseGrades('1.-2. klassid'), { grades: [1, 2], classes: [] });
  assert.deepEqual(parseGrades('4.-12. klassid').grades, [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(parseGrades('Alates 5. klassist').grades, [5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(parseGrades('1. klassid'), { grades: [1], classes: [] });
});

t('klassiveerg: täpsed klassid, sest 2A ja 2B pole sama asi', () => {
  // Muusikaklasside mudilaskoor käib ainult A-klassidele.
  assert.deepEqual(parseGrades('2A, 3A, 4A').classes, ['2A', '3A', '4A']);
  assert.deepEqual(parseGrades('2BCD, 3BCD, 4BCD').classes,
    ['2B', '2C', '2D', '3B', '3C', '3D', '4B', '4C', '4D']);
  assert.deepEqual(parseGrades('1ABCDE ja 2CD').classes,
    ['1A', '1B', '1C', '1D', '1E', '2C', '2D']);
});

t('fitsClass: tähega kirje on täpne, astmega kirje võtab kõik tähed', () => {
  const aKlassid = parseGrades('2A, 3A, 4A');
  assert.equal(fitsClass(aKlassid, '2A'), true);
  assert.equal(fitsClass(aKlassid, '2B'), false);    // siin see vahe just ongi
  assert.equal(fitsClass(aKlassid, '7A'), false);

  const aste = parseGrades('5.-9. klassid');
  assert.equal(fitsClass(aste, '7A'), true);
  assert.equal(fitsClass(aste, '7C'), true);
  assert.equal(fitsClass(aste, '4B'), false);
  assert.equal(fitsClass(aste, '10A'), false);

  assert.equal(fitsClass(aste, ''), false);
  assert.equal(fitsClass(null, '7A'), false);
});

t('ajaveerg: viis kuju pluss vabatekst', () => {
  assert.deepEqual(parseTime('E 14.00–14.45'),
    { raw: 'E 14.00–14.45', days: ['E'], either: false, start: '14.00', end: '14.45' });
  // Ainult algus, lõppu kool ei kirjuta
  assert.deepEqual(parseTime('R 8.00').start, '8.00');
  assert.equal(parseTime('R 8.00').end, null);
  // "ja" = mõlemal päeval, "või" = ühel neist. Vahet hoiame alles.
  assert.deepEqual(parseTime('E ja K 14.00–14.45').days, ['E', 'K']);
  assert.equal(parseTime('E ja K 14.00–14.45').either, false);
  assert.deepEqual(parseTime('K või N 15.00–16.30').days, ['K', 'N']);
  assert.equal(parseTime('K või N 15.00–16.30').either, true);
  // Lühike sidekriips töötab sama hästi kui pikk
  assert.deepEqual(parseTime('T 15.25-16.10').start, '15.25');
  // Vabatekst jääb alles, päevi lihtsalt pole
  assert.deepEqual(parseTime('eriplaan'), { raw: 'eriplaan', days: [], either: false, start: null, end: null });
  assert.deepEqual(parseTime('Täpsustamisel').days, []);
});

t('kuutasu', () => {
  assert.equal(parseFee('54.-'), 54);
  assert.equal(parseFee('17'), 17);       // üks kirje on ilma punktita
  assert.equal(parseFee('13.-'), 13);
  assert.equal(parseFee(''), null);       // karate ja väitlusklubi
  assert.equal(parseFee('   '), null);
});

t('clubId on stabiilne ja täpitähtedeta', () => {
  assert.equal(clubId('Mõttepähklid Svea Sokka', '2.-3. klassid'), 'mottepahklid-svea-sokka-2-3-klassid');
  // Sama ring eri vanuserühmale peab saama eri võtme
  assert.notEqual(clubId('Male Karl Erik Olde', '1.-3. klassid'), clubId('Male Karl Erik Olde', '4.-12. klassid'));
});

/* ---------- Terve tabel ---------- */

const FIXTURE = `
<table><tr><th>Ring, õpetaja</th><th>Klass</th><th>Aeg</th><th>Ruum</th><th>Kuutasu</th><th>Lisainfo ja Registreerumine</th></tr>
<tr><td>Male Karl Erik Olde</td><td>4.-12. klassid</td><td>K 16.00–17.30</td><td>Raua 6 ruum 209</td><td>35.-</td><td>karlerik.olde2@gmail.com</td></tr>
<tr><td>Karate Hellar Bergmann</td><td>1.-2. klassid</td><td>E ja K 15.00-16.00</td><td>Tartu mnt 23 ruum T112</td><td></td><td>hellarber@gmail.com</td></tr></table>
<table><tr><th>Ring, õpetaja</th><th>Klass</th><th>Aeg</th><th>Ruum</th><th>Lisainfo ja Registreerumine</th></tr>
<tr><td>Noorte Meeskoor Kuno Kerge</td><td>7A, 8A, 9A</td><td>E 8.00</td><td>216</td><td></td></tr>
<tr><td>Kammerorkester Siim Aimla</td><td>8.-12. klassid</td><td>eriplaan</td><td>204 aula</td><td>Teatada õpetajale</td></tr></table>`;

t('parseClubs loeb mõlemad tabelid ja teab, kumb on tasuline', () => {
  const c = parseClubs(FIXTURE);
  assert.equal(c.length, 4);
  const male = c.find((x) => x.ring.startsWith('Male'));
  assert.equal(male.tasuline, true);
  assert.equal(male.kuutasu, 35);
  assert.equal(male.info, 'karlerik.olde2@gmail.com');

  // Tasuta tabelis pole hinnaveergu — info ei tohi sealt vale lahtri alla sattuda
  const koor = c.find((x) => x.ring.startsWith('Noorte'));
  assert.equal(koor.tasuline, false);
  assert.equal(koor.kuutasu, null);
  assert.deepEqual(koor.sobib.classes, ['7A', '8A', '9A']);

  // Tasulises tabelis tühi hind ei tähenda tasuta ringi
  const karate = c.find((x) => x.ring.startsWith('Karate'));
  assert.equal(karate.tasuline, true);
  assert.equal(karate.kuutasu, null);
});

t('parseClubs järjestab nädalapäeva ja kellaaja järgi, aegadeta lõppu', () => {
  const c = parseClubs(FIXTURE);
  assert.equal(c[0].ring.startsWith('Noorte'), true);      // E 8.00
  assert.equal(c.at(-1).ring.startsWith('Kammerorkester'), true);  // eriplaan
});

t('parseClubs ei kuku läbi tühja ega katkise sisendi peal', () => {
  assert.deepEqual(parseClubs(''), []);
  assert.deepEqual(parseClubs('<table><tr><th>Midagi muud</th></tr></table>'), []);
});

/* ---------- Päris andmed ---------- */

t('clubs.json: ringe on olemas ja id-d on unikaalsed', () => {
  const { clubs } = read('clubs.json');
  assert.ok(clubs.length >= 30, `ringe ainult ${clubs.length}`);
  assert.equal(new Set(clubs.map((c) => c.id)).size, clubs.length);
  for (const c of clubs) assert.ok(c.ring && c.id, `puudulik kirje: ${JSON.stringify(c)}`);
});

t('overlay katab kõik ringid ja ei sisalda surnud võtmeid', () => {
  const { clubs } = read('clubs.json');
  const o = read('clubs-overlay.json');
  const ids = new Set(clubs.map((c) => c.id));

  // Kui kool ringi ümber nimetab, muutub id ja overlay jääb vaikselt vanaks.
  // Just see test annab sellest teada.
  const orvud = Object.keys(o.ringid).filter((k) => !ids.has(k));
  assert.deepEqual(orvud, [], `overlays on ringe, mida lehel enam pole: ${orvud}`);

  const katmata = clubs.filter((c) => !o.ringid[c.id]).map((c) => c.id);
  assert.deepEqual(katmata, [], `overlayst puudu: ${katmata}`);
});

t('overlay kategooriad on defineeritud', () => {
  const o = read('clubs-overlay.json');
  const cats = new Set(o.kategooriad.map((k) => k.id));
  assert.ok(cats.has('muu'), 'varukategooria "muu" peab olema olemas');
  for (const [id, r] of Object.entries(o.ringid)) {
    assert.ok(cats.has(r.kategooria), `tundmatu kategooria ${r.kategooria} ringil ${id}`);
    assert.ok(r.nimi && r.juhendaja, `nimi või juhendaja puudu: ${id}`);
  }
});

t('overlay subject-koodid vastavad päris tunniplaanile', () => {
  const o = read('clubs-overlay.json');
  const data = read('data.json');
  const koodid = new Set();
  for (const c of Object.values(data.classes)) {
    for (const row of c.grid ?? []) for (const cell of row ?? []) for (const e of cell ?? []) koodid.add(e.subject);
  }
  for (const [id, r] of Object.entries(o.ringid)) {
    for (const s of r.subject ?? []) {
      assert.ok(koodid.has(s), `ring ${id} viitab ainekoodile ${s}, mida tunniplaanis pole`);
    }
  }
});

/* ---------- Liitmine vaate jaoks ---------- */

t('mergeClubs: filtreerib klassi järgi ja rühmitab kategooriatesse', () => {
  const data = read('clubs.json');
  const o = read('clubs-overlay.json');

  const koik = mergeClubs(data, o, null).flatMap((g) => g.ringid);
  assert.equal(koik.length, data.clubs.length);

  // Seitsmendikule sobib tükk, aga mitte kõik — algklasside ringid kaovad
  const seitse = mergeClubs(data, o, '7A').flatMap((g) => g.ringid);
  assert.ok(seitse.length > 0 && seitse.length < koik.length);
  assert.ok(seitse.every((r) => fitsClass(r.sobib, '7A')));
  // Muusikaklasside mudilaskoor on 2A-3A-4A — seitsmendikku seal pole
  assert.equal(seitse.some((r) => r.id.startsWith('muusikaklasside')), false);

  // Tühje kategooriaid ei näidata
  assert.ok(mergeClubs(data, o, '7A').every((g) => g.ringid.length > 0));
});

t('mergeClubs: overlayta ring jääb alles, mitte ei kao', () => {
  const data = { clubs: [{ id: 'uus-ring-x', ring: 'Uus Ring Keegi Uus', sobib: { grades: [7], classes: [] } }] };
  const o = read('clubs-overlay.json');
  const rühmad = mergeClubs(data, o, '7A');
  const ring = rühmad.flatMap((g) => g.ringid)[0];
  assert.equal(ring.nimi, 'Uus Ring Keegi Uus');   // varunimi on toores lahter
  assert.equal(ring.kategooria, 'muu');
});

t('mergeClubs ei kuku läbi ilma andmete või overlayta', () => {
  assert.deepEqual(mergeClubs(null, null, '7A'), []);
  const data = read('clubs.json');
  assert.ok(mergeClubs(data, null, '7A').length > 0);   // ilma overlayta ikka nimekiri
});

t('deadlineOn näitab riba kuni tähtajani ja siis kaob', () => {
  const o = read('clubs-overlay.json');
  assert.ok(deadlineOn(o, new Date(2026, 8, 11)));     // 11. september
  assert.ok(deadlineOn(o, new Date(2026, 8, 25)));     // tähtaja päeval veel
  assert.equal(deadlineOn(o, new Date(2026, 8, 26)), null);
  assert.equal(deadlineOn({}, new Date(2026, 8, 11)), null);
});

console.log(`\n${pass} testi läbitud.`);
