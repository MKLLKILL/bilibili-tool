/**
 * index.js - 应用入口
 *
 * 启动流程：
 * 1. 初始化数据库
 * 2. 检查登录状态（未登录则触发扫码）
 * 3. 启动 Express API 服务（localhost only）
 * 4. 恢复上次配置的房间监控
 * 5. 启动定期数据清理
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { checkLoginStatus, triggerLogin } = require('./auth');

// ─── 日志同时写入 logs/app.log（按天滚动，保留 7 天）──────────────────────────
const LOG_DIR = path.resolve('logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogPath() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return path.join(LOG_DIR, `app-${date}.log`);
}

function patchConsole() {
  const origLog   = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn  = console.warn.bind(console);

  function writeLine(level, args) {
    const ts   = new Date().toISOString();
    const line = `[${ts}] [${level}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`;
    try { fs.appendFileSync(getLogPath(), line); } catch (_) {}
  }

  console.log   = (...a) => { origLog(...a);   writeLine('INFO',  a); };
  console.error = (...a) => { origError(...a); writeLine('ERROR', a); };
  console.warn  = (...a) => { origWarn(...a);  writeLine('WARN',  a); };
}
patchConsole();

// 清理 7 天前的日志
function pruneOldLogs() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      const fp = path.join(LOG_DIR, f);
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
    }
  } catch (_) {}
}
pruneOldLogs();
const { stmts, pruneOldData } = require('./db');
const { startRoom } = require('./collector');
const routes = require('./routes');
const config = require('../config/default.json');

const app = express();
app.use(express.json());

// 仅允许 localhost 访问
app.use((req, res, next) => {
  const ip = req.socket.remoteAddress;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

app.use('/api', routes);

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[API Error]', err);
  res.status(500).json({ error: err.message });
});

async function main() {
  // 1. 检查/触发登录
  const authStatus = await checkLoginStatus();
  if (!authStatus.loggedIn) {
    console.log('[App] 未检测到登录态，请在弹出窗口中扫码登录...');
    await triggerLogin();
  } else {
    console.log(`[App] 已登录：${authStatus.uname} (UID: ${authStatus.uid})`);
  }

  // 2. 启动 API 服务
  const { port, host } = config.server;
  await new Promise(resolve => app.listen(port, host, resolve));
  console.log(`[App] API 服务已启动：http://${host}:${port}`);

  // 3. 恢复已配置的房间
  const rooms = stmts.listRooms();
  if (rooms.length > 0) {
    console.log(`[App] 恢复 ${rooms.length} 个直播间监控...`);
    for (const room of rooms) {
      await startRoom(room.room_id);
    }
  }

  // 4. 每天清理一次过期数据（启动时先跑一次）
  pruneOldData();
  setInterval(pruneOldData, 24 * 60 * 60 * 1000);
}

main().catch(err => {
  console.error('[App] 启动失败:', err);
  process.exit(1);
});
