// /api/blitz.js — the whole Demofest backend in one function.
// vercel.json rewrites /api/blitz/<action> here, so the copied game's
// API_BASE ('/api/blitz/') works without a single change to its fetch calls.
//
// Two groups of actions:
//   CONTENT  getQuestions / checkAnswer / getCoinQuestions / checkCoinAnswer /
//            getTerms / checkTerm — same SQL as the live game, READ-ONLY.
//            Nothing here increments the per-question stats that CAPCOM reads.
//   DEMOFEST register / logScore / getScores / export — booth players and
//            runs, in two tables of their own (demofest_players, demofest_scores)
//            that are created on first use. Nothing touches `players` or
//            `score_events`.
import { neon } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';

const CONN = process.env.DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.STORAGE_URL
  || process.env.POSTGRES_URL;
const sql = CONN ? neon(CONN) : null;   // lazy: no connection string → handler answers 503 instead of crashing at load

const SCORE_ABSOLUTE_MAX = 50000;   // same plausibility caps as the live game
const DURATION_CAP = 1800;
const TERRITORY = 'DEMOFEST';       // the one "territory" the game's table shows

// ── schema, created lazily once per warm instance ───────────────────────────
let ready = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS demofest_players (
        id          serial PRIMARY KEY,
        email       text UNIQUE NOT NULL,
        name        text NOT NULL,
        trigram     text NOT NULL,
        token       text NOT NULL,
        place       text,
        lat         real,
        lon         real,
        created_at  timestamptz NOT NULL DEFAULT now(),
        last_seen   timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`ALTER TABLE demofest_players ADD COLUMN IF NOT EXISTS place text`;
      await sql`ALTER TABLE demofest_players ADD COLUMN IF NOT EXISTS lat real`;
      await sql`ALTER TABLE demofest_players ADD COLUMN IF NOT EXISTS lon real`;
      await sql`CREATE TABLE IF NOT EXISTS demofest_scores (
        id           serial PRIMARY KEY,
        player_id    integer NOT NULL REFERENCES demofest_players(id),
        score        integer NOT NULL,
        duration_sec integer NOT NULL DEFAULT 0,
        q_attempted  integer NOT NULL DEFAULT 0,
        q_correct    integer NOT NULL DEFAULT 0,
        c_attempted  integer NOT NULL DEFAULT 0,
        c_correct    integer NOT NULL DEFAULT 0,
        t_attempted  integer NOT NULL DEFAULT 0,
        t_correct    integer NOT NULL DEFAULT 0,
        created_at   timestamptz NOT NULL DEFAULT now()
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
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const opts = r => [
  { key: 'a', text: r.option_a }, { key: 'b', text: r.option_b },
  { key: 'c', text: r.option_c }, { key: 'd', text: r.option_d },
];
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// ── CONTENT (read-only mirrors of the live handlers) ────────────────────────
async function getQuestions(req, res) {
  const n = clampInt(req.query.n || 1, 1, 10);
  const rows = await sql`SELECT id, prompt, option_a, option_b, option_c, option_d
    FROM questions WHERE active = true ORDER BY random() LIMIT ${n}`;
  return res.status(200).json({ questions: rows.map(r => ({ id: r.id, prompt: r.prompt, options: opts(r) })) });
}
async function checkAnswer(req, res) {
  const { id, choice: c } = body(req);
  const choice = String(c || '').toLowerCase();
  if (id == null || !['a', 'b', 'c', 'd'].includes(choice)) return res.status(400).json({ error: 'id and choice (a|b|c|d) required' });
  const rows = await sql`SELECT correct_option FROM questions WHERE id = ${id} AND active = true LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'question not found' });
  const correctKey = String(rows[0].correct_option).toLowerCase();
  return res.status(200).json({ correct: choice === correctKey, correct_option: correctKey });
}
const CATEGORIES = ['term', 'green_sheet', 'blue_sheet'];
async function getCoinQuestions(req, res) {
  const category = String(req.query.category || '').toLowerCase();
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'category must be term|green_sheet|blue_sheet' });
  const n = clampInt(req.query.n || 1, 1, 10);
  const rows = await sql`SELECT id, category, prompt, question, option_a, option_b, option_c, option_d, read_seconds
    FROM methodology_questions WHERE active = true AND category = ${category} ORDER BY random() LIMIT ${n}`;
  return res.status(200).json({ questions: rows.map(r => ({
    id: r.id, category: r.category, prompt: r.prompt, question: r.question, options: opts(r), read_seconds: r.read_seconds,
  })) });
}
async function checkCoinAnswer(req, res) {
  const { id, choice: c } = body(req);
  const choice = String(c || '').toLowerCase();
  if (id == null || !['a', 'b', 'c', 'd'].includes(choice)) return res.status(400).json({ error: 'id and choice (a|b|c|d) required' });
  const rows = await sql`SELECT correct, explanation FROM methodology_questions WHERE id = ${id} AND active = true LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'question not found' });
  const correctKey = String(rows[0].correct).toLowerCase();
  return res.status(200).json({ correct: choice === correctKey, correct_option: correctKey, explanation: rows[0].explanation || '' });
}
async function getTerms(req, res) {
  const n = clampInt(req.query.n || 3, 1, 10);
  const answers = await sql`SELECT id, term, definition FROM glossary_terms WHERE active = true ORDER BY random() LIMIT ${n}`;
  const pool = await sql`SELECT term FROM glossary_terms WHERE active = true ORDER BY random() LIMIT ${n * 6 + 12}`;
  const names = pool.map(p => p.term);
  const questions = answers.map(a => {
    const used = new Set([a.term]); const decoys = [];
    for (const nm of names) { if (decoys.length >= 3) break; if (!used.has(nm)) { used.add(nm); decoys.push(nm); } }
    return { id: a.id, def: a.definition, options: shuffle([a.term, ...decoys]) };
  });
  return res.status(200).json({ questions });
}
async function checkTerm(req, res) {
  const { id, choice: c } = body(req);
  const choice = String(c || '').trim().toLowerCase();
  if (id == null) return res.status(400).json({ error: 'id required' });
  const rows = await sql`SELECT term FROM glossary_terms WHERE id = ${id} AND active = true LIMIT 1`;
  if (!rows.length) return res.status(404).json({ error: 'term not found' });
  const term = rows[0].term;
  return res.status(200).json({ correct: choice === String(term).trim().toLowerCase(), term });
}

// ── DEMOFEST ────────────────────────────────────────────────────────────────
/* POST register { name, email, trigram }
   Players are keyed by email: the same person coming back keeps their runs and
   simply refreshes name/trigram. Returns a per-player token that logScore
   requires, so a stray POST cannot put a score on someone else's row. */
async function register(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  await ensureTables();
  const b = body(req);
  const name = String(b.name || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
  const trigram = String(b.trigram || '').trim().toUpperCase();
  if (name.length < 1) return res.status(400).json({ error: 'Name required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!/^[A-Z]{3}$/.test(trigram)) return res.status(400).json({ error: 'Trigram must be exactly three letters' });
  // where they are from: free text, plus a map point when the page could resolve it
  const place = String(b.place || '').trim().slice(0, 80) || null;
  const lat = Number.isFinite(Number(b.lat)) && b.lat !== null && b.lat !== '' ? Math.max(-90, Math.min(90, Number(b.lat))) : null;
  const lon = Number.isFinite(Number(b.lon)) && b.lon !== null && b.lon !== '' ? Math.max(-180, Math.min(180, Number(b.lon))) : null;
  const token = randomBytes(16).toString('hex');
  const rows = await sql`
    INSERT INTO demofest_players (email, name, trigram, token, place, lat, lon)
    VALUES (${email}, ${name}, ${trigram}, ${token}, ${place}, ${lat}, ${lon})
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name, trigram = EXCLUDED.trigram, token = EXCLUDED.token, last_seen = now(),
          place = COALESCE(EXCLUDED.place, demofest_players.place),
          lat = COALESCE(EXCLUDED.lat, demofest_players.lat), lon = COALESCE(EXCLUDED.lon, demofest_players.lon)
    RETURNING id, name, trigram, token, place, lat, lon`;
  const p = rows[0];
  const best = await sql`SELECT COALESCE(MAX(score),0) AS high, COUNT(*)::int AS games FROM demofest_scores WHERE player_id = ${p.id}`;
  return res.status(200).json({ ok: true, player: { id: p.id, name: p.name, trigram: p.trigram, token: p.token,
    place: p.place, lat: p.lat, lon: p.lon, high: Number(best[0].high) || 0, games: best[0].games || 0 } });
}

/* POST logScore { playerId, token, score, durationSec, stats:{questions,coins,terms} } */
async function logScore(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  await ensureTables();
  const b = body(req);
  const playerId = clampInt(b.playerId, 0, 2147483647);
  const token = String(b.token || '');
  if (!playerId || !token) return res.status(400).json({ error: 'playerId and token required' });
  const who = await sql`SELECT id FROM demofest_players WHERE id = ${playerId} AND token = ${token} LIMIT 1`;
  if (!who.length) return res.status(401).json({ error: 'Unknown player or bad token' });
  const durationSec = clampInt(b.durationSec, 0, DURATION_CAP);
  const score = clampInt(b.score, 0, SCORE_ABSOLUTE_MAX);
  const s = b.stats || {};
  const pair = o => { const a = clampInt(o && o.attempted, 0, 10000); return [a, clampInt(o && o.correct, 0, a)]; };
  const [qa, qc] = pair(s.questions), [ca, cc] = pair(s.coins), [ta, tc] = pair(s.terms);
  await sql`INSERT INTO demofest_scores (player_id, score, duration_sec, q_attempted, q_correct, c_attempted, c_correct, t_attempted, t_correct)
    VALUES (${playerId}, ${score}, ${durationSec}, ${qa}, ${qc}, ${ca}, ${cc}, ${ta}, ${tc})`;
  await sql`UPDATE demofest_players SET last_seen = now() WHERE id = ${playerId}`;
  const best = await sql`SELECT MAX(score) AS high, COUNT(*)::int AS games FROM demofest_scores WHERE player_id = ${playerId}`;
  const room = await sql`SELECT COALESCE(MAX(score),0) AS high FROM demofest_scores`;
  return res.status(200).json({ ok: true, high: Number(best[0].high) || 0, games: best[0].games, roomHigh: Number(room[0].high) || 0 });
}

/* GET getScores — one row per player, best run first.
   Shape matches the live /api/blitz/getScores so the game's own HIGH SCORES
   table renders it unchanged (one tab: DEMOFEST), plus `high` for the unlock
   bar and `name` for the booth board. */
async function getScores(req, res) {
  await ensureTables();
  const rows = await sql`
    SELECT p.id, p.trigram, p.name, p.place, p.lat, p.lon,
           MAX(s.score) AS high, MAX(s.duration_sec) AS longest_sec, COUNT(s.id)::int AS games, MAX(s.created_at) AS last_run
    FROM demofest_players p JOIN demofest_scores s ON s.player_id = p.id
    GROUP BY p.id, p.trigram, p.name, p.place, p.lat, p.lon
    ORDER BY high DESC, last_run ASC`;
  const list = rows.map(r => ({ id: r.id, trigram: r.trigram, name: r.name, country_code: null, place: r.place, lat: r.lat, lon: r.lon,
    high: Number(r.high) || 0, longestSec: Number(r.longest_sec) || 0, games: r.games }));
  // the last 30 runs feed the map's burst rotation
  const runs = await sql`
    SELECT s.id, s.score, s.created_at, p.trigram, p.name, p.place, p.lat, p.lon
    FROM demofest_scores s JOIN demofest_players p ON p.id = s.player_id
    WHERE s.score > 0 ORDER BY s.created_at DESC LIMIT 30`;
  const recent = runs.map(r => ({ id: r.id, trigram: r.trigram, name: r.name, place: r.place, lat: r.lat, lon: r.lon, score: Number(r.score) || 0, at: r.created_at }));
  return res.status(200).json({ territories: { [TERRITORY]: list }, high: list.length ? list[0].high : 0, recent });
}

/* GET export?key=ADMIN_KEY — CSV of every player with best score and run count. */
async function exportCsv(req, res) {
  const key = process.env.ADMIN_KEY;
  if (!key || String(req.query.key || '') !== key) return res.status(401).json({ error: 'bad key' });
  await ensureTables();
  const rows = await sql`
    SELECT p.name, p.email, p.trigram, p.place, p.created_at, COUNT(s.id)::int AS games,
           COALESCE(MAX(s.score),0) AS high, COALESCE(SUM(s.duration_sec),0) AS seconds_played,
           COALESCE(SUM(s.q_attempted+s.c_attempted+s.t_attempted),0) AS attempted,
           COALESCE(SUM(s.q_correct+s.c_correct+s.t_correct),0) AS correct
    FROM demofest_players p LEFT JOIN demofest_scores s ON s.player_id = p.id
    GROUP BY p.id ORDER BY high DESC, p.created_at ASC`;
  const head = ['name', 'email', 'trigram', 'from', 'registered_at', 'games', 'high_score', 'seconds_played', 'questions_attempted', 'questions_correct'];
  const lines = [head.join(',')].concat(rows.map(r => [r.name, r.email, r.trigram, r.place || '', new Date(r.created_at).toISOString(),
    r.games, r.high, r.seconds_played, r.attempted, r.correct].map(csvCell).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="demofest-players.csv"');
  return res.status(200).send(lines.join('\r\n'));
}

const HANDLERS = { getQuestions, checkAnswer, getCoinQuestions, checkCoinAnswer, getTerms, checkTerm,
  register, logScore, getScores, export: exportCsv };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = (req.query.action || '').toString();
  const fn = HANDLERS[action];
  if (!fn) return res.status(404).json({ error: 'Unknown blitz action', action });
  if (!CONN) return res.status(503).json({ error: 'DATABASE_URL is not set on this deployment' });
  try { return await fn(req, res); }
  catch (e) { console.error(action, e); return res.status(500).json({ error: action + ' failed' }); }
}
