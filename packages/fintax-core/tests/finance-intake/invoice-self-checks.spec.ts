// 来源：moneycome harness/test/unit/finance-intake/invoice-self-checks.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
/**
 * 发票自洽校验。
 *
 * 这些用例要证明的是一件具体的事：**一张被改过的票、一张算错的票、一张糊了
 * 的票，进来之后系统能当场说出哪儿不对**，而不是照单全收。
 *
 * 票面数字取自 `06 标准企业样本` 2026 年 3 月那几笔（设备 10,800、推广费
 * 18,000、办公用品 480），与两人版原型第三层那张表用的是同一批业务——后端
 * 切片和界面验收对的是同一个场景。
 *
 * 用真实科目与金额是有意的：A1 零领域常量扫描只扫源码不扫测试，而测试要能
 * 一眼对回样本。
 */

import { parseChineseAmountToCents } from '../../src/finance-intake/chinese-amount.js';
import {
  resolveInvoiceReadability,
  type InvoiceExtractedFacts,
  type InvoiceField,
} from '../../src/finance-intake/invoice-facts.contract.js';
import {
  hasBlockingSelfCheckFailure,
  INVOICE_SELF_CHECKS,
  runInvoiceSelfChecks,
  type InvoiceSelfCheck,
  type InvoiceSelfCheckStatus,
} from '../../src/finance-intake/invoice-self-checks.js';

const present = <T>(value: T, sourceHint?: string): InvoiceField<T> => ({
  state: 'present',
  value,
  sourceHint,
});
const unreadable = <T>(reason: string): InvoiceField<T> => ({
  state: 'unreadable',
  reason,
});
const absent = <T>(): InvoiceField<T> => ({ state: 'absent' });

/**
 * 样本里那台设备的发票：含税 10,800，税率 13%。
 * 不含税 9,557.52 + 税额 1,242.48 = 10,800.00。
 */
function equipmentInvoice(
  overrides: Partial<InvoiceExtractedFacts> = {},
): InvoiceExtractedFacts {
  return {
    invoiceNumber: present('24312000000098765432'),
    issueDate: present('2026-03-18'),
    sellerName: present('杭州云启办公设备有限公司'),
    sellerTaxId: present('91330100MA2H8K9X7L'),
    buyerName: present('杭州明途科技有限公司'),
    buyerTaxId: present('91330100MA27XYZ12B'),
    amountExclTaxCents: present(955_752),
    taxAmountCents: present(124_248),
    totalInclTaxCents: present(1_080_000),
    totalInWords: present('壹万零捌佰元整'),
    taxRate: present(0.13),
    lineItems: present(['办公设备']),
    ...overrides,
  };
}

function statusOf(
  results: readonly {
    check: InvoiceSelfCheck;
    status: InvoiceSelfCheckStatus;
  }[],
  check: InvoiceSelfCheck,
): InvoiceSelfCheckStatus {
  const hit = results.find((r) => r.check === check);
  if (!hit) throw new Error(`校验项 ${check} 没有结果`);
  return hit.status;
}

describe('中文大写金额解析', () => {
  it.each([
    ['壹万零捌佰元整', 1_080_000],
    ['壹万贰仟叁佰肆拾伍元陆角柒分', 1_234_567],
    ['肆佰捌拾元整', 48_000],
    ['零元零角零分', 0],
    ['贰拾元伍角', 2_050],
    ['零元壹角', 10],
    ['壹佰元零伍分', 10005],
    ['零元零伍分', 5],
    ['壹元零壹分', 101],
    ['壹佰元零伍分整', 10005],
    ['壹佰零伍元', 10_500],
    ['壹亿贰仟叁佰肆拾伍万陆仟柒佰捌拾玖元', 12_345_678_900],
  ])('%s = %i 分', (words, cents) => {
    expect(parseChineseAmountToCents(words)).toBe(cents);
  });

  it('省略「壹」的拾位照认——票面手写与旧版机打常见', () => {
    expect(parseChineseAmountToCents('拾伍元')).toBe(1_500);
  });

  it('认不出的一律返回 undefined，绝不猜一个数出来', () => {
    // 猜的那一刻，大小写比对比的就不是票面，是解析器的想象。
    for (const bad of [
      '人民币壹佰元整', // 前缀没切干净
      '壹贰叁元', // 连着的数字，识别串了行
      '100元整', // 阿拉伯数字混排
      '壹佰块', // 不是元也不是圆
      '万元整', // 「万」前面没数
      '壹佰元零零伍分',
      '壹佰元零伍角',
      '壹佰元陆', // 数字后面没跟单位，不知道是角还是分
      '壹零伍元整', // 零不能吞掉未分配单位的壹
      '壹佰佰元整',
      '壹拾佰元整',
      '壹万壹万元整',
      '壹万壹亿元整',
      '壹佰零元整',
      '壹元伍分陆角',
      '壹元整伍分',
      '壹元伍角整整',
      '',
    ]) {
      expect(parseChineseAmountToCents(bad)).toBeUndefined();
    }
  });
});

describe('税额使用独立整数复算，边界处仍保持一分容差', () => {
  it.each([
    [8_263_485_554_808_183, 9, 743_713_699_932_736],
    [7_970_972_791_806_173, 13, 1_036_226_462_934_802],
    [7_698_460_901_488_020, 17, 1_308_738_353_252_963],
  ])('%s 分 × %s%% 不放过两分差', (amount, percent, expected) => {
    // 独立整数分 oracle，不用实现中的 Decimal 或浮点乘法。
    expect(Number((BigInt(amount) * BigInt(percent) + 50n) / 100n)).toBe(
      expected,
    );
    for (const delta of [-2, -1, 0, 1, 2]) {
      const result = runInvoiceSelfChecks(
        equipmentInvoice({
          amountExclTaxCents: present(amount),
          taxRate: present(percent / 100),
          taxAmountCents: present(expected + delta),
        }),
        'invoice',
      ).find(({ check }) => check === 'taxRateConsistency');
      expect(result?.status).toBe(Math.abs(delta) <= 1 ? 'passed' : 'failed');
      if (Math.abs(delta) === 2)
        expect(result?.detail?.expectedCents).toBe(expected);
    }
  });

  it('正负半分沿用向正无穷方向取整，极大正负差额仍精确', () => {
    for (const [amount, rate, expected, actual] of [
      [5, 0.1, 1, 3],
      [-5, 0.1, -0, -2],
      [
        Number.MAX_SAFE_INTEGER,
        1,
        Number.MAX_SAFE_INTEGER,
        -Number.MAX_SAFE_INTEGER,
      ],
    ]) {
      const result = runInvoiceSelfChecks(
        equipmentInvoice({
          amountExclTaxCents: present(amount),
          taxRate: present(rate),
          taxAmountCents: present(actual),
        }),
        'invoice',
      ).find(({ check }) => check === 'taxRateConsistency');
      expect(result?.status).toBe('failed');
      expect(result?.detail?.expectedCents).toBe(expected);
      expect(BigInt(result?.detail?.diffCents as string | number)).toBe(
        BigInt(actual) - BigInt(expected),
      );
    }
  });

  it.each([NaN, Infinity, -0.01, 1.01])(
    '历史非法税率 %s 不能计算通过或抛异常',
    (rate) => {
      expect(
        statusOf(
          runInvoiceSelfChecks(
            equipmentInvoice({ taxRate: present(rate) }),
            'invoice',
          ),
          'taxRateConsistency',
        ),
      ).toBe('insufficient');
    },
  );
});

describe('适用前提：这张材料是发票', () => {
  // 44 张真跑里 14 张收据被「6 位单据号」判成 invoiceNumberShape 失败。收据没有
  // 发票号码栏，量出来的红是尺子不合用，不是票有问题。
  it.each(['receipt', 'taxi', 'contract', ''])(
    'materialKind=%s 时六项全 notApplicable',
    (kind) => {
      const results = runInvoiceSelfChecks(equipmentInvoice(), kind);
      expect(results.map((r) => r.check)).toEqual([...INVOICE_SELF_CHECKS]);
      expect(results.map((r) => r.status)).toEqual(
        INVOICE_SELF_CHECKS.map(() => 'notApplicable'),
      );
      expect(hasBlockingSelfCheckFailure(results)).toBe(false);
    },
  );

  it('六项一项不少地回来——不是 skip', () => {
    // 少几项，下游分不清「没这一项」和「漏跑了」。
    expect(runInvoiceSelfChecks(equipmentInvoice(), 'receipt')).toHaveLength(
      INVOICE_SELF_CHECKS.length,
    );
  });

  it('不是 passed——一张收据「通过了发票的价税恒等」是假的通过', () => {
    const results = runInvoiceSelfChecks(equipmentInvoice(), 'receipt');
    expect(results.some((r) => r.status === 'passed')).toBe(false);
  });
});

describe('一张全对的票', () => {
  it('六项全过，不拦', () => {
    const results = runInvoiceSelfChecks(equipmentInvoice(), 'invoice');
    expect(results.map((r) => r.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(hasBlockingSelfCheckFailure(results)).toBe(false);
    expect(resolveInvoiceReadability(equipmentInvoice())).toBe('readable');
  });
});

describe('票被改过：大小写对不上', () => {
  it('小写被改大写没改，当场抓出来并说清两个数各是多少', () => {
    // 大写与小写并存本来就是防篡改设计：改一个小写数字容易，把大写也改对难。
    const facts = equipmentInvoice({
      totalInclTaxCents: present(1_800_000),
      amountExclTaxCents: present(1_592_920),
      taxAmountCents: present(207_080),
    });
    const results = runInvoiceSelfChecks(facts, 'invoice');
    expect(statusOf(results, 'wordsMatchDigits')).toBe('failed');
    const hit = results.find((r) => r.check === 'wordsMatchDigits');
    expect(hit?.detail).toMatchObject({
      wordsCents: 1_080_000,
      digitsCents: 1_800_000,
    });
    expect(hit?.plainText).toContain('对不上');
    expect(hasBlockingSelfCheckFailure(results)).toBe(true);
  });

  it('大写读不出来时判「等补」而不是「不符」——两者下游处理相反', () => {
    const facts = equipmentInvoice({
      totalInWords: present('壹万零捌佰圆惠'), // 尾字被章盖住，识别成了别的字
    });
    expect(
      statusOf(runInvoiceSelfChecks(facts, 'invoice'), 'wordsMatchDigits'),
    ).toBe('insufficient');
  });
});

describe('票算错了', () => {
  it('三个数加不起来，报出差多少', () => {
    const facts = equipmentInvoice({ taxAmountCents: present(124_240) });
    const results = runInvoiceSelfChecks(facts, 'invoice');
    expect(statusOf(results, 'amountIdentity')).toBe('failed');
    expect(
      results.find((r) => r.check === 'amountIdentity')?.detail,
    ).toMatchObject({ diffCents: -8 });
  });

  it('税额与税率对不上，报出应该是多少', () => {
    // 不含税与合计仍自洽，只有税率这一栏被写成了 6%。单看金额恒等式抓不到，
    // 必须靠税率这一层。
    const facts = equipmentInvoice({ taxRate: present(0.06) });
    const results = runInvoiceSelfChecks(facts, 'invoice');
    expect(statusOf(results, 'amountIdentity')).toBe('passed');
    expect(statusOf(results, 'taxRateConsistency')).toBe('failed');
    expect(
      results.find((r) => r.check === 'taxRateConsistency')?.detail,
    ).toMatchObject({ expectedCents: 57_345 });
  });

  it('一分以内的舍入差算对，不误报', () => {
    // 价税分离按四舍五入，差一分是正常的；把它判成错会让大量真票被拦。
    const facts = equipmentInvoice({ taxAmountCents: present(124_249) });
    expect(
      statusOf(runInvoiceSelfChecks(facts, 'invoice'), 'taxRateConsistency'),
    ).toBe('passed');
  });
});

describe('免税票没有税率栏', () => {
  it('判「本来就没有」，不判「缺材料」也不判「不符」', () => {
    // 小规模纳税人的免税票就长这样。判成缺失会让前台去追一张根本不存在的东西。
    const facts = equipmentInvoice({
      taxRate: absent(),
      amountExclTaxCents: present(1_080_000),
      taxAmountCents: present(0),
    });
    const results = runInvoiceSelfChecks(facts, 'invoice');
    expect(statusOf(results, 'taxRateConsistency')).toBe('notApplicable');
    expect(statusOf(results, 'amountIdentity')).toBe('passed');
    expect(hasBlockingSelfCheckFailure(results)).toBe(false);
  });
});

describe('票糊了', () => {
  it('关键项读不出 → 整张判不可读，不是「部分不可读」', () => {
    // 样本里那张办公用品 480 的票就是这个状态：清单里让她请店家重开一张。
    // 降级成 partially 会让下游以为还能凑合用，而缺的是金额——猜金额比不入账
    // 危险得多。
    const facts = equipmentInvoice({
      totalInclTaxCents: unreadable('这一格反光，数字看不清'),
      totalInWords: unreadable('这一格反光'),
    });
    expect(resolveInvoiceReadability(facts)).toBe('unreadable');
    const results = runInvoiceSelfChecks(facts, 'invoice');
    expect(statusOf(results, 'amountIdentity')).toBe('insufficient');
    // 读不出来不是「这张票有问题」，是「我看不见」——不能占用 failed。
    expect(hasBlockingSelfCheckFailure(results)).toBe(false);
    expect(
      results.find((r) => r.check === 'amountIdentity')?.detail,
    ).toMatchObject({
      totalInclTaxCents: {
        state: 'unreadable',
        reason: '这一格反光，数字看不清',
      },
    });
  });

  it('非关键项读不出 → 部分不可读，关键的还在就还能往下走', () => {
    const facts = equipmentInvoice({
      sellerTaxId: unreadable('被红章盖住'),
    });
    expect(resolveInvoiceReadability(facts)).toBe('partiallyUnreadable');
  });
});

describe('形状不对', () => {
  it('日期是 2 月 30 日 —— 形状对但那天不存在', () => {
    // new Date 会把它悄悄滚成 3 月 2 日，正是那种「看起来通过了」的静默兜底。
    const facts = equipmentInvoice({ issueDate: present('2026-02-30') });
    expect(
      statusOf(runInvoiceSelfChecks(facts, 'invoice'), 'issueDateShape'),
    ).toBe('failed');
  });

  it('发票号码位数不对，报出实际几位', () => {
    const facts = equipmentInvoice({ invoiceNumber: present('243120000') });
    const results = runInvoiceSelfChecks(facts, 'invoice');
    expect(statusOf(results, 'invoiceNumberShape')).toBe('failed');
    expect(
      results.find((r) => r.check === 'invoiceNumberShape')?.plainText,
    ).toContain('9 位');
  });

  it('8 位的旧版票照过', () => {
    const facts = equipmentInvoice({ invoiceNumber: present('24312088') });
    expect(
      statusOf(runInvoiceSelfChecks(facts, 'invoice'), 'invoiceNumberShape'),
    ).toBe('passed');
  });

  it('税号位数不对', () => {
    const facts = equipmentInvoice({ buyerTaxId: present('9133010') });
    expect(statusOf(runInvoiceSelfChecks(facts, 'invoice'), 'taxIdShape')).toBe(
      'failed',
    );
  });
});

describe('说给前台听的那句话', () => {
  it('不出现财务名词——交接包红线第 5 条', () => {
    // 前台零财务知识。「进项税额」「价税分离」「计税依据」出现在她屏幕上即 bug。
    const forbidden = [
      '进项',
      '销项',
      '价税分离',
      '计税依据',
      '应纳税额',
      '税会差异',
      '科目',
      '分录',
      '借方',
      '贷方',
    ];
    const facts = equipmentInvoice({
      totalInclTaxCents: present(1_800_000),
      taxRate: present(0.06),
      invoiceNumber: present('243120000'),
      issueDate: present('2026-02-30'),
      buyerTaxId: present('9133010'),
    });
    for (const result of runInvoiceSelfChecks(facts, 'invoice')) {
      for (const word of forbidden) {
        expect(result.plainText ?? '').not.toContain(word);
      }
    }
  });
});

describe('历史金额与恒等式的整数边界', () => {
  it.each([9007199254740992, Number.POSITIVE_INFINITY, 0.5])(
    '历史非精确整数分 %s 不能报告金额校验通过',
    (value) => {
      const results = runInvoiceSelfChecks(
        equipmentInvoice({
          amountExclTaxCents: present(value),
          taxAmountCents: present(1),
          totalInclTaxCents: present(value),
        }),
        'invoice',
      );
      expect(statusOf(results, 'amountIdentity')).toBe('failed');
      expect(statusOf(results, 'taxRateConsistency')).toBe('insufficient');
      expect(statusOf(results, 'wordsMatchDigits')).toBe('insufficient');
      expect(hasBlockingSelfCheckFailure(results)).toBe(true);
    },
  );
  it('各输入都安全但相加越界时，差额仍逐分准确且可以序列化', () => {
    const results = runInvoiceSelfChecks(
      equipmentInvoice({
        amountExclTaxCents: present(Number.MAX_SAFE_INTEGER),
        taxAmountCents: present(Number.MAX_SAFE_INTEGER),
        totalInclTaxCents: present(0),
      }),
      'invoice',
    );
    const identity = results.find((r) => r.check === 'amountIdentity');
    expect(identity).toMatchObject({
      status: 'failed',
      detail: { diffCents: '18014398509481982' },
    });
    expect(identity?.plainText).toContain('180,143,985,094,819.82');
    expect(() => JSON.stringify(results)).not.toThrow();
  });
});
