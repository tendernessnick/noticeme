# NoticeMe 本地 AI 增强技术设计

> 依据 `docs/PRD.md`（本地优先原则不变）· 模型：Qwen2.5-1.5B-Instruct（Q4_K_M GGUF）

## 1. 产品定位

「本地优先 + 本地智能」：别人的 AI 待办把生活上传云端，NoticeMe 在用户电脑里放一个约 1 GB 的本地大脑。

**红线（与 PRD 提醒可靠性决策一致）：**

1. AI 完全不进提醒触发链路（Scheduler/collectFires 一行未动），只服务输入辅助与回顾生成
2. AI 永远只提议，不自动增删改任务——所有结果经预览确认
3. 默认关闭；不下载模型的用户完全无感知，安装包不捆绑模型

## 2. 能力范围

| 场景 | 入口 | 输出 |
|---|---|---|
| 快速添加 AI 兜底 | QuickAdd 正则无截止时间时自动触发 | 合并解析结果（hint chip 带 AI 徽标） |
| 粘贴捕获 | QuickAdd 粘贴多行/长文本 | 任务草稿列表 → 勾选批量入库 |
| 日记提取待办 | JournalView 编辑器「提取待办」 | 草稿建议卡 → 逐条确认 |
| 周回顾 | JournalView 侧栏 ✨ | 200~400 字回顾 → 复制 / 存为日记 |

## 3. 架构

```
渲染端 ──IPC──> AiManager（主进程：懒加载/串行队列/空闲卸载/下载编排）
                    │ utilityProcess.fork(out/main/ai-worker.js)
                    ▼
              ai-worker（独立进程：getLlama → loadModel → createContext 4096
                        → createGrammarForJsonSchema → LlamaChatSession.prompt）
                    │ node-llama-cpp（动态 import() 加载，见 §5）
                    ▼
              GGUF 模型（userData/models/，按需下载，不进 asar）
```

**关键决策：**

- **推理在独立进程**：1.5B CPU 生成 3~6s，主进程被阻塞会冻结 10s 调度 tick 与 IPC——不可接受；独立进程附带崩溃隔离（native 崩溃主进程不死，下次调用自动重启 worker）
- **懒加载 + 空闲卸载**：首次 AI 调用才 fork + 加载（约 2~4s），推理后空闲 N 分钟（默认 3）kill 整个 worker——内存归零，符合托盘常驻应用的内存纪律；重载代价约 2s
- **提示词/校验在 shared 纯函数层**：模型只是 I/O，`ai-schema.ts`（线协议校验/修复/合并）+ `ai-prompts.ts`（提示词模板）100% 单测覆盖，无模型的 CI 机器可测

## 4. 三道防线（1.5B 质量问题的应对）

1. **约束解码**：输出走 `TASK_DRAFTS_SCHEMA` 的 GBNF 语法——模型想跑偏也跑不出合法 JSON。线协议刻意简化：可能为空的字段用 `""` 表示「无」，避免跨 null 联合类型的生成不稳定
2. **校验修复**（`validateDrafts`）：幻觉的过去日期（>12h 前）归 null、非法优先级降级、标签去重截断、单条无效只丢该条
3. **预览确认**：hint chip / 拆解列表 / 待办建议卡全部可视化，用户拍板后才入库

## 5. node-llama-cpp 集成要点（踩坑记录）

- **纯 ESM 且含顶层 await**：`require()` 永远无法加载（`ERR_REQUIRE_ASYNC_MODULE`）。worker 里用「拼接模块名 + `@vite-ignore`」的动态 `import()`——rollup 4 已移除 `renderDynamicImport`，只有不可静态分析的 import() 才会在 CJS 输出中原样保留
- **上下文必须显式设小**（`createContext({ contextSize: 4096 })`）：Qwen2.5 训练上下文 32k，不限制则 KV cache 按大上下文分配，内存翻数倍
- **CPU-only**（`getLlama({ gpu: false })`）：CUDA/Vulkan 变体二进制在打包时排除（`electron-builder.yml` files 负向规则），dev 依赖留着不影响
- **推理参数要「死板」**：temperature 0.15 + maxTokens 上限（提取 500 / 回顾 900）
- **采样复用**：LlamaChatSession 每次请求新建（历史不跨请求），`disposeSequence: false` 保住常驻 context

## 6. IPC 协议（preload 白名单新增）

`ai:status` `ai:download:start|cancel` `ai:model:pick` `ai:parse` `ai:extractMany` `ai:journalTodos` `ai:weeklyReview` `ai:test`；推送：`ai:state`（状态+下载进度广播）。

## 7. Settings 新增字段（sanitizeDb 默认值合并，零迁移）

`aiEnabled`（默认 false）`aiQuickAddFallback`（默认 true）`aiIdleUnloadMin`（默认 3，0=常驻）`aiModelPath`（空=默认路径）。

## 8. 模型获取

- 默认路径：`userData/models/qwen2.5-1.5b-instruct-q4_k_m.gguf`（约 1 GB）
- 下载源依次尝试：hf-mirror.com → huggingface.co；`.part` 断点续传；进度广播到设置页
- 后路：设置页「选择文件…」手动指定任意 GGUF（下载源不可用时依然可用）
- 未来换模型 = 换一个 GGUF 文件路径，架构不动

## 9. 内存与延迟预期（CPU）

| 项 | 数值 |
|---|---|
| 常驻内存（推理期间） | weights ~1.1GB + 4k KV cache ~200MB ≈ 峰值 1.5GB，空闲卸载后归零 |
| worker fork + 原生初始化 | ~1.3s + 0.1s（探针实测） |
| 首次加载模型 | 预期 2~4s（SSD） |
| 单次提取（约 50~100 输出 token） | 预期 3~6s |
| 周回顾 | 视输入量 5~15s |

## 10. 验证

- `npm test`：88 用例（含 42 个 AI schema/合并用例）
- `npm run ai:probe`：真实 Electron 里 fork worker + 原生运行时初始化（加模型路径参数则含加载耗时）
- `npm run smoke`：AI 默认关，主流程不受影响
- `npm run dist`：asarUnpack 生效，`.node`+DLL 解包到 `app.asar.unpacked`；安装包增量 ≈ 运行时二进制（数十 MB），无模型
