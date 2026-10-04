// Fetches TSE results (BR + 27 UFs) and updates the data block in index.html.
// - data changed  -> rewrites D and META (date/time of the cut) and the "last checked" stamp
// - data unchanged -> only touches META.chk (last checked)
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../index.html', import.meta.url);
const BASE = process.env.TSE_BASE ||
  'https://resultados.tse.jus.br/oficial/ele2026/6257/dados/{uf}/{uf}-c0001-e006257-u.json';
const UFS = ['br','ac','al','ap','am','ba','ce','df','es','go','ma','mt','ms','mg','pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','sp','se','to'];

const toInt = v => parseInt(String(v ?? '').replace(/\D/g, ''), 10);
const toPct = v => {
  let s = String(v ?? '').trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
};
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== '') return o[k]; };
const fail = (uf, j, what) => {
  throw new Error(`[${uf}] cannot find ${what} in TSE JSON. Top-level keys: ${Object.keys(j).join(', ')}`);
};

async function getJson(uf) {
  const url = BASE.replaceAll('{uf}', uf);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; brazil-elections-bot)', accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === 2) throw new Error(`[${uf}] ${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// TSE layout: s{ts,st,pst,pstn}, carg[0].agr[].par[].cand[]{n,vap,pvap,pvapn}; values are strings, decimal comma.
function parse(uf, j, names) {
  const sec = j.s;
  if (!sec || typeof sec !== 'object') fail(uf, j, 's{}');
  const pst = Math.round(toPct(pick(sec, 'pstn', 'pst')) * 1000) / 1000;
  const st = toInt(sec.st);
  const ts = toInt(sec.ts);
  const car = Array.isArray(j.carg) ? j.carg[0] : null;
  const cand = car && Array.isArray(car.agr) ? car.agr.flatMap(a => (a.par || []).flatMap(p => p.cand || [])) : [];
  if ([pst, st, ts].some(Number.isNaN)) fail(uf, j, 's.pst/st/ts');
  if (!cand.length) fail(uf, j, 'carg[0].agr[].par[].cand[]');
  const c = cand.map(x => [String(x.n), toInt(x.vap), Math.round(toPct(pick(x, 'pvapn', 'pvap')) * 1000) / 1000]);
  if (c.some(x => !x[0] || Number.isNaN(x[1]) || Number.isNaN(x[2]))) fail(uf, j, 'cand n/vap/pvap');
  c.sort((a, b) => b[1] - a[1]);
  return {
    name: uf === 'br' ? 'Brasil' : names[uf.toUpperCase()],
    pst, st, ts, c,
    dg: pick(j, 'dg'), hg: String(pick(j, 'hg') ?? '').slice(0, 5),
  };
}

const html = readFileSync(FILE, 'utf8');
const m = html.match(/\/\*DATA:START\*\/\nconst D = (.*);\nconst C = (.*);\nconst MAP = .*\nconst META = (.*);\n\/\*DATA:END\*\//);
if (!m) throw new Error('DATA:START/END block not found in index.html');
const [block, oldDraw, cRaw, metaRaw] = m;
const oldD = JSON.parse(oldDraw), C = JSON.parse(cRaw), meta = JSON.parse(metaRaw);
const names = Object.fromEntries(Object.entries(oldD).map(([k, v]) => [k, v.name]));

const results = await Promise.all(UFS.map(async uf => [uf, parse(uf, await getJson(uf), names)]));
const D = {};
const times = [];
let dg = meta.dg, hbr = meta.hbr;
for (const [uf, r] of results) {
  for (const x of r.c) if (!C[x[0]]) throw new Error(`[${uf}] candidate number ${x[0]} is not in C`);
  const key = uf.toUpperCase();
  D[key] = { name: r.name, pst: r.pst, st: r.st, ts: r.ts, c: r.c };
  if (uf === 'br') { dg = r.dg || dg; hbr = r.hg || hbr; } else if (r.hg) times.push(r.hg);
}
times.sort();

const changed = JSON.stringify(D) !== JSON.stringify(oldD);
const newMeta = { ...meta, chk: new Date().toISOString() };
if (changed) Object.assign(newMeta, { dg, hbr, hmin: times[0] || meta.hmin, hmax: times.at(-1) || meta.hmax });

// Re-emit the original text for D when unchanged so the diff is a single line.
const newBlock = block
  .replace(oldDraw, () => changed ? JSON.stringify(D) : oldDraw)
  .replace(metaRaw, () => JSON.stringify(newMeta).replace(/":/g, '": ').replace(/,"/g, ', "'));
writeFileSync(FILE, html.replace(block, () => newBlock));
console.log(changed ? `Data changed: BR ${D.BR.pst}% apuradas (corte ${newMeta.hbr})` : 'No data change; updated last-checked only');
