// 来源：moneycome harness/src/finance-intake/invoice-facts.contract.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 从一张发票图上读出来的要素，以及它们各自的可读性。
 *
 * @runtime-status 未接线：本片只有契约与纯函数校验，识别服务与 ingress 随后续 PR 落地。
 *
 * 这些要素**不是会计依据**——`FinMaterial.extractedFactsJson` 的字段注释写死了
 * 这条边界：抽取结果仅用于匹配与判重。要成为记账依据，得先经人确认（事项的
 * `confidence` 转 `human`）或规则命中（转 `rule`）。模型读出来的金额直接进账，
 * 是这套系统最不该出的错。
 *
 * ## 为什么每个字段是三态，不是 `string | null`
 *
 * `null` 把两件完全不同的事压成了一件：**「票上没有这一项」**（小规模纳税人的
 * 普通发票本来就没有税率栏）和**「票上有但我读不出来」**（反光、褶皱、盖章压住）。
 * 前者是正常的，后者必须让人去看原件。压成 `null` 之后，下游只能猜，而猜的结果
 * 就是拿相邻数据顶替——交接包红线第 3 条明令禁止的那种静默兜底。
 *
 * 所以：`present` 读到了、`absent` 票上确实没有、`unreadable` 有但读不出。
 * 三种下游处理不同，一个可空类型表达不了。
 *
 * ## 金额一律整数分
 *
 * 与 `finance-onboarding/opening-balance.contract.ts` 同姿态。发票的价税合计
 * 校验（不含税 + 税额 = 合计）是精确判定，差一分就是不符；`0.1 + 0.2 !== 0.3`
 * 会把一张对的票判成错的。
 */

/** 一个要素的读取状态。 */
export type InvoiceFieldState = 'present' | 'absent' | 'unreadable';

/**
 * 一个读出来的要素。
 *
 * `sourceHint` 是模型说的「我从哪儿读的」（「左上角标题下方」「金额栏第二行」）。
 * 它不参与任何判定，只在人要核对原件时告诉他往哪看——第四层深挖「这笔账怎么
 * 来的」要一路追到这里。
 */
export interface InvoiceField<T> {
  readonly state: InvoiceFieldState;
  /** 仅 `state === 'present'` 时有值。 */
  readonly value?: T;
  /** 读不出来的原因，白话。「被红章盖住」「这一格反光」。 */
  readonly reason?: string;
  readonly sourceHint?: string;
}

/**
 * 一张发票读出来的全部要素。
 *
 * 只放**票面上印着的**东西。「这笔该记哪个科目」「能不能税前扣除」不在这里——
 * 那是规则包和模型的活，混进来这一层就带上了领域知识（架构验收 A1 会抓）。
 */
export interface InvoiceExtractedFacts {
  /** 发票号码。全电发票 20 位，旧版 8 位。 */
  readonly invoiceNumber: InvoiceField<string>;
  /** 开票日期，`YYYY-MM-DD`。 */
  readonly issueDate: InvoiceField<string>;
  /** 销售方名称。 */
  readonly sellerName: InvoiceField<string>;
  /** 销售方纳税人识别号。 */
  readonly sellerTaxId: InvoiceField<string>;
  /** 购买方名称。抬头主体不符是要人把关的五类之一。 */
  readonly buyerName: InvoiceField<string>;
  /** 购买方纳税人识别号。 */
  readonly buyerTaxId: InvoiceField<string>;
  /** 不含税金额，分。 */
  readonly amountExclTaxCents: InvoiceField<number>;
  /** 税额，分。 */
  readonly taxAmountCents: InvoiceField<number>;
  /** 价税合计（小写），分。 */
  readonly totalInclTaxCents: InvoiceField<number>;
  /** 价税合计（中文大写）原文，如「壹万贰仟叁佰肆拾伍元陆角柒分」。 */
  readonly totalInWords: InvoiceField<string>;
  /** 税率，如 `0.06`。免税票没有这一栏，那是 `absent` 不是 `unreadable`。 */
  readonly taxRate: InvoiceField<number>;
  /** 货物或应税劳务名称，逐行。 */
  readonly lineItems: InvoiceField<readonly string[]>;
}

export const INVOICE_FIELD_KEYS = [
  'invoiceNumber',
  'issueDate',
  'sellerName',
  'sellerTaxId',
  'buyerName',
  'buyerTaxId',
  'amountExclTaxCents',
  'taxAmountCents',
  'totalInclTaxCents',
  'totalInWords',
  'taxRate',
  'lineItems',
] as const satisfies readonly (keyof InvoiceExtractedFacts)[];

/**
 * 关键要素：任何一项读不出来，这张票就不能静默入账。
 *
 * 判据是「缺了它，这笔账就记不成或记不对」。销售方名称缺了还能人工补问，
 * 金额缺了就只能猜——而猜金额比不入账危险得多（`FinMaterial.readability`
 * 的字段注释）。税率不在此列：免税与不征税的票本来就没有。
 */
export const INVOICE_CRITICAL_FIELDS = [
  'invoiceNumber',
  'issueDate',
  'totalInclTaxCents',
] as const satisfies readonly (keyof InvoiceExtractedFacts)[];

/**
 * 整张票的可读性，直接落 `FinMaterial.readability`。
 *
 * 取值与 schema 的 `finReadability.*` 一致，不另起一套词。
 */
export type InvoiceReadability =
  | 'readable'
  | 'partiallyUnreadable'
  | 'unreadable';

/**
 * 按关键要素定可读性。
 *
 * 关键项全读到 → `readable`；关键项有读不出的 → `unreadable`（不是
 * partially——关键项缺失时这张票整体就不可用，降级成"部分不可读"会让下游
 * 以为还能凑合用）；关键项齐、非关键项有缺 → `partiallyUnreadable`。
 */
export function resolveInvoiceReadability(
  facts: InvoiceExtractedFacts,
  materialKind = 'invoice',
): InvoiceReadability {
  const criticalUnreadable = INVOICE_CRITICAL_FIELDS.some(
    (key) =>
      (materialKind === 'invoice' || key !== 'invoiceNumber') &&
      facts[key].state !== 'present',
  );
  if (criticalUnreadable) return 'unreadable';
  const anyUnreadable = INVOICE_FIELD_KEYS.some(
    (key) => facts[key].state === 'unreadable',
  );
  return anyUnreadable ? 'partiallyUnreadable' : 'readable';
}

/** 读到值就给出来，否则 `undefined`。校验函数用它取值，少写一堆状态判断。 */
export function fieldValue<T>(field: InvoiceField<T>): T | undefined {
  return field.state === 'present' ? field.value : undefined;
}
