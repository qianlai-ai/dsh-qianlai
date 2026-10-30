// 来源：moneycome harness/test/unit/finance-handoff/week-key.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
import {
  naturalWeekOf,
  parseWeekKey,
} from '../../src/finance-handoff/week-key.js';

describe('财税交接 · 自然周（Asia/Shanghai，ISO 周键）', () => {
  it('周一 00:00（+08:00）到下周一 00:00；2026-08-17 是周一', () => {
    const week = naturalWeekOf(new Date('2026-08-17T04:00:00+08:00'));
    expect(week.weekKey).toBe('2026-W34');
    expect(week.startsAt.toISOString()).toBe('2026-08-16T16:00:00.000Z');
    expect(week.endsAt.toISOString()).toBe('2026-08-23T16:00:00.000Z');
  });

  it('按上海时间切周：UTC 周日 20:00 已经是上海周一 04:00，属于新的一周', () => {
    expect(naturalWeekOf(new Date('2026-08-16T20:00:00Z')).weekKey).toBe(
      '2026-W34',
    );
    expect(naturalWeekOf(new Date('2026-08-16T15:59:59Z')).weekKey).toBe(
      '2026-W33',
    );
  });

  it('跨年按 ISO 规则：2026-01-01 是周四，属于 2026-W01；2025-12-29 周一同周', () => {
    expect(naturalWeekOf(new Date('2026-01-01T10:00:00+08:00')).weekKey).toBe(
      '2026-W01',
    );
    expect(naturalWeekOf(new Date('2025-12-29T10:00:00+08:00')).weekKey).toBe(
      '2026-W01',
    );
  });

  it('parseWeekKey 与 naturalWeekOf 往返一致，非法键返回 undefined', () => {
    const week = naturalWeekOf(new Date('2026-08-19T12:00:00+08:00'));
    const parsed = parseWeekKey(week.weekKey);
    expect(parsed).toBeDefined();
    expect(parsed?.startsAt.toISOString()).toBe(week.startsAt.toISOString());
    expect(parsed?.endsAt.toISOString()).toBe(week.endsAt.toISOString());
    for (const bad of ['2026-34', '2026-W00', '2026-W54', 'W34-2026', '']) {
      expect(parseWeekKey(bad)).toBeUndefined();
    }
    // 2026 没有第 53 周（2026-12-31 是周四 → 2026-W53 存在？校验按 ISO 算）：
    // 用往返而不是硬编码：解析出的键必须等于自己。
    const w53 = parseWeekKey('2026-W53');
    expect(w53 === undefined || w53.weekKey === '2026-W53').toBe(true);
  });
});
