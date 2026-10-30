// 来源：moneycome harness/src/finance-intake/book-write.contract.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 写侧三把（识别材料 / 关联材料 / 生成分录）共用的错误码闭集与输入形状。
 *
 * 错误码分两类，handler 按类映射：
 *
 * - **模型看一眼就能纠正的**（东西不存在、写法不对）与**状态不允许的**（已识别、
 *   证据不齐、期间已锁、包未绑）——都回 `success:true` + `accepted:false` + 可行动
 *   的 reasonCode 与详情。17 §3.1 原本把后一类划给 `denied`；这里刻意不这么做：
 *   引擎把 `denied` 记进失败计数，同一工具两次就停整个回合，而一批五份材料里
 *   有两笔证据不齐是常态，不是模型在乱来。状态不允许的事本身没发生（handler
 *   什么都没写），少烧一次断路器只有好处。
 * - **真故障**（库连不上、包验不过、代码 bug）—— `success:false`。
 *
 * 词表里没有任何科目、税种、地区（A1 扫描覆盖）。
 */

export const BOOK_WRITE_ERROR_CODES = {
  rulePackNotBound: 'FIN_BOOK_RULE_PACK_NOT_BOUND',
  rulePackAmbiguous: 'FIN_BOOK_RULE_PACK_AMBIGUOUS',
  materialNotFound: 'FIN_BOOK_MATERIAL_NOT_FOUND',
  materialAlreadyIdentified: 'FIN_BOOK_MATERIAL_ALREADY_IDENTIFIED',
  eventNotFound: 'FIN_BOOK_EVENT_NOT_FOUND',
  inputInvalid: 'FIN_BOOK_WRITE_INPUT_INVALID',
  /** 模型给的数与材料识别出来的数不一致。数只能照抄，不能改。 */
  amountDisagreesWithMaterial: 'FIN_BOOK_AMOUNT_DISAGREES_WITH_MATERIAL',
  /** 模型给的对方名称不在材料的当事方里。 */
  counterpartyNotOnMaterial: 'FIN_BOOK_COUNTERPARTY_NOT_ON_MATERIAL',
  periodMissing: 'FIN_BOOK_PERIOD_MISSING',
  /** 前台没有 `fintax.closing.confirm` 委托。老板恒可，走不到这里。 */
  closingNotPermitted: 'FIN_BOOK_CLOSING_NOT_PERMITTED',
  /** 六项检查没全过。details.failed 里是没过的那几项。 */
  closingChecksFailed: 'FIN_BOOK_CLOSING_CHECKS_FAILED',
  /** 结账时乐观锁没抢到，且重查后这期仍是未结——真冲突，不是幂等。 */
  periodClosingConflict: 'FIN_BOOK_PERIOD_CLOSING_CONFLICT',
  /** 撤销结账只有老板能做：推进可委托，回退不可委托。 */
  reopenNotPermitted: 'FIN_BOOK_REOPEN_NOT_PERMITTED',
  /** 撤销结账的理由必填，与撤销凭证同一把尺（4–200 字）。 */
  reopenReasonRequired: 'FIN_BOOK_REOPEN_REASON_REQUIRED',
  reopenSourceRequired: 'FIN_BOOK_REOPEN_SOURCE_REQUIRED',
  reopenSourceChanged: 'FIN_BOOK_REOPEN_SOURCE_CHANGED',
  /** 本期之后还有已结的期间：先退新的再退旧的，否则连续前缀会断。 */
  laterPeriodClosed: 'FIN_BOOK_LATER_PERIOD_CLOSED',
  periodLocked: 'FIN_BOOK_PERIOD_LOCKED',
  /** 还没答过「这套账从哪个月开始记」，期间没有下界，一个月也不开。 */
  bookStartUnset: 'FIN_BOOK_BOOK_START_UNSET',
  /** 业务日期落在账套起始月之前。多半是日期写错了一位。 */
  periodBeforeBookStart: 'FIN_BOOK_PERIOD_BEFORE_BOOK_START',
  /** 业务日期落在未来月份。未来的期间不开。 */
  periodInFuture: 'FIN_BOOK_PERIOD_IN_FUTURE',
  /** 起始月离这份材料的月份太远，一次要补的期间超过上限。多半是年份写错了。 */
  bookStartTooFarBack: 'FIN_BOOK_BOOK_START_TOO_FAR_BACK',
  evidenceRequirementAbsent: 'FIN_BOOK_EVIDENCE_REQUIREMENT_ABSENT',
  evidenceInsufficient: 'FIN_BOOK_EVIDENCE_INSUFFICIENT',
  /** 事项是模型猜的形态（confidence=aiGuess），不出分录。 */
  eventUnconfirmed: 'FIN_BOOK_EVENT_UNCONFIRMED',
  /** 事项标着要人把关（reviewFocus），不出分录。 */
  reviewRequired: 'FIN_BOOK_REVIEW_REQUIRED',
  /** 金额来源名不在词表里（如把 invoice_total 写成 total）。 */
  amountSourceUnknown: 'FIN_BOOK_AMOUNT_SOURCE_UNKNOWN',
  /** 已记账的事项不能再改事实，要改走更正。 */
  eventAlreadyPosted: 'FIN_BOOK_EVENT_ALREADY_POSTED',
  transactionNotFound: 'FIN_BOOK_TRANSACTION_NOT_FOUND',
  transactionVersionConflict: 'FIN_BOOK_TRANSACTION_VERSION_CONFLICT',
  commandConflict: 'FIN_BOOK_COMMAND_CONFLICT',
  /** 这条流水已经解释过（挂了事项 / 配了对 / 冲了期初），要改走更正。 */
  transactionAlreadyExplained: 'FIN_BOOK_TRANSACTION_ALREADY_EXPLAINED',
  /** 内部划转的另一条对不上：不同租户 / 同一账户 / 同方向 / 金额不等。 */
  transferPairMismatch: 'FIN_BOOK_TRANSFER_PAIR_MISMATCH',
  openingEntryNotFound: 'FIN_BOOK_OPENING_ENTRY_NOT_FOUND',
  /** 解释的种类与所需的引用不配套，或不在闭集里。 */
  explanationInvalid: 'FIN_BOOK_EXPLANATION_INVALID',
  /** 流水关联：账户推出的事实与事项上已有的事实不同，关联会把事项静默改掉。 */
  transactionFactConflict: 'FIN_BOOK_TRANSACTION_FACT_CONFLICT',
  entryAlreadyExists: 'FIN_BOOK_ENTRY_ALREADY_EXISTS',
  /** 记账引擎按包推不出分录：无规则命中 / 多规则命中 / 缺金额来源 / 不平。 */
  postingRefused: 'FIN_BOOK_POSTING_REFUSED',
  /** 要撤的凭证号在这个租户下查不到（跨租户与不存在共用它，不给探测口）。 */
  voucherNotFound: 'FIN_BOOK_VOUCHER_NOT_FOUND',
  /** 这个人不能撤凭证：前台档且老板没在设置里授权。 */
  voidNotPermitted: 'FIN_BOOK_VOID_NOT_PERMITTED',
  /** 没说为什么撤。撤了不留原因，等于把账改了却查不到是谁为什么改的。 */
  voidReasonRequired: 'FIN_BOOK_VOID_REASON_REQUIRED',
  /** 已结账期间的凭证要红冲，而当前没有可落冲销凭证的未结期间。 */
  noOpenPeriod: 'FIN_BOOK_NO_OPEN_PERIOD',
  /** 人工确认：这次什么也没确认。空操作不该给整笔事项盖上「人判的」章。 */
  confirmNothingToDo: 'FIN_BOOK_CONFIRM_NOTHING_TO_DO',
  /** 人工确认：这个事实键包里没有任何一条规则用到，答了也不影响记账。 */
  factKeyNotInPack: 'FIN_BOOK_FACT_KEY_NOT_IN_PACK',
  /** 人工确认：包为这个键声明过的取值里没有这一个。 */
  factValueNotInPack: 'FIN_BOOK_FACT_VALUE_NOT_IN_PACK',
  /** 人工确认：这个键是记法档位的政策事实。记法是老板的月度选择，不逐笔覆盖。 */
  factIsSchemePolicy: 'FIN_BOOK_FACT_IS_SCHEME_POLICY',
  /** 人工确认：答完之后包里没有一条规则还可能命中，确认了也记不了账。 */
  factCombinationNotCovered: 'FIN_BOOK_FACT_COMBINATION_NOT_COVERED',
  /** 人工确认：要认的这个金额来源不在这笔事项上。 */
  amountNotOnEvent: 'FIN_BOOK_AMOUNT_NOT_ON_EVENT',
  /** 人工确认：事项已经作废或已更正，确认它没有意义。 */
  eventTerminal: 'FIN_BOOK_EVENT_TERMINAL',
  /** 人工确认：没说为什么这么答。没有理由的确认与模型的猜没有区别。 */
  confirmReasonRequired: 'FIN_BOOK_CONFIRM_REASON_REQUIRED',
  /**
   * 人工确认：屏上那一版事项已经不是库里这一版了。
   *
   * 与流水的 `transactionVersionConflict` 同一把尺。人是照着一屏事实与材料点的确认，
   * 这中间材料被更正、员工又挂了新证据，那一屏的答案就不该落到新资料上。同一个码也
   * 兜住重发：第一次已经把版本推进了，重发的那一份带着旧版本，被拒、一行不写。
   */
  eventVersionConflict: 'FIN_BOOK_EVENT_VERSION_CONFLICT',
  /** 期末结转：这个形态不是包声明的期末必做项。无材料建事项只对那几项开。 */
  notAClosingItem: 'FIN_BOOK_NOT_A_CLOSING_ITEM',
  /** 期末结转：包登记了这个必做项，却没写它的记账规则——造得出事项、出不了分录。 */
  closingRuleAbsent: 'FIN_BOOK_CLOSING_RULE_ABSENT',
  /** 期末结转：这一期这一项已经有一笔了。折旧不能记两遍。 */
  closingEventExists: 'FIN_BOOK_CLOSING_EVENT_EXISTS',
  /** 期末结转：这一项按余额结转，金额是账上算出来的，不该由调用方给。 */
  closingAmountsNotAccepted: 'FIN_BOOK_CLOSING_AMOUNTS_NOT_ACCEPTED',
  /**
   * 期末结转：这一项不是按余额结转的，界面那条受控入口不给做。
   *
   * 只有包里声明了 `balanceTransfer` 的项，金额才由引擎按账上余额现算——那一类没有
   * 判断余地，点一下执行是安全的。其余那些的金额要人报、要人认，从界面直接出凭证等于
   * 让调用方凭空造账，所以在入口处拒，它们仍然只走员工通道加人工确认那条链。
   */
  closingItemNotAutomatic: 'FIN_BOOK_CLOSING_ITEM_NOT_AUTOMATIC',
} as const;

export type BookWriteErrorCode =
  (typeof BOOK_WRITE_ERROR_CODES)[keyof typeof BOOK_WRITE_ERROR_CODES];

/** 包内标识符：与会计包契约同一条规则（小写英文起头的短标识）。 */
export const WRITE_IDENTIFIER = /^[a-z][a-z0-9._-]{1,63}$/;

export interface IdentifyMaterialInput {
  readonly materialId: string;
  /** 业务形态，取自包的 event.kind 词表。 */
  readonly eventKind: string;
  /** 记账规则用的其余事实（如 settlement.method）。键由包声明。 */
  readonly facts?: Readonly<Record<string, string>>;
  /** 这份材料在这笔业务里算什么证据（invoice / settlement / contract …）。 */
  readonly evidenceRole: string;
  /** 客观描述，不含会计判断。 */
  readonly description: string;
  /** YYYY-MM-DD。不给就取材料上的日期，再没有就取材料提交日。 */
  readonly occurredAt?: string;
  readonly counterpartyName?: string;
  /**
   * 材料上照抄不到、由人或模型声明的数（来源名 → 元）。与材料识别出的数
   * 冲突直接拒；材料上有的数不必给，给了也只是核对。
   */
  readonly amounts?: Readonly<Record<string, string>>;
}

export interface LinkMaterialsInput {
  /** 纠正从未入账事项的实际日期；复用原材料，保留原事项与账务关联。 */
  readonly dateCorrection?: {
    readonly occurredAt: string;
    readonly expectedRowVersion: number;
    readonly reason: string;
  };
  /** 仅补缺失的独立金额；声明仍需人工确认，settlement 不接受。 */
  readonly amounts?: Readonly<Record<string, string>>;
  readonly eventId: string;
  readonly links: readonly {
    readonly materialId: string;
    readonly role: string;
  }[];
  /**
   * 证据到了才知道的事实（如回单挂上来才知道 `settlement.method`），并进事项的
   * factsJson。已记账的事项不能改事实——那是更正的事。
   */
  readonly facts?: Readonly<Record<string, string>>;
}

/**
 * 一条流水的归宿（13 §3.3「资金六种归宿」落到 L1 的词表，与
 * `FinTransaction.explanationState` 同一套）：挂业务事项 / 内部划转配对 / 冲期初
 * 应收 / 冲期初应付 / 说不清、留给人。**没有「算了」这一档**——流水可以不挂事项，
 * 但必须被解释；说不清就停在 pendingUserInput，挡着结账。
 */
export const TRANSACTION_EXPLANATIONS = [
  'linkedToEvent',
  'internalTransfer',
  'openingReceivableSettlement',
  'openingPayableSettlement',
  'pendingUserInput',
] as const;
export type TransactionExplanation = (typeof TRANSACTION_EXPLANATIONS)[number];

export interface ExplainTransactionInput {
  /** pendingUserInput 的乐观版本；共享命令入口必须提供。 */
  readonly rowVersion?: number;
  readonly transactionId: string;
  readonly explanation: TransactionExplanation;
  /** linkedToEvent 必填。 */
  readonly eventId?: string;
  /** internalTransfer 必填：另一条流水。 */
  readonly pairTransactionId?: string;
  /** opening*Settlement 必填：冲哪条期初条目。 */
  readonly openingEntryId?: string;
  /** 挂事项时顺带补的事实（如 settlement.method）；银行账户的流水会自动补 bank。 */
  readonly facts?: Readonly<Record<string, string>>;
  /** pendingUserInput 必填：说不清的是什么、要问谁。 */
  readonly note?: string;
}

export interface CreateEntryDraftInput {
  readonly eventId: string;
}

/** 撤一张凭证，或把一整期未结账的凭证都撤掉（换档前要清空这一期用的就是后者）。 */
export interface VoidVoucherInput {
  /** 撤哪一张。与 periodKey 二选一。 */
  readonly voucherNo?: string;
  /** 撤这一整期。只对未结账期间成立——整期红冲不是会计动作。 */
  readonly periodKey?: string;
  /** 为什么撤。必填且要能读懂：这一句会跟着凭证留在账上。 */
  readonly reason: string;
}

/** 撤销理由的长度界：短于下限的多半是「测试」「错了」这种事后看不懂的话。 */
export const VOID_REASON_MIN_LENGTH = 4;
export const VOID_REASON_MAX_LENGTH = 200;

/**
 * 人对一笔事项确认了什么。**只有这条路能把 `confidence` 抬成 `human`**——识别与挂证据
 * 那两条路永远只在 `rule` / `aiGuess` 之间算。
 *
 * `facts` 与 `confirmedAmounts` 至少要有一个非空：两个都不给，这次确认什么也没做，
 * 却会把整笔事项标成人判的。
 */
export interface ConfirmEventFactsInput {
  readonly eventId: string;
  /**
   * 调用方读这一屏时拿到的事项版本（`event/review` 的 `rowVersion`）。给了就核对，
   * 不给就按当前版本走（行为与加这一格之前逐字相同）。与 `ExplainTransactionInput`
   * 同姿态。
   */
  readonly rowVersion?: number;
  /** 答事实。键与取值都必须是包声明过的，且不能是任何一档记法的政策事实。 */
  readonly facts?: Readonly<Record<string, string>>;
  /** 认下这几个「材料上没处核对」的数。值是金额来源名，不是金额本身——数不因确认而变。 */
  readonly confirmedAmounts?: readonly string[];
  /** 为什么这么答。跟着确认留在账上。 */
  readonly reason: string;
}

/** 确认理由与撤销凭证同一把尺：短于下限的事后看不懂，长于上限的不是理由是别的东西。 */
export const CONFIRM_REASON_MIN_LENGTH = 4;
export const CONFIRM_REASON_MAX_LENGTH = 200;

/** 一次确认落一行 `FinFactConfirmation` 的种类。 */
export const CONFIRM_KINDS = ['fact', 'amount'] as const;
export type ConfirmKind = (typeof CONFIRM_KINDS)[number];

/**
 * 记一笔期末结转。具体有哪几项由绑定包的 `closingItems` 说，这里不列——列出来就会
 * 随包漂移，而漂移后的清单看着仍然像真的。
 *
 * **这是全仓唯一一条不消耗材料就能建业务事项的路**，所以 `eventKind` 的闭集由包的
 * `closingItems` 说了算——没有这条闭集，它就是个绕开材料闸凭空造账的口子。
 *
 * 分两类。带 `balanceTransfer` 的（如损益结转）金额按账上余额现算，不收 `amounts`，
 * 也不标要人把关——见 `finance-ledger/balance-transfer.ts`。其余的金额算「人报的数」
 * （材料上没处核对），事项必然 `reviewFocus=true`，要出分录得先经人工确认通道；它们的
 * 数账上一个都算不出来（没有固定资产卡片表、没有存货台账，工资表是发放那笔的证据不是
 * 计提的），这是照实标记，不是可绕过的缺陷。
 */
export interface RecordClosingEventInput {
  /** 关联余额核销/摊销的原事项；余额证明仍由服务端读取。 */
  readonly sourceEventId?: string;
  /** 必须是绑定包 `closingItems` 里的某个 `itemId`。 */
  readonly eventKind: string;
  /** 落哪一期，`YYYY-MM`。 */
  readonly periodKey: string;
  /**
   * 来源名 → 元。走 `KNOWN_AMOUNT_SOURCES` 词表，这里给的都算声明的数。
   *
   * **按余额结转的项（损益结转）不给**：那一类的金额是账上余额算出来的，
   * 给了要拒——一个不会被采用的数摆在那里，比没有更误导。
   */
  readonly amounts?: Readonly<Record<string, string>>;
  /** 客观描述，不含会计判断（与 identify_material 同一条要求）。 */
  readonly description: string;
}

/** 期间键的形状。日期是 `YYYY-MM-DD`，期间是 `YYYY-MM`，两处别混。 */
export const PERIOD_KEY = /^\d{4}-\d{2}$/;
