# BiliInsight 开发进度文档

**项目：** BiliInsight —— B站直播用户洞察与运营助手
**当前阶段：** MVP（模块一 F1 + 模块二 F2 已完成）
**文档更新日期：** 2026-03-31

---

## 一、整体进度概览

| 模块 | 功能 | 状态 |
|------|------|------|
| F1.1 | 本地登录（Playwright 扫码 + Cookie 持久化） | ✅ 已完成 |
| F1.2 | 权限范围（只读，不上传） | ✅ 已完成（架构约束） |
| F2.1 | 直播间监控管理（添加/删除/多房间并发） | ✅ 已完成 |
| F2.2 | 采集技术方案（DOM MutationObserver + WebSocket 双路） | ✅ 已完成 |
| F2.3 | 采集字段（弹幕/礼物/SC/上舰/入场全字段） | ✅ 已完成 |
| F2.4 | 数据持久化（SQLite 全表 + WAL + 复合索引 + 数据清理） | ✅ 已完成 |
| F2.5 | 统计仪表盘 API + SSE 实时推送（缓冲 200 条） | ✅ 已完成 |
| F3.x | 语音厅 / 主播偏好分析 | ⏳ 待开发（V1 阶段） |
| F4.x | 用户画像与 LLM 分析 | ⏳ 待开发（MVP 后续） |
| F5.x | 主播工作状态监控 Dashboard | ⏳ 待开发（MVP 后续） |
| 前端 UI | React + Vite 界面 | ⏳ 待开发 |

---

## 二、文件结构

```
BiliInsight/
├── package.json               # 依赖声明（Node.js 20 LTS）
├── config/
│   ├── default.json           # 全局配置（端口、浏览器、采集、数据库、LLM）
│   └── selectors.json         # DOM 选择器集中配置（B站更新后快速修改）
├── src/
│   ├── index.js               # 应用入口（登录检测 → API 服务 → 恢复房间 → 数据清理）
│   ├── auth.js                # F1.1 账号认证（Playwright persistent context）
│   ├── db.js                  # F2.4 SQLite 数据库初始化 + 预编译语句
│   ├── collector.js           # F2.2/F2.3 弹幕采集（DOM + WebSocket 双路）
│   ├── sse.js                 # F2.5 SSE 实时推送（per-room 缓冲 200 条）
│   └── routes.js              # F2.1/F2.5 REST API 路由
├── browser-profiles/
│   └── default/               # Playwright 持久化登录数据（自动生成）
├── data/
│   └── biliinsight.db         # SQLite 数据库文件（自动生成）
└── PRD.md                     # 产品需求文档
```

---

## 三、已实现功能详述

### F1 — 账号认证（`src/auth.js`）

- `getSharedContext()`：使用 `playwright-extra` + `puppeteer-extra-plugin-stealth` 创建全局共享的 persistent browser context。
  - 配置：`headless: false`，禁用 `AutomationControlled`，设置真实 UA。
  - Profile 目录：`./browser-profiles/default`，包含 cookies/localStorage。
- `checkLoginStatus()`：通过调用 `https://api.bilibili.com/x/web-interface/nav` 验证登录态，返回 `{loggedIn, uid, uname}`。
- `triggerLogin()`：打开 B站登录页，轮询 API 检测扫码完成（超时 5 分钟）。

### F2 — 弹幕与事件采集

#### F2.1 直播间监控管理（`src/routes.js` + `src/collector.js`）

- 添加房间：`POST /api/rooms`，支持传 URL 或 room_id，自动解析，写入 `rooms` 表并启动采集。
- 删除房间：`DELETE /api/rooms/:room_id`，停止采集并从数据库删除。
- 并发上限：配置文件 `maxRooms = 5`，各房间间隔 5 秒启动（`startDelayMs`）。
- 每个房间共享同一 persistent context（复用登录态），独立 Playwright Page。

#### F2.2 采集技术方案（`src/collector.js`）

**DOM MutationObserver（弹幕）：**
- 通过 `page.exposeFunction('__biliInsightDanmaku', ...)` 将回调暴露给页面内 JS。
- 注入 `MutationObserver` 监听 `#chat-items`，捕获所有 `.chat-item.danmaku-item` 节点。
- 完整解析所有 PRD 验证字段：`data-uid/uname/danmaku/ts/type/score`，粉丝勋章（名称/等级/所属主播），大航海等级（CSS `--borderColor` 解析），管理员标识。
- 回调引入随机延迟（100–500ms）防高频请求。

**WebSocket（bilibili-live-ws，礼物/SC/上舰/入场）：**
- `SEND_GIFT` → `ingestGift()`
- `SUPER_CHAT_MESSAGE` → `ingestSC()`
- `GUARD_BUY` → `ingestGuard()`
- `INTERACT_WORD`（msg_type=1）→ `ingestEnter()`

**防风控行为模拟：**
- 每 30–90 秒随机执行鼠标移动 + 页面滚动。

**断线重连（指数退避）：**
- 初始 5 秒，最大 120 秒，最多重试 10 次。
- Page close 事件、健康检查失败均触发重连。

**健康检查（每 60 秒）：**
- 检测 `#chat-items` 是否存在，不存在则刷新页面并重新注入 Observer。

#### F2.3 采集字段

全部 PRD 规定字段均已覆盖（见 `db.js` 表结构与 `collector.js` 中各 ingest 函数）。

#### F2.4 数据持久化（`src/db.js`）

SQLite（`better-sqlite3`，WAL 模式，同步 API）。六张表：

| 表名 | 用途 |
|------|------|
| `rooms` | 监控房间配置 |
| `realtime_events` | 所有类型原始事件流 |
| `danmu_records` | 弹幕专用索引表 |
| `gift_records` | 礼物/SC/上舰记录 |
| `enter_records` | 入场记录 |
| `user_stats` | 用户聚合统计（UPSERT 增量更新） |
| `user_profiles` | LLM 分析画像（占位，F4 使用） |

复合索引：`(room_id, uid)`，时间戳索引：`ts`。
数据清理：定时（每 24 小时）按配置保留天数（原始事件 90 天，礼物/入场 180 天）删除过期记录。

#### F2.5 统计仪表盘 API + SSE（`src/sse.js` + `src/routes.js`）

**SSE（`src/sse.js`）：**
- `GET /api/rooms/:room_id/stream`：连接后立即推送最近 200 条缓冲事件，后续实时推送。
- 事件格式符合 PRD § 4.2：`{ event, data: { uid, uname, content, ts, room_id, medal, guard_level, score } }`

**REST API（`src/routes.js`）：**

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/rooms` | 列出所有监控房间 |
| `POST` | `/api/rooms` | 添加房间 |
| `DELETE` | `/api/rooms/:room_id` | 删除房间 |
| `GET` | `/api/rooms/:room_id/status` | 采集状态 |
| `POST` | `/api/rooms/:room_id/events/ingest` | 内部弹幕注入（备用） |
| `GET` | `/api/rooms/:room_id/users` | 用户统计列表（按消费/弹幕排序） |
| `GET` | `/api/rooms/:room_id/stream` | SSE 实时弹幕流 |
| `GET` | `/api/users/:uid` | 用户详情（跨房间） |
| `GET` | `/api/dashboard` | 全部房间状态汇总 |
| `GET` | `/api/auth/status` | 登录状态查询 |
| `POST` | `/api/auth/login` | 触发扫码登录 |

**安全：** API 服务仅监听 `127.0.0.1:3000`，非 localhost 请求返回 403。

---

## 四、待办事项（后续开发）

### MVP 剩余部分
- [ ] **前端 UI**（React + Vite）：实时弹幕流面板、用户统计标签页、房间配置界面
- [ ] **F3.2/F3.3**：麦上主播识别 + 对话关联（基于弹幕行为）
- [ ] **F4.1/F4.3**：用户档案 + LLM 性格分析（L1 级别，Ollama 集成）
- [ ] **F4.4**：客户价值矩阵（简化版）
- [ ] **F5.1**：主播实时面板（基础版）

### V1 阶段
- [ ] F3.1 AI 字幕获取（需技术预研）
- [ ] F3.4–F3.5 客户-主播偏好分析
- [ ] F4.5–F4.6 用户分群 + 互动建议
- [ ] F5.2–F5.4 主播对比 + 工作日志
- [ ] 数据导出（CSV/Excel）

---

## 五、安装与启动

```bash
# 1. 安装依赖
npm install

# 2. 安装 Chromium
npx playwright install chromium

# 3. 启动应用（首次启动会弹出浏览器扫码登录）
npm start
```

**依赖清单：**
- `playwright-extra` + `puppeteer-extra-plugin-stealth`：Stealth 浏览器自动化
- `playwright`：Chromium 控制
- `better-sqlite3`：SQLite 同步 API
- `express`：HTTP/SSE API 服务
- `bilibili-live-ws`：B站直播 WebSocket 协议解码

---

## 六、已知注意事项

1. **选择器维护**：B站前端定期更新（当前验证版本 2026.03.27 Build 4.0.0），选择器集中在 `config/selectors.json`，变更时无需重新部署。
2. **WebSocket 礼物采集**：依赖 `bilibili-live-ws` 库的协议兼容性，B站协议变更时需跟进更新。
3. **登录态**：Cookie 存储于 `./browser-profiles/default`，非加密文件系统存储（生产建议加 AES-256 + 系统 keychain 集成，PRD 非功能需求 §8）。
4. **并发房间数**：配置建议 3–5 个，受限于本机内存（每个 Chromium 实例约 300–500MB）。
