# BiliInsight

B站直播间弹幕监控与用户洞察工具。在本地运行，数据不上传任何服务器。

## 功能

- 多直播间同时监控（最多 5 个）
- 实时弹幕 / 礼物 / SuperChat / 上舰 / 入场事件采集
- 用户统计排行（弹幕数、消费金额、守护等级）
- 浏览器内嵌 UI，关闭浏览器自动停止后端
- Cookie 导入，免扫码启动

## 环境要求

- [Node.js](https://nodejs.org/) 20 或更高版本
- Windows 10/11（Playwright Chromium 首次启动约需下载 ~150MB）

## 快速开始

```bat
node start.js
```

或双击 `start.bat`。

首次运行会自动安装后端/前端依赖并下载 Playwright Chromium，随后弹出 Chromium 窗口，扫码登录 B站后 UI 自动打开。

### Cookie 导入（免扫码）

将 B站 Cookie 导出为 JSON 键值对格式，保存为项目根目录下的 `cookie.json`：

```json
{
  "SESSDATA": "...",
  "bili_jct": "...",
  "DedeUserID": "..."
}
```

启动时自动导入，无需扫码。

> **注意：** `cookie.json` 已加入 `.gitignore`，不会被提交到仓库。

## 目录结构

```
BiliInsight/
├── config/
│   ├── default.json        # 服务端口、浏览器参数、采集配置
│   └── selectors.json      # B站页面 DOM 选择器（B站改版时更新此处）
├── frontend/               # React + Vite 前端
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       ├── useSSE.js
│       └── components/
├── src/                    # Node.js 后端
│   ├── index.js            # 启动入口
│   ├── auth.js             # Playwright 登录 / Cookie 管理
│   ├── collector.js        # 弹幕 + WebSocket 双路采集
│   ├── db.js               # SQLite（node:sqlite 内置）
│   ├── routes.js           # Express REST API + SSE + 心跳
│   └── sse.js              # SSE 推送管理
├── start.js                # 一键启动脚本
├── start.bat               # Windows 快捷入口
└── package.json
```

## API 接口

后端运行在 `http://127.0.0.1:3000`，仅允许本机访问。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rooms` | 列出所有监控房间 |
| POST | `/api/rooms` | 添加房间（body: `{ room_id }` 或 `{ url }`） |
| DELETE | `/api/rooms/:id` | 删除房间并停止采集 |
| GET | `/api/rooms/:id/users` | 用户统计列表 |
| GET | `/api/rooms/:id/stream` | SSE 实时事件流 |
| GET | `/api/dashboard` | 所有房间状态汇总 |
| GET | `/api/auth/status` | 登录状态 |

## 数据存储

- SQLite 数据库位于 `data/biliinsight.db`（自动创建，`.gitignore` 已排除）
- 弹幕/礼物记录保留 90 天，入场记录保留 180 天，每日自动清理

## 隐私说明

以下目录/文件包含账号信息，已加入 `.gitignore`，**不会**上传到 Git：

| 路径 | 内容 |
|------|------|
| `cookie.json` | B站登录 Cookie |
| `browser-profiles/` | Playwright 浏览器持久化 profile |
| `data/` | 本地 SQLite 数据库 |
| `logs/` | 运行日志 |

## 技术栈

**后端**：Node.js · Express · Playwright (Chromium) · bilibili-live-ws · SQLite (node:sqlite)

**前端**：React 18 · Vite · 原生 CSS（无 UI 库）
