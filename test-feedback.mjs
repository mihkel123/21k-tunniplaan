// Tagasiside vormi ja Pages Functioni testid: node test-feedback.mjs
import { validate, deviceOf, keyFor, isAfter, tokenMatches, TEXT_MAX, RATE_LIMIT } from './feedback-core.mjs';
import { onRequestPost, onRequestGet, onRequestDelete } from './functions/api/feedback.js';
import assert from 'node:assert/strict';

let pass = 0;
const t = async (name, fn) => { await fn(); console.log(`  ok  ${name}`); pass++; };

const NOW = new Date('2026-11-12T08:15:00Z');

await t('korralik kiri läheb läbi ja liigsed väljad jäävad maha', () => {
  const r = validate({ kind: 'idee', text: '  Lisa söökla menüü  ', klass: '6C', version: 'v1.0.412',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', secret: 'x' }, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.record, { ts: '2026-11-12T08:15:00.000Z', kind: 'idee', text: 'Lisa söökla menüü',
    contact: null, klass: '6C', version: 'v1.0.412', ua: 'iPhone' });
});

await t('liiga lühike ja liiga pikk tekst lükatakse tagasi', () => {
  assert.equal(validate({ text: ' a ' }).ok, false);
  assert.equal(validate({ text: 'x'.repeat(TEXT_MAX + 1) }).status, 400);
  assert.equal(validate({ text: 'x'.repeat(TEXT_MAX) }).ok, true);
  assert.equal(validate(null).ok, false);
});

await t('tundmatu liik on "muu", vigane klass on null', () => {
  const r = validate({ kind: 'häkk', text: 'tere tere', klass: '<script>' });
  assert.equal(r.record.kind, 'muu');
  assert.equal(r.record.klass, null);
});

await t('honeypot: "ok", aga midagi ei salvestata', () => {
  assert.deepEqual(validate({ text: 'tere tere', website: 'spam.example' }), { ok: true, record: null });
});

await t('seadmest jääb alles ainult tüüp', () => {
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14)'), 'Android');
  assert.equal(deviceOf('Mozilla/5.0 (Macintosh)'), 'muu');
  assert.equal(deviceOf(undefined), 'muu');
});

await t('võtmed on ajalises järjekorras ja since filtreerib', () => {
  const k = keyFor({ ts: '2026-11-12T08:15:00.000Z' }, 'ab12');
  assert.equal(k, 'fb:2026-11-12T08:15:00.000Z:ab12');
  assert.equal(isAfter(k, '2026-11-12T08:00:00Z'), true);
  assert.equal(isAfter(k, '2026-11-12T09:00:00Z'), false);
  assert.equal(isAfter(k, null), true);
});

await t('token: õige läbi, vale/puuduv/tühi secret mitte', () => {
  assert.equal(tokenMatches('Bearer abc123', 'abc123'), true);
  assert.equal(tokenMatches('Bearer abc124', 'abc123'), false);
  assert.equal(tokenMatches('Bearer abc', 'abc123'), false);
  assert.equal(tokenMatches(null, 'abc123'), false);
  assert.equal(tokenMatches('Bearer ', ''), false);
});

/* ---------- Pages Function mälus oleva KV-ga ---------- */

function fakeKV() {
  const m = new Map();
  return {
    m,
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })),
      list_complete: true,
    }),
  };
}
const env = () => ({ FEEDBACK: fakeKV(), FEEDBACK_READ_TOKEN: 'salajane' });
const post = (e, body, ip = '1.2.3.4') => onRequestPost({ env: e, request: new Request('https://x/api/feedback', {
  method: 'POST', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' }, body: JSON.stringify(body),
}) });
const get = (e, auth, qs = '') => onRequestGet({ env: e, request: new Request(`https://x/api/feedback${qs}`, {
  headers: auth ? { authorization: auth } : {},
}) });

await t('POST salvestab kirja ja GET tokeniga loeb selle tagasi', async () => {
  const e = env();
  assert.equal((await post(e, { kind: 'viga', text: 'Bussiaeg on vale', klass: '1B' })).status, 200);
  const res = await get(e, 'Bearer salajane');
  const data = await res.json();
  assert.equal(data.count, 1);
  assert.equal(data.items[0].text, 'Bussiaeg on vale');
  assert.match(data.items[0].key, /^fb:/);
  // IP-d ei ole kuskil
  assert.ok(![...e.FEEDBACK.m.values()].some((v) => v.includes('1.2.3.4')));
  assert.ok(![...e.FEEDBACK.m.keys()].some((k) => k.includes('1.2.3.4')));
});

await t(`${RATE_LIMIT + 1}. saatmine tunnis ühelt IP-lt saab 429, teine IP mitte`, async () => {
  const e = env();
  for (let i = 0; i < RATE_LIMIT; i++) assert.equal((await post(e, { text: `kiri ${i}` })).status, 200);
  assert.equal((await post(e, { text: 'veel üks' })).status, 429);
  assert.equal((await post(e, { text: 'teiselt' }, '5.6.7.8')).status, 200);
});

await t('honeypot ja vigane JSON ei jõua KV-sse', async () => {
  const e = env();
  assert.equal((await post(e, { text: 'tere tere', website: 'x' })).status, 200);
  const bad = await onRequestPost({ env: e, request: new Request('https://x/', { method: 'POST', body: '{' }) });
  assert.equal(bad.status, 400);
  assert.equal(e.FEEDBACK.m.size, 0);
});

await t('GET ja DELETE ilma õige tokenita: 401', async () => {
  const e = env();
  assert.equal((await get(e, null)).status, 401);
  assert.equal((await get(e, 'Bearer vale')).status, 401);
  const del = await onRequestDelete({ env: e, request: new Request('https://x/api/feedback?key=fb:x') });
  assert.equal(del.status, 401);
});

await t('DELETE tokeniga kustutab ainult fb: võtme', async () => {
  const e = env();
  await post(e, { text: 'testkiri' });
  const [key] = [...e.FEEDBACK.m.keys()].filter((k) => k.startsWith('fb:'));
  const del = (k) => onRequestDelete({ env: e, request: new Request(`https://x/api/feedback?key=${encodeURIComponent(k)}`, {
    method: 'DELETE', headers: { authorization: 'Bearer salajane' } }) });
  assert.equal((await del('rate:abc')).status, 400);
  assert.equal((await del(key)).status, 200);
  assert.equal(e.FEEDBACK.m.has(key), false);
});

await t('seadistamata KV: POST ütleb 503, mitte ei kuku', async () => {
  assert.equal((await post({}, { text: 'tere tere' })).status, 503);
});

console.log(`\n${pass} testi läbitud.`);
