#!/usr/bin/env node
// MaxxTempo — builds the built-in databases in data/ from free, openly licensed sources.
//
//   npm i --no-save xlsx@0.18.5    (only needed for INDB)
//   node tools/build-data.mjs [cache-dir]
//
// Downloads (or reuses from cache-dir) and writes:
//   data/ex-free.json   free-exercise-db (public domain)             github.com/yuhonas/free-exercise-db
//   data/ex-wger.json   wger exercises (CC-BY-SA, per exercise)       wger.de
//   data/ex-edb.json    ExerciseDB free version (non-commercial, credit) oss.exercisedb.dev
//   data/indb.json      Indian Nutrient Databank recipes (CC BY 4.0) github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-
//   data/usda.json      USDA FoodData Central SR Legacy (CC0)         fdc.nal.usda.gov
//   data/activities.json 2024 Adult Compendium of Physical Activities (free, cite) pacompendium.com
// Every file records its source, licence and credit; see DATA-LICENSES.md.
// Nothing here needs an API key or costs money.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data');
const CACHE = path.resolve(process.argv[2] || path.join(ROOT, '.data-cache'));
await mkdir(OUT, { recursive: true }); await mkdir(CACHE, { recursive: true });
const exists = p => access(p).then(() => true, () => false);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cached(name, fetcher) {
  const p = path.join(CACHE, name);
  if (await exists(p)) return JSON.parse(await readFile(p, 'utf8'));
  const data = await fetcher(); await writeFile(p, JSON.stringify(data)); return data;
}
async function getJson(url, tries = 4) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'MaxxTempo data build (personal, non-commercial)' } });
    if (r.ok) return r.json();
    if (i >= tries) throw new Error(`${url} → ${r.status}`);
    await sleep(1500 * (i + 1));
  }
}
const write = async (name, obj) => { const s = JSON.stringify(obj); await writeFile(path.join(OUT, name), s); console.log(`  data/${name}  ${(s.length / 1024).toFixed(0)} KB  ${obj.items.length} items`); };
const tc = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const sentences = s => clean(s).split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(x => x.trim()).filter(x => x.length > 2).slice(0, 12);

// App helpers (single source of truth: app.js) for INDB aliases and units.
const appSrc = await readFile(path.join(ROOT, 'app.js'), 'utf8');
const grab = name => { const m = appSrc.match(new RegExp(`^const ${name} = [\\s\\S]*?;\\n`, 'm')); if (!m) throw new Error('app.js: ' + name); return m[0]; };
const helpers = new Function(grab('titleCase') + grab('UNIT_WORDS') + grab('normFood') + grab('singular') +
  appSrc.match(/^function indbAliases[\s\S]*?\n}\n/m)[0] + 'return {titleCase, UNIT_WORDS, normFood, indbAliases};')();

/* ---------- exercises ---------- */
console.log('Exercises');
// free-exercise-db
{
  const src = await cached('free-exercise-db.json', () => getJson('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'));
  const G = { abdominals: 'core', abductors: 'glutes', adductors: 'legs', biceps: 'biceps', calves: 'legs', chest: 'chest', forearms: 'biceps', glutes: 'glutes',
    hamstrings: 'legs', lats: 'back', 'lower back': 'back', 'middle back': 'back', neck: 'shoulders', quadriceps: 'legs', shoulders: 'shoulders', traps: 'back', triceps: 'triceps' };
  const items = src.map(e => ({
    n: e.name, g: e.category === 'cardio' ? 'cardio' : G[(e.primaryMuscles || [])[0]] || 'full body',
    k: e.category === 'cardio' ? 'c' : (!e.equipment || e.equipment === 'body only') ? 'b' : 'w',
    eq: e.equipment || null, mu: e.primaryMuscles || [], s: e.secondaryMuscles || [], lv: e.level || null, cat: e.category || null,
    i: (e.instructions || []).map(clean).filter(Boolean),
    img: e.images && e.images[0] ? 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/' + e.images[0] : null,
  }));
  await write('ex-free.json', { source: 'free-exercise-db', url: 'https://github.com/yuhonas/free-exercise-db', license: 'Public domain (Unlicense)',
    credit: 'Exercises from free-exercise-db (public domain).', items });
}
// wger
{
  const all = await cached('wger.json', async () => {
    const out = []; let url = 'https://wger.de/api/v2/exerciseinfo/?limit=100';
    while (url) { const d = await getJson(url); out.push(...d.results); url = d.next; await sleep(400); }
    return out;
  });
  const cat = { Abs: 'core', Back: 'back', Calves: 'legs', Cardio: 'cardio', Chest: 'chest', Legs: 'legs', Shoulders: 'shoulders' };
  const items = [];
  for (const e of all) {
    const en = (e.translations || []).find(t => t.language === 2); if (!en || !en.name) continue;
    const mus = (e.muscles || []).map(m => m.name_en || m.name);
    let g = cat[e.category?.name];
    if (e.category?.name === 'Arms') g = mus.some(m => /triceps/i.test(m)) ? 'triceps' : 'biceps';
    if (g === 'legs' && /glute/i.test(mus[0] || '')) g = 'glutes';
    const eq = (e.equipment || []).map(x => x.name);
    const img = (e.images || []).find(i => i.is_main) || (e.images || [])[0];
    items.push({ n: tc(en.name), g: g || 'full body', k: g === 'cardio' ? 'c' : (!eq.length || eq.every(x => /none|bodyweight|mat/i.test(x))) ? 'b' : 'w',
      eq: eq.join(', ') || null, mu: mus, s: (e.muscles_secondary || []).map(m => m.name_en || m.name), i: sentences(en.description),
      img: img ? img.image : null, lic: e.license?.short_name || 'CC-BY-SA', by: e.license_author || 'wger.de' });
  }
  await write('ex-wger.json', { source: 'wger', url: 'https://wger.de', license: 'CC-BY-SA (licence and author per exercise)',
    credit: 'Exercises from wger.de, CC-BY-SA; authors listed per exercise.', items });
}
// ExerciseDB (free version)
{
  const all = await cached('exercisedb.json', async () => {
    const out = []; let cursor = null;
    do {
      const d = await getJson('https://oss.exercisedb.dev/api/v1/exercises?limit=100' + (cursor ? '&after=' + cursor : ''));
      out.push(...d.data); cursor = d.meta && d.meta.hasNextPage ? d.meta.nextCursor : null; await sleep(800);
    } while (cursor);
    return out;
  });
  const T = { biceps: 'biceps', forearms: 'biceps', triceps: 'triceps', glutes: 'glutes', abductors: 'glutes', abs: 'core', 'serratus anterior': 'core',
    lats: 'back', traps: 'back', 'upper back': 'back', spine: 'back', pectorals: 'chest', delts: 'shoulders', 'levator scapulae': 'shoulders',
    quads: 'legs', hamstrings: 'legs', calves: 'legs', adductors: 'legs', 'cardiovascular system': 'cardio' };
  const seen = new Set(); const items = [];
  for (const e of all) {
    if (seen.has(e.exerciseId)) continue; seen.add(e.exerciseId);
    const g = T[(e.targetMuscles || [])[0]] || ((e.bodyParts || [])[0] === 'cardio' ? 'cardio' : 'full body');
    items.push({ n: tc(e.name), g, k: g === 'cardio' ? 'c' : (e.equipments || []).every(x => x === 'body weight') ? 'b' : 'w',
      eq: (e.equipments || []).join(', ') || null, mu: e.targetMuscles || [], s: e.secondaryMuscles || [],
      i: (e.instructions || []).map(x => clean(x).replace(/^Step:\s*\d+\s*/i, '')).filter(Boolean), img: e.gifUrl || null });
  }
  await write('ex-edb.json', { source: 'ExerciseDB', url: 'https://oss.exercisedb.dev', license: 'ExerciseDB free version: non-commercial use with attribution',
    credit: 'Exercises and animations from ExerciseDB (free version, non-commercial).', items });
}

/* ---------- foods ---------- */
console.log('Foods');
// INDB
{
  const xlsxPath = path.join(CACHE, 'INDB.xlsx');
  if (!await exists(xlsxPath)) {
    const r = await fetch('https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/INDB.xlsx');
    if (!r.ok) throw new Error('INDB download ' + r.status); await writeFile(xlsxPath, Buffer.from(await r.arrayBuffer()));
  }
  const XLSX = createRequire(import.meta.url)('xlsx');
  const wb = XLSX.readFile(xlsxPath); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const { titleCase, UNIT_WORDS, normFood, indbAliases } = helpers;
  // Same conversion as the app's INDB import (app.js importIndb).
  const v = (r, k) => { const x = Number(r[k]); return Number.isFinite(x) && x > 0 ? x : 0; }; const rd = x => Math.round(x * 100) / 100;
  const items = [];
  for (const r of rows) {
    const name = String(r.food_name || '').trim(); const kcal = v(r, 'energy_kcal'); if (!name || !kcal) continue;
    const servKcal = v(r, 'unit_serving_energy_kcal'); const servG = servKcal ? Math.round(servKcal / kcal * 100) : 0;
    const unitWord = UNIT_WORDS[normFood(r.servings_unit || '').split(' ').pop()] || null;
    const units = servG > 0 && servG < 2000 ? { [unitWord && !['g', 'kg', 'ml', 'l'].includes(unitWord) ? unitWord : 'serving']: servG } : { serving: 100 };
    const d = v(r, 'vitd2_ug') + v(r, 'vitd3_ug');
    items.push([titleCase(name).slice(0, 70), indbAliases(name), units, rd(kcal), rd(v(r, 'protein_g')), rd(v(r, 'carb_g')), rd(v(r, 'fat_g')), rd(v(r, 'fibre_g')), rd(v(r, 'freesugar_g')),
      rd(v(r, 'sfa_mg') / 1000), rd(v(r, 'cholesterol_mg')), rd(v(r, 'sodium_mg')), rd(v(r, 'potassium_mg')), rd(v(r, 'calcium_mg')), rd(v(r, 'iron_mg')), rd(v(r, 'magnesium_mg')), rd(v(r, 'zinc_mg')),
      rd(v(r, 'vita_ug')), rd(v(r, 'vitc_mg')), rd(d), 0, rd(v(r, 'folate_ug')), 0]);
  }
  await write('indb.json', { source: 'Indian Nutrient Databank (INDB)', url: 'https://www.anuvaad.org.in/indian-nutrient-databank/', license: 'CC BY 4.0',
    credit: 'Indian recipes from the Indian Nutrient Databank (INDB), Vijayakumar et al. 2024, CC BY 4.0.', items });
}
// USDA SR Legacy
{
  const jsonPath = path.join(CACHE, 'sr_legacy.json');
  if (!await exists(jsonPath)) {
    const zip = path.join(CACHE, 'sr.zip');
    const r = await fetch('https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip');
    if (!r.ok) throw new Error('USDA download ' + r.status); await writeFile(zip, Buffer.from(await r.arrayBuffer()));
    execFileSync('unzip', ['-o', '-q', zip, '-d', CACHE]);
    execFileSync('sh', ['-c', `mv "${CACHE}"/FoodData_Central_sr_legacy_food_json_*.json "${jsonPath}"`]);
  }
  const foods = JSON.parse(await readFile(jsonPath, 'utf8')).SRLegacyFoods;
  const SKIP = /^(Baby Foods|American Indian\/Alaska Native Foods)$/;
  const N = { kcal: 1008, protein: 1003, fat: 1004, carbs: 1005, fiber: 1079, sugar: 2000, sat: 1258, chol: 1253, na: 1093, k: 1092, ca: 1087, fe: 1089, mg: 1090, zn: 1095,
    vita: 1106, vitc: 1162, vitd: 1114, b12: 1178, folate: 1190, ala: 1404, n183: 1270, epa: 1278, dha: 1272, dpa: 1280, alcohol: 1018 };
  const rd = x => Math.round((x || 0) * 100) / 100;
  const unitOf = m => { m = String(m || '').toLowerCase(); if (/\boz\b|ounce|\blb\b|\bfl\b/.test(m)) return null;
    if (/\bcup\b/.test(m)) return 'cup'; if (/\btbsp\b|tablespoon/.test(m)) return 'tbsp'; if (/\btsp\b|teaspoon/.test(m)) return 'tsp';
    if (/\bslice\b/.test(m)) return 'slice'; if (/\bmedium\b/.test(m)) return 'piece'; if (/\b(each|piece|large|small|fruit|egg|whole|item)\b/.test(m)) return 'piece';
    if (/\bserving\b/.test(m)) return 'serving'; return null; };
  const items = [];
  for (const f of foods) {
    if (SKIP.test(f.foodCategory?.description || '')) continue;
    const a = {}; for (const n of f.foodNutrients || []) if (n.nutrient && n.amount != null) a[n.nutrient.id] = n.amount;
    const kcal = a[N.kcal]; if (!(kcal > 0)) continue;
    const units = {};
    for (const p of f.foodPortions || []) { const u = unitOf(p.modifier || p.measureUnit?.name); if (!u || !(p.gramWeight > 0)) continue;
      const g = Math.round(p.gramWeight / (p.amount || 1)); if (!units[u] || (u === 'piece' && /medium/.test(p.modifier || ''))) units[u] = g; }
    const omega3 = (a[N.ala] ?? a[N.n183] ?? 0) + (a[N.epa] || 0) + (a[N.dha] || 0) + (a[N.dpa] || 0);
    items.push([f.description.slice(0, 110), f.foodCategory?.description || '', Object.keys(units).length ? units : { serving: 100 },
      rd(kcal), rd(a[N.protein]), rd(a[N.carbs]), rd(a[N.fat]), rd(a[N.fiber]), rd(a[N.sugar]),
      rd(a[N.sat]), rd(a[N.chol]), rd(a[N.na]), rd(a[N.k]), rd(a[N.ca]), rd(a[N.fe]), rd(a[N.mg]), rd(a[N.zn]),
      rd(a[N.vita]), rd(a[N.vitc]), rd(a[N.vitd]), rd(a[N.b12]), rd(a[N.folate]), rd(omega3), rd(a[N.alcohol])]);
  }
  await write('usda.json', { source: 'USDA FoodData Central, SR Legacy (April 2018)', url: 'https://fdc.nal.usda.gov', license: 'CC0 1.0 (public domain)',
    credit: 'Foods from USDA FoodData Central (SR Legacy), public domain.',
    columns: 'name, category, units, kcal, protein, carbs, fat, fibre, sugar, sat_fat_g, cholesterol_mg, sodium_mg, potassium_mg, calcium_mg, iron_mg, magnesium_mg, zinc_mg, vitamin_a_mcg, vitamin_c_mg, vitamin_d_mcg, vitamin_b12_mcg, folate_mcg, omega3_g, alcohol_g (per 100 g)',
    items });
}
/* ---------- sports and activities ---------- */
console.log('Activities');
// 2024 Adult Compendium of Physical Activities: one table per category page.
{
  const PAGES = ['sports', 'running', 'walking', 'bicycling', 'water-activities', 'conditioning-exercise', 'dancing', 'winter-activities'];
  const pages = await cached('compendium-2024.json', async () => {
    const out = {};
    for (const p of PAGES) {
      const r = await fetch(`https://pacompendium.com/${p}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (MaxxTempo data build)' } });
      if (!r.ok) throw new Error(`pacompendium.com/${p} → ${r.status}`);
      out[p] = await r.text(); await sleep(500);
    }
    return out;
  });
  const items = [];
  for (const p of PAGES) {
    for (const tr of pages[p].match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const c = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => clean(m[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))));
      if (c.length >= 3 && /^\d{5}$/.test(c[0]) && /^\d+(\.\d+)?$/.test(c[1])) items.push([c[0], +c[1], c[2], p]);
    }
  }
  if (items.length < 500) throw new Error('Compendium: only ' + items.length + ' rows');
  await write('activities.json', { source: '2024 Adult Compendium of Physical Activities', url: 'https://pacompendium.com',
    license: 'Free to use, including commercially; cite the Compendium',
    credit: 'Activity METs from the 2024 Adult Compendium of Physical Activities (Herrmann SD, Willis EA, Ainsworth BE, et al. J Sport Health Sci 2024;13:6–12).',
    columns: 'code, MET, description, category', items });
}
console.log('Done.');
