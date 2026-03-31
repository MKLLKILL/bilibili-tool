/**
 * auth.js - B站账号认证模块 (F1.1)
 *
 * 负责：
 * - 使用 Playwright persistent context 管理登录态
 * - 支持扫码登录（headless: false，弹出浏览器窗口）
 * - Cookie 持久化到 ./browser-profiles/default
 * - 检测登录状态，过期时提示重新登录
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const config = require('../config/default.json');

chromium.use(stealth());

const PROFILE_DIR = path.resolve(config.browser.profileDir);
const BILIBILI_LOGIN_CHECK = 'https://api.bilibili.com/x/web-interface/nav';
const COOKIE_FILE = path.resolve('cookie.json');

let sharedContext = null; // 全局共享的 BrowserContext

/**
 * 将 cookie.json（键值对格式）转为 Playwright cookie 数组并注入 context
 */
async function importCookiesIfPresent(context) {
  if (!fs.existsSync(COOKIE_FILE)) return;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  } catch (e) {
    console.warn('[Auth] cookie.json 解析失败，跳过导入:', e.message);
    return;
  }

  const BILIBILI_DOMAINS = ['.bilibili.com', '.bilivideo.com'];
  const cookies = Object.entries(raw).map(([name, value]) => ({
    name,
    value: String(value),
    domain: '.bilibili.com',
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }));

  await context.addCookies(cookies);
  console.log(`[Auth] 已从 cookie.json 导入 ${cookies.length} 个 cookie`);
}

/**
 * 获取（或创建）共享 BrowserContext
 * 所有监控任务共用同一个 persistent context 以复用登录态
 */
async function getSharedContext() {
  if (sharedContext) return sharedContext;

  // 确保 profile 目录存在
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  sharedContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: config.browser.headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    userAgent: config.browser.userAgent,
    viewport: config.browser.viewport,
  });

  sharedContext.on('close', () => {
    sharedContext = null;
  });

  // 导入 cookie.json（若存在）
  await importCookiesIfPresent(sharedContext);

  return sharedContext;
}

/**
 * 检查当前 context 是否已登录
 * @returns {Promise<{loggedIn: boolean, uid?: string, uname?: string}>}
 */
async function checkLoginStatus() {
  const context = await getSharedContext();
  const page = await context.newPage();
  try {
    const resp = await page.goto(BILIBILI_LOGIN_CHECK, { waitUntil: 'networkidle' });
    const json = await resp.json();
    if (json?.code === 0 && json?.data?.isLogin) {
      return {
        loggedIn: true,
        uid: String(json.data.mid),
        uname: json.data.uname,
      };
    }
    return { loggedIn: false };
  } catch (err) {
    return { loggedIn: false };
  } finally {
    await page.close();
  }
}

/**
 * 触发扫码登录流程：
 * 打开 B站登录页，等待用户扫码（检测到 isLogin=true 或页面跳转）
 * @returns {Promise<{uid: string, uname: string}>}
 */
async function triggerLogin() {
  const context = await getSharedContext();
  const page = await context.newPage();
  await page.goto('https://passport.bilibili.com/login', { waitUntil: 'domcontentloaded' });

  console.log('[Auth] 请在弹出的浏览器窗口中扫码登录 B站...');

  // 轮询检测登录成功
  const result = await new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const resp = await page.evaluate(async () => {
          const r = await fetch('https://api.bilibili.com/x/web-interface/nav');
          return r.json();
        });
        if (resp?.code === 0 && resp?.data?.isLogin) {
          clearInterval(timer);
          resolve({ uid: String(resp.data.mid), uname: resp.data.uname });
        }
      } catch (_) {}
    }, 2000);

    // 超时 5 分钟
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error('登录超时，请重试'));
    }, 300000);
  });

  await page.close();
  console.log(`[Auth] 登录成功：${result.uname} (UID: ${result.uid})`);
  return result;
}

/**
 * 关闭共享 context（清理用）
 */
async function closeContext() {
  if (sharedContext) {
    await sharedContext.close();
    sharedContext = null;
  }
}

module.exports = { getSharedContext, checkLoginStatus, triggerLogin, closeContext };
