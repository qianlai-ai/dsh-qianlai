// 来源：moneycome harness/src/finance-intake/statement-import-checks.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 一批银行流水**导进来之前**先看它自己有没有问题。
 *
 * @runtime-status 纯函数，输入原始行，输出异常清单。仓储层与导入 ingress 在
 * B3，本片不含。
 *
 * ## 为什么在入库前查，不在入库后查
 *
 * 入库后再查，坏数据已经进了 `FinTransaction`，下游的事项匹配、对账、结账
 * 都已经在错的基础上跑了一遍。而这里查的几件事——漏行、重复、日期读不出——
 * 全都只需要这批行自己，不需要库里任何东西。能在门口拦下的，不要放进来再追。
 *
 * ## 余额连续性是这批检查里最强的一条
 *
 * 银行导出的流水几乎都带「交易后余额」。这一列把每一行都锁进了一条链：
 * **上一行的余额 + 本行的有符号金额 = 本行的余额**。链一断，说明中间漏了行、
 * 多了行，或者某一行的金额读错了——而这三种错，单看任何一行都看不出来。
 *
 * 余额列**不入库**（`FinTransaction` 没有这一列，也不该有：余额是派生量，
 * 存下来就会和流水漂移）。它只在导入这一刻用来验链，验完即弃。这与「报表
 * 不落库全部实时算」是同一条纪律。
 *
 * ## 这一层不判业务
 *
 * 不判这笔钱是收入还是往来、不判该挂哪个事项、不判要不要开票。只判**这批
 * 数据自己站不站得住**。业务判断在 L2 规则包和模型那边。
 */

export const MAX_STATEMENT_TRANSACTION_CENTS = 999_999_999_999_999_999n;

export const STATEMENT_IMPORT_CHECKS = [
  /** 每行的日期读不读得出来。 */
  'dateParsable',
  /** 每行的金额读不读得出来。 */
  'amountParsable',
  /** 上一行余额 + 本行金额 = 本行余额。 */
  'balanceContinuity',
  /** 同一笔交易在这批里出现了多次。 */
  'duplicateRows',
  /** 实际行覆盖的日期范围与声明的导入区间对不对得上。 */
  'periodCoverage',
] as const;

/**
 * 导入时另跑的两项：拿原件印出的数字核交过来的行。只读自查工具不跑它们。
 * 授权：`docs/modules/fintax-statement-import-v1.md` 第九节。
 */
export const STATEMENT_PRINTED_FIGURE_CHECKS = [
  /** 首行、末行余额与印出的期初、期末对不对得上。 */
  'openingClosingBalance',
  /** 印出的收入合计、支出合计、笔数、页码对不对得上。 */
  'printedTotals',
] as const;

export type StatementImportCheck =
  | (typeof STATEMENT_IMPORT_CHECKS)[number]
  | (typeof STATEMENT_PRINTED_FIGURE_CHECKS)[number];

export type StatementImportCheckStatus =
  | 'passed'
  | 'failed'
  | 'insufficient'
  | 'notApplicable';

export interface StatementImportCheckResult {
  readonly check: StatementImportCheck;
  readonly status: StatementImportCheckStatus;
  /** 出问题的原文件行号。人拿着它直接翻到那一行。 */
  readonly rowNumbers?: readonly number[];
  readonly detail?: Record<string, unknown>;
  /** 一句白话。不出现财务名词——前台看得到这句。 */
  readonly plainText?: string;
}

/**
 * 从对账单文件读出来的一行，**全是原样文本**。
 *
 * 不在读文件那一步就转换类型：转换会把「读不出来」变成 `null`，而哪一行读不
 * 出、原文长什么样，恰恰是人要拿去核对的东西。
 */
export interface RawStatementRow {
  /** 批内唯一的来源行引用；多原件/工作表须统一编号并保留原始位置映射。 */
  readonly rowNumber: number;
  readonly occurredAt: string;
  readonly amount: string;
  /** 「收入」「支出」「借」「贷」等原样文本，由调用方按银行格式归一。 */
  readonly direction?: string;
  readonly counterpartyName?: string;
  readonly rawDescription?: string;
  /** 交易后余额。银行大多有，没有就跳过连续性检查。 */
  readonly balanceAfter?: string;
}

export interface StatementImportInput {
  readonly rows: readonly RawStatementRow[];
  /** 声明的导入区间，`YYYY-MM-DD`。 */
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** 原件上印出来的数字，照原样文本；没印就不给，不得用交易行推算。 */
export interface PrintedStatementFigures {
  readonly printedOpeningBalance?: string;
  readonly printedClosingBalance?: string;
  /** 收入（贷方）发生额合计，不带符号。 */
  readonly printedInflowTotal?: string;
  /** 支出（借方）发生额合计，不带符号。 */
  readonly printedOutflowTotal?: string;
  readonly printedRowCount?: number;
  /** 每页印的「第 x 页 / 共 y 页」。 */
  readonly printedPageLabels?: readonly {
    readonly page: number;
    readonly of: number;
  }[];
  /** 原件印的起止日期，`YYYY-MM-DD`。给了上面任何一项就必须给。 */
  readonly printedPeriodStart?: string;
  readonly printedPeriodEnd?: string;
}

/** Input self-check; pass trusted account dates when deciding complete monthly coverage. */
export function statementZeroTransactions(
  input: StatementImportInput &
    PrintedStatementFigures & { sourceKind: string },
  accountLife?: { openedOn: string; closedOn: string | null },
): { openingBalanceCents: string; closingBalanceCents: string } | null {
  if (
    input.rows.length !== 0 ||
    !['officialStatement', 'cashRecord'].includes(input.sourceKind) ||
    parseDate(input.periodStart) !== input.periodStart ||
    parseDate(input.periodEnd) !== input.periodEnd ||
    input.periodStart > input.periodEnd ||
    input.periodStart.slice(0, 7) !== input.periodEnd.slice(0, 7) ||
    input.printedPeriodStart !== input.periodStart ||
    input.printedPeriodEnd !== input.periodEnd
  )
    return null;
  if (accountLife) {
    if (
      parseDate(accountLife.openedOn) !== accountLife.openedOn ||
      (accountLife.closedOn !== null &&
        (parseDate(accountLife.closedOn) !== accountLife.closedOn ||
          accountLife.closedOn < accountLife.openedOn))
    )
      return null;
    const monthStart = `${input.periodStart.slice(0, 7)}-01`;
    const end = new Date(`${monthStart}T00:00:00.000Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const monthEnd = end.toISOString().slice(0, 10);
    const from =
      accountLife.openedOn > monthStart ? accountLife.openedOn : monthStart;
    const to =
      accountLife.closedOn !== null && accountLife.closedOn < monthEnd
        ? accountLife.closedOn
        : monthEnd;
    if (
      from > to ||
      !(
        (input.periodStart === monthStart && input.periodEnd === monthEnd) ||
        (input.periodStart === from && input.periodEnd === to)
      )
    )
      return null;
  }
  const opening = printedCents(input.printedOpeningBalance);
  const closing = printedCents(input.printedClosingBalance);
  if (
    opening === undefined ||
    closing !== opening ||
    opening > MAX_STATEMENT_TRANSACTION_CENTS ||
    opening < -MAX_STATEMENT_TRANSACTION_CENTS
  )
    return null;
  return {
    openingBalanceCents: opening.toString(),
    closingBalanceCents: closing.toString(),
  };
}

/** 一行读出来的规整值。读不出的字段留 `undefined`，不猜。 */
interface ParsedRow {
  readonly row: RawStatementRow;
  readonly date?: string;
  readonly signedCents?: bigint;
  readonly balanceCents?: bigint;
}

export function runStatementImportChecks(
  input: StatementImportInput,
): readonly StatementImportCheckResult[] {
  const parsed = input.rows.map(parseRow);
  return [
    checkDateParsable(parsed),
    checkAmountParsable(parsed),
    checkBalanceContinuity(parsed),
    checkDuplicateRows(parsed),
    checkPeriodCoverage(parsed, input),
  ];
}

/**
 * 两项印出数字的核对。行的先后按交过来的顺序，与余额连续性同一口径：首行最早。
 * 印了但读不出的数字当作核不了，不当作对上。印出的数字对应整份对账单，本批只是
 * 其中一段（印出的起止日期与声明区间不同）时两项都不核。
 */
export function runPrintedFigureChecks(
  input: StatementImportInput & PrintedStatementFigures,
): readonly StatementImportCheckResult[] {
  if (
    input.printedPeriodStart !== undefined &&
    input.printedPeriodEnd !== undefined &&
    (input.printedPeriodStart !== input.periodStart ||
      input.printedPeriodEnd !== input.periodEnd)
  ) {
    return STATEMENT_PRINTED_FIGURE_CHECKS.map((check) => ({
      check,
      status: 'notApplicable',
      detail: { reason: 'partialBatch' },
      plainText: '这次只记了对账单的一段，原件印的是整份的数字，这次不核。',
    }));
  }
  const parsed = input.rows.map(parseRow);
  return [
    checkOpeningClosingBalance(parsed, input),
    checkPrintedTotals(parsed, input),
  ];
}

/** CSV、XLS、XLSX 的类型名（去掉参数、小写）。纯文本不算：它没有逐行表格的结构。 */
export const STRUCTURED_STATEMENT_CONTENT_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** PDF、常见图片与归档的文件头：声明是 CSV 而字节是这些，就不是表格。 */
const NOT_TEXT = [
  [0x25, 0x50, 0x44, 0x46], // %PDF
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x52, 0x49, 0x46, 0x46], // RIFF (WEBP)
  [0x49, 0x49, 0x2a, 0x00], // TIFF
  [0x4d, 0x4d, 0x00, 0x2a], // TIFF
  [0x42, 0x4d], // BMP
  ZIP,
  OLE,
];

/**
 * 声明的类型是表格，且原件字节与之一致，才算结构化表格（第九节 9.4）。
 * 声明来自上传方，单凭它不作数：一份 PDF 声明成 text/csv 仍按版面来源处理。
 */
export function isStructuredStatementSource(
  contentType: string,
  bytes: Uint8Array,
): boolean {
  const type = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase();
  if (!STRUCTURED_STATEMENT_CONTENT_TYPES.has(type)) return false;
  const startsWith = (signature: readonly number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (type === 'text/csv') {
    if (NOT_TEXT.some(startsWith)) return false;
    // UTF-16 带 BOM 时 NUL 是正常字节；其余编码的文本里不该有 NUL。
    const utf16 = startsWith([0xff, 0xfe]) || startsWith([0xfe, 0xff]);
    return utf16 || !bytes.subarray(0, 4096).includes(0);
  }
  return startsWith(type === 'application/vnd.ms-excel' ? OLE : ZIP);
}

/**
 * 印出的笔数对上，或收入、支出合计都对上，才算原件给了行级的完整性依据。
 * 页码只证明页没少，期初期末拦不住净额为 0 的中间缺段，都不算。
 */
export function hasPrintedRowEvidence(
  results: readonly StatementImportCheckResult[],
): boolean {
  const totals = results.find((r) => r.check === 'printedTotals');
  if (totals?.status !== 'passed') return false;
  const matched = new Set(
    (totals.detail?.matched as readonly string[] | undefined) ?? [],
  );
  return (
    matched.has('rowCount') ||
    (matched.has('inflowTotal') && matched.has('outflowTotal'))
  );
}

/** 任何一项 `failed` 都不该直接入库。`insufficient` 是缺列，另说。 */
export function hasBlockingImportFailure(
  results: readonly StatementImportCheckResult[],
): boolean {
  return results.some((r) => r.status === 'failed');
}

function parseRow(row: RawStatementRow): ParsedRow {
  const cents = parseSignedCents(row.amount, row.direction);
  return {
    row,
    date: parseDate(row.occurredAt),
    signedCents: cents,
    balanceCents:
      row.balanceAfter === undefined
        ? undefined
        : parseSignedCents(row.balanceAfter),
  };
}

/**
 * 日期读不出来的行。
 *
 * 这条检查看着琐碎，实际是最容易造成静默漏数的一条：日期列里混着
 * 「2026年3月」「上月结转」这类非日期文本时，按日期筛选会把那些行整行漏掉，
 * 而它们带着真实的金额。**只报比例和行号这个事实，怎么处理交给人**——有的
 * 是表尾合计行该删，有的是真交易该补。
 */
function checkDateParsable(
  parsed: readonly ParsedRow[],
): StatementImportCheckResult {
  if (!parsed.length) {
    return {
      check: 'dateParsable',
      status: 'insufficient',
      plainText: '这份表里一行数据都没有。',
    };
  }
  const bad = parsed.filter((p) => p.date === undefined);
  if (!bad.length) return { check: 'dateParsable', status: 'passed' };
  return {
    check: 'dateParsable',
    status: 'failed',
    rowNumbers: bad.map((p) => p.row.rowNumber),
    detail: {
      unparsableRatio: round4(bad.length / parsed.length),
      samples: bad.slice(0, 3).map((p) => p.row.occurredAt),
    },
    plainText: `有 ${bad.length} 行的日期看不懂，这些行会被整行漏掉，得先看一眼。`,
  };
}

function checkAmountParsable(
  parsed: readonly ParsedRow[],
): StatementImportCheckResult {
  if (!parsed.length) {
    return { check: 'amountParsable', status: 'insufficient' };
  }
  const bad = parsed.filter(
    (p) =>
      p.signedCents === undefined ||
      absCents(p.signedCents) > MAX_STATEMENT_TRANSACTION_CENTS,
  );
  if (!bad.length) return { check: 'amountParsable', status: 'passed' };
  return {
    check: 'amountParsable',
    status: 'failed',
    rowNumbers: bad.map((p) => p.row.rowNumber),
    detail: { samples: bad.slice(0, 3).map((p) => p.row.amount) },
    plainText: `有 ${bad.length} 行的金额读不出来。`,
  };
}

/**
 * 逐行验余额链。
 *
 * 从第二行起：`上一行余额 + 本行金额` 应该等于 `本行余额`。断在哪一行就报
 * 哪一行，并把差额算出来——差额本身常常直接指认问题：差额恰好等于某一行的
 * 金额，就是那一行被漏了或重了。
 *
 * 只有一行时不判 `passed`：一行验不出链，那是 `insufficient`。把「没验」
 * 说成「验过了」，是这套检查最不该出的错。
 */
function checkBalanceContinuity(
  parsed: readonly ParsedRow[],
): StatementImportCheckResult {
  const withBalance = parsed.filter((p) => p.balanceCents !== undefined);
  if (!withBalance.length) {
    // 这份对账单没有余额列。不是数据有问题，是这一项没法查。
    return {
      check: 'balanceContinuity',
      status: 'notApplicable',
      plainText: '这份表里没有余额那一列，这一项查不了。',
    };
  }
  if (withBalance.length !== parsed.length) {
    return {
      check: 'balanceContinuity',
      status: 'insufficient',
      rowNumbers: parsed
        .filter((p) => p.balanceCents === undefined)
        .map((p) => p.row.rowNumber),
      plainText: '有几行没有余额，这条链断在那儿，验不到底。',
    };
  }
  if (parsed.length < 2) {
    return {
      check: 'balanceContinuity',
      status: 'insufficient',
      plainText: '只有一行，前后对不上号。',
    };
  }

  const breaks: {
    rowNumber: number;
    expectedCents: bigint;
    actualCents: bigint;
    gapCents: bigint;
  }[] = [];
  for (let i = 1; i < parsed.length; i += 1) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    // 金额读不出来的行在 amountParsable 里已经报过，这里跳过不重复报。
    if (
      prev.balanceCents === undefined ||
      cur.balanceCents === undefined ||
      cur.signedCents === undefined
    ) {
      continue;
    }
    const expected = prev.balanceCents + cur.signedCents;
    if (expected !== cur.balanceCents) {
      breaks.push({
        rowNumber: cur.row.rowNumber,
        expectedCents: expected,
        actualCents: cur.balanceCents,
        gapCents: cur.balanceCents - expected,
      });
    }
  }

  if (!breaks.length) return { check: 'balanceContinuity', status: 'passed' };
  return {
    check: 'balanceContinuity',
    status: 'failed',
    rowNumbers: breaks.map((b) => b.rowNumber),
    detail: {
      breaks: breaks.slice(0, 5).map((row) => ({
        rowNumber: row.rowNumber,
        expectedCents: jsonCents(row.expectedCents),
        actualCents: jsonCents(row.actualCents),
        gapCents: jsonCents(row.gapCents),
      })),
      breakCount: breaks.length,
    },
    plainText:
      breaks.length === 1
        ? `第 ${breaks[0]?.rowNumber} 行前后对不上，差 ${formatCents(breaks[0]?.gapCents ?? 0n)}——中间可能少了一笔。`
        : `有 ${breaks.length} 处前后对不上，这份流水可能不全。`,
  };
}

/**
 * 同一笔交易在这批里出现多次。
 *
 * 判重键是「日期 + 金额 + 对手 + 摘要」，**不含行号**。库里的
 * `FinTxn_tenant_account_dedupe_key` 唯一约束会在入库时挡住重复，但那时报出来
 * 的是一个数据库错误，人看不懂也不知道是哪两行。在门口报，能直接说「第 12 行
 * 和第 47 行是同一笔」。
 *
 * 真有两笔完全一样的交易（同一天给同一家付了两次同样的钱）也会被报出来——
 * 那正是该让人看一眼的情况，不是误报。所以措辞是「像是同一笔」不是「重复了」。
 */
function checkDuplicateRows(
  parsed: readonly ParsedRow[],
): StatementImportCheckResult {
  if (!parsed.length) return { check: 'duplicateRows', status: 'insufficient' };
  const positions = new Set<number>();
  const repeated = new Set<number>();
  for (const { row } of parsed) {
    if (positions.has(row.rowNumber)) repeated.add(row.rowNumber);
    positions.add(row.rowNumber);
  }
  if (repeated.size > 0)
    return {
      check: 'duplicateRows',
      status: 'failed',
      rowNumbers: [...repeated],
      detail: { duplicateKind: 'sourcePosition' },
      plainText:
        '同一个来源行引用出现了多次，请核对原件位置；不同原始行须使用批内唯一行号。',
    };
  const seen = new Map<string, number[]>();
  for (const p of parsed) {
    const key = [
      p.date ?? p.row.occurredAt,
      String(p.signedCents ?? p.row.amount),
      // 与入库 prepareRows 的身份字段同口径，否则两端空白会绕过重复确认。
      p.row.counterpartyName?.trim() ?? '',
      p.row.rawDescription?.trim() ?? '',
      // 用 NUL 当分隔符：它不可能出现在任何一个字段里，所以拼不出
      // 「A|B」与「A」+「|B」这种假重复。**写成转义而不是裸字节**——
      // 裸 NUL 会让 grep / rg 把整个文件判成 binary 直接跳过，查这个文件
      // 时会静默返回空，人还以为是没写。
    ].join('\x00');
    const hit = seen.get(key);
    if (hit) hit.push(p.row.rowNumber);
    else seen.set(key, [p.row.rowNumber]);
  }
  const groups = [...seen.values()].filter((rows) => rows.length > 1);
  if (!groups.length) return { check: 'duplicateRows', status: 'passed' };
  return {
    check: 'duplicateRows',
    status: 'failed',
    rowNumbers: groups.flat(),
    detail: { groups: groups.slice(0, 5) },
    plainText: `有 ${groups.length} 组行像是同一笔重复了，比如第 ${groups[0]?.join('、第 ')} 行。`,
  };
}

/**
 * 实际数据覆盖的日期范围 vs 声明的导入区间。
 *
 * 声明 3 月 1 日到 3 月 31 日，实际第一笔是 3 月 8 日——不一定是错（月初本来
 * 就没交易），但**必须让人知道**，因为「3 月 1–7 日没有交易」和「3 月 1–7 日
 * 的流水没导进来」在数据上长得一模一样，而后者会让整月的账少一截。
 *
 * 所以这一项的措辞不是「错了」，是「差这一截，你确认一下」。
 */
function checkPeriodCoverage(
  parsed: readonly ParsedRow[],
  input: StatementImportInput,
): StatementImportCheckResult {
  const dates = parsed
    .map((p) => p.date)
    .filter((d): d is string => d !== undefined)
    .sort();
  if (!dates.length) {
    return {
      check: 'periodCoverage',
      status: 'insufficient',
      plainText: '一个能用的日期都没读到，对不出区间。',
    };
  }
  const first = dates[0] ?? '';
  const last = dates[dates.length - 1] ?? '';
  const outside = parsed.filter(
    (p) =>
      p.date !== undefined &&
      (p.date < input.periodStart || p.date > input.periodEnd),
  );
  if (outside.length) {
    return {
      check: 'periodCoverage',
      status: 'failed',
      rowNumbers: outside.map((p) => p.row.rowNumber),
      detail: {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        outsideCount: outside.length,
      },
      plainText: `有 ${outside.length} 行的日期不在这次要导的这段时间里。`,
    };
  }
  if (first > input.periodStart || last < input.periodEnd) {
    return {
      check: 'periodCoverage',
      status: 'insufficient',
      detail: {
        declared: { start: input.periodStart, end: input.periodEnd },
        actual: { first, last },
      },
      plainText: `这份流水是 ${first} 到 ${last}，跟你说的那段对不齐，确认一下是不是漏了一截。`,
    };
  }
  return { check: 'periodCoverage', status: 'passed' };
}

function checkOpeningClosingBalance(
  parsed: readonly ParsedRow[],
  printed: PrintedStatementFigures,
): StatementImportCheckResult {
  const check = 'openingClosingBalance';
  if (
    printed.printedOpeningBalance === undefined &&
    printed.printedClosingBalance === undefined
  ) {
    return { check, status: 'notApplicable' };
  }
  const opening = printedCents(printed.printedOpeningBalance);
  const closing = printedCents(printed.printedClosingBalance);
  if (!parsed.length) {
    if (opening === undefined || closing === undefined) {
      return {
        check,
        status: 'insufficient',
        plainText: '没有交易行，期初、期末要两个都读得出才核得了。',
      };
    }
    return opening === closing
      ? { check, status: 'passed' }
      : {
          check,
          status: 'failed',
          detail: {
            openingCents: jsonCents(opening),
            closingCents: jsonCents(closing),
          },
          plainText: `没有交易，期初和期末却差 ${formatCents(closing - opening)}。`,
        };
  }
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const mismatches: string[] = [];
  const said: string[] = [];
  let checked = 0;
  if (
    opening !== undefined &&
    first?.balanceCents !== undefined &&
    first.signedCents !== undefined
  ) {
    checked += 1;
    const gap = first.balanceCents - (opening + first.signedCents);
    if (gap !== 0n) {
      mismatches.push('opening');
      said.push(
        `第一行的余额比印出的期初加上这一行的金额差 ${formatCents(gap)}，开头可能少了一笔`,
      );
    }
  }
  if (closing !== undefined && last?.balanceCents !== undefined) {
    checked += 1;
    const gap = last.balanceCents - closing;
    if (gap !== 0n) {
      mismatches.push('closing');
      said.push(
        `最后一行的余额和印出的期末差 ${formatCents(gap)}，结尾可能少了一笔`,
      );
    }
  }
  if (
    opening !== undefined &&
    closing !== undefined &&
    parsed.every((p) => p.signedCents !== undefined)
  ) {
    checked += 1;
    const sum = parsed.reduce((total, p) => total + (p.signedCents ?? 0n), 0n);
    const gap = opening + sum - closing;
    if (gap !== 0n) {
      mismatches.push('sum');
      said.push(
        `期初加上这些行的金额和印出的期末差 ${formatCents(gap)}，可能少了几笔`,
      );
    }
  }
  if (mismatches.length) {
    return {
      check,
      status: 'failed',
      rowNumbers: [
        ...(mismatches.includes('opening') && first
          ? [first.row.rowNumber]
          : []),
        ...(mismatches.includes('closing') && last ? [last.row.rowNumber] : []),
      ],
      detail: { mismatches },
      plainText: `${said.join('；')}。`,
    };
  }
  return checked
    ? { check, status: 'passed' }
    : {
        check,
        status: 'insufficient',
        plainText: '印了期初或期末，但这些行里没有能拿来核的余额。',
      };
}

function checkPrintedTotals(
  parsed: readonly ParsedRow[],
  printed: PrintedStatementFigures,
): StatementImportCheckResult {
  const check = 'printedTotals';
  const labels = printed.printedPageLabels ?? [];
  // 逐项归到四组之一：对上、对不上、没印、印了但读不出（含交过来的行金额读不全）。
  const detail = {
    matched: [] as string[],
    mismatches: [] as string[],
    notPrinted: [] as string[],
    unreadable: [] as string[],
  };
  // 对不上的项差多少，只进白话，不进 detail。
  const said: string[] = [];
  const compare = (
    name: string,
    raw: string | number | undefined,
    expected: number | bigint | undefined,
    actual: number | bigint | undefined,
  ) => {
    if (raw === undefined) detail.notPrinted.push(name);
    else if (expected === undefined || actual === undefined)
      detail.unreadable.push(name);
    else if (expected === actual) detail.matched.push(name);
    else {
      detail.mismatches.push(name);
      said.push(
        name === 'rowCount'
          ? `原件印 ${expected} 笔，交过来 ${actual} 行`
          : `${PRINTED_LABELS[name] ?? name}原件印 ${formatCents(expected)}，这些行加起来 ${formatCents(actual)}，差 ${formatCents(BigInt(expected) - BigInt(actual))}`,
      );
    }
  };
  const cents = parsed.map((p) => p.signedCents);
  const readable = cents.every((value) => value !== undefined);
  // 合计按不带符号比：模型把支出合计照抄成「-500.00」时，符号不该让整批拒写。
  const unsigned = (raw: string | undefined) => {
    const cents = printedCents(raw);
    return cents === undefined ? undefined : absCents(cents);
  };
  compare(
    'inflowTotal',
    printed.printedInflowTotal,
    unsigned(printed.printedInflowTotal),
    readable
      ? cents.filter((c) => c > 0n).reduce((a, b) => a + b, 0n)
      : undefined,
  );
  compare(
    'outflowTotal',
    printed.printedOutflowTotal,
    unsigned(printed.printedOutflowTotal),
    readable
      ? cents.filter((c) => c < 0n).reduce((a, b) => a - b, 0n)
      : undefined,
  );
  compare(
    'rowCount',
    printed.printedRowCount,
    printed.printedRowCount,
    parsed.length,
  );
  if (labels.length) {
    const of = labels[0]?.of ?? 0;
    const pages = labels.map((label) => label.page).sort((a, b) => a - b);
    const complete =
      labels.every((label) => label.of === of) &&
      pages.length === of &&
      pages.every((page, index) => page === index + 1);
    (complete ? detail.matched : detail.mismatches).push('pageLabels');
    if (!complete)
      said.push(
        `页码不齐：交过来的是第 ${pages.join('、')} 页，各页印的共几页是 ${[...new Set(labels.map((label) => label.of))].join('、')}`,
      );
  } else detail.notPrinted.push('pageLabels');
  if (detail.notPrinted.length === 4) return { check, status: 'notApplicable' };
  if (detail.mismatches.length) {
    return {
      check,
      status: 'failed',
      detail,
      plainText: `${said.join('；')}。可能漏了行或漏了页。`,
    };
  }
  return detail.matched.length
    ? { check, status: 'passed', detail }
    : {
        check,
        status: 'insufficient',
        detail,
        plainText: '印了合计或笔数，但有数字读不出来，核不了。',
      };
}

const PRINTED_LABELS: Readonly<Record<string, string>> = {
  inflowTotal: '收入合计',
  outflowTotal: '支出合计',
  rowCount: '笔数',
  pageLabels: '页码',
};

/** 印出的金额：读不出就是核不了，不是零。 */
function printedCents(raw: string | undefined): bigint | undefined {
  return raw === undefined ? undefined : parseSignedCents(raw);
}

/**
 * 「-1,200.00」「1200.00」+ 方向词 → 有符号整数分。
 *
 * 方向词只在金额本身没带符号时起作用：银行导出有两种写法，一种金额带正负号，
 * 一种金额恒为正、方向另立一列。两种都要认，但**不能互相覆盖**——金额已经带
 * 了负号还按方向词再翻一次，就翻回正的了。
 */
export function parseSignedCents(
  raw: string,
  direction?: string,
): bigint | undefined {
  const amount = raw.trim().replace(/^([+-]?)[¥￥]\s*/, '$1');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(amount)) {
    return undefined;
  }
  const directionWord = direction?.trim().toLowerCase();
  if (
    directionWord &&
    !OUTBOUND_WORDS.has(directionWord) &&
    !INBOUND_WORDS.has(directionWord)
  )
    return undefined;
  const text = amount.replace(/,/g, '');
  const digits = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = digits.split('.');
  const magnitude = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (text.startsWith('-')) return -magnitude;
  if (text.startsWith('+')) return magnitude;
  if (directionWord && OUTBOUND_WORDS.has(directionWord)) return -magnitude;
  return magnitude;
}

/**
 * 表示「钱出去了」的方向词。
 *
 * ⚠️ 与 `invoice-self-checks.ts` 的号码位数同一笔债：这是中文银行对账单的
 * 表达习惯，按三分法应由 L2 领域规则包提供。合流后一并迁走。
 */
const OUTBOUND_WORDS = new Set([
  '支出',
  '付',
  '借',
  '出',
  '转出',
  '贷记',
  'out',
]);
const INBOUND_WORDS = new Set(['收入', '收', '入', '转入', 'in']);

/** 导出给写入那一步复用：自查与写入必须用同一个日期解析，否则两边对「读得出」的判断会漂开。 */
export function parseDate(raw: string): string | undefined {
  const text = raw.trim();
  const m = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(text);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  // 2 月 30 日形状对但那天不存在，`new Date` 会悄悄滚到 3 月 2 日。
  return date.getUTCDate() === Number(d) &&
    date.getUTCMonth() + 1 === Number(mo)
    ? iso
    : undefined;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function absCents(cents: bigint): bigint {
  return cents < 0n ? -cents : cents;
}

/** Keep existing ordinary diagnostic numbers; large cents remain exact JSON strings. */
function jsonCents(cents: bigint): number | string {
  return absCents(cents) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(cents)
    : cents.toString();
}

function formatCents(cents: number | bigint): string {
  const magnitude = absCents(BigInt(cents));
  const yuan = magnitude / 100n;
  const rest = String(magnitude % 100n).padStart(2, '0');
  return `¥${yuan.toLocaleString('zh-CN')}.${rest}`;
}
