# 产品需求文档 (PRD)
**项目名称：** BiliInsight —— B站直播用户洞察与运营助手
**版本：** 2.1
**更新日期：** 2026-03-31

---

## 1. 项目概述

### 1.1 核心价值
BiliInsight 是一款面向 B站直播运营人员的本地化数据分析工具。通过模拟真实用户行为的浏览器自动化技术，安全稳定地采集直播间弹幕、礼物、入场等公开数据，结合 LLM 分析用户性格与消费潜力，构建客户-主播偏好图谱，帮助运营人员实现精细化粉丝运营、提升转化与留存。

### 1.2 产品定位
- **隐私优先**：所有数据本地存储，不依赖云端，完全符合个人信息保护法规。
- **稳定可靠**：采用 Playwright + Stealth 技术，绕过平台风控，保障长期采集稳定性。
- **智能决策**：集成 LLM 能力，提供用户画像、价值评估、互动建议等高级分析。

### 1.3 技术栈选型（确定）

| 层次 | 技术方案 |
|------|------|
| 运行时 | Node.js 20 LTS |
| 浏览器自动化 | Playwright (Chromium) + playwright-extra + puppeteer-extra-plugin-stealth |
| 后端 API | Express.js 或 Fastify |
| 实时推送 | SSE（Server-Sent Events） |
| 数据库 | SQLite（better-sqlite3，同步 API，无回调地狱） |
| LLM 集成 | Ollama（本地）/ OpenAI 兼容 API（云端） |
| 前端 | React + Vite（Electron 内嵌或本地 Web 服务） |
| 打包 | Electron（Windows/macOS 桌面应用） 或 纯 Node.js 后台服务 |

---

## 2. 用户角色

| 角色 | 描述 |
|------|------|
| 运营人员 | 唯一用户，负责监控多个直播间，分析粉丝行为，制定互动与转化策略 |

---

## 3. 功能模块

### 模块一：账号认证

**F1.1 本地登录**
- 应用首次启动时，弹出内嵌浏览器窗口（Playwright 管理的浏览器上下文），引导用户扫码登录 B站账号。
- 登录状态持久化到本地用户数据目录（`./browser-profiles/default`），包含 cookies、localStorage 等。
- 支持手动刷新登录态（重新扫码）或自动检测 cookie 过期后提示重新登录。
- 未登录状态下，弹幕仍可采集，但无法获取完整粉丝勋章颜色/等级等需要登录的字段。

**F1.2 权限范围**
- 仅读取直播间公开数据，不做任何写操作。
- 不上传任何用户数据到第三方。

---

### 模块二：弹幕与事件采集

**F2.1 直播间监控**
- 运营人员可通过输入直播间 URL（`https://live.bilibili.com/{roomId}`）或房间号添加监控任务。
- 支持同时监控多个直播间（建议上限 3–5 个，取决于硬件配置）。
- 每个监控任务独立运行一个 Playwright 浏览器上下文（共享同一用户数据目录以复用登录态）。
- 实时展示弹幕流（用户名、内容、时间戳），通过 SSE 推送到前端面板，保留最近 200 条事件。

---

**F2.2 采集技术方案（核心）**

**方案选择：** Playwright + Stealth 插件 + MutationObserver DOM 监听

#### 浏览器启动配置
```javascript
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const browser = await chromium.launchPersistentContext('./browser-profiles/default', {
  headless: false,          // 必须 false，避免被识别为无头浏览器
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
  ],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...',  // 设置真实 UA
  viewport: { width: 1280, height: 720 },
});
```

#### 弹幕 DOM 监听（经真实页面 HTML 验证的选择器）

**弹幕容器：**
```
#chat-items          ← 所有聊天消息的父容器（已验证）
#chat-history-list   ← 外层滚动容器（备用）
.chat-history-panel  ← 整个聊天面板
```

**单条弹幕元素：**
```
.chat-item.danmaku-item   ← 普通弹幕
```

**弹幕元素上的 data 属性（均已通过真实 HTML 验证）：**

| 属性 | 说明 | 示例值 |
|------|------|------|
| `data-uid` | 用户 UID | `"489755474"` |
| `data-uname` | 用户名 | `"ちんりん沉沦"` |
| `data-danmaku` | 弹幕文本内容 | `"1500w的代价出了异色狼"` |
| `data-ts` | 发送时间戳（Unix 秒） | `"1774902190"` |
| `data-timestamp` | 接收时间戳（Unix 秒，与 data-ts 略有差异） | `"1774902196"` |
| `data-type` | 消息类型：`0`=文本，`1`=表情包 | `"0"` |
| `data-score` | 用户贡献度评分（反映在线活跃/消费等级） | `"80"`, `"936"` |
| `data-id_str` | 弹幕唯一 ID | `"4997033ddf5a4322..."` |
| `data-image` | 表情包图片 URL（仅 type=1 时存在） | `"http://i0.hdslb.com/..."` |
| `data-file-id` | 表情包 ID（仅 type=1 时存在） | `"room_6154037_16291"` |

**粉丝勋章解析（经验证）：**
```
.fans-medal-item-ctnr[data-anchor-id]   ← 勋章所属主播的 UID（跨房间识别关键字段）
  .fans-medal-item
    .fans-medal-content                 ← 勋章名称（如 "ASAKI"）
    .fans-medal-level-font              ← 勋章等级（如 "27"）
    .fans-medal-label.medal-guard i.medal-guard  ← 存在则为大航海用户
```

**守护等级（大航海）识别方式：**
- 粉丝勋章 CSS 变量 `--borderColor`：
  - `#58A1F8` / 渐变 `#4C7DFF99` → **舰长**（蓝色）
  - `#D47AFF` / 渐变 `#A773F199` → **提督**（紫色）
  - `#F8C558`（金色，较少见） → **总督**
- 用户名颜色 `style="color:#00D1F1"` → 舰长；`style="color:#E17AFF"` → 提督/总督
- `.fans-medal-label` 存在 `.medal-guard` class → 确认为大航海成员

**荣耀等级勋章（账号消费能力）：**
```
.wealth-medal-ctnr .wealth-medal[src]   ← 图片 src URL 包含勋章等级信息（图片名不同对应不同等级）
```
荣耀勋章图标 src 与等级的映射关系需通过实测建立对应表（B站未公开文档）。

**管理员标识：**
```
.admin-icon   ← 存在则为房间管理员
```

#### 注入 MutationObserver 监听弹幕
```javascript
await page.exposeFunction('onDanmakuReceived', async (data) => {
  await fetch(`http://localhost:3000/api/rooms/${roomId}/events/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
});

await page.evaluate(() => {
  const container = document.getElementById('chat-items');
  if (!container) return;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (!node.classList.contains('danmaku-item')) continue;
        const el = node;
        // 解析粉丝勋章
        const medalEl = el.querySelector('.fans-medal-item-ctnr');
        const guardEl = el.querySelector('.fans-medal-label.medal-guard');
        const payload = {
          uid: el.dataset.uid,
          uname: el.dataset.uname,
          danmaku: el.dataset.danmaku,
          ts: el.dataset.ts,
          type: el.dataset.type,
          score: el.dataset.score,
          id_str: el.dataset.id_str,
          medal_name: el.querySelector('.fans-medal-content')?.textContent?.trim(),
          medal_level: el.querySelector('.fans-medal-level-font')?.textContent?.trim(),
          medal_anchor_id: medalEl?.dataset?.anchorId,
          is_guard: !!guardEl,
          guard_level: (() => {
            const style = el.querySelector('.fans-medal-item')?.style?.getPropertyValue('--borderColor') || '';
            if (style.includes('#58A1F8') || style.includes('#4C7DFF')) return 3; // 舰长
            if (style.includes('#D47AFF') || style.includes('#A773F1')) return 2; // 提督
            if (style.includes('#F8C558')) return 1; // 总督
            return 0;
          })(),
          is_admin: !!el.querySelector('.admin-icon'),
          image_url: el.dataset.image || null,
        };
        window.onDanmakuReceived(payload);
      }
    }
  });
  observer.observe(container, { childList: true });
});
```

#### WebSocket 补充方案（适用于礼物、SC、入场等非弹幕事件）

B站直播间通过 WebSocket 下发所有实时事件（礼物、入场、SC、上舰等），弹幕区 DOM 仅展示弹幕文字。对于礼物/SC/上舰事件，建议通过拦截页面 WebSocket 消息实现：

```javascript
await page.addInitScript(() => {
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(...args) {
    const ws = new OriginalWebSocket(...args);
    ws.addEventListener('message', (event) => {
      // B站 WebSocket 消息为二进制 protobuf 格式，需解码
      window.__biliWSMessages && window.__biliWSMessages.push(event.data);
    });
    return ws;
  };
});
```

**注意：** B站 WebSocket 消息采用自定义 protobuf 协议（带 16 字节头部），需参考开源项目（如 `bilibili-live-ws`）进行解码。此方案比 DOM 解析更可靠，适用于礼物/SC/上舰的精准采集。

**MVP 阶段建议双路并行：**
- 弹幕 → DOM MutationObserver（选择器已验证，稳定）
- 礼物/SC/上舰/入场 → WebSocket 拦截解码（需集成 bilibili-live-ws 库）

#### 用户行为模拟（防风控）
- 每个浏览器实例定期（随机间隔 30–90 秒）执行鼠标移动、页面滚动等操作。
- 对弹幕监听回调增加随机延迟（100–500ms）后发送，避免高频请求。
- 不同直播间的浏览器上下文间隔至少 5 秒启动，避免同时大量请求。

#### 断线重连
- 监听浏览器或页面关闭事件，自动重启采集进程。
- 定期（每 60 秒）检查 `#chat-items` 是否存在，若不存在则刷新页面。
- 重连策略：指数退避，初始间隔 5 秒，最大 120 秒，最多重试 10 次。

**前置准备：**
1. `npm install playwright playwright-extra puppeteer-extra-plugin-stealth bilibili-live-ws better-sqlite3`
2. `npx playwright install chromium`
3. 创建目录：`./browser-profiles/default`
4. 建立荣耀等级勋章图片名→等级的映射表（通过实测积累）

---

**F2.3 采集字段**

| 字段 | 数据来源 | 说明 |
|------|------|------|
| UID | `data-uid` | B站用户唯一ID |
| 用户名 | `data-uname` | 显示名称 |
| 弹幕内容 | `data-danmaku` | 文本消息或表情包名称 |
| 消息类型 | `data-type` | 0=文字，1=表情包 |
| 时间戳 | `data-ts` | 发送时间（Unix 秒） |
| 房间号 | 采集配置 | 来源直播间 |
| 贡献评分 | `data-score` | B站内部用户活跃度评分 |
| 粉丝勋章名 | `.fans-medal-content` | 佩戴的勋章名称 |
| 粉丝勋章等级 | `.fans-medal-level-font` | 勋章等级数字 |
| 勋章所属主播UID | `data-anchor-id` | 用于跨房间勋章识别 |
| 大航海状态 | `.medal-guard` / `--borderColor` | 是否大航海及等级(1总督/2提督/3舰长) |
| 管理员标识 | `.admin-icon` | 是否为房间管理员 |
| 荣耀勋章 | `.wealth-medal[src]` | 账号消费能力等级（通过图片名推断） |
| 礼物记录 | WebSocket (cmd: SEND_GIFT) | 礼物类型、数量、金额 |
| 入场记录 | WebSocket (cmd: INTERACT_WORD) | 进入直播间时间 |
| SC（醒目留言） | WebSocket (cmd: SUPER_CHAT_MESSAGE) | 内容、金额、时间 |
| 上舰/大航海 | WebSocket (cmd: GUARD_BUY) | 舰长/提督/总督 开通记录 |

---

**F2.4 数据持久化**

本地 SQLite 数据库（`./data/biliinsight.db`），所有表按 `room_id + uid` 建立复合索引。

**表结构：**

```sql
-- 原始事件流（所有类型）
CREATE TABLE realtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  uname TEXT,
  event_type TEXT NOT NULL,  -- 'danmaku'|'gift'|'sc'|'guard'|'enter'
  content TEXT,              -- JSON 格式存储原始事件数据
  ts INTEGER NOT NULL,       -- Unix 时间戳（秒）
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_events_room_uid ON realtime_events(room_id, uid);
CREATE INDEX idx_events_ts ON realtime_events(ts);

-- 弹幕专用索引表（快速查询）
CREATE TABLE danmu_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  uname TEXT,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL,
  msg_type INTEGER DEFAULT 0,    -- 0=文字 1=表情
  score INTEGER,                 -- B站内部贡献分
  medal_name TEXT,
  medal_level INTEGER,
  medal_anchor_id TEXT,          -- 勋章所属主播UID（跨房间识别）
  guard_level INTEGER DEFAULT 0, -- 0=无 1=总督 2=提督 3=舰长
  is_admin INTEGER DEFAULT 0
);
CREATE INDEX idx_danmu_room_uid ON danmu_records(room_id, uid);

-- 礼物/SC/上舰记录
CREATE TABLE gift_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  uname TEXT,
  gift_type TEXT NOT NULL,       -- 'gift'|'sc'|'guard'
  gift_name TEXT,
  gift_count INTEGER DEFAULT 1,
  coin_type TEXT,                -- 'silver'|'gold'
  total_coin INTEGER,            -- 价值（金瓜子，除以1000=元）
  ts INTEGER NOT NULL
);

-- 入场记录
CREATE TABLE enter_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  uname TEXT,
  ts INTEGER NOT NULL,
  medal_name TEXT,
  medal_level INTEGER
);

-- 用户聚合统计（定期更新）
CREATE TABLE user_stats (
  uid TEXT NOT NULL,
  room_id TEXT NOT NULL,
  uname TEXT,
  danmu_count INTEGER DEFAULT 0,
  total_spend_gold INTEGER DEFAULT 0,  -- 金瓜子总额
  sc_count INTEGER DEFAULT 0,
  guard_level INTEGER DEFAULT 0,       -- 当前最高守护等级
  enter_count INTEGER DEFAULT 0,
  medal_level INTEGER DEFAULT 0,
  medal_anchor_id TEXT,
  last_active_ts INTEGER,
  first_seen_ts INTEGER,
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (uid, room_id)
);

-- LLM 分析画像
CREATE TABLE user_profiles (
  uid TEXT NOT NULL,
  room_id TEXT,                  -- NULL 表示跨房间聚合画像
  analysis_level INTEGER,        -- 1=L1基础 2=L2标准 3=L3深度
  personality_tags TEXT,         -- JSON: ["活跃", "幽默", ...]
  consumption_tags TEXT,         -- JSON: ["潜在高价值", ...]
  llm_summary TEXT,              -- 自然语言描述
  value_quadrant TEXT,           -- 'high_high'|'high_low'|'low_high'|'low_low'
  confidence REAL,               -- 0-1 置信度
  analyzed_at INTEGER,
  PRIMARY KEY (uid, COALESCE(room_id, ''))
);
```

**数据保留策略：**
- `realtime_events`、`danmu_records`：默认保留 90 天，可配置；过期自动清理。
- `gift_records`、`enter_records`：默认保留 180 天。
- `user_stats`、`user_profiles`：永久保留。

---

**F2.5 数据统计仪表盘**
- 房间维度聚合接口：`GET /api/rooms/{room_id}/users`，返回用户弹幕量、消费总额、SC 次数等。
- 前端「用户统计」标签页展示各用户数据。
- 实时弹幕流面板（SSE）展示最近 200 条事件。
- 数据充足度指示：
  - 数据不足：弹幕 < 20 条，仅展示原始记录。
  - 基础分析：弹幕 20–100 条，可生成初步画像。
  - 深度分析：弹幕 > 100 条 或 多维度数据充足，可生成高置信度画像。

---

### 模块三：语音厅内容采集与主播偏好分析

**⚠️ 技术可行性说明（已更新）**

经分析，B站语音厅/连麦功能存在以下情况：
1. **AI 字幕 WebSocket 下发**：B站部分场景（视频直播中的 AI 字幕）会通过 WebSocket 下发字幕数据（cmd: `DM_INTERACTION`），但是否覆盖语音厅需实测验证。
2. **备选方案**：若 WebSocket 不含字幕数据，可考虑捕获音频流后接入本地 Whisper 模型进行 ASR，但此方案技术复杂度高，资源消耗大，不纳入 MVP。
3. **MVP 阶段简化策略**：模块三 MVP 版本仅基于弹幕行为推断主播偏好，不依赖 AI 字幕。

**F3.1 AI 字幕获取（V1 阶段，需技术验证）**
- 拦截 WebSocket 消息，监听 `DM_INTERACTION` 或类似 cmd 的字幕数据。
- 若无 WebSocket 字幕，评估本地 Whisper 方案可行性。
- **开发前必须先进行 2–3 天技术预研。**

**F3.2 麦上主播识别与记录**
- 通过 DOM 监听或 WebSocket 事件检测连麦用户列表变化。
- 记录：主播 UID、上麦时间、下麦时间。
- WebSocket 相关 cmd：`ROOM_CHANGE`、`ANCHOR_LOT_START`、连麦相关事件（需实测）。

**F3.3 对话关联**
- 将主播的弹幕/字幕内容与观众弹幕在时间轴对齐（默认前后 30 秒窗口）。
- 存储结构化对话历史，包含：触发主播、触发内容、时间窗口、回应弹幕列表、回应礼物列表。

**F3.4 客户-主播偏好分析**
- 以客户（弹幕用户）为主体，分析其对不同麦上主播的偏好程度。
- 偏好度计算维度（权重可调）：
  - 弹幕活跃度（30%）
  - 礼物投入（30%）
  - SC 互动（15%）
  - 对话参与度（15%）
  - 在线留存（10%）
- 输出：偏好排名、偏好标签、偏好趋势图。

**F3.5 主播维度聚合报表**
- 以主播为主体，聚合所有客户对其的偏好数据。
- 输出：核心粉丝列表、粉丝重合度分析、主播吸引力趋势。

---

### 模块四：用户画像与分析

**F4.1 用户档案**
- 以 UID 为核心，聚合用户在所有直播间的全量历史数据。
- 基础统计：活跃时段分布、常驻直播间列表、弹幕总量与趋势、消费总额与偏好、SC 汇总、上舰历史、首次/最近活跃时间。
- 跨房间勋章信息：通过 `data-anchor-id` 识别用户佩戴的他房间勋章，推断用户的跨平台活跃度。

**F4.2 多维度数据分析**

| 等级 | 条件 | 分析内容 |
|------|------|------|
| L1 基础画像 | 弹幕 ≥ 20 条 | 基本性格标签 + 互动风格 |
| L2 标准画像 | 弹幕 ≥ 50 条 + ≥ 2 种数据类型 | 性格分析 + 兴趣推断 + 消费倾向 |
| L3 深度画像 | 弹幕 ≥ 100 条 + 多维度充足 | 全面性格图谱 + 行为预测 + 流失预警 |

**F4.3 性格分析（LLM）**
- 触发条件：用户数据达到 L1 及以上，且距离上次分析超过 24 小时。
- 分析维度：性格标签、兴趣偏好、互动风格、情感倾向、消费画像、活跃趋势。
- 输出：结构化标签（JSON）+ 置信度评分 + 自然语言描述。
- 画像历史版本保留，支持对比变化。
- **LLM Prompt 设计原则：** 输入为用户弹幕样本（最多 100 条）+ 消费记录摘要；输出为 JSON 格式标签，防止幻觉。

**F4.4 客户价值评估与消费潜力分析**

基于以下规则自动打标签（数据来源标注）：

| 场景 | 识别条件 | 标签 | 数据来源 |
|------|------|------|------|
| 潜在高价值 | 佩戴他房高等级勋章（≥25级）或 data-score≥500，但本房消费为零 | `潜在高价值` | `data-anchor-id` + 消费记录 |
| 历史高消费休眠 | 历史累计消费 > 1000元，但近30天消费为零 | `历史高消费-当前休眠` | gift_records |
| 消费骤降预警 | 近2周消费较前2周下降超50% | `消费下降预警` | gift_records |
| 本房铁杆粉 | 本房勋章等级 ≥ 20 + 守护等级 ≥ 3（舰长） | `忠诚核心用户` | 勋章 + 守护 |

**客户价值矩阵（四象限，每周更新）：**
- X轴：本房间累计消费（低/高）
- Y轴：消费潜力评分（低/高）

**F4.5 用户分群与排名**
- 支持按消费金额、活跃度、互动频率等维度自动分群。
- 支持自定义筛选条件（时间范围、指标阈值）。
- 重点用户星标、异常检测（突然沉默、消费骤降）。

**F4.6 互动建议**
- 基于用户画像和数据充足度，生成针对性互动建议。
- 运营人员可标记建议"有用/无用"用于优化。

---

### 模块五：主播工作状态监控（Dashboard）

**F5.1 主播实时状态面板**
- 卡片式布局展示每位主播的核心指标（可配置主播列表）。
- 实时数据（15–30 秒更新）：在线人数/人气、麦上状态、最近5分钟弹幕量、最近1小时礼物收益、互动热度指数。
- 人气/在线人数：通过 DOM 解析 `#rank-list-ctnr-box` 的 `data-tab-info` JSON 属性获取（已验证格式：`{"isDual":false,"isThousand":false,...}`），或解析 "房间观众(5658)" 文本。

**F5.2 主播对比分析**
- 按选定时间窗口，对比多位主播的弹幕量、礼物收益、粉丝留存率等。

**F5.3 主播粉丝热度排行**
- 统计各主播的核心粉丝数、活跃粉丝数、高消费粉丝数。
- 预警：粉丝流失率过高时告警。

**F5.4 主播工作日志**
- 记录每次直播的关键事件，运营人员可手动标注备注。
- 支持导出每日/周度工作报告。

---

## 4. API 设计

### 4.1 核心 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rooms` | 获取所有监控直播间列表 |
| POST | `/api/rooms` | 添加新直播间 `{url, room_id}` |
| DELETE | `/api/rooms/{room_id}` | 删除直播间监控 |
| GET | `/api/rooms/{room_id}/status` | 获取直播间采集状态 |
| POST | `/api/rooms/{room_id}/events/ingest` | 内部：浏览器注入脚本回调 |
| GET | `/api/rooms/{room_id}/users` | 获取房间用户统计列表 |
| GET | `/api/users/{uid}` | 获取用户详情（跨房间聚合） |
| GET | `/api/users/{uid}/profile` | 获取用户 LLM 画像 |
| POST | `/api/users/{uid}/analyze` | 触发 LLM 分析 |
| GET | `/api/rooms/{room_id}/stream` | SSE：实时弹幕流 |
| GET | `/api/dashboard` | 所有主播状态汇总 |

### 4.2 SSE 事件格式
```json
{
  "event": "danmaku",
  "data": {
    "uid": "489755474",
    "uname": "ちんりん沉沦",
    "content": "1500w的代价出了异色狼",
    "ts": 1774902190,
    "room_id": "194484313",
    "medal": { "name": "ASAKI", "level": 27, "anchor_id": "194484313" },
    "guard_level": 0,
    "score": 80
  }
}
```

---

## 5. 产品界面结构（UI Layout）

**一级菜单**
1. **客户分析** → 客户列表 → 客户详情
2. **主播监控** → 主播面板 → 主播对比 → 工作日志
3. **数据报表** → 分群汇总 → 偏好分析 → 导出功能
4. **系统设置** → 账号管理 → 房间配置 → LLM 配置 → 数据管理

**关键页面**
- **客户信息卡**：左侧用户基础信息 + 价值矩阵位置；中间数据充足度 + 性格标签云 + 主播偏好 Top3；右侧实时互动建议 + 操作按钮（星标、备注、导出）。
- **主播实时面板**：卡片式布局，每张卡片含状态、核心指标、趋势小图。
- **数据分群表**：自定义列表视图（筛选、字段、排序），支持批量操作和实时搜索。
- **设置中心**：直播间配置（添加/删除/暂停）、LLM 配置、数据保留策略、高级配置（偏好权重、阈值参数）。

---

## 6. 版本规划

### MVP（第一阶段）— 核心功能验证
**时间线：** 6–8 周
**包含功能：**
- ✅ F1：账号认证（B站扫码登录 + 持久化）
- ✅ F2.1–F2.5：基于 Playwright 的弹幕采集（DOM MutationObserver 方案）+ 礼物/SC/上舰采集（bilibili-live-ws WebSocket 方案）+ 本地 SQLite 存储 + 基础统计仪表盘
- ✅ F3.2, F3.3：麦上主播记录 + 对话关联（基于弹幕行为，不含 AI 字幕）
- ✅ F4.1, F4.3：用户档案 + LLM 性格分析（L1 级别）
- ✅ F4.4：客户价值矩阵（简化版，基于本房数据）
- ✅ F5.1：主播实时面板（基础版）
- ✅ 界面：客户卡、主播面板

**不含功能：**
- ❌ F3.1 AI 字幕获取（需技术验证后评估）
- ❌ F3.4–F3.5 客户-主播偏好分析
- ❌ F4.4 完整场景分析（跨房间识别）
- ❌ F5.2–F5.4 主播对比和工作日志
- ❌ 高级筛选、数据导出

**MVP 验证指标：**
- 弹幕采集准确率 > 95%，单房间延迟 < 2 秒
- 3 个直播间并发采集稳定运行 7 天无中断
- 用户画像生成延迟 < 1 分钟
- 礼物/SC/上舰事件采集准确率 > 98%

### V1（第二阶段）— 功能完整化
**时间线：** 8–10 周（基于 MVP 反馈）
**新增功能：**
- ✅ F3.1 AI 字幕获取（技术验证通过后）
- ✅ F3.4–F3.5 客户-主播偏好分析
- ✅ F4.4 完整场景分析（三个场景识别）
- ✅ F4.5–F4.6 互动建议增强 + 用户分群完整功能
- ✅ F5.2–F5.3 主播对比报表 + 粉丝排行
- ✅ 数据导出功能（CSV/Excel）

### V2（第三阶段）— 智能化扩展
**规划功能：**
- 预测模型：客户流失预测、消费预测
- A/B 测试框架：验证互动建议效果
- 多语言支持

---

## 7. 系统部署与配置

### 7.1 部署前置条件
**硬件要求**
- Windows 10+ / macOS 10.15+ / Linux (Ubuntu 18.04+)
- 内存 8GB 以上（推荐 16GB，应对多浏览器实例）
- 本地磁盘 50GB+ 存储空间
- Node.js 20 LTS

**依赖服务**
- SQLite（内嵌，通过 better-sqlite3 使用）
- LLM 服务：本地 Ollama 或云端 API（OpenAI/通义千问/DeepSeek）
- Playwright Chromium（自动安装）
- bilibili-live-ws（礼物/SC/上舰 WebSocket 解码）

**网络要求**
- B站直播间访问权限（需公网）
- LLM API 调用权限（若使用云端）

### 7.2 初始化步骤
1. **安装应用**：`npm install`，然后 `npx playwright install chromium`
2. **登录授权**：启动应用，自动弹出浏览器窗口，扫码登录 B站账号
3. **配置监控房间**：在设置中添加直播间 URL 或房间号
4. **配置 LLM**：指定模型路径或 API 密钥和每日调用上限
5. **开始采集**：应用自动启动浏览器实例，开始采集

---

## 8. 非功能需求

| 类别 | 要求 |
|------|------|
| 隐私 | 所有数据本地存储，不上传云端；Cookie 加密存储（使用系统 keychain 或 AES-256）。 |
| 安全 | 浏览器用户数据目录独立隔离；内部 API 仅监听 localhost，不对外开放；防止 XSS（前端输入均转义）。 |
| 性能 | 单直播间弹幕延迟 < 2 秒；支持 3–5 个直播间并发采集，总 CPU 占用 < 50%，内存 < 6GB。 |
| 稳定性 | 浏览器进程健康检查（每 60 秒），异常自动重启；采集任务断线重连（指数退避，最多重试 10 次）。 |
| 部署 | 本地单机运行，无需服务器，提供一键安装包（Electron NSIS installer 或 Node.js 脚本）。 |
| LLM 成本 | 支持配置本地模型（优先 Ollama），云端 API 每日调用上限可设置，超限后降级为本地模型。 |
| 数据保留 | 支持配置数据保留期限，过期原始事件自动清理，聚合画像永久保留。 |
| 可维护性 | 提供日志查看界面；关键错误（如 DOM 选择器失效、WebSocket 断连）可告警并引导用户更新配置；日志文件按天滚动，保留 7 天。 |
| 选择器维护 | DOM 选择器集中配置（`config/selectors.json`），B站更新后可快速修改而无需重新部署。 |

---

## 9. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|------|
| B站更新 DOM 选择器 | 高 | 弹幕采集中断 | 选择器集中配置 + 告警 + 备用选择器列表（`#chat-history-list .chat-item.danmaku-item`） |
| B站加强反爬检测 | 中 | 账号封禁 | Stealth 插件 + 行为模拟 + 每直播间使用独立 UA |
| WebSocket 协议变更 | 低 | 礼物/SC 采集中断 | 定期跟踪 bilibili-live-ws 更新 |
| LLM API 费用超支 | 中 | 成本失控 | 每日调用上限 + 本地模型备选 |
| SQLite 性能瓶颈 | 低 | 查询缓慢 | WAL 模式 + 复合索引 + 定期 VACUUM |

---

## 10. 不做的事（Out of Scope）

- 自动发送弹幕或任何写操作
- 批量采集陌生用户数据
- 任何形式的数据出售或共享
- 绕过 B站付费内容限制
- 微信消息接入（待后续讨论）
- 多账号管理（MVP 阶段，单账号）

---

## 附录 A：B站直播间 DOM 选择器速查表（已验证）

基于 2026-03-31 实际页面 HTML 验证（直播间 ID: 194484313，Build: 2026.03.27）：

```
弹幕容器:       #chat-items
弹幕元素:       .chat-item.danmaku-item
弹幕属性:       data-uid / data-uname / data-danmaku / data-ts / data-type / data-score
粉丝勋章:       .fans-medal-item-ctnr[data-anchor-id] .fans-medal-content
勋章等级:       .fans-medal-level-font
大航海标识:     .fans-medal-label.medal-guard（存在则为大航海用户）
荣耀勋章:       .wealth-medal-ctnr .wealth-medal
管理员标识:     .admin-icon
在线人数:       .item（包含文字 "房间观众(5658)"，正则解析）
礼物面板:       #gift-control-vm .gift-item
大航海入口:     .guard-ent
弹幕历史容器:   #chat-history-list
```

**注意：** B站前端定期更新（当前版本 4.0.0），建议每月检查一次选择器有效性，关键选择器变更时系统自动告警。
