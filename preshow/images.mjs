// Finds a picture for the reveal of every question in the local bank that names a Wikipedia article in "pic".
//   node images.mjs <questions.json> [--again]
//
// Only freely licensed pictures are taken (Wikipedia is asked for those alone), so real people, places and things
// usually have one and film or cartoon characters usually do not: stills and posters are copyrighted. The address
// of a 500-pixel version on Wikimedia's image server is written into the question as "img", with the photographer
// and licence as "credit", which the big screen prints small under the picture. Nothing is downloaded or stored:
// the big screen loads the picture from Wikimedia at the reveal. --again looks every picture up afresh.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2], again = process.argv.includes('--again');
if (!file) { console.error('usage: node images.mjs <questions.json> [--again]'); process.exit(1); }
const b = JSON.parse(readFileSync(file, 'utf8'));
const UA = { 'User-Agent': 'PreShowTrivia/1.0 (https://demofest-blitz.vercel.app; conference pre-show quiz)' };
const api = async params => {
  const r = await fetch('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', ...params }), { headers: UA });
  if (!r.ok) throw new Error('Wikipedia answered ' + r.status);
  return r.json();
};
const plain = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const ascii = s => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
const OK = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/[\w\-.~%()!,*'\/]+\.(?:jpe?g|png|webp)$/i;   // the same rule as the server's

let found = 0, kept = 0, none = [];
for (const q of b.bank) {
  if (!q.pic) { if (q.img) { delete q.img; delete q.credit; } continue; }
  if (q.img && !again) { kept++; continue; }
  delete q.img; delete q.credit;
  try {
    const page = (await api({ titles: q.pic, prop: 'pageimages', piprop: 'thumbnail|name', pithumbsize: '500', pilicense: 'free' })).query.pages[0];
    const src = page && page.thumbnail && page.thumbnail.source && page.thumbnail.source.split('?')[0];   // without the tracking tail
    if (!src || !OK.test(src)) { none.push(q.id + ' (' + q.pic + '): no free picture'); continue; }
    const head = await fetch(src, { headers: UA });
    if (!head.ok || !/^image\//.test(head.headers.get('content-type') || '')) { none.push(q.id + ' (' + q.pic + '): the picture did not load, ' + head.status); continue; }
    const info = (await api({ titles: 'File:' + page.pageimage, prop: 'imageinfo', iiprop: 'extmetadata' })).query.pages[0];
    const meta = (info && info.imageinfo && info.imageinfo[0] && info.imageinfo[0].extmetadata) || {};
    let who = ascii(plain(meta.Artist && meta.Artist.value)).replace(/^The original uploader was /i, '').replace(/\s+(?:at|on|on the) \w+ Wikipedia\b.*$/i, '')
      .replace(/\s+at https?:\S+.*$/i, '').replace(/\s+from [A-Z][^/]*$/, '').replace(/\s*\(.*$/, '').trim();
    const half = who.split(' / '); if (half.length === 2 && half[0] === half[1]) who = half[0];
    who = who.slice(0, 44).trim();
    const lic = ascii(plain(meta.LicenseShortName && meta.LicenseShortName.value)).slice(0, 30);
    q.img = src;
    q.credit = [who, 'Wikimedia Commons', lic].filter(Boolean).join(' / ');
    found++;
    console.log(q.id.padEnd(6) + q.pic.padEnd(34) + q.credit);
  } catch (e) { none.push(q.id + ' (' + q.pic + '): ' + e.message); }
  await new Promise(r => setTimeout(r, 250));                           // gently: one question at a time
}
writeFileSync(file, JSON.stringify(b, null, 1));
console.log('\n' + found + ' pictures found, ' + kept + ' kept as they were, ' + none.length + ' without one.');
for (const n of none) console.log('  ' + n);
