// 来源：moneycome harness/test/unit/finance-disclosure/figure-certainty.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
import {
  assessFigure,
  type FigureInput,
  type PendingFact,
} from '../../src/finance-disclosure/figure-certainty.js';

function input(over: Partial<FigureInput> = {}): FigureInput {
  return {
    openingBalanceVerified: true,
    previousPeriodLocked: true,
    periodLocked: false,
    pendingFacts: [],
    ...over,
  };
}

const fact = (
  ref: string,
  category: PendingFact['category'],
  yuan: number,
): PendingFact => ({
  ref,
  category,
  amountMinor: BigInt(yuan) * 100n,
});

describe('老板面数字成色', () => {
  describe('算不出就不出数（验收 N10）', () => {
    it('期初未核验 → unavailable', () => {
      expect(assessFigure(input({ openingBalanceVerified: false }))).toEqual({
        kind: 'unavailable',
        reason: 'opening_balance_unverified',
      });
    });

    it('上期未锁 → unavailable，与结账第 6 项同一条理由', () => {
      expect(assessFigure(input({ previousPeriodLocked: false }))).toEqual({
        kind: 'unavailable',
        reason: 'previous_period_unlocked',
      });
    });

    it('unavailable 不带任何金额字段——灰色的数也是数', () => {
      const certainty = assessFigure(
        input({
          openingBalanceVerified: false,
          pendingFacts: [fact('P1', 'missing_invoice_for_payment', 6800)],
        }),
      );

      expect(Object.keys(certainty).sort()).toEqual(['kind', 'reason']);
    });

    it('期初未核验优先于上期未锁——前者更根本', () => {
      const certainty = assessFigure(
        input({ openingBalanceVerified: false, previousPeriodLocked: false }),
      );

      expect(certainty).toMatchObject({ reason: 'opening_balance_unverified' });
    });

    it('账期已锁也不能盖过期初未核验', () => {
      const certainty = assessFigure(
        input({ openingBalanceVerified: false, periodLocked: true }),
      );

      expect(certainty.kind).toBe('unavailable');
    });
  });

  describe('账期已锁 = settled', () => {
    it('锁了就不再动', () => {
      expect(assessFigure(input({ periodLocked: true }))).toEqual({
        kind: 'settled',
      });
    });

    it('锁了之后还有待办事实也是 settled——不让已定的数看起来还在飘', () => {
      const certainty = assessFigure(
        input({
          periodLocked: true,
          pendingFacts: [fact('P1', 'missing_invoice_for_payment', 6800)],
        }),
      );

      expect(certainty).toEqual({ kind: 'settled' });
    });
  });

  describe('方向是数出来的', () => {
    it('缺票与该计提未计提都只往下', () => {
      const certainty = assessFigure(
        input({
          pendingFacts: [
            fact('P1', 'missing_invoice_for_payment', 6800),
            fact('P2', 'accrual_not_posted', 1200),
          ],
        }),
      );

      expect(certainty).toMatchObject({
        kind: 'moving',
        downMinor: 800_000n,
        upMinor: 0n,
        undeterminedMinor: 0n,
      });
    });

    it('已开票未入账只往上', () => {
      const certainty = assessFigure(
        input({ pendingFacts: [fact('P3', 'invoiced_not_posted', 5000)] }),
      );

      expect(certainty).toMatchObject({ upMinor: 500_000n, downMinor: 0n });
    });

    it('未认领到账单独成档，绝不当收入算（验收 N9）', () => {
      const certainty = assessFigure(
        input({ pendingFacts: [fact('P4', 'unclaimed_receipt', 12000)] }),
      );

      // 可能是收入，也可能是借款、退款——13 §3.3 ⑩：资金形态有六种归宿。
      expect(certainty).toMatchObject({
        upMinor: 0n,
        downMinor: 0n,
        undeterminedMinor: 1_200_000n,
      });
    });

    it('三档互斥：同一笔只进一档', () => {
      const facts = [
        fact('P1', 'missing_invoice_for_payment', 6800),
        fact('P2', 'accrual_not_posted', 1200),
        fact('P3', 'invoiced_not_posted', 5000),
        fact('P4', 'unclaimed_receipt', 12000),
      ];
      const certainty = assessFigure(input({ pendingFacts: facts }));

      if (certainty.kind !== 'moving') throw new Error('expected moving');
      const total =
        certainty.downMinor + certainty.upMinor + certainty.undeterminedMinor;
      expect(total).toBe(facts.reduce((sum, f) => sum + f.amountMinor, 0n));
    });

    it('openRefs 含全部待办，一件都不漏', () => {
      const certainty = assessFigure(
        input({
          pendingFacts: [
            fact('P1', 'missing_invoice_for_payment', 6800),
            fact('P4', 'unclaimed_receipt', 12000),
          ],
        }),
      );

      expect(certainty).toMatchObject({ openRefs: ['P1', 'P4'] });
    });
  });

  describe('没锁就是会动，哪怕此刻没有待办', () => {
    it('零待办仍是 moving，不是 settled', () => {
      expect(assessFigure(input())).toEqual({
        kind: 'moving',
        downMinor: 0n,
        upMinor: 0n,
        undeterminedMinor: 0n,
        openRefs: [],
      });
    });
  });

  describe('入参校验', () => {
    it('负数金额 → 抛错，方向由类别定不由正负号定', () => {
      expect(() =>
        assessFigure(
          input({
            pendingFacts: [
              {
                ref: 'P1',
                category: 'missing_invoice_for_payment',
                amountMinor: -100n,
              },
            ],
          }),
        ),
      ).toThrow(RangeError);
    });
  });

  describe('可复算', () => {
    it('同一份输入两次得同一结果', () => {
      const shared = input({
        pendingFacts: [
          fact('P1', 'missing_invoice_for_payment', 6800),
          fact('P4', 'unclaimed_receipt', 12000),
        ],
      });

      expect(assessFigure(shared)).toEqual(assessFigure(shared));
    });
  });
});
