// 来源：moneycome harness/test/unit/finance-ledger/fixtures/accounting-packs.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
/**
 * 换包 fixture：两份**结构相同、内容不同**的会计域包（信封形状，可直接放进
 * specialization-pack 的 artifact.payload）。
 *
 * 这两份 fixture 刻意先于记账引擎（B3）写出。它逼实现方在建表之前回答一个
 * 问题：**哪些东西必须能换。**答案就是这里的差异面——科目目录、记账规则、
 * 证据要求、参数、依据，全部在包里；引擎只做遍历与判定。
 *
 * 包乙不需要会计正确，只需结构合法、内容与包甲不同（`docs/modules/
 * fintax-accounting-slice-v1.md` §6：切片验的是包能不能换，不是包对不对）。
 */

/** 包甲：服务业形态。第一版按公开准则编写，**未经专业审核**。 */
export const packAlphaPayload = {
  catalogs: [
    {
      catalogId: 'service.minimal',
      kind: 'subjects',
      subjects: [
        {
          subjectCode: 'S-BANK',
          subjectName: '银行存款',
          normalBalance: 'debit',
        },
        {
          subjectCode: 'S-REV',
          subjectName: '主营业务收入',
          normalBalance: 'credit',
        },
        {
          subjectCode: 'S-TAX-PAYABLE',
          subjectName: '应交税费',
          normalBalance: 'credit',
        },
        {
          subjectCode: 'S-ADMIN',
          subjectName: '管理费用',
          normalBalance: 'debit',
        },
      ],
    },
    {
      catalogId: 'service.minimal.report-lines',
      kind: 'report_lines',
      lines: [
        {
          reportId: 'report.profit',
          lineId: 'line.revenue',
          lineName: '营业收入',
          sign: 'positive',
          subjectCodes: ['S-REV'],
        },
        {
          reportId: 'report.profit',
          lineId: 'line.admin',
          lineName: '管理费用',
          sign: 'positive',
          subjectCodes: ['S-ADMIN'],
        },
      ],
    },
    {
      catalogId: 'service.minimal.closing-items',
      kind: 'closing_items',
      items: [
        {
          itemId: 'closing.pl_transfer',
          itemName: '损益结转',
          requiredWhen: [],
        },
      ],
    },
  ],
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
              subjectCode: 'S-BANK',
              amountSource: 'settlement',
            },
            {
              direction: 'credit',
              subjectCode: 'S-REV',
              amountSource: 'invoice',
            },
          ],
        },
        {
          ruleId: 'rule.expense.office',
          when: [{ factKey: 'event.kind', equals: 'expense' }],
          legs: [
            {
              direction: 'debit',
              subjectCode: 'S-ADMIN',
              amountSource: 'invoice',
            },
            {
              direction: 'credit',
              subjectCode: 'S-BANK',
              amountSource: 'settlement',
            },
          ],
        },
      ],
    },
  ],
  evidenceRequirements: [
    { eventKind: 'revenue', requiredRoles: ['basis', 'settlement', 'invoice'] },
    { eventKind: 'expense', requiredRoles: ['invoice', 'settlement'] },
  ],
  parameters: [{ parameterId: 'voucher.granularity', value: 'per_event' }],
  sources: [
    { sourceId: 'src.alpha', citation: '公开准则第一版，未经专业审核' },
  ],
} as const;

/**
 * 包乙：虚构的贸易型形态，**仅用于换包测试**。
 *
 * 与包甲的差异刻意覆盖四个面：科目号与科目名不同、同一业务形态命中不同的
 * 记账规则、证据要求不同、凭证粗细参数不同。任何一面被写死进代码，这份包
 * 就换不进去。
 */
export const packBetaPayload = {
  catalogs: [
    {
      catalogId: 'trading.minimal',
      kind: 'subjects',
      subjects: [
        {
          subjectCode: 'T-CASH',
          subjectName: '货币资金',
          normalBalance: 'debit',
        },
        {
          subjectCode: 'T-SALES',
          subjectName: '商品销售收入',
          normalBalance: 'credit',
        },
        {
          subjectCode: 'T-RECEIVABLE',
          subjectName: '应收账款',
          normalBalance: 'debit',
        },
        {
          subjectCode: 'T-OPEX',
          subjectName: '营业费用',
          normalBalance: 'debit',
        },
      ],
    },
    // 第五个差异面：同一张利润表，包乙的行名与取数科目都不同，且多一项期末计提。
    {
      catalogId: 'trading.minimal.report-lines',
      kind: 'report_lines',
      lines: [
        {
          reportId: 'report.profit',
          lineId: 'line.sales',
          lineName: '商品销售收入',
          sign: 'positive',
          subjectCodes: ['T-SALES'],
        },
        {
          reportId: 'report.profit',
          lineId: 'line.opex',
          lineName: '营业费用',
          sign: 'positive',
          subjectCodes: ['T-OPEX'],
        },
      ],
    },
    {
      catalogId: 'trading.minimal.closing-items',
      kind: 'closing_items',
      items: [
        {
          itemId: 'closing.pl_transfer',
          itemName: '损益结转',
          requiredWhen: [],
        },
        {
          itemId: 'closing.bad_debt',
          itemName: '坏账准备计提',
          requiredWhen: [{ factKey: 'entity.has_receivable', equals: 'yes' }],
        },
      ],
    },
  ],
  decisionTables: [
    {
      tableId: 'posting.trading',
      rules: [
        {
          // 同一个 event.kind=revenue，包乙先挂应收再结算，与包甲直接进银行不同。
          ruleId: 'rule.sales.on_account',
          when: [{ factKey: 'event.kind', equals: 'revenue' }],
          legs: [
            {
              direction: 'debit',
              subjectCode: 'T-RECEIVABLE',
              amountSource: 'contract',
            },
            {
              direction: 'credit',
              subjectCode: 'T-SALES',
              amountSource: 'contract',
            },
          ],
        },
        {
          ruleId: 'rule.opex.paid',
          when: [{ factKey: 'event.kind', equals: 'expense' }],
          legs: [
            {
              direction: 'debit',
              subjectCode: 'T-OPEX',
              amountSource: 'invoice',
            },
            {
              direction: 'credit',
              subjectCode: 'T-CASH',
              amountSource: 'settlement',
            },
          ],
        },
      ],
    },
  ],
  evidenceRequirements: [
    { eventKind: 'revenue', requiredRoles: ['basis', 'performance'] },
    { eventKind: 'expense', requiredRoles: ['invoice'] },
  ],
  parameters: [{ parameterId: 'voucher.granularity', value: 'daily_merged' }],
  sources: [{ sourceId: 'src.beta', citation: '虚构对照包，仅用于换包测试' }],
} as const;
