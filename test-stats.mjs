// Statistikaloogika testid: node test-stats.mjs
import { durationBucket, screen, leaving } from './stats.js';
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

t('vahemikud on täpselt piiril', () => {
  assert.equal(durationBucket(14), '<15s');
  assert.equal(durationBucket(15), '15–60s');
  assert.equal(durationBucket(59), '15–60s');
  assert.equal(durationBucket(60), '1–5min');
  assert.equal(durationBucket(299), '1–5min');
  assert.equal(durationBucket(300), '5–15min');
  assert.equal(durationBucket(899), '5–15min');
  assert.equal(durationBucket(900), '15min+');
});

t('null, negatiivne ja nullilähedane aeg ei anna vahemikku', () => {
  assert.equal(durationBucket(0), null);
  assert.equal(durationBucket(-5), null);
  assert.equal(durationBucket(undefined), null);
  assert.equal(durationBucket(null), null);
});

t('puuduv window.umami ei viska — kohapeal, võrguta, blokeeritud', () => {
  const savedWindow = globalThis.window;
  globalThis.window = {};
  assert.doesNotThrow(() => screen('/paev'));
  assert.doesNotThrow(() => leaving(42));
  assert.doesNotThrow(() => leaving(0), 'liiga lühike külastus ei saada midagi');
  globalThis.window = savedWindow;
});

t('screen saadab lehevaate õige URL-iga', () => {
  const calls = [];
  const savedWindow = globalThis.window;
  globalThis.window = { umami: { track: (fn) => calls.push(fn({ url: '/vana', title: 't' })) } };
  screen('/paev');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/paev');
  assert.equal(calls[0].title, 't', 'muud väljad jäävad puutumata');
  globalThis.window = savedWindow;
});

t('leaving saadab lahkus-sündmuse õige kestusega', () => {
  const calls = [];
  const savedWindow = globalThis.window;
  globalThis.window = { umami: { track: (name, data) => calls.push([name, data]) } };
  leaving(200);
  assert.deepEqual(calls, [['lahkus', { kestus: '1–5min' }]]);
  globalThis.window = savedWindow;
});

t('liiga lühikest külastust ei saadeta üldse', () => {
  const calls = [];
  const savedWindow = globalThis.window;
  globalThis.window = { umami: { track: (...a) => calls.push(a) } };
  leaving(0);
  leaving(-3);
  assert.deepEqual(calls, []);
  globalThis.window = savedWindow;
});

console.log(`\n${pass} testi läbitud.`);
