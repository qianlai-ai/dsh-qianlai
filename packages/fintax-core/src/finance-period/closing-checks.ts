// 来源：moneycome harness/src/finance-period/closing-checks.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 调用方：`closing-checks.service.ts`（按期间从表里查好输入再调本函数）。
 *
 * 结账六项检查（`14 §1.1`）。
 *
 * 一句话职责：**判断一个账期能不能锁，不能锁就说清六项各卡在哪。**
 *
 * ## 六项固定在代码里，不由包决定
 *
 * `13 §3.6` 与 `10 §6.4` 原先写的是「检查项是包声明的闭集」。那条有安全问题：
 * 一份漏写了第 6 项的包会让**跳期结账变合法**，而跳期会让个税累计预扣、增值税
 * 季度累计从断点往后全错，报表照样出得来、数字照样是数字。
 *
 * 包是会计填的，而会计不会想到跳期——手工账里本子是一页一页往下翻的，这事根本
 * 不可能发生。所以：**六项固定在这里，每一项的判定内容来自包。**（决策 D19）
 *
 * 这不违反 A1 零领域常量。A1 禁的是领域**取值**（浙江、小规模、1%），不是「账要
 * 按期间顺序结」这种会计的结构性事实。本文件没有一个科目号、税种、地区、税率。
 *
 * ## 一次全查，不短路
 *
 * 查到第 2 项不过就返回，老板补完再点又发现第 5 项也不过——这是把一次沟通拆成
 * 三次。结账一个月一次，来回三趟就是三个月的体感（`14 §1.4`）。
 *
 * ## 纯函数
 *
 * 无 IO、无时钟、无随机。所有输入由调用方查好了传进来，同一份输入永远同一结果。
 */

import type { AccountingPackPayload } from '../finance-ledger/accounting-pack.contract.js';

export type ClosingCheckId =
  /** 1 每个已登记账户的流水首尾相接、无缺口 */
  | 'statement_complete'
  /** 2 本期无未解释资金 */
  | 'funds_explained'
  /** 3 每笔事项满足包声明的证据要求 */
  | 'evidence_sufficient'
  /** 4 应记事项已处理，且逐张凭证借贷平衡 */
  | 'ledger_balanced'
  /** 5 包声明的期末必做项逐项有对应分录 */
  | 'closing_items_done'
  /** 6 上一期间已锁 */
  | 'previous_period_locked';

/** 六项的固定顺序。**代码里写死，包改不了。** */
export const CLOSING_CHECK_IDS: readonly ClosingCheckId[] = [
  'statement_complete',
  'funds_explained',
  'evidence_sufficient',
  'ledger_balanced',
  'closing_items_done',
  'previous_period_locked',
];

/**
 * 这一项没过，该谁去动。
 *
 * 角色不是人名——人名是租户数据，这一层不认。
 */
export type ClosingCheckResponsibility =
  /** 前台：跑银行、拍票、催材料这类物理动作。 */
  | 'reception'
  /** 老板本人，别人替不了。 */
  | 'boss'
  /** 看是哪一笔：认得出的前台认，认不出的转老板。 */
  | 'reception_or_boss'
  /** 没人可催，系统自己的事。 */
  | 'system';

/**
 * 每项固定的责任人。**这是这张表的全部价值。**
 *
 * 老板打开结账区，前三项没绿他知道该催前台，第六项是他自己的事，第四五项他
 * 谁也催不了只能等。一张没有责任人的检查清单只会制造焦虑：六个叉摆在那里，
 * 他不知道该做什么。
 *
 * 与六项同为代码常量、不由包决定，理由同上——责任归属是产品的结构，会计包
 * 改不了谁去跑银行。
 */
export const CLOSING_CHECK_RESPONSIBILITY: Readonly<
  Record<ClosingCheckId, ClosingCheckResponsibility>
> = {
  // 流水断在哪一段，得有人去网银把那一段导出来。
  statement_complete: 'reception',
  // 一笔说不清来路的到账：前台认得出就认，认不出转老板。
  funds_explained: 'reception_or_boss',
  // 缺票缺合同，得有人去要。
  evidence_sufficient: 'reception',
  // 借贷不平是引擎的事，催谁都没用。
  ledger_balanced: 'system',
  // 期末必做项由包声明、引擎生成，同上。
  closing_items_done: 'system',
  // 上一期还开着，只有老板能去把它结掉。
  previous_period_locked: 'boss',
};

/**
 * 卡住的具体原因。**结构化，不出文案**——渲染成中文是上层的事，这里只给事实。
 */
export type EventPostingIssue =
  | 'review_required'
  | 'rule_undetermined'
  | 'unposted';

export interface LinkedSettlementIssue {
  readonly transactionRef: string;
  readonly linkedEventRefs: readonly string[];
  readonly reason: 'unposted' | 'settlement_mismatch';
}

export type ClosingBlocker =
  | ({ readonly kind: 'linked_transaction_unsettled' } & LinkedSettlementIssue)
  | {
      readonly kind: 'statement_gap';
      readonly accountRef: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: 'unexplained_transaction';
      readonly transactionRef: string;
    }
  | {
      readonly kind: 'evidence_missing';
      readonly eventRef: string;
      readonly missingRoles: readonly string[];
    }
  | {
      readonly kind: 'evidence_requirement_absent';
      readonly eventRef: string;
      readonly eventKind: string;
    }
  | {
      readonly kind: 'voucher_unbalanced';
      readonly voucherRef: string;
      readonly debitMinor: bigint;
      readonly creditMinor: bigint;
    }
  | {
      readonly kind: 'event_not_ready';
      readonly eventRef: string;
      readonly reason: EventPostingIssue;
    }
  | { readonly kind: 'closing_item_pending'; readonly itemId: string }
  | {
      readonly kind: 'entity_fact_unknown';
      readonly itemId: string;
      readonly factKey: string;
    }
  | { readonly kind: 'previous_period_open'; readonly periodKey: string };

export interface ClosingCheckResult {
  readonly checkId: ClosingCheckId;
  readonly passed: boolean;
  /**
   * 这项没过该催谁。跟结果一起给，上层不必再查一张表——同一个事实两处取值，
   * 早晚有一处忘了跟。
   */
  readonly responsibility: ClosingCheckResponsibility;
  /** `passed` 为真时必为空。 */
  readonly blockers: readonly ClosingBlocker[];
}

export interface ClosingCheckReport {
  readonly canClose: boolean;
  /** 恒为六条，顺序恒为 `CLOSING_CHECK_IDS`。 */
  readonly checks: readonly ClosingCheckResult[];
}

/** 闭区间，`YYYY-MM-DD`。 */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/**
 * 上一期间的三种情形。
 *
 * **刻意不用 `| null`**：`null` 分不清「公司第一个账期」与「查不到上期」，而这两种
 * 的正确行为相反——前者放行，后者必须挡。让调用方明说。
 */
export type PreviousPeriod =
  | { readonly kind: 'locked'; readonly periodKey: string }
  | { readonly kind: 'open'; readonly periodKey: string }
  | { readonly kind: 'first_period' };

export interface ClosingCheckInput {
  readonly periodRange: DateRange;
  readonly previousPeriod: PreviousPeriod;
  /** 已登记账户，及本期已导入流水覆盖的区间（可以是多段，本函数自己合并）。 */
  readonly accounts: readonly {
    readonly accountRef: string;
    /** 本账户实际应覆盖的业务日；未限定时覆盖查询期间。 */
    readonly requiredRange?: DateRange;
    readonly coveredRanges: readonly DateRange[];
  }[];
  /** 本期挂不上任何事项、也未判为内部转账的流水。 */
  readonly unexplainedTransactionRefs: readonly string[];
  readonly linkedSettlementIssues?: readonly LinkedSettlementIssue[];
  readonly events: readonly {
    readonly eventRef: string;
    readonly eventKind: string;
    readonly evidenceRoles: readonly string[];
    /** 调用方按事实确认、唯一规则及本期有效分录判断；null 表示已处理或明确 skip。 */
    readonly postingIssue: EventPostingIssue | null;
    /**
     * 这笔要哪几类证据。给了就以它为准（调用方按命中的规则算出来的——同一形态在
     * 不同记法下要的证据不一样，「这一档不记」的传空数组）；不给就退到包里
     * eventKind 级的声明。
     */
    readonly requiredRoles?: readonly string[];
  }[];
  /**
   * 本期**逐凭证**的借贷合计，**分**为单位。
   *
   * 用 `bigint` 是因为「逐分相等」不容浮点误差；**逐凭证而不是期间合计**的理由见
   * `checkLedgerBalanced`。
   */
  readonly vouchers: readonly {
    readonly voucherRef: string;
    readonly debitMinor: bigint;
    readonly creditMinor: bigint;
  }[];
  readonly completedClosingItemIds: readonly string[];
  /** 企业事实，供 `closingItems.requiredWhen` 判定适用性。 */
  readonly entityFacts: Readonly<Record<string, string>>;
  readonly pack: Pick<
    AccountingPackPayload,
    'evidenceRequirements' | 'closingItems'
  >;
}

/**
 * 跑完六项。**六项全跑，不短路。**
 *
 * @returns 恒含六条结果，顺序恒为 `CLOSING_CHECK_IDS`
 */
export function runClosingChecks(input: ClosingCheckInput): ClosingCheckReport {
  const checks: ClosingCheckResult[] = [
    result('statement_complete', checkStatementComplete(input)),
    result('funds_explained', checkFundsExplained(input)),
    result('evidence_sufficient', checkEvidenceSufficient(input)),
    result('ledger_balanced', checkLedgerBalanced(input)),
    result('closing_items_done', checkClosingItemsDone(input)),
    result('previous_period_locked', checkPreviousPeriodLocked(input)),
  ];
  return { canClose: checks.every((c) => c.passed), checks };
}

function result(
  checkId: ClosingCheckId,
  blockers: ClosingBlocker[],
): ClosingCheckResult {
  return {
    checkId,
    passed: blockers.length === 0,
    responsibility: CLOSING_CHECK_RESPONSIBILITY[checkId],
    blockers,
  };
}

/** 1 流水完整：逐账户找出本期内没被任何一段覆盖的日子。 */
function checkStatementComplete(input: ClosingCheckInput): ClosingBlocker[] {
  const from = toDayIndex(input.periodRange.from);
  const to = toDayIndex(input.periodRange.to);
  if (to < from) {
    throw new RangeError('periodRange.to must not precede periodRange.from');
  }

  const blockers: ClosingBlocker[] = [];
  for (const account of input.accounts) {
    const accountFrom = Math.max(
      from,
      toDayIndex(account.requiredRange?.from ?? input.periodRange.from),
    );
    const accountTo = Math.min(
      to,
      toDayIndex(account.requiredRange?.to ?? input.periodRange.to),
    );
    if (accountFrom > accountTo) continue;
    const merged = mergeRanges(
      account.coveredRanges.map((r) => {
        const lo = toDayIndex(r.from);
        const hi = toDayIndex(r.to);
        if (hi < lo) {
          throw new RangeError(
            `coveredRange.to must not precede coveredRange.from for ${account.accountRef}`,
          );
        }
        return [lo, hi] as const;
      }),
    );

    let cursor = accountFrom;
    for (const [lo, hi] of merged) {
      if (lo > cursor) {
        blockers.push(
          gap(account.accountRef, cursor, Math.min(lo - 1, accountTo)),
        );
      }
      cursor = Math.max(cursor, hi + 1);
      if (cursor > accountTo) break;
    }
    if (cursor <= accountTo)
      blockers.push(gap(account.accountRef, cursor, accountTo));
  }
  return blockers;
}

function gap(accountRef: string, lo: number, hi: number): ClosingBlocker {
  return {
    kind: 'statement_gap',
    accountRef,
    from: fromDayIndex(lo),
    to: fromDayIndex(hi),
  };
}

/** 2 资金全解释。 */
function checkFundsExplained(input: ClosingCheckInput): ClosingBlocker[] {
  return [
    ...input.unexplainedTransactionRefs.map((transactionRef) => ({
      kind: 'unexplained_transaction' as const,
      transactionRef,
    })),
    ...(input.linkedSettlementIssues ?? []).map((issue) => ({
      kind: 'linked_transaction_unsettled' as const,
      ...issue,
    })),
  ];
}

/**
 * 3 证据齐。
 *
 * 包里没声明某个 `eventKind` 的证据要求时**不放行**——「没要求所以都满足」是静默
 * 通过，而这里挡住是可修的：补一条包声明即可。
 */
function checkEvidenceSufficient(input: ClosingCheckInput): ClosingBlocker[] {
  const required = new Map(
    input.pack.evidenceRequirements.map((r) => [r.eventKind, r.requiredRoles]),
  );
  const blockers: ClosingBlocker[] = [];

  for (const event of input.events) {
    const roles = event.requiredRoles ?? required.get(event.eventKind);
    if (roles === undefined) {
      blockers.push({
        kind: 'evidence_requirement_absent',
        eventRef: event.eventRef,
        eventKind: event.eventKind,
      });
      continue;
    }
    const have = new Set(event.evidenceRoles);
    const missingRoles = roles.filter((role) => !have.has(role));
    if (missingRoles.length > 0) {
      blockers.push({
        kind: 'evidence_missing',
        eventRef: event.eventRef,
        missingRoles,
      });
    }
  }
  return blockers;
}

/**
 * 4 分录平。**逐凭证**判定，逐分比较，没有"大致平"。
 *
 * ## 为什么不是期间合计（2026-08-15 订正，决策 D22）
 *
 * 本函数初版比的是本期借贷**合计**。那道检查看不见错：A 凭证多借 100、B 凭证多贷 100，
 * 期间合计照样严丝合缝，而两张凭证都是错的。会计上这叫 compensating error，净额检查
 * 结构性地看不见它。
 *
 * 而且期间合计本就不是会计的口径——会计要求的是**每一张凭证借贷平衡**。逐张平必然
 * 合计平，反之不成立，所以逐凭证严格强于合计。
 *
 * ## 这道检查的限度
 *
 * 它仍然发现不了"两张凭证各自都平、但科目挂错了"。**没有任何一道余额检查能证明账是
 * 对的**，它只能证明账不是明显坏的。那类错要靠证据链（第 3 项）与交叉校验去接。
 */
function checkLedgerBalanced(input: ClosingCheckInput): ClosingBlocker[] {
  const blockers: ClosingBlocker[] = input.events.flatMap((event) =>
    event.postingIssue === null
      ? []
      : [
          {
            kind: 'event_not_ready' as const,
            eventRef: event.eventRef,
            reason: event.postingIssue,
          },
        ],
  );
  for (const voucher of input.vouchers) {
    if (voucher.debitMinor !== voucher.creditMinor) {
      blockers.push({
        kind: 'voucher_unbalanced',
        voucherRef: voucher.voucherRef,
        debitMinor: voucher.debitMinor,
        creditMinor: voucher.creditMinor,
      });
    }
  }
  return blockers;
}

/**
 * 5 计提结转已做。
 *
 * 适用性看 `requiredWhen`：空数组 = 无条件必做；否则要求每个条件都命中企业事实。
 *
 * **事实缺失单独成一种卡点。**折旧要不要做取决于有没有固定资产；这条事实没登记
 * 时，既不能当"不用做"（漏计提），也不该报成"折旧没做"（对没有固定资产的公司
 * 是句莫名其妙的话）。报成「这项事实没登记」，挡住且可操作。
 */
function checkClosingItemsDone(input: ClosingCheckInput): ClosingBlocker[] {
  const done = new Set(input.completedClosingItemIds);
  const blockers: ClosingBlocker[] = [];

  for (const item of input.pack.closingItems) {
    const unknown = item.requiredWhen.find(
      (cond) => input.entityFacts[cond.factKey] === undefined,
    );
    if (unknown !== undefined) {
      blockers.push({
        kind: 'entity_fact_unknown',
        itemId: item.itemId,
        factKey: unknown.factKey,
      });
      continue;
    }
    const applies = item.requiredWhen.every(
      (cond) => input.entityFacts[cond.factKey] === cond.equals,
    );
    if (applies && !done.has(item.itemId)) {
      blockers.push({ kind: 'closing_item_pending', itemId: item.itemId });
    }
  }
  return blockers;
}

/** 6 上期已锁。第一个账期没有上期，放行。 */
function checkPreviousPeriodLocked(input: ClosingCheckInput): ClosingBlocker[] {
  const previous = input.previousPeriod;
  if (previous.kind === 'open') {
    return [{ kind: 'previous_period_open', periodKey: previous.periodKey }];
  }
  return [];
}

const MS_PER_DAY = 86_400_000;

/**
 * `YYYY-MM-DD` → 天序号。
 *
 * 回读比对是必要的：`Date.UTC` 会把 `2026-02-31` 悄悄折成 3 月 3 日，而一个错日期
 * 静默变成另一个日期，比直接报错难查得多。
 */
function toDayIndex(date: string): number {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!matched) {
    throw new RangeError(`date must be YYYY-MM-DD, got ${date}`);
  }
  const index = Math.floor(
    Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) /
      MS_PER_DAY,
  );
  if (fromDayIndex(index) !== date) {
    throw new RangeError(`date is not a real calendar day: ${date}`);
  }
  return index;
}

function fromDayIndex(index: number): string {
  return new Date(index * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 合并重叠或相邻的闭区间。相邻指前一段的次日就是后一段起点。 */
function mergeRanges(
  ranges: readonly (readonly [number, number])[],
): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && lo <= last[1] + 1) {
      last[1] = Math.max(last[1], hi);
    } else {
      merged.push([lo, hi]);
    }
  }
  return merged;
}
