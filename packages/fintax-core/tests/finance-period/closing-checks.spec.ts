// 来源：moneycome harness/test/unit/finance-period/closing-checks.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
import {
  CLOSING_CHECK_IDS,
  runClosingChecks,
  type ClosingCheckInput,
} from '../../src/finance-period/closing-checks.js';

/** 一份六项全过的输入。每条用例只改它关心的那一块。 */
function passing(over: Partial<ClosingCheckInput> = {}): ClosingCheckInput {
  return {
    periodRange: { from: '2026-03-01', to: '2026-03-31' },
    previousPeriod: { kind: 'locked', periodKey: '2026-02' },
    accounts: [
      {
        accountRef: 'acct.icbc',
        coveredRanges: [{ from: '2026-03-01', to: '2026-03-31' }],
      },
    ],
    unexplainedTransactionRefs: [],
    events: [
      {
        eventRef: 'E1',
        eventKind: 'revenue',
        postingIssue: null,
        evidenceRoles: ['invoice'],
      },
    ],
    vouchers: [
      { voucherRef: 'PZ-1', debitMinor: 1_280_000n, creditMinor: 1_280_000n },
    ],
    completedClosingItemIds: ['closing.pl_transfer'],
    entityFacts: {},
    pack: {
      evidenceRequirements: [
        { eventKind: 'revenue', requiredRoles: ['invoice'] },
      ],
      closingItems: [
        {
          itemId: 'closing.pl_transfer',
          itemName: '损益结转',
          requiredWhen: [],
        },
      ],
    },
    ...over,
  };
}

function failed(input: ClosingCheckInput) {
  return runClosingChecks(input)
    .checks.filter((c) => !c.passed)
    .map((c) => c.checkId);
}

describe('结账六项检查', () => {
  it.each(['unposted', 'settlement_mismatch'] as const)(
    '已关联流水 %s 仍阻断，且不要求重新解释',
    (reason) => {
      const issue = {
        transactionRef: 'T1',
        linkedEventRefs: ['E1', 'E2'],
        reason,
      };
      const report = runClosingChecks(
        passing({ linkedSettlementIssues: [issue] }),
      );
      expect(report.canClose).toBe(false);
      expect(
        report.checks.find((c) => c.checkId === 'funds_explained')?.blockers,
      ).toEqual([{ kind: 'linked_transaction_unsettled', ...issue }]);
    },
  );
  describe('六项固定在代码里（D19 / 验收 N7）', () => {
    it('恒返回六条，顺序固定', () => {
      const report = runClosingChecks(passing());

      expect(report.checks.map((c) => c.checkId)).toEqual(CLOSING_CHECK_IDS);
      expect(report.checks).toHaveLength(6);
    });

    it('包只声明一项期末必做，第 6 项照样执行并挡住跳期', () => {
      const report = runClosingChecks(
        passing({ previousPeriod: { kind: 'open', periodKey: '2026-02' } }),
      );

      expect(report.canClose).toBe(false);
      expect(
        report.checks.find((c) => c.checkId === 'previous_period_locked')
          ?.blockers,
      ).toEqual([{ kind: 'previous_period_open', periodKey: '2026-02' }]);
    });

    it('第一个账期没有上期，不挡', () => {
      const report = runClosingChecks(
        passing({ previousPeriod: { kind: 'first_period' } }),
      );

      expect(report.canClose).toBe(true);
    });

    it('六项全过才 canClose', () => {
      expect(runClosingChecks(passing()).canClose).toBe(true);
    });
  });

  it.each(['unposted', 'review_required', 'rule_undetermined'] as const)(
    '即使证据齐且凭证平，%s 仍在第 4 项阻断',
    (postingIssue) => {
      const input = passing();
      const report = runClosingChecks({
        ...input,
        events: input.events.map((e) => ({ ...e, postingIssue })),
      });
      expect(report.canClose).toBe(false);
      expect(report.checks.filter((c) => !c.passed)).toEqual([
        {
          checkId: 'ledger_balanced',
          passed: false,
          responsibility: 'system',
          blockers: [
            { kind: 'event_not_ready', eventRef: 'E1', reason: postingIssue },
          ],
        },
      ]);
    },
  );

  describe('一次全查，不短路（验收 N8）', () => {
    it('三项同时不过，三条都报出来', () => {
      const ids = failed(
        passing({
          unexplainedTransactionRefs: ['T9'],
          vouchers: [
            { voucherRef: 'PZ-1', debitMinor: 100n, creditMinor: 99n },
          ],
          previousPeriod: { kind: 'open', periodKey: '2026-02' },
        }),
      );

      expect(ids).toEqual([
        'funds_explained',
        'ledger_balanced',
        'previous_period_locked',
      ]);
    });

    it('过了的那几项 blockers 为空', () => {
      const report = runClosingChecks(
        passing({ unexplainedTransactionRefs: ['T9'] }),
      );

      for (const check of report.checks) {
        expect(check.blockers.length === 0).toBe(check.passed);
      }
    });
  });

  describe('1 流水完整', () => {
    it('中间缺一段 → 报出缺的起止日', () => {
      const report = runClosingChecks(
        passing({
          accounts: [
            {
              accountRef: 'acct.icbc',
              coveredRanges: [
                { from: '2026-03-01', to: '2026-03-15' },
                { from: '2026-03-20', to: '2026-03-31' },
              ],
            },
          ],
        }),
      );

      expect(report.checks[0].blockers).toEqual([
        {
          kind: 'statement_gap',
          accountRef: 'acct.icbc',
          from: '2026-03-16',
          to: '2026-03-19',
        },
      ]);
    });

    it('两段首尾相接不算缺口', () => {
      const report = runClosingChecks(
        passing({
          accounts: [
            {
              accountRef: 'acct.icbc',
              coveredRanges: [
                { from: '2026-03-01', to: '2026-03-15' },
                { from: '2026-03-16', to: '2026-03-31' },
              ],
            },
          ],
        }),
      );

      expect(report.checks[0].passed).toBe(true);
    });

    it('乱序与重叠的多段照样合并', () => {
      const report = runClosingChecks(
        passing({
          accounts: [
            {
              accountRef: 'acct.icbc',
              coveredRanges: [
                { from: '2026-03-10', to: '2026-03-31' },
                { from: '2026-03-01', to: '2026-03-20' },
              ],
            },
          ],
        }),
      );

      expect(report.checks[0].passed).toBe(true);
    });

    it('月初与月末各缺一截，两条都报', () => {
      const report = runClosingChecks(
        passing({
          accounts: [
            {
              accountRef: 'acct.icbc',
              coveredRanges: [{ from: '2026-03-05', to: '2026-03-28' }],
            },
          ],
        }),
      );

      expect(report.checks[0].blockers).toEqual([
        {
          kind: 'statement_gap',
          accountRef: 'acct.icbc',
          from: '2026-03-01',
          to: '2026-03-04',
        },
        {
          kind: 'statement_gap',
          accountRef: 'acct.icbc',
          from: '2026-03-29',
          to: '2026-03-31',
        },
      ]);
    });

    it('一段都没导 → 整月都是缺口', () => {
      const report = runClosingChecks(
        passing({
          accounts: [{ accountRef: 'acct.icbc', coveredRanges: [] }],
        }),
      );

      expect(report.checks[0].blockers).toEqual([
        {
          kind: 'statement_gap',
          accountRef: 'acct.icbc',
          from: '2026-03-01',
          to: '2026-03-31',
        },
      ]);
    });

    it('覆盖超出期间不算问题，只看期间内', () => {
      const report = runClosingChecks(
        passing({
          accounts: [
            {
              accountRef: 'acct.icbc',
              coveredRanges: [{ from: '2026-02-01', to: '2026-04-30' }],
            },
          ],
        }),
      );

      expect(report.checks[0].passed).toBe(true);
    });

    it('逐账户各报各的——两个账户都有缺口', () => {
      const report = runClosingChecks(
        passing({
          accounts: [
            { accountRef: 'acct.icbc', coveredRanges: [] },
            { accountRef: 'acct.cmb', coveredRanges: [] },
          ],
        }),
      );

      expect(report.checks[0].blockers).toHaveLength(2);
    });

    it('日期不是真实日历日 → 抛错，不静默折成别的日子', () => {
      expect(() =>
        runClosingChecks(
          passing({ periodRange: { from: '2026-02-31', to: '2026-03-31' } }),
        ),
      ).toThrow(RangeError);
    });

    it('日期格式不对 → 抛错', () => {
      expect(() =>
        runClosingChecks(
          passing({ periodRange: { from: '2026/03/01', to: '2026-03-31' } }),
        ),
      ).toThrow(RangeError);
    });
  });

  describe('3 证据齐', () => {
    it('缺哪几类角色就报哪几类', () => {
      const report = runClosingChecks(
        passing({
          events: [
            {
              eventRef: 'E1',
              eventKind: 'revenue',
              postingIssue: null,
              evidenceRoles: ['basis'],
            },
          ],
          pack: {
            evidenceRequirements: [
              {
                eventKind: 'revenue',
                requiredRoles: ['basis', 'invoice', 'settlement'],
              },
            ],
            closingItems: [
              {
                itemId: 'closing.pl_transfer',
                itemName: '损益结转',
                requiredWhen: [],
              },
            ],
          },
        }),
      );

      expect(report.checks[2].blockers).toEqual([
        {
          kind: 'evidence_missing',
          eventRef: 'E1',
          missingRoles: ['invoice', 'settlement'],
        },
      ]);
    });

    it('包里没声明这类业务的证据要求 → 不放行', () => {
      const report = runClosingChecks(
        passing({
          events: [
            {
              eventRef: 'E9',
              eventKind: 'donation',
              postingIssue: null,
              evidenceRoles: [],
            },
          ],
        }),
      );

      // 「没要求所以都满足」是静默通过；挡住是可修的——补一条包声明即可。
      expect(report.checks[2].blockers).toEqual([
        {
          kind: 'evidence_requirement_absent',
          eventRef: 'E9',
          eventKind: 'donation',
        },
      ]);
    });

    it('多带了不要求的角色不算问题', () => {
      const report = runClosingChecks(
        passing({
          events: [
            {
              eventRef: 'E1',
              eventKind: 'revenue',
              postingIssue: null,
              evidenceRoles: ['invoice', 'basis', 'settlement'],
            },
          ],
        }),
      );

      expect(report.checks[2].passed).toBe(true);
    });
  });

  describe('4 分录平：逐凭证、逐分比较，没有大致平', () => {
    it('一张凭证差一分也不过，报出是哪一张', () => {
      const report = runClosingChecks(
        passing({
          vouchers: [
            {
              voucherRef: 'PZ-202603-011',
              debitMinor: 1_280_000n,
              creditMinor: 1_279_999n,
            },
          ],
        }),
      );

      expect(report.checks[3].blockers).toEqual([
        {
          kind: 'voucher_unbalanced',
          voucherRef: 'PZ-202603-011',
          debitMinor: 1_280_000n,
          creditMinor: 1_279_999n,
        },
      ]);
    });

    it('验收 N11：两张互相抵消的不平凭证，期间合计相等也不过', () => {
      // 这条是本检查存在的理由。A 多借 100、B 多贷 100，期间合计严丝合缝——
      // 初版按期间合计判定，这种 compensating error 结构性地看不见。
      const report = runClosingChecks(
        passing({
          vouchers: [
            { voucherRef: 'PZ-A', debitMinor: 100_100n, creditMinor: 100_000n },
            { voucherRef: 'PZ-B', debitMinor: 100_000n, creditMinor: 100_100n },
          ],
        }),
      );

      const totalDebit = 100_100n + 100_000n;
      const totalCredit = 100_000n + 100_100n;
      expect(totalDebit).toBe(totalCredit);

      expect(report.checks[3].passed).toBe(false);
      expect(
        report.checks[3].blockers.map((b) =>
          b.kind === 'voucher_unbalanced' ? b.voucherRef : b.kind,
        ),
      ).toEqual(['PZ-A', 'PZ-B']);
    });

    it('一张凭证两边都是零算平', () => {
      const report = runClosingChecks(
        passing({
          vouchers: [{ voucherRef: 'PZ-0', debitMinor: 0n, creditMinor: 0n }],
        }),
      );

      expect(report.checks[3].passed).toBe(true);
    });

    it('一张凭证都没有算平——空账期不该被这一项挡住', () => {
      const report = runClosingChecks(passing({ vouchers: [] }));

      expect(report.checks[3].passed).toBe(true);
    });
  });

  describe('5 计提结转已做', () => {
    const packWith = (
      items: ClosingCheckInput['pack']['closingItems'],
    ): ClosingCheckInput['pack'] => ({
      evidenceRequirements: [
        { eventKind: 'revenue', requiredRoles: ['invoice'] },
      ],
      closingItems: items,
    });

    it('无条件项没做 → 挡', () => {
      const report = runClosingChecks(passing({ completedClosingItemIds: [] }));

      expect(report.checks[4].blockers).toEqual([
        { kind: 'closing_item_pending', itemId: 'closing.pl_transfer' },
      ]);
    });

    it('条件不命中的项不做也不挡', () => {
      const report = runClosingChecks(
        passing({
          completedClosingItemIds: [],
          entityFacts: { 'entity.has_fixed_asset': 'no' },
          pack: packWith([
            {
              itemId: 'closing.depreciation',
              itemName: '固定资产折旧',
              requiredWhen: [
                { factKey: 'entity.has_fixed_asset', equals: 'yes' },
              ],
            },
          ]),
        }),
      );

      expect(report.checks[4].passed).toBe(true);
    });

    it('条件命中且没做 → 挡', () => {
      const report = runClosingChecks(
        passing({
          completedClosingItemIds: [],
          entityFacts: { 'entity.has_fixed_asset': 'yes' },
          pack: packWith([
            {
              itemId: 'closing.depreciation',
              itemName: '固定资产折旧',
              requiredWhen: [
                { factKey: 'entity.has_fixed_asset', equals: 'yes' },
              ],
            },
          ]),
        }),
      );

      expect(report.checks[4].blockers).toEqual([
        { kind: 'closing_item_pending', itemId: 'closing.depreciation' },
      ]);
    });

    it('多条件要全命中才算适用', () => {
      const report = runClosingChecks(
        passing({
          completedClosingItemIds: [],
          entityFacts: {
            'entity.has_fixed_asset': 'yes',
            'period.kind': 'quarter',
          },
          pack: packWith([
            {
              itemId: 'closing.depreciation',
              itemName: '固定资产折旧',
              requiredWhen: [
                { factKey: 'entity.has_fixed_asset', equals: 'yes' },
                { factKey: 'period.kind', equals: 'month' },
              ],
            },
          ]),
        }),
      );

      expect(report.checks[4].passed).toBe(true);
    });

    it('事实没登记 → 单独一种卡点，不当作不用做', () => {
      const report = runClosingChecks(
        passing({
          completedClosingItemIds: [],
          entityFacts: {},
          pack: packWith([
            {
              itemId: 'closing.depreciation',
              itemName: '固定资产折旧',
              requiredWhen: [
                { factKey: 'entity.has_fixed_asset', equals: 'yes' },
              ],
            },
          ]),
        }),
      );

      // 报成「折旧没做」对没有固定资产的公司是句莫名其妙的话；报成「这项事实
      // 没登记」既挡得住也说得清该去做什么。
      expect(report.checks[4].blockers).toEqual([
        {
          kind: 'entity_fact_unknown',
          itemId: 'closing.depreciation',
          factKey: 'entity.has_fixed_asset',
        },
      ]);
    });
  });
});
