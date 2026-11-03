# NoticeMe 运行手册（RUNBOOK）

## 日常开发

```bash
npm install        # 首次安装依赖（含 Electron 桌面运行时）
npm run dev        # 开发模式启动（热更新）
```

- `F12` 打开开发者工具（仅 dev 模式）
- dev 模式数据与正式安装共用 `userData` 目录，见下文

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 主进程 + 渲染端 TS 类型检查 |
| `npm run build` | 产物构建到 `out/` |
| `npm run test` | vitest 单元测试（46 用例） |
| `npm run smoke` | 冒烟测试：自动注入演示数据、截图（主界面/提醒卡片/暗色）到 `smoke-out/` 后退出；使用独立临时数据目录，**不污染真实数据** |
| `npm run dist` | 打包 Windows 安装包 + 便携版到 `dist/` |
| `npm run gen:assets` | 重新生成图标/提示音资产（一般无需执行） |

## 数据位置

- 数据文件：`%APPDATA%\noticeme\data.json`（资源管理器输入 `%APPDATA%\noticeme` 直达）
- 每日备份：`%APPDATA%\noticeme\backups\`（保留最近 7 份，每天第一笔变更时快照）
- 导入数据前自动留底 `data-before-import-<时间戳>.json`

**备份/迁移**：设置 → 数据 → 导出备份（JSON）；换机或重装后用导入恢复。

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

- 时间：今天/今晚/明天/后天/大后天、周X、下周X、裸「下周/下下周」（→下周一）、周末、月底、裸「9号/十九号」（过去的号自动顺延下月）、11月5日、11月9（可省「日/号」）、2026-11-05、N天后/三天之后、9点/9点半/14:30、30分钟后、时段词可单独给时刻（明天下午→14:00、晚上→20:00）
- 优先级：`p1`~`p4`（1 最高）；项目：`#名称`（不存在则自动创建）；标签：`@名称`（项目/标签先于日期解析，`@周末` 不会被当成日期）
- 有截止时间的任务默认「准时」提醒，可在详情中增加「提前 N 分钟」

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

## 故障排查

| 现象 | 处理 |
|---|---|
| 没弹提醒 | 检查任务是否有截止时间与提醒（铃铛数字）；设置中「置顶弹窗卡片」是否开启；重启后 30 分钟内的错过提醒会自动补弹 |
| 弹窗出现但空白 | 已通过 alertSync 双保险修复；若仍出现请附带 `smoke.log` 反馈 |
| 系统通知不出现 | dev 模式属正常（未注册通知中心）；安装版可用 |
| 数据疑似损坏 | 应用自动降级并留档 `data.json.corrupt-<ts>`，从 backups 恢复 |
