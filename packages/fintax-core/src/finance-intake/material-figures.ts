// 来源：moneycome harness/src/finance-intake/material-figures.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 材料上的「数」——识别要素里能直接照抄进事项的那几项。
 *
 * 识别（`InvoiceExtractedFacts`）说的是票面上有什么，逐项三态；事项要的是
 * 「这笔业务的哪个数是多少」，按 `FinEventAmount.amountSource` 命名。这里做的
 * 只是把前者**照抄**成后者：分转元、字段名换成来源名。不算、不补、不猜——
 * 读不出的字段就不在返回里，让调用方看得见缺了什么。
 *
 * 来源名是包与写侧之间的词表（见 schema `FinEventAmount.amountSource` 注释）：
 * 包里分录腿写 `invoice_total`，就取这里 `invoice_total` 那个数。词表**不含**任何
 * 科目、税种、地区——A1 零领域常量扫描覆盖本目录。
 */

import {
  fieldValue,
  type InvoiceExtractedFacts,
} from './invoice-facts.contract.js';

/** 事项金额来源名（`FinEventAmount.amountSource`）。 */
export const AMOUNT_SOURCES = {
  invoiceTotal: 'invoice_total',
  invoiceNet: 'invoice_net',
  invoiceTax: 'invoice_tax',
  settlement: 'settlement',
  contract: 'contract',
  /**
   * 应付职工薪酬总额：**实发 + 全部代扣项**，含补贴与津贴。
   *
   * 口径写死在这里，是因为工资表长什么样各家不同：有的把补贴并进「应发」一列，
   * 有的像样本 2026Q1 那样单列一列。取哪一列由读表的人（或模型）决定，而
   * 「取错了」是静默的——直到那一笔的借贷不平才暴露。所以判据是恒等式而不是列名：
   * `payroll_gross = payroll_net + 全部代扣项`（代扣项由包声明哪几项，本包是个人
   * 社保、代扣税款、个人公积金）。这条恒等式不需要另写检查，它就是 `rule.payroll.*`
   * 借贷两边，出分录时自然校验。
   */
  payrollGross: 'payroll_gross',
  /**
   * 应发工资按岗位类别分开的三个数。**和必须等于 `payroll_gross`**——它们是同一笔
   * 工资的三条借方腿，贷方是总额，引擎的借贷相等当场校验，不用另写守卫。
   *
   * 为什么拆的是「数」而不是「事实」：分摊要决定的是借方走哪几个科目、各多少钱。
   * 若做成一个事实（比如「这个月工资算什么」），缺它时 `matchRule` 零命中 →
   * 把关理由是 `pack_unrecognized` → 界面上写「当前版本还答不了，请把这笔交给
   * 负责人处理」，等于每个月的工资分录卡死。做成三个数，缺它时是
   * `LEDGER_AMOUNT_SOURCE_MISSING` → `missing_amount` → 前台填得进去。
   *
   * 名字用工资表上的**岗位类别**，不是会计科目名：岗位是材料上印着的那一列，
   * 科目是每份包各自声明的领域知识（岗位→科目的映射在包的 `legs.csv` 里）。
   */
  payrollGrossDelivery: 'payroll_gross_delivery',
  payrollGrossAdmin: 'payroll_gross_admin',
  payrollGrossSelling: 'payroll_gross_selling',
  payrollNet: 'payroll_net',
  payrollPersonalSocial: 'payroll_personal_social',
  payrollCompanySocial: 'payroll_company_social',
  /**
   * 工资表上从个人工资里代扣走的那笔税（在中国大陆即个人所得税）。
   *
   * **没有它，工资那笔只在代扣税为零时才平**——而「恰好为零」正是样本 2026Q1 的
   * 情形（六个人应发减个人社保恰好等于实发），于是这一格空了很久没人发现：
   * 40 条规则里没有一条用到申报表上那个科目，而那个科目在科目表和资产负债表行里
   * 都好好声明着。
   *
   * 给人看的名字写「代扣的税款」而不是税种名：税种是每份包各自声明的领域知识
   * （A1 零领域常量扫描正是为拦这个而设），这里只说材料上那一栏是什么钱。
   */
  payrollPersonalTax: 'payroll_personal_tax',
  /**
   * 工资表上住房公积金那两栏：从个人工资里扣走的一份，单位另外配的一份。
   *
   * 与社保同形、同来源（都是工资表上印着的列），所以名字也照社保那两个写。
   * 不缴或缓缴的公司这两个数是 `0.00`——**答一个零就过去了**，比「包里没有这条
   * 规则」那条死路好走得多，这也是它做成金额而不是事实的原因。
   */
  housingFundPersonal: 'housing_fund_personal',
  housingFundCompany: 'housing_fund_company',
  /** 没有材料可照抄、由人或模型声明的数。带它的事项要人把关。 */
  declared: 'declared',
  currentPeriodAccrual: 'current_period_accrual',
  allocationDelivery: 'allocation_delivery',
  allocationAdmin: 'allocation_admin',
  allocationSelling: 'allocation_selling',
  allocationProduction: 'allocation_production',
  allocationResearch: 'allocation_research',
  allocationDevelopment: 'allocation_development',
  allocationConstruction: 'allocation_construction',
} as const;

export type AmountSource = (typeof AMOUNT_SOURCES)[keyof typeof AMOUNT_SOURCES];

export const KNOWN_AMOUNT_SOURCES: ReadonlySet<string> = new Set(
  Object.values(AMOUNT_SOURCES),
);

/**
 * 同一份词表的中文名，给要人看的句子用（把关理由、待办卡）。
 *
 * 与上面的词表同一处，不另立一份：分开写，加一个来源名时另一处不会跟着改，而
 * 漏掉的那格会以 `invoice_total` 的形状出现在老板屏幕上。写的都是材料上印着的
 * 那几个字（发票的价税合计、工资表的应发实发），不是会计科目名。
 *
 * 这张表能放在代码里，是因为来源名本身就是代码的闭集（`KNOWN_AMOUNT_SOURCES`
 * 在写入前拦掉不认识的）。业务形态不一样——那是每份包各自声明的，名字只能进包。
 */
const AMOUNT_SOURCE_NAMES: Readonly<Record<AmountSource, string>> = {
  [AMOUNT_SOURCES.invoiceTotal]: '发票价税合计',
  [AMOUNT_SOURCES.invoiceNet]: '发票不含税金额',
  [AMOUNT_SOURCES.invoiceTax]: '发票税额',
  [AMOUNT_SOURCES.settlement]: '实际收付的钱',
  [AMOUNT_SOURCES.contract]: '合同金额',
  [AMOUNT_SOURCES.payrollGross]: '应发工资（含补贴津贴）',
  [AMOUNT_SOURCES.payrollGrossDelivery]: '交付岗位的应发工资',
  [AMOUNT_SOURCES.payrollGrossAdmin]: '行政管理岗位的应发工资',
  [AMOUNT_SOURCES.payrollGrossSelling]: '销售岗位的应发工资',
  [AMOUNT_SOURCES.payrollNet]: '实发工资',
  [AMOUNT_SOURCES.payrollPersonalSocial]: '个人承担的社保',
  [AMOUNT_SOURCES.payrollCompanySocial]: '单位承担的社保',
  [AMOUNT_SOURCES.payrollPersonalTax]: '代扣的税款',
  [AMOUNT_SOURCES.housingFundPersonal]: '个人承担的住房公积金',
  [AMOUNT_SOURCES.housingFundCompany]: '单位承担的住房公积金',
  [AMOUNT_SOURCES.declared]: '人报的数',
  [AMOUNT_SOURCES.currentPeriodAccrual]: '本期新增计提额（已扣除此前计提）',
  [AMOUNT_SOURCES.allocationDelivery]: '本笔分配给交付业务的金额',
  [AMOUNT_SOURCES.allocationAdmin]: '本笔分配给行政管理的金额',
  [AMOUNT_SOURCES.allocationSelling]: '本笔分配给销售的金额',
  [AMOUNT_SOURCES.allocationProduction]: '本笔分配给生产的金额',
  [AMOUNT_SOURCES.allocationResearch]: '本笔分配给研究费用的金额',
  [AMOUNT_SOURCES.allocationDevelopment]:
    '本笔分配给符合资本化条件开发项目的金额',
  [AMOUNT_SOURCES.allocationConstruction]: '本笔分配给在建工程的金额',
};

/**
 * 来源名 → 给人看的名字。认不出的来源回一句诚实的话，**不回落成来源名本身**：
 * 老板拿 `invoice_total` 没有任何用途，而印出来会让他以为界面坏了。
 */
export function amountSourceName(source: string): string {
  return AMOUNT_SOURCE_NAMES[source as AmountSource] ?? '这笔的另一个数';
}

/**
 * 中文名 → 来源名。把关理由里写的是中文名（`declaredAmountsNote`），而人要认下
 * 某个数时，写侧收的是来源名——这一步把话翻回去。
 *
 * 认不出回 `undefined`，**不猜**：认不出的名字多半来自 `amountSourceName` 的兜底
 * 那句（同一句话对应任意多个未知来源），猜一个回去等于让人认下一个他没看见的数。
 */
/**
 * 退役过的中文名 → 来源名。
 *
 * 改一个数的中文名会让**已经写进库里的把关理由**再也翻不回来：那句话逐字存在
 * `reviewNote` 里，不回填。翻不回来的后果是静默的——「这个数我认」那个入口从此
 * 不再出现，没有任何报错。所以每退役一个写法就在这里留一行，别删。
 */
const RETIRED_AMOUNT_SOURCE_NAMES: Readonly<Record<string, string>> = {
  // 2026-08-25：补上「含补贴津贴」，因为样本二月的补贴没人知道该不该算进去。
  应发工资: AMOUNT_SOURCES.payrollGross,
};

export function amountSourceOf(name: string): string | undefined {
  const retired = RETIRED_AMOUNT_SOURCE_NAMES[name];
  if (retired !== undefined) return retired;
  return Object.entries(AMOUNT_SOURCE_NAMES).find(
    ([, chinese]) => chinese === name,
  )?.[0];
}

export interface MaterialFigures {
  /** 来源名 → 两位小数的元。只含读得出的。 */
  readonly amounts: Readonly<Record<string, string>>;
  /** 材料上的日期（开票日等），YYYY-MM-DD。 */
  readonly date?: string;
  /** 材料上出现的当事方名称（买卖双方等），供核对对方名称用。 */
  readonly parties: readonly string[];
  /** 识别要素是哪种形状。 */
  readonly shape: 'invoice';
}

/**
 * 从 `FinMaterial.extractedFactsJson` 读出数。认不出形状返回 undefined——
 * 不是所有材料都有识别要素（回单、合同现在还没有识别器）。
 */
export function readMaterialFigures(raw: unknown): MaterialFigures | undefined {
  if (!looksLikeInvoiceFacts(raw)) return undefined;
  const facts = raw as InvoiceExtractedFacts;
  const amounts: Record<string, string> = {};
  const total = fieldValue(facts.totalInclTaxCents);
  const net = fieldValue(facts.amountExclTaxCents);
  const tax = fieldValue(facts.taxAmountCents);
  if (isCents(total)) amounts[AMOUNT_SOURCES.invoiceTotal] = centsToYuan(total);
  if (isCents(net)) amounts[AMOUNT_SOURCES.invoiceNet] = centsToYuan(net);
  if (isCents(tax)) amounts[AMOUNT_SOURCES.invoiceTax] = centsToYuan(tax);
  const parties = [
    fieldValue(facts.sellerName),
    fieldValue(facts.buyerName),
  ].filter((name): name is string => typeof name === 'string' && name !== '');
  const date = fieldValue(facts.issueDate);
  return {
    amounts,
    ...(typeof date === 'string' ? { date } : {}),
    parties,
    shape: 'invoice',
  };
}

/** 一眼能认的发票识别形状：三个金额字段都是三态对象。 */
export function looksLikeInvoiceFacts(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  return ['totalInclTaxCents', 'amountExclTaxCents', 'taxAmountCents'].every(
    (key) => {
      const field = record[key];
      return (
        typeof field === 'object' &&
        field !== null &&
        typeof (field as { state?: unknown }).state === 'string'
      );
    },
  );
}

/**
 * 识别要素里前台看不到的字段：票面三个数与大写金额。读材料（读侧）与读发票
 * （intake）对前台档共用这一份，判据只写在这里。
 */
export const INVOICE_FACT_FIELDS_HIDDEN_FROM_EMPLOYEE: readonly (keyof InvoiceExtractedFacts)[] =
  ['amountExclTaxCents', 'taxAmountCents', 'totalInclTaxCents', 'totalInWords'];

/**
 * 把识别要素投影给前台：去掉票面金额字段并列出去掉了哪些。认不出形状的要素整个
 * 不给（`facts: null, hidden: ['*']`）——宁可少给。null / undefined 原样透传。
 */
export function projectInvoiceFactsForEmployee(raw: unknown): {
  readonly facts: unknown;
  readonly hidden: readonly string[];
} {
  if (raw === null || raw === undefined) return { facts: null, hidden: [] };
  if (!looksLikeInvoiceFacts(raw)) return { facts: null, hidden: ['*'] };
  const projected: Record<string, unknown> = {
    ...(raw as Record<string, unknown>),
  };
  const hidden: string[] = [];
  for (const field of INVOICE_FACT_FIELDS_HIDDEN_FROM_EMPLOYEE) {
    if (field in projected) {
      delete projected[field];
      hidden.push(field);
    }
  }
  return { facts: projected, hidden };
}

function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function centsToYuan(cents: number): string {
  const yuan = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${yuan}.${rest.toString().padStart(2, '0')}`;
}
