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
//   GET  announce?show=&kind=&play=                           the announcer's next line as mp3; registers its captions
//   POST pair { hash } / GET pair?code=                          pair the presenter's phone with the launcher
//   POST claim { show, hash }                                    the launcher claims a show for the paired phone
//   GET  admin   (header X-Admin-Token)                          the control room: everything about the claimed show
//   POST kick { id }  (header X-Admin-Token)                     remove a player
//   GET  results  (header X-Admin-Key)                           CSV of every player in every show
//   POST reset    (header X-Admin-Key)                           empties the two pre-show tables
import { neon } from '@neondatabase/serverless';
import { randomBytes, createHash } from 'node:crypto';
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
      // one row per spoken line: the text, the audio (base64 mp3) and who led at the time. A repeat request for the
      // same line is served from here, so a line is generated, and paid for, once.
      await sql`CREATE TABLE IF NOT EXISTS preshow_voice (
        show        text NOT NULL,
        slot        text NOT NULL,
        line        text NOT NULL,
        leader      integer,
        audio       text NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (show, slot)
      )`;
      await sql`ALTER TABLE preshow_players ADD COLUMN IF NOT EXISTS last_seen timestamptz NOT NULL DEFAULT now()`;
      // the control room: phone pairing codes, and which phone (by the hash of its token) administers which show
      await sql`CREATE TABLE IF NOT EXISTS preshow_pair (code text PRIMARY KEY, hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), taken_at timestamptz)`;
      await sql`CREATE TABLE IF NOT EXISTS preshow_admin (show text PRIMARY KEY, hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`;
      await sql`ALTER TABLE preshow_voice ADD COLUMN IF NOT EXISTS cues text`;
      await sql`ALTER TABLE preshow_voice ADD COLUMN IF NOT EXISTS ms integer`;
      // the line being spoken right now in each show: when it starts (server time) and its captions, phrase by phrase.
      // The big screen and the phones read this through `state` and show the words in step with the voice.
      await sql`CREATE TABLE IF NOT EXISTS preshow_live (
        show        text PRIMARY KEY,
        play_at     bigint NOT NULL,
        ms          integer NOT NULL,
        cues        text NOT NULL
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

const cueOf = show => cached('cue:' + show, 800, async () => {
  const r = await sql`SELECT play_at, ms, cues FROM preshow_live WHERE show = ${show}`;
  if (!r.length) return null;
  const at = Number(r[0].play_at);
  if (at + r[0].ms + 2000 < Date.now()) return null;                  // already spoken
  try { return { at, ms: r[0].ms, parts: JSON.parse(r[0].cues) }; } catch { return null; }
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
        sql`UPDATE preshow_players SET last_seen = now() WHERE id = ${p.id}`,          // "connected now" in the control room
      ]);
      out.me = { name: p.name, score: p.score, correct: p.correct, answered: p.answered, rank: rk[0].rank, pick: mine.length ? mine[0].choice : null };
      if (mine.length && t.reveal) { out.me.right = mine[0].correct; out.me.pts = mine[0].pts; }
    }
  }
  const cue = await cueOf(show);
  if (cue) out.cue = cue;                                              // captions for the announcer's current line
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
  await sql`UPDATE preshow_players SET score = score + ${pts}, correct = correct + ${correct ? 1 : 0}, answered = answered + 1, last_seen = now() WHERE id = ${pid}`;
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
  await sql`TRUNCATE preshow_voice`;
  await sql`TRUNCATE preshow_live`;
  await sql`TRUNCATE preshow_admin`;
  cache.clear();
  return res.status(200).json({ ok: true });
}

// ── the control room ─────────────────────────────────────────────────────────
// One phone gets a private dashboard: every player, who is connected, what the room is answering, the right answer
// before the reveal, and a button to remove a player. How that phone is trusted, with no password to type and no
// secret in any link:
//   1. The phone makes up a long random token, keeps it to itself, and sends only its SHA-256 here (POST pair).
//      It gets back a six-character code to show on its screen.
//   2. The presenter types that code into the launcher's start screen. The launcher asks for the hash behind the
//      code (GET pair?code=) and keeps it on the laptop.
//   3. Every time a pre-show launches, the launcher claims the new show for that hash (POST claim). A show can be
//      claimed once, and the launcher does it before the show's id is ever on screen, so nobody can get in first.
//      (With no phone paired the launcher still claims, with a throwaway hash, so the show is never left open.)
//   4. The phone sends its token in a header; whoever holds the token whose hash claimed the show is the admin.
const sha256 = v => createHash('sha256').update(String(v)).digest('hex');
const adminTokenOf = req => String(req.headers['x-admin-token'] || '').slice(0, 128);
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L: easy to read off a phone and type

async function pair(req, res) {
  await ensureTables();
  if (req.method === 'POST') {                                            // the phone asks for a code
    const hash = String(body(req).hash || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return res.status(400).json({ error: 'bad request' });
    const have = await sql`SELECT code FROM preshow_pair WHERE hash = ${hash} AND taken_at IS NULL AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 1`;
    if (have.length) return res.status(200).json({ ok: true, code: have[0].code });
    await sql`DELETE FROM preshow_pair WHERE taken_at IS NULL AND created_at < now() - interval '1 day'`;
    for (let i = 0; i < 5; i++) {
      let code = '';
      for (const b of randomBytes(6)) code += PAIR_ALPHABET[b % PAIR_ALPHABET.length];
      const ins = await sql`INSERT INTO preshow_pair (code, hash) VALUES (${code}, ${hash}) ON CONFLICT (code) DO NOTHING RETURNING code`;
      if (ins.length) return res.status(200).json({ ok: true, code });
    }
    return res.status(503).json({ error: 'try again' });
  }
  const code = String(req.query.code || '').toUpperCase();                // the laptop redeems a code, once
  if (!/^[A-Z0-9]{6}$/.test(code)) return res.status(400).json({ error: 'bad code' });
  const got = await sql`UPDATE preshow_pair SET taken_at = now() WHERE code = ${code} AND taken_at IS NULL AND created_at > now() - interval '15 minutes' RETURNING hash`;
  if (!got.length) return res.status(404).json({ error: 'That code was not found or has expired.' });
  return res.status(200).json({ ok: true, hash: got[0].hash });
}

async function claim(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  await ensureTables();
  const b = body(req), show = showOf(b.show), hash = String(b.hash || '').toLowerCase(), now = Date.now();
  if (show === 'preview' || Number(show) < now || Number(show) > now + 30 * 60000 || !/^[0-9a-f]{64}$/.test(hash)) return res.status(400).json({ error: 'bad request' });
  await sql`INSERT INTO preshow_admin (show, hash) VALUES (${show}, ${hash}) ON CONFLICT (show) DO NOTHING`;
  const row = await sql`SELECT hash FROM preshow_admin WHERE show = ${show}`;
  return res.status(200).json({ ok: row.length > 0 && row[0].hash === hash });
}

/* The show this request may administer: the most recent one claimed for the caller's token. */
async function adminShow(req) {
  const token = adminTokenOf(req);
  if (token.length < 16) return { hash: null, show: null };
  const hash = sha256(token);
  const row = await sql`SELECT show FROM preshow_admin WHERE hash = ${hash} ORDER BY created_at DESC LIMIT 1`;
  return { hash, show: row.length ? row[0].show : null };
}

async function admin(req, res) {
  await ensureTables();
  const who = await adminShow(req);
  if (!who.hash) return res.status(401).json({ error: 'no token' });
  if (!who.show) {
    const p = await sql`SELECT 1 FROM preshow_pair WHERE hash = ${who.hash} AND taken_at IS NOT NULL LIMIT 1`;
    return res.status(200).json({ ok: true, paired: p.length > 0, show: null, now: Date.now() });
  }
  const show = who.show, t = timeline(show, Date.now()), c = QUESTIONS[t.qi];
  const [board, agg, dist, voice] = await Promise.all([
    sql`SELECT id, name, score, correct, answered, (last_seen > now() - interval '45 seconds') AS online
        FROM preshow_players WHERE show = ${show} ORDER BY score DESC, id ASC LIMIT 300`,
    sql`SELECT COUNT(*)::int AS players, COALESCE(SUM(answered), 0)::int AS answers, COALESCE(SUM(correct), 0)::int AS correct,
               (COUNT(*) FILTER (WHERE last_seen > now() - interval '45 seconds'))::int AS online
        FROM preshow_players WHERE show = ${show}`,
    sql`SELECT a.choice, COUNT(*)::int AS n FROM preshow_answers a JOIN preshow_players p ON p.id = a.player_id
        WHERE p.show = ${show} AND a.qi = ${t.qi} GROUP BY a.choice`,
    sql`SELECT line FROM preshow_voice WHERE show = ${show} ORDER BY created_at DESC LIMIT 1`,
  ]);
  const counts = [0, 0, 0, 0];
  for (const d of dist) if (d.choice >= 0 && d.choice < 4) counts[d.choice] = d.n;
  return res.status(200).json({
    ok: true, paired: true, show, at: Number(show), ask: ASK_MS, answer: ANSWER_MS, final: FINAL_MS, n: QUESTIONS.length,
    qi: t.qi, into: t.into, reveal: t.reveal, closed: t.closed,
    players: agg[0].players, online: agg[0].online, answers: agg[0].answers, correct: agg[0].correct,
    card: { q: c.q, a: c.a, ok: c.ok, counts },
    board: board.map(r => ({ id: r.id, name: r.name, score: r.score, correct: r.correct, answered: r.answered, online: !!r.online })),
    voice: voice.length ? voice[0].line.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/six oh nine/gi, '609').trim() : '',
    now: Date.now(),
  });
}

async function kick(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  await ensureTables();
  const who = await adminShow(req);
  if (!who.show) return res.status(401).json({ error: 'not the admin of a show' });
  const id = Number(body(req).id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
  const gone = await sql`DELETE FROM preshow_players WHERE id = ${id} AND show = ${who.show} RETURNING name`;   // their answers go with them
  cache.delete('board:' + who.show);
  return res.status(200).json({ ok: gone.length > 0, name: gone.length ? gone[0].name : null });
}

// ── the announcer ───────────────────────────────────────────────────────────
// GET announce?show=<at>&kind=welcome|mid|final → audio/mpeg, spoken by an ElevenLabs voice.
// The launcher on the presenter's laptop asks for these on a schedule and plays them over the music. The words are
// always composed HERE from the live leaderboard; a caller cannot supply text, so this cannot be used as a free
// text-to-speech service. The API key lives only in the ELEVENLABS_API_KEY environment variable.
const VOICE_ID = process.env.ELEVENLABS_VOICE || 'QTGiyJvep6bcx4WD1qAq';
// Eleven v4 is the expressive model: it follows short directions written in square brackets ("audio tags") and reads
// punctuation, ellipses and capitals as delivery cues. If the account cannot use it, the next model in the list is
// tried. Models before v3 would read the bracketed directions aloud, so the directions are stripped for them.
const VOICE_MODELS = [process.env.ELEVENLABS_MODEL || 'eleven_v4', 'eleven_v4_turbo', 'eleven_v3', 'eleven_flash_v2_5'].filter((m, i, a) => a.indexOf(m) === i);
const TAG_MODELS = /^eleven_v[34]/;
const VOICE_DAILY_CAP = 60;          // generated lines per 24 hours, whatever happens
const AUDIO_TEST = "[warm, upbeat game show host] Testing, testing... this is your announcer. [playful] If you can hear me clearly over the music, the room is ready. [chuckles] Break a leg.";
const WELCOME = "[warm, upbeat game show host] Hey, hey... welcome to session six oh nine! [playful] While you're getting settled, grab your phone, scan that code on the screen, and put your name on the board. Right answers score... FAST answers score more. [chuckles] No pressure.";

/* A name is read aloud to the room, so it gets a second, stricter look than the one for the screen: first name only
   (which defuses most two-word joke names), and nothing from the list of names that are only rude when spoken. */
const PRANKS = ['bendover', 'benderover', 'mikehunt', 'mikehawk', 'mikerotch', 'mikecrotch', 'mikelitoris', 'hughjass', 'hughjanus', 'hughgrection', 'hugeass',
  'philmccracken', 'philmacracken', 'jackmehoff', 'jackoff', 'jackgoff', 'dixienormous', 'dixonormous', 'haywoodjablome', 'moelester', 'molester',
  'seymourbutts', 'seymorebutts', 'ipfreely', 'ipdaily', 'anitadick', 'anitahardone', 'mccockiner', 'busterhymen', 'harrysach', 'oliverklozoff',
  'oliverclothesoff', 'pennytration', 'philatio', 'fellatio', 'jennatalia', 'genitalia', 'kuntz', 'claytoris', 'claytorris', 'testickle', 'tesstickle',
  'drewpeacock', 'droopycock', 'waynekerr', 'wanker', 'ligma', 'sugma', 'sugondese', 'bofa', 'deez', 'joemama', 'yourmom', 'urmom',
  'ericshun', 'erection', 'ivanahump', 'analbeads', 'dildo', 'boner', 'nutsack', 'ballsack', 'buttface', 'butthole', 'poop', 'fart'];
function spoken(name) {
  const squashed = String(name).toLowerCase().replace(/[^a-z]/g, '');
  if (PRANKS.some(p => squashed.includes(p)) || isRude(name)) return null;
  const first = String(name).trim().split(/\s+/)[0].replace(/[^\p{L}'’-]/gu, '');
  if (first.length < 2 || first.length > 14) return null;
  return first[0].toUpperCase() + first.slice(1).toLowerCase();   // "AVA" would be spelled out letter by letter
}

/* The words for a standings update or the closing call, written the way a game-show host would say them, with a
   direction in square brackets ahead of each change of tone. Kept short: a line should not run far past one answer
   reveal. `s` (the card number) picks between phrasings so consecutive updates do not sound identical. */
function composeLine(kind, top, players, s, newLeader) {
  const nm = (p, fallback) => (p && spoken(p.name)) || fallback;
  const pick = (...opts) => opts[((s % opts.length) + opts.length) % opts.length];
  const [a, b, c] = top;
  const A = nm(a, 'our leader'), B = nm(b, 'second place'), C = nm(c, 'third place');
  const close = " [calm, friendly] Phones on silent, please... the show starts now.";
  if (kind === 'final') {
    if (!a || a.score === 0) return "[warm] And that's the pre-show." + close;
    let line = "[big finish, excited] And THAT is the game! " + (A === 'our leader' ? 'Our winner finishes' : A + ' wins it') + ' with ' + a.score + ' points!';
    const b2 = b && b.score > 0, c2 = c && c.score > 0;               // a placing is only called for someone who scored
    if (b2 && c2) line += ' [warm] ' + (B === 'second place' ? 'Second place' : B) + ' takes second, and ' + (C === 'third place' ? 'third place rounds it out' : C + ' third') + '.';
    else if (b2) line += ' [warm] ' + (B === 'second place' ? 'Well played, second place' : B + ' takes second') + '.';
    return line + close;
  }
  if (!a) return "[playful] The board is empty... which means the first name up there is WINNING. [inviting] Scan the code and take it.";
  if (a.score === 0) return '[amused] ' + players + (players === 1 ? ' player is' : ' players are') + " in, and nobody has scored yet. [teasing] The next right answer takes the lead.";
  if (!b) return '[amused] ' + A + ' is all alone on the board with ' + a.score + " points. [inviting] Somebody scan that code and give them a game.";
  let line;
  if (a.score === b.score) line = "[excited] It's a TIE at the top! " + A + ' and ' + B + ', both on ' + a.score + ' points.';
  else {
    line = newLeader ? '[excited] Ooh... we have a NEW leader! ' + A + ' jumps to the top with ' + a.score + ' points.'
      : pick('[excited] ' + A + ' is out in front with ' + a.score + ' points!',
             '[impressed] Still ' + A + ' at the top... ' + a.score + ' points and counting.',
             '[playful] Nobody has caught ' + A + ' yet. ' + a.score + ' points.');
    if (b.score === 0) line += ' [teasing] And nobody else has scored. Come on, people.';
    else {
      const gap = a.score - b.score;
      line += gap <= 80 ? ' [teasing] But ' + B + ' is only ' + gap + ' points back' : ' [casual] ' + B + ' is sitting in second';
      line += c && c.score > 0 ? ', and ' + C + ' is holding third.' : '.';
    }
  }
  // one short tail, alternating between updates
  return line + (s % 2 ? ' [upbeat] ' + players + ' of you are in the game.' : ' [inviting] Still time to scan the code and jump in.');
}

/* Captions: the spoken line cut into short phrases, each with the moment it starts (ms from the start of the audio)
   and how long it stays up. A direction tag always starts a new phrase; long sentences are split evenly so every
   phrase fits one line on the big screen. Timing comes from ElevenLabs' own character timestamps when they line up
   with the text, otherwise it is estimated from the length of each phrase. */
const CAPTION_MAX = 46;
function captionParts(line, totalMs, alignment) {
  const phrases = [];
  for (const seg of line.split(/\s*\[[^\]]*\]\s*/)) {
    const text = seg.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const raw of text.match(/[^.!?\u2026]+(?:[.!?\u2026]+|$)\s*/g) || [text]) {
      const sentence = raw.trim();
      if (!sentence) continue;
      // pack whole clauses (up to a comma) into a phrase while they fit; only a clause that is too long by itself is
      // broken between words, into even pieces
      let piece = '';
      const flush = () => { if (piece) { phrases.push(piece); piece = ''; } };
      for (const c0 of sentence.match(/[^,;:]+[,;:]*s*/g) || [sentence]) {
        const clause = c0.trim();
        if (!clause) continue;
        if (clause.length > CAPTION_MAX) {
          flush();
          const limit = Math.ceil(clause.length / Math.ceil(clause.length / CAPTION_MAX)) + 6;
          for (const word of clause.split(' ')) {
            if (piece && (piece + ' ' + word).length > limit) flush();
            piece = piece ? piece + ' ' + word : word;
          }
          flush();
        } else if (piece && (piece + ' ' + clause).length > CAPTION_MAX) { flush(); piece = clause; }
        else piece = piece ? piece + ' ' + clause : clause;
      }
      flush();
    }
  }
  if (!phrases.length) return { parts: [], exact: false };
  let parts = null;
  const ch = alignment && alignment.characters, st = alignment && alignment.character_start_times_seconds;
  if (Array.isArray(ch) && Array.isArray(st) && ch.length === st.length) {
    const joined = ch.join('');
    if (joined.length === ch.length) {
      const found = []; let cursor = 0;
      for (const p of phrases) {
        const i = joined.indexOf(p, cursor);
        if (i < 0) break;
        found.push({ t: Math.round(st[i] * 1000), text: p }); cursor = i + p.length;
      }
      if (found.length === phrases.length) parts = found;
    }
  }
  const exact = !!parts;
  if (!parts) {                                                        // estimate: time in proportion to length, plus a breath per phrase
    const weight = p => p.length + 4, total = phrases.reduce((n, p) => n + weight(p), 0);
    let acc = 0;
    parts = phrases.map(p => { const t = Math.round(totalMs * acc / total); acc += weight(p); return { t, text: p }; });
  }
  parts[0].t = Math.min(parts[0].t, 400);
  parts.forEach((p, i) => { p.d = Math.max(300, (i + 1 < parts.length ? parts[i + 1].t : totalMs) - p.t); });   // up until the next one starts
  return { parts, exact };
}

/* One request to ElevenLabs for one model. First the variant that also says when each character is spoken (for
   captions in step with the voice); if that variant is not offered for this model, the plain one. */
async function speak(key, model, text) {
  const base = 'https://api.elevenlabs.io/v1/text-to-speech/' + VOICE_ID;
  const headers = { 'xi-api-key': key, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ text, model_id: model });
  try {
    const r = await fetch(base + '/with-timestamps?output_format=mp3_44100_128', { method: 'POST', headers, body, signal: AbortSignal.timeout(9000) });
    if (r.ok) { const j = await r.json(); if (j && j.audio_base64) return { ok: true, b64: j.audio_base64, alignment: j.alignment || null, cost: r.headers.get('character-cost') }; }
    else if (r.status === 401 || r.status === 429) return { ok: false, status: r.status, detail: (await r.text().catch(() => '')).slice(0, 400) };
  } catch (_) { /* fall through to the plain request */ }
  try {
    const r = await fetch(base + '?output_format=mp3_44100_128', { method: 'POST', headers: { ...headers, Accept: 'audio/mpeg' }, body, signal: AbortSignal.timeout(12000) });
    if (r.ok) return { ok: true, b64: Buffer.from(await r.arrayBuffer()).toString('base64'), alignment: null, cost: r.headers.get('character-cost') };
    return { ok: false, status: r.status, detail: (await r.text().catch(() => '')).slice(0, 400) };   // ElevenLabs' own explanation; it never contains the key
  } catch (_) { return { ok: false, status: 504, detail: model + ' did not answer in time' }; }
}

async function announce(req, res) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(503).json({ error: 'The voice is not configured.' });
  await ensureTables();
  const show = showOf(req.query.show);
  const now = Date.now();
  if (show === 'preview' || Number(show) < now - 60000 || Number(show) > now + 20 * 60000) return res.status(400).json({ error: 'That show is not live.' });
  const kind = ['welcome', 'mid', 'final', 'test'].includes(String(req.query.kind)) ? String(req.query.kind) : 'mid';
  const fixed = kind === 'welcome' ? WELCOME : kind === 'test' ? AUDIO_TEST : null;   // lines that do not depend on the leaderboard
  const t = timeline(show, now);
  // when the launcher will start playing this line (server time). With it, the captions go live for the screen and phones.
  const play = Number(req.query.play);
  const playAt = Number.isFinite(play) && play > now - 10000 && play < now + 120000 ? Math.round(play) : 0;
  // the welcome and the audio-test line are the same for every show, so each is stored once for all of them; a changed
  // text or voice makes a new row
  const rowShow = fixed ? '*' : show;
  const slot = fixed ? kind + ':timed:' + VOICE_ID + ':' + VOICE_MODELS[0] + ':' + fixed.length : kind === 'mid' ? 'mid:' + t.s : 'final';
  const send = async (line, b64, cues, ms) => {
    cues = cues.replace(/six oh nine/gi, '609');                       // written out for the voice, shown as a number in the captions
    if (playAt) {
      await sql`INSERT INTO preshow_live (show, play_at, ms, cues) VALUES (${show}, ${playAt}, ${ms}, ${cues})
                ON CONFLICT (show) DO UPDATE SET play_at = EXCLUDED.play_at, ms = EXCLUDED.ms, cues = EXCLUDED.cues`;
      cache.delete('cue:' + show);
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Voice-Text', encodeURIComponent(line));
    return res.status(200).send(Buffer.from(b64, 'base64'));
  };
  const hit = await sql`SELECT line, audio, cues, ms FROM preshow_voice WHERE show = ${rowShow} AND slot = ${slot}`;
  if (hit.length) {
    const ms = hit[0].ms || Math.round(Buffer.from(hit[0].audio, 'base64').length / 16);     // 128 kbps mp3: 16 bytes per millisecond
    const cues = hit[0].cues || JSON.stringify(captionParts(hit[0].line, ms, null).parts);
    return send(hit[0].line, hit[0].audio, cues, ms);
  }

  const used = await sql`SELECT COUNT(*)::int AS n FROM preshow_voice WHERE created_at > now() - interval '24 hours'`;
  if (used[0].n >= VOICE_DAILY_CAP) return res.status(429).json({ error: 'The voice has reached its daily limit.' });

  let line = fixed, leader = null;
  if (!fixed) {
    const [top, cnt, prev] = await Promise.all([
      sql`SELECT id, name, score FROM preshow_players WHERE show = ${show} ORDER BY score DESC, id ASC LIMIT 3`,
      sql`SELECT COUNT(*)::int AS n FROM preshow_players WHERE show = ${show}`,
      sql`SELECT leader FROM preshow_voice WHERE show = ${show} AND slot LIKE 'mid:%' ORDER BY created_at DESC LIMIT 1`,
    ]);
    leader = top.length && top[0].score > 0 ? top[0].id : null;
    const newLeader = prev.length > 0 && prev[0].leader !== null && leader !== null && prev[0].leader !== leader;
    line = composeLine(kind, top, cnt[0].n, t.s, newLeader);
  }

  let got = null, usedModel = '', problem = { status: 504, detail: 'no answer' };
  for (const model of VOICE_MODELS) {
    const text = TAG_MODELS.test(model) ? line : line.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim();
    const r = await speak(key, model, text);
    if (r.ok) { got = r; usedModel = model; break; }
    problem = r; console.error('preshow voice', model, r.status, r.detail);
    if (r.status === 401 || r.status === 429) break;                   // a bad key or an exhausted quota will not improve with another model
  }
  if (!got) return res.status(502).json({ error: 'The voice service refused the request.', status: problem.status, detail: problem.detail });
  const ms = Math.round(Buffer.from(got.b64, 'base64').length / 16);
  const cap = captionParts(line, ms, got.alignment);
  const cues = JSON.stringify(cap.parts);
  await sql`INSERT INTO preshow_voice (show, slot, line, leader, audio, cues, ms) VALUES (${rowShow}, ${slot}, ${line}, ${leader}, ${got.b64}, ${cues}, ${ms}) ON CONFLICT (show, slot) DO NOTHING`;
  res.setHeader('X-Voice-Model', usedModel);
  res.setHeader('X-Voice-Chars', String(line.length));
  if (got.cost) res.setHeader('X-Voice-Cost', String(got.cost));       // credits ElevenLabs charged for this line
  res.setHeader('X-Voice-Captions', cap.exact ? 'timed' : 'estimated');
  return send(line, got.b64, cues, ms);
}

export const config = { maxDuration: 30 };

const HANDLERS = { state, join, answer, results, reset, announce, pair, claim, admin, kick };

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
