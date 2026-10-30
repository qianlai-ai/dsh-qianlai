// 来源：moneycome harness/test/unit/finance-ledger/ledger-posting-engine.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
/**
 * 记账引擎的拒绝路径。
 *
 * 引擎宁可不记，也不记一笔说不清的账——一笔错账进了账本，后面每一步都建立在
 * 它上面。这里逐条钉住那些「本可以将就一下」的地方，证明它没将就。
 */

import { packAlphaPayload } from './fixtures/accounting-packs.js';
import {
  checkEvidenceRequirements,
  postEvent,
  LedgerPostingError,
  type LedgerPostingEvent,
} from '../../src/finance-ledger/ledger-posting.engine.js';

const REF = 'pack.accounting.alpha@1.0.0#digest-alpha';

const REVENUE: LedgerPostingEvent = {
  eventId: 'event-e1',
  facts: { 'event.kind': 'revenue' },
  amounts: {
    contract: '12800.00',
    invoice: '12800.00',
    settlement: '12800.00',
  },
};

describe('记账引擎 · 规则命中是 UNIQUE', () => {
  it('零命中直接拒，不静默跳过', () => {
    // 静默跳过的后果是这笔业务没进账，而没人会发现。
    expect(() =>
      postEvent(packAlphaPayload, REF, {
        ...REVENUE,
        facts: { 'event.kind': 'payroll' },
      }),
    ).toThrow(expect.objectContaining({ code: 'LEDGER_NO_RULE_MATCHED' }));
  });

  it('多条命中直接拒，不挑第一条', () => {
    // 挑第一条等于让规则在包里的书写顺序决定账怎么记，包一重排账就变了。
    const ambiguous = {
      ...packAlphaPayload,
      decisionTables: [
        {
          tableId: 'posting.service',
          rules: [
            ...packAlphaPayload.decisionTables[0].rules,
            {
              ruleId: 'rule.revenue.duplicate',
              when: [{ factKey: 'event.kind', equals: 'revenue' }],
              legs: [
                {
                  direction: 'debit',
                  subjectCode: 'S-BANK',
                  amountSource: 'invoice',
                },
                {
                  direction: 'credit',
                  subjectCode: 'S-REV',
                  amountSource: 'invoice',
                },
              ],
            },
          ],
        },
      ],
    };

    try {
      postEvent(ambiguous, REF, REVENUE);
      throw new Error('expected the ambiguous pack to be refused');
    } catch (error) {
      const refusal = error as LedgerPostingError;
      expect(refusal.code).toBe('LEDGER_AMBIGUOUS_RULE');
      expect(refusal.details?.ruleIds).toEqual([
        'rule.revenue.settled',
        'rule.revenue.duplicate',
      ]);
    }
  });

  it('多个事实键必须全部满足才算命中', () => {
    const twoClause = {
      ...packAlphaPayload,
      decisionTables: [
        {
          tableId: 'posting.service',
          rules: [
            {
              ruleId: 'rule.revenue.domestic',
              when: [
                { factKey: 'event.kind', equals: 'revenue' },
                { factKey: 'event.channel', equals: 'direct' },
              ],
              legs: packAlphaPayload.decisionTables[0].rules[0].legs,
            },
          ],
        },
      ],
    };

    // 只满足一条 -> 不命中。
    expect(() => postEvent(twoClause, REF, REVENUE)).toThrow(
      expect.objectContaining({ code: 'LEDGER_NO_RULE_MATCHED' }),
    );
    // 两条都满足 -> 命中。
    expect(
      postEvent(twoClause, REF, {
        ...REVENUE,
        facts: { 'event.kind': 'revenue', 'event.channel': 'direct' },
      }).ruleId,
    ).toBe('rule.revenue.domestic');
  });
});

describe('记账引擎 · 金额', () => {
  it('规则要的金额来源事项没有 -> 拒，并说清缺哪个来源', () => {
    try {
      postEvent(packAlphaPayload, REF, {
        ...REVENUE,
        amounts: { contract: '12800.00', invoice: '12800.00' },
      });
      throw new Error('expected the missing settlement amount to be refused');
    } catch (error) {
      const refusal = error as LedgerPostingError;
      expect(refusal.code).toBe('LEDGER_AMOUNT_SOURCE_MISSING');
      expect(refusal.details?.amountSource).toBe('settlement');
    }
  });

  it.each([
    ['三位小数', '12800.123'],
    ['带千分位', '12,800.00'],
    ['负数', '-12800.00'],
    ['非数字', 'abc'],
  ])('%s 的金额被拒，不猜', (_label, settlement) => {
    expect(() =>
      postEvent(packAlphaPayload, REF, {
        ...REVENUE,
        amounts: { ...REVENUE.amounts, settlement },
      }),
    ).toThrow(expect.objectContaining({ code: 'LEDGER_AMOUNT_INVALID' }));
  });

  it('分录不平 -> 拒，并给出差额，不替包凑平', () => {
    // 包甲的收入规则借方取到账、贷方取开票。开票 12,800 但到账 12,700
    // （差一笔手续费）是真实常态——这时缺的是第三条腿，属包的问题。
    try {
      postEvent(packAlphaPayload, REF, {
        ...REVENUE,
        amounts: { ...REVENUE.amounts, settlement: '12700.00' },
      });
      throw new Error('expected the unbalanced posting to be refused');
    } catch (error) {
      const refusal = error as LedgerPostingError;
      expect(refusal.code).toBe('LEDGER_UNBALANCED');
      expect(refusal.details).toMatchObject({
        debitTotal: '12700.00',
        creditTotal: '12800.00',
        difference: '-100.00',
      });
    }
  });

  it('两位小数精确到分', () => {
    const posting = postEvent(packAlphaPayload, REF, {
      ...REVENUE,
      amounts: { ...REVENUE.amounts, invoice: '0.07', settlement: '0.07' },
    });
    expect(posting.legs.map((leg) => leg.amount)).toEqual(['0.07', '0.07']);
  });
});

describe('记账引擎 · 包本身不合法就不开工', () => {
  it('形状不对的 payload 被包验真挡在记账之前', () => {
    expect(() => postEvent({ catalogs: [] }, REF, REVENUE)).toThrow(
      expect.objectContaining({ code: 'ACCOUNTING_PACK_INVALID' }),
    );
  });

  it('分录腿引用目录里没有的科目，包验真就拒', () => {
    const badPack = {
      ...packAlphaPayload,
      decisionTables: [
        {
          tableId: 'posting.service',
          rules: [
            {
              ruleId: 'rule.revenue.settled',
              when: [{ factKey: 'event.kind', equals: 'revenue' }],
              legs: [
                {
                  direction: 'debit',
                  subjectCode: 'S-NOT-IN-CATALOG',
                  amountSource: 'settlement',
                },
                {
                  direction: 'credit',
                  subjectCode: 'S-REV',
                  amountSource: 'invoice',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => postEvent(badPack, REF, REVENUE)).toThrow(
      expect.objectContaining({ code: 'ACCOUNTING_PACK_UNKNOWN_SUBJECT' }),
    );
  });
});

describe('记账引擎 · 证据要求由包声明', () => {
  it('齐了就是齐了', () => {
    expect(
      checkEvidenceRequirements(packAlphaPayload, 'revenue', [
        'basis',
        'settlement',
        'invoice',
      ]),
    ).toEqual({
      satisfied: true,
      requiredRoles: ['basis', 'settlement', 'invoice'],
      missingRoles: [],
    });
  });

  it('缺哪一类就报哪一类——缺口检测要回答的正是这个', () => {
    const result = checkEvidenceRequirements(packAlphaPayload, 'revenue', [
      'basis',
    ]);
    expect(result.satisfied).toBe(false);
    expect(result.missingRoles).toEqual(['settlement', 'invoice']);
  });

  it('包没为该业务形态声明要求 -> 视为满足，不由引擎自定默认', () => {
    // 真要禁止某形态，包里给它一条要求不到的角色即可，那是包的表达。
    expect(
      checkEvidenceRequirements(packAlphaPayload, 'partySettlement', []),
    ).toEqual({ satisfied: true, requiredRoles: [], missingRoles: [] });
  });
});
