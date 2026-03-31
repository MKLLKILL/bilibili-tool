/**
 * collector.js - 弹幕与事件采集模块 (F2.1, F2.2, F2.3)
 *
 * 每个直播间独立一个 Playwright Page（共享 persistent context）。
 * 双路采集：
 *   - 弹幕 → DOM MutationObserver（选择器已验证）
 *   - 礼物/SC/上舰/入场 → bilibili-live-ws WebSocket
 * 防风控：定期行为模拟（鼠标移动/滚动）
 * 断线重连：指数退避
 */

const { getSharedContext } = require('./auth');
const { stmts } = require('./db');
const { sseEmit } = require('./sse');
const config = require('../config/default.json');
const selectors = require('../config/selectors.json');
const { LiveWS } = require('bilibili-live-ws');
const path = require('path');
const fs = require('fs');

// roomId -> { page, ws, retryCount, retryTimer, healthTimer, behaviorTimer, active }
const activeRooms = new Map();

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseRoomId(urlOrId) {
  const m = String(urlOrId).match(/live\.bilibili\.com\/(\d+)/);
  return m ? m[1] : String(urlOrId).replace(/\D/g, '');
}

/**
 * 计算大航海等级（通过 CSS --borderColor 变量）
 * 1=总督 2=提督 3=舰长
 */
function parseGuardLevel(borderColor) {
  if (!borderColor) return 0;
  if (borderColor.includes('#58A1F8') || borderColor.includes('#4C7DFF')) return 3;
  if (borderColor.includes('#D47AFF') || borderColor.includes('#A773F1')) return 2;
  if (borderColor.includes('#F8C558')) return 1;
  return 0;
}

// ─── 弹幕入库 ─────────────────────────────────────────────────────────────────

function ingestDanmaku(roomId, payload) {
  const row = {
    room_id:         roomId,
    uid:             payload.uid        || '',
    uname:           payload.uname      || '',
    content:         payload.danmaku    || '',
    ts:              Number(payload.ts) || Math.floor(Date.now() / 1000),
    msg_type:        Number(payload.type) || 0,
    score:           payload.score ? Number(payload.score) : null,
    medal_name:      payload.medal_name      || null,
    medal_level:     payload.medal_level     ? Number(payload.medal_level) : null,
    medal_anchor_id: payload.medal_anchor_id || null,
    guard_level:     payload.guard_level     || 0,
    is_admin:        payload.is_admin ? 1 : 0,
  };

  stmts.insertDanmu(row);
  stmts.insertEvent({ room_id: roomId, uid: row.uid, uname: row.uname, event_type: 'danmaku', content: JSON.stringify(payload), ts: row.ts });
  stmts.upsertUserStats({ uid: row.uid, room_id: roomId, uname: row.uname, danmu_count: 1, total_spend_gold: 0, sc_count: 0, guard_level: row.guard_level, enter_count: 0, medal_level: row.medal_level || 0, medal_anchor_id: row.medal_anchor_id, last_active_ts: row.ts, first_seen_ts: row.ts });

  // SSE 推送
  sseEmit(roomId, {
    event: 'danmaku',
    data: {
      uid:         row.uid,
      uname:       row.uname,
      content:     row.content,
      ts:          row.ts,
      room_id:     roomId,
      msg_type:    row.msg_type,
      medal: row.medal_name ? {
        name:      row.medal_name,
        level:     row.medal_level,
        anchor_id: row.medal_anchor_id,
      } : null,
      guard_level: row.guard_level,
      score:       row.score,
    },
  });
}

function ingestGift(roomId, data) {
  const ts = Math.floor(Date.now() / 1000);
  stmts.insertGift({ room_id: roomId, uid: String(data.uid), uname: data.uname || '', gift_type: 'gift', gift_name: data.giftName || '', gift_count: data.num || 1, coin_type: data.coinType || 'gold', total_coin: data.totalCoin || 0, ts });
  stmts.insertEvent({ room_id: roomId, uid: String(data.uid), uname: data.uname || '', event_type: 'gift', content: JSON.stringify(data), ts });
  stmts.upsertUserStats({ uid: String(data.uid), room_id: roomId, uname: data.uname || '', danmu_count: 0, total_spend_gold: data.coinType === 'gold' ? (data.totalCoin || 0) : 0, sc_count: 0, guard_level: 0, enter_count: 0, medal_level: 0, medal_anchor_id: null, last_active_ts: ts, first_seen_ts: ts });
  sseEmit(roomId, { event: 'gift', data: { ...data, room_id: roomId, ts } });
}

function ingestSC(roomId, data) {
  const ts = Math.floor(Date.now() / 1000);
  stmts.insertGift({ room_id: roomId, uid: String(data.uid), uname: data.user_info?.uname || '', gift_type: 'sc', gift_name: 'SuperChat', gift_count: 1, coin_type: 'gold', total_coin: (data.price || 0) * 1000, ts });
  stmts.insertEvent({ room_id: roomId, uid: String(data.uid), uname: data.user_info?.uname || '', event_type: 'sc', content: JSON.stringify(data), ts });
  stmts.upsertUserStats({ uid: String(data.uid), room_id: roomId, uname: data.user_info?.uname || '', danmu_count: 0, total_spend_gold: (data.price || 0) * 1000, sc_count: 1, guard_level: 0, enter_count: 0, medal_level: 0, medal_anchor_id: null, last_active_ts: ts, first_seen_ts: ts });
  sseEmit(roomId, { event: 'sc', data: { ...data, room_id: roomId, ts } });
}

function ingestGuard(roomId, data) {
  const ts = Math.floor(Date.now() / 1000);
  // guard_level: 1=总督 2=提督 3=舰长（bilibili-live-ws 定义与PRD一致）
  stmts.insertGift({ room_id: roomId, uid: String(data.uid), uname: data.username || '', gift_type: 'guard', gift_name: data.gift_name || '', gift_count: data.num || 1, coin_type: 'gold', total_coin: (data.price || 0) * (data.num || 1), ts });
  stmts.insertEvent({ room_id: roomId, uid: String(data.uid), uname: data.username || '', event_type: 'guard', content: JSON.stringify(data), ts });
  stmts.upsertUserStats({ uid: String(data.uid), room_id: roomId, uname: data.username || '', danmu_count: 0, total_spend_gold: (data.price || 0) * (data.num || 1), sc_count: 0, guard_level: data.guard_level || 0, enter_count: 0, medal_level: 0, medal_anchor_id: null, last_active_ts: ts, first_seen_ts: ts });
  sseEmit(roomId, { event: 'guard', data: { ...data, room_id: roomId, ts } });
}

function ingestEnter(roomId, data) {
  const ts = Math.floor(Date.now() / 1000);
  stmts.insertEnter({ room_id: roomId, uid: String(data.uid), uname: data.uname || '', ts, medal_name: data.fans_medal?.medal_name || null, medal_level: data.fans_medal?.medal_level || null });
  stmts.insertEvent({ room_id: roomId, uid: String(data.uid), uname: data.uname || '', event_type: 'enter', content: JSON.stringify(data), ts });
  stmts.upsertUserStats({ uid: String(data.uid), room_id: roomId, uname: data.uname || '', danmu_count: 0, total_spend_gold: 0, sc_count: 0, guard_level: 0, enter_count: 1, medal_level: data.fans_medal?.medal_level || 0, medal_anchor_id: null, last_active_ts: ts, first_seen_ts: ts });
}

// ─── WebSocket（bilibili-live-ws）─────────────────────────────────────────────

function startWebSocket(roomId) {
  const ws = new LiveWS(Number(roomId));
  const roomState = activeRooms.get(roomId);
  if (roomState) roomState.ws = ws;

  ws.on('SEND_GIFT',          (data) => ingestGift(roomId, data?.data  || data));
  ws.on('SUPER_CHAT_MESSAGE', (data) => ingestSC(roomId,   data?.data  || data));
  ws.on('GUARD_BUY',          (data) => ingestGuard(roomId, data?.data || data));
  ws.on('INTERACT_WORD',      (data) => {
    const d = data?.data || data;
    if (d?.msg_type === 1) ingestEnter(roomId, d); // msg_type=1 为入场
  });

  ws.on('error', (err) => {
    console.error(`[WS][${roomId}] 错误:`, err.message);
  });
  ws.on('close', () => {
    console.warn(`[WS][${roomId}] 断开，稍后重连...`);
  });

  console.log(`[WS][${roomId}] WebSocket 已连接`);
  return ws;
}

// ─── Playwright 弹幕采集 ──────────────────────────────────────────────────────

async function injectMutationObserver(page, roomId) {
  // 将回调暴露到页面
  await page.exposeFunction('__biliInsightDanmaku', async (payload) => {
    // 随机延迟防高频
    await new Promise(r => setTimeout(r,
      randomInt(
        config.collection.danmakuCallbackDelayMin,
        config.collection.danmakuCallbackDelayMax
      )
    ));
    ingestDanmaku(roomId, payload);
  });

  await page.evaluate((sel) => {
    const container = document.getElementById('chat-items');
    if (!container) {
      console.warn('[BiliInsight] 未找到 #chat-items，弹幕监听未启动');
      return;
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (!node.classList.contains('danmaku-item')) continue;
          const el = node;
          const medalEl  = el.querySelector('.fans-medal-item-ctnr');
          const guardEl  = el.querySelector('.fans-medal-label.medal-guard');
          const medalItem = el.querySelector('.fans-medal-item');
          const borderColor = medalItem?.style?.getPropertyValue('--borderColor') || '';

          let guardLevel = 0;
          if (borderColor.includes('#58A1F8') || borderColor.includes('#4C7DFF')) guardLevel = 3;
          else if (borderColor.includes('#D47AFF') || borderColor.includes('#A773F1')) guardLevel = 2;
          else if (borderColor.includes('#F8C558')) guardLevel = 1;

          const payload = {
            uid:             el.dataset.uid,
            uname:           el.dataset.uname,
            danmaku:         el.dataset.danmaku,
            ts:              el.dataset.ts,
            type:            el.dataset.type,
            score:           el.dataset.score,
            id_str:          el.dataset.id_str,
            medal_name:      el.querySelector('.fans-medal-content')?.textContent?.trim() || null,
            medal_level:     el.querySelector('.fans-medal-level-font')?.textContent?.trim() || null,
            medal_anchor_id: medalEl?.dataset?.anchorId || null,
            is_guard:        !!guardEl,
            guard_level:     guardLevel,
            is_admin:        !!el.querySelector('.admin-icon'),
            image_url:       el.dataset.image || null,
          };
          window.__biliInsightDanmaku(payload);
        }
      }
    });
    observer.observe(container, { childList: true });
    console.log('[BiliInsight] 弹幕 MutationObserver 已启动');
  }, selectors);
}

// ─── 行为模拟（防风控）──────────────────────────────────────────────────────

function startBehaviorSimulation(page, roomId) {
  const { minIntervalMs, maxIntervalMs } = config.collection.behaviorSimulation;
  async function simulate() {
    try {
      if (page.isClosed()) return;
      // 随机鼠标移动
      await page.mouse.move(
        randomInt(100, 1100),
        randomInt(100, 600)
      );
      // 随机滚动
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() > 0.5 ? 50 : -50);
      });
    } catch (_) {}
    const delay = randomInt(minIntervalMs, maxIntervalMs);
    const roomState = activeRooms.get(roomId);
    if (roomState?.active) {
      roomState.behaviorTimer = setTimeout(simulate, delay);
    }
  }
  const delay = randomInt(minIntervalMs, maxIntervalMs);
  const roomState = activeRooms.get(roomId);
  if (roomState) {
    roomState.behaviorTimer = setTimeout(simulate, delay);
  }
}

// ─── 健康检查 ─────────────────────────────────────────────────────────────────

function startHealthCheck(page, roomId) {
  const intervalMs = config.collection.healthCheckIntervalMs;
  async function check() {
    const roomState = activeRooms.get(roomId);
    if (!roomState?.active) return;
    try {
      if (page.isClosed()) throw new Error('page closed');
      const found = await page.$('#chat-items');
      if (!found) {
        console.warn(`[Health][${roomId}] #chat-items 消失，刷新页面...`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#chat-items', { timeout: 15000 });
        await injectMutationObserver(page, roomId);
      }
    } catch (err) {
      console.error(`[Health][${roomId}] 健康检查失败:`, err.message);
      await restartRoom(roomId);
      return;
    }
    roomState.healthTimer = setTimeout(check, intervalMs);
  }
  const roomState = activeRooms.get(roomId);
  if (roomState) {
    roomState.healthTimer = setTimeout(check, intervalMs);
  }
}

// ─── 启动 / 停止直播间采集 ───────────────────────────────────────────────────

async function startRoom(roomId) {
  if (activeRooms.has(roomId)) {
    console.log(`[Collector] 房间 ${roomId} 已在采集中`);
    return;
  }

  const roomState = {
    page:          null,
    ws:            null,
    retryCount:    0,
    retryTimer:    null,
    healthTimer:   null,
    behaviorTimer: null,
    active:        true,
  };
  activeRooms.set(roomId, roomState);

  const liveUrl = `https://live.bilibili.com/${roomId}`;
  const context = await getSharedContext();

  // 间隔启动，防止并发请求
  await new Promise(r => setTimeout(r, config.browser.startDelayMs));

  const page = await context.newPage();
  roomState.page = page;

  page.on('close', () => {
    if (roomState.active) {
      console.warn(`[Collector][${roomId}] 页面关闭，尝试重连...`);
      scheduleRetry(roomId);
    }
  });

  try {
    await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#chat-items', { timeout: 15000 });
    await injectMutationObserver(page, roomId);
    startBehaviorSimulation(page, roomId);
    startHealthCheck(page, roomId);
    startWebSocket(roomId);
    roomState.retryCount = 0;
    console.log(`[Collector][${roomId}] 采集已启动`);
  } catch (err) {
    console.error(`[Collector][${roomId}] 启动失败:`, err.message);
    await page.close().catch(() => {});
    scheduleRetry(roomId);
  }
}

async function stopRoom(roomId) {
  const roomState = activeRooms.get(roomId);
  if (!roomState) return;
  roomState.active = false;
  clearTimeout(roomState.retryTimer);
  clearTimeout(roomState.healthTimer);
  clearTimeout(roomState.behaviorTimer);
  roomState.ws?.close();
  await roomState.page?.close().catch(() => {});
  activeRooms.delete(roomId);
  console.log(`[Collector][${roomId}] 采集已停止`);
}

async function restartRoom(roomId) {
  const roomState = activeRooms.get(roomId);
  if (!roomState) return;
  clearTimeout(roomState.healthTimer);
  clearTimeout(roomState.behaviorTimer);
  roomState.ws?.close();
  await roomState.page?.close().catch(() => {});
  roomState.page = null;
  roomState.ws   = null;
  scheduleRetry(roomId);
}

function scheduleRetry(roomId) {
  const roomState = activeRooms.get(roomId);
  if (!roomState || !roomState.active) return;

  const { initialDelayMs, maxDelayMs, maxRetries } = config.collection.reconnect;
  if (roomState.retryCount >= maxRetries) {
    console.error(`[Collector][${roomId}] 已达最大重试次数 ${maxRetries}，停止重连`);
    roomState.active = false;
    activeRooms.delete(roomId);
    return;
  }

  const delay = Math.min(initialDelayMs * Math.pow(2, roomState.retryCount), maxDelayMs);
  roomState.retryCount++;
  console.log(`[Collector][${roomId}] 第 ${roomState.retryCount} 次重连，延迟 ${delay}ms`);

  roomState.retryTimer = setTimeout(async () => {
    activeRooms.delete(roomId);
    await startRoom(roomId);
  }, delay);
}

function getRoomStatus(roomId) {
  const roomState = activeRooms.get(roomId);
  if (!roomState) return 'idle';
  if (!roomState.active) return 'stopping';
  if (!roomState.page) return 'connecting';
  return 'running';
}

module.exports = { startRoom, stopRoom, getRoomStatus, activeRooms, parseRoomId };
