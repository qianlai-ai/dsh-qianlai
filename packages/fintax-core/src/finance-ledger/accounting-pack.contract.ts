// 来源：moneycome harness/src/finance-ledger/accounting-pack.contract.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * L2 会计域领域包 — payload 形状与验真。
 *
 * `specialization-pack` 机制里 `payload` 是**闭合的五个桶**（catalogs /
 * decisionTables / evidenceRequirements / parameters / sources，各自 `z.unknown()`），
 * harness 只验真（签名、摘要、适用性、绑定关系），内容由 `compatibility.evaluatorId`
 * 指定的引擎解释。本文件就是会计域引擎那一份解释契约，参照
 * `tax-obligation-evaluator.ts` 的 `taxPayloadSchema`。
 *
 * ## 报表行与期末必做项住在 catalogs 里
 *
 * 2026-08-15 给会计包补 reportLines / closingItems 时把它们放成了顶层字段，而
 * 五桶信封是 strict 的——那样的包**根本装不进信封**，签名分发那一步才会撞上。
 * 现在按信封的形状放：`catalogs` 是按 `kind` 分型的目录联合——科目目录恰一份、
 * 报表行目录至多一份、期末必做项目录恰一份。`parseAccountingPackPayload` 吃信封
 * 形状，返回归一化的 `AccountingPackPayload`（`reportLines` / `closingItems`
 * 拉平成顶层字段），消费方不用知道信封长什么样。
 *
 * **本文件不含任何领域常量**：没有科目号、科目名、税种、地区、税率。它只声明
 * 「形状」——具体值一律来自包。这一条由架构验收 A1 机器判定。
 *
 * 契约：`docs/modules/fintax-accounting-slice-v1.md` §6。
 */

import { z } from 'zod';

import { BUSINESS_INTENTS } from './business-intent.js';

/**
 * 包内标识符的命名规则：小写英文起头的短标识。
 *
 * 导出是给录入工具用的——它要在会计填错时给出看得懂的提示，而不是等这里
 * 抛一句 `payload does not match the shape`。**同一条规则只允许有这一份定义**，
 * 工具复用它，不另抄一个正则。
 */
export const PACK_IDENTIFIER = /^[a-z][a-z0-9._-]{1,63}$/;

const KEY = PACK_IDENTIFIER;

/**
 * 一个会计科目。
 *
 * `subjectCode` 刻意不约束成四位数字——那是《小企业会计准则》的编码习惯，
 * 换准则或换地区就不成立。接口按 N 设计：代码只要求它是个短标识。
 */
const subjectSchema = z
  .object({
    subjectCode: z.string().min(1).max(32),
    subjectName: z.string().min(1).max(120),
    /** 借增还是贷增。由包声明，代码不假设哪类科目是哪种。 */
    normalBalance: z.enum(['debit', 'credit']),
  })
  .strict();

/** 科目目录。 */
const subjectCatalogSchema = z
  .object({
    catalogId: z.string().regex(KEY),
    kind: z.literal('subjects'),
    subjects: z.array(subjectSchema).min(1).max(1024),
  })
  .strict();

/** 一条分录腿。金额从事项的哪个来源取，也是包说了算（样本 E1 有三个来源）。 */
const postingLegSchema = z
  .object({
    direction: z.enum(['debit', 'credit']),
    subjectCode: z.string().min(1).max(32),
    amountSource: z.string().regex(KEY),
  })
  .strict();

const whenClauseSchema = z
  .object({
    factKey: z.string().regex(KEY),
    equals: z.string().min(1).max(120),
  })
  .strict();

/**
 * 「这条规则命中后，前台要办哪件事」。记法切换时派活求差集用它（伪智能节点表：
 * 派活是确定性的，交给模型会漏派或重派）。
 */
const requiredTaskSchema = z
  .object({
    taskKey: z.string().regex(KEY),
    title: z.string().min(1).max(120),
  })
  .strict();

/**
 * 记法卡上要显示的规则属性，都可缺：
 * - `treatment`：老板看得懂的处理名（「一次进成本」「分 3 年折旧」「不列」）。
 * - `taxAddBack`：这条规则记出来的费用税法不认（坏账准备计提是典型），算应纳税
 *   所得额时要把费用腿的金额调回来。是税会差异的包侧表达。
 * - `requiresTask`：见上。
 * - `basisSourceId`：这条处理的依据（法规 / 准则口径），指向包 `sources` 里的一条。
 *   记法卡的「看依据」抽屉按它显示；没依据的处理老板看不到依据，就该没依据地显示。
 * - `evidenceRoles`：**记这条规则要的证据角色**，覆盖 eventKind 级的默认要求。同一
 *   形态在不同档下要的证据不一样（「只有收据的餐费」在「已发生的都记」那一档凭收据
 *   记、在「只记有票的」那一档不记）——证据要求跟着处理走，不跟着形态走。缺就用
 *   eventKind 级默认。
 */
const ruleAttrsSchema = {
  treatment: z.string().min(1).max(40).optional(),
  taxAddBack: z.boolean().optional(),
  requiresTask: requiredTaskSchema.optional(),
  basisSourceId: z.string().regex(KEY).optional(),
  evidenceRoles: z.array(z.string().regex(KEY)).min(1).max(8).optional(),
};

/** Only rules declaring this attribute settle a previously posted event. */
export const postedEventSettlementSchema = z
  .object({
    sourceEventFactKey: z.string().regex(KEY),
    creditorFactKey: z.string().regex(KEY),
    sourceEvidenceFactKey: z.string().regex(KEY),
    sourceRuleIds: z.array(z.string().regex(KEY)).min(1).max(32),
    liabilitySubjectCode: z.string().min(1).max(32),
    sourceDirection: z.enum(['debit', 'credit']),
    repaymentDirection: z.enum(['debit', 'credit']),
    amountSource: z.string().regex(KEY),
  })
  .strict()
  .refine((value) => value.sourceDirection !== value.repaymentDirection, {
    message: 'settlement must reverse the source liability direction',
  })
  .refine(
    (value) => {
      const keys = [
        value.sourceEventFactKey,
        value.creditorFactKey,
        value.sourceEvidenceFactKey,
      ];
      return new Set(keys).size === keys.length && !keys.includes('event.kind');
    },
    { message: 'settlement reference facts must be distinct from event.kind' },
  )
  .refine(
    (value) => new Set(value.sourceRuleIds).size === value.sourceRuleIds.length,
    { message: 'settlement source rules must be unique' },
  );

export type AccountingPostedEventSettlement = z.infer<
  typeof postedEventSettlementSchema
>;

/**
 * 一条记账规则。`when` 是事实键与期望值的合取；三值逻辑与 UNIQUE 命中策略由
 * 引擎实现，包只声明条件，不声明算法。
 */
/** A transfer consumes a referenced posting, never a caller-supplied balance. */
export const referencedBalanceSchema = z
  .object({
    sourceEventFactKey: z.string().regex(KEY),
    subjectCode: z.string().min(1).max(32),
    sourceDirection: z.enum(['debit', 'credit']),
    amountSource: z.string().regex(KEY),
    sourceRuleIds: z.array(z.string().regex(KEY)).min(1).max(512),
    sourceFacts: z.array(whenClauseSchema).min(1).max(16),
    consumption: z.enum(['remaining', 'requested']).optional(),
    consumptionSubjectCode: z.string().min(1).max(32).optional(),
    schedule: z
      .object({
        startPeriodFactKey: z.string().regex(KEY),
        startOffsetMonths: z.number().int().min(0).max(1),
        monthCountFactKey: z.string().regex(KEY),
        residualAmountFactKey: z.string().regex(KEY).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AccountingReferencedBalance = z.infer<
  typeof referencedBalanceSchema
>;

const postingRuleSchema = z
  .object({
    ruleId: z.string().regex(KEY),
    when: z.array(whenClauseSchema).min(1).max(16),
    /** 至少两条腿——单腿分录不可能借贷平衡。 */
    legs: z.array(postingLegSchema).min(2).max(16),
    settlesPostedEvent: postedEventSettlementSchema.optional(),
    referencedBalance: referencedBalanceSchema.optional(),
    recognitionPeriodFactKey: z.string().regex(KEY).optional(),
    ...ruleAttrsSchema,
  })
  .strict();

/**
 * 「这一档不记这笔」也是一条规则，不是没有规则。两者引擎分得清：没有规则是包
 * 漏了（LEDGER_NO_RULE_MATCHED，包的问题），skip 是包明说的处理（「不列」「票到
 * 再记」），记法卡上要显示、派活要算它。skip 规则没有腿、`treatment` 必填。
 */
const skipRuleSchema = z
  .object({
    ruleId: z.string().regex(KEY),
    when: z.array(whenClauseSchema).min(1).max(16),
    skip: z.literal(true),
    treatment: z.string().min(1).max(40),
    requiresTask: requiredTaskSchema.optional(),
    basisSourceId: z.string().regex(KEY).optional(),
  })
  .strict();

const ruleSchema = z.union([postingRuleSchema, skipRuleSchema]);

const decisionTableSchema = z
  .object({
    tableId: z.string().regex(KEY),
    rules: z.array(ruleSchema).min(1).max(512),
  })
  .strict();

/**
 * 某种业务形态叫什么、最少要哪几类证据（4.9 §10.2 五要素的包侧表达）。
 *
 * `eventKind` 是英文代号，`eventKindName` 是它在界面上的名字。名字**进包**：
 * 「房租」「付以前欠的钱」是这份包所属行业的说法，写死成代码或前端里的一张
 * `{rent:'房租'}` 映射表，换一份包就全错。本表是包里唯一按 `eventKind` 建索引
 * 的表（`parseAccountingPackPayload` 对它判唯一），名字跟着 id 走不会漂。
 *
 * 名字**可缺**：本字段晚于会计包机制本身出现，已签发的包里没有它，而验真是
 * fail-closed 的——设成必填会让那些包整个解不出来，一份包的名字缺一格就换来
 * 整条财税线不可用。缺名字的处理由消费方决定，但不许回落成英文代号。
 */
const evidenceRequirementSchema = z
  .object({
    eventKind: z.string().regex(KEY),
    eventKindName: z.string().min(1).max(40).optional(),
    requiredRoles: z.array(z.string().regex(KEY)).min(1).max(8),
  })
  .strict();

const parameterSchema = z
  .object({
    parameterId: z.string().regex(KEY),
    value: z.string().min(1).max(240),
  })
  .strict();

const sourceSchema = z
  .object({
    sourceId: z.string().regex(KEY),
    citation: z.string().min(1).max(500),
    documentNumber: z.string().min(1).max(120).optional(),
    url: z.string().url().startsWith('https://').optional(),
    publishedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    effectiveTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    article: z.string().min(1).max(120).optional(),
    status: z.enum(['current', 'historical', 'pending']).optional(),
  })
  .strict();

/**
 * 一行报表 → 哪几个科目。
 *
 * 资产负债表的行（货币资金、应收账款、应付职工薪酬）是准则规定的，不是我们的
 * 发明；小企业会计准则与企业会计准则的行不一样，换准则就得换。所以进包，不进
 * 代码——写进代码就是领域常量，A1 当场破掉。
 *
 * `sign` 不能省：累计折旧、坏账准备这些备抵科目在表上取负号，而「哪些科目是备抵」
 * 同样是领域知识。
 */
const reportLineSchema = z
  .object({
    reportId: z.string().regex(KEY),
    lineId: z.string().regex(KEY),
    lineName: z.string().min(1).max(120),
    sign: z.enum(['positive', 'negative']),
    subjectCodes: z.array(z.string().min(1).max(32)).min(1).max(256),
  })
  .strict();

/**
 * 期末必做的计提结转项（结账六项检查的第 5 项，`14 §1.1`）。
 *
 * `requiredWhen` 与 `postingRule.when` 同形，但**允许为空**——空表示无条件必做。
 * 折旧要看有没有固定资产，损益结转则是每期都要做，两种都得表达得了。
 */
const closingItemSchema = z
  .object({
    itemId: z.string().regex(KEY),
    itemName: z.string().min(1).max(120),
    requiredWhen: z
      .array(
        z
          .object({
            factKey: z.string().regex(KEY),
            equals: z.string().min(1).max(120),
          })
          .strict(),
      )
      .max(16),
    /**
     * 按余额结转（损益结转就是这一类）。**声明了它的期末项没有记账规则**——
     * 它的科目、金额、方向三样都不固定，由账上余额定，规则表「事实 → 固定分录腿」
     * 的形状承载不了。见 `docs/modules/fintax-profit-loss-transfer-v1.md`。
     *
     * 引用报表而不是直接列科目，是因为损益类科目的定义只该有一处：直接列一份清单
     * 就有了第二处，包作者给利润表加一行费用科目时结转那份不会跟着改，而**漏掉的
     * 那个科目会静默留着余额**——报表看着对，账其实没结平。
     */
    balanceTransfer: z
      .object({
        /** 冲平哪张报表涉及的科目。引用 reportLines 的 reportId。 */
        fromReportId: z.string().regex(KEY),
        /** 差额转进哪个科目（本年利润）。必须在科目目录里。 */
        toSubjectCode: z.string().min(1).max(32),
      })
      .strict()
      .optional(),
  })
  .strict();

/** 报表行目录。空目录合法：只记账不出报表的包是成立的，缺行只让报表出不来，看得见。 */
const reportLineCatalogSchema = z
  .object({
    catalogId: z.string().regex(KEY),
    kind: z.literal('report_lines'),
    lines: z.array(reportLineSchema).max(2048),
  })
  .strict();

/**
 * 期末必做项目录。**至少一项。**空会让结账第 5 项空过——「没要求所以没有未办」，
 * 而那是静默通过，比出不来报表危险得多。损益结转每期都要做，任何包都至少有这一条。
 */
const closingItemCatalogSchema = z
  .object({
    catalogId: z.string().regex(KEY),
    kind: z.literal('closing_items'),
    items: z.array(closingItemSchema).min(1).max(256),
  })
  .strict();

/**
 * 记法（scheme）声明工作顺序及可缺省的政策事实。已确认事项事实始终优先；
 * 方案不能把依法应确认的资产改为费用，或把已发生支出推迟到发票/报销到达期。
 * 有几档、叫什么及工作顺序由包声明；税务资格及应缴税额由申报路径核实。
 */
const policyFactSchema = z
  .object({
    factKey: z
      .string()
      .regex(KEY)
      .refine((factKey) => factKey !== 'event.kind', {
        message:
          'event.kind is supplied by the business event and cannot be overridden',
      }),
    value: z.string().min(1).max(120),
  })
  .strict();

const schemeSchema = z
  .object({
    schemeCode: z.string().regex(KEY),
    name: z.string().min(1).max(40),
    consequence: z.string().min(1).max(400),
    policyFacts: z.array(policyFactSchema).min(1).max(32),
  })
  .strict();

const schemeCatalogSchema = z
  .object({
    catalogId: z.string().regex(KEY),
    kind: z.literal('schemes'),
    defaultScheme: z.string().regex(KEY),
    schemes: z.array(schemeSchema).min(2).max(8),
  })
  .strict();

/**
 * 截止日（deadline）：前台面「接下来的日子」与截止提醒的来源。**日期规则是辖区
 * 事实，进包不进代码**——「次月 5 日前定账」「季后 15 日报增值税」在别的辖区、别
 * 的纳税人类型下不一样。一条 = 覆盖一个什么周期（cadence）的什么事（kind），在周期
 * 结束后第几个月（monthOffset）的第几天（dayOfMonth）到期；日子由消费方按日历算，
 * `dayOfMonth` 超出那个月天数时落到月末（「5 月 31 日」「季后月 15 日」都照原样写）。
 * 当年实际期限（包括顺延）与依据进 calendar，按所覆盖的业务期间索引。固定日只能
 * 描述名义安排；申报日期的缺失语义由到期读侧处理，不能由解析器自行补日期。
 */
const deadlineCalendarEntrySchema = z
  .object({
    periodKey: z.string().regex(/^\d{4}(?:-(?:0[1-9]|1[0-2]|Q[1-4]))?$/),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const timestamp = Date.parse(`${value}T00:00:00.000Z`);
        return (
          Number.isFinite(timestamp) &&
          new Date(timestamp).toISOString().slice(0, 10) === value
        );
      }, 'dueDate must be a real calendar date'),
    basisSourceId: z.string().regex(KEY),
  })
  .strict();

const deadlineSchema = z
  .object({
    deadlineId: z.string().regex(KEY),
    /** period_close：账期要定下来；tax_filing：申报纳税；other：包自定的其它到期事。 */
    kind: z.enum(['period_close', 'tax_filing', 'other']),
    cadence: z.enum(['monthly', 'quarterly', 'yearly']),
    monthOffset: z.number().int().min(0).max(12),
    dayOfMonth: z.number().int().min(1).max(31),
    /** 界面上写的那句：「这个月的账要定下来」「季度报税（增值税及附加）」。 */
    title: z.string().min(1).max(80),
    /** 晚了会怎样，可缺。 */
    consequence: z.string().min(1).max(200).optional(),
    /** 每条绑定所覆盖的业务期间与来源；缺失不是对固定日的确认。 */
    calendar: z.array(deadlineCalendarEntrySchema).min(1).max(240).optional(),
  })
  .strict();

/**
 * 记法适配（scheme_fit）：哪种经营打算该配哪一档记法，以及**为什么**。
 *
 * 这是会计的判断，不是工程的判断，所以它在包里，不在代码里。代码只做两件事：把老板
 * 自己答的那句经营事实（`FinTenantProfile.businessIntents`）拿来查这张表，再把包写的
 * 理由原样递出去。**代码永远不评价哪档好**——「哪档适合要贷款的公司」这句话只有具备
 * 资质的会计有资格说，说了要能追到 `packId@version#digest`。
 *
 * 一个 `intentKey` 一行。多项打算同时选中时由消费方判：都指向同一档才给建议，指向不同
 * 档就**不给**（包对这几项的建议不一致，代码不替它挑一个，也不排序）。
 *
 * `reason` 是给老板看的一句话，写做法与代价，**不许写税负结果**（owner 2026-08-16：
 * 不用「做成赚 / 做成亏」）——这条与 scheme 的名字与后果文案同一条规矩。
 */
const schemeFitSchema = z
  .object({
    intentKey: z.enum(BUSINESS_INTENTS),
    schemeCode: z.string().regex(KEY),
    reason: z.string().min(1).max(200),
  })
  .strict();

const schemeFitCatalogSchema = z
  .object({
    catalogId: z.string().regex(KEY),
    kind: z.literal('scheme_fit'),
    fits: z.array(schemeFitSchema).min(1).max(BUSINESS_INTENTS.length),
  })
  .strict();

const deadlineCatalogSchema = z
  .object({
    catalogId: z.string().regex(KEY),
    kind: z.literal('deadlines'),
    deadlines: z.array(deadlineSchema).min(1).max(32),
  })
  .strict();

const catalogSchema = z.discriminatedUnion('kind', [
  subjectCatalogSchema,
  reportLineCatalogSchema,
  closingItemCatalogSchema,
  schemeCatalogSchema,
  schemeFitCatalogSchema,
  deadlineCatalogSchema,
]);

/**
 * 信封形状：与 `specialization-pack` 的五桶一一对应，可以原样放进 artifact.payload。
 * 三种目录各自的份数在 `parseAccountingPackPayload` 里判（zod 联合表达不了「恰一份」）。
 */
export const accountingPackEnvelopeSchema = z
  .object({
    catalogs: z.array(catalogSchema).min(2).max(6),
    decisionTables: z.array(decisionTableSchema).min(1).max(512),
    evidenceRequirements: z.array(evidenceRequirementSchema).max(1024),
    parameters: z.array(parameterSchema).max(1024),
    sources: z.array(sourceSchema).min(1).max(1024),
  })
  .strict();

export type AccountingPackEnvelope = z.infer<
  typeof accountingPackEnvelopeSchema
>;

/** 归一化后的会计包：消费方读它，不读信封。 */
export interface AccountingPackPayload {
  readonly catalogs: readonly {
    readonly catalogId: string;
    readonly subjects: readonly z.infer<typeof subjectSchema>[];
  }[];
  readonly decisionTables: readonly z.infer<typeof decisionTableSchema>[];
  readonly evidenceRequirements: readonly z.infer<
    typeof evidenceRequirementSchema
  >[];
  readonly parameters: readonly z.infer<typeof parameterSchema>[];
  readonly sources: readonly z.infer<typeof sourceSchema>[];
  readonly reportLines: readonly z.infer<typeof reportLineSchema>[];
  readonly closingItems: readonly z.infer<typeof closingItemSchema>[];
  /** 包没声明记法时为空数组、`defaultScheme` 为 undefined：记法卡整块不可用，不是默认一档。 */
  readonly schemes: readonly z.infer<typeof schemeSchema>[];
  readonly defaultScheme?: string;
  /**
   * 包没声明记法适配时为空数组：三档面板**不给建议**，照旧只摆三档让老板自己选。
   * 不是「建议是空的」，是这份包没写过这件事。
   */
  readonly schemeFits: readonly z.infer<typeof schemeFitSchema>[];
  /** 包没声明截止日时为空数组：「接下来的日子」整块说不出，不是没有到期事。 */
  readonly deadlines: readonly z.infer<typeof deadlineSchema>[];
}

export type AccountingPackRule = z.infer<typeof ruleSchema>;
export type AccountingPackPostingRule = z.infer<typeof postingRuleSchema>;
export type AccountingPackSkipRule = z.infer<typeof skipRuleSchema>;
export type AccountingPackScheme = z.infer<typeof schemeSchema>;
export type AccountingPackSchemeFit = z.infer<typeof schemeFitSchema>;

export function isSkipRule(
  rule: AccountingPackRule,
): rule is AccountingPackSkipRule {
  return 'skip' in rule && rule.skip === true;
}

export class AccountingPackError extends Error {
  constructor(
    readonly code:
      | 'ACCOUNTING_PACK_INVALID'
      | 'ACCOUNTING_PACK_DUPLICATE_ID'
      | 'ACCOUNTING_PACK_UNKNOWN_SUBJECT',
    message: string,
  ) {
    super(message);
    this.name = 'AccountingPackError';
  }
}

function assertUnique(ids: readonly string[], what: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new AccountingPackError(
      'ACCOUNTING_PACK_DUPLICATE_ID',
      `duplicate ${what} in accounting pack payload`,
    );
  }
}

/**
 * 验真会计域 payload。fail-closed：形状不对、id 重复、分录引用了目录里没有的
 * 科目，一律抛错，不做乐观放行。
 *
 * 最后一条是关键：分录腿引用未登记科目，意味着换包后会记出一个谁也解释不了
 * 的科目，而那笔账已经进了账本。
 */
export function parseAccountingPackPayload(
  payload: unknown,
): AccountingPackPayload {
  const envelope = accountingPackEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new AccountingPackError(
      'ACCOUNTING_PACK_INVALID',
      'accounting pack payload does not match the accounting domain shape',
    );
  }
  const subjectCatalogs = envelope.data.catalogs.filter(
    (c) => c.kind === 'subjects',
  );
  const reportLineCatalogs = envelope.data.catalogs.filter(
    (c) => c.kind === 'report_lines',
  );
  const closingItemCatalogs = envelope.data.catalogs.filter(
    (c) => c.kind === 'closing_items',
  );
  const schemeCatalogs = envelope.data.catalogs.filter(
    (c) => c.kind === 'schemes',
  );
  const schemeFitCatalogs = envelope.data.catalogs.filter(
    (c) => c.kind === 'scheme_fit',
  );
  const deadlineCatalogs = envelope.data.catalogs.filter(
    (c) => c.kind === 'deadlines',
  );
  if (
    subjectCatalogs.length !== 1 ||
    reportLineCatalogs.length > 1 ||
    closingItemCatalogs.length !== 1 ||
    schemeCatalogs.length > 1 ||
    schemeFitCatalogs.length > 1 ||
    deadlineCatalogs.length > 1
  ) {
    throw new AccountingPackError(
      'ACCOUNTING_PACK_INVALID',
      'accounting pack must carry exactly one subjects catalog, at most one report_lines catalog, exactly one closing_items catalog, at most one schemes catalog, at most one scheme_fit catalog and at most one deadlines catalog',
    );
  }
  assertUnique(
    envelope.data.catalogs.map((c) => c.catalogId),
    'catalogId',
  );
  const catalog = subjectCatalogs[0];
  const parsed = {
    data: {
      catalogs: [{ catalogId: catalog.catalogId, subjects: catalog.subjects }],
      decisionTables: envelope.data.decisionTables,
      evidenceRequirements: envelope.data.evidenceRequirements,
      parameters: envelope.data.parameters,
      sources: envelope.data.sources,
      reportLines: reportLineCatalogs[0]?.lines ?? [],
      closingItems: closingItemCatalogs[0].items,
      schemes: schemeCatalogs[0]?.schemes ?? [],
      schemeFits: schemeFitCatalogs[0]?.fits ?? [],
      deadlines: deadlineCatalogs[0]?.deadlines ?? [],
      ...(schemeCatalogs[0] !== undefined
        ? { defaultScheme: schemeCatalogs[0].defaultScheme }
        : {}),
    } satisfies AccountingPackPayload,
  };
  const subjectCodes = catalog.subjects.map((s) => s.subjectCode);
  assertUnique(subjectCodes, 'subjectCode');
  assertUnique(
    parsed.data.decisionTables.map((t) => t.tableId),
    'tableId',
  );
  assertUnique(
    parsed.data.decisionTables.flatMap((t) => t.rules.map((r) => r.ruleId)),
    'ruleId',
  );
  assertUnique(
    parsed.data.evidenceRequirements.map((e) => e.eventKind),
    'eventKind',
  );
  assertUnique(
    parsed.data.sources.map((s) => s.sourceId),
    'sourceId',
  );
  // lineId 只在本张报表内唯一：利润表和资产负债表各有一行叫「合计」是正常的。
  assertUnique(
    parsed.data.reportLines.map((l) => `${l.reportId}/${l.lineId}`),
    'reportId/lineId',
  );
  assertUnique(
    parsed.data.closingItems.map((i) => i.itemId),
    'itemId',
  );
  assertUnique(
    parsed.data.schemes.map((s) => s.schemeCode),
    'schemeCode',
  );
  assertUnique(
    parsed.data.deadlines.map((d) => d.deadlineId),
    'deadlineId',
  );
  assertUnique(
    parsed.data.schemeFits.map((f) => f.intentKey),
    'intentKey',
  );
  if (
    parsed.data.defaultScheme !== undefined &&
    !parsed.data.schemes.some((s) => s.schemeCode === parsed.data.defaultScheme)
  ) {
    throw new AccountingPackError(
      'ACCOUNTING_PACK_INVALID',
      'defaultScheme is not one of the declared schemes',
    );
  }
  // 适配指向一档不存在的记法，等于这条建议永远查不到——不让它进包，别留到老板面前
  // 才变成「没建议」而且说不出为什么。
  const declaredSchemes = new Set(parsed.data.schemes.map((s) => s.schemeCode));
  for (const fit of parsed.data.schemeFits) {
    if (!declaredSchemes.has(fit.schemeCode)) {
      throw new AccountingPackError(
        'ACCOUNTING_PACK_INVALID',
        `scheme_fit for intent ${fit.intentKey} points at an undeclared scheme: ${fit.schemeCode}`,
      );
    }
  }

  const known = new Set(subjectCodes);
  const sourceIds = new Set(parsed.data.sources.map((s) => s.sourceId));
  const deadlinePeriodPatterns = {
    monthly: /^\d{4}-(0[1-9]|1[0-2])$/,
    quarterly: /^\d{4}-Q[1-4]$/,
    yearly: /^\d{4}$/,
  };
  for (const deadline of parsed.data.deadlines) {
    const calendar = deadline.calendar ?? [];
    assertUnique(
      calendar.map((entry) => entry.periodKey),
      `deadline ${deadline.deadlineId} calendar periodKey`,
    );
    for (const entry of calendar) {
      if (!deadlinePeriodPatterns[deadline.cadence].test(entry.periodKey)) {
        throw new AccountingPackError(
          'ACCOUNTING_PACK_INVALID',
          `deadline ${deadline.deadlineId} period ${entry.periodKey} does not match ${deadline.cadence}`,
        );
      }
      if (!sourceIds.has(entry.basisSourceId)) {
        throw new AccountingPackError(
          'ACCOUNTING_PACK_INVALID',
          `deadline ${deadline.deadlineId} references source ${entry.basisSourceId} absent from sources`,
        );
      }
    }
  }
  for (const table of parsed.data.decisionTables) {
    for (const rule of table.rules) {
      // 依据必须真在包里：一条指向不存在依据的规则，抽屉里会显示成「有依据」却
      // 什么都拿不出来。
      if (
        rule.basisSourceId !== undefined &&
        !sourceIds.has(rule.basisSourceId)
      ) {
        throw new AccountingPackError(
          'ACCOUNTING_PACK_INVALID',
          `rule ${rule.ruleId} references source ${rule.basisSourceId} absent from sources`,
        );
      }
      if (isSkipRule(rule)) continue;
      for (const leg of rule.legs) {
        if (!known.has(leg.subjectCode)) {
          throw new AccountingPackError(
            'ACCOUNTING_PACK_UNKNOWN_SUBJECT',
            `posting rule ${rule.ruleId} references a subject absent from the catalog`,
          );
        }
      }
      const transfer = rule.referencedBalance;
      if (transfer !== undefined) {
        const fail = () => {
          throw new AccountingPackError(
            'ACCOUNTING_PACK_INVALID',
            `rule ${rule.ruleId} has invalid referenced balance declaration`,
          );
        };
        if (
          !known.has(transfer.subjectCode) ||
          !known.has(transfer.consumptionSubjectCode ?? transfer.subjectCode) ||
          (transfer.schedule !== undefined &&
            transfer.consumption !== 'requested') ||
          rule.settlesPostedEvent !== undefined ||
          transfer.sourceEventFactKey === 'event.kind' ||
          new Set(transfer.sourceRuleIds).size !==
            transfer.sourceRuleIds.length ||
          rule.legs.filter(
            (leg) =>
              leg.subjectCode ===
              (transfer.consumptionSubjectCode ?? transfer.subjectCode),
          ).length !== 1 ||
          rule.legs.filter(
            (leg) =>
              leg.subjectCode ===
                (transfer.consumptionSubjectCode ?? transfer.subjectCode) &&
              leg.direction !== transfer.sourceDirection &&
              leg.amountSource === transfer.amountSource,
          ).length !== 1 ||
          (transfer.consumption !== 'requested' &&
            rule.legs.some((leg) => leg.amountSource !== transfer.amountSource))
        )
          fail();
        for (const id of transfer.sourceRuleIds) {
          const source = parsed.data.decisionTables
            .flatMap((t) => t.rules)
            .find((r) => r.ruleId === id);
          if (
            !source ||
            isSkipRule(source) ||
            source.referencedBalance ||
            id === rule.ruleId ||
            source.legs.filter(
              (leg) =>
                leg.subjectCode === transfer.subjectCode &&
                leg.direction === transfer.sourceDirection,
            ).length !== 1
          )
            fail();
        }
      }
      const settlement = rule.settlesPostedEvent;
      if (settlement !== undefined) {
        function failSettlement(detail: string): never {
          throw new AccountingPackError(
            'ACCOUNTING_PACK_INVALID',
            `rule ${rule.ruleId} has invalid posted-event settlement: ${detail}`,
          );
        }
        const repaymentLegs = rule.legs.filter(
          (leg) => leg.subjectCode === settlement.liabilitySubjectCode,
        );
        if (
          rule.legs.length !== 2 ||
          repaymentLegs.length !== 1 ||
          repaymentLegs[0].direction !== settlement.repaymentDirection ||
          rule.legs.filter(
            (leg) => leg.direction === settlement.sourceDirection,
          ).length !== 1 ||
          rule.legs.some((leg) => leg.amountSource !== settlement.amountSource)
        ) {
          failSettlement(
            'repayment must have one liability leg and two equal-source legs',
          );
        }
        for (const sourceRuleId of settlement.sourceRuleIds) {
          const source = parsed.data.decisionTables
            .flatMap((item) => item.rules)
            .find((item) => item.ruleId === sourceRuleId);
          if (
            source === undefined ||
            sourceRuleId === rule.ruleId ||
            isSkipRule(source) ||
            source.settlesPostedEvent !== undefined
          ) {
            failSettlement('source must be a different posting rule');
          }
          const sourceLegs = source.legs.filter(
            (leg) => leg.subjectCode === settlement.liabilitySubjectCode,
          );
          if (
            sourceLegs.length !== 1 ||
            sourceLegs[0].direction !== settlement.sourceDirection
          ) {
            failSettlement('source rule must create the declared liability');
          }
        }
      }
    }
  }
  // 与分录腿同一条理由：报表行引用未登记科目，意味着表上会出现一个谁也解释
  // 不了的行，而那张表已经交出去了。
  for (const line of parsed.data.reportLines) {
    for (const subjectCode of line.subjectCodes) {
      if (!known.has(subjectCode)) {
        throw new AccountingPackError(
          'ACCOUNTING_PACK_UNKNOWN_SUBJECT',
          `report line ${line.reportId}/${line.lineId} references a subject absent from the catalog`,
        );
      }
    }
  }

  // 按余额结转的两个引用都得落到实处，否则做那一项时才发现：科目集合是空的
  // （报表 id 打错 → 一条腿都生成不出来 → 静默什么都没结），或者差额无处可去。
  const reportIds = new Set(parsed.data.reportLines.map((l) => l.reportId));
  for (const item of parsed.data.closingItems) {
    const transfer = item.balanceTransfer;
    if (transfer === undefined) continue;
    if (!reportIds.has(transfer.fromReportId)) {
      throw new AccountingPackError(
        'ACCOUNTING_PACK_INVALID',
        `closing item ${item.itemId} transfers from report ${transfer.fromReportId} which has no lines`,
      );
    }
    if (!known.has(transfer.toSubjectCode)) {
      throw new AccountingPackError(
        'ACCOUNTING_PACK_UNKNOWN_SUBJECT',
        `closing item ${item.itemId} transfers into a subject absent from the catalog`,
      );
    }
  }

  return parsed.data;
}

/**
 * 归一化包 → 信封形状。录入工具产出信封，签名分发也走信封；这里是唯一的反向。
 * `reportLines` 为空时不产报表行目录——空目录合法，但没必要多一份。
 */
export function encodeAccountingPackEnvelope(
  payload: AccountingPackPayload,
  catalogIds: {
    readonly reportLines: string;
    readonly closingItems: string;
    readonly schemes?: string;
    readonly schemeFit?: string;
    readonly deadlines?: string;
  },
): AccountingPackEnvelope {
  const subjectCatalog = payload.catalogs[0];
  return {
    catalogs: [
      {
        catalogId: subjectCatalog.catalogId,
        kind: 'subjects',
        subjects: [...subjectCatalog.subjects],
      },
      ...(payload.reportLines.length > 0
        ? [
            {
              catalogId: catalogIds.reportLines,
              kind: 'report_lines' as const,
              lines: [...payload.reportLines],
            },
          ]
        : []),
      {
        catalogId: catalogIds.closingItems,
        kind: 'closing_items',
        items: [...payload.closingItems],
      },
      ...(payload.schemes.length > 0 && payload.defaultScheme !== undefined
        ? [
            {
              catalogId: catalogIds.schemes ?? 'schemes',
              kind: 'schemes' as const,
              defaultScheme: payload.defaultScheme,
              schemes: [...payload.schemes],
            },
          ]
        : []),
      ...(payload.schemeFits.length > 0
        ? [
            {
              catalogId: catalogIds.schemeFit ?? 'scheme-fit',
              kind: 'scheme_fit' as const,
              fits: [...payload.schemeFits],
            },
          ]
        : []),
      ...(payload.deadlines.length > 0
        ? [
            {
              catalogId: catalogIds.deadlines ?? 'deadlines',
              kind: 'deadlines' as const,
              deadlines: [...payload.deadlines],
            },
          ]
        : []),
    ],
    decisionTables: [...payload.decisionTables],
    evidenceRequirements: [...payload.evidenceRequirements],
    parameters: [...payload.parameters],
    sources: [...payload.sources],
  };
}
