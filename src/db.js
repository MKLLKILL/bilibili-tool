/**
 * db.js - SQLite 数据库初始化与访问 (F2.4)
 *
 * 使用 Node.js 24 内置 node:sqlite（同步 API，无需编译），WAL 模式。
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');
const config = require('../config/default.json');

const DB_PATH = path.resolve(config.database.path);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL 模式 + 外键约束
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── 建表 ────────────────────────────────────────────────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS realtime_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT    NOT NULL,
  uid         TEXT    NOT NULL,
  uname       TEXT,
  event_type  TEXT    NOT NULL,
  content     TEXT,
  ts          INTEGER NOT NULL,
  created_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_events_room_uid ON realtime_events(room_id, uid);
CREATE INDEX IF NOT EXISTS idx_events_ts        ON realtime_events(ts);

CREATE TABLE IF NOT EXISTS danmu_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id         TEXT    NOT NULL,
  uid             TEXT    NOT NULL,
  uname           TEXT,
  content         TEXT    NOT NULL,
  ts              INTEGER NOT NULL,
  msg_type        INTEGER DEFAULT 0,
  score           INTEGER,
  medal_name      TEXT,
  medal_level     INTEGER,
  medal_anchor_id TEXT,
  guard_level     INTEGER DEFAULT 0,
  is_admin        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_danmu_room_uid ON danmu_records(room_id, uid);

CREATE TABLE IF NOT EXISTS gift_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT    NOT NULL,
  uid         TEXT    NOT NULL,
  uname       TEXT,
  gift_type   TEXT    NOT NULL,
  gift_name   TEXT,
  gift_count  INTEGER DEFAULT 1,
  coin_type   TEXT,
  total_coin  INTEGER,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gift_room_uid ON gift_records(room_id, uid);

CREATE TABLE IF NOT EXISTS enter_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT    NOT NULL,
  uid         TEXT    NOT NULL,
  uname       TEXT,
  ts          INTEGER NOT NULL,
  medal_name  TEXT,
  medal_level INTEGER
);
CREATE INDEX IF NOT EXISTS idx_enter_room_uid ON enter_records(room_id, uid);

CREATE TABLE IF NOT EXISTS user_stats (
  uid                 TEXT    NOT NULL,
  room_id             TEXT    NOT NULL,
  uname               TEXT,
  danmu_count         INTEGER DEFAULT 0,
  total_spend_gold    INTEGER DEFAULT 0,
  sc_count            INTEGER DEFAULT 0,
  guard_level         INTEGER DEFAULT 0,
  enter_count         INTEGER DEFAULT 0,
  medal_level         INTEGER DEFAULT 0,
  medal_anchor_id     TEXT,
  last_active_ts      INTEGER,
  first_seen_ts       INTEGER,
  updated_at          INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (uid, room_id)
);

CREATE TABLE IF NOT EXISTS user_profiles (
  uid               TEXT    NOT NULL,
  room_id           TEXT    NOT NULL DEFAULT '',
  analysis_level    INTEGER,
  personality_tags  TEXT,
  consumption_tags  TEXT,
  llm_summary       TEXT,
  value_quadrant    TEXT,
  confidence        REAL,
  analyzed_at       INTEGER,
  PRIMARY KEY (uid, room_id)
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id    TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  status     TEXT DEFAULT 'idle',
  added_at   INTEGER DEFAULT (unixepoch())
);
`);

// ─── 预编译语句封装 ───────────────────────────────────────────────────────────
// node:sqlite 用 positional ? 绑定，返回 { changes, lastInsertRowid }
// all() 返回数组，get() 返回单行

const stmts = {
  insertEvent: db.prepare(`
    INSERT INTO realtime_events (room_id, uid, uname, event_type, content, ts)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  insertDanmu: db.prepare(`
    INSERT INTO danmu_records
      (room_id, uid, uname, content, ts, msg_type, score,
       medal_name, medal_level, medal_anchor_id, guard_level, is_admin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  insertGift: db.prepare(`
    INSERT INTO gift_records
      (room_id, uid, uname, gift_type, gift_name, gift_count, coin_type, total_coin, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  insertEnter: db.prepare(`
    INSERT INTO enter_records (room_id, uid, uname, ts, medal_name, medal_level)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  upsertUserStats: db.prepare(`
    INSERT INTO user_stats
      (uid, room_id, uname, danmu_count, total_spend_gold, sc_count,
       guard_level, enter_count, medal_level, medal_anchor_id,
       last_active_ts, first_seen_ts, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(uid, room_id) DO UPDATE SET
      uname            = excluded.uname,
      danmu_count      = danmu_count      + excluded.danmu_count,
      total_spend_gold = total_spend_gold + excluded.total_spend_gold,
      sc_count         = sc_count         + excluded.sc_count,
      guard_level      = MAX(guard_level,   excluded.guard_level),
      enter_count      = enter_count      + excluded.enter_count,
      medal_level      = MAX(medal_level,   excluded.medal_level),
      medal_anchor_id  = COALESCE(excluded.medal_anchor_id, medal_anchor_id),
      last_active_ts   = MAX(last_active_ts, excluded.last_active_ts),
      first_seen_ts    = COALESCE(first_seen_ts, excluded.first_seen_ts),
      updated_at       = unixepoch()
  `),

  getRoomUsers: db.prepare(`
    SELECT uid, uname, danmu_count, total_spend_gold, sc_count,
           guard_level, enter_count, medal_level, last_active_ts
    FROM user_stats
    WHERE room_id = ?
    ORDER BY total_spend_gold DESC, danmu_count DESC
  `),

  getUser: db.prepare(`SELECT * FROM user_stats WHERE uid = ?`),

  listRooms: db.prepare(`SELECT * FROM rooms ORDER BY added_at DESC`),

  addRoom: db.prepare(`INSERT OR IGNORE INTO rooms (room_id, url) VALUES (?, ?)`),

  removeRoom: db.prepare(`DELETE FROM rooms WHERE room_id = ?`),

  updateRoomStatus: db.prepare(`UPDATE rooms SET status = ? WHERE room_id = ?`),

  pruneEvents: db.prepare(`DELETE FROM realtime_events WHERE created_at < unixepoch() - (? * 86400)`),
  pruneDanmu:  db.prepare(`DELETE FROM danmu_records   WHERE ts          < unixepoch() - (? * 86400)`),
  pruneGifts:  db.prepare(`DELETE FROM gift_records    WHERE ts          < unixepoch() - (? * 86400)`),
  pruneEnter:  db.prepare(`DELETE FROM enter_records   WHERE ts          < unixepoch() - (? * 86400)`),
};

// ─── 包装函数（统一调用接口）────────────────────────────────────────────────

const db_api = {
  insertEvent(r)  { stmts.insertEvent.run(r.room_id, r.uid, r.uname, r.event_type, r.content, r.ts); },

  insertDanmu(r)  {
    stmts.insertDanmu.run(
      r.room_id, r.uid, r.uname, r.content, r.ts, r.msg_type, r.score ?? null,
      r.medal_name ?? null, r.medal_level ?? null, r.medal_anchor_id ?? null,
      r.guard_level, r.is_admin
    );
  },

  insertGift(r)   {
    stmts.insertGift.run(
      r.room_id, r.uid, r.uname, r.gift_type, r.gift_name ?? null,
      r.gift_count, r.coin_type ?? null, r.total_coin ?? null, r.ts
    );
  },

  insertEnter(r)  {
    stmts.insertEnter.run(r.room_id, r.uid, r.uname, r.ts, r.medal_name ?? null, r.medal_level ?? null);
  },

  upsertUserStats(r) {
    stmts.upsertUserStats.run(
      r.uid, r.room_id, r.uname,
      r.danmu_count, r.total_spend_gold, r.sc_count,
      r.guard_level, r.enter_count, r.medal_level, r.medal_anchor_id ?? null,
      r.last_active_ts, r.first_seen_ts
    );
  },

  getRoomUsers(room_id)  { return stmts.getRoomUsers.all(room_id); },
  getUser(uid)           { return stmts.getUser.all(uid); },
  listRooms()            { return stmts.listRooms.all(); },
  addRoom(room_id, url)  { stmts.addRoom.run(room_id, url); },
  removeRoom(room_id)    { stmts.removeRoom.run(room_id); },
  updateRoomStatus(status, room_id) { stmts.updateRoomStatus.run(status, room_id); },

  pruneOldData() {
    const r = config.database.retentionDays;
    stmts.pruneEvents.run(r.realtimeEvents);
    stmts.pruneDanmu.run(r.danmuRecords);
    stmts.pruneGifts.run(r.giftRecords);
    stmts.pruneEnter.run(r.enterRecords);
    console.log('[DB] 过期数据清理完成');
  },
};

module.exports = { db, stmts: db_api, pruneOldData: db_api.pruneOldData.bind(db_api) };
