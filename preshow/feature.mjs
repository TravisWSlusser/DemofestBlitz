// Works requested material into the running orders that deal.mjs dealt, without moving anything else.
//   node feature.mjs <questions.json> [seed]
//
// The bank's "deal.feature" says what to work in:
//   films: question id prefixes (one per film), and per: how many questions of each film every set should carry;
//   cat / catPer: a wheel category that must come up, and how many rounds of it per set;
//   first: questions of that category to use before any other, in order of preference;
//   groups: questions of that category that are about the same thing, so one set never asks two of them.
// A film question only ever replaces a question of the same subject and the same difficulty, so the order of
// subjects and the points on offer in every round stay exactly as dealt. A round given to the category keeps its
// difficulty and changes subject. Run it again after every deal.mjs; a second run on the same sets changes nothing.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const file = process.argv[2];
if (!file) { console.error('usage: node feature.mjs <questions.json> [seed]'); process.exit(1); }
const b = JSON.parse(readFileSync(file, 'utf8'));
const f = (b.deal || {}).feature;
if (!f) { console.error('nothing to do: the bank has no deal.feature'); process.exit(1); }
const seed = process.argv[3] !== undefined ? Number(process.argv[3]) >>> 0 : randomBytes(4).readUInt32LE(0);

let s = seed;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = list => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const byId = new Map(b.bank.map(q => [q.id, q]));
const prefix = id => id.replace(/\d+$/, '');
const films = f.films || [], groups = f.groups || {}, always = (b.deal.always || []).filter(c => c !== f.cat);
const played = new Set();                                               // featured questions already in an earlier set come first: fewer to check
const report = [];

for (const [name, was] of Object.entries(b.sets)) {
  const perFilm = (f.per || {})[name] || 0, perCat = f.cat ? (f.catPer || {})[name] || 0 : 0;
  if (!perFilm && !perCat) continue;
  let done = null;
  for (let attempt = 0; attempt < 4000 && !done; attempt++) {
    const ids = was.slice(), taken = new Set(), changes = [];
    if (b.deal.open && ids[0] === b.deal.open) taken.add(0);            // the opening question stays
    ids.forEach((id, i) => { if (films.includes(prefix(id)) || byId.get(id).cat === f.cat) taken.add(i); });
    const pick = list => { const first = list.filter(x => played.has(x.q.id)); const from = first.length ? first : list; return from[Math.floor(rnd() * from.length)]; };
    let ok = true;

    for (const film of shuffle(films)) {
      let need = perFilm - ids.filter(id => prefix(id) === film).length;
      while (need-- > 0 && ok) {
        const fits = [];
        ids.forEach((id, i) => {
          if (taken.has(i)) return;
          const at = byId.get(id);
          for (const q of b.bank) if (prefix(q.id) === film && !q.skip && q.cat === at.cat && q.d === at.d && !ids.includes(q.id)) fits.push({ i, q });
        });
        if (!fits.length) { ok = false; break; }
        const c = pick(fits);
        changes.push({ round: c.i + 1, from: ids[c.i], to: c.q.id }); ids[c.i] = c.q.id; taken.add(c.i);
      }
      if (!ok) break;
    }

    let need = perCat - ids.filter(id => byId.get(id).cat === f.cat).length;
    while (ok && need-- > 0) {
      const cats = ids.map(id => byId.get(id).cat), usedGroups = new Set(ids.map(id => groups[id]).filter(Boolean));
      const near = i => cats.some((c, j) => c === f.cat && Math.abs(j - i) <= 4);
      const rounds = ids.map((id, i) => i).filter(i => i > 0 && !taken.has(i) && !always.includes(cats[i]) && !near(i));
      const fits = [];
      for (const i of rounds) for (const q of b.bank) {
        if (q.cat === f.cat && !q.skip && q.d === byId.get(ids[i]).d && !ids.includes(q.id) && !(groups[q.id] && usedGroups.has(groups[q.id]))) fits.push({ i, q });
      }
      if (!fits.length) { ok = false; break; }
      let from = fits;
      for (const id of f.first || []) { const m = fits.filter(x => x.q.id === id); if (m.length) { from = m; break; } }   // the questions asked for by name
      const twice = from.filter(x => cats.filter(c => c === cats[x.i]).length > 1);     // give up a subject that comes round twice, if one does
      if (twice.length) from = twice;
      const c = from[Math.floor(rnd() * from.length)];
      changes.push({ round: c.i + 1, from: ids[c.i], to: c.q.id }); ids[c.i] = c.q.id; taken.add(c.i);
    }
    if (ok) done = { ids, changes };
  }
  if (!done) throw new Error('could not work the featured questions into set ' + name);
  b.sets[name] = done.ids;
  for (const id of done.ids) if (films.includes(prefix(id)) || byId.get(id).cat === f.cat) played.add(id);
  report.push({ name, changes: done.changes.sort((x, y) => x.round - y.round) });
}

writeFileSync(file, JSON.stringify(b, null, 1));
console.log('seed ' + seed);
for (const r of report) {
  console.log('\nset ' + r.name + ': ' + (r.changes.length ? r.changes.length + ' rounds changed' : 'nothing to change'));
  for (const c of r.changes) { const q = byId.get(c.to); console.log('  round ' + String(c.round).padStart(2) + '  ' + c.from.padEnd(6) + '-> ' + c.to.padEnd(6) + b.categories[q.cat].name + ', ' + ['', 'easy', 'medium', 'hard'][q.d]); }
}
