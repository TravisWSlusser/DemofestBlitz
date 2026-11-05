// Builds the question review sheet (a plain HTML page) from the local question bank.
//   node make-vet-sheet.mjs <questions.json> <output.html>
// The sheet shows every answer, so it stays on the laptop like the bank itself.
import { readFileSync, writeFileSync } from 'node:fs';
const b = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const in10 = new Map(b.sets['10'].map((id, i) => [id, i + 1])), in15 = new Map(b.sets['15'].map((id, i) => [id, i + 1]));
const PTS = { 1: '100', 2: '200', 3: '300' }, L = ['A', 'B', 'C', 'D'];
let rows = '';
for (const [key, cat] of Object.entries(b.categories)) {
  const qs = b.bank.filter(q => q.cat === key);
  rows += `<h2>${esc(cat.name)} <small>${qs.length} questions</small></h2>\n<table>\n<tr><th>ID</th><th>Pts</th><th>Question and answers</th><th>Fact shown with the answer</th><th>Plays in</th></tr>\n`;
  for (const q of qs) {
    const where = [in10.has(q.id) ? '10-min, round ' + in10.get(q.id) : '', in15.has(q.id) ? '15-min, round ' + in15.get(q.id) : ''].filter(Boolean).join('<br>') || '<span class="spare">spare</span>';
    rows += `<tr><td class="id">${esc(q.id)}</td><td class="pts d${q.d}">${PTS[q.d]}</td><td><div class="q">${esc(q.q)}</div><ol>${q.a.map((a, i) => `<li class="${i === q.ok ? 'ok' : ''}"><b>${L[i]}</b> ${esc(a)}${i === q.ok ? ' ✓' : ''}</li>`).join('')}</ol></td><td class="fact">${esc(q.fact || '')}</td><td class="where">${where}</td></tr>\n`;
  }
  rows += '</table>\n';
}
const order = (name, ids) => `<h2>The ${name} set, in playing order <small>${ids.length} rounds</small></h2><ol class="order">${ids.map(id => { const q = b.bank.find(x => x.id === id); return `<li><span class="id">${esc(id)}</span> <span class="pts d${q.d}">${PTS[q.d]}</span> <i>${esc(b.categories[q.cat].name)}</i> ${esc(q.q)}</li>`; }).join('')}</ol>`;
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pre-Show Questions to Vet</title>
<style>
body{font:15px/1.45 "Segoe UI",system-ui,sans-serif;color:#16201f;background:#f6f8f7;margin:0 auto;padding:28px 34px 60px;max-width:1180px}
h1{font-size:28px;margin:0 0 6px}h2{font-size:19px;margin:34px 0 10px;border-bottom:2px solid #00B050;padding-bottom:6px}small{font-weight:400;color:#5a6a67;font-size:13px;margin-left:8px}
p{margin:6px 0 10px;max-width:80ch}.note{background:#fff;border-left:4px solid #00B050;padding:12px 16px;margin:16px 0}
table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #d6dedb;padding:8px 10px;vertical-align:top;text-align:left}th{background:#e8efec;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.id{font-family:Consolas,monospace;font-size:13px;white-space:nowrap;color:#33514b}.pts{font-weight:700;white-space:nowrap}.d1{color:#4d7c0f}.d2{color:#b45309}.d3{color:#b91c1c}
.q{font-weight:600;margin-bottom:4px}ol{margin:0;padding:0;list-style:none}td ol li{padding:1px 0;color:#4a5856}td ol li.ok{color:#0a6b36;font-weight:700}td ol li b{display:inline-block;width:1.3em;color:#00a047}
.fact{color:#3d4a48;width:26%}.where{font-size:13px;white-space:nowrap;width:12%}.spare{color:#8a9794}
.order li{padding:3px 0}.order i{color:#33514b;font-style:normal;font-weight:600;margin:0 6px}
@media print{body{background:#fff;padding:0}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>Pre-Show Questions to Vet</h1>
<p>${b.bank.length} questions in the bank. The 10-minute show plays ${b.sets['10'].length} of them and the 15-minute show plays ${b.sets['15'].length}. The rest are spares.</p>
<div class="note"><p><b>How to read this.</b> The right answer is green with a tick. Points are the difficulty: 100 warm-up, 200 fan favourite, 300 deep cut, and a fast answer can earn up to double. "Where's That Line From?" questions show only the quote on screen; the wheel calls that category by name so the source stays hidden.</p>
<p><b>How to change anything.</b> Tell Claude the ID and what you want, for example "bt4: wrong, cut it", "swap gm6 into the 10-minute set for mk2", or "add a Hersheypark question about ...". This sheet is a snapshot: it is rebuilt whenever the bank changes.</p>
<p><b>Check before the show.</b> Every question was written from memory, not looked up. Please read each one that plays, and anything you would be embarrassed to get wrong in front of the room. Question <span class="id">bt3</span> says "Today is November 5" and only works on that date.</p></div>
${order('10-minute', b.sets['10'])}
${order('15-minute', b.sets['15'])}
${rows}
</body></html>`;
writeFileSync(process.argv[3], html);
console.log('written ' + html.length + ' bytes, ' + b.bank.length + ' questions');
