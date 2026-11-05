// Builds the question review sheet (a plain HTML page) from the local question bank.
//   node make-vet-sheet.mjs <questions.json> <output.html>
// The sheet shows every answer, so it stays on the laptop like the bank itself.
import { readFileSync, writeFileSync } from 'node:fs';
const b = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PTS = { 1: '100', 2: '300', 3: '500' }, L = ['A', 'B', 'C', 'D'];
const whole = u => /\/wikipedia\/en\/|\.svg\.png$/i.test(u);          // posters, covers and logos are shown whole, as on the big screen
const pic = q => q.img ? `<img${whole(q.img) ? ' class="fit"' : ''} src="${esc(q.img)}" alt="" loading="lazy"><small>${esc(q.credit || '')}</small>` : '';
const rounds = (b.deal && b.deal.rounds) || {};
let rows = '';
for (const [key, cat] of Object.entries(b.categories)) {
  const qs = b.bank.filter(q => q.cat === key);
  rows += `<h2>${esc(cat.name)} <small>${qs.length} questions: ${[1, 2, 3].map(d => qs.filter(q => q.d === d).length + ' at ' + PTS[d]).join(', ')}</small></h2>\n<table>\n<tr><th>ID</th><th>Pts</th><th>Question and answers</th><th>Fact shown with the answer</th><th>Picture</th></tr>\n`;
  for (const q of qs) {
    rows += `<tr${q.skip ? ' class="off"' : ''}><td class="id">${esc(q.id)}${q.skip ? '<br>off' : ''}</td><td class="pts d${q.d}">${PTS[q.d]}</td><td><div class="q">${esc(q.q)}</div><ol>${q.a.map((a, i) => `<li class="${i === q.ok ? 'ok' : ''}"><b>${L[i]}</b> ${esc(a)}${i === q.ok ? ' ✓' : ''}</li>`).join('')}</ol></td><td class="fact">${esc(q.fact || '')}</td><td class="pic">${pic(q)}</td></tr>\n`;
  }
  rows += '</table>\n';
}
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pre-Show Questions to Vet</title>
<style>
body{font:15px/1.45 "Segoe UI",system-ui,sans-serif;color:#16201f;background:#f6f8f7;margin:0 auto;padding:28px 34px 60px;max-width:1180px}
h1{font-size:28px;margin:0 0 6px}h2{font-size:19px;margin:34px 0 10px;border-bottom:2px solid #00B050;padding-bottom:6px}small{font-weight:400;color:#5a6a67;font-size:13px;margin-left:8px}
p{margin:6px 0 10px;max-width:80ch}.note{background:#fff;border-left:4px solid #00B050;padding:12px 16px;margin:16px 0}
table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #d6dedb;padding:8px 10px;vertical-align:top;text-align:left}th{background:#e8efec;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.id{font-family:Consolas,monospace;font-size:13px;white-space:nowrap;color:#33514b}.pts{font-weight:700;white-space:nowrap}.d1{color:#4d7c0f}.d2{color:#b45309}.d3{color:#b91c1c}
.q{font-weight:600;margin-bottom:4px}ol{margin:0;padding:0;list-style:none}td ol li{padding:1px 0;color:#4a5856}td ol li.ok{color:#0a6b36;font-weight:700}td ol li b{display:inline-block;width:1.3em;color:#00a047}
.fact{color:#3d4a48;width:26%}tr.off{opacity:.45}
.pic{width:150px}.pic img{display:block;width:140px;height:144px;object-fit:cover;object-position:50% 22%}.pic img.fit{object-fit:contain;object-position:50% 50%}.pic small{display:block;margin:4px 0 0;font-size:10px;line-height:1.2}
@media print{body{background:#fff;padding:0}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>Pre-Show Questions to Vet</h1>
<p>${b.bank.length} questions in the bank, in ${Object.keys(b.categories).length} subjects. ${b.bank.filter(q => q.img).length} have a picture.</p>
<div class="note"><p><b>Nothing is chosen ahead of time.</b> Every launch draws its own questions from this whole bank: ${rounds['10'] || 16} for the 10-minute show, ${rounds['15'] || 25} for the 15-minute show. Any question here can come up${b.deal && b.deal.open ? `, and <span class="id">${esc(b.deal.open)}</span> always opens the show` : ''}. After a run, the launcher's log (last-run.log, next to the launcher) lists the questions that were drawn.</p>
<p><b>How a show is drawn.</b> Each round has two spins: the wheel lands on a subject (a theme, never the name of the film or show), then a second spinner lands on the difficulty. Every subject gets a turn before any comes round again. The difficulty is drawn at random, leaning easy early and hard late, and the last round is always hard, so someone who sits down halfway can still catch up. Then a question of that subject and difficulty is drawn.</p>
<p><b>How to read this.</b> The right answer is green with a tick. Points are the difficulty: 100 easy, 300 medium, 500 hard, and a fast answer can earn up to double. Quote Unquote rounds show only the line and ask where it is from.</p>
<p><b>Pictures.</b> A question with a picture shows it beside the answers when the answer is revealed, cropped as you see it here. Photographs of real people, places and things are freely licensed pictures from Wikipedia. Posters, covers and logos (credited "Via Wikipedia") are copyrighted, and Wikipedia shows them under fair use. Showing one for a few seconds in a talk is common practice, but it is your call: say "no posters" to drop them.</p>
<p><b>How to change anything.</b> Tell Claude the ID and what you want, for example "bt4: wrong, cut it", "gm6: switch it off", "ad6: no picture", or "add a Hersheypark question about ...". A question that is switched off stays in the bank and is never drawn. This sheet is a snapshot: it is rebuilt whenever the bank changes.</p>
<p><b>Check before the show.</b> Every question was written from memory, not looked up, and any of them can now come up. Question <span class="id">bt3</span> says "Today is November 5" and only works on that date.</p></div>
${rows}
</body></html>`;
writeFileSync(process.argv[3], html);
console.log('written ' + html.length + ' bytes, ' + b.bank.length + ' questions');
