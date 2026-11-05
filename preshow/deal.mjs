// Deals the running order of every show from the local question bank, and writes it back into the bank's "sets".
//   node deal.mjs <questions.json> [seed]
//
// On screen each round has two spins: the wheel lands on a subject, then a second spinner lands on a difficulty
// (easy, medium or hard: the harder, the more points). This script is where both are actually drawn:
//   - subjects: every wheel category gets a turn before any comes round again, never the same one twice running;
//   - difficulty: drawn at random for each round. Early rounds lean easy and late rounds lean hard, and the last
//     round is always hard, so most of the points are still to play for when latecomers sit down;
//   - question: drawn at random from the bank's questions of that subject and difficulty.
// The draw is made here, ahead of the show, and not at launch, so the questions that will play can be read and
// checked first. Run it again for a fresh draw; pass the seed it prints to get the same draw back.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const file = process.argv[2];
if (!file) { console.error('usage: node deal.mjs <questions.json> [seed]'); process.exit(1); }
const b = JSON.parse(readFileSync(file, 'utf8'));
const cfg = Object.assign({ open: '', rounds: { 10: 16, 15: 25, test: 3 }, always: [] }, b.deal || {});
const seed = process.argv[3] !== undefined ? Number(process.argv[3]) >>> 0 : randomBytes(4).readUInt32LE(0);
if (process.argv[3] !== undefined && !/^\d+$/.test(process.argv[3])) { console.error('the seed must be a whole number'); process.exit(1); }

// a small seeded generator (mulberry32), so a draw can be repeated from its seed
let s = seed;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = list => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const weighted = w => { let r = rnd() * w.reduce((x, y) => x + y, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return w.length - 1; };

const byId = new Map(b.bank.map(q => [q.id, q]));
const cats = Object.keys(b.categories);
const open = cfg.open && byId.get(cfg.open) ? byId.get(cfg.open) : null;
const POINTS = { 1: 100, 2: 300, 3: 500 }, NAMES = { 1: 'easy', 2: 'medium', 3: 'hard' };

/* The subjects of an n-round show: passes through the wheel, each in a fresh random order, so every category gets a
   turn before any comes round again. The opening question, if one is set, fixes the first subject. A pass that is
   cut short (a short show, or the last few rounds of a long one) takes the categories in cfg.always first. */
function subjects(n) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const out = [];
    while (out.length < n) {
      const first = !out.length && open ? [open.cat] : [];
      let pass = first.concat(shuffle(cats.filter(c => !first.includes(c))));
      const need = n - out.length;
      if (need < pass.length) {
        const must = cfg.always.filter(c => cats.includes(c) && !first.includes(c));
        const rest = pass.filter(c => !first.includes(c) && !must.includes(c));
        pass = first.concat(shuffle(must.concat(rest).slice(0, Math.max(0, need - first.length))));
      }
      out.push(...pass);
    }
    if (out.every((c, i) => !out.slice(Math.max(0, i - 4), i).includes(c))) return out.slice(0, n);   // never back within four rounds
  }
  throw new Error('could not order the subjects for ' + n + ' rounds');
}

/* Difficulty, round by round. p runs from 0 (first round) to 1 (last): easy fades out as hard fades in. */
function difficulties(subs, pool) {
  const n = subs.length, least = Math.max(1, Math.floor(n / 4));
  for (let attempt = 0; attempt < 20000; attempt++) {
    const out = [], left = new Map();
    const stock = (c, d) => { const k = c + d; if (!left.has(k)) left.set(k, pool.filter(q => q.cat === c && q.d === d).length); return left.get(k); };
    let fail = false;
    for (let i = 0; i < n && !fail; i++) {
      const c = subs[i], p = n > 1 ? i / (n - 1) : 1;
      let d;
      if (i === 0 && open) d = open.d;
      else {
        const w = [1.3 - 1.25 * p, 0.8, 0.05 + 1.4 * p].map((x, k) => (stock(c, k + 1) > 0 ? Math.max(0, x) : 0));
        if (i === n - 1 && n > 1) { w[0] = 0; w[1] = 0; }               // the finale is hard
        else if (i === n - 2 && n > 3) w[0] = 0;                        // and the round before it is not easy
        if (!w.some(x => x > 0)) { fail = true; break; }
        d = weighted(w) + 1;
      }
      left.set(c + d, stock(c, d) - 1);
      out.push(d);
    }
    if (fail) continue;
    const count = d => out.filter(x => x === d).length;
    if ([1, 2, 3].some(d => count(d) < least)) continue;               // a real mix of all three
    if (out.some((d, i) => i >= 3 && out[i - 1] === d && out[i - 2] === d && out[i - 3] === d)) continue;   // no four alike in a row
    const half = Math.floor(n / 2), worth = a => a.reduce((x, d) => x + POINTS[d], 0);
    if (n >= 6 && worth(out.slice(half)) < 1.5 * worth(out.slice(0, half))) continue;   // the second half is worth at least half as much again
    return out;
  }
  throw new Error('could not draw the difficulties for ' + n + ' rounds');
}

const dealt = {}, played = [];                                          // questions already in a show are reused first: fewer to check
for (const [name, n] of Object.entries(cfg.rounds)) {
  const subs = subjects(n), pool = b.bank.filter(q => !q.skip), diffs = difficulties(subs, pool);
  const ids = [];
  subs.forEach((c, i) => {
    let q = i === 0 && open ? open : null;
    const fits = pool.filter(x => x.cat === c && x.d === diffs[i] && !ids.includes(x.id) && (!open || x.id !== open.id));
    if (!q) q = fits.find(x => played.includes(x.id)) || fits[Math.floor(rnd() * fits.length)];
    if (!q) throw new Error('no ' + NAMES[diffs[i]] + ' question left for ' + c + ' (set ' + name + ', round ' + (i + 1) + ')');
    ids.push(q.id);
  });
  dealt[name] = ids;
  for (const id of ids) if (!played.includes(id)) played.push(id);
}

b.sets = dealt;
b.deal = Object.assign({}, cfg, { seed, dealt: new Date().toISOString().slice(0, 16).replace('T', ' ') });
writeFileSync(file, JSON.stringify(b, null, 1));

console.log('seed ' + seed);
for (const [name, ids] of Object.entries(dealt)) {
  const ds = ids.map(id => byId.get(id).d), half = Math.floor(ids.length / 2);
  const sum = a => a.reduce((x, d) => x + POINTS[d], 0);
  console.log('\nset ' + name + ': ' + ids.length + ' rounds, ' + [1, 2, 3].map(d => ds.filter(x => x === d).length + ' ' + NAMES[d]).join(', ')
    + '. Base points: ' + sum(ds.slice(0, half)) + ' in the first half, ' + sum(ds.slice(half)) + ' in the second.');
  ids.forEach((id, i) => { const q = byId.get(id); console.log('  ' + String(i + 1).padStart(2) + '  ' + String(POINTS[q.d]).padStart(3) + '  ' + b.categories[q.cat].name.padEnd(22) + id); });
}
