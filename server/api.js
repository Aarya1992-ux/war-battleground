import express from "express";
import { getPool } from "./db/pool.js";
import { hashPassword, verifyPassword, signToken, genFriendCode, authMiddleware } from "./auth.js";

const router = express.Router();
router.use(express.json());

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

// ---------- Auth ----------
router.post("/auth/register", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "Username must be 3-24 letters/numbers/underscore" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const pool = getPool();
  const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rows.length) return res.status(409).json({ error: "That username is already taken" });

  let friendCode;
  for (let i = 0; i < 5; i++) {
    friendCode = genFriendCode();
    const clash = await pool.query("SELECT 1 FROM users WHERE friend_code = $1", [friendCode]);
    if (!clash.rows.length) break;
  }

  const passwordHash = hashPassword(password);
  const result = await pool.query(
    "INSERT INTO users (username, password_hash, friend_code) VALUES ($1,$2,$3) RETURNING id, username, friend_code, rating, coins",
    [username, passwordHash, friendCode]
  );
  const user = result.rows[0];
  res.json({ token: signToken(user), user });
});

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const pool = getPool();
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  const row = result.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) return res.status(401).json({ error: "Invalid username or password" });
  res.json({
    token: signToken(row),
    user: { id: row.id, username: row.username, friend_code: row.friend_code, rating: row.rating, coins: row.coins },
  });
});

router.get("/me", authMiddleware, async (req, res) => {
  const pool = getPool();
  const result = await pool.query(
    "SELECT id, username, friend_code, rating, wins, losses, draws, coins, reward_streak, last_reward_at FROM users WHERE id = $1",
    [req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "User not found" });
  res.json({ user: result.rows[0] });
});

// ---------- Leaderboard ----------
router.get("/leaderboard", async (req, res) => {
  const pool = getPool();
  const result = await pool.query(
    "SELECT username, rating, wins, losses, draws FROM users ORDER BY rating DESC LIMIT 50"
  );
  res.json({ leaderboard: result.rows });
});

// ---------- Game results (feeds ranking) ----------
const K_FACTOR = 24;
function expectedScore(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }

router.post("/game/result", authMiddleware, async (req, res) => {
  const { opponentUsername, result, mode } = req.body || {}; // result: 'win' | 'loss' | 'draw'
  if (!["win", "loss", "draw"].includes(result)) return res.status(400).json({ error: "Invalid result" });
  const pool = getPool();

  const meRes = await pool.query("SELECT id, rating FROM users WHERE id = $1", [req.user.id]);
  const me = meRes.rows[0];
  if (!me) return res.status(404).json({ error: "User not found" });

  let oppRating = 1000, oppId = null;
  if (opponentUsername) {
    const oppRes = await pool.query("SELECT id, rating FROM users WHERE username = $1", [opponentUsername]);
    if (oppRes.rows.length) { oppRating = oppRes.rows[0].rating; oppId = oppRes.rows[0].id; }
  }

  const score = result === "win" ? 1 : result === "loss" ? 0 : 0.5;
  const expected = expectedScore(me.rating, oppRating);
  const newRating = Math.round(me.rating + K_FACTOR * (score - expected));

  const col = result === "win" ? "wins" : result === "loss" ? "losses" : "draws";
  await pool.query(`UPDATE users SET rating = $1, ${col} = ${col} + 1 WHERE id = $2`, [newRating, me.id]);
  await pool.query(
    "INSERT INTO games (player_a_id, player_b_id, winner, mode) VALUES ($1,$2,$3,$4)",
    [me.id, oppId, result === "win" ? "A" : result === "loss" ? "B" : "Draw", mode || "online"]
  );

  res.json({ newRating, delta: newRating - me.rating });
});

// ---------- Daily rewards ----------
router.get("/rewards/status", authMiddleware, async (req, res) => {
  const pool = getPool();
  const result = await pool.query("SELECT coins, reward_streak, last_reward_at FROM users WHERE id = $1", [req.user.id]);
  const row = result.rows[0];
  const now = Date.now();
  const last = row.last_reward_at ? new Date(row.last_reward_at).getTime() : 0;
  const hoursSince = (now - last) / 36e5;
  res.json({ coins: row.coins, streak: row.reward_streak, canClaim: hoursSince >= 24, hoursUntilNext: Math.max(0, 24 - hoursSince) });
});

router.post("/rewards/claim", authMiddleware, async (req, res) => {
  const pool = getPool();
  const result = await pool.query("SELECT coins, reward_streak, last_reward_at FROM users WHERE id = $1", [req.user.id]);
  const row = result.rows[0];
  const now = Date.now();
  const last = row.last_reward_at ? new Date(row.last_reward_at).getTime() : 0;
  const hoursSince = (now - last) / 36e5;
  if (hoursSince < 24) return res.status(400).json({ error: "Already claimed today" });

  const streak = hoursSince <= 48 ? row.reward_streak + 1 : 1; // missed a day -> streak resets
  const reward = 10 + Math.min(streak, 7) * 5; // grows up to a 7-day cap
  await pool.query(
    "UPDATE users SET coins = coins + $1, reward_streak = $2, last_reward_at = now() WHERE id = $3",
    [reward, streak, req.user.id]
  );
  res.json({ reward, streak, coins: row.coins + reward });
});

// ---------- Friends ----------
router.get("/friends", authMiddleware, async (req, res) => {
  const pool = getPool();
  const result = await pool.query(
    `SELECT u.username, u.rating, u.friend_code
     FROM friendships f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = $1 ORDER BY u.rating DESC`,
    [req.user.id]
  );
  const meRes = await pool.query("SELECT friend_code FROM users WHERE id = $1", [req.user.id]);
  res.json({ friends: result.rows, myFriendCode: meRes.rows[0]?.friend_code });
});

router.post("/friends/add", authMiddleware, async (req, res) => {
  const { friendCode } = req.body || {};
  if (!friendCode) return res.status(400).json({ error: "Friend code required" });
  const pool = getPool();
  const target = await pool.query("SELECT id, username FROM users WHERE friend_code = $1", [friendCode.toUpperCase()]);
  if (!target.rows.length) return res.status(404).json({ error: "No player with that code" });
  const friendId = target.rows[0].id;
  if (friendId === req.user.id) return res.status(400).json({ error: "That's your own code" });

  await pool.query(
    "INSERT INTO friendships (user_id, friend_id) VALUES ($1,$2), ($2,$1) ON CONFLICT DO NOTHING",
    [req.user.id, friendId]
  );
  res.json({ added: target.rows[0].username });
});


// ---------- Cosmetics Shop ----------
router.get("/shop/cosmetics", async (req, res) => {
  const pool = getPool();
  const result = await pool.query(
    "SELECT id, type, name, description, color_hex, cost_gems, rarity FROM cosmetics ORDER BY rarity DESC, name"
  );
  res.json({ cosmetics: result.rows });
});

router.get("/cosmetics/owned", authMiddleware, async (req, res) => {
  const pool = getPool();
  const result = await pool.query(
    `SELECT c.id, c.type, c.name, c.color_hex, uc.equipped
     FROM user_cosmetics uc JOIN cosmetics c ON c.id = uc.cosmetic_id
     WHERE uc.user_id = $1 ORDER BY c.type, c.name`,
    [req.user.id]
  );
  res.json({ owned: result.rows });
});

router.post("/cosmetics/buy", authMiddleware, async (req, res) => {
  const { cosmeticId } = req.body || {};
  if (!cosmeticId) return res.status(400).json({ error: "Cosmetic ID required" });
  const pool = getPool();

  const cosm = await pool.query("SELECT cost_gems FROM cosmetics WHERE id = $1", [cosmeticId]);
  if (!cosm.rows.length) return res.status(404).json({ error: "Cosmetic not found" });
  const cost = cosm.rows[0].cost_gems;

  const user = await pool.query("SELECT gems FROM users WHERE id = $1", [req.user.id]);
  if (user.rows[0].gems < cost) return res.status(400).json({ error: "Not enough gems" });

  await pool.query(
    "INSERT INTO user_cosmetics (user_id, cosmetic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [req.user.id, cosmeticId]
  );
  await pool.query("UPDATE users SET gems = gems - $1 WHERE id = $2", [cost, req.user.id]);
  res.json({ success: true, gemsLeft: user.rows[0].gems - cost });
});

router.post("/cosmetics/equip", authMiddleware, async (req, res) => {
  const { cosmeticId, type } = req.body || {};
  if (!cosmeticId || !type) return res.status(400).json({ error: "Cosmetic ID and type required" });
  const pool = getPool();

  await pool.query("UPDATE user_cosmetics SET equipped = FALSE WHERE user_id = $1 AND cosmetic_id IN (SELECT id FROM cosmetics WHERE type = $2)", [req.user.id, type]);
  await pool.query("UPDATE user_cosmetics SET equipped = TRUE WHERE user_id = $1 AND cosmetic_id = $2", [req.user.id, cosmeticId]);
  res.json({ success: true });
});

// ---------- Battle Pass ----------
router.get("/battle-pass/current", authMiddleware, async (req, res) => {
  const pool = getPool();
  const bp = await pool.query(
    "SELECT id, season, name, start_date, end_date, reward_tiers FROM battle_pass WHERE end_date > now() ORDER BY season DESC LIMIT 1"
  );
  if (!bp.rows.length) return res.json({ season: null });
  const season = bp.rows[0].season;

  const progress = await pool.query(
    "SELECT level, xp, is_premium FROM battle_pass_progress WHERE user_id = $1 AND season = $2",
    [req.user.id, season]
  );
  const prog = progress.rows[0] || { level: 1, xp: 0, is_premium: false };

  res.json({ season: bp.rows[0], progress: prog });
});

router.post("/battle-pass/buy", authMiddleware, async (req, res) => {
  const pool = getPool();
  const bp = await pool.query(
    "SELECT season FROM battle_pass WHERE end_date > now() ORDER BY season DESC LIMIT 1"
  );
  if (!bp.rows.length) return res.status(400).json({ error: "No active season" });
  const season = bp.rows[0].season;

  const existing = await pool.query("SELECT is_premium FROM battle_pass_progress WHERE user_id = $1 AND season = $2", [req.user.id, season]);
  if (existing.rows.length && existing.rows[0].is_premium) return res.status(400).json({ error: "Already purchased" });

  const user = await pool.query("SELECT gems FROM users WHERE id = $1", [req.user.id]);
  const cost = 500; // gems
  if (user.rows[0].gems < cost) return res.status(400).json({ error: "Not enough gems" });

  if (!existing.rows.length) {
    await pool.query("INSERT INTO battle_pass_progress (user_id, season, is_premium) VALUES ($1, $2, TRUE)", [req.user.id, season]);
  } else {
    await pool.query("UPDATE battle_pass_progress SET is_premium = TRUE WHERE user_id = $1 AND season = $2", [req.user.id, season]);
  }
  await pool.query("UPDATE users SET gems = gems - $1 WHERE id = $2", [cost, req.user.id]);
  res.json({ success: true });
});

router.post("/battle-pass/progress", authMiddleware, async (req, res) => {
  const { xpGained } = req.body || {};
  if (!xpGained || xpGained < 0) return res.status(400).json({ error: "Invalid XP" });
  const pool = getPool();

  const bp = await pool.query(
    "SELECT season FROM battle_pass WHERE end_date > now() ORDER BY season DESC LIMIT 1"
  );
  if (!bp.rows.length) return res.status(400).json({ error: "No active season" });
  const season = bp.rows[0].season;

  const result = await pool.query(
    "SELECT level, xp FROM battle_pass_progress WHERE user_id = $1 AND season = $2",
    [req.user.id, season]
  );
  let prog = result.rows[0] || { level: 1, xp: 0 };

  prog.xp += xpGained;
  const xpPerLevel = 500;
  while (prog.xp >= xpPerLevel && prog.level < 50) {
    prog.xp -= xpPerLevel;
    prog.level += 1;
  }

  if (!result.rows.length) {
    await pool.query("INSERT INTO battle_pass_progress (user_id, season, level, xp) VALUES ($1, $2, $3, $4)", [req.user.id, season, prog.level, prog.xp]);
  } else {
    await pool.query("UPDATE battle_pass_progress SET level = $1, xp = $2 WHERE user_id = $3 AND season = $4", [prog.level, prog.xp, req.user.id, season]);
  }

  res.json({ level: prog.level, xp: prog.xp });
});

// ---------- Campaign ----------
router.get("/campaign/progress", authMiddleware, async (req, res) => {
  const pool = getPool();
  const result = await pool.query("SELECT level, completed, best_time FROM campaign_progress WHERE user_id = $1", [req.user.id]);
  const prog = result.rows[0] || { level: 1, completed: false, best_time: null };
  res.json({ campaign: prog });
});

router.post("/campaign/complete", authMiddleware, async (req, res) => {
  const { level, durationSec } = req.body || {};
  if (!level || level < 1 || level > 10) return res.status(400).json({ error: "Invalid level" });
  const pool = getPool();

  const result = await pool.query("SELECT level, best_time FROM campaign_progress WHERE user_id = $1", [req.user.id]);
  const current = result.rows[0];

  if (!current) {
    if (level === 1) {
      await pool.query("INSERT INTO campaign_progress (user_id, level, best_time, completed) VALUES ($1, $2, $3, $4)", [req.user.id, level, durationSec, level === 10]);
    } else {
      return res.status(400).json({ error: "Must complete level 1 first" });
    }
  } else {
    if (level !== current.level) return res.status(400).json({ error: "Wrong level" });
    const newBest = !current.best_time || durationSec < current.best_time ? durationSec : current.best_time;
    const nextLevel = level < 10 ? level + 1 : level;
    const completed = level === 10;
    await pool.query(
      "UPDATE campaign_progress SET level = $1, best_time = $2, completed = $3 WHERE user_id = $4",
      [nextLevel, newBest, completed, req.user.id]
    );
  }

  await apiFetch("/battle-pass/progress", { method: "POST", body: JSON.stringify({ xpGained: 100 }) }, token);
  res.json({ nextLevel: level + 1, reward: 100 });
});

// ---------- Clans ----------
router.post("/clans/create", authMiddleware, async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: "Clan name required" });
  const pool = getPool();

  const result = await pool.query(
    "INSERT INTO clans (name, owner_id, description) VALUES ($1, $2, $3) RETURNING id",
    [name, req.user.id, description || ""]
  );
  const clanId = result.rows[0].id;

  await pool.query("INSERT INTO clan_members (clan_id, user_id, role) VALUES ($1, $2, 'owner')", [clanId, req.user.id]);
  res.json({ clanId, name });
});

router.get("/clans/list", async (req, res) => {
  const pool = getPool();
  const result = await pool.query(
    `SELECT c.id, c.name, c.description, c.owner_id, COUNT(cm.user_id) as member_count
     FROM clans c LEFT JOIN clan_members cm ON c.id = cm.clan_id
     GROUP BY c.id ORDER BY member_count DESC LIMIT 50`
  );
  res.json({ clans: result.rows });
});

router.post("/clans/join", authMiddleware, async (req, res) => {
  const { clanId } = req.body || {};
  if (!clanId) return res.status(400).json({ error: "Clan ID required" });
  const pool = getPool();

  await pool.query("INSERT INTO clan_members (clan_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING", [clanId, req.user.id]);
  res.json({ success: true });
});

// ---------- Analytics ----------
router.post("/analytics", authMiddleware, async (req, res) => {
  const { event, data } = req.body || {};
  if (!event) return res.status(400).json({ error: "Event required" });
  const pool = getPool();
  await pool.query("INSERT INTO analytics (user_id, event, data) VALUES ($1, $2, $3)", [req.user.id, event, JSON.stringify(data || {})]);
  res.json({ success: true });
});

export default router;
