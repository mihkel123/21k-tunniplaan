/* Huviringide loogika. Ilma DOM-ita ja ilma Node-ita, et sama kood töötaks
   nii brauseris kui kraapijas (clubs-data.mjs) ja oleks testitav. */

/* Kooli tabelis eraldab päeva ja kellaaega sisetühik (U+00A0), mitte tavaline
   tühik. Ilma selleta ei haaku ükski allpool olev muster. */
export const normalize = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#0?39;|&apos;/gi, "'")
  .replace(/ /g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const ET = { 'õ': 'o', 'ä': 'a', 'ö': 'o', 'ü': 'u', 'š': 's', 'ž': 'z' };

/** Stabiilne võti overlay jaoks. Nimi + klassivahemik, sest sama ring kordub
    mitme vanuserühma kohta ("Male ... 1.-3." ja "Male ... 4.-12."). */
export const clubId = (ring, klass) => `${ring} ${klass}`
  .toLowerCase()
  .replace(/[õäöüšž]/g, (c) => ET[c])
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80)
  .replace(/-+$/, '');

/**
 * Klassiveerg seitsmes kujus:
 *   "1.-2. klassid"  "4.-12. klassid"  "Alates 5. klassist"  "1. klassid"
 *   "2A, 3A, 4A"     "2BCD, 3BCD, 4BCD"     "1ABCDE ja 2CD"
 *
 * Kui tähed on kirjas, loevad täpsed klassid — "2A, 3A, 4A" on muusikaklassid
 * ja 2B laps sinna ei kuulu. Kui tähti pole, loeb aste ja iga täht sobib.
 * -> { grades: number[], classes: string[] }
 */
export function parseGrades(text) {
  const s = normalize(text);
  const classes = new Set();
  const grades = new Set();

  // "2BCD" või "1ABCDE" — üks aste, mitu tähte koos
  for (const [, num, letters] of s.matchAll(/(\d{1,2})\s*([A-EÕÄÖÜ]{1,6})\b/gi)) {
    for (const L of letters.toUpperCase()) classes.add(`${Number(num)}${L}`);
  }
  // "1.-2. klassid", "4.-12. klassid"
  for (const [, a, b] of s.matchAll(/(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.\s*klass/gi)) {
    for (let g = Number(a); g <= Number(b); g++) grades.add(g);
  }
  // "Alates 5. klassist"
  for (const [, a] of s.matchAll(/alates\s+(\d{1,2})\.\s*klassist/gi)) {
    for (let g = Number(a); g <= 12; g++) grades.add(g);
  }
  // "1. klassid" — üksik aste ilma vahemikuta
  if (!grades.size) {
    for (const [, a] of s.matchAll(/(?:^|[\s,])(\d{1,2})\.\s*klass/gi)) grades.add(Number(a));
  }
  return {
    grades: [...grades].sort((x, y) => x - y),
    classes: [...classes].sort(),
  };
}

/** Kas see ring sobib sellele klassile? Klass on kujul "7A". */
export function fitsClass(rule, klass) {
  const m = /^(\d{1,2})\s*([A-ZÕÄÖÜ]?)/i.exec(String(klass ?? '').trim());
  if (!m) return false;
  const grade = Number(m[1]);
  const full = `${grade}${(m[2] || '').toUpperCase()}`;
  if (rule?.classes?.length) return rule.classes.includes(full);
  return Boolean(rule?.grades?.includes(grade));
}

const DAYS = ['E', 'T', 'K', 'N', 'R'];

/**
 * Ajaveerg viies kujus, pluss vabatekst:
 *   "E 14.00–14.45"   "R 8.00"   "E ja K 14.00–14.45"
 *   "K või N 15.00–16.30"   "eriplaan"   "Täpsustamisel"
 *
 * Sidekriips on lehel kord tavaline, kord pikk. "ja" tähendab mõlemat päeva,
 * "või" ühte neist — vahet hoiame alles, sest kaardil on see eri lause.
 * -> { raw, days, either, start, end }
 */
export function parseTime(text) {
  const raw = normalize(text);
  const out = { raw, days: [], either: false, start: null, end: null };
  if (!raw) return out;

  // Päevatäht peab olema omaette sõna. \b ei piisa: "Täpsustamisel" algab
  // T-ga ja ä ei ole JS-i regexis sõnamärk, seega piir tekiks kohe T järel.
  const head = /^((?:[ETKNR])(?:\s*(?:ja|või)\s*[ETKNR])*)(?=\s|$)/.exec(raw);
  if (head) {
    out.days = head[1].split(/\s*(?:ja|või)\s*/).filter((d) => DAYS.includes(d));
    out.either = /\bvõi\b/.test(head[1]);
  }

  const times = [...raw.matchAll(/(\d{1,2})[.:](\d{2})/g)]
    .map(([, h, m]) => `${Number(h)}.${m}`);
  if (times[0]) out.start = times[0];
  if (times[1]) out.end = times[1];
  return out;
}

/** "54.-" -> 54, "17" -> 17, tühi -> null. */
export function parseFee(text) {
  const m = /(\d+(?:[.,]\d{1,2})?)/.exec(normalize(text));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Järjestus kategooria sees: nädalapäev, siis algusaeg. Aegadeta lõppu. */
const sortKey = (c) => {
  const d = c.time.days.length ? DAYS.indexOf(c.time.days[0]) : 9;
  const [h, m] = (c.time.start ?? '99.99').split('.');
  return d * 10000 + Number(h) * 100 + Number(m);
};

/**
 * Kaks tabelit: tasuline (veerg "Kuutasu") ja tasuta. Päist tuvastame veeru
 * nime järgi, mitte järjekorra järgi — kui kool tabelid ümber tõstab, ei tohi
 * hinnad kaduda vale tabeli alla.
 */
export function parseClubs(html) {
  const clean = String(html)
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const tables = clean.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const clubs = [];

  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 2) continue;

    const head = [...rows[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => normalize(m[1]));
    if (!head.some((h) => /ring/i.test(h))) continue;      // pole ringide tabel
    const feeAt = head.findIndex((h) => /kuutasu/i.test(h));
    const paid = feeAt >= 0;

    for (const row of rows.slice(1)) {
      const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => normalize(m[1]));
      const [ring, klass, aeg, ruum] = cells;
      if (!ring) continue;

      // Tasuta tabelis on info seal, kus tasulisel on hind — seepärast
      // otsime infot päisest, mitte kindlast indeksist.
      const fee = paid ? parseFee(cells[feeAt]) : null;
      const info = cells.slice(paid ? feeAt + 1 : 4).find(Boolean) ?? '';

      clubs.push({
        id: clubId(ring, klass ?? ''),
        ring,
        klass: klass ?? '',
        sobib: parseGrades(klass ?? ''),
        aeg: normalize(aeg),
        time: parseTime(aeg),
        ruum: normalize(ruum),
        tasuline: paid,
        kuutasu: fee,
        info,
      });
    }
  }
  clubs.sort((a, b) => sortKey(a) - sortKey(b));
  return clubs;
}

/**
 * Liidab kraabitud read käsitsi hoitava kihiga ja rühmitab kategooriatesse.
 * Overlayta ring jääb alles — toore nimega, kategoorias "muu". Andmeid ei
 * peideta sellepärast, et käsitsi kiht on maha jäänud.
 *
 * @param klass  "7A" — filtreerib sobivad; null näitab kõiki
 * -> [{ kategooria: {id, nimi, emoji}, ringid: [...] }] tühjad kategooriad välja
 */
export function mergeClubs(data, overlay, klass) {
  const kihid = overlay?.ringid ?? {};
  const kategooriad = overlay?.kategooriad?.length
    ? overlay.kategooriad
    : [{ id: 'muu', nimi: 'Ringid', emoji: '🎭' }];
  const muu = kategooriad.find((k) => k.id === 'muu') ?? kategooriad.at(-1);

  const ringid = (data?.clubs ?? [])
    .filter((c) => !klass || fitsClass(c.sobib, klass))
    .map((c) => {
      const kiht = kihid[c.id] ?? {};
      return {
        ...c,
        nimi: kiht.nimi || c.ring,
        juhendaja: kiht.juhendaja || '',
        subject: kiht.subject ?? [],
        kategooria: kategooriad.some((k) => k.id === kiht.kategooria) ? kiht.kategooria : muu.id,
      };
    });

  return kategooriad
    .map((kat) => ({ kategooria: kat, ringid: ringid.filter((r) => r.kategooria === kat.id) }))
    .filter((g) => g.ringid.length);
}

/** Kas avalduse tähtaeg on veel ees? Riba kaob ise ära, kui aeg läbi saab. */
export function deadlineOn(overlay, today) {
  const t = overlay?.tahtaeg;
  if (!t?.avaldus || !t?.tekst) return null;
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return iso <= t.avaldus ? t : null;
}

