// 来源：moneycome harness/src/finance-tasks/question-gate.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * @runtime-status 未接线：纯函数与单测已建，尚无调用方。接线属 B8 节奏引擎。
 *
 * 提问下发闸（开发计划 B8 · 规格 `13 §3.2`）。
 *
 * 一句话职责：**决定这一刻把哪些待问问题呈现给用户，其余排队。**
 *
 * ## 为什么需要一道确定性的闸
 *
 * 提问预算是硬指标，而硬指标不能靠模型自觉。⑦ 缺口合并节点负责把同根因的多个
 * 缺口并成一个问题——它做得好不好，影响的是「排队里有几个」；**下发几个由本函数
 * 决定，模型无从干预**。
 *
 * ## 两个数字不是一回事，此前被混为一谈
 *
 * - **合并质量指标（验收用）**：一批材料合并后产生的问题总数 ≤ 3。这是对 ⑦ 的
 *   考核，见 `06 §4.2`——14 份材料只允许问 3 个。
 * - **下发闸（运行时，即本函数）**：同一时刻呈现给同一个人的未答问题数 ≤ 1。
 *   依据 4.9 §12.1 第 5 条「一次只要求处理一个当前最关键的问题」，以及 `06 §4.5`
 *   的 Z1 用例「只问当前最关键的一个，其余排队；不一次性抛出，也不因为预算满了
 *   就静默入账」。
 *
 * 默认 limit = 1 正是后者。把验收指标当成运行时闸（一次抛 3 个）会直接违反 Z1。
 *
 * ## 三条不变式
 *
 * 1. **排队不等于丢弃。**没下发的问题原样留在 `queued`，下一次调用可能轮到它。
 *    「预算满了就静默入账」是 Z1 明令禁止的行为。
 * 2. **已转发的不占预算。**用户点了「我去问问张总」之后问题转 `waiting`——她的动作
 *    做完了，不该被这条挡住下一件事。只有 `asked` 占预算。
 * 3. **同根因不同时下发。**⑦ 已经合并过，这里是第二道保险；合并漏了也不会让用户
 *    在同一刻看到两个问同一件事的卡片。**跨调用也算数**——已下发未答的问题
 *    （`asked` 与 `waiting` 都算）同样占住它的根因。
 *
 *    2026-08-15 修：初版的根因去重只在单次调用内生效，`OutstandingQuestion` 不带
 *    `rootCauseKey`，函数无从知道上一次下发的是哪个根因。`limit=1` 且同一承办人时
 *    预算恰好把它兜住，看不出来；**分派给两个承办人就漏**——各自预算独立，同根因的
 *    两个问题一前一后都下发，前台和老板各拿到一张问同一件事的卡片。POC 干跑 D3b
 *    照出来的（`17 §七`）。
 *
 *    `waiting` 在这一条上与 `asked` 同权，跟不变式 2 不冲突：预算管的是「这个人手上
 *    压了几件事」，转出去就不压了；根因管的是「这件事有没有人在办」，转出去恰恰
 *    说明正在办。两个维度，不是一个。
 */

/** 谁来回答。两人版只有这两个角色，各自独立预算。 */
export type QuestionAssignee = 'reception' | 'boss';

/** 已下发问题的状态。只有 `asked` 占预算。 */
export type OutstandingQuestionState = 'asked' | 'waiting';

export interface PendingQuestion {
  readonly questionId: string;
  /** 同根因的问题永不同时下发（不变式 3）。 */
  readonly rootCauseKey: string;
  /** 期间键，如 `2026-03`。字典序即时间序，越早越急。 */
  readonly periodKey: string;
  /** 这个问题不答，对应期间能不能结账。 */
  readonly blocksClosing: boolean;
  readonly assignee: QuestionAssignee;
  /**
   * 单调递增序号。**刻意不用时间戳**——本函数必须可复算，同一份输入任何时候
   * 跑都得出同一结果，这样才测得住，也才能在决策链里解释「当时为什么先问这个」。
   */
  readonly createdSeq: number;
}

export interface OutstandingQuestion {
  readonly questionId: string;
  readonly assignee: QuestionAssignee;
  readonly state: OutstandingQuestionState;
  /**
   * 已下发问题的根因，供跨调用去重（不变式 3）。
   *
   * **可选，因为调用方可能给不出**——早期接线只记了 questionId。给不出时退回
   * 单次调用内去重，行为与初版一致；给得出就多挡一层。刻意不设默认值：
   * 编一个假根因会让两个不同根因的问题互相顶掉。
   */
  readonly rootCauseKey?: string;
}

export interface QuestionGateDecision {
  /** 本次下发。按呈现顺序排列。 */
  readonly toAsk: readonly string[];
  /** 排队。**不是丢弃。** */
  readonly queued: readonly string[];
  /** `questionId -> 为什么排队`，进决策链供解释。下发的不在此表内。 */
  readonly queuedReason: Readonly<Record<string, string>>;
}

/** 同一时刻呈现给同一个人的未答问题数上限。 */
export const DEFAULT_ASK_LIMIT = 1;

const QUEUE_REASON = {
  budget: 'budget_full',
  duplicateRootCause: 'same_root_cause_already_asked',
} as const;

/**
 * 决定这一刻下发哪些问题。
 *
 * 纯函数：无 IO、无时钟、无随机。同一份输入永远得出同一结果。
 *
 * @param pending 待问队列。顺序不重要，本函数自己排。
 * @param outstanding 已下发未答的问题。`waiting` 不占预算（不变式 2）。
 * @param limit 每人同时未答上限。默认 1。
 */
export function selectQuestionsToAsk(
  pending: readonly PendingQuestion[],
  outstanding: readonly OutstandingQuestion[] = [],
  limit: number = DEFAULT_ASK_LIMIT,
): QuestionGateDecision {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('question gate limit must be a positive integer');
  }

  const askedCount: Record<QuestionAssignee, number> = {
    reception: 0,
    boss: 0,
  };
  const claimedRootCause = new Set<string>();
  for (const row of outstanding) {
    // 预算只算 `asked`（不变式 2），根因 `asked` 与 `waiting` 都算（不变式 3）。
    if (row.state === 'asked') askedCount[row.assignee] += 1;
    if (row.rootCauseKey !== undefined) claimedRootCause.add(row.rootCauseKey);
  }

  const toAsk: string[] = [];
  const queued: string[] = [];
  const queuedReason: Record<string, string> = {};

  for (const question of [...pending].sort(compareUrgency)) {
    if (claimedRootCause.has(question.rootCauseKey)) {
      queued.push(question.questionId);
      queuedReason[question.questionId] = QUEUE_REASON.duplicateRootCause;
      continue;
    }
    if (askedCount[question.assignee] >= limit) {
      queued.push(question.questionId);
      queuedReason[question.questionId] = QUEUE_REASON.budget;
      continue;
    }
    toAsk.push(question.questionId);
    claimedRootCause.add(question.rootCauseKey);
    askedCount[question.assignee] += 1;
  }

  return { toAsk, queued, queuedReason };
}

/**
 * 排序即优先级，全确定性。**用户没有排序权**——判断哪件更急本身就是领域知识，
 * 而前台没有（`13 §5.5`）。
 *
 * 1. 挡结账的先问：不答就定不了账，代价最大
 * 2. 期间早的先问：3 月的问题比 4 月急，因为 3 月先到结账日
 * 3. 先产生的先问：同等条件下不插队
 * 4. questionId 兜底：保证全序，避免同 seq 时排序不稳定
 */
function compareUrgency(a: PendingQuestion, b: PendingQuestion): number {
  if (a.blocksClosing !== b.blocksClosing) return a.blocksClosing ? -1 : 1;
  if (a.periodKey !== b.periodKey) return a.periodKey < b.periodKey ? -1 : 1;
  if (a.createdSeq !== b.createdSeq) return a.createdSeq - b.createdSeq;
  return a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0;
}

/**
 * 合并质量指标：一批材料合并后产生的问题数是否超预算。
 *
 * **这是验收用的，不是运行时闸。**超了不阻断流程——它说明 ⑦ 合并做得不够好，
 * 该修的是合并逻辑，不是把多出来的问题吞掉。吞掉就变成「静默入账」，正是 Z1
 * 禁止的行为。
 *
 * @param batchQuestionCount 本批材料合并后的问题数
 * @param budget 预算，`06 §4.2` 定为 3
 */
export function isWithinMergeBudget(
  batchQuestionCount: number,
  budget = 3,
): boolean {
  return batchQuestionCount <= budget;
}
