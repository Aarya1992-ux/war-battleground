-- War Battleground — COMPLETE DATABASE SCHEMA
-- Run this once against your Postgres database

-- Users table (updated with coins and referrals)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(24) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  friend_code VARCHAR(8) UNIQUE NOT NULL,
  rating INTEGER NOT NULL DEFAULT 1000,
  rank_tier VARCHAR(16) NOT NULL DEFAULT 'Bronze',
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 1000,
  gems INTEGER NOT NULL DEFAULT 1000,
  reward_streak INTEGER NOT NULL DEFAULT 0,
  last_reward_at TIMESTAMPTZ,
  referrer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  total_referrals INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Coin transactions (track all coin movements)
CREATE TABLE IF NOT EXISTS coin_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason VARCHAR(32) NOT NULL,
  related_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  game_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invites system (sign up only with invite)
CREATE TABLE IF NOT EXISTS invites (
  id SERIAL PRIMARY KEY,
  code VARCHAR(12) UNIQUE NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Referrals tracking
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reward_claimed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cosmetics
CREATE TABLE IF NOT EXISTS cosmetics (
  id SERIAL PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  color_hex VARCHAR(7),
  cost_gems INTEGER NOT NULL,
  rarity VARCHAR(16) NOT NULL DEFAULT 'common',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id INTEGER REFERENCES cosmetics(id) ON DELETE CASCADE,
  equipped BOOLEAN DEFAULT FALSE,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cosmetic_id)
);

-- Battle Pass
CREATE TABLE IF NOT EXISTS battle_pass (
  id SERIAL PRIMARY KEY,
  season INTEGER NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  reward_tiers INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS battle_pass_progress (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  season INTEGER REFERENCES battle_pass(season) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, season)
);

-- Campaign
CREATE TABLE IF NOT EXISTS campaign_progress (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  completed BOOLEAN DEFAULT FALSE,
  best_time INTEGER,
  PRIMARY KEY (user_id)
);

-- Clans
CREATE TABLE IF NOT EXISTS clans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(32) UNIQUE NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clan_members (
  clan_id INTEGER REFERENCES clans(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_id, user_id)
);

-- Games
CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  player_a_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  player_b_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  winner VARCHAR(4),
  mode VARCHAR(16) NOT NULL DEFAULT 'online',
  duration_sec INTEGER,
  replay_data TEXT,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Analytics
CREATE TABLE IF NOT EXISTS analytics (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event VARCHAR(64) NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Friendships
CREATE TABLE IF NOT EXISTS friendships (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_rating ON users (rating DESC);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users (rank_tier);
CREATE INDEX IF NOT EXISTS idx_cosmetics_type ON cosmetics (type);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics (event);
CREATE INDEX IF NOT EXISTS idx_games_players ON games (player_a_id, player_b_id);
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user ON coin_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);

-- Sample data
INSERT INTO cosmetics (type, name, description, cost_gems, rarity) VALUES
('soldier_skin', 'Shadow Warrior', 'Dark mysterious armor', 250, 'rare'),
('soldier_skin', 'Golden Guardian', 'Gleaming gold armor', 500, 'epic'),
('board_theme', 'Neon Cyberpunk', 'Futuristic sci-fi board', 300, 'rare'),
('board_theme', 'Forest Green', 'Nature-inspired board', 200, 'common'),
('emote', 'Victory Salute', 'Celebrate your win', 100, 'common'),
('emote', 'Thinking Emoji', 'Strategic thinking pose', 150, 'common')
ON CONFLICT DO NOTHING;

INSERT INTO battle_pass (season, name, start_date, end_date, reward_tiers) 
VALUES (1, 'Season 1: The Battleground', now(), now() + interval '90 days', 50)
ON CONFLICT DO NOTHING;


