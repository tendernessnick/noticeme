// AI 提示词构建（纯函数层）：提取任务的系统提示 + 周回顾的双消息提示
// few-shot 示例按「当前时间」动态生成日期，教小模型正确做相对日期推算
export type AiTaskKind = 'parse' | 'parseMany' | 'journalTodos'

export interface ReviewInput {
  /** 回顾范围（ISO） */
  sinceISO: string
  untilISO: string
  /** 日记摘录（内容已截断） */
  entries: Array<{ date: string; mood: string; content: string }>
  /** 本周完成任务标题 */
  doneTaskTitles: string[]
  /** 逾期/积压任务标题 */
  pendingTitles: string[]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地时间 ISO（无时区后缀，模型直接照抄格式） */
function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/** 下一个星期X（含今天：今天即该天则返回今天） */
function nextWeekday(now: Date, weekday: number): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = (weekday - d.getDay() + 7) % 7
  d.setDate(d.getDate() + diff)
  return d
}

function extractionRules(): string[] {
  return [
    '规则：',
    '1. dueAt：能确定具体时刻时输出 ISO 格式（YYYY-MM-DDTHH:mm:ss），按「当前时间」推算；推算不出输出空字符串 ""。',
    '2. 「X前 / X之前」是截止时间，dueAt 就是那天上午 09:00。',
    '3. 模糊表达按常理取默认时刻：早上→09:00，下午→14:00，晚上→20:00，下班→18:00，周末→周六 10:00。',
    '4. priority：仅当用户明示紧急/重要/优先级时输出 "1"~"4"（紧急=1），否则 ""。',
    '5. projectName 对应用户的 #清单，tags 对应用户的 @标签；未明示时 projectName 为 ""，tags 为 []。',
    '6. title 简洁完整，去掉已提取的时间词和标记符号。',
    '7. 输入含多个任务时输出多条，单一任务也放在数组里，最多 8 条。'
  ]
}

/** 快速添加 / 粘贴捕获的提取提示（grammar 约束输出 TASK_DRAFTS_SCHEMA） */
export function buildExtractionPrompt(kind: AiTaskKind, text: string, now: Date = new Date()): { system: string; user: string } {
  const ex1Due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0)
  const ex2Due = nextWeekday(now, 5) // 本周五 09:00（已过周五则今天）
  const ex3a = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0)
  const ex3b = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - now.getDay() + 7) % 7, 10, 0, 0)
  const journal = kind === 'journalTodos'

  const lines: string[] = []
  if (journal) {
    lines.push('你是待办应用的日记分析器，从日记正文中提取「明确的、可执行的待办事项」。')
    lines.push('只提取作者明确打算去做的事（写了 打算/要/记得/计划/想去 等），不提取愿望、感想或已完成的事。')
  } else {
    lines.push('你是桌面待办应用的任务提取器，把用户输入转换为结构化任务。')
  }
  lines.push(`当前时间：${fmtLocal(now)}（星期${WEEKDAY_CN[now.getDay()]}）`)
  if (!journal) lines.push(...extractionRules())
  else {
    lines.push('规则：dueAt 按日记中写的时间或「当前时间」合理推算，格式 YYYY-MM-DDTHH:mm:ss；推算不出输出 ""。')
    lines.push('title 提取为一句可执行的动作短语；最多 8 条；没有待办就输出空数组。')
  }
  lines.push('')
  lines.push('示例（假设当前时间是上面给出的时间）：')
  if (journal) {
    lines.push(`日记：今天买了新键盘很开心。记得周末把旧键盘挂到二手网站，另外下周要预约牙医复查。`)
    lines.push(`输出：{"tasks":[{"title":"把旧键盘挂到二手网站","dueAt":"${fmtLocal(ex3b)}","priority":"","tags":[],"projectName":""},{"title":"预约牙医复查","dueAt":"${fmtLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((1 - now.getDay() + 7) % 7 || 7), 9, 0, 0))}","priority":"","tags":[],"projectName":""}]}`)
  } else {
    lines.push(`输入：明天上午9点 给王总发合同`)
    lines.push(`输出：{"tasks":[{"title":"给王总发合同","dueAt":"${fmtLocal(ex1Due)}","priority":"","tags":[],"projectName":""}]}`)
    lines.push(`输入：周五之前 把方案初稿发给李经理`)
    lines.push(`输出：{"tasks":[{"title":"把方案初稿发给李经理","dueAt":"${fmtLocal(new Date(ex2Due.getFullYear(), ex2Due.getMonth(), ex2Due.getDate(), 9, 0, 0))}","priority":"","tags":[],"projectName":""}]}`)
    lines.push(`输入：下班后去取快递，另外周末记得给妈妈打电话`)
    lines.push(`输出：{"tasks":[{"title":"取快递","dueAt":"${fmtLocal(ex3a)}","priority":"","tags":[],"projectName":""},{"title":"给妈妈打电话","dueAt":"${fmtLocal(ex3b)}","priority":"","tags":[],"projectName":""}]}`)
  }
  lines.push('')
  lines.push(journal ? '日记正文：' : '用户输入：')

  return { system: lines.join('\n'), user: text.trim().slice(0, 2000) }
}

/** 今日聚焦候选任务（渲染端组装好的紧凑行，prompt 保持短小适配 1.5B） */
export interface FocusCandidate {
  id: string
  /** 标题（渲染端已截断） */
  title: string
  /** 紧凑截止描述：已逾期2天 / 今天到期 / 明天到期 / 3天后到期 / 无截止 */
  due: string
  /** 1 = 最高 */
  priority: number
  /** 是否已在今天计划中（模型应避免重复挑） */
  planned: boolean
}

/**
 * 今日聚焦「AI 帮我排今天」：从候选任务中挑选今天最值得做的（约束解码输出 picks）。
 * 规则注入过期优先/截止临近/高优先级/宁缺毋滥；理由 ≤15 字供预览展示。
 */
export function buildFocusSuggestPrompt(input: { candidates: FocusCandidate[]; now: Date }): { system: string; user: string } {
  const system = [
    '你是待办应用的每日规划助手。从候选任务中挑选今天最值得做的（最多 6 条，宁缺毋滥）。',
    '规则：',
    '1. 已逾期的优先；2. 截止日越近优先；3. 优先级数字越小（越紧急）优先；4. 不要挑已列入今天计划的；5. 挑选数量控制在 2~6 条。',
    '输出 JSON：{"picks":[{"id":"候选id","reason":"不超过15字的理由"}]}。直接输出 JSON，不要输出别的内容。'
  ].join('\n')

  const exId = input.candidates[0]?.id ?? 't1'
  const lines: string[] = []
  lines.push(`示例（假设候选如下）：`)
  lines.push(`t1|修复登录页报错|已逾期1天|1`)
  lines.push(`输出：{"picks":[{"id":"${exId}","reason":"已逾期，先处理"}]}`)
  lines.push('')
  const wd = '日一二三四五六'[input.now.getDay()]
  lines.push(`今天是 ${input.now.getMonth() + 1}月${input.now.getDate()}日 星期${wd}。候选任务：`)
  for (const c of input.candidates) {
    lines.push(`${c.id}|${c.title}|${c.due}${c.planned ? '|已在今日计划' : ''}|p${c.priority}`)
  }

  return { system, user: lines.join('\n').slice(0, 3000) }
}

/** 周回顾（自由文本输出，不用 grammar） */
export function buildWeeklyReviewPrompt(input: ReviewInput): { system: string; user: string } {
  const system = [
    '你是个人助理。根据用户过去一周的日记与任务完成情况，写一份 200~400 字的中文周回顾。',
    '格式分三节，用小节标题：「本周完成」「日记亮点」「下周建议」，每节下用短横线列表。',
    '语气平实具体，引用真实条目，不要空洞的鼓励话术。直接输出正文。'
  ].join('\n')

  const parts: string[] = []
  parts.push(`回顾范围：${input.sinceISO.slice(0, 10)} 至 ${input.untilISO.slice(0, 10)}`)
  if (input.doneTaskTitles.length) {
    parts.push('', '已完成任务：')
    for (const t of input.doneTaskTitles) parts.push(`- ${t}`)
  }
  if (input.pendingTitles.length) {
    parts.push('', '仍积压/逾期的任务：')
    for (const t of input.pendingTitles) parts.push(`- ${t}`)
  }
  if (input.entries.length) {
    parts.push('', '日记摘录：')
    for (const e of input.entries) {
      parts.push(`【${e.date}${e.mood ? ` 心情${e.mood}` : ''}】${e.content}`)
    }
  } else {
    parts.push('', '（本周没有日记）')
  }
  return { system, user: parts.join('\n').slice(0, 6000) }
}
