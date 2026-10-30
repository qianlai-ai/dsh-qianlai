// 来源：moneycome harness/src/finance-onboarding/opening-balance.contract.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 期初提交与核验的契约（`docs/modules/fintax-accounting-slice-v1.md` §3、
 * 开发计划 B2 交付物 2.6）。
 *
 * @runtime-status 已接线：入口是
 * `POST /api/internal/fintax/onboarding/opening-balance`
 * （`OpeningBalanceIngressController`）。
 *
 * 本层不含任何领域知识：没有税种、没有科目目录、没有地区。四项核验是
 * 4.9 §8.12 的平台级要求，对任何行业的任何主体都一样；随行业变化的检查项
 * 将来由 L2 领域规则包追加，不写进这里。由架构验收 A1 机器判定。
 *
 * 金额一律走「分」的整数运算。会计的借贷平衡是精确判定，差一分就是不平；
 * 浮点在这里没有容身之地——`0.1 + 0.2 !== 0.3` 会让一张平的表被判成不平。
 * 仓内已有先例：`model-provider/provider-spend-ledger.store.ts` 用整数
 * micros 承载 `Decimal(18,6)`。
 */

/** 四项核验。与 4.9 §8.12 一一对应，顺序即呈现顺序。 */
export const OPENING_BALANCE_CHECKS = [
  /** 账表关系：借方合计 = 贷方合计。 */
  'ledgerBalance',
  /** 银行余额：各资金账户的期初金额与其对账单期末余额一致。 */
  'bankBalance',
  /** 余额衔接：期初 + 本期发生 = 期末。提交时无「本期」，故此时不适用。 */
  'carryForward',
  /** 累计申报数据：上期累计数是否齐备，缺则本期算不出累计口径。 */
  'priorCumulativeFiling',
] as const;

export type OpeningBalanceCheck = (typeof OPENING_BALANCE_CHECKS)[number];

/**
 * 单项核验结论。
 *
 * `insufficient` 与 `failed` 必须分开：前者是「你还没给我材料」，允许暂存后
 * 补齐；后者是「你给的数不对」，必须改。合并成一个「不通过」，产品上就没法
 * 区分「等用户补」和「让用户改」。
 */
export type OpeningBalanceCheckStatus =
  | 'passed'
  | 'failed'
  | 'insufficient'
  | 'notApplicable';

export interface OpeningBalanceCheckResult {
  readonly check: OpeningBalanceCheck;
  readonly status: OpeningBalanceCheckStatus;
  /** 人能直接照着改的信息：差多少、差在哪个账户。不含正文与凭据。 */
  readonly detail?: Record<string, unknown>;
}

/**
 * 整体结论。
 *
 * `incomplete` 不是 `FinOpeningBalance.state` 的取值——它映射到 `verifying`，
 * 表示「核验跑过了，但缺材料，等补」。见 `resolveOpeningBalanceState`。
 */
export type OpeningBalanceVerdict = 'verified' | 'rejected' | 'incomplete';

export interface OpeningBalanceVerification {
  readonly verdict: OpeningBalanceVerdict;
  readonly checks: readonly OpeningBalanceCheckResult[];
}

export interface OpeningBalanceEntryInput {
  /** 运行时从领域规则包查出的值，不是本层的字面量。 */
  readonly subjectCode: string;
  readonly subjectName: string;
  /** 十进制字符串，最多两位小数。不收 number——浮点进不来。 */
  readonly debitAmount: string;
  readonly creditAmount: string;
  readonly partyAccountId?: string | null;
  readonly accountId?: string | null;
}

/** 某资金账户对账单的期末余额，由提交人从核验材料上抄来。 */
export interface AccountStatementBalanceInput {
  readonly accountId: string;
  readonly closingBalance: string;
  readonly statementMaterialId?: string | null;
}

export interface OpeningBalanceSubmission {
  readonly asOfDate: Date;
  readonly entries: readonly OpeningBalanceEntryInput[];
  readonly accountStatementBalances: readonly AccountStatementBalanceInput[];
  /**
   * 上期累计申报数据是否齐备。缺失不阻断提交，但本期累计口径算不出来，
   * 核验标 `insufficient`（`06` §4.3 的 N3）。
   */
  readonly priorCumulativeFilingProvided: boolean;
  readonly verificationMaterialIds: readonly string[];
}

export const OPENING_BALANCE_ERROR_CODES = {
  amountInvalid: 'FIN_OPENING_BALANCE_AMOUNT_INVALID',
  entriesEmpty: 'FIN_OPENING_BALANCE_ENTRIES_EMPTY',
  entryInvalid: 'FIN_OPENING_BALANCE_ENTRY_INVALID',
  notFound: 'FIN_OPENING_BALANCE_NOT_FOUND',
  notVerified: 'FIN_OPENING_BALANCE_NOT_VERIFIED',
  alreadyFinal: 'FIN_OPENING_BALANCE_ALREADY_FINAL',
  accountUnknown: 'FIN_OPENING_BALANCE_ACCOUNT_UNKNOWN',
} as const;

/** 金额字符串 → 分。拒绝一切拿不准的写法，绝不猜。 */
export function parseAmountToCents(raw: string): bigint | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const cents =
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}

/** 分 → 金额字符串。回给人看的差额走这里，保持与入参同形。 */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** 核验结论 → `FinOpeningBalance.state` 的取值。 */
export function resolveOpeningBalanceState(
  verdict: OpeningBalanceVerdict,
): 'verified' | 'rejected' | 'verifying' {
  if (verdict === 'verified') return 'verified';
  if (verdict === 'rejected') return 'rejected';
  return 'verifying';
}

/**
 * 挡住启用的项：**只有 `failed`**。
 *
 * 入驻那一段叫「上手时的家底」，副标题是「不知道就先估」——刚接手的老板本来
 * 就不知道上一家代账留下的账套长什么样，历史账套要等前台去要回来。要求四项
 * 全过才准启用，等于让入驻卡在一件当天办不完的事上。
 *
 * 所以两类不通过必须分开对待：
 *   - `failed`      数不对（借贷不平、银行余额对不上）。放行会让后面每一笔账
 *                   都建在一个错的基数上，且越往后越查不出来——拒。
 *   - `insufficient` 材料还没到（没有对账单、没有上期累计申报）。这正是「先估」
 *                   的那部分，放行，把待补项挂出来，材料回来再校准。
 *
 * `notApplicable` 不挡：余额衔接在提交时本来就无从判断。
 */
export function blockingOpeningBalanceChecks(
  verification: OpeningBalanceVerification | null,
): readonly OpeningBalanceCheck[] {
  return (verification?.checks ?? [])
    .filter((check) => check.status === 'failed')
    .map((check) => check.check);
}

/** 允许带着启用、但要挂在待补清单上的项。 */
export function pendingOpeningBalanceChecks(
  verification: OpeningBalanceVerification | null,
): readonly OpeningBalanceCheck[] {
  return (verification?.checks ?? [])
    .filter((check) => check.status === 'insufficient')
    .map((check) => check.check);
}
