#!/usr/bin/env node
/**
 * Laeb huviala- ja aineringid kooli lehelt ja kirjutab clubs.json.
 *
 * Parsimine ise elab clubs.js-is, sest sama loogikat vajab ka brauser.
 * Siin on ainult võrk, fail ja käsurida.
 *
 * Nagu menüü, on ka see kõrvaline lisa: tõrge ei tohi tunniplaani avaldamist
 * peatada, seega lõpetab skript vea korral koodiga 0 ja jätab vana faili
 * puutumata.
 *
 * Kasutus: npm run ringid
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseClubs } from './clubs.js';

const URL = 'https://21k.ee/koolielu/huviala-ja-aineringid/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'clubs.json');

async function main() {
  process.stdout.write(`Laen ${URL} ... `);
  const res = await fetch(URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  console.log(`${(html.length / 1024).toFixed(0)} KB`);

  const clubs = parseClubs(html);
  if (clubs.length < 5) throw new Error(`Leidsin ainult ${clubs.length} ringi — kas lehe kuju muutus?`);

  const out = {
    _comment: 'Huviala- ja aineringid. Genereeritud: npm run ringid. Nimed, kategooriad ja side tunniplaaniga on clubs-overlay.json failis.',
    source: URL,
    scrapedAt: new Date().toISOString(),
    clubs,
  };
  // Sama valvur mis mujal: kui sisu ei muutunud, hoia vana ajatempel, muidu
  // commitib workflow kaks korda päevas tühja muudatuse.
  const previous = await readFile(OUT, 'utf8').then(JSON.parse, () => null);
  if (previous && JSON.stringify(previous.clubs) === JSON.stringify(clubs)) {
    out.scrapedAt = previous.scrapedAt;
    console.log('Ringid ei muutunud — ajatemplit ei uuendata.');
  }

  await writeFile(OUT, `${JSON.stringify(out, null, 0)}\n`, 'utf8');
  for (const c of clubs) {
    console.log(`  ${c.tasuline ? '€' : ' '} ${c.aeg.padEnd(22)} ${c.ring.slice(0, 46)}`);
  }
  console.log(`Ringe: ${clubs.length}\n-> ${OUT}`);
}

main().catch((err) => {
  console.error(`\nHuviringe ei õnnestunud laadida: ${err.message}`);
  console.error('Vana clubs.json jääb alles, avaldamine läheb edasi.');
  process.exit(0);
});
