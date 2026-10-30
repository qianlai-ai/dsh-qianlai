// 来源：moneycome harness/test/unit/finance-ledger/business-date.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
import {
  businessDateInstant,
  businessDateOf,
} from '../../src/finance-ledger/business-date.js';

describe('账套业务日期（Asia/Shanghai）', () => {
  it('UTC 08-16 晚 20:00 已经是北京 08-17 凌晨 4 点，业务日期取 08-17', () => {
    expect(businessDateOf(new Date('2026-08-16T20:00:00Z'))).toBe('2026-08-17');
    expect(businessDateOf(new Date('2026-08-16T15:59:59Z'))).toBe('2026-08-16');
    expect(businessDateOf(new Date('2026-08-16T16:00:00Z'))).toBe('2026-08-17');
  });

  it('跨年也按北京时间：UTC 12-31 18:00 是北京 01-01', () => {
    expect(businessDateOf(new Date('2025-12-31T18:00:00Z'))).toBe('2026-01-01');
  });

  it('businessDateInstant 把真实时刻换成该业务日的 UTC 午夜', () => {
    expect(
      businessDateInstant(new Date('2026-08-16T20:00:00Z')).toISOString(),
    ).toBe('2026-08-17T00:00:00.000Z');
  });
});
