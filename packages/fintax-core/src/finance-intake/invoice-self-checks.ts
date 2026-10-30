// 来源：moneycome harness/src/finance-intake/invoice-self-checks.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 一张票**自己跟自己**对不对得上。
 *
 * @runtime-status 纯函数，输入抽取结果，输出异常清单。识别服务把它的结果原样
 * 带进返回，不重算。
 *
 * 这是五层交叉校验（`docs/modules/fintax-accounting-slice-14` §4.4）的第二层
 * 自洽层：不查库、不看别的票、不问模型，只用这张票上印着的几个数互相验证。
 * 第一层结构（位数、格式）也在这里，因为它同样只需要票面本身。
 * 跨源（票 vs 流水）、跨期、下游三层要读库，不在本文件。
 *
 * ## 为什么校验结果要塞进识别返回，而不是让模型自己算
 *
 * 让模型「读完票再算一下税额对不对」，等于把一次算术押在生成上。这类徒手加工
 * 是错误的集中来源——同样的教训在 `航司主控/revenue-agent` 的 `analysis/tools.py`
 * `_census` 里有取证：错误几乎全部产生在「数据到手之后、写正文之前」的数行、
 * 挑行、扫极值。那边的解法是把统计直接印进工具返回，**抄比数便宜**。这里同理：
 * 校验由确定性函数算完印在返回里，模型只需要读，不需要算。
 *
 * ## 四种结论必须分开
 *
 * 与 `finance-onboarding/opening-balance.contract.ts` 同一套词，不另起：
 * `failed` 是「数对不上，这张票有问题」，`insufficient` 是「少一个数，算不了」，
 * `notApplicable` 是「这张票本来就没这一项」。三者混成一个「不通过」，产品上
 * 就分不清该让人**改**、去**补**、还是**不用管**。
 */

import { Prisma } from '../shims/prisma-client.js';
import { parseChineseAmountToCents } from './chinese-amount.js';
import {
  fieldValue,
  type InvoiceExtractedFacts,
  type InvoiceField,
} from './invoice-facts.contract.js';

export const INVOICE_SELF_CHECKS = [
  /** 不含税金额 + 税额 = 价税合计。 */
  'amountIdentity',
  /** 税额 = 不含税金额 × 税率。 */
  'taxRateConsistency',
  /** 大写金额 = 小写价税合计。 */
  'wordsMatchDigits',
  /** 发票号码位数合规。 */
  'invoiceNumberShape',
  /** 开票日期是真日期。 */
  'issueDateShape',
  /** 购销双方纳税人识别号位数合规。 */
  'taxIdShape',
] as const;

export type InvoiceSelfCheck = (typeof INVOICE_SELF_CHECKS)[number];

export type InvoiceSelfCheckStatus =
  | 'passed'
  | 'failed'
  | 'insufficient'
  | 'notApplicable';

export interface InvoiceSelfCheckResult {
  readonly check: InvoiceSelfCheck;
  readonly status: InvoiceSelfCheckStatus;
  /**
   * 人能直接照着核的信息：差多少、哪两个数对不上。
   *
   * 只放这张票面上的数，不放正文、不放存储引用。
   */
  readonly detail?: Record<string, unknown>;
  /**
   * 一句白话，前台和老板面直接显示。
   *
   * 不出现「进项税额」「价税分离」这类词——交接包红线第 5 条：前台界面出现
   * 任何财务名词即 bug。这里写的是「票上这两个数加起来对不上合计」。
   */
  readonly plainText?: string;
}

/** 税额舍入允许的分差。价税分离按四舍五入，一分的偏差是正常的。 */
const TAX_ROUNDING_TOLERANCE_CENTS = 1;
// 金额与税率的有效位乘积可超过默认精度；局部设置，不改变其他模块。
const TaxDecimal = Prisma.Decimal.clone({ precision: 40 });

/**
 * 号码位数规则。
 *
 * ⚠️ **这两组数字是领域知识，按三分法（`10 §一`：规则进包）应当由 L2 领域
 * 规则包提供，不该长期留在引擎侧。** 现在留在这里是因为包契约
 * （`finance-ledger/accounting-pack.contract.ts`）还在另一条分支上，跨分支引用
 * 会引入一个合不了的依赖。两支合流时应把它们迁进包的形状规则段，本文件改为
 * 从包读——届时 A1 零领域常量扫描的目录列表也该把 `src/finance-intake` 加进去。
 *
 * 在此之前，把债写在这里而不是让它隐形：位数规则会变（全电发票推广、
 * 其他地区主体），写死在校验算法里的那天，改一次要动引擎。
 *
 * 发票号码：全电发票 20 位、旧版 8 位。位数不对不一定是假票（可能是识别串了
 * 位），所以判 `failed` 的措辞是「对不上」，由人去看原件定性——这一层不做
 * 真伪判定，那要查验平台。
 *
 * 纳税人识别号：15 位（老税务登记证号）、17/18 位（统一社会信用代码）、
 * 20 位（部分特殊主体）。自然人购方填身份证号也是 18 位，同样落在合法集内。
 */
const INVOICE_NUMBER_LENGTHS = new Set([8, 20]);
const TAX_ID_LENGTHS = new Set([15, 17, 18, 20]);

/**
 * 这六项的适用前提：这张材料是发票。
 *
 * 六项全是**发票纸面上的恒等式**——价税恒等、税率一致、大小写一致、发票号码
 * 位数、开票日期、纳税人识别号位数。收据没有发票号码栏也没有税额栏，出租车
 * 票连购买方都不印，餐票、行程单同理。拿这把尺子去量它们，量出来的是尺子不
 * 合用，不是票有问题：2026-08-16 的 44 张真跑里，14 张收据全部被 `6 位单据号`
 * 判成 `invoiceNumberShape` 失败。
 *
 * 材料种类在上传那一刻就知道（`FinMaterial.materialKind`），所以这不是领域
 * 判断，是校验自己的适用前提。不是发票 → 六项全 `notApplicable`：
 *
 * - 不是 skip：结论列表少了几项，下游分不清「没这一项」和「漏跑了」；
 * - 不是 passed：一张收据「通过了发票的价税恒等」是假的通过，会让人以为核过了。
 *
 * 要素照抄不受影响——票面上有什么仍然逐项读出来，只是不拿发票的恒等式量它。
 */
const INVOICE_MATERIAL_KIND = 'invoice';

/**
 * 跑完全部自洽校验。
 *
 * 顺序即呈现顺序：先金额（错了最要紧），再身份，最后格式。
 *
 * @param materialKind 这张材料是什么（`FinMaterial.materialKind`）。不是
 * `invoice` 就整组 `notApplicable`，理由见上。
 */
export function runInvoiceSelfChecks(
  facts: InvoiceExtractedFacts,
  materialKind: string,
): readonly InvoiceSelfCheckResult[] {
  if (materialKind !== INVOICE_MATERIAL_KIND) {
    return INVOICE_SELF_CHECKS.map((check) => ({
      check,
      status: 'notApplicable' as const,
      plainText: '这张不是发票，发票才有的那几项核对用不上',
    }));
  }
  if (
    [
      facts.amountExclTaxCents,
      facts.taxAmountCents,
      facts.totalInclTaxCents,
    ].some(
      (field) =>
        field.state === 'present' && !Number.isSafeInteger(field.value),
    )
  ) {
    return [
      {
        check: 'amountIdentity',
        status: 'failed',
        plainText: '材料上的金额需要重新核对，请查看原件。',
      },
      { check: 'taxRateConsistency', status: 'insufficient' },
      { check: 'wordsMatchDigits', status: 'insufficient' },
      checkInvoiceNumberShape(facts),
      checkIssueDateShape(facts),
      checkTaxIdShape(facts),
    ];
  }
  return [
    checkAmountIdentity(facts),
    checkTaxRateConsistency(facts),
    checkWordsMatchDigits(facts),
    checkInvoiceNumberShape(facts),
    checkIssueDateShape(facts),
    checkTaxIdShape(facts),
  ];
}

/** 任何一项判 `failed` 都不能静默入账。`insufficient` 是等补，不是拦。 */
export function hasBlockingSelfCheckFailure(
  results: readonly InvoiceSelfCheckResult[],
): boolean {
  return results.some((r) => r.status === 'failed');
}

function checkAmountIdentity(
  facts: InvoiceExtractedFacts,
): InvoiceSelfCheckResult {
  const exclTax = fieldValue(facts.amountExclTaxCents);
  const tax = fieldValue(facts.taxAmountCents);
  const total = fieldValue(facts.totalInclTaxCents);
  if (exclTax === undefined || tax === undefined || total === undefined) {
    return {
      check: 'amountIdentity',
      status: 'insufficient',
      detail: missingDetail({
        amountExclTaxCents: facts.amountExclTaxCents,
        taxAmountCents: facts.taxAmountCents,
        totalInclTaxCents: facts.totalInclTaxCents,
      }),
      plainText: '票上少一个数，这三个数加不起来，得看一眼原件。',
    };
  }
  const diff = BigInt(exclTax) + BigInt(tax) - BigInt(total);
  if (diff === 0n) return { check: 'amountIdentity', status: 'passed' };
  return {
    check: 'amountIdentity',
    status: 'failed',
    detail: {
      amountExclTaxCents: exclTax,
      taxAmountCents: tax,
      totalInclTaxCents: total,
      diffCents: Number.isSafeInteger(Number(diff))
        ? Number(diff)
        : String(diff),
    },
    plainText: `票上两个数加起来跟合计差 ${formatCents(diff < 0n ? -diff : diff)}。`,
  };
}

function checkTaxRateConsistency(
  facts: InvoiceExtractedFacts,
): InvoiceSelfCheckResult {
  // 免税、不征税的票没有税率栏，那是这张票本来的样子，不是缺材料。
  if (facts.taxRate.state === 'absent') {
    return { check: 'taxRateConsistency', status: 'notApplicable' };
  }
  const rate = fieldValue(facts.taxRate);
  const exclTax = fieldValue(facts.amountExclTaxCents);
  const tax = fieldValue(facts.taxAmountCents);
  if (
    rate === undefined ||
    !Number.isFinite(rate) ||
    rate < 0 ||
    rate > 1 ||
    exclTax === undefined ||
    tax === undefined
  ) {
    return {
      check: 'taxRateConsistency',
      status: 'insufficient',
      detail: missingDetail({
        taxRate: facts.taxRate,
        amountExclTaxCents: facts.amountExclTaxCents,
        taxAmountCents: facts.taxAmountCents,
      }),
      plainText: '票上少一个数，这一项算不了。',
    };
  }
  const expected = new TaxDecimal(exclTax)
    .mul(rate)
    .toDecimalPlaces(0, TaxDecimal.ROUND_HALF_CEIL)
    .toNumber();
  const diff = BigInt(tax) - BigInt(expected);
  if (
    diff >= -BigInt(TAX_ROUNDING_TOLERANCE_CENTS) &&
    diff <= BigInt(TAX_ROUNDING_TOLERANCE_CENTS)
  ) {
    return { check: 'taxRateConsistency', status: 'passed' };
  }
  return {
    check: 'taxRateConsistency',
    status: 'failed',
    detail: {
      taxRate: rate,
      amountExclTaxCents: exclTax,
      taxAmountCents: tax,
      expectedCents: expected,
      diffCents: Number.isSafeInteger(Number(diff))
        ? Number(diff)
        : String(diff),
    },
    plainText: `按票上的比例算，这一栏应该是 ${formatCents(expected)}，票上写的是 ${formatCents(tax)}。`,
  };
}

function checkWordsMatchDigits(
  facts: InvoiceExtractedFacts,
): InvoiceSelfCheckResult {
  const words = fieldValue(facts.totalInWords);
  const total = fieldValue(facts.totalInclTaxCents);
  if (words === undefined || total === undefined) {
    return {
      check: 'wordsMatchDigits',
      status: 'insufficient',
      detail: missingDetail({
        totalInWords: facts.totalInWords,
        totalInclTaxCents: facts.totalInclTaxCents,
      }),
      plainText: '大小写有一个没读出来，对不上。',
    };
  }
  const parsed = parseChineseAmountToCents(words);
  if (parsed === undefined) {
    // 解析不了就说解析不了，绝不退化成「按小写算」——退化的那一刻这条校验
    // 就等于没有。
    return {
      check: 'wordsMatchDigits',
      status: 'insufficient',
      detail: { totalInWords: words },
      plainText: '大写这一行没认全，得看一眼原件。',
    };
  }
  if (parsed === total) return { check: 'wordsMatchDigits', status: 'passed' };
  return {
    check: 'wordsMatchDigits',
    status: 'failed',
    detail: { totalInWords: words, wordsCents: parsed, digitsCents: total },
    plainText: `大写写的是 ${formatCents(parsed)}，小写写的是 ${formatCents(total)}，两个对不上。`,
  };
}

function checkInvoiceNumberShape(
  facts: InvoiceExtractedFacts,
): InvoiceSelfCheckResult {
  const number = fieldValue(facts.invoiceNumber);
  if (number === undefined) {
    return {
      check: 'invoiceNumberShape',
      status: 'insufficient',
      detail: missingDetail({ invoiceNumber: facts.invoiceNumber }),
      plainText: '发票号码没读出来。',
    };
  }
  if (!/^\d+$/.test(number)) {
    return {
      check: 'invoiceNumberShape',
      status: 'failed',
      detail: { invoiceNumber: number },
      plainText: '发票号码里有不是数字的字符，可能认串了。',
    };
  }
  if (!INVOICE_NUMBER_LENGTHS.has(number.length)) {
    return {
      check: 'invoiceNumberShape',
      status: 'failed',
      detail: { invoiceNumber: number, length: number.length },
      plainText: `发票号码是 ${number.length} 位，正常是 8 位或 20 位。`,
    };
  }
  return { check: 'invoiceNumberShape', status: 'passed' };
}

function checkIssueDateShape(
  facts: InvoiceExtractedFacts,
): InvoiceSelfCheckResult {
  const raw = fieldValue(facts.issueDate);
  if (raw === undefined) {
    return {
      check: 'issueDateShape',
      status: 'insufficient',
      detail: missingDetail({ issueDate: facts.issueDate }),
      plainText: '开票日期没读出来。',
    };
  }
  if (!isCalendarDate(raw)) {
    return {
      check: 'issueDateShape',
      status: 'failed',
      detail: { issueDate: raw },
      plainText: `开票日期读成了「${raw}」，这不是一个日期。`,
    };
  }
  return { check: 'issueDateShape', status: 'passed' };
}

function checkTaxIdShape(facts: InvoiceExtractedFacts): InvoiceSelfCheckResult {
  const offenders: Record<string, unknown> = {};
  let sawAny = false;
  for (const key of ['sellerTaxId', 'buyerTaxId'] as const) {
    const value = fieldValue(facts[key]);
    if (value === undefined) continue;
    sawAny = true;
    if (!TAX_ID_LENGTHS.has(value.length)) {
      offenders[key] = { value, length: value.length };
    }
  }
  if (!sawAny) {
    return {
      check: 'taxIdShape',
      status: 'insufficient',
      detail: missingDetail({
        sellerTaxId: facts.sellerTaxId,
        buyerTaxId: facts.buyerTaxId,
      }),
      plainText: '双方的税号都没读出来。',
    };
  }
  if (Object.keys(offenders).length === 0) {
    return { check: 'taxIdShape', status: 'passed' };
  }
  return {
    check: 'taxIdShape',
    status: 'failed',
    detail: offenders,
    plainText: '税号位数不对，可能认串了，得看一眼原件。',
  };
}

/**
 * 判真实日历日，不只判格式。
 *
 * `2026-02-30` 形状是对的但那天不存在。`new Date` 会把它悄悄滚成 3 月 2 日——
 * 正是那种「看起来通过了」的静默兜底，所以要把回读的年月日跟输入逐个比。
 */
function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() + 1 === Number(mo) &&
    date.getUTCDate() === Number(d)
  );
}

/** 把「哪几项没读到、为什么」摊平进 detail，人一眼看到该去看原件的哪一格。 */
function missingDetail(
  fields: Readonly<Record<string, InvoiceField<unknown>>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.state === 'present') continue;
    out[key] = field.reason
      ? { state: field.state, reason: field.reason }
      : { state: field.state };
  }
  return out;
}

/** 分 → 「¥1,234.56」。给人看的，不参与任何判定。 */
function formatCents(cents: number | bigint): string {
  if (typeof cents === 'number' && !Number.isSafeInteger(cents))
    return '待核对';
  const exact = BigInt(cents);
  const sign = exact < 0n ? '-' : '';
  const abs = exact < 0n ? -exact : exact;
  const yuan = abs / 100n;
  const rest = String(abs % 100n).padStart(2, '0');
  return `${sign}¥${yuan.toLocaleString('zh-CN')}.${rest}`;
}
