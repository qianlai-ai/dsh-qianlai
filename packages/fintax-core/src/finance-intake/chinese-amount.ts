// 来源：moneycome harness/src/finance-intake/chinese-amount.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 中文大写金额 → 整数分。
 *
 * @runtime-status 纯函数，无外部依赖。
 *
 * 为什么值得单独写一支解析器：大写与小写并存是发票防篡改的原始设计——改一个
 * 小写数字很容易，把「壹万贰仟」改成别的还要对上就难得多。两者不符是**发票
 * 被改过**最直接的信号，而这个信号只有把大写真解析出来才拿得到。
 *
 * 解析不出来就是解析不出来：返回 `undefined`，由调用方判成「缺材料」，绝不
 * 退化成「按小写算」。退化的那一刻，这条校验就等于没有。
 */

const DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  壹: 1,
  贰: 2,
  叁: 3,
  肆: 4,
  伍: 5,
  陆: 6,
  柒: 7,
  捌: 8,
  玖: 9,
};

/** 节内单位。 */
const SMALL_UNITS: Readonly<Record<string, number>> = {
  拾: 10,
  佰: 100,
  仟: 1000,
};

/** 分节单位。 */
const BIG_UNITS: Readonly<Record<string, number>> = {
  万: 10_000,
  亿: 100_000_000,
};

/** 元的写法两种都有，票面上「圆」更常见。 */
const YUAN_CHARS = new Set(['元', '圆']);

/**
 * 解析大写金额，返回整数分；任何一处不认识就返回 `undefined`。
 *
 * 认得的形状：`壹万贰仟叁佰肆拾伍元陆角柒分`、`叁佰元整`、`零元零角零分`、
 * `贰拾元伍角`（角后直接结束，分为 0）。
 *
 * 不认得的一律拒绝，包括 `人民币` 前缀被漏切、阿拉伯数字混排、繁简混写。
 * 宁可判「读不出」让人去看原件，也不要猜出一个数来跟小写比对——那比对的
 * 就不是票面，是解析器的想象。
 */
export function parseChineseAmountToCents(input: string): number | undefined {
  const text = input.trim().replace(/\s+/g, '');
  if (!text) return undefined;

  const yuanIndex = [...text].findIndex((ch) => YUAN_CHARS.has(ch));
  if (yuanIndex < 0) return undefined;

  const yuanPart = text.slice(0, yuanIndex);
  const fractionPart = text.slice(yuanIndex + 1);

  const yuan = parseIntegerPart(yuanPart);
  if (yuan === undefined) return undefined;

  const fractionCents = parseFractionPart(fractionPart);
  if (fractionCents === undefined) return undefined;

  const cents = yuan * 100 + fractionCents;
  return Number.isSafeInteger(cents) ? cents : undefined;
}

/**
 * 元之前的整数部分。
 *
 * 分节累加：`拾佰仟` 在节内累加，`万亿` 把当前节乘进总数并清零。`零` 只作
 * 占位，不产生数值——「壹佰零伍」的零挡住的是拾位，解析时它自然落成 cur=0。
 */
function parseIntegerPart(part: string): number | undefined {
  if (!part) return undefined;
  // 「零元整」是合法的零金额写法。
  if (part === '零') return 0;

  let total = 0;
  let section = 0;
  let cur: number | undefined;
  let lastSmallUnit = 10_000;
  let lastBigUnit = Infinity;
  let zeroPlaceholder = false;

  for (const ch of part) {
    // 零在整数部分只是占位，本身不产生数值：「壹万零捌佰」的零挡住的是仟位，
    // 「壹佰零伍」的零挡住的是拾位。把它当普通数字会让紧跟其后的「捌」撞上
    // 「连着两个数字」的拒绝规则，一张寻常的票就此读不出来。
    if (ch === '零') {
      // 零不能吃掉前一个尚未落到单位上的数字，也不能重复或开头占位。
      if (
        cur !== undefined ||
        zeroPlaceholder ||
        (section === 0 && total === 0)
      ) {
        return undefined;
      }
      zeroPlaceholder = true;
      continue;
    }
    const digit = DIGITS[ch];
    if (digit !== undefined) {
      // 连着两个数字（「壹贰」）不是合法大写，那是被识别串了行。
      if (cur !== undefined) return undefined;
      cur = digit;
      zeroPlaceholder = false;
      continue;
    }
    const small = SMALL_UNITS[ch];
    if (small !== undefined) {
      // 规范要求「壹拾」，但票面手写与旧版机打常见省略成「拾伍元」。这里认，
      // 因为省略写法本身不产生歧义。
      if (small >= lastSmallUnit) return undefined;
      if (cur === undefined && (small !== 10 || section !== 0 || total !== 0)) {
        return undefined;
      }
      section += (cur ?? 1) * small;
      lastSmallUnit = small;
      cur = undefined;
      continue;
    }
    const big = BIG_UNITS[ch];
    if (big !== undefined) {
      if (big >= lastBigUnit || zeroPlaceholder) return undefined;
      section += cur ?? 0;
      if (section === 0) return undefined; // 「万」前面没数，是串行了
      total += section * big;
      lastBigUnit = big;
      lastSmallUnit = 10_000;
      section = 0;
      cur = undefined;
      continue;
    }
    return undefined;
  }

  return zeroPlaceholder ? undefined : total + section + (cur ?? 0);
}

/**
 * 元之后的角分部分，返回 0–99 分。
 *
 * 认 `整` / `正`（都是「没有零头」的写法）、`零角零分`、`陆角柒分`、`伍角`、
 * `柒分`（只有分）。
 */
function parseFractionPart(part: string): number | undefined {
  if (!part || part === '整' || part === '正') return 0;
  // 「壹佰元零伍分」的零只表示角位为空，不是连写的第二个数字。
  part = part.replace(/^零(?=[壹贰叁肆伍陆柒捌玖]分(?:整|正)?$)/, '');
  // 整/正只能作为收尾，不能夹在数字单位之间或重复出现。
  part = part.replace(/[整正]$/, '');

  let jiao: number | undefined;
  let fen: number | undefined;
  let pending: number | undefined;

  for (const ch of part) {
    const digit = DIGITS[ch];
    if (digit !== undefined) {
      if (pending !== undefined) return undefined;
      pending = digit;
      continue;
    }
    if (ch === '角') {
      if (pending === undefined || jiao !== undefined || fen !== undefined)
        return undefined;
      jiao = pending;
      pending = undefined;
      continue;
    }
    if (ch === '分') {
      if (pending === undefined || fen !== undefined) return undefined;
      fen = pending;
      pending = undefined;
      continue;
    }
    return undefined;
  }

  // 数字后面没跟单位，不知道它是角还是分。
  if (pending !== undefined) return undefined;

  return (jiao ?? 0) * 10 + (fen ?? 0);
}
