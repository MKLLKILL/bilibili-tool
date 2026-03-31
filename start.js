/**
 * start.js - 一键启动脚本
 * 首次运行自动安装依赖和 Chromium，后续直接启动。
 */

const { spawnSync, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';

function ok(msg)   { console.log(`${GREEN}[OK]${RESET} ${msg}`); }
function info(msg) { console.log(`${YELLOW}[..]${RESET} ${msg}`); }
function fail(msg) { console.error(`${RED}[错误]${RESET} ${msg}`); }

console.log('============================================');
console.log('  BiliInsight');
console.log('============================================\n');

// 1. 安装 npm 依赖（仅首次）
if (!fs.existsSync('node_modules')) {
  info('首次运行，正在安装 npm 依赖...');
  const r = spawnSync('npm', ['install'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    fail('npm install 失败，请检查网络后重试');
    process.exit(1);
  }
  ok('npm 依赖安装完成');
}

// 2. 安装 Playwright Chromium（仅首次或缓存丢失）
function chromiumInstalled() {
  try {
    const { chromium } = require('playwright');
    return fs.existsSync(chromium.executablePath());
  } catch (_) {
    return false;
  }
}

if (!chromiumInstalled()) {
  info('正在安装 Playwright Chromium（首次约需 1-2 分钟）...');
  const pw = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    stdio: 'inherit',
    shell: true,
  });
  if (pw.status !== 0) {
    fail('Chromium 安装失败，请检查网络后重试');
    process.exit(1);
  }
  ok('Chromium 安装完成');
}

// 3. 创建必要目录
for (const dir of ['browser-profiles/default', 'data', 'logs']) {
  fs.mkdirSync(dir, { recursive: true });
}

// 4. 启动应用
console.log('\n  API 地址: http://127.0.0.1:3000');
console.log('  按 Ctrl+C 停止应用\n');

const app = spawn(process.execPath, ['src/index.js'], { stdio: 'inherit' });

app.on('exit', (code) => {
  if (code !== 0) {
    fail(`应用异常退出（退出码 ${code}），查看 logs/ 目录了解详情`);
    if (process.stdin.isTTY) {
      console.log('\n按任意键关闭...');
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', () => process.exit(code));
    }
  }
});
