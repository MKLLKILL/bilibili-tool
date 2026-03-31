/**
 * routes.js - REST API 路由 (F2.1, F2.5, 4.1)
 *
 * 提供：
 *   GET    /api/rooms                          - 列出所有监控房间
 *   POST   /api/rooms                          - 添加房间
 *   DELETE /api/rooms/:room_id                 - 删除房间
 *   GET    /api/rooms/:room_id/status          - 采集状态
 *   POST   /api/rooms/:room_id/events/ingest   - 内部：注入弹幕（目前通过 exposeFunction 直接调，此端点备用）
 *   GET    /api/rooms/:room_id/users           - 用户统计列表
 *   GET    /api/rooms/:room_id/stream          - SSE 实时流
 *   GET    /api/users/:uid                     - 用户详情
 *   GET    /api/dashboard                      - 全部房间状态汇总
 */

const express = require('express');
const { stmts } = require('./db');
const { startRoom, stopRoom, getRoomStatus, parseRoomId } = require('./collector');
const { sseHandler } = require('./sse');
const { checkLoginStatus, triggerLogin } = require('./auth');

const router = express.Router();

// ─── 房间管理 ─────────────────────────────────────────────────────────────────

router.get('/rooms', (req, res) => {
  const rooms = stmts.listRooms();
  res.json({ rooms });
});

router.post('/rooms', async (req, res) => {
  const { url, room_id } = req.body;
  if (!url && !room_id) {
    return res.status(400).json({ error: '需要提供 url 或 room_id' });
  }

  const rid = room_id ? String(room_id) : parseRoomId(url);
  if (!rid) return res.status(400).json({ error: '无效的直播间地址' });

  const roomUrl = url || `https://live.bilibili.com/${rid}`;
  stmts.addRoom(rid, roomUrl);
  stmts.updateRoomStatus('connecting', rid);

  // 异步启动采集
  startRoom(rid).catch(err => {
    console.error(`[Route] 启动房间 ${rid} 失败:`, err.message);
  });

  res.json({ room_id: rid, url: roomUrl, status: 'connecting' });
});

router.delete('/rooms/:room_id', async (req, res) => {
  const { room_id } = req.params;
  await stopRoom(room_id);
  stmts.removeRoom(room_id);
  res.json({ ok: true });
});

router.get('/rooms/:room_id/status', (req, res) => {
  const { room_id } = req.params;
  const status = getRoomStatus(room_id);
  res.json({ room_id, status });
});

// ─── 内部弹幕注入（备用 HTTP 接口）──────────────────────────────────────────

router.post('/rooms/:room_id/events/ingest', (req, res) => {
  // 此接口供 page.exposeFunction 之外的调用方使用，正常采集走 exposeFunction
  const { room_id } = req.params;
  const payload = req.body;
  if (!payload || !payload.uid) {
    return res.status(400).json({ error: '缺少必要字段 uid' });
  }
  // 直接调用同样的 ingest 逻辑
  try {
    const { ingestDanmaku } = require('./collector');
    ingestDanmaku(room_id, payload);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 用户统计 ─────────────────────────────────────────────────────────────────

router.get('/rooms/:room_id/users', (req, res) => {
  const { room_id } = req.params;
  const users = stmts.getRoomUsers(room_id);
  res.json({ room_id, users });
});

router.get('/users/:uid', (req, res) => {
  const { uid } = req.params;
  const stats = stmts.getUser(uid);
  res.json({ uid, stats });
});

// ─── SSE 实时流 ───────────────────────────────────────────────────────────────

router.get('/rooms/:room_id/stream', sseHandler);

// ─── 仪表盘 ───────────────────────────────────────────────────────────────────

router.get('/dashboard', (req, res) => {
  const rooms = stmts.listRooms();
  const result = rooms.map(room => ({
    ...room,
    status: getRoomStatus(room.room_id),
  }));
  res.json({ rooms: result });
});

// ─── 账号管理 ─────────────────────────────────────────────────────────────────

router.get('/auth/status', async (req, res) => {
  const status = await checkLoginStatus();
  res.json(status);
});

router.post('/auth/login', async (req, res) => {
  try {
    const result = await triggerLogin();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
