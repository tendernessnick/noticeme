# NoticeMe 运行手册（RUNBOOK）

## 日常开发

```bash
npm install        # 首次安装依赖（含 Electron 桌面运行时）
npm run dev        # 开发模式启动（热更新）
```

- `F12` 打开开发者工具（仅 dev 模式）
- v0.5.0 起 dev 使用独立 `%APPDATA%\noticeme-dev\`，正式安装仍用原 `%APPDATA%\noticeme\`。两者不自动复制或覆盖，避免调试改动个人记录；开发中需要样例可手动导入导出副本。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 主进程 + 渲染端 TS 类型检查 |
| `npm run build` | 产物构建到 `out/` |
| `npm run test` | vitest 单元测试（142 用例） |
| `npm run smoke` | 独立临时数据目录，注入演示记录并验证聚焦/编辑/搜索/退出保存；截图及报告输出到 `smoke-out/<时间戳>/`，**不污染真实数据** |
| `node scripts/smoke.mjs "dist/0.5.0/win-unpacked/NoticeMe.exe"` | 对 Windows 打包产物执行相同隔离验收（先完成打包） |
| `npm run dist` | 打包 Windows 安装包 + 便携版到 `dist/` |
| `npm run release` | 发布一条龙：typecheck → 单测 → 打包 → 上传 GitHub Release（需 gh CLI 已登录） |
| `npm run gen:assets` | 重新生成图标/提示音资产（一般无需执行） |

冒烟源码模式限时 60 秒、打包模式 180 秒（便携版需自解压原生运行时），可通过 `NOTICE_ME_SMOKE_TIMEOUT_MS` 调整。限时只影响测试等待，所有交互与落盘断言不变。

## 数据位置

- 数据文件：`%APPDATA%\noticeme\data.json`（资源管理器输入 `%APPDATA%\noticeme` 直达）
- 每日备份：`%APPDATA%\noticeme\backups\`（保留最近 7 份，每天第一笔变更**前**保留上一状态）
- 导入数据前自动留底 `data-before-import-<时间戳>-<唯一标识>.json`，永久保留，不计入每日 7 份限额；导入需要确认覆盖当前数据。
- 主数据损坏时先保留 `.corrupt-*` 原件，再选择最近的有效备份恢复并提示。若无有效备份或版本过新，停止启动保护原件；请保留数据目录，从已导出的副本恢复，勿删除文件排错。
- 编辑器出现保存错误时，草稿仅保留在**当前会话内存**，可切回编辑器重试。正常退出会先保存，失败取消退出；强制结束进程、断电仍可能丢失未落盘输入。

**备份/迁移**：设置 → 数据 → 导出备份（JSON）；换机或重装后用导入恢复。

## 日记板块

- 侧栏「日记」进入：左侧按月分组列表（置顶优先），右侧全高编辑器
- 每篇支持：标题（可留空）、归属日期、心情 emoji（😊🙂😐😞😠）、标签、置顶
- 正文多行纯文本，**自动保存**（输入停顿 450ms 落盘）；删除为两步确认
- 数据随 `data.json` 一起备份/导入导出；0.1.x 旧数据自动迁移（无日记则为空）

## 清单管理

- 侧栏「清单」区：悬停清单行显示 **重命名（✎）/ 删除（🗑）** 按钮（收集箱不可删改）
- 删除为**两步确认**：点击 🗑 后出现红色确认条（3 秒未确认自动取消），删除后清单下任务自动移回收集箱
- 重命名为行内编辑：回车或失焦保存，Esc 取消

## 快捷键一览（可在设置中改）

| 快捷键 | 作用 |
|---|---|
| `Ctrl+Alt+N` | 全局快速添加（任何界面直达输入框） |
| `Ctrl+Alt+S` | 显示 / 隐藏主窗口 |
| 输入框内 `Enter` | 添加任务；`Esc` 清空 |

> 快捷键与其他软件冲突时注册会静默失败，可在设置中换一组。

## 快速添加语法

```
明天 9 点 写周报 p1 #工作 @电脑
```

- 时间：今天/今早/今晚/明天/明早/明晚（明早→8:00、明晚→20:00）/后天/大后天、周X/星期X/礼拜X、下周X、裸「下周/下下周」（→下周一）、周末、月底、月初、月中、年底、裸「下个月/下个月15号」、裸「9号/十九号」（过去的号自动顺延下月）、11月5日、11月9（可省「日/号」）、2026-11-05、N天后/N天内/三天之内、30分钟后/10分钟内/5分钟之后/2小时后/半小时后/2个小时内/两个钟头后/一刻钟后/三刻钟内（每刻=15分钟）、9点/九点半/9点30/14:30/早8点/晚10点/10点一刻/八点三刻/9点整、今晚10点（→22:00 晚间语境）、时段词可单独给时刻（明天下午→14:00、晚上→20:00、上午→9:00、早上→8:00）
- 优先级：`p1`~`p4` / `!1`~`!4`（显式 p 优先）；中文词「紧急/重要」→P1、「高优先级」→P2、「中优先级」→P3、「低优先级」→P4；项目：`#名称`（不存在则自动创建）；标签：`@名称`（项目/标签先于日期解析，`@周末` 不会被当成日期）
- 有截止时间的任务默认「准时」提醒，可在详情中增加「提前 N 分钟」；完整语法可在应用内快速添加框右侧 ⌨ 图标查看

## 提醒行为细节

- **提前弹出**：提醒默认在设定时刻**前 ~10 秒**弹出（提前量补偿弹窗与调度延迟，到点时提醒已就位）；调度扫描周期 5 秒
- **位置**：提醒卡片右下角弹出，右缘、底缘**完全贴住屏幕边缘**（无系统阴影/边框光晕，窗口高度随内容自适应）；卡片四周留 6px 内衬呼吸感
- **提示音**：由主进程调用 Windows 系统播放器播放（不依赖窗口/页面加载状态，最可靠）

## 常驻与自启

- 默认点关闭 = 最小化到托盘（设置可改为彻底退出）；托盘菜单可退出
- 设置 → 通用 → 开机自启（dev 模式注册的是 Electron 开发程序路径，正式使用请以安装版开启）

## 打包说明

```bash
npm run dist
```

产出：
- `dist/NoticeMe-Setup-0.1.0.exe`（NSIS 安装包，可选安装目录、创建桌面快捷方式）
- `dist/NoticeMe-Portable-0.1.0.exe`（免安装便携版）

已固化到配置的离线/网络适配（本机实测有效）：
- `electron-builder.yml` 中 `electronDist: node_modules/electron/dist`：直接复用 npm 安装时的本地 Electron，无需再下载
- `win.signAndEditExecutable: false`：绕过 winCodeSign 符号链接特权问题（无开发者模式的机器）；代价是 exe 文件图标为默认，运行期图标不受影响
- NSIS 工具链网络受限时设置镜像：`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
- 若报 `Plugin not found ... UAC`：把 `%LOCALAPPDATA%\electron-builder\Cache\nsis\<临时目录>\plugins\x86-unicode\*.dll` 拷入 `nsis-3.0.4.1\Plugins\x86-unicode\` 后重试

## 发布 Release（GitHub）

安装包通过 GitHub Releases 分发，**不进 git 仓库**（`dist/` 保持 gitignore，仓库只存源码与文档）。

前置条件：gh CLI 已安装并登录（`gh auth status` 检查；未登录时 `gh auth login -h github.com -p https -w` 走浏览器设备码授权）。

```bash
# 一键发布（先升 package.json 版本号，再执行；自动 typecheck+测试+打包+上传）
npm run release

# 或手动分步
npm run dist
gh release create v0.1.3 dist/NoticeMe-Setup-0.1.3.exe dist/NoticeMe-Portable-0.1.3.exe \
  --title "NoticeMe v0.1.3" --notes "更新说明"
```

发布后安装包出现在 `https://github.com/tendernessnick/noticeme/releases`，供任何机器直接下载安装。

## 故障排查

| 现象 | 处理 |
|---|---|
| 没弹提醒 | 检查任务是否有截止时间与提醒（铃铛数字）；设置中「提醒方式」是否为卡片/同时；重启后 30 分钟内的错过提醒会自动补弹 |
| 没有提示音 | 设置中开启「提示音」并试听；提示音由 Windows 系统播放器播放，受系统音量/静音影响 |
| 弹窗出现但空白 | 已通过 alertSync 双保险修复；若仍出现请附带 `smoke.log` 反馈 |
| 系统通知不出现 | dev 模式属正常（未注册通知中心）；安装版可用 |
| 数据疑似损坏 | 应用自动降级并留档 `data.json.corrupt-<ts>`，从 backups 恢复 |
