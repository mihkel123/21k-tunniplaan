// Menüü parsimise testid: node test-menu.mjs
import { parseMenu, dateFromHeading } from './menu.mjs';
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

/* Päris lehe kuju, lühendatud: roa nimi <strong> sees, koostis ja lisandid
   sama lahtri sees tavatekstina. Teine lahter on taimetoit. */
const HTML = `
<table>
<tr><td colspan='2'><h2>Kolmapäev, 2. september</h2></td></tr>
<tr>
  <td valign='top'><strong>Hakkliha-koorekaste</strong><br>sea- ja veisehakkliha, köögikoor 15% (LV), sibul<br><br>
    <strong>Risoto kanalihaga</strong><br>broileri kintsuliha, riis, porgand<br><br>
    Keedetud makaron (G), keedetud tatar<br>
    Hiina kapsas, porgand, keedetud peet<br>
    Tee sidruniga, piim 2,5% (L), vesi<br>
    Rukkileib (G), seemneleib (G)</td>
  <td valign='top'><strong>Köögiviljaraguu</strong><br>kartul, kaalikas, kapsas</td>
</tr>
<tr><td colspan='2'><h2>Reede, 4. september</h2></td></tr>
<tr>
  <td valign='top'><strong>Värskekapsaborš, hapukoor (L)</strong><br>värske kapsas, kartul<br><br>
    <strong>Kohupiimakreem, moos (L)</strong><br>kohupiim, suhkur</td>
  <td valign='top'><strong>Köögiviljasupp punaste ubadega, hapukoor (L)</strong><br>oad, porgand</td>
</tr>
</table>`;

const NOW = new Date(2026, 8, 1);   // 1. september 2026

// --- kuupäeva tuletamine ---
t('päevapäisest tuleb ISO-kuupäev', () => {
  assert.equal(dateFromHeading('Kolmapäev, 2. september', NOW), '2026-09-02');
  assert.equal(dateFromHeading('Reede, 4. september', NOW), '2026-09-04');
  assert.equal(dateFromHeading('Esmaspäev, 31. august', NOW), '2026-08-31');
});

t('aasta valitakse tänasele lähim — detsember/jaanuar ei lähe sassi', () => {
  const uusaasta = new Date(2027, 0, 5);   // 5. jaanuar 2027
  assert.equal(dateFromHeading('Neljapäev, 31. detsember', uusaasta), '2026-12-31',
    'detsember kuulub eelmisse aastasse');
  assert.equal(dateFromHeading('Teisipäev, 12. jaanuar', uusaasta), '2027-01-12');
});

t('vigane päis annab null', () => {
  assert.equal(dateFromHeading('Menüü arhiiv', NOW), null);
  assert.equal(dateFromHeading('Kolmapäev, 2. viiendik', NOW), null, 'tundmatu kuu');
  assert.equal(dateFromHeading('', NOW), null);
});

// --- roogade korjamine ---
t('roa nimi tuleb <strong> seest, lisandid jäävad välja', () => {
  const days = parseMenu(HTML, NOW);
  assert.deepEqual(days['2026-09-02'].tava, ['Hakkliha-koorekaste', 'Risoto kanalihaga']);
  assert.deepEqual(days['2026-09-02'].taim, ['Köögiviljaraguu']);
});

t('koostis, lisandid, joogid ja leib ei jõua kirjesse', () => {
  const kõik = JSON.stringify(parseMenu(HTML, NOW));
  for (const välja of ['makaron', 'Rukkileib', 'Tee sidruniga', 'porgand', 'kartul', 'köögikoor']) {
    assert.ok(!kõik.includes(välja), `"${välja}" ei tohiks kirjes olla`);
  }
});

t('allergeenimärgis jääb roa nime sisse alles', () => {
  const days = parseMenu(HTML, NOW);
  assert.deepEqual(days['2026-09-04'].tava,
    ['Värskekapsaborš, hapukoor (L)', 'Kohupiimakreem, moos (L)']);
});

t('lehel puuduv päev ei teki tühjalt kohalt', () => {
  const days = parseMenu(HTML, NOW);
  assert.deepEqual(Object.keys(days).sort(), ['2026-09-02', '2026-09-04']);
  assert.equal(days['2026-09-03'], undefined, 'neljapäeva lehel ei olnud');
});

t('katkine või tühi leht ei viska, annab tühja tulemuse', () => {
  assert.deepEqual(parseMenu('', NOW), {});
  assert.deepEqual(parseMenu('<html><body>Menüü on uuendamisel</body></html>', NOW), {});
  assert.deepEqual(parseMenu('<h2>Kolmapäev, 2. september</h2>', NOW), {}, 'päis ilma lahtriteta');
});

// --- päris fail ---
t('menu.json on kehtiv ja sisaldab ainult roa nimesid', () => {
  if (!existsSync(new URL('./menu.json', import.meta.url))) return;   // pole veel kraabitud
  const m = JSON.parse(readFileSync(new URL('./menu.json', import.meta.url), 'utf8'));
  assert.ok(m.days && Object.keys(m.days).length, 'päevi peab olema');
  for (const [date, d] of Object.entries(m.days)) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    for (const roog of [...d.tava, ...d.taim]) {
      assert.ok(roog.length > 2 && roog.length < 120, `kahtlane roa nimi: ${roog}`);
      // Lisandite read kooli lehel algavad väiketähega; roa nimi mitte.
      assert.match(roog[0], /[A-ZÄÖÜÕŠŽ]/, `roa nimi peaks algama suurtähega: ${roog}`);
    }
  }
});

console.log(`\n${pass} testi läbitud.`);
