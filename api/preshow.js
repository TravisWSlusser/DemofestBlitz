// /api/preshow.js — the Session 609 pre-show game. vercel.json rewrites /api/preshow/<action> here.
//
// The big screen shows one trivia card at a time; phones join with a name and tap an answer; the screen shows a
// live leaderboard. Everything runs off the SERVER clock:
//   - a card is open for ASK_MS, then shows its answer for ANSWER_MS (one CYCLE);
//   - which card is up at any moment is a pure function of the time and the show id, so the screen, every phone and
//     this function agree without anyone "driving" the show;
//   - the show id is the show's start time in epoch ms (the launcher's ?at=). Each run therefore gets its own empty
//     leaderboard, and the cards are aligned so the last one ends exactly when the closing countdown begins.
// Right answers never leave the server before the reveal. Player tokens travel in a header, not in the URL.
//
//   GET  state?show=&cards=1   (header X-Player-Token optional)  timing, cards, leaderboard, reveal, my score
//   POST join   { show, name }                                   → { token, name }
//   POST answer { show, choice }   (header X-Player-Token)       → { ok, pick }
//   GET  results  (header X-Admin-Key)                           CSV of every player in every show
//   POST reset    (header X-Admin-Key)                           empties the two pre-show tables
import { neon } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';
import { QUESTIONS } from './_preshow-questions.js';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = CONN ? neon(CONN) : null;

const ASK_MS = 18000;       // a card is open for answers
const ANSWER_MS = 8000;     // then its answer is on screen
const CYCLE = ASK_MS + ANSWER_MS;
const FINAL_MS = 20000;     // closing countdown before show time: no cards, no answers
const GRACE_MS = 400;       // network slack for a tap made just before the reveal
const BOARD_ROWS = 8;
const MAX_PLAYERS = 1500;   // per show

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS preshow_players (
        id          serial PRIMARY KEY,
        show        text NOT NULL,
        name        text NOT NULL,
        token       text UNIQUE NOT NULL,
        score       integer NOT NULL DEFAULT 0,
        correct     integer NOT NULL DEFAULT 0,
        answered    integer NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS preshow_players_board ON preshow_players (show, score DESC, id)`;
      await sql`CREATE TABLE IF NOT EXISTS preshow_answers (
        player_id   integer NOT NULL REFERENCES preshow_players(id) ON DELETE CASCADE,
        qi          integer NOT NULL,
        choice      integer NOT NULL,
        correct     boolean NOT NULL,
        pts         integer NOT NULL,
        ms          integer NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (player_id, qi)
      )`;
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function body(req) {
  const b = req.body;
  if (typeof b === 'string') { try { return JSON.parse(b || '{}'); } catch { return {}; } }
  return b || {};
}
const showOf = v => (/^\d{12,14}$/.test(String(v || '')) ? String(v) : 'preview');
const tokenOf = req => String(req.headers['x-player-token'] || '').slice(0, 64);
const isAdmin = req => { const k = process.env.ADMIN_KEY; return !!k && String(req.headers['x-admin-key'] || '') === k; };
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/* Where the show is at `now`. Cards are counted from an anchor chosen so a card boundary falls exactly on the start
   of the closing countdown. s = slot number, into = ms into the slot, qi = which card. */
function timeline(show, now) {
  const at = show === 'preview' ? 0 : Number(show);
  const anchor = at ? (at - FINAL_MS) % CYCLE : 0;
  const s = Math.floor((now - anchor) / CYCLE);
  const into = now - anchor - s * CYCLE;
  const n = QUESTIONS.length;
  return { at, s, into, qi: ((s % n) + n) % n, reveal: into >= ASK_MS, closed: at ? now >= at - FINAL_MS : false };
}

/* Names go on a big screen in front of a room: keep them short, plain, and clean. */
const RUDE_ANYWHERE = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'faggot', 'whore', 'slut', 'penis', 'vagina', 'porn', 'hitler', 'nazi', 'asshole', 'dickhead', 'wank', 'twat', 'pussy', 'retard'];
const RUDE_WORDS = ['ass', 'cock', 'fag', 'rape', 'cum', 'tit', 'tits', 'sex', 'anal', 'kkk', 'hoe'];
function isRude(name) {
  const plain = name.toLowerCase().replace(/0/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't');
  const squashed = plain.replace(/[^a-z]/g, '');
  if (RUDE_ANYWHERE.some(w => squashed.includes(w))) return true;
  return plain.split(/[^a-z]+/).some(w => RUDE_WORDS.includes(w));
}

/* Leaderboard and per-card tallies are the same for everyone, so one warm instance asks the database at most once a second. */
const cache = new Map();
async function cached(key, ms, load) {
  const hit = cache.get(key), now = Date.now();
  if (hit && now - hit.t < ms) return hit.v;
  const v = await load();
  cache.set(key, { t: now, v });
  if (cache.size > 200) for (const [k, e] of cache) if (now - e.t > 60000) cache.delete(k);
  return v;
}
const boardOf = show => cached('board:' + show, 1000, async () => {
  const [top, cnt] = await Promise.all([
    sql`SELECT name, score, correct FROM preshow_players WHERE show = ${show} ORDER BY score DESC, id ASC LIMIT ${BOARD_ROWS}`,
    sql`SELECT COUNT(*)::int AS n FROM preshow_players WHERE show = ${show}`,
  ]);
  return { top: top.map(r => ({ name: r.name, score: r.score, correct: r.correct })), players: cnt[0].n };
});
const tallyOf = (show, qi) => cached('tally:' + show + ':' + qi, 1000, async () => {
  const r = await sql`
    SELECT COUNT(*)::int AS answered, (COUNT(*) FILTER (WHERE a.correct))::int AS correct
    FROM preshow_answers a JOIN preshow_players p ON p.id = a.player_id
    WHERE p.show = ${show} AND a.qi = ${qi}`;
  return { answered: r[0].answered, right: r[0].correct };
});

// ── actions ─────────────────────────────────────────────────────────────────
async function state(req, res) {
  await ensureTables();
  const show = showOf(req.query.show);
  const t = timeline(show, Date.now());
  const out = { ask: ASK_MS, answer: ANSWER_MS, final: FINAL_MS, n: QUESTIONS.length, qi: t.qi, closed: t.closed };
  if (req.query.cards) out.cards = QUESTIONS.map(c => ({ q: c.q, a: c.a }));
  const board = await boardOf(show);
  out.top = board.top; out.players = board.players;
  if (t.reveal && !t.closed) {
    const c = QUESTIONS[t.qi];
    out.reveal = { qi: t.qi, ok: c.ok, fact: c.fact || '', ...(await tallyOf(show, t.qi)) };
  }
  const token = tokenOf(req);
  if (token) {
    const rows = await sql`SELECT id, name, score, correct, answered FROM preshow_players WHERE token = ${token} AND show = ${show}`;
    if (!rows.length) out.me = null;
    else {
      const p = rows[0];
      const [rk, mine] = await Promise.all([
        sql`SELECT COUNT(*)::int + 1 AS rank FROM preshow_players WHERE show = ${show} AND score > ${p.score}`,
        sql`SELECT choice, correct, pts FROM preshow_answers WHERE player_id = ${p.id} AND qi = ${t.qi}`,
      ]);
      out.me = { name: p.name, score: p.score, correct: p.correct, answered: p.answered, rank: rk[0].rank, pick: mine.length ? mine[0].choice : null };
      if (mine.length && t.reveal) { out.me.right = mine[0].correct; out.me.pts = mine[0].pts; }
    }
  }
  out.now = Date.now();   // stamped last, so the caller's clock sync is not skewed by the queries above
  return res.status(200).json(out);
}

async function join(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  await ensureTables();
  const b = body(req);
  const show = showOf(b.show);
  if (timeline(show, Date.now()).closed) return res.status(409).json({ error: 'The show is starting. The game is closed.' });
  const name = String(b.name || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 18);
  if (name.length < 2) return res.status(400).json({ error: 'Enter a name, 2 to 18 characters.' });
  if (!/^[\p{L}\p{N} .'’-]+$/u.test(name)) return res.status(400).json({ error: 'Letters, numbers and spaces only.' });
  if (isRude(name)) return res.status(400).json({ error: 'Please pick a different name.' });
  const cnt = await sql`SELECT COUNT(*)::int AS n FROM preshow_players WHERE show = ${show}`;
  if (cnt[0].n >= MAX_PLAYERS) return res.status(429).json({ error: 'The game is full.' });
  const token = randomBytes(16).toString('hex');
  await sql`INSERT INTO preshow_players (show, name, token) VALUES (${show}, ${name}, ${token})`;
  cache.delete('board:' + show);
  return res.status(200).json({ ok: true, token, name });
}

async function answer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  await ensureTables();
  const b = body(req);
  const show = showOf(b.show);
  const choice = Number(b.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return res.status(400).json({ error: 'choice must be 0-3' });
  const t = timeline(show, Date.now());
  if (t.closed) return res.status(200).json({ ok: false, reason: 'closed' });
  if (t.into > ASK_MS + GRACE_MS) return res.status(200).json({ ok: false, reason: 'late' });
  const token = tokenOf(req);
  const rows = token ? await sql`SELECT id FROM preshow_players WHERE token = ${token} AND show = ${show}` : [];
  if (!rows.length) return res.status(401).json({ error: 'Join the game first.' });
  const pid = rows[0].id;
  const correct = choice === QUESTIONS[t.qi].ok;
  const ms = Math.min(t.into, ASK_MS);
  const pts = correct ? 100 + Math.round(100 * (1 - ms / ASK_MS)) : 0;      // 100 for being right, up to 100 more for being fast
  const ins = await sql`
    INSERT INTO preshow_answers (player_id, qi, choice, correct, pts, ms) VALUES (${pid}, ${t.qi}, ${choice}, ${correct}, ${pts}, ${ms})
    ON CONFLICT (player_id, qi) DO NOTHING RETURNING choice`;
  if (!ins.length) {                                                         // one answer per card: the first tap stands
    const ex = await sql`SELECT choice FROM preshow_answers WHERE player_id = ${pid} AND qi = ${t.qi}`;
    return res.status(200).json({ ok: true, dup: true, pick: ex.length ? ex[0].choice : choice });
  }
  await sql`UPDATE preshow_players SET score = score + ${pts}, correct = correct + ${correct ? 1 : 0}, answered = answered + 1 WHERE id = ${pid}`;
  return res.status(200).json({ ok: true, pick: choice });
}

async function results(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
  await ensureTables();
  const rows = await sql`SELECT show, name, score, correct, answered, created_at FROM preshow_players ORDER BY show DESC, score DESC, id ASC`;
  const head = ['show', 'show_time', 'name', 'score', 'correct', 'answered', 'joined_at'];
  const lines = [head.join(',')].concat(rows.map(r => [r.show, r.show === 'preview' ? '' : new Date(Number(r.show)).toISOString(),
    r.name, r.score, r.correct, r.answered, new Date(r.created_at).toISOString()].map(csvCell).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="preshow-results.csv"');
  return res.status(200).send(lines.join('\r\n'));
}

async function reset(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  await ensureTables();
  await sql`TRUNCATE preshow_answers, preshow_players RESTART IDENTITY`;
  cache.clear();
  return res.status(200).json({ ok: true });
}

const HANDLERS = { state, join, answer, results, reset };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = (req.query.action || '').toString();
  const fn = HANDLERS[action];
  if (!fn) return res.status(404).json({ error: 'Unknown preshow action', action });
  if (!CONN) return res.status(503).json({ error: 'DATABASE_URL is not set on this deployment' });
  try { return await fn(req, res); }
  catch (e) { console.error('preshow', action, e); return res.status(500).json({ error: action + ' failed' }); }
}
