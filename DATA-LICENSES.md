# Built-in data: sources and licences

MaxxTempo's code is separate from the data below. Each file in `data/` comes from one free, openly licensed source and keeps that source's licence. None needs an API key or payment. Rebuild them with `node tools/build-data.mjs` (see the top of that file).

| File | Source | Licence | What the licence asks |
|---|---|---|---|
| `data/ex-free.json` | [free-exercise-db](https://github.com/yuhonas/free-exercise-db) | Public domain (Unlicense) | Nothing |
| `data/ex-wger.json` | [wger.de](https://wger.de) exercise database | CC-BY-SA 3.0/4.0, licence and author stored per exercise | Credit the authors; changes to this data file stay under CC-BY-SA |
| `data/ex-edb.json` | [ExerciseDB free version](https://oss.exercisedb.dev) | Free for non-commercial use with attribution | Credit ExerciseDB; don't use it commercially. Animations are loaded from ExerciseDB's own site |
| `data/indb.json` | [Indian Nutrient Databank (INDB)](https://www.anuvaad.org.in/indian-nutrient-databank/), Vijayakumar et al., *Current Developments in Nutrition* 2024 | CC BY 4.0 | Credit INDB |
| `data/usda.json` | [USDA FoodData Central](https://fdc.nal.usda.gov), SR Legacy (April 2018) | CC0 1.0 (public domain) | Nothing (citation appreciated) |
| barcode lookups (live, not stored here) | [Open Food Facts](https://world.openfoodfacts.org) | Database ODbL, contents DbCL | Credit Open Food Facts with a link; a food saved to your own list is your copy |
| barcode reader (loaded from jsDelivr) | [ZXing for the browser](https://github.com/zxing-js/browser) | Apache-2.0 | Nothing extra |

The app shows these credits in Profile → Settings → Data sources, and next to exercise instructions and scanned products.

If the project ever becomes commercial, `data/ex-edb.json` has to be removed (its licence is non-commercial); everything else can stay.
