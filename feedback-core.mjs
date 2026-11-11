/* Tagasiside vormi reeglid ilma Cloudflare'ita, et neid saaks testida.
   Pages Function (functions/api/feedback.js) on ainult õhuke kest ümber. */

export const KINDS = ['idee', 'viga', 'muu'];
export const TEXT_MIN = 3;
export const TEXT_MAX = 2000;
export const CONTACT_MAX = 200;
export const RATE_LIMIT = 5;          // saatmist ühelt IP-lt
export const RATE_WINDOW_S = 3600;    // tunnis
export const LIST_MAX = 100;
export const KEY_PREFIX = 'fb:';

const short = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Brauserist tulnud keha -> { ok, record } või { ok: false, error, status }.
 * Honeypot ("website") täidavad ainult robotid: neile vastame "ok", aga ei
 * salvesta midagi — nii ei õpi nad, et filter olemas on.
 */
export function validate(body, now = new Date()) {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'Vigane päring' };
  if (short(body.website, 200)) return { ok: true, record: null };

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < TEXT_MIN) return { ok: false, status: 400, error: 'Kirjuta paar sõna rohkem' };
  if (text.length > TEXT_MAX) return { ok: false, status: 400, error: `Kuni ${TEXT_MAX} märki` };

  return {
    ok: true,
    record: {
      ts: now.toISOString(),
      kind: KINDS.includes(body.kind) ? body.kind : 'muu',
      text,
      contact: short(body.contact, CONTACT_MAX) || null,
      klass: /^\d{1,2}[A-Z]$/.test(body.klass ?? '') ? body.klass : null,
      version: short(body.version, 40) || null,
      ua: deviceOf(body.ua),
    },
  };
}

/** Kogu user-agenti ei hoia — ainult see, mis aitab viga taasesitada. */
export function deviceOf(ua) {
  const s = typeof ua === 'string' ? ua : '';
  if (/iPhone|iPad|iPod/.test(s)) return 'iPhone';
  if (/Android/.test(s)) return 'Android';
  return 'muu';
}

/** KV võti: ISO-aeg ees, et tähestikuline järjekord oleks ka ajaline. */
export function keyFor(record, rand) {
  return `${KEY_PREFIX}${record.ts}:${rand}`;
}

/** Kas võti on uuem kui `since` (ISO)? Ilma since'ita sobib kõik. */
export function isAfter(key, since) {
  if (!since) return true;
  return key.slice(KEY_PREFIX.length) > since;
}

/** Mitmes saatmine see aknas oleks -> kas lubada. */
export const overLimit = (countSoFar) => countSoFar >= RATE_LIMIT;

/** Bearer-tokeni kontroll ajas, mis ei sõltu sellest, mitu märki klappis. */
export function tokenMatches(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const got = header.replace(/^Bearer\s+/i, '');
  if (got.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
