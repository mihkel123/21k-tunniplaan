#!/usr/bin/env node
/**
 * Laeb nimepäevad Statistikaameti lehelt ja kirjutab namedays.json.
 *
 * Erinevalt tunniplaanist ja bussiaegadest EI käi see iga deploy'ga:
 * nimepäevad ei muutu (ametlikku kalendrit uuendatakse mõne aasta tagant),
 * seega tulemus commititakse ja skripti jooksutatakse käsitsi.
 *
 * Kasutus: npm run nimepaevad
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL = 'https://www.stat.ee/nimed/NIMEPAEVAD';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'namedays.json');

/**
 * Leht on akordion, aga kõik kaksteist kuud on juba HTML-is olemas —
 * tabelirida kujul <td>01.01</td><td><a>Algo</a>, <a>Alo</a>...</td>.
 */
export function parseNamedays(html) {
  const rows = [...html.matchAll(/<td[^>]*>\s*(\d{2})\.(\d{2})\s*<\/td>\s*<td[^>]*>(.*?)<\/td>/gs)];
  const days = {};
  for (const [, dd, mm, cell] of rows) {
    const names = cell
      .replace(/<[^>]+>/g, '')
      .split(',')
      .map((n) => n.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (names.length) days[`${mm}-${dd}`] = names;
  }
  return days;
}

async function main() {
  process.stdout.write(`Laen ${URL} ... `);
  const res = await fetch(URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  console.log(`${(html.length / 1024).toFixed(0)} KB`);

  const days = parseNamedays(html);

  // Kui leht kuju muudab, on parem katkeda kui kirjutada pool kalendrit üle.
  const count = Object.keys(days).length;
  if (count < 365) throw new Error(`Ootasin vähemalt 365 päeva, sain ${count} — kas lehe kuju muutus?`);
  const names = Object.values(days).reduce((n, v) => n + v.length, 0);
  if (names < 1000) throw new Error(`Ootasin vähemalt 1000 nime, sain ${names}`);

  const out = {
    _comment: 'Nimepäevad Statistikaameti kalendrist. Genereeritud: npm run nimepaevad. Nimepäevad ei muutu, seega seda ei laadita iga deploy\'ga.',
    source: URL,
    checkedOn: new Date().toISOString().slice(0, 10),
    days,
  };
  await writeFile(OUT, `${JSON.stringify(out, null, 0)}\n`, 'utf8');
  console.log(`Päevi: ${count}, nimesid: ${names}`);
  console.log(`-> ${OUT}`);
}

const runDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (runDirectly) {
  main().catch((err) => {
    console.error(`\nViga nimepäevade laadimisel: ${err.message}`);
    process.exit(1);
  });
}
