/* POST /api/feedback — rakenduse tagasiside vorm.
   GET  /api/feedback?since=<ISO> — kirjad lugemiseks (Bearer-token).
   DELETE /api/feedback?key=<võti> — testkirja kustutamine (Bearer-token).

   Vajab Pages projektis: KV sidumine FEEDBACK ja secret FEEDBACK_READ_TOKEN.
   Reeglid on feedback-core.mjs failis, et neid saaks testida. */

import {
  validate, keyFor, isAfter, overLimit, tokenMatches,
  RATE_WINDOW_S, LIST_MAX, KEY_PREFIX,
} from '../../feedback-core.mjs';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** IP-st räsi, mida ilma tokenita tagasi arvutada ei saa. IP ennast ei hoia. */
async function ipHash(ip, pepper) {
  const bytes = new TextEncoder().encode(`${pepper}|${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  if (!env.FEEDBACK) return json({ error: 'Tagasiside pole seadistatud' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Vigane päring' }, 400); }

  const result = validate(body);
  if (!result.ok) return json({ error: result.error }, result.status);
  if (!result.record) return json({ ok: true });   // honeypot

  const ip = request.headers.get('cf-connecting-ip') ?? 'tundmatu';
  const rateKey = `rate:${await ipHash(ip, env.FEEDBACK_READ_TOKEN ?? '')}`;
  const sent = Number(await env.FEEDBACK.get(rateKey)) || 0;
  if (overLimit(sent)) return json({ error: 'Liiga palju korraga — proovi tunni pärast' }, 429);
  await env.FEEDBACK.put(rateKey, String(sent + 1), { expirationTtl: RATE_WINDOW_S });

  const key = keyFor(result.record, crypto.randomUUID().slice(0, 8));
  await env.FEEDBACK.put(key, JSON.stringify(result.record));
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  if (!tokenMatches(request.headers.get('authorization'), env.FEEDBACK_READ_TOKEN)) {
    return json({ error: 'Pole lubatud' }, 401);
  }
  const since = new URL(request.url).searchParams.get('since');

  const keys = [];
  let cursor;
  do {
    const page = await env.FEEDBACK.list({ prefix: KEY_PREFIX, cursor });
    for (const k of page.keys) if (isAfter(k.name, since)) keys.push(k.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  // Uusimad ees; kui neid on liiga palju, ütleb "more", et vaata ka vanemaid.
  keys.sort().reverse();
  const picked = keys.slice(0, LIST_MAX);
  const items = await Promise.all(picked.map(async (key) => ({
    key, ...JSON.parse((await env.FEEDBACK.get(key)) ?? '{}'),
  })));
  return json({ count: keys.length, more: keys.length > picked.length, items });
}

export async function onRequestDelete({ request, env }) {
  if (!tokenMatches(request.headers.get('authorization'), env.FEEDBACK_READ_TOKEN)) {
    return json({ error: 'Pole lubatud' }, 401);
  }
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!key.startsWith(KEY_PREFIX)) return json({ error: 'Vigane võti' }, 400);
  await env.FEEDBACK.delete(key);
  return json({ ok: true });
}
