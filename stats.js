/* Kasutusstatistika (Umami). Ilma DOM-ita, et vahemike loogika oleks
   testitav. Kõik siin olev vaikib, kui window.umami puudub — kohapeal,
   võrguta, reklaamiblokeerijaga või kui skript pole veel jõudnud laadida. */

/**
 * Kestuse vahemikud. Umami näitab sündmuse omaduse väärtusi loendina, seega
 * täpne sekund ("47s", "48s", "51s") oleks loetamatu — vahemik annab
 * kasuliku jaotuse ("enamik alla 15s" ütleb midagi, "keskmine 43,2s" mitte).
 */
const BUCKETS = [
  [15, '<15s'],
  [60, '15–60s'],
  [5 * 60, '1–5min'],
  [15 * 60, '5–15min'],
];
const LONGEST = '15min+';

/** Sekundid -> Umami omaduse väärtus. */
export function durationBucket(seconds) {
  if (!(seconds > 0)) return null;
  for (const [max, label] of BUCKETS) if (seconds < max) return label;
  return LONGEST;
}

/** Lehevaade ekraani vahetumisel. URL on väljamõeldud — päris navigatsiooni
    äpis ei ole, aga Umami arvutab külastuse pikkuse just lehevaadete
    vahest, seega need ekraanid on ainus viis kestust üldse mõõta. */
export function screen(path) {
  window.umami?.track?.((props) => ({ ...props, url: path }));
}

/** Kui kaua äpp seekord nähtaval oli. */
export function leaving(seconds) {
  const bucket = durationBucket(seconds);
  if (!bucket) return;
  window.umami?.track?.('lahkus', { kestus: bucket });
}
