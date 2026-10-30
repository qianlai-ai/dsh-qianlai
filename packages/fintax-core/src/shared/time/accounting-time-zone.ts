// 来源：moneycome harness/src/shared/time/accounting-time-zone.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 业务日期：按企业税务辖区的时区把一个时刻切成 `YYYY-MM-DD`。
 *
 * 本文件是这条口径的**唯一实现**。此前它躺在 `finance-ledger/business-date.ts`，
 * 而 `finance-ledger` 之外的模块（`aiemployee-profile` 等）不该依赖财税目录，于是
 * 各自用 `toISOString().slice(0, 10)` 就地再写一份——那是 UTC 日，在北京时间
 * 00:00–08:00 之间落到前一天。搬到 `shared/time/` 就是为了让它们有地方可依赖。
 *
 * ## 为什么不用进程时区
 *
 * 本地 mac 与容器的 `TZ` 不同，同一份代码在两处会给不同答案。所以固定偏移，
 * 不读 `TZ`、不接 `Intl`、无夏令时分支。
 *
 * ## 为什么不跟观看者所在地走
 *
 * 一张凭证记在哪一天是税务辖区的法定事实，不是观看者的偏好。8 月 1 日北京
 * 07:00 的付款在美西是 7 月 31 日——按观看者渲染会让它掉进上一个会计期间，
 * 而那期可能已经结账锁定。屏幕上的做法是标注「（北京时间）」，不是转换。
 * 「几点上传的」这类系统时刻才跟观看者走，那发生在渲染层，不在这里。
 * 口径分层见 `docs/modules/business-date-and-turn-clock-v1.md` §九。
 *
 * ## `timeZone` 参数为什么现在只认一个值
 *
 * 签名带它是为了将来把辖区落进租户档案时，调用点不用改。今天多辖区没有实现，
 * 所以传别的值**抛错而不是静默按上海算**——静默的代价是一整期账记在错误的月份。
 */

/** 账套业务日期锚定的时区。将来会从租户财税档案读，今天是常量。 */
export const ACCOUNTING_TIME_ZONE = 'Asia/Shanghai';

/** 中国大陆自 1991 年起无夏令时，固定 +08:00。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function offsetMsOf(timeZone: string): number {
  if (timeZone !== ACCOUNTING_TIME_ZONE) {
    throw new RangeError(
      `unsupported accounting time zone: ${timeZone}; only ${ACCOUNTING_TIME_ZONE} is implemented`,
    );
  }
  return SHANGHAI_OFFSET_MS;
}

/** 把一个时刻切成该辖区的业务日期 `YYYY-MM-DD`。 */
export function businessDateOf(
  at: Date,
  timeZone: string = ACCOUNTING_TIME_ZONE,
): string {
  return new Date(at.getTime() + offsetMsOf(timeZone))
    .toISOString()
    .slice(0, 10);
}

/**
 * 业务日期在账套里的存法：日期列一律存成该业务日的 UTC 午夜
 * `YYYY-MM-DDT00:00:00.000Z`。对外回的 ISO 串截前 10 位就是日期，
 * 消费方不该按本地时区解析。
 */
export function businessDateInstant(
  at: Date,
  timeZone: string = ACCOUNTING_TIME_ZONE,
): Date {
  return new Date(`${businessDateOf(at, timeZone)}T00:00:00.000Z`);
}
