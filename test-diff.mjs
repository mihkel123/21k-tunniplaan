// Muudatuste tuvastamise testid: node test-diff.mjs
import { diffClass, mergeLedger } from './scrape.mjs';
import assert from 'node:assert/strict';

const P = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, start: '8:00', end: '8:45' }));
const L = (subjectFull, teacher = 'Kask', room = '101') =>
  ({ subject: subjectFull.slice(0, 2).toUpperCase(), subjectFull, teacher, teacherFull: teacher, room, color: '#fff' });
const empty = () => Array.from({ length: 8 }, () => [[], [], [], [], []]);

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

t('identsed plaanid -> muudatusi pole', () => {
  const g = empty(); g[1][0] = [L('ajalugu')];
  assert.deepEqual(diffClass(g, structuredClone(g), P), {});
});

t('tund lisandus tühja pessa -> added', () => {
  const a = empty(), b = empty(); b[2][3] = [L('keemia')];
  assert.equal(diffClass(a, b, P)['2|3'].kind, 'added');
});

t('tund kadus -> removed', () => {
  const a = empty(), b = empty(); a[2][3] = [L('keemia')];
  const r = diffClass(a, b, P)['2|3'];
  assert.equal(r.kind, 'removed');
  assert.equal(r.wasSubject, 'keemia');
});

t('ruum muutus -> changed', () => {
  const a = empty(), b = empty();
  a[0][0] = [L('matemaatika', 'Kask', '314')];
  b[0][0] = [L('matemaatika', 'Kask', '999')];
  assert.equal(diffClass(a, b, P)['0|0'].kind, 'changed');
});

t('kolimine tühja pessa -> mõlemad otsad seotud', () => {
  const a = empty(), b = empty();
  a[2][0] = [L('inglise keel')];          // oli E 3. tund
  b[4][1] = [L('inglise keel')];          // nüüd T 5. tund
  const r = diffClass(a, b, P);
  assert.equal(r['2|0'].kind, 'removed');
  assert.equal(r['2|0'].movedTo.slot, 'T 5. tund');
  assert.equal(r['4|1'].kind, 'added');
  assert.equal(r['4|1'].movedFrom.slot, 'E 3. tund');
  assert.equal(r['4|1'].movedFrom.subject, 'inglise keel');
});

t('kolimine, kus vana pesa täitub muu ainega -> ikka seotud', () => {
  const a = empty(), b = empty();
  a[2][0] = [L('inglise keel')];
  b[2][0] = [L('kehaline kasvatus')];     // vana pesa ei jäänud tühjaks
  b[4][1] = [L('inglise keel')];
  const r = diffClass(a, b, P);
  assert.equal(r['2|0'].kind, 'changed');
  assert.equal(r['2|0'].movedTo.slot, 'T 5. tund');
  assert.equal(r['4|1'].movedFrom.slot, 'E 3. tund');
});

t('kaks ainet vahetavad kohta -> mõlemad seotud', () => {
  const a = empty(), b = empty();
  a[1][0] = [L('inglise keel')]; a[3][2] = [L('matemaatika')];
  b[1][0] = [L('matemaatika')];  b[3][2] = [L('inglise keel')];
  const r = diffClass(a, b, P);
  assert.ok(r['1|0'].movedTo && r['3|2'].movedTo, 'mõlemal peaks olema sihtkoht');
});

t('paralleelrühmad: ühe rühma õpetaja muutus -> changed', () => {
  const a = empty(), b = empty();
  a[0][0] = [L('vene keel', 'Sulg'), L('saksa keel', 'Morgenstern')];
  b[0][0] = [L('vene keel', 'Sulg'), L('saksa keel', 'Uus')];
  assert.equal(diffClass(a, b, P)['0|0'].kind, 'changed');
});

t('ledger: üle 14 päeva vanad kirjed kustuvad, uued jäävad', () => {
  const prev = { '7A': {
    '0|0': { kind: 'changed', since: '2026-08-01' },   // vana
    '1|1': { kind: 'added',   since: '2026-08-20' },   // värske
  }};
  const merged = mergeLedger(prev, { '7A': { '2|2': { kind: 'removed' } } }, '2026-08-29');
  assert.ok(!merged['7A']['0|0'], '28 päeva vana kirje peaks kustuma');
  assert.ok(merged['7A']['1|1'], '9 päeva vana kirje peaks jääma');
  assert.equal(merged['7A']['2|2'].since, '2026-08-29', 'uus kirje saab tänase kuupäeva');
});

t('ledger: täna muutunud pesa kirjutab vana kirje üle', () => {
  const prev = { '7A': { '0|0': { kind: 'added', since: '2026-08-25' } } };
  const merged = mergeLedger(prev, { '7A': { '0|0': { kind: 'removed' } } }, '2026-08-29');
  assert.equal(merged['7A']['0|0'].kind, 'removed');
  assert.equal(merged['7A']['0|0'].since, '2026-08-29');
});

console.log(`\n${pass} testi läbitud.`);
