/**
 * sse.js - Server-Sent Events 实时推送 (F2.1, F2.5)
 *
 * 每个直播间维护一个 SSE 订阅者列表，并保留最近 200 条事件缓冲。
 */

const config = require('../config/default.json');
const BUFFER_SIZE = config.collection.sseBufferSize;

// roomId -> { clients: Set<res>, buffer: Array }
const roomSessions = new Map();

function getOrCreate(roomId) {
  if (!roomSessions.has(roomId)) {
    roomSessions.set(roomId, { clients: new Set(), buffer: [] });
  }
  return roomSessions.get(roomId);
}

/**
 * 向某个直播间的所有 SSE 订阅者广播事件，并写入缓冲
 */
function sseEmit(roomId, payload) {
  const session = getOrCreate(roomId);
  const line = `data: ${JSON.stringify(payload)}\n\n`;

  // 维护缓冲区（最多 BUFFER_SIZE 条）
  session.buffer.push(payload);
  if (session.buffer.length > BUFFER_SIZE) {
    session.buffer.shift();
  }

  for (const res of session.clients) {
    try {
      res.write(line);
    } catch (_) {
      session.clients.delete(res);
    }
  }
}

/**
 * Express 路由处理器：GET /api/rooms/:room_id/stream
 */
function sseHandler(req, res) {
  const { room_id } = req.params;
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const session = getOrCreate(room_id);

  // 先把缓冲区事件推给新订阅者
  for (const payload of session.buffer) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  session.clients.add(res);

  req.on('close', () => {
    session.clients.delete(res);
  });
}

module.exports = { sseEmit, sseHandler };
