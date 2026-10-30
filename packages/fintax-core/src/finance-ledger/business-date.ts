// 来源：moneycome harness/src/finance-ledger/business-date.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 账套业务日期：按 Asia/Shanghai（固定 +08:00，无夏令时）把时刻切成 `YYYY-MM-DD`。
 *
 * 账套里的"今天 / 截至日 / 提交日"是中国大陆的记账日，不是 UTC 日；进程时区也不
 * 可依赖（本地 mac 与容器不同）。用 `toISOString().slice(0, 10)` 会在北京时间
 * 每天 00:00–08:00 之间落到前一天（C 2026-08-17 在老板面上看到「今天是 08-16」）。
 *
 * **实现已搬到 `shared/time/accounting-time-zone.ts`**，本文件只做转出。搬家的理由
 * 是财税目录之外的模块也要用它：`aiemployee-profile` 的「入职时间」此前就是因为
 * 不该依赖 `finance-ledger` 而就地写了一份 UTC 切日，同一个 bug 在那里复发。
 * 本仓 12 个 import 本文件的调用点不受影响，行为逐字不变。
 */

export {
  ACCOUNTING_TIME_ZONE,
  businessDateInstant,
  businessDateOf,
} from '../shared/time/accounting-time-zone.js';
