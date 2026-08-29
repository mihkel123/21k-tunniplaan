# Tunniplaan

Tallinna 21. Kooli tunniplaan telefonis. Avaneb kodukuvalt nagu päris rakendus,
näitab kohe õiget päeva ja töötab ka ilma internetita.

Andmed tulevad kooli enda lehelt <https://21k.ee/oppetoo/tunniplaan/> (Untis).
See rakendus on ainult **lugeja** — kooli leht jääb ainsaks tõeallikaks.

## Mida see teeb

- **Näitab õiget päeva ise.** Enne kella 16 tänast, alates kella 16-st järgmist
  koolipäeva. Nädalavahetused ja koolivaheajad jäetakse vahele.
- **Üks kaart tunni kohta** — aine täisnimi, õpetaja, ruum ja kellaaeg.
- **Muudatused jäävad 14 päevaks silma.** Kui tund kolib teise aega, märgitakse
  ära nii vana koht (läbi kriipsutatult) kui uus.
- **Rühmavalik.** Kus käib mitu rühma korraga (vene/prantsuse/saksa keel, koorid),
  valib laps korra oma rühma ja see jääb meelde. Teised jäävad hallilt nähtavale.
- **Koolivaheajad** ja riigipühad on arvestatud, sh 12. klassi erandid.
- **Valikulised tunnid.** Tugiõpe, koorid, ansambel ja orkester on huvitegevus —
  laps vastab korra „kas käid?" ja kui ei käi, siis kaarti enam ei näidata.
- **Bussiajad päeva lõpus.** Laps valib kooli- ja kodupoolse peatuse; app näitab
  kolme järgmist väljumist õiges suunas ja seda, millal peab välja minema.
- **Töötab võrguta.** Teenusetöötleja hoiab kõik vajaliku vahemälus.

## Käivitamine kohapeal

```sh
npm run serve     # http://localhost:8765
```

Teenusetöötleja vajab päris aadressi — `file://` alt avades see ei tööta.

```sh
npm run scrape    # laeb kooli lehelt värske plaani -> data.json + changes.json
npm run bus       # laeb Tallinna GTFS-i -> bus/ (vajalik bussiaegade jaoks)
npm test          # 54 testi: päevaloogika, muudatused, bussiloogika
```

Esmakordsel kohapeal käivitamisel jooksuta `npm run bus`, muidu jäävad bussiajad
laadimata (kaust `bus/` on `.gitignore`-is, sest need on tuletatud andmed).

## Telefoni kodukuvale (iOS)

1. Ava sait Safaris.
2. Jaga (kast noolega) → **Lisa avakuvale**.
3. Ava tekkinud ikoonilt — brauseririba ei ole, näeb välja nagu rakendus.

Klassi- ja rühmavalik salvestatakse ainult telefoni (`localStorage`), mitte serverisse.

## Kuidas andmed värskena püsivad

`.github/workflows/update.yml` käivitub iga öö kell ~05:00:

1. jooksutab testid,
2. laeb kooli lehelt värske plaani,
3. võrdleb eelmisega ja uuendab `changes.json`-i,
4. salvestab muutused repositooriumi (nii tekib ka ajalugu),
5. avaldab saidi GitHub Pagesis.

Kui kooli lehe HTML muutub, katkeb kraapimine veaga ja **avaldamine jääb ära** —
vana töötav plaan jääb püsti, tühja tunniplaani välja ei panda.

Käsitsi saab käivitada GitHubis: Actions → *Uuenda tunniplaan* → *Run workflow*.

## Failid

| Fail | Mida teeb |
|---|---|
| `scrape.mjs` | Laeb kõik klassid kooli lehelt, võrdleb eelmisega, kirjutab `data.json` ja `changes.json`. |
| `schedule.js` | Kuupäevaloogika: milline päev näidata, kas on vaheaeg. Ilma DOM-ita, seetõttu testitav. |
| `app.js` | Kuvamine: kaardid, rühmavalikud, muudatuste märgid. |
| `data.json` | Kraabitud tunniplaan (46 klassi). Genereeritud — käsitsi ei muuda. |
| `changes.json` | Viimase 14 päeva muudatused. Genereeritud. |
| `holidays.json` | Koolivaheajad ja riigipühad. **Käsitsi hooldatav** — vt allpool. |
| `make-icons.py` | Genereerib ikoonid (`python3 make-icons.py`). |
| `bus.js` | Suunatuvastus, reaalaja parsimine, väljumiste valik. |
| `bus-data.mjs` | Laeb Tallinna GTFS-i ja kirjutab `bus/`. Genereeritud, ei commitita. |

## Koolivaheaegade uuendamine

`holidays.json` on ainus fail, mis vajab käsitsi hoolt. Vaheajad kinnitab
haridus- ja teadusminister määrusega umbes iga kolme aasta tagant.

Praegu on sees **2026/2027**. Kui õppeaasta vahetub, lisa uus plokk
`schoolYears` alla. Allikas on failis kirjas
([Riigi Teataja](https://www.riigiteataja.ee/akt/119032025005)).

`exceptGrades` tähistab erandeid — nt kevadvaheaeg ei kehti 12. klassile,
suvevaheaeg ei kehti lõpuklassidele.

## Mida see ei tee

- **Ei näita ärajäänud tunde.** Asendused ja tühistused käivad eKooli kaudu,
  mis nõuab sisselogimist. Vt allpool.
- **Ei tea koolisiseseid erisusi** (üritused, ekskursioonid, aktused).

### Bussiajad — kust andmed tulevad

Graafik küpsetatakse ehitusel Tallinna GTFS-ist
(`transport.tallinn.ee/data/gtfs.zip`), nii et ajad on olemas ka võrguta ja
kõigil nädalapäevadel. Tänase päeva kohta pärib rakendus lisaks reaalaja
(`siri-stop-departures.php`), mis näitab hilinemisi — see teenus lubab
päringuid otse brauserist.

Suund tuvastatakse liinide peatuste järjekorrast: näidatakse ainult neid liine,
mis läbivad **esmalt** lähtepeatust ja **seejärel** sihtpeatust. Seetõttu ei pea
laps teadma, kummal pool teed seista — õige platvorm leitakse ise.

Teadaolev piirang: graafik ei arvesta erandpäevi (`calendar_dates.txt`), vaid
kasutab tavalist E–N ja reede mustrit. Riigipühadel võib graafikuaeg eksida;
tänase päeva reaalaeg on siiski õige.

### eKool ja ärajäänud tunnid

Teadlik otsus jätta praegusest versioonist välja. Tasuta GitHub Pages teenindab
ainult avalikke repositooriume — tunniplaan ise on niikuinii avalik, aga
tühistused on konkreetse lapse isikuandmed ega sobi avalikule aadressile.
Lisaks on eKool Cloudflare'i taga ja kasutab HarID-d; ID-kaardi, Mobiil-ID või
Smart-ID sisselogimist ei saa skriptiga automatiseerida.

Kui seda kunagi vaja läheb, on aus tee privaatne majutus (nt Cloudflare Pages +
Access, tasuta kuni 50 kasutajat). Paroole ei hoita kunagi repositooriumis.
