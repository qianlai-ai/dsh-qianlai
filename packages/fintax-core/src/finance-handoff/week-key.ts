// 来源：moneycome harness/src/finance-handoff/week-key.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 自然周（owner 2026-08-17：按自然周切上下文）。
 *
 * 按 Asia/Shanghai（固定 +08:00，无夏令时）算周一 00:00 到下周一 00:00；键用
 * ISO 8601 周编号 `YYYY-Www`（周一起、含当年第一个周四的那周是第 1 周）。这里
 * 只做纯计算，不读时钟：`now` 由调用方给，测试可复现。
 */

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_KEY_PATTERN = /^(\d{4})-W(\d{2})$/;

export interface NaturalWeek {
  /** `YYYY-Www` */
  readonly weekKey: string;
  /** 周一 00:00（Asia/Shanghai）对应的 UTC 时刻。 */
  readonly startsAt: Date;
  /** 下周一 00:00（Asia/Shanghai）对应的 UTC 时刻，开区间。 */
  readonly endsAt: Date;
}

/** `now` 所在的自然周。 */
export function naturalWeekOf(now: Date): NaturalWeek {
  // 平移到上海本地时间后按 UTC 字段算天，避免依赖进程时区。
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // getUTCDay: 0=周日 … 6=周六；换成周一=0 … 周日=6。
  const dayIndex = (local.getUTCDay() + 6) % 7;
  const mondayLocal = localMidnight - dayIndex * DAY_MS;
  return weekFromMondayLocal(mondayLocal);
}

/** 解析 `YYYY-Www`；不合法返回 undefined（调用方按契约错误处理）。 */
export function parseWeekKey(weekKey: string): NaturalWeek | undefined {
  const match = WEEK_KEY_PATTERN.exec(weekKey);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return undefined;
  // ISO：第 1 周的周一 = 1 月 4 日所在周的周一。
  const jan4 = Date.UTC(year, 0, 4);
  const jan4DayIndex = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4DayIndex * DAY_MS;
  const mondayLocal = week1Monday + (week - 1) * 7 * DAY_MS;
  const resolved = weekFromMondayLocal(mondayLocal);
  // 第 53 周只有部分年份有；键不等说明越界。
  return resolved.weekKey === weekKey ? resolved : undefined;
}

function weekFromMondayLocal(mondayLocal: number): NaturalWeek {
  const thursdayLocal = mondayLocal + 3 * DAY_MS;
  const isoYear = new Date(thursdayLocal).getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4DayIndex = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4DayIndex * DAY_MS;
  const weekNo = Math.floor((mondayLocal - week1Monday) / (7 * DAY_MS)) + 1;
  return {
    weekKey: `${isoYear}-W${String(weekNo).padStart(2, '0')}`,
    startsAt: new Date(mondayLocal - SHANGHAI_OFFSET_MS),
    endsAt: new Date(mondayLocal + 7 * DAY_MS - SHANGHAI_OFFSET_MS),
  };
}
