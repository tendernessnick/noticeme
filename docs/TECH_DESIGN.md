# NoticeMe 技术设计文档

> 角色：全栈开发工程师 · 依据 `docs/PRD.md` · 版本 0.1.0

## 1. 技术栈（最通用模式）

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面运行时 | Electron 33 | VS Code/Slack 同款；托盘、全局快捷键、Toast、多窗口支持最完善 |
| 构建 | electron-vite 2 + Vite 5 | Electron 官方社区标准脚手架模式（main/preload/renderer 三段构建） |
| 语言 | TypeScript 5（strict） | 全链路类型安全，IPC 协议有类型声明 |
| UI | React 18 + zustand 4 + Tailwind CSS 3.4 + lucide-react | 最主流的桌面前端组合 |
| 存储 | 本地 JSON（`userData/data.json`） | 零原生依赖（避免 SQLite 编译风险），数据量级适合 |

安全基线：`contextIsolation: true`、`nodeIntegration: false`，渲染端仅通过 `contextBridge` 暴露的白名单 API 通信。

## 2. 架构

```
┌────────────────────────── 主进程（唯一数据源） ──────────────────────────┐
│  Store(JSON持久化) ← mutate唯一入口 → onChange → 广播db:updated/托盘刷新  │
│    ↑ IPC                     Scheduler(10s tick + 变更唤醒400ms)          │
│  渲染端IPC       collectFires(纯函数) → FireItem[] → onFires            │
│                                 ├→ AlertManager(置顶弹窗卡片，不抢焦点)   │
│                                 └→ showToast(Windows系统通知，静音)       │
│  Tray(托盘菜单+今日计数)  Shortcuts(全局快捷键)  Smoke钩子(自动截图退出)   │
└──────────────────────────────────────────────────────────────────────┘
        │ contextBridge (preload: getDb/upsertTask/alertAction/...)
┌────────────────────────── 渲染端 ───────────────────────────────────────┐
│  主窗口: Sidebar / TopBar / QuickAdd(NL解析) / TaskList(分组) /           │
│         TaskDetail(抽屉) / SettingsModal(主题·提醒·快捷键·数据)           │
│  独立提醒页 alert.html: 无边框·透明·置顶卡片（完成/稍后/打开/关闭）        │
└──────────────────────────────────────────────────────────────────────┘
```

**核心原则：主进程 DB 是唯一数据源。** 渲染端所有变更走 IPC → `store.mutate`（持久化+广播）→ 两端一致；任何窗口（含提醒卡片）动作最终都回到主进程。

## 3. 数据模型（`src/shared/types.ts`）

- `Task`：id/title/notes/projectId/tags[]/priority(1-4)/dueAt/reminders[]/repeat/done/completedAt/createdAt/updatedAt/order
- `Reminder`：`{ id, offsetMin: number|null }`（null=准时，N=提前 N 分钟）
- `RepeatRule`：`{ freq: daily|weekdays|weekly|monthly|yearly, interval? }`
- `Snooze`：`{ id, taskId, fireAt }`（持久化，重启存活）
- `Settings`：主题/三种提醒开关/自启/关到托盘/两个快捷键/贪睡预设/循环提醒/补发窗口
- `Database`：`{ version, tasks, projects, snoozes, settings, firedKeys[], updatedAt }`
- `firedKeys`：`taskId:reminderId:dueAt` 防重键（上限 500 修剪），跨重启防重复弹

## 4. 关键流程：提醒触发链路

1. **扫描**：Scheduler 每 10s tick；任何任务变更额外 400ms 内唤醒一次
2. **收集**（纯函数 `collectFires(db, now, missedWindow)`）：
   - 贪睡到点 → 触发并消费
   - 任务提醒：`fireAt = dueAt - offset`；到点且键未消费：
     - 迟到 ≤ missedWindow（默认 30 分钟）→ **补发弹窗**
     - 迟到 > 30 分钟 → 静默标记消费（只显示逾期红标）
3. **呈现**：`notifyAlert` → 置顶弹窗卡片（右下角、`showInactive` 不抢键盘焦点 + `flashFrame` 闪任务栏 + 提示音）；`notifyToast` → Windows 通知（点按跳转任务）
4. **处置**：完成 / 稍后（5·10·30·60·1440 分钟 → 写入 Snooze）/ 打开 / 关闭；开启「循环提醒」时关闭=稍后 nagInterval
5. **重复任务完成**：`nextOccurrence(due, rule, now)` 推进到未来下一次（逾期的中间实例自动跳过），保持未完成

## 5. IPC 协议（preload 白名单）

`db:get` `task:upsert` `task:delete` `task:setDone` `project:add|update|delete` `settings:update` `data:export|import|info` `assets:chime` `alert:sync` `alert:action`；推送：`db:updated` `ui(quickadd|open-task)` `alert:queue`。

提醒卡片页与主窗口共用 preload；alert 页挂载时 `alert:sync` 主动拉取队列 + 主进程 `did-finish-load` 重发，双保险规避「加载期 IPC 消息丢失」竞态。

## 6. 目录结构

```
src/shared/     纯逻辑层（无 Electron 依赖，100% 可单测）
  types/defaults/datetime/parse/recurrence/scheduler-core
src/main/       Electron 主进程（store/scheduler/alerts/notify/tray/shortcuts/index）
src/preload/    contextBridge API + 渲染端类型声明
src/renderer/   index.html(主界面) + alert.html(提醒卡片) + src/{App,store,components,utils}
tests/          vitest 单测（46 用例）
scripts/        gen-icon / gen-chime（零依赖资产生成）、smoke（自动截图冒烟）
resources/      icon.png|ico、chime.wav
docs/           PRD / TECH_DESIGN / RUNBOOK / TEST_REPORT / prompts(角色流水线)
```

## 7. 可测试性设计

全部业务规则（解析、重复推进、触发收集、默认数据、形状校验）在 `src/shared/` 纯函数层；`Store` 构造注入目录（测试用临时目录）；主进程内置 `NOTICE_ME_SMOKE=<dir>` 钩子：独立临时数据目录 + 注入演示数据 + 主界面/提醒卡片/暗色主题自动截图 + 退出码返回。

## 8. 已知取舍

- 提醒扫描粒度 10s（PRD 要求 ≤10s 内呈现，实测 tick 内即触发；如需秒级可加 per-task timer）
- JSON 存储：万级任务内性能足够；未来可平滑迁 SQLite（Store 接口不变）
- 系统通知在未打包 dev 模式下部分 Windows 环境不可用（弹窗卡片为主通道，不受影响）
- 任务排序暂不支持拖拽（`order` 字段已预留）
