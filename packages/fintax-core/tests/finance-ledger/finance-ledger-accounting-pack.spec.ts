// 来源：moneycome harness/test/unit/finance-ledger-accounting-pack.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
/**
 * B0 换包前置（`docs/modules/fintax-accounting-slice-v1.md` §6）。
 *
 * 记账引擎在 B3 才建，本轮先把「哪些东西必须能换」钉死：两份结构相同、内容
 * 不同的包都必须通过同一份验真，且在四个差异面上确实不同。
 *
 * A2 换包测试（同一事项推出不同分录）在 B3 引擎落地后补，构成 G2 门。
 */

import {
  AccountingPackError,
  encodeAccountingPackEnvelope,
  isSkipRule,
  parseAccountingPackPayload,
  type AccountingPackRule,
} from '../../src/finance-ledger/accounting-pack.contract.js';
import {
  packAlphaPayload,
  packBetaPayload,
} from './fixtures/accounting-packs.js';

describe('会计域包验真', () => {
  it('两份包都通过同一份 schema——结构相同是换包的前提', () => {
    expect(() => parseAccountingPackPayload(packAlphaPayload)).not.toThrow();
    expect(() => parseAccountingPackPayload(packBetaPayload)).not.toThrow();
  });

  it('缺字段 fail-closed，不做乐观放行', () => {
    const withoutCatalogs: Record<string, unknown> = { ...packAlphaPayload };
    delete withoutCatalogs.catalogs;
    expect(() => parseAccountingPackPayload(withoutCatalogs)).toThrow(
      AccountingPackError,
    );
  });

  it('多出未声明字段也拒——包不是自由 JSON', () => {
    expect(() =>
      parseAccountingPackPayload({ ...packAlphaPayload, extra: 1 }),
    ).toThrow(AccountingPackError);
  });

  it('分录腿引用目录里没有的科目 → 拒', () => {
    const broken = structuredClone(
      packAlphaPayload,
    ) as unknown as typeof packAlphaPayload & {
      decisionTables: { rules: { legs: { subjectCode: string }[] }[] }[];
    };
    broken.decisionTables[0].rules[0].legs[0].subjectCode = 'S-NOT-IN-CATALOG';

    // 放行的后果：换包后记出一个谁也解释不了的科目，而那笔账已经进了账本。
    try {
      parseAccountingPackPayload(broken);
      throw new Error('expected parseAccountingPackPayload to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(AccountingPackError);
      expect((err as AccountingPackError).code).toBe(
        'ACCOUNTING_PACK_UNKNOWN_SUBJECT',
      );
    }
  });

  it('id 重复 → 拒', () => {
    const dup = structuredClone(
      packAlphaPayload,
    ) as unknown as typeof packAlphaPayload & {
      sources: { sourceId: string; citation: string }[];
    };
    dup.sources.push({ sourceId: 'src.alpha', citation: '重复 id' });

    expect(() => parseAccountingPackPayload(dup)).toThrow(AccountingPackError);
  });

  it('单腿分录 → 拒，借贷不可能平', () => {
    const oneLeg = structuredClone(
      packAlphaPayload,
    ) as unknown as typeof packAlphaPayload & {
      decisionTables: { rules: { legs: unknown[] }[] }[];
    };
    oneLeg.decisionTables[0].rules[0].legs =
      oneLeg.decisionTables[0].rules[0].legs.slice(0, 1);

    expect(() => parseAccountingPackPayload(oneLeg)).toThrow(
      AccountingPackError,
    );
  });

  // 下面两条在录入工具里也各有一道逐格检查，但那道拦不住手写的 JSON 包。
  // 契约是唯一权威，这两条测的就是它自己。

  it('报表行引用目录里没有的科目 → 拒', () => {
    const broken = structuredClone(packAlphaPayload) as unknown as {
      catalogs: { kind: string; lines?: { subjectCodes: string[] }[] }[];
    };
    const reportLines = broken.catalogs.find((c) => c.kind === 'report_lines');
    reportLines!.lines![0].subjectCodes = ['S-NOT-IN-CATALOG'];

    try {
      parseAccountingPackPayload(broken);
      throw new Error('expected parseAccountingPackPayload to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(AccountingPackError);
      expect((err as AccountingPackError).code).toBe(
        'ACCOUNTING_PACK_UNKNOWN_SUBJECT',
      );
    }
  });

  it('期末必做项为空 → 拒，空会让结账第 5 项静默通过', () => {
    const empty = structuredClone(packAlphaPayload) as unknown as {
      catalogs: { kind: string; items?: unknown[] }[];
    };
    empty.catalogs.find((c) => c.kind === 'closing_items')!.items = [];

    expect(() => parseAccountingPackPayload(empty)).toThrow(
      AccountingPackError,
    );
  });

  it('两张报表可以各有一行同名 lineId，同一张里重复则拒', () => {
    const pack = structuredClone(packAlphaPayload) as unknown as {
      catalogs: {
        kind: string;
        lines?: {
          reportId: string;
          lineId: string;
          lineName: string;
          sign: string;
          subjectCodes: string[];
        }[];
      }[];
    };
    const lines = pack.catalogs.find((c) => c.kind === 'report_lines')!.lines!;
    const first = lines[0];

    lines.push({ ...first, reportId: 'report.balance' });
    expect(() => parseAccountingPackPayload(pack)).not.toThrow();

    lines.push({ ...first });
    expect(() => parseAccountingPackPayload(pack)).toThrow(AccountingPackError);
  });

  it('三种目录的份数：科目恰一、报表行至多一、期末必做恰一', () => {
    const twoSubjects = structuredClone(packAlphaPayload) as unknown as {
      catalogs: unknown[];
    };
    twoSubjects.catalogs.push(structuredClone(packAlphaPayload.catalogs[0]));
    expect(() => parseAccountingPackPayload(twoSubjects)).toThrow(
      AccountingPackError,
    );

    const noClosing = structuredClone(packAlphaPayload) as unknown as {
      catalogs: { kind: string }[];
    };
    noClosing.catalogs = noClosing.catalogs.filter(
      (c) => c.kind !== 'closing_items',
    );
    expect(() => parseAccountingPackPayload(noClosing)).toThrow(
      AccountingPackError,
    );
  });

  it('归一化后消费方看到的是拉平的 reportLines / closingItems', () => {
    const pack = parseAccountingPackPayload(packAlphaPayload);
    expect(pack.catalogs).toHaveLength(1);
    expect(pack.catalogs[0].subjects.length).toBeGreaterThan(0);
    expect(pack.reportLines.length).toBeGreaterThan(0);
    expect(pack.closingItems.length).toBeGreaterThan(0);
  });
});

/**
 * 取这条规则的第一条分录腿。规则是「出分录」与「不记」两种的联合，后者没有
 * `legs`——两个包的收入规则都必须是出分录那种，不是就当场红。
 */
function firstLeg(rule: AccountingPackRule | undefined) {
  if (rule === undefined || isSkipRule(rule)) {
    throw new Error('expected a posting rule with legs');
  }
  return rule.legs[0];
}

describe('两份包在必须能换的四个面上确实不同', () => {
  const alpha = parseAccountingPackPayload(packAlphaPayload);
  const beta = parseAccountingPackPayload(packBetaPayload);

  it('科目目录不同', () => {
    const alphaCodes = alpha.catalogs[0].subjects.map((s) => s.subjectCode);
    const betaCodes = beta.catalogs[0].subjects.map((s) => s.subjectCode);
    expect(alphaCodes).not.toEqual(betaCodes);
    expect(alphaCodes.some((code) => betaCodes.includes(code))).toBe(false);
  });

  it('同一业务形态命中不同的记账规则与不同的金额来源', () => {
    const alphaRevenue = alpha.decisionTables[0].rules.find((rule) =>
      rule.when.some(
        (cond) => cond.factKey === 'event.kind' && cond.equals === 'revenue',
      ),
    );
    const betaRevenue = beta.decisionTables[0].rules.find((rule) =>
      rule.when.some(
        (cond) => cond.factKey === 'event.kind' && cond.equals === 'revenue',
      ),
    );

    expect(alphaRevenue).toBeDefined();
    expect(betaRevenue).toBeDefined();
    // 同一个 event.kind，两个包记到不同科目、取不同金额来源。
    expect(firstLeg(alphaRevenue).subjectCode).not.toBe(
      firstLeg(betaRevenue).subjectCode,
    );
    expect(firstLeg(alphaRevenue).amountSource).not.toBe(
      firstLeg(betaRevenue).amountSource,
    );
  });

  it('证据要求不同', () => {
    const alphaRoles = alpha.evidenceRequirements.find(
      (item) => item.eventKind === 'revenue',
    )?.requiredRoles;
    const betaRoles = beta.evidenceRequirements.find(
      (item) => item.eventKind === 'revenue',
    )?.requiredRoles;
    expect(alphaRoles).not.toEqual(betaRoles);
  });

  it('凭证粗细参数不同', () => {
    const pick = (p: typeof alpha): string | undefined =>
      p.parameters.find((item) => item.parameterId === 'voucher.granularity')
        ?.value;
    expect(pick(alpha)).not.toBe(pick(beta));
  });
});

describe('业务形态的中文名', () => {
  it('可缺：这个字段之前签发的包必须照样解得出', () => {
    // 验真是 fail-closed 的。名字设成必填，等于让所有已经签发、正在用的包
    // 一夜之间全部解不出来——一格文案换掉整条财税线，代价完全不成比例。
    expect(
      packAlphaPayload.evidenceRequirements.every(
        (requirement) => !('eventKindName' in requirement),
      ),
    ).toBe(true);
    expect(() => parseAccountingPackPayload(packAlphaPayload)).not.toThrow();
  });

  it('给了就原样带出来——界面文案从这里取，不在代码里另配一张表', () => {
    const named = structuredClone(
      packAlphaPayload,
    ) as unknown as typeof packAlphaPayload & {
      evidenceRequirements: { eventKindName?: string }[];
    };
    named.evidenceRequirements[0].eventKindName = '收到的钱';

    expect(
      parseAccountingPackPayload(named).evidenceRequirements[0].eventKindName,
    ).toBe('收到的钱');
  });
});

describe('契约本身不含领域常量', () => {
  it('schema 不假设科目号是四位数字', () => {
    // 四位数字是《小企业会计准则》的编码习惯，换准则或换地区就不成立。
    // 两份 fixture 用的都是非数字科目号，能过 = 代码没有偷偷假设。
    expect(() => parseAccountingPackPayload(packAlphaPayload)).not.toThrow();
    expect(
      packAlphaPayload.catalogs[0].subjects.every((subject) =>
        /^[A-Z]/.test(subject.subjectCode),
      ),
    ).toBe(true);
  });
});

describe('有来源的逐期间截止日', () => {
  const entry = {
    periodKey: '2026-09',
    dueDate: '2026-10-26',
    basisSourceId: 'src.alpha',
  };
  function envelope(cadence: string, calendar: unknown) {
    return {
      ...packAlphaPayload,
      catalogs: [
        ...packAlphaPayload.catalogs,
        {
          catalogId: 'deadline.test',
          kind: 'deadlines',
          deadlines: [
            {
              deadlineId: 'filing.test',
              kind: 'tax_filing',
              cadence,
              monthOffset: 1,
              dayOfMonth: 15,
              title: '测试申报',
              ...(calendar === undefined ? {} : { calendar }),
            },
          ],
        },
      ],
    };
  }

  it.each([
    ['monthly', '2026-09', '2026-10-26'],
    ['quarterly', '2025-Q4', '2026-01-20'],
    ['yearly', '2025', '2026-06-01'],
    ['monthly', '2024-01', '2024-02-29'],
  ])(
    '%s 所属期与实际日期可跨月跨年，编码往返保留来源',
    (cadence, periodKey, dueDate) => {
      const calendar = [{ ...entry, periodKey, dueDate }];
      const parsed = parseAccountingPackPayload(envelope(cadence, calendar));
      expect(parsed.deadlines[0]).toMatchObject({ calendar });
      const roundtrip = parseAccountingPackPayload(
        encodeAccountingPackEnvelope(parsed, {
          reportLines: 'report.test',
          closingItems: 'closing.test',
          deadlines: 'deadline.test',
        }),
      );
      expect(roundtrip.deadlines).toEqual(parsed.deadlines);
    },
  );

  it('旧包缺日历仍可解析，不能编造实际日期', () => {
    expect(
      parseAccountingPackPayload(envelope('monthly', undefined)).deadlines[0],
    ).not.toHaveProperty('calendar');
  });

  it.each([
    ['monthly', [{ ...entry, periodKey: '2026-Q3' }]],
    ['monthly', [{ ...entry, periodKey: '2026-13' }]],
    ['quarterly', [{ ...entry, periodKey: '2026-Q5' }]],
    ['yearly', [{ ...entry, periodKey: '2026-09' }]],
    ['monthly', [{ ...entry, dueDate: '2026-02-29' }]],
    ['monthly', [{ ...entry, dueDate: '2026-04-31' }]],
    ['monthly', [{ ...entry, dueDate: '2026-10-26T00:00:00Z' }]],
    ['monthly', [{ ...entry, basisSourceId: 'src.absent' }]],
    ['monthly', [{ ...entry, extra: 'must not be stripped' }]],
    ['monthly', [entry, { ...entry, dueDate: '2026-10-27' }]],
    ['monthly', []],
  ])('拒绝错误的 %s 期间、日期、来源或重复行 %#', (cadence, calendar) => {
    expect(() =>
      parseAccountingPackPayload(envelope(cadence, calendar)),
    ).toThrow(AccountingPackError);
  });
});
