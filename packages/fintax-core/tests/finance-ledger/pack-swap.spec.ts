// 来源：moneycome harness/test/unit/finance-ledger/pack-swap.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
/**
 * A2 换包测试 —— **G2 分水岭的判定内容**（`07 验收标准` §二 A2 / §三 G2）。
 *
 * 这套方案的核心赌注是「事实进表、规则进包」。赌注真假只有一个硬指标：同一组
 * 会计事实，换一份领域规则包，能不能推出不同且各自正确的分录，而引擎代码
 * 一行不改。
 *
 * 本文件的三条断言就是 07 §A2 的三条：
 *
 * 1. 同一笔业务事项，两个包推出**不同的**分录
 * 2. 两个包各自的结果与各自的期望一致
 * 3. 两次运行之间，L1 表结构与 L3 引擎代码 diff 为空
 *
 * 第 3 条在代码里的表达方式：下面的 `derive` 只接受 `pack` 一个参数——两次
 * 调用之间**唯一的变量就是包**。若哪天需要给引擎加个「这是包甲还是包乙」的
 * 分支才能跑通，这个签名就写不出来，分层当场露馅。
 *
 * 失败处置（07 §三 G2）：**停止后续批次，回到 L1 建模。**这是唯一一条不允许
 * 「先记着后面修」的验收。
 */

import { packAlphaPayload, packBetaPayload } from './fixtures/accounting-packs.js';
import {
  checkEvidenceRequirements,
  postEvent,
  type LedgerPosting,
  type LedgerPostingEvent,
} from '../../src/finance-ledger/ledger-posting.engine.js';

const PACK_ALPHA_REF = 'pack.accounting.alpha@1.0.0#digest-alpha';
const PACK_BETA_REF = 'pack.accounting.beta@1.0.0#digest-beta';

/**
 * 样本 E1：甲客户「新零售增长咨询」12,800。标准完整链——合同、履行、到账、
 * 开票全齐，三处金额一致。
 */
const REVENUE_EVENT: LedgerPostingEvent = {
  eventId: 'event-e1',
  facts: { 'event.kind': 'revenue' },
  amounts: {
    contract: '12800.00',
    invoice: '12800.00',
    settlement: '12800.00',
  },
};

/** 样本 E5：项目管理软件年度订阅 1,200，公司账户直接付。 */
const EXPENSE_EVENT: LedgerPostingEvent = {
  eventId: 'event-e5',
  facts: { 'event.kind': 'expense' },
  amounts: { invoice: '1200.00', settlement: '1200.00' },
};

/** 归一成便于比对的形状。 */
function shape(posting: LedgerPosting) {
  return {
    ruleId: posting.ruleId,
    packRef: posting.packRef,
    legs: posting.legs.map((leg) => ({
      direction: leg.direction,
      subjectCode: leg.subjectCode,
      subjectName: leg.subjectName,
      amount: leg.amount,
      amountSource: leg.amountSource,
    })),
  };
}

describe('A2 换包测试 · G2 分水岭', () => {
  describe('断言 1 · 同一笔事项，两个包推出不同的分录', () => {
    it('收入事项：包甲直接进银行，包乙先挂应收', () => {
      const derive = (pack: unknown, ref: string) =>
        shape(postEvent(pack, ref, REVENUE_EVENT));

      const alpha = derive(packAlphaPayload, PACK_ALPHA_REF);
      const beta = derive(packBetaPayload, PACK_BETA_REF);

      expect(alpha).not.toEqual(beta);
      // 差异不只是科目号换了皮——命中的规则、借方科目、取的金额来源都不同。
      expect(alpha.ruleId).not.toBe(beta.ruleId);
      expect(alpha.legs[0].subjectCode).not.toBe(beta.legs[0].subjectCode);
      expect(alpha.legs[0].amountSource).not.toBe(beta.legs[0].amountSource);
    });

    it('支出事项：科目目录整套不同', () => {
      const alpha = shape(
        postEvent(packAlphaPayload, PACK_ALPHA_REF, EXPENSE_EVENT),
      );
      const beta = shape(
        postEvent(packBetaPayload, PACK_BETA_REF, EXPENSE_EVENT),
      );

      expect(alpha).not.toEqual(beta);
      expect(alpha.legs.map((leg) => leg.subjectName)).not.toEqual(
        beta.legs.map((leg) => leg.subjectName),
      );
    });

    it('证据要求也随包换：同一组证据，包甲够、包乙不够', () => {
      const presentRoles = ['basis', 'settlement', 'invoice'];

      const alpha = checkEvidenceRequirements(
        packAlphaPayload,
        'revenue',
        presentRoles,
      );
      const beta = checkEvidenceRequirements(
        packBetaPayload,
        'revenue',
        presentRoles,
      );

      expect(alpha.satisfied).toBe(true);
      expect(beta.satisfied).toBe(false);
      expect(beta.missingRoles).toEqual(['performance']);
    });
  });

  describe('断言 2 · 各自的结果与各自的期望一致', () => {
    it('包甲 · 收入：借银行存款（取到账）/ 贷主营业务收入（取开票）', () => {
      expect(
        shape(postEvent(packAlphaPayload, PACK_ALPHA_REF, REVENUE_EVENT)),
      ).toEqual({
        ruleId: 'rule.revenue.settled',
        packRef: PACK_ALPHA_REF,
        legs: [
          {
            direction: 'debit',
            subjectCode: 'S-BANK',
            subjectName: '银行存款',
            amount: '12800.00',
            amountSource: 'settlement',
          },
          {
            direction: 'credit',
            subjectCode: 'S-REV',
            subjectName: '主营业务收入',
            amount: '12800.00',
            amountSource: 'invoice',
          },
        ],
      });
    });

    it('包乙 · 收入：借应收账款 / 贷商品销售收入，两腿都取合同', () => {
      expect(
        shape(postEvent(packBetaPayload, PACK_BETA_REF, REVENUE_EVENT)),
      ).toEqual({
        ruleId: 'rule.sales.on_account',
        packRef: PACK_BETA_REF,
        legs: [
          {
            direction: 'debit',
            subjectCode: 'T-RECEIVABLE',
            subjectName: '应收账款',
            amount: '12800.00',
            amountSource: 'contract',
          },
          {
            direction: 'credit',
            subjectCode: 'T-SALES',
            subjectName: '商品销售收入',
            amount: '12800.00',
            amountSource: 'contract',
          },
        ],
      });
    });

    it('包甲 · 支出：借管理费用 / 贷银行存款', () => {
      expect(
        shape(postEvent(packAlphaPayload, PACK_ALPHA_REF, EXPENSE_EVENT)),
      ).toEqual({
        ruleId: 'rule.expense.office',
        packRef: PACK_ALPHA_REF,
        legs: [
          {
            direction: 'debit',
            subjectCode: 'S-ADMIN',
            subjectName: '管理费用',
            amount: '1200.00',
            amountSource: 'invoice',
          },
          {
            direction: 'credit',
            subjectCode: 'S-BANK',
            subjectName: '银行存款',
            amount: '1200.00',
            amountSource: 'settlement',
          },
        ],
      });
    });

    it('包乙 · 支出：借营业费用 / 贷货币资金', () => {
      expect(
        shape(postEvent(packBetaPayload, PACK_BETA_REF, EXPENSE_EVENT)),
      ).toEqual({
        ruleId: 'rule.opex.paid',
        packRef: PACK_BETA_REF,
        legs: [
          {
            direction: 'debit',
            subjectCode: 'T-OPEX',
            subjectName: '营业费用',
            amount: '1200.00',
            amountSource: 'invoice',
          },
          {
            direction: 'credit',
            subjectCode: 'T-CASH',
            subjectName: '货币资金',
            amount: '1200.00',
            amountSource: 'settlement',
          },
        ],
      });
    });

    it('两个包的分录各自借贷平衡', () => {
      for (const [pack, ref] of [
        [packAlphaPayload, PACK_ALPHA_REF],
        [packBetaPayload, PACK_BETA_REF],
      ] as const) {
        for (const event of [REVENUE_EVENT, EXPENSE_EVENT]) {
          const posting = postEvent(pack, ref, event);
          const sum = (direction: 'debit' | 'credit') =>
            posting.legs
              .filter((leg) => leg.direction === direction)
              .reduce((total, leg) => total + Number(leg.amount), 0);
          expect(sum('debit')).toBe(sum('credit'));
        }
      }
    });
  });

  describe('断言 3 · 换包不需要改代码', () => {
    it('两次推导之间唯一的变量就是包', () => {
      // 这个函数只吃 pack。若引擎需要「这是哪个包」的分支才能跑通，
      // 下面这个签名根本写不出来。
      const derive = (pack: unknown) =>
        postEvent(pack, 'pack@1.0.0#d', REVENUE_EVENT).legs.map(
          (leg) => `${leg.direction}:${leg.subjectCode}:${leg.amount}`,
        );

      expect(derive(packAlphaPayload)).toEqual([
        'debit:S-BANK:12800.00',
        'credit:S-REV:12800.00',
      ]);
      expect(derive(packBetaPayload)).toEqual([
        'debit:T-RECEIVABLE:12800.00',
        'credit:T-SALES:12800.00',
      ]);
    });

    it('引擎对包内容零假设：新增一份包不需要登记任何白名单', () => {
      // 拿包甲改个科目目录当"第三份包"，引擎照跑——没有任何 packId 枚举。
      //
      // 报表行必须跟着换。原来只换 catalogs 与 decisionTables，把甲的报表行
      // 连同它引用的 S-REV 一起继承下来，而丙的目录里只有 X-1/X-2——
      // 契约那道「报表行引用的科目必须在目录里」直接拒包。装到一起才暴露：
      // 这道校验是后面的分支加的，ledger-engine 分支单独跑时还不存在。
      const packGamma = {
        ...packAlphaPayload,
        catalogs: [
          {
            catalogId: 'third.minimal.report-lines',
            kind: 'report_lines',
            lines: [
              {
                reportId: 'report.profit',
                lineId: 'line.revenue',
                lineName: '营业收入',
                sign: 'positive',
                subjectCodes: ['X-2'],
              },
            ],
          },
          {
            catalogId: 'third.minimal.closing-items',
            kind: 'closing_items',
            items: [
              {
                itemId: 'closing.pl_transfer',
                itemName: '损益结转',
                requiredWhen: [],
              },
            ],
          },
          {
            catalogId: 'third.minimal',
            kind: 'subjects',
            subjects: [
              {
                subjectCode: 'X-1',
                subjectName: '现金',
                normalBalance: 'debit',
              },
              {
                subjectCode: 'X-2',
                subjectName: '收入',
                normalBalance: 'credit',
              },
            ],
          },
        ],
        decisionTables: [
          {
            tableId: 'posting.third',
            rules: [
              {
                ruleId: 'rule.third.revenue',
                when: [{ factKey: 'event.kind', equals: 'revenue' }],
                legs: [
                  {
                    direction: 'debit',
                    subjectCode: 'X-1',
                    amountSource: 'invoice',
                  },
                  {
                    direction: 'credit',
                    subjectCode: 'X-2',
                    amountSource: 'invoice',
                  },
                ],
              },
            ],
          },
        ],
      };

      const posting = postEvent(packGamma, 'pack.gamma@1.0.0#d', REVENUE_EVENT);
      expect(posting.ruleId).toBe('rule.third.revenue');
      expect(posting.legs.map((leg) => leg.subjectName)).toEqual([
        '现金',
        '收入',
      ]);
    });
  });
});
