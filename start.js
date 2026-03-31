/**
 * start.js - BiliInsight 一键启动
 *
 * 流程：
 * 1. 安装后端/前端依赖（仅首次）
 * 2. 同时启动后端（Express:3000）+ 前端（Vite:5173）
 * 3. 等待 Vite 就绪后打开浏览器（无空白页）
 * 4. 前端心跳检测：浏览器关闭 → 后端退出 → 脚本杀掉 Vite
 */

const { spawnSync, spawn } = require('child_process')
const http   = require('http')
const fs     = require('fs')
const path   = require('path')

const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED    = '\x1b[31m'
const RESET  = '\x1b[0m'

function ok(msg)   { console.log(`${GREEN}[OK]${RESET} ${msg}`) }
function info(msg) { console.log(`${YELLOW}[..]${RESET} ${msg}`) }
function fail(msg) { console.error(`${RED}[错误]${RESET} ${msg}`) }

const ROOT         = __dirname
const FRONTEND_DIR = path.join(ROOT, 'frontend')

console.log('============================================')
console.log('  BiliInsight')
console.log('============================================\n')

// ─── 1. 安装后端依赖 ─────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  info('安装后端依赖...')
  const r = spawnSync('npm', ['install'], { stdio: 'inherit', shell: true, cwd: ROOT })
  if (r.status !== 0) { fail('后端 npm install 失败'); process.exit(1) }
  ok('后端依赖安装完成')
}

// ─── 2. 安装 Playwright Chromium ─────────────────────────────────────────────

function chromiumInstalled() {
  try {
    const { chromium } = require('playwright')
    return fs.existsSync(chromium.executablePath())
  } catch (_) { return false }
}

if (!chromiumInstalled()) {
  info('安装 Playwright Chromium（首次约需 1-2 分钟）...')
  const pw = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    stdio: 'inherit', shell: true, cwd: ROOT,
  })
  if (pw.status !== 0) { fail('Chromium 安装失败'); process.exit(1) }
  ok('Chromium 安装完成')
}

// ─── 3. 安装前端依赖 ─────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(FRONTEND_DIR, 'node_modules'))) {
  info('安装前端依赖...')
  const r = spawnSync('npm', ['install'], { stdio: 'inherit', shell: true, cwd: FRONTEND_DIR })
  if (r.status !== 0) { fail('前端 npm install 失败'); process.exit(1) }
  ok('前端依赖安装完成')
}

// ─── 4. 创建必要目录 ──────────────────────────────────────────────────────────

for (const dir of ['browser-profiles/default', 'data', 'logs']) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true })
}

// ─── 5. 启动后端 + 前端 ───────────────────────────────────────────────────────

console.log('')
info('启动后端服务（端口 3000）...')
const backend = spawn(process.execPath, ['src/index.js'], {
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  cwd: ROOT,
})

info('启动前端服务（端口 5173）...')
const frontend = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit', shell: true, cwd: FRONTEND_DIR,
})

// 任意一个退出 → 杀掉另一个 → 整体退出
let exiting = false
function shutdown(reason, code = 0) {
  if (exiting) return
  exiting = true
  if (reason) console.log(`\n${YELLOW}[..] ${reason}${RESET}`)
  backend.kill()
  frontend.kill()
  setTimeout(() => process.exit(code), 500)
}

backend.on('exit',  (code) => shutdown(code === 0 ? '后端已停止' : `后端异常退出（${code}）`, code ?? 0))
frontend.on('exit', (code) => shutdown(code === 0 ? '前端已停止' : `前端异常退出（${code}）`, code ?? 0))
process.on('SIGINT',  () => shutdown('收到 Ctrl+C，正在停止...'))
process.on('SIGTERM', () => shutdown('收到终止信号，正在停止...'))

// ─── 6. 等待后端就绪 + Vite 就绪，再打开 UI ──────────────────────────────────

const UI_URL = 'http://localhost:5173'

let backendReady = false
let viteReady = false

function tryOpenUI() {
  if (!backendReady || !viteReady || exiting) return
  ok(`界面已就绪：${UI_URL}`)
  if (backend.connected) {
    backend.send({ type: 'open-ui', url: UI_URL })
  }
}

// 监听后端发来的 backend-ready 信号
backend.on('message', (msg) => {
  if (msg?.type === 'backend-ready') {
    backendReady = true
    tryOpenUI()
  }
})

function pollVite(attempts = 0) {
  if (exiting) return
  if (attempts > 60) { fail('Vite 启动超时'); return }

  const req = http.get(UI_URL, (res) => {
    res.resume()
    viteReady = true
    tryOpenUI()
  })

  req.on('error', () => setTimeout(() => pollVite(attempts + 1), 500))
  req.setTimeout(800, () => { req.destroy(); setTimeout(() => pollVite(attempts + 1), 500) })
}

// 给 Vite 1 秒初始化时间再开始轮询
setTimeout(() => pollVite(), 1000)
