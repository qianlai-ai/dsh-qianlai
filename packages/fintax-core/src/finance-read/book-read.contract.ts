// 来源：moneycome harness/src/finance-read/book-read.contract.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 读侧工具面的可读目录：哪些实体、哪些列、哪个角色看得见哪些。
 *
 * ## 为什么是目录而不是任意 SQL
 *
 * 参考实现（revenue-agent）的读侧是「任意只读 SELECT + 分页 + 整份结果统计」，
 * 实测把给出结论率从 32.7% 拉到 92.7%。那条路这里**没有直接照搬**，因为两边
 * 的前提不同：
 *
 * - 它面对的是列名事先不知道的任意数据集，任意 SQL 是唯一解
 * - 我们面对的是 13 张自己定义的固定表，结构化查询的表达力缺口小得多
 *
 * 而任意 SQL 与「前台视图没有金额列」直接冲突——模型写 `SELECT amount` 就绕
 * 过去了。要同时拿到两样，SQL 必须对着按租户 + 角色裁好的视图，那需要
 * 视图与 RLS 的迁移。**那是下一步，不是现在**；在它落地之前，列的可见性靠
 * 目录保证，不靠拦截。
 *
 * 从参考实现那边照搬的是三条与查询语言无关的教训：
 *
 * 1. **每页都带整份结果的总行数。** 模型看不见总数就会把一页当全部，
 *    然后用权威口吻报一个偏小的合计。
 * 2. **统计的额度先留出来。** 明细先占满预算再追加统计，统计会被顶掉。
 * 3. **拒绝要说清楚为什么。** 「只允许 SELECT」对着一条 SELECT 报出来，
 *    模型只能瞎猜——那份存档里 435 份分析有 76 份栽在这上面。
 */

/** 读侧能查的实体。每一个都对应 L1 的一张事实表。 */
export const BOOK_ENTITIES = [
  'transaction',
  'material',
  'event',
  'period',
  'party',
  'openingEntry',
  'entry',
  'statementImport',
  'statementImportRevision',
] as const;
export type BookEntity = (typeof BOOK_ENTITIES)[number];

/**
 * 角色 → 看得见什么。用 harness 既有的角色词表，不另造一套。
 *
 * - `owner` 老板：全部，且只有它能选记法、看交接摘要的对话半边、改小组设置
 * - `employee` 前台：金额列按租户「财税小组设置」的开关给（默认给）；关了就
 *   **没有金额列**
 *
 * 前台看不到金额不是「被拒绝」，是那一列在返回里根本不存在。两者对模型是
 * 两回事：被拒绝会让它反复重试并把拒绝当成故障，不存在则它压根不会去问。
 *
 * 审计面的只读身份**刻意不在这里**：仓库把审计类角色列为治理候选，生产源码不得
 * 为它开新的来源权限路径（`batch-a4-1` 扫描常驻）。审计面是最后一批，到时按
 * A4 治理路径落它的读权限，而不是读侧现在替它开口。
 */
export type BookReaderRole = 'owner' | 'employee';

export interface BookColumn {
  readonly name: string;
  /** 给模型看的一句话。列名再直白也不如写清它是什么口径。 */
  readonly what: string;
  /**
   * 前台看不到的列。前台的视图会把它整列去掉——判据写在数据上而不是散在
   * 代码里，是为了「新增一列忘了裁」这件事有唯一一处要改。两类列要标：
   * 金额列本身；以及模型照着材料写的自由文本（事项描述、把关理由、白话注解、
   * 流水的待答备注）——模型会把票面金额原样写进去，真跑照出来的
   * （车道 A2 2026-08-17：前台待办卡里的事项描述带着「…31850.00元」）。
   */
  readonly money?: boolean;
  /** 可否用于筛选。不可筛的列（长文本）放进来只会让模型试了再被拒。 */
  readonly filterable?: boolean;
  /** 可否用于分组。 */
  readonly groupable?: boolean;
  /**
   * 派生列：不是这张表上的字段，由服务从事项关联或固定原件元数据取得。
   * 查询时不进 select，筛选时先查来源
   * 再按 id 收口，返回时逐行补上。
   */
  readonly derived?:
    | 'evidenceLinks'
    | 'materialFileName'
    | 'materialFileNameAliases';
}

/**
 * 「这张表的一行归哪个月」——**按月看账的唯一判据**。
 *
 * 为什么要有它：2026-08-21 真机撞到「会计分录在任何期间都显示 0 行」，而同屏写着
 * 「本期已出 28 张凭证」。前端用「列名以 `At` 结尾」猜期间列，`entry` 上猜中的是
 * `createdAt`（记账时间，全部是灌数那天），于是筛出来永远是空。
 *
 * 前端不是随便猜的——它照抄了 `buildWhere` 里的 `endsWith('At')`。但那条在后端答的是
 * 「这一列是不是时间戳、能不能用 contains」，不是「哪一列是会计期间」。**同一条规则，
 * 两个问题**；后端从来没发布过后一个事实，前端只能抓最像的那条。
 *
 * 所以这件事收在这里，由包含领域知识的一侧说清楚，调用方（前端与模型）给一个
 * `periodKey`（`YYYY-MM`）就行，不选列、不判形状、不翻 id。
 *
 * 归月方式不能合并，它们答的不是同一个问题：
 *
 * - `periodId`：归属由外键定死。**跨期事项的 `occurredAt` 与 `periodId` 可以不同月**
 *   （schema 在 `FinBusinessEvent.periodId` 上写着这句），按日期筛会把它们算错月。
 * - `businessDate`：表上没有期间外键，业务日期落在哪个月就是哪个月。
 * - `submissionDate`：**按交上来的日子分月，不是会计期间**。1 月开的票 3 月才交，它在
 *   3 月这一格里——这是「这个月我交了什么」，不是「这个月的账」。两者是两个问题，
 *   界面上得说的是不同的话，所以在类型上就分开，不让调用方以为是同一种。
 * - `evidencePeriod`：关联事项的账期；未归属任何账期的材料才按收件月份。
 *   同一原件可在多个已引用它的账期出现，建档未归属原件查询时不传 periodKeys。
 * - `none`：这张表不按月分，`why` 说清为什么。给了 `periodKey` 会被拒绝，**不静默全量**。
 */
export type BookPeriodScope =
  | { readonly kind: 'periodId'; readonly column: string }
  | { readonly kind: 'businessDate'; readonly column: string }
  | { readonly kind: 'submissionDate'; readonly column: string }
  /** 已关联材料按事项期间；未归属账期材料按 column 的收件月份。 */
  | { readonly kind: 'evidencePeriod'; readonly column: string }
  /** 这张表本身就是期间表：按 `YYYY-MM` 直接比。 */
  | { readonly kind: 'periodKey'; readonly column: string }
  | { readonly kind: 'none'; readonly why: string };

export interface BookEntityDefinition {
  readonly ownerOnly?: boolean;
  readonly entity: BookEntity;
  readonly what: string;
  readonly columns: readonly BookColumn[];
  /**
   * 这一列是时间戳，因此**筛法**受限（不认 contains，值必须是能读的日期）。
   *
   * **不是「按哪一列分期间」** —— 那是 `periodScope` 的事，两者对 `entry` 恰好不同：
   * 这里是 `createdAt`（记账时间），期间归属是 `periodId`。混用过一次，代价是那一屏
   * 恒空。
   */
  readonly timeColumn?: string;
  /** 这张表的一行归哪个月。每个实体都要声明，**不给默认值**——漏声明就该编译期红。 */
  readonly periodScope: BookPeriodScope;
}

export const BOOK_CATALOG: readonly BookEntityDefinition[] = [
  {
    entity: 'statementImport',
    ownerOnly: true,
    what: '纠正前读取一个已知 importId 的当前批次：必须 filters=[{column:"id",op:"eq",value:importId}]，仅当前老板。',
    periodScope: {
      kind: 'none',
      why: '按已知批次 id 精确读取，不按期间扫描。',
    },
    columns: [
      { name: 'id', what: '批次 id', filterable: true },
      { name: 'accountId', what: '账户 id' },
      { name: 'rowVersion', what: '批次当前版本' },
      { name: 'periodStart', what: '原始区间起始日' },
      { name: 'periodEnd', what: '原始区间结束日' },
      { name: 'sourceKind', what: '来源类型' },
      {
        name: 'sourceMaterialIds',
        what: '旧来源材料 id；原件固定版本沿 read_material 核对',
      },
      {
        name: 'transactionCount',
        what: '本批新增交易行数；不包含复用的已导入交易',
      },
      {
        name: 'completeness',
        what: '按当前原件及交易核验的完整性；来源变化后为未知',
      },
    ],
  },
  {
    entity: 'statementImportRevision',
    ownerOnly: true,
    what: '一个已知批次的不可变纠正历史：必须 filters=[{column:"importId",op:"eq",value:importId}]，仅当前老板，最多20项一页。',
    timeColumn: 'createdAt',
    periodScope: { kind: 'none', why: '按已知批次 id 精确读取修订历史。' },
    columns: [
      { name: 'id', what: '修订 id' },
      { name: 'importId', what: '批次 id', filterable: true },
      { name: 'requestId', what: '稳定请求 id' },
      { name: 'fromImportVersion', what: '原批次版本' },
      { name: 'toImportVersion', what: '修订后版本' },
      { name: 'beforeJson', what: '精确旧来源与行值', money: true },
      { name: 'afterJson', what: '精确新来源与行值', money: true },
      { name: 'reason', what: '老板批准的纠正原因', money: true },
      { name: 'createdAt', what: '修订时间' },
    ],
  },
  {
    entity: 'transaction',
    what: '银行流水。默认只读有效行；按 id 或 explanationState 明确查询可追溯已排除重复行。',
    timeColumn: 'occurredAt',
    // 流水表上没有期间外键，钱哪天动的就算哪个月。
    periodScope: { kind: 'businessDate', column: 'occurredAt' },
    columns: [
      { name: 'id', what: '流水行 id', filterable: true },
      { name: 'importId', what: '所属原始导入批次 id', filterable: true },
      { name: 'rowVersion', what: '流水当前行版本' },
      { name: 'updatedAt', what: '流水最近更新时间' },
      {
        name: 'accountId',
        what: '在哪个账户上（内部划转是两个不同账户各一条）',
        filterable: true,
        groupable: true,
      },
      {
        name: 'occurredAt',
        what: '交易日期',
        filterable: true,
        groupable: true,
      },
      { name: 'amount', what: '金额，正数；方向看 direction', money: true },
      {
        name: 'direction',
        what: '收支方向：in 进 / out 出',
        filterable: true,
        groupable: true,
      },
      {
        name: 'counterpartyName',
        what: '对方户名',
        filterable: true,
        groupable: true,
      },
      { name: 'rawDescription', what: '银行摘要原文' },
      {
        name: 'explanationState',
        what: '这笔钱的归宿：unexplained 还没说清 / linkedToEvent 挂到了业务事项 / internalTransfer 自家账户间划转 / openingReceivableSettlement 收回期初应收 / openingPayableSettlement 付掉期初应付 / pendingUserInput 说不清、等人答 / excludedDuplicate 已更正的重复记录，不参与金额计算',
        filterable: true,
        groupable: true,
      },
      { name: 'linkedEventId', what: '挂到了哪笔业务事项', filterable: true },
      {
        name: 'internalTransferPairId',
        what: '内部划转时与另一条共享的配对 id',
        filterable: true,
      },
      {
        name: 'linkedOpeningEntryId',
        what: '冲了哪条期初条目',
        filterable: true,
      },
      {
        name: 'explanationNote',
        what: '说不清时写明的是什么、要问谁（pendingUserInput 才有；会带金额）',
        money: true,
      },
    ],
  },
  {
    entity: 'material',
    what: '原始材料：columns 仅是本工具为当前读者提供的可见只读逻辑字段目录，不是底层数据库表结构或存储字段全集；未列出接受、确认或识别完成时间，只说明本目录未提供这些字段，不能据此断言底层未存或事件未发生。核实这些时点须取得对应权威事件证据，未取得时明确无法确定。已关联材料按业务事项账期查询，可跨月补交或复用建档原件；未归属账期材料按收件月份。找建档未归属原件时不传 periodKeys，提交时间筛选请单独使用 submittedAt。资金账户证据是通用类型，不能据此判断开户证明或对账单用途。单份材料的 purposeReferences 仅投影当前已接受正式档案中同版本的资金账户用途引用，按 purposeReferencesMeaning 限定范围；不是全部材料接收或账务用途目录，空数组不能证明未接收、未用于账务或需要补登记。业务发票和付款的关联沿 linkedEventIds 核对权威事项及实际状态；存在关联也不能证明全部正式接收或账务处理已完成。',
    timeColumn: 'submittedAt',
    periodScope: { kind: 'evidencePeriod', column: 'submittedAt' },
    columns: [
      { name: 'id', what: '材料 id', filterable: true },
      {
        name: 'fileName',
        what: '上传原件的文件名；来源不可用时为空。eq/in/contains 同时匹配已核实的收件名；共名原件分别返回，名称不能代替材料 id',
        filterable: true,
        derived: 'materialFileName',
      },
      {
        name: 'fileNameAliases',
        what: '本企业同材料当前版本已消费上传票据中的其他实际收件名；无记录或来源不可用时为空数组，不代表另一份原件',
        derived: 'materialFileNameAliases',
      },
      {
        name: 'materialKind',
        what: '材料类型：contract 合同 / invoice 发票 / receipt 收据 / statement 银行回单或对账单 / fundAccountEvidence 资金账户证据 / paymentScreenshot 付款截图 / payroll 工资表 / chat 聊天记录 / voice 语音 / license 证照 / other 其他',
        filterable: true,
        groupable: true,
      },
      {
        name: 'submittedAt',
        what: '提交时间：带时区的 UTC 原值，叙述提交日期与时分按 Asia/Shanghai（北京时间）换算，不直接截取 UTC 日期；与票面业务日期不同',
        filterable: true,
        groupable: true,
      },
      {
        name: 'submittedVia',
        what: '从哪个渠道进来的：client 客户端 / wechat 微信 / system 系统灌入',
        filterable: true,
        groupable: true,
      },
      {
        name: 'readability',
        what: '读得清楚吗：readable 读得清 / partiallyUnreadable 部分读不清 / unreadable 读不清',
        filterable: true,
        groupable: true,
      },
      {
        name: 'extractionState',
        what: '资料要素提取状态：none / queued / running / done / failed；不是整份材料的处理进度。PDF、表格等可通过原件读取办理而仍为 none，不能据此断言从未读取、未办理或状态未同步；整体处理状态须读实际处理回执，业务结果须核对关联事项。',
        filterable: true,
        groupable: true,
      },
      { name: 'rowVersion', what: '材料当前行版本' },
      {
        name: 'sourceVersionId',
        what: '原件固定版本 id；为空时不能用于历史纠正',
      },
      {
        name: 'updatedAt',
        what: '材料最近更新时间：材料记录最近更新时刻的 UTC 原值，日期与时分按 Asia/Shanghai（北京时间）换算；不能据此确定接受、确认或识别完成时间，无专门事件时间证据时须明确无法确定',
      },
      {
        name: 'derivedFromMaterialId',
        what: '本材料从哪份原件派生；不表示批次',
        filterable: true,
      },
      { name: 'duplicateOfMaterialId', what: '与哪份重复', filterable: true },
      { name: 'supersedesMaterialId', what: '取代了哪份', filterable: true },
      {
        name: 'linkedEventIds',
        what: '挂到了哪几笔业务事项（一份材料可能挂多笔，所以是数组）；按事项找材料用 eq 一个事项 id',
        filterable: true,
        derived: 'evidenceLinks',
      },
    ],
  },
  {
    entity: 'event',
    what: '业务事项：用户能看懂的客观事实，一笔生意或一次支出。',
    timeColumn: 'occurredAt',
    // 归属看外键不看日期：跨期事项的 occurredAt 与 periodId 可以不同月（schema 在
    // FinBusinessEvent.periodId 上写着这句），按 occurredAt 筛会把它们算错月。
    periodScope: { kind: 'periodId', column: 'periodId' },
    columns: [
      { name: 'id', what: '事项 id', filterable: true },
      { name: 'rowVersion', what: '事项当前版本，纠正日期须绑定此版本' },
      {
        name: 'occurredAt',
        what: '发生日期',
        filterable: true,
        groupable: true,
      },
      {
        name: 'eventKind',
        what: '业务形态，不是会计科目',
        filterable: true,
        groupable: true,
      },
      {
        name: 'counterpartyName',
        what: '对手方',
        filterable: true,
        groupable: true,
      },
      {
        name: 'description',
        what: '客观描述，不含会计判断（照材料写，会带金额）',
        money: true,
      },
      {
        name: 'state',
        what: '走到哪一步了：draft 草稿 / evidencePending 等证据 / readyToPost 待记账 / posted 已记账 / corrected 已更正 / void 作废',
        filterable: true,
        groupable: true,
      },
      {
        name: 'confidence',
        what: '这笔是谁判的：rule 规则命中 / aiGuess 模型猜的 / human 人确认过',
        filterable: true,
        groupable: true,
      },
      {
        name: 'reviewFocus',
        what: '要不要人把关',
        filterable: true,
        groupable: true,
      },
      {
        name: 'reviewNote',
        what: '为什么要把关（会带对不上的数）',
        money: true,
      },
      {
        name: 'plainText',
        what: '白话注解，去掉科目代码只讲事情本身（会带金额）',
        money: true,
      },
      {
        name: 'periodId',
        what: '归属哪个会计期间',
        filterable: true,
        groupable: true,
      },
      {
        name: 'factsJson',
        what: '记账规则用的其余事实（如 settlement.method），键由包声明',
      },
    ],
  },
  {
    entity: 'period',
    what: '会计期间，按月。',
    // 这张表本身就是期间：直接比 yearMonth。
    periodScope: { kind: 'periodKey', column: 'yearMonth' },
    columns: [
      { name: 'id', what: '期间 id', filterable: true },
      { name: 'rowVersion', what: '期间当前事实版本，纠正审批须绑定此版本' },
      {
        name: 'yearMonth',
        what: '年月，YYYY-MM',
        filterable: true,
        groupable: true,
      },
      {
        name: 'state',
        what: '期间状态：collecting 收材料 / pendingClose 待结 / closed 已结 / locked 已锁',
        filterable: true,
        groupable: true,
      },
      { name: 'closedAt', what: '什么时候结的' },
      { name: 'lockedAt', what: '什么时候锁的' },
    ],
  },
  {
    entity: 'party',
    what: '往来户：客户、供应商、员工、股东。余额算出不存，不在本表。',
    periodScope: {
      kind: 'none',
      why: '往来户是一个对象，不是一笔发生额，不属于某个月。要看它这个月的往来，查分录或事项。',
    },
    columns: [
      { name: 'id', what: '往来户 id', filterable: true },
      {
        name: 'partyKind',
        what: '哪一类：shareholder 股东 / employee 员工 / customer 客户 / supplier 供应商 / other 其他',
        filterable: true,
        groupable: true,
      },
      { name: 'partyName', what: '名字', filterable: true, groupable: true },
      {
        name: 'state',
        what: '还在往来吗：active 往来中 / settled 已结清 / archived 已归档',
        filterable: true,
        groupable: true,
      },
    ],
  },
  {
    entity: 'openingEntry',
    what: '期初条目。接手这套账时的起点，年中接管最容易错的地方。',
    periodScope: {
      kind: 'none',
      why: '期初是接手这套账那个时点的余额，不属于任何一个会计期间。',
    },
    columns: [
      { name: 'id', what: '条目 id', filterable: true },
      {
        name: 'subjectCode',
        what: '科目号',
        filterable: true,
        groupable: true,
      },
      {
        name: 'subjectName',
        what: '科目名',
        filterable: true,
        groupable: true,
      },
      { name: 'debitAmount', what: '借方金额', money: true },
      { name: 'creditAmount', what: '贷方金额', money: true },
      { name: 'partyAccountId', what: '挂在哪个往来户上', filterable: true },
    ],
  },
  {
    entity: 'entry',
    what: '会计分录。一行是一条分录腿，同一凭证号的几行是一张凭证；由记账引擎按会计包从事项推出，不是人填的。',
    timeColumn: 'createdAt',
    // 分录表上**没有业务日期列**，唯一的期间载体就是这个外键（库里还为它建了
    // FinLedgerEntry_tenant_period_idx）。timeColumn 是 createdAt = 记账那一刻，
    // 与账期无关——按它筛就是 F-10 那个恒空的屏。
    periodScope: { kind: 'periodId', column: 'periodId' },
    columns: [
      { name: 'id', what: '分录腿 id', filterable: true },
      {
        name: 'voucherNo',
        what: '凭证号，同号的腿是一张凭证',
        filterable: true,
        groupable: true,
      },
      { name: 'eventId', what: '出自哪笔业务事项', filterable: true },
      { name: 'transactionId', what: '期初核销出自哪条流水', filterable: true },
      {
        name: 'periodId',
        what: '归属哪个会计期间',
        filterable: true,
        groupable: true,
      },
      {
        name: 'direction',
        what: '借 debit / 贷 credit',
        filterable: true,
        groupable: true,
      },
      {
        name: 'subjectCode',
        what: '科目号',
        filterable: true,
        groupable: true,
      },
      {
        name: 'subjectName',
        what: '科目名',
        filterable: true,
        groupable: true,
      },
      { name: 'amount', what: '金额', money: true },
      { name: 'packRef', what: '按哪版会计包推的', filterable: true },
      {
        name: 'ruleId',
        what: '命中包里哪条规则',
        filterable: true,
        groupable: true,
      },
      { name: 'partyAccountId', what: '挂在哪个往来户上', filterable: true },
      {
        name: 'supersededByEntryId',
        what: '被哪条更正取代了；为空且未作废才是现行分录',
        filterable: true,
      },
      {
        name: 'voidedAt',
        what: '作废时间；不为空即不再计入现行账，保留历史记录',
        filterable: true,
      },
      { name: 'createdAt', what: '记账时间', filterable: true },
    ],
  },
];

/** 一页最多多少行。超过这个数模型读不完，也会把上下文挤爆。 */
export const BOOK_PAGE_LIMIT = 200;

export const BOOK_READ_ERROR_CODES = {
  unknownEntity: 'FIN_BOOK_UNKNOWN_ENTITY',
  unknownColumn: 'FIN_BOOK_UNKNOWN_COLUMN',
  columnNotVisible: 'FIN_BOOK_COLUMN_NOT_VISIBLE',
  columnNotFilterable: 'FIN_BOOK_COLUMN_NOT_FILTERABLE',
  columnNotGroupable: 'FIN_BOOK_COLUMN_NOT_GROUPABLE',
  /** 时间列的筛法不对：op 不支持，或值不是能读的日期。 */
  timeFilterInvalid: 'FIN_BOOK_TIME_FILTER_INVALID',
  materialNotFound: 'FIN_BOOK_MATERIAL_NOT_FOUND',
  rulePackNotBound: 'FIN_BOOK_RULE_PACK_NOT_BOUND',
  /** 绑了不止一份会计包。读侧不替人挑，附上都是哪几份。 */
  rulePackAmbiguous: 'FIN_BOOK_RULE_PACK_AMBIGUOUS',
  periodNotFound: 'FIN_BOOK_PERIOD_NOT_FOUND',
  /** 这张表不按月分（periodScope.kind = none），却给了 periodKey。**不静默全量**。 */
  periodFilterUnsupported: 'FIN_BOOK_PERIOD_FILTER_UNSUPPORTED',
  /**
   * periodKey 与一条直接筛期间列的过滤同时给了。
   *
   * **不取其一**：静默让一边生效，正是 F-10 那种「我明明筛了却没生效」——查不出来，
   * 也不会有人报错。两条路都能表达期间，就必须由调用方明说用哪条。
   */
  periodFilterConflict: 'FIN_BOOK_PERIOD_FILTER_CONFLICT',
  /** 包没声明哪几行算收入 / 支出（parameters headline.*.lines），三个数算不出。 */
  headlineNotDeclared: 'FIN_BOOK_HEADLINE_NOT_DECLARED',
  /** 三个数是金额，前台身份看不见——不是被拒绝，是没有这一层。 */
  figuresNotVisible: 'FIN_BOOK_FIGURES_NOT_VISIBLE',
  /**
   * 这一期的数算不出（期初没核验 / 上期没锁），所以也拆不开。
   *
   * 与三个数同一条判据、同一个来源：`headline` 判成 `unavailable` 时返回里根本没有
   * `figures` 一格，下钻**必须一起沉默**。否则第一层说「算不出」、第三层却摆着一棵
   * 完整的树，等于从后门把那个不该给的数给了出去——而「显示一个灰色的数等于显示了
   * 那个数」正是成色三态刻意要防的事。`reason` 原样带上，好让界面说清缺哪一步。
   */
  figuresUnavailable: 'FIN_BOOK_FIGURES_UNAVAILABLE',
  /** 包没声明记法（schemes 目录），记法卡整块不可用，不是默认一档。 */
  schemesNotDeclared: 'FIN_BOOK_SCHEMES_NOT_DECLARED',
  /** 选的记法码不在包里。 */
  schemeUnknown: 'FIN_BOOK_SCHEME_UNKNOWN',
  /** 这一期已经按别的记法出过凭证，换档要先撤销那些凭证（更正），不静默重记。 */
  schemeChangeBlocked: 'FIN_BOOK_SCHEME_CHANGE_BLOCKED',
  /** 已结账 / 已锁的期间不能再选记法。 */
  periodLocked: 'FIN_BOOK_PERIOD_LOCKED',
  /**
   * 老板指定过谁是前台，而这个成员不在其中——整个财税面对他关着，让他找老板在
   * 「财税小组设置」里指定。老板没指定过时全体成员按前台算，不会走到这里。
   */
  roleNotAssigned: 'FIN_BOOK_ROLE_NOT_ASSIGNED',
  /** 财税小组设置只有老板能改。 */
  settingsOwnerOnly: 'FIN_BOOK_SETTINGS_OWNER_ONLY',
  /** 指定的前台里有不是本组织活跃成员、或本身就是老板的 userId。 */
  settingsMemberInvalid: 'FIN_BOOK_SETTINGS_MEMBER_INVALID',
  /** 我方主体登记要名称与税号一起给（票面三分之一只印名称、其余靠税号），只给一样不收。 */
  profileSubjectInvalid: 'FIN_BOOK_PROFILE_SUBJECT_INVALID',
  /** 指定当账套持有人的 aiEmployeeId 不是本租户的财税员工。 */
  profileEmployeeInvalid: 'FIN_BOOK_PROFILE_EMPLOYEE_INVALID',
  /**
   * 经营意图不在闭集里，或者把「都没有，正常经营」和其它几项一起选了。后一种存下去
   * 就不是一个事实，读侧无从解释，所以不悄悄替他挑一个、直接拒。
   */
  profileIntentInvalid: 'FIN_BOOK_PROFILE_INTENT_INVALID',
  /** 账套起始月不是 `YYYY-MM`，或月份不在 01–12。 */
  profileBookStartInvalid: 'FIN_BOOK_PROFILE_BOOK_START_INVALID',
  /**
   * 起始月往后挪，挪到了已经开出来的期间之后。
   *
   * 挪早了无害（更多月份变得可开）；挪晚了会把已存在的期间甩在起始月之前——那些月份
   * 的账还在，惰性开却从此拒绝碰它们，界面上表现为「有数据的月份打不开」。
   * 这种自相矛盾不静默接受，附上最早那个期间让人看清冲突在哪。
   */
  profileBookStartConflict: 'FIN_BOOK_PROFILE_BOOK_START_CONFLICT',
  /**
   * 会计包绑在租户档案上，租户里能记账的 AI 员工不止一个、老板又没指定哪个当账套持有人。
   * 与 rulePackAmbiguous（绑了不止一份包）分开——一个去设置里指定人，一个去收敛包。
   */
  holderAmbiguous: 'FIN_BOOK_HOLDER_AMBIGUOUS',
  /**
   * 这份材料没有留档的原件可读：样本灌进来没出图的（回单 / 合同 / 工资表）、上传链
   * 没登记进存储的、或存储里已经没有那份字节。材料本身还在，只是挖不到图那一层。
   */
  materialOriginalUnavailable: 'FIN_BOOK_MATERIAL_ORIGINAL_UNAVAILABLE',
  /**
   * 这一项申报没有可看的回执：还没提交、提交了还没取到回执、或者取回执那一跳失败了。
   * **绝不静默回落成「成功但没有回执」**——一张说申报成功却拿不出回执的卡不该存在，
   * 老板对着它只能信我们的话。取不到就明说取不到，界面显示「回执暂时取不到」。
   */
  filingReceiptUnavailable: 'FIN_BOOK_FILING_RECEIPT_UNAVAILABLE',
  /**
   * 这个 itemRef 在本租户找不到对应的申报审批绑定：id 写错了，或者它不属于这家租户。
   * 两种都回这一个码——不给跨租户探测口。
   */
  filingItemNotFound: 'FIN_BOOK_FILING_ITEM_NOT_FOUND',
  /**
   * 下钻要的这张凭证在本租户没有活跃分录腿：号写错了，或者它已经被撤销 / 红冲。
   * 两种都回这一个码——对老板都是「这张现在看不到」，区别去审计面看。
   */
  voucherNotFound: 'FIN_BOOK_VOUCHER_NOT_FOUND',
  /** 这台机器上一份会计包都没装。绑不了，也不是老板能自己解决的——先装包。 */
  packNoneDeployed: 'FIN_BOOK_PACK_NONE_DEPLOYED',
  /** 装了不止一份会计包，老板没说绑哪一份。附上候选，不替他挑。 */
  packChoiceRequired: 'FIN_BOOK_PACK_CHOICE_REQUIRED',
  /** 指名要绑的那一份在已部署的包里找不到。 */
  packNotDeployed: 'FIN_BOOK_PACK_NOT_DEPLOYED',
  /**
   * 包声明了多个适用地区或主体类型，老板没说按哪一个记。
   *
   * 不替他挑：地区与主体决定的是整套账按哪一版口径记，挑错一次就是整期账记在别的
   * 口径上——与解包器「多于一份回 ambiguous」同一条姿态。
   */
  packScopeRequired: 'FIN_BOOK_PACK_SCOPE_REQUIRED',
  /**
   * 已经按现在这份包出过凭证，不能直接换包。
   *
   * 换包比换记法档更重：已出的分录 `packRef` 存的是当时那一份，换了重推会得到不同
   * 分录。要改口径先撤销（未结账作废 / 已结账红冲），撤完再换。
   */
  packChangeBlocked: 'FIN_BOOK_PACK_CHANGE_BLOCKED',
  /** 会计包绑在小组上，不在租户档案上。从这里改会变成两份都绑（ambiguous），所以拒。 */
  packBoundOnTeam: 'FIN_BOOK_PACK_BOUND_ON_TEAM',
  /** 这个租户还没有财税员工，绑了也没人按它记账；先雇再绑。 */
  packNoFinanceEmployee: 'FIN_BOOK_PACK_NO_FINANCE_EMPLOYEE',
  /**
   * 绑上去了，但解析器验不过（签名 / 摘要 / 信任根 / 地区 / 主体 / 生效期 /
   * evaluator 契约）。绑定已回滚到绑之前的样子——不留一个验不过的绑定在那儿。
   */
  packVerificationFailed: 'FIN_BOOK_PACK_VERIFICATION_FAILED',
} as const;

/**
 * 材料提交人的 actorRef 写法：`actor:user:<userId>`。入库时写、读侧比对（前台看不见
 * 金额时，原件只给提交它的那个人看——票在他手上拍的，屏幕上再遮也遮不住）。
 * 两边共用一处，别各写一份前缀。
 */
export const MATERIAL_SUBMITTER_ACTOR_PREFIX = 'actor:user:';

export function materialSubmitterActorRef(userId: string): string {
  return `${MATERIAL_SUBMITTER_ACTOR_PREFIX}${userId}`;
}

export function findEntity(entity: string): BookEntityDefinition | undefined {
  return BOOK_CATALOG.find((row) => row.entity === entity);
}

/**
 * 这个读者在这个实体上看得见哪些列。
 *
 * 看不见金额的读者去掉金额列，其余全给。金额可不可见不再只看角色：老板恒可见，
 * 前台按租户「财税小组设置」的开关（默认开），判定在 `BookReadService.resolveReader`
 * 一处算好带在读者身上。**返回的是列定义而不是列名**，因为调用方还要用
 * `filterable` / `groupable`——只给名字会让每处都再查一次目录。
 */
export function visibleColumns(
  definition: BookEntityDefinition,
  amountsVisible: boolean,
): readonly BookColumn[] {
  if (amountsVisible) return definition.columns;
  return definition.columns.filter((column) => column.money !== true);
}

/**
 * 把 harness 的角色列表收敛成读侧的两档。
 *
 * 取最宽的那一档：一个人同时是 owner 和 employee 时按 owner 算。收敛顺序
 * 写死在这里而不是散在调用方，是因为「多个角色取哪个」错一次就是越权。
 * 没有任何已知角色时落到最窄的一档。
 */
export function resolveReaderRole(roles: readonly string[]): BookReaderRole {
  if (roles.includes('owner')) return 'owner';
  return 'employee';
}
