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
- **Bussiajad hommikul ja päeva lõpus.** Laps valib kooli- ja kodupoolse
  peatuse; app näitab kolme väljumist õiges suunas, saabumisaega ja seda,
  millal peab välja minema. Peale Tallinna linnaliinide on sees ka Harjumaa
  maakonnaliinid, nii et koju Jürisse, Kosele või Viimsisse sõitmine on
  samamoodi kaetud.
- **Mitu suunda korraga.** Suundi saab lisada nii palju kui vaja — igaüks saab
  oma kaardi. Hommikune suund ilmub esimese tunni ette, kojusõit päeva lõppu.
  Kaardi saab kokku klappida ja see jääb nii, kuni ise uuesti avad.
- **Riigipühad, tähtpäevad ja nimepäevad** päise all: 1. september on
  tarkusepäev, 14. märts emakeelepäev, ja iga päev näitab ka selle päeva
  nimepäevi.
- **Juhend avakuvale lisamiseks.** Esimesel avamisel näidatakse korra, kuidas
  rakendus kodukuvale panna — iPhone'il ja Androidil eri juhend, sest nupud on
  eri kohtades. Hiljem leiab selle menüüst.
- **Töötab võrguta.** Teenusetöötleja hoiab kõik vajaliku vahemälus.

## Käivitamine kohapeal

```sh
npm run serve     # http://localhost:8765
```

Teenusetöötleja vajab päris aadressi — `file://` alt avades see ei tööta.

```sh
npm run scrape    # laeb kooli lehelt värske plaani -> data.json + changes.json
npm run bus       # laeb mõlemad GTFS-id -> bus/ (vajalik bussiaegade jaoks)
npm run nimepaevad # laeb nimepäevad -> namedays.json (harva; tulemus commititakse)
npm test          # 77 testi: päevaloogika, muudatused, bussiloogika, voogude liitmine
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
| `bus.js` | Suunatuvastus, sõiduaeg, reaalaja parsimine, hommikuste ja kojusõidu väljumiste valik. |
| `bus-data.mjs` | Laeb linna- ja maakonnaliinide GTFS-id, liidab need ja kirjutab `bus/`. Genereeritud, ei commitita. |
| `namedays.mjs` | Laeb nimepäevad Statistikaametist -> `namedays.json`. Käsitsi, mitte iga deploy'ga. |
| `notabledays.json` | Riigipühad, riiklikud tähtpäevad, rahvakalender. Käsitsi hooldatav. |

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

Graafik küpsetatakse ehitusel kahest allikast, nii et ajad on olemas ka
võrguta ja kõigil nädalapäevadel:

| Allikas | Mida annab |
| --- | --- |
| `transport.tallinn.ee/data/gtfs.zip` | Tallinna linnaliinid — bussid, trollid, trammid. |
| `eu-gtfs.remix.com/estonia_unified_gtfs.zip` | Harjumaa maakonnaliinid (GoBus, Hansabuss, SEBE). |

Riiklik voog katab tervet Eestit ja on 55 MB, seega korjame sealt ainult
Harjumaa vedajate liinid, mis peatuvad kuskil Tallinnas — 110 liini 221-st.
Ülejäänud on küla-sisesed (Rae sise, Saue sise jt) ja kolmekordistaksid mahu
ilma, et laps neile koolist koju sõites satuks.

Vood liituvad otse, sest **peatuse-id on mõlemas sama riiklik number** —
Vabaduse väljak on 1285 nii TLT-s kui registris. Liininumbrid ei põrku
(linnas 79, maakonnas 110, kattuvusi null).

Vana `peatus.ee` on suletud; riiklik voog kolis Remixi juurde ja on aja jooksul
mitu korda liikunud. Kui see kaob, katkeb `bus-data.mjs` valjult ja deploy jääb
tegemata — nii jääb vana töötav sait püsti.

Tänase päeva kohta pärib rakendus lisaks reaalaja (`siri-stop-departures.php`),
mis näitab hilinemisi — see teenus lubab päringuid otse brauserist. **Reaalaeg
katab ainult linnaliine**: maakonnabussid on graafikupõhised ja neil ei ole
„● reaalajas" märki.

Suund tuvastatakse liinide peatuste järjekorrast: näidatakse ainult neid liine,
mis läbivad **esmalt** lähtepeatust ja **seejärel** sihtpeatust. Seetõttu ei pea
laps teadma, kummal pool teed seista — õige platvorm leitakse ise.

`routes.json` hoiab iga liinisuuna kohta ka sõiduaegu (sekundid liini algusest),
nii et kahe peatuse vahelise sõidu pikkus tuleb lahutamisega. Sellest saab
saabumisaja — ilma selleta ei oskaks hommikune kaart öelda, kas laps enne
esimest tundi kohale jõuab.

**Hommik ja pärastlõuna arvestavad eri asja.** Kojusõidul piisab väljumisest:
näitame kolme järgmist bussi pärast tundide lõppu. Hommikul on tähtis
**saabumine**, seega valime need bussid, millega jõuab enne esimest tundi kohale,
ja märgime viimase, millega veel jõuab. Jalutusaega arvestame mõlemas otsas:
kodust peatusesse ja peatusest kooli. Kui ükski buss enam ei jõua, ütleb kaart
seda otse, selle asemel et pakkuda bussi, millega hiljaks jääb.

Maakonnapeatuse nimele lisatakse vald — „Kadaka (Harku vald)" —, sest sama
nimi kordub üle Harjumaa ja Tallinnas. Ilma vallata segataks kaks eri kohta
üheks peatuseks ja laps saaks vale bussi.

Erand: kui linnavõrk seda peatust juba tunneb, jääb linnanimi kehtima.
Linnaliin käib ka üle valla piiri — Tiskre, Harkujärve ja Hansunõmme on
registris Harjumaa peatused, aga lapse jaoks tavalised linnapeatused.

Teadaolevad piirangud:

- Graafik ei arvesta erandpäevi (`calendar_dates.txt`), vaid kasutab tavalist
  E–N ja reede mustrit. Riigipühadel võib graafikuaeg eksida; tänase päeva
  reaalaeg on siiski õige.
- Sõiduplaan valitakse **ehitamise päeva** järgi. Maakonnaliinil käib korraga
  kaks plaani (vana kuni 31.08, uus alates 01.09) ja korraga kehtib neist üks.
  Igaöine uuendus tähendab, et vahetuse hommikul on plaan juba õige.
- Mõned suured sõlmed on registris platvormide kaupa eraldi nimetatud
  („Balti jaam 3", „Estonia 2"). Neid ei liideta aluspeatusega, seega tuleb
  otsingus valida just see platvorm. Puudutab 11 peatust ja 0,2% väljumistest.

### Tähtpäevad ja nimepäevad

Päise all on kaks rida: riigipüha või tähtpäev, ja selle päeva nimepäevad.

Riigipühad ja riiklikud tähtpäevad tulevad pühade ja tähtpäevade seadusest,
rahvakalendri päevad (tarkusepäev, sõbrapäev, mardipäev, kadripäev jt)
[rahvakalender.ee](https://rahvakalender.ee/) järgi. Liikuvad pühad
arvutatakse: ülestõusmispühad gregoriuse algoritmiga, sellest tuletatakse
suur reede, nelipühad ja vastlapäev; emadepäev ja isadepäev on kuu n-s
pühapäev. Test kontrollib, et `notabledays.json` ja `holidays.json` ütlevad
suure reede kohta sama kuupäeva — kaks sõltumatut allikat peavad klappima.

Nimed on failis suure algustähega, sest need lähevad otse ekraanile sildina.
Test kontrollib seda, nagu ka seda, et emoji ei puudu.

Igal tähtpäeval on `notabledays.json`-is oma emoji — tarkusepäeval koolikott,
mardipäeval mask, jõuludel kuusk. Emoji on andmetes, mitte koodis, seega selle
muutmiseks ei pea koodi puutuma. Test kontrollib, et ükski kirje ei jääks
emojita.

Nimepäevad on [Statistikaameti kalendrist](https://www.stat.ee/nimed/NIMEPAEVAD),
366 päeva ja 1567 nime. Neid ei laadita iga deploy'ga: nimepäevad ei muutu,
seega `npm run nimepaevad` jooksutatakse käsitsi ja tulemus commititakse.

### Kus sait elab

Sait on [Cloudflare Pages'is](https://tunniplaan.pages.dev). Ehitus jääb aga
GitHub Actionsisse ja Cloudflare saab valmis kausta: Pages ehitab ainult tõuke
peale, aga selle rakenduse mõte on igaöine ajastatud uuendus. Nii jääb alles ka
kogu ülejäänud töövoog — testid, kraapimine, `bus/` genereerimine, versiooni
süstimine jaluses ja kontroll, et kõik viidatud failid on saidil olemas.

Töövoog vajab kahte repo saladust: `CLOUDFLARE_API_TOKEN` (õigusega
*Cloudflare Pages: Edit*) ja `CLOUDFLARE_ACCOUNT_ID`.

**Versioon** on kujul `1.0.N`, kus N on commitide arv — see kasvab täpselt siis,
kui midagi muutub, ja seda ei pea käsitsi meeles pidama. Töövoog kirjutab sama
numbri kahte kohta: jalusesse (näed telefonist, mis versioon käib) ja
`sw.js`-i vahemälu nimesse. Viimane on oluline: uus number kustutab vana
vahemälu, muidu serveerib teenusetöötleja vana `app.js`-i edasi ja parandused
ei jõua telefoni. Kohapeal jääb versiooniks `arendus` ja `dev`.

Aadressi vahetamine lähtestab salvestatud seaded — klass, rühmavalikud,
bussisuunad ja `tp.installSeen` (kas avakuvale lisamise juhendit on näidatud)
on `localStorage`-is, mis on seotud päritoluga.

### eKool ja ärajäänud tunnid

Teadlik otsus jätta praegusest versioonist välja. Tasuta GitHub Pages teenindab
ainult avalikke repositooriume — tunniplaan ise on niikuinii avalik, aga
tühistused on konkreetse lapse isikuandmed ega sobi avalikule aadressile.
Lisaks on eKool Cloudflare'i taga ja kasutab HarID-d; ID-kaardi, Mobiil-ID või
Smart-ID sisselogimist ei saa skriptiga automatiseerida.

Kui seda kunagi vaja läheb, on aus tee privaatne majutus (nt Cloudflare Pages +
Access, tasuta kuni 50 kasutajat). Paroole ei hoita kunagi repositooriumis.
