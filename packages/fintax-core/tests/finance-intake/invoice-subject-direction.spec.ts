// 来源：moneycome harness/test/unit/finance-intake/invoice-subject-direction.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
/**
 * 票面抬头对我方主体——这张票是给我们开的，还是我们开给别人的。
 *
 * 要证明的是：**只要知道我方税号或全称，方向就不再由模型决定**；以及同样要紧
 * 的另一半——**判不了的时候不许装作判得了**。抬头读不出、票上本来就不印、我方
 * 还没登记，这三种各有各的下游动作，不能压成一个「不通过」。
 *
 * 主体与票面数字沿用 `invoice-self-checks.spec` 那批（`06 标准企业样本`），
 * 两处对的是同一个场景。
 */

import {
  type InvoiceExtractedFacts,
  type InvoiceField,
} from '../../src/finance-intake/invoice-facts.contract.js';
import { resolveInvoiceSubjectDirection } from '../../src/finance-intake/invoice-subject-direction.js';

const present = <T>(value: T): InvoiceField<T> => ({
  state: 'present',
  value,
});
const unreadable = <T>(reason: string): InvoiceField<T> => ({
  state: 'unreadable',
  reason,
});
const absent = <T>(): InvoiceField<T> => ({ state: 'absent' });

/** 样本里那个租户自己。 */
const OWN = {
  subjectName: '杭州明途科技有限公司',
  subjectTaxId: '91330100MA27XYZ12B',
};

function invoice(
  overrides: Partial<InvoiceExtractedFacts> = {},
): InvoiceExtractedFacts {
  return {
    invoiceNumber: present('24312000000098765432'),
    issueDate: present('2026-03-18'),
    sellerName: present('杭州云启办公设备有限公司'),
    sellerTaxId: present('91330100MA2H8K9X7L'),
    buyerName: present(OWN.subjectName),
    buyerTaxId: present(OWN.subjectTaxId),
    amountExclTaxCents: present(955_752),
    taxAmountCents: present(124_248),
    totalInclTaxCents: present(1_080_000),
    totalInWords: present('壹万零捌佰元整'),
    taxRate: present(0.13),
    lineItems: present(['办公设备']),
    ...overrides,
  };
}

describe('票面抬头对我方主体', () => {
  it('我方税号在买方栏 → 进项，判据是税号', () => {
    const result = resolveInvoiceSubjectDirection(invoice(), OWN);
    expect(result.direction).toBe('input');
    expect(result.evidence).toBe('taxId');
  });

  it('我方税号在卖方栏 → 销项', () => {
    const result = resolveInvoiceSubjectDirection(
      invoice({
        sellerTaxId: present(OWN.subjectTaxId),
        sellerName: present(OWN.subjectName),
        buyerTaxId: present('91330100MA2H8K9X7L'),
        buyerName: present('杭州云启办公设备有限公司'),
      }),
      OWN,
    );
    expect(result.direction).toBe('output');
    expect(result.evidence).toBe('taxId');
  });

  it('双方税号都读到了、都不是我方 → 抬头不符，出一句能直接问用户的话', () => {
    const result = resolveInvoiceSubjectDirection(
      invoice({
        buyerTaxId: present('91330100MA0OTHER1X'),
        buyerName: present('杭州别家网络科技有限公司'),
      }),
      OWN,
    );
    expect(result.direction).toBe('subjectMismatch');
    expect(result.plainText).toContain('不是咱们公司');
  });

  it('只有一侧税号读到且不是我方 → 不下「不符」的结论，接着看名称', () => {
    // 这是「证据不足」与「结论」的分界：另一侧没读到，就不能说抬头不是我们。
    const result = resolveInvoiceSubjectDirection(
      invoice({
        sellerTaxId: absent(),
        buyerTaxId: present('91330100MA0OTHER1X'),
      }),
      OWN,
    );
    expect(result.direction).toBe('input');
    expect(result.evidence).toBe('name');
  });

  it('票面不印税号（收据、餐票一类）→ 靠名称也能判进项', () => {
    // 2026-08-16 真跑：44 张里 14 张两侧税号都没有，名称却几乎都读得到。
    const result = resolveInvoiceSubjectDirection(
      invoice({ buyerTaxId: absent(), sellerTaxId: absent() }),
      OWN,
    );
    expect(result.direction).toBe('input');
    expect(result.evidence).toBe('name');
  });

  it('税号判出来了就不再看名称——名称被读成别家也不改结论', () => {
    const result = resolveInvoiceSubjectDirection(
      invoice({ buyerName: present('杭州别家网络科技有限公司') }),
      OWN,
    );
    expect(result.direction).toBe('input');
    expect(result.evidence).toBe('taxId');
  });

  it('我方只登记了名称、没登记税号 → 照样能判', () => {
    const result = resolveInvoiceSubjectDirection(invoice(), {
      subjectName: OWN.subjectName,
    });
    expect(result.direction).toBe('input');
    expect(result.evidence).toBe('name');
  });

  it('我方两项都没登记 → 不判也不拦，回一句让用户补登记的话', () => {
    const result = resolveInvoiceSubjectDirection(invoice(), {});
    expect(result.direction).toBe('unregistered');
    expect(result.plainText).toContain('全称和税号');
  });

  it('空白串不算登记', () => {
    const result = resolveInvoiceSubjectDirection(invoice(), {
      subjectName: '   ',
      subjectTaxId: '',
    });
    expect(result.direction).toBe('unregistered');
  });

  it('我方同时出现在买卖两侧 → 读串了，不是销项', () => {
    const result = resolveInvoiceSubjectDirection(
      invoice({ sellerTaxId: present(OWN.subjectTaxId) }),
      OWN,
    );
    expect(result.direction).toBe('contradiction');
    expect(result.plainText).toContain('读串');
  });

  it('抬头有栏位但读不出 → insufficient，值得让用户重拍', () => {
    const result = resolveInvoiceSubjectDirection(
      invoice({
        buyerName: unreadable('被红章盖住'),
        buyerTaxId: unreadable('被红章盖住'),
        sellerName: unreadable('反光'),
        sellerTaxId: unreadable('反光'),
      }),
      OWN,
    );
    expect(result.direction).toBe('insufficient');
    expect(result.plainText).toContain('重拍');
  });

  it('票上本来就不印抬头（出租车票）→ notApplicable，别再问用户重拍', () => {
    const result = resolveInvoiceSubjectDirection(
      invoice({
        buyerName: absent(),
        buyerTaxId: absent(),
        sellerName: absent(),
        sellerTaxId: absent(),
      }),
      OWN,
    );
    expect(result.direction).toBe('notApplicable');
    expect(result.plainText).not.toContain('重拍');
  });

  it('一侧读不出、一侧没印 → 仍算读不出，重拍还有机会', () => {
    const result = resolveInvoiceSubjectDirection(
      invoice({
        buyerName: unreadable('折痕'),
        buyerTaxId: absent(),
        sellerName: absent(),
        sellerTaxId: absent(),
      }),
      OWN,
    );
    expect(result.direction).toBe('insufficient');
  });

  describe('归一化', () => {
    it('税号大小写与空格不影响判定', () => {
      const result = resolveInvoiceSubjectDirection(
        invoice({ buyerTaxId: present(' 91330100ma27xyz12b ') }),
        OWN,
      );
      expect(result.direction).toBe('input');
      expect(result.evidence).toBe('taxId');
    });

    it('名称的全角括号与空白折过之后照样命中', () => {
      const result = resolveInvoiceSubjectDirection(
        invoice({
          buyerTaxId: absent(),
          sellerTaxId: absent(),
          buyerName: present('杭州小满餐饮店（个体工商户）'),
        }),
        {
          subjectName: '杭州小满餐饮店(个体工商户)',
        },
      );
      expect(result.direction).toBe('input');
      expect(result.evidence).toBe('name');
    });

    it('名称只认精确相等——简称不算命中', () => {
      // 「杭州明途科技有限公司」与「杭州明途科技服务有限公司」是两家。
      // 包含匹配会把它们折成一个，而判错的代价是整笔账的方向。
      const result = resolveInvoiceSubjectDirection(
        invoice({ buyerTaxId: absent(), sellerTaxId: absent() }),
        { subjectName: '杭州明途科技' },
      );
      expect(result.direction).toBe('subjectMismatch');
    });
  });

  it('已知盲点：买卖双方被一致对调时，本函数给的是一个确信的错答案', () => {
    // vl-max 在 2026-08-16 的 44 张真跑里正是这么错的——4 张把我方放进卖方槽，
    // 买方槽塞进外部公司。两个抬头都合法，六项自检全过，这里也照样判成销项。
    // 写下这条是为了钉住边界：这条检查是「抽取正确时把方向从模型手里拿走」，
    // 不是「发现抽取错了」。要抓对调得靠另一层证据，不在本文件。
    const swapped = invoice({
      buyerName: present('杭州云启办公设备有限公司'),
      buyerTaxId: present('91330100MA2H8K9X7L'),
      sellerName: present(OWN.subjectName),
      sellerTaxId: present(OWN.subjectTaxId),
    });
    expect(resolveInvoiceSubjectDirection(swapped, OWN).direction).toBe(
      'output',
    );
  });
});
