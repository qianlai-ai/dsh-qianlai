// 来源：moneycome harness/test/unit/finance-intake/statement-import-checks.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
/**
 * 流水导入前的自查。
 *
 * 要证明的事很具体：**一份漏了几笔的流水、一份重复导了的流水、一份日期列
 * 混着文本的流水，进来之前系统能指着行号说出哪儿不对**。
 *
 * 场景取自 06 标准企业样本 2026 年 3 月的工行流水——两人版原型里前台李娜要
 * 导的就是这一份。
 */

import {
  hasBlockingImportFailure,
  hasPrintedRowEvidence,
  isStructuredStatementSource,
  parseSignedCents,
  runPrintedFigureChecks,
  runStatementImportChecks,
  statementZeroTransactions,
  type RawStatementRow,
  type StatementImportCheck,
  type StatementImportCheckResult,
  type StatementImportCheckStatus,
} from '../../src/finance-intake/statement-import-checks.js';

const PERIOD = { periodStart: '2026-03-01', periodEnd: '2026-03-31' };

describe('零交易原件期间与可信账户存续期', () => {
  const input = (from: string, to: string) => ({
    rows: [],
    sourceKind: 'officialStatement',
    periodStart: from,
    periodEnd: to,
    printedPeriodStart: from,
    printedPeriodEnd: to,
    printedOpeningBalance: '0.00',
    printedClosingBalance: '0.00',
  });
  it.each([
    ['2026-09-10', '2026-09-30', '2026-09-10', null],
    ['2026-09-01', '2026-09-20', '2026-01-01', '2026-09-20'],
    ['2026-09-10', '2026-09-20', '2026-09-10', '2026-09-20'],
    ['2026-09-01', '2026-09-30', '2026-09-10', '2026-09-20'],
    ['2028-02-10', '2028-02-29', '2028-02-10', null],
    ['2026-12-10', '2026-12-31', '2026-12-10', null],
  ])('接受整月或完整存续交集 %s–%s', (from, to, openedOn, closedOn) => {
    expect(
      statementZeroTransactions(input(from, to), {
        openedOn,
        closedOn,
      }),
    ).toEqual({ openingBalanceCents: '0', closingBalanceCents: '0' });
  });
  it.each([
    ['2026-09-11', '2026-09-30', '2026-09-10', null],
    ['2026-09-10', '2026-09-29', '2026-09-10', null],
    ['2026-09-01', '2026-09-19', '2026-01-01', '2026-09-20'],
    ['2026-09-10', '2026-09-20', '2026-01-01', null],
    ['2026-09-10', '2026-10-01', '2026-09-10', null],
    ['2026-09-01', '2026-09-30', '2026-10-01', null],
    ['2026-09-01', '2026-09-30', '2026-01-01', '2026-08-31'],
    ['2026-09-01', '2026-09-30', 'invalid', null],
    ['2026-09-01', '2026-09-30', '2026-09-10', '2026-09-09'],
  ])(
    '缺日、跨月或无存续交集不能获得覆盖 %s–%s',
    (from, to, openedOn, closedOn) => {
      expect(
        statementZeroTransactions(input(from, to), {
          openedOn,
          closedOn,
        }),
      ).toBeNull();
    },
  );
});

/**
 * 一份干净的流水：期初 128,400 起，四笔进出，余额逐行对得上。
 *
 * 128400 +33000 = 161400 −18000 = 143400 −3000 = 140400 +3000 = 143400
 */
function cleanRows(): RawStatementRow[] {
  return [
    {
      rowNumber: 2,
      occurredAt: '2026-03-01',
      amount: '0.00',
      direction: '收入',
      rawDescription: '期初余额',
      balanceAfter: '128400.00',
    },
    {
      rowNumber: 3,
      occurredAt: '2026-03-06',
      amount: '33000.00',
      direction: '收入',
      counterpartyName: '甲客户',
      rawDescription: '货款',
      balanceAfter: '161400.00',
    },
    {
      rowNumber: 4,
      occurredAt: '2026-03-10',
      amount: '18000.00',
      direction: '支出',
      counterpartyName: '员工工资',
      rawDescription: '代发工资',
      balanceAfter: '143400.00',
    },
    {
      rowNumber: 5,
      occurredAt: '2026-03-20',
      amount: '3000.00',
      direction: '支出',
      counterpartyName: '房东',
      rawDescription: '房租',
      balanceAfter: '140400.00',
    },
    {
      rowNumber: 6,
      occurredAt: '2026-03-31',
      amount: '3000.00',
      direction: '收入',
      counterpartyName: '乙公司',
      rawDescription: '退款',
      balanceAfter: '143400.00',
    },
  ];
}

function statusOf(
  results: readonly StatementImportCheckResult[],
  check: StatementImportCheck,
): StatementImportCheckStatus {
  const hit = results.find((r) => r.check === check);
  if (!hit) throw new Error(`校验项 ${check} 没有结果`);
  return hit.status;
}

function resultOf(
  results: readonly StatementImportCheckResult[],
  check: StatementImportCheck,
): StatementImportCheckResult {
  const hit = results.find((r) => r.check === check);
  if (!hit) throw new Error(`校验项 ${check} 没有结果`);
  return hit;
}

describe('金额与方向', () => {
  it.each([
    ['33000.00', '收入', 3_300_000],
    ['18000.00', '支出', -1_800_000],
    ['-3000.00', undefined, -300_000],
    ['1,240.50', '支出', -124_050],
    [' ￥ 1,234.56 ', 'out', -123_456],
    ['-￥1,234.56', 'in', -123_456],
    ['100.00', ' OUT ', -10_000],
    ['100.00', 'in', 10_000],
    ['+100.00', '支出', 10_000],
  ])('%s / %s = %i 分', (amount, direction, cents) => {
    expect(parseSignedCents(amount, direction)).toBe(BigInt(cents));
  });

  it('金额已经带负号时不再按方向词翻一次——翻两次就正回去了', () => {
    expect(parseSignedCents('-3000.00', '支出')).toBe(-300_000n);
  });

  it('读不出来的返回 undefined，不当成 0', () => {
    // 当成 0 会让这一行悄悄不参与余额链，链反而"对上了"。
    for (const bad of [
      '',
      '三千',
      '1.2.3',
      '3000元',
      '1,23',
      '1 2.34',
      '1¥2.34',
      '1\n2.34',
      '12,34,567',
      ',123',
      '123,',
    ]) {
      expect(parseSignedCents(bad)).toBeUndefined();
    }
  });

  it.each(['unknown', 'debit', 'credit', '借记', '收/支'])(
    '未知方向 %s 不能默认为收入，也不能通过校验',
    (direction) => {
      expect(parseSignedCents('100.00', direction)).toBeUndefined();
      expect(
        hasBlockingImportFailure(
          runStatementImportChecks({
            ...PERIOD,
            rows: cleanRows().map((row, index) =>
              index === 1 ? { ...row, direction } : row,
            ),
          }),
        ),
      ).toBe(true);
    },
  );
});

describe('一份干净的流水', () => {
  it('五项全过，不拦', () => {
    const results = runStatementImportChecks({ rows: cleanRows(), ...PERIOD });
    expect(results.map((r) => r.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(hasBlockingImportFailure(results)).toBe(false);
  });
});

describe('漏了几笔', () => {
  it('余额链断在哪一行就报哪一行，并算出差多少', () => {
    // 中间那笔 18,000 的工资被漏掉了：余额从 161,400 直接跳到 143,400。
    // 单看剩下的每一行都挑不出毛病，只有余额链能抓到。
    const rows = cleanRows().filter((r) => r.rowNumber !== 4);
    const results = runStatementImportChecks({ rows, ...PERIOD });

    expect(statusOf(results, 'balanceContinuity')).toBe('failed');
    const hit = resultOf(results, 'balanceContinuity');
    expect(hit.rowNumbers).toEqual([5]);
    expect(hit.detail?.breaks).toMatchObject([
      {
        rowNumber: 5,
        expectedCents: 15_840_000,
        actualCents: 14_040_000,
        gapCents: -1_800_000,
      },
    ]);
    // 差额恰好是被漏掉那笔的金额，人一眼就知道少了什么。
    expect(hit.plainText).toContain('¥18,000.00');
    expect(hasBlockingImportFailure(results)).toBe(true);
  });

  it('连着漏两笔只算一个断点——链上看到的就是一处跳变', () => {
    // 这是正确行为不是漏报：余额链只能告诉你「这里对不上、差多少」，
    // 差额里到底藏了一笔还是两笔，链本身分不出来。
    const rows = cleanRows().filter(
      (r) => r.rowNumber !== 4 && r.rowNumber !== 5,
    );
    const hit = resultOf(
      runStatementImportChecks({ rows, ...PERIOD }),
      'balanceContinuity',
    );
    expect(hit.status).toBe('failed');
    expect(hit.detail?.breakCount).toBe(1);
    expect(hit.detail?.breaks).toMatchObject([{ gapCents: -2_100_000 }]);
  });

  it('文件两处各漏一笔 → 报两处，只说有几处不逐条刷屏', () => {
    const rows = cleanRows()
      .filter((r) => r.rowNumber !== 4)
      // 第 6 行的金额也被读错了，于是这一行自己又断一次。
      .map((r) => (r.rowNumber === 6 ? { ...r, amount: '5000.00' } : r));
    const hit = resultOf(
      runStatementImportChecks({ rows, ...PERIOD }),
      'balanceContinuity',
    );
    expect(hit.status).toBe('failed');
    expect(hit.detail?.breakCount).toBe(2);
    expect(hit.plainText).toContain('可能不全');
  });

  it('没有余额列 → 这一项查不了，不冒充通过', () => {
    // 手机银行截图导出的常常没有余额列。判 passed 会让人以为验过了。
    const rows = cleanRows().map((r) => ({ ...r, balanceAfter: undefined }));
    expect(
      statusOf(
        runStatementImportChecks({ rows, ...PERIOD }),
        'balanceContinuity',
      ),
    ).toBe('notApplicable');
  });

  it('只有部分行有余额 → 判「验不到底」，不拿有的那几行凑一条链', () => {
    const rows = cleanRows();
    const patched = rows.map((r, i) =>
      i === 2 ? { ...r, balanceAfter: undefined } : r,
    );
    const hit = resultOf(
      runStatementImportChecks({ rows: patched, ...PERIOD }),
      'balanceContinuity',
    );
    expect(hit.status).toBe('insufficient');
    expect(hit.rowNumbers).toEqual([4]);
  });
});

describe('重复导入', () => {
  it('同一笔出现两次，报出是哪两行', () => {
    // 库里的唯一约束会在入库时挡住，但那时报的是数据库错误，人看不懂也不知道
    // 是哪两行。在门口报能直接说「第 3 行和第 7 行是同一笔」。
    const rows = cleanRows();
    const dup = { ...rows[1], rowNumber: 7, balanceAfter: '176400.00' };
    const results = runStatementImportChecks({
      rows: [...rows, dup],
      ...PERIOD,
    });
    const hit = resultOf(results, 'duplicateRows');
    expect(hit.status).toBe('failed');
    expect(hit.rowNumbers).toEqual([3, 7]);
    expect(hit.plainText).toContain('第 3、第 7');
  });

  it.each([
    ['测试供应商', ' 测试供应商 ', '采购款', '\t采购款\n'],
    [undefined, '  ', undefined, '\t'],
  ])(
    '重复判断与入库一样忽略两端空白和空字段',
    (name, paddedName, note, paddedNote) => {
      const row = {
        ...cleanRows()[0],
        counterpartyName: name,
        rawDescription: note,
      };
      const hit = resultOf(
        runStatementImportChecks({
          rows: [
            row,
            {
              ...row,
              rowNumber: 9,
              counterpartyName: paddedName,
              rawDescription: paddedNote,
            },
          ],
          ...PERIOD,
        }),
        'duplicateRows',
      );
      expect(hit.status).toBe('failed');
      expect(hit.rowNumbers).toEqual([row.rowNumber, 9]);
    },
  );

  it('对方或摘要中间的空格仍属于原文，不把不同交易合并', () => {
    const row = {
      ...cleanRows()[0],
      counterpartyName: '测试供应商',
      rawDescription: '采购 A',
    };
    const hit = resultOf(
      runStatementImportChecks({
        rows: [row, { ...row, rowNumber: 9, rawDescription: '采购A' }],
        ...PERIOD,
      }),
      'duplicateRows',
    );
    expect(hit.status).toBe('passed');
  });

  it('措辞是「像是同一笔」——同一天给同一家付两次同样的钱是真事', () => {
    const rows = cleanRows();
    const dup = { ...rows[3], rowNumber: 8 };
    const hit = resultOf(
      runStatementImportChecks({ rows: [...rows, dup], ...PERIOD }),
      'duplicateRows',
    );
    expect(hit.plainText).toContain('像是');
  });
});

describe('日期列混着文本', () => {
  it('读不出日期的行报出行号与比例——这些行会被整行漏掉', () => {
    // 表尾的「本月合计」「上月结转」是最常见的来源，它们带着真实金额。
    const rows: RawStatementRow[] = [
      ...cleanRows(),
      {
        rowNumber: 9,
        occurredAt: '本月合计',
        amount: '15000.00',
        direction: '收入',
        balanceAfter: '158400.00',
      },
    ];
    const hit = resultOf(
      runStatementImportChecks({ rows, ...PERIOD }),
      'dateParsable',
    );
    expect(hit.status).toBe('failed');
    expect(hit.rowNumbers).toEqual([9]);
    expect(hit.detail?.samples).toEqual(['本月合计']);
  });

  it('认中式写法 2026年3月6日', () => {
    const rows = cleanRows().map((r, i) =>
      i === 1 ? { ...r, occurredAt: '2026年3月6日' } : r,
    );
    expect(
      statusOf(runStatementImportChecks({ rows, ...PERIOD }), 'dateParsable'),
    ).toBe('passed');
  });

  it('2 月 30 日读不出——形状对但那天不存在', () => {
    const rows = cleanRows().map((r, i) =>
      i === 1 ? { ...r, occurredAt: '2026-02-30' } : r,
    );
    expect(
      statusOf(runStatementImportChecks({ rows, ...PERIOD }), 'dateParsable'),
    ).toBe('failed');
  });
});

describe('区间对不齐', () => {
  it('开头缺一截 → 判「确认一下」，不判「错了」', () => {
    // 「3 月 1–7 日没有交易」和「3 月 1–7 日的流水没导进来」在数据上长得
    // 一模一样，而后者会让整月的账少一截。所以必须说，但不能说成错。
    const rows = cleanRows().filter((r) => r.rowNumber !== 2);
    const hit = resultOf(
      runStatementImportChecks({ rows, ...PERIOD }),
      'periodCoverage',
    );
    expect(hit.status).toBe('insufficient');
    expect(hit.detail?.actual).toMatchObject({ first: '2026-03-06' });
    expect(hit.plainText).toContain('确认一下');
  });

  it('有行落在区间外 → 判「错了」，那是导错文件或选错月份', () => {
    const rows: RawStatementRow[] = [
      ...cleanRows(),
      {
        rowNumber: 10,
        occurredAt: '2026-04-02',
        amount: '500.00',
        direction: '支出',
        balanceAfter: '142900.00',
      },
    ];
    const hit = resultOf(
      runStatementImportChecks({ rows, ...PERIOD }),
      'periodCoverage',
    );
    expect(hit.status).toBe('failed');
    expect(hit.rowNumbers).toEqual([10]);
  });
});

describe('空表', () => {
  it('一行都没有时判「缺材料」，五项不冒充通过', () => {
    const results = runStatementImportChecks({ rows: [], ...PERIOD });
    expect(results.every((r) => r.status !== 'passed')).toBe(true);
    expect(hasBlockingImportFailure(results)).toBe(false);
  });
});

describe('说给前台听的那句话', () => {
  it('不出现财务名词', () => {
    const forbidden = [
      '借方',
      '贷方',
      '科目',
      '分录',
      '会计期间',
      '试算平衡',
      '对账差异',
    ];
    const rows = cleanRows().filter((r) => r.rowNumber !== 4);
    for (const result of runStatementImportChecks({ rows, ...PERIOD })) {
      for (const word of forbidden) {
        expect(result.plainText ?? '').not.toContain(word);
      }
    }
  });
});

/** 导入合同第九节：拿原件印出的数字核交过来的行。 */
describe('印出的数字', () => {
  const printedPeriod = {
    printedPeriodStart: PERIOD.periodStart,
    printedPeriodEnd: PERIOD.periodEnd,
  };
  function printedChecks(
    rows: readonly RawStatementRow[],
    printed: Record<string, unknown>,
  ) {
    const results = runPrintedFigureChecks({
      rows,
      ...PERIOD,
      ...printedPeriod,
      ...printed,
    });
    return {
      opening: results.find((r) => r.check === 'openingClosingBalance')!,
      totals: results.find((r) => r.check === 'printedTotals')!,
      results,
    };
  }

  it('什么都没印：两项都是 notApplicable', () => {
    const { opening, totals } = printedChecks(cleanRows(), {});
    expect(opening.status).toBe('notApplicable');
    expect(totals.status).toBe('notApplicable');
  });

  it('0 行：期初期末都印且相等 passed，不相等 failed，缺一个 insufficient', () => {
    expect(
      printedChecks([], {
        printedOpeningBalance: '5,000.00',
        printedClosingBalance: '5000.00',
      }).opening.status,
    ).toBe('passed');
    expect(
      printedChecks([], {
        printedOpeningBalance: '5000.00',
        printedClosingBalance: '4999.99',
      }).opening.status,
    ).toBe('failed');
    expect(
      printedChecks([], { printedClosingBalance: '5000.00' }).opening.status,
    ).toBe('insufficient');
  });

  it('0 行：印了笔数 0、收支合计都是 0 时，三项都进 matched', () => {
    expect(
      printedChecks([], {
        printedRowCount: 0,
        printedInflowTotal: '0.00',
        printedOutflowTotal: '0',
      }).totals,
    ).toMatchObject({
      status: 'passed',
      detail: {
        matched: ['inflowTotal', 'outflowTotal', 'rowCount'],
        mismatches: [],
        notPrinted: ['pageLabels'],
        unreadable: [],
      },
    });
  });

  it('期初期末印了但读不出：当作核不了，不当作对上', () => {
    const { opening } = printedChecks(cleanRows(), {
      printedOpeningBalance: '十二万八千四',
      printedClosingBalance: '见附页',
    });
    expect(opening.status).toBe('insufficient');
  });

  it('合计、笔数、页码逐项归组：对上、对不上、没印、读不出', () => {
    // cleanRows：收入 0 + 33000 + 3000，支出 18000 + 3000，共 5 行。
    const matched = printedChecks(cleanRows(), {
      printedInflowTotal: '36,000.00',
      printedOutflowTotal: '21000.00',
      printedRowCount: 5,
    }).totals;
    expect(matched).toMatchObject({
      status: 'passed',
      detail: {
        matched: ['inflowTotal', 'outflowTotal', 'rowCount'],
        mismatches: [],
        notPrinted: ['pageLabels'],
        unreadable: [],
      },
    });
    const mixed = printedChecks(cleanRows(), {
      printedInflowTotal: '三万六',
      printedRowCount: 4,
    }).totals;
    expect(mixed).toMatchObject({
      status: 'failed',
      detail: {
        matched: [],
        mismatches: ['rowCount'],
        notPrinted: ['outflowTotal', 'pageLabels'],
        unreadable: ['inflowTotal'],
      },
    });
    expect(
      printedChecks(cleanRows(), { printedOutflowTotal: '两万一' }).totals
        .status,
    ).toBe('insufficient');
  });

  it('合计带了负号也按不带符号比', () => {
    const { totals } = printedChecks(cleanRows(), {
      printedInflowTotal: '36000.00',
      printedOutflowTotal: '-21,000.00',
    });
    expect(totals).toMatchObject({
      status: 'passed',
      detail: { matched: ['inflowTotal', 'outflowTotal'] },
    });
  });

  it('对不上时，白话说出是哪一项、差多少', () => {
    // cleanRows：期初 0 行余额 128400，末行余额 143400；收入 36000，支出 21000，共 5 行。
    const { opening, totals } = printedChecks(cleanRows(), {
      printedOpeningBalance: '128000.00',
      printedClosingBalance: '143400.00',
      printedInflowTotal: '36200.00',
      printedRowCount: 6,
      printedPageLabels: [
        { page: 1, of: 3 },
        { page: 3, of: 3 },
      ],
    });
    expect(opening.status).toBe('failed');
    expect(opening.plainText).toContain('第一行的余额');
    expect(opening.plainText).toContain('差 ¥400.00');
    expect(totals.status).toBe('failed');
    expect(totals.plainText).toContain('收入合计原件印 ¥36,200.00');
    expect(totals.plainText).toContain('差 ¥200.00');
    expect(totals.plainText).toContain('原件印 6 笔，交过来 5 行');
    expect(totals.plainText).toContain('第 1、3 页');
  });

  it('行级依据只认笔数，或收入、支出合计都对上；页码、单个合计都不算', () => {
    const evidence = (printed: Record<string, unknown>) =>
      hasPrintedRowEvidence(printedChecks(cleanRows(), printed).results);
    expect(evidence({ printedRowCount: 5 })).toBe(true);
    expect(
      evidence({
        printedInflowTotal: '36000.00',
        printedOutflowTotal: '21000.00',
      }),
    ).toBe(true);
    expect(evidence({ printedInflowTotal: '36000.00' })).toBe(false);
    expect(evidence({ printedPageLabels: [{ page: 1, of: 1 }] })).toBe(false);
    expect(
      evidence({
        printedOpeningBalance: '0.00',
        printedClosingBalance: '143400.00',
      }),
    ).toBe(false);
    expect(evidence({})).toBe(false);
  });

  it('本批只是对账单的一段：两项都 notApplicable，原因 partialBatch', () => {
    const results = runPrintedFigureChecks({
      rows: cleanRows(),
      ...PERIOD,
      printedPeriodStart: '2026-01-01',
      printedPeriodEnd: '2026-03-31',
      printedRowCount: 40,
    });
    expect(results.map((r) => [r.check, r.status, r.detail])).toEqual([
      ['openingClosingBalance', 'notApplicable', { reason: 'partialBatch' }],
      ['printedTotals', 'notApplicable', { reason: 'partialBatch' }],
    ]);
  });
});

describe('原件是不是结构化表格', () => {
  const text = (value: string) => new TextEncoder().encode(value);
  const XLSX =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const cases: [string, string, Uint8Array, boolean][] = [
    ['CSV', 'text/csv', text('日期,金额\n2026-03-06,33000\n'), true],
    ['CSV 带参数', 'text/csv; charset=utf-8', text('a,b\n'), true],
    [
      'UTF-16 带 BOM 的 CSV',
      'text/csv',
      new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00]),
      true,
    ],
    ['申报 CSV、字节是 PDF', 'text/csv', text('%PDF-1.4\n'), false],
    [
      '申报 CSV、字节是 PNG',
      'text/csv',
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
      false,
    ],
    [
      '申报 CSV、字节是 ZIP',
      'text/csv',
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      false,
    ],
    [
      '申报 CSV、中间有 NUL',
      'text/csv',
      new Uint8Array([0x61, 0x00, 0x62]),
      false,
    ],
    ['XLSX', XLSX, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]), true],
    ['申报 XLSX、字节是 CSV', XLSX, text('a,b\n'), false],
    [
      'XLS',
      'application/vnd.ms-excel',
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]),
      true,
    ],
    [
      '申报 XLS、字节是 ZIP',
      'application/vnd.ms-excel',
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      false,
    ],
    ['纯文本', 'text/plain', text('a,b\n'), false],
    ['PDF', 'application/pdf', text('%PDF-1.4\n'), false],
    ['没申报类型', 'application/octet-stream', text('a,b\n'), false],
  ];
  it.each(cases)('%s', (_name, contentType, bytes, expected) => {
    expect(isStructuredStatementSource(contentType, bytes)).toBe(expected);
  });
});

describe('exact statement cents at Decimal(18,2) boundaries', () => {
  it('preserves each cent beyond the Number safe-integer range', () => {
    expect(parseSignedCents('90071992547409.92')).toBe(9007199254740992n);
    expect(parseSignedCents('90071992547409.93')).toBe(9007199254740993n);
    expect(parseSignedCents('9999999999999999.99', '支出')).toBe(
      -999999999999999999n,
    );
    expect(
      resultOf(
        runStatementImportChecks({
          ...PERIOD,
          rows: [
            {
              rowNumber: 1,
              occurredAt: '2026-03-01',
              amount: '10000000000000000.00',
            },
          ],
        }),
        'amountParsable',
      ).status,
    ).toBe('failed');
  });
  it('detects a missing cent in a high-balance continuity chain and returns JSON-safe diagnostics', () => {
    const rows = [
      {
        rowNumber: 1,
        occurredAt: '2026-03-01',
        amount: '0.00',
        balanceAfter: '90071992547409.92',
      },
      {
        rowNumber: 2,
        occurredAt: '2026-03-02',
        amount: '0.01',
        balanceAfter: '90071992547409.92',
      },
    ];
    const result = resultOf(
      runStatementImportChecks({ ...PERIOD, rows }),
      'balanceContinuity',
    );
    expect(result.status).toBe('failed');
    expect(result.plainText).toContain('0.01');
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.detail).toMatchObject({
      breaks: [
        {
          expectedCents: '9007199254740993',
          actualCents: '9007199254740992',
          gapCents: -1,
        },
      ],
    });
    expect(
      statusOf(
        runStatementImportChecks({
          ...PERIOD,
          rows: [rows[0], { ...rows[1], balanceAfter: '90071992547409.93' }],
        }),
        'balanceContinuity',
      ),
    ).toBe('passed');
  });
  it('refuses one-cent printed-total mismatch and sums canceling high values exactly', () => {
    const rows = [
      { rowNumber: 1, occurredAt: '2026-03-01', amount: '90071992547409.92' },
    ];
    expect(
      resultOf(
        runPrintedFigureChecks({
          ...PERIOD,
          rows,
          printedInflowTotal: '90071992547409.93',
        }),
        'printedTotals',
      ).status,
    ).toBe('failed');
    expect(
      resultOf(
        runPrintedFigureChecks({
          ...PERIOD,
          rows: [
            {
              rowNumber: 1,
              occurredAt: '2026-03-01',
              amount: '9999999999999999.99',
            },
            {
              rowNumber: 2,
              occurredAt: '2026-03-02',
              amount: '9999999999999999.99',
            },
          ],
          printedInflowTotal: '19999999999999999.98',
        }),
        'printedTotals',
      ).status,
    ).toBe('passed');
    const cancel = [
      rows[0],
      { rowNumber: 2, occurredAt: '2026-03-02', amount: '0.01' },
      { rowNumber: 3, occurredAt: '2026-03-03', amount: '-90071992547409.92' },
    ];
    expect(
      resultOf(
        runPrintedFigureChecks({
          ...PERIOD,
          rows: cancel,
          printedOpeningBalance: '0.00',
          printedClosingBalance: '0.01',
        }),
        'openingClosingBalance',
      ).status,
    ).toBe('passed');
  });
});

describe('来源行引用和交易内容分别核验', () => {
  it('不同内容也不能共用一个来源行引用', () => {
    const rows = cleanRows();
    rows[1] = { ...rows[1], rowNumber: rows[0].rowNumber };
    expect(
      runStatementImportChecks({ ...PERIOD, rows }).find(
        (r) => r.check === 'duplicateRows',
      ),
    ).toMatchObject({
      status: 'failed',
      rowNumbers: [rows[0].rowNumber],
      detail: { duplicateKind: 'sourcePosition' },
    });
  });
  it('同内容不同原始位置保留内容重复分组，供单独确认', () => {
    const row = cleanRows()[1];
    const result = runStatementImportChecks({
      ...PERIOD,
      rows: [row, { ...row, rowNumber: 99 }],
    }).find((r) => r.check === 'duplicateRows');
    expect(result).toMatchObject({
      status: 'failed',
      detail: { groups: [[row.rowNumber, 99]] },
    });
    expect(result?.detail).not.toHaveProperty('duplicateKind');
  });
});
