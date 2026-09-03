#!/usr/bin/env node
/**
 * Laeb koolilõuna menüü kooli lehelt ja kirjutab menu.json.
 *
 * Erinevalt tunniplaanist EI tohi see tõrge avaldamist peatada: menüü on
 * kõrvaline lisa ja katkine menüüleht ei tohi tunniplaani väljas hoida.
 * Seepärast lõpetab skript tõrke korral koodiga 0 ja jätab vana menu.json
 * puutumata.
 *
 * Kasutus: npm run menyy
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL = 'https://21k.ee/koolilouna/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'menu.json');

const MONTHS = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni',
  'juuli', 'august', 'september', 'oktoober', 'november', 'detsember'];

const stripTags = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Päevapäis on kujul "Kolmapäev, 2. september" — aastat seal ei ole.
 * Leht näitab jooksvat nädalat, seega valime aasta, mis jääb tänasele
 * kõige lähemale (nii ei lähe detsember/jaanuar piiril sassi).
 */
export function dateFromHeading(heading, today = new Date()) {
  const m = /(\d{1,2})\.\s*([a-zäöüõšž]+)/i.exec(heading);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0 || day < 1 || day > 31) return null;

  let best = null;
  for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const d = new Date(year, month, day);
    if (d.getMonth() !== month) continue;      // nt 31. veebruar
    const vahe = Math.abs(d - today);
    if (!best || vahe < best.vahe) best = { d, vahe };
  }
  return best ? iso(best.d) : null;
}

/**
 * Roa nimi on täpselt see, mis on <strong> sees — koostis, lisandid, joogid
 * ja leib on samas lahtris tavatekstina ilma <strong>-ita. Seega "ainult roa
 * nimi, ilma lisanditeta" ongi lihtsalt <strong>-ide korjamine.
 * Esimene lahter on tavamenüü, teine taimetoit.
 */
export function parseMenu(html, today = new Date()) {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const parts = clean.split(/<h2>([^<]*?\d{1,2}\.\s*[a-zäöüõšž]+[^<]*?)<\/h2>/i);

  const days = {};
  for (let i = 1; i < parts.length; i += 2) {
    const date = dateFromHeading(stripTags(parts[i]), today);
    if (!date) continue;

    const cells = [...parts[i + 1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const road = (cell) => [...(cell ?? '').matchAll(/<strong>([\s\S]*?)<\/strong>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean);

    const tava = road(cells[0]);
    const taim = road(cells[1]);
    if (tava.length || taim.length) days[date] = { tava, taim };
  }
  return days;
}

async function main() {
  process.stdout.write(`Laen ${URL} ... `);
  const res = await fetch(URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  console.log(`${(html.length / 1024).toFixed(0)} KB`);

  const days = parseMenu(html);
  const count = Object.keys(days).length;
  if (!count) throw new Error('Ühtegi menüüpäeva ei leidnud — kas lehe kuju muutus?');

  const out = {
    _comment: 'Koolilõuna menüü. Genereeritud: npm run menyy. Ainult roa nimed, ilma lisandite, jookide ja leivata.',
    source: URL,
    scrapedAt: new Date().toISOString(),
    days,
  };
  // Sama valvur mis scrape.mjs-is: kui road ei muutunud, hoia vana ajatempel
  // alles. Muidu erineb fail iga kraapimisega ainult 'scrapedAt' poolest ja
  // workflow commitib kaks korda päevas tühja muudatuse.
  const previous = await readFile(OUT, 'utf8').then(JSON.parse, () => null);
  if (previous && JSON.stringify(previous.days) === JSON.stringify(days)) {
    out.scrapedAt = previous.scrapedAt;
    console.log('Menüü ei muutunud — ajatemplit ei uuendata.');
  }

  await writeFile(OUT, `${JSON.stringify(out, null, 0)}\n`, 'utf8');
  for (const [date, d] of Object.entries(days)) {
    console.log(`  ${date}  ${[...d.tava, ...d.taim.map((t) => `🌱 ${t}`)].join(' | ')}`);
  }
  console.log(`Päevi: ${count}\n-> ${OUT}`);
}

const runDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (runDirectly) {
  main().catch((err) => {
    // Teadlikult kood 0: menüü tõrge ei tohi tunniplaani avaldamist peatada.
    // Vana menu.json jääb alles ja läheb saidile edasi.
    console.error(`\nMenüüd ei õnnestunud laadida: ${err.message}`);
    console.error('Vana menu.json jääb alles, avaldamine läheb edasi.');
    process.exit(0);
  });
}
