// 来源：moneycome harness/src/finance-disclosure/figure-certainty.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * @runtime-status 已接线：`headline-figures.service.ts` 按期间数出待办事实后调
 * `assessFigure`，经 `POST /api/internal/fintax/book/headline` 给老板面。
 *
 * 老板面层一的数字成色（`14 §二`）。
 *
 * 一句话职责：**回答「这个数现在能不能信」，能信到什么程度。**
 *
 * ## 为什么三个数不能是三个数
 *
 * 层一是「三个数 + 一个决定」。但**账没做完的时候，「3 月赚了多少」不是一个数**：
 * 还有 5 笔没认领的到账、3 张没收到的票，那个数一定会变。
 *
 * 把它当成精确数字显示出来，是这个界面能犯的最危险的错——老板照着它做了决定，
 * 数字第二天动了。
 *
 * ## 方向是数出来的，不是猜出来的
 *
 * 每个待办事实本来就知道自己的金额和类别，所以往哪边动是确定的：缺的票只会
 * 拉低利润，已开票未入账的只会抬高。**不需要模型参与。**
 *
 * 唯独未认领的到账方向不明——可能是收入，也可能是借款、退款（`13 §3.3` ⑩：资金
 * 形态有六种归宿，只有第一种是普通收支）。它单独成一档，**绝不当成收入去算**。
 *
 * ## 算不出就不出数
 *
 * `unavailable` 的形状里没有任何金额字段，这是刻意的：显示一个灰色的数等于显示
 * 了那个数，人照样会记住它。
 *
 * ## 纯函数
 *
 * 无 IO、无时钟、无随机。同一份输入永远同一结果。
 */

/** 待办事实的四类，决定它往哪个方向拉这个数。 */
export type PendingFactCategory =
  /** 已付款但没收到合规发票——票到了就是费用，只往下 */
  | 'missing_invoice_for_payment'
  /** 该计提未计提——计提出来的都是费用，只往下 */
  | 'accrual_not_posted'
  /** 已开票未入账——票开了就是收入，只往上 */
  | 'invoiced_not_posted'
  /** 未认领的到账——**方向不明** */
  | 'unclaimed_receipt'
  /** 已识别未记账、但包不认识它的形态（aiGuess）——不知道是收是支，**方向不明** */
  | 'unclassified_event';

export interface PendingFact {
  readonly ref: string;
  readonly category: PendingFactCategory;
  /** **分**为单位的非负数量。方向由 `category` 定，不由正负号定。 */
  readonly amountMinor: bigint;
}

/** 算不出数的原因。闭集——每一条都对应一个能修的前置动作。 */
export type FigureUnavailableReason =
  /** 期初四项核验没过，账本没有可信起点 */
  | 'opening_balance_unverified'
  /** 上期未锁，累计口径断了（结账第 6 项同一条理由） */
  | 'previous_period_unlocked';

export type FigureCertainty =
  | { readonly kind: 'settled' }
  | {
      readonly kind: 'moving';
      /** 只会往下拉的合计 */
      readonly downMinor: bigint;
      /** 只会往上抬的合计 */
      readonly upMinor: bigint;
      /** 方向不明的合计。**与上面两项互斥，同一笔不会重复计入** */
      readonly undeterminedMinor: bigint;
      /** 让这个数还在动的那几件事 */
      readonly openRefs: readonly string[];
    }
  | { readonly kind: 'unavailable'; readonly reason: FigureUnavailableReason };

export interface FigureInput {
  readonly openingBalanceVerified: boolean;
  readonly previousPeriodLocked: boolean;
  readonly periodLocked: boolean;
  readonly pendingFacts: readonly PendingFact[];
}

const DIRECTION: Readonly<
  Record<PendingFactCategory, 'down' | 'up' | 'undetermined'>
> = {
  missing_invoice_for_payment: 'down',
  accrual_not_posted: 'down',
  invoiced_not_posted: 'up',
  unclaimed_receipt: 'undetermined',
  unclassified_event: 'undetermined',
};

/**
 * 算一个数的成色。
 *
 * 判定顺序刻意如此：**先看算不算得出，再看动不动。** 期初没核验过时，账期锁没锁
 * 都不重要——那个数本身就没有可信起点。
 *
 * 账期已锁但仍有待办事实，返回 `settled`：锁了就是锁了，剩下的属于下一期或调整
 * 事项，不该让已经定了的数看起来还在飘。
 */
export function assessFigure(input: FigureInput): FigureCertainty {
  if (!input.openingBalanceVerified) {
    return { kind: 'unavailable', reason: 'opening_balance_unverified' };
  }
  if (!input.previousPeriodLocked) {
    return { kind: 'unavailable', reason: 'previous_period_unlocked' };
  }
  if (input.periodLocked) {
    return { kind: 'settled' };
  }

  let downMinor = 0n;
  let upMinor = 0n;
  let undeterminedMinor = 0n;
  const openRefs: string[] = [];

  for (const fact of input.pendingFacts) {
    if (fact.amountMinor < 0n) {
      throw new RangeError(
        `pending fact ${fact.ref} has a negative amount; direction comes from category, not sign`,
      );
    }
    switch (DIRECTION[fact.category]) {
      case 'down':
        downMinor += fact.amountMinor;
        break;
      case 'up':
        upMinor += fact.amountMinor;
        break;
      default:
        undeterminedMinor += fact.amountMinor;
    }
    openRefs.push(fact.ref);
  }

  // 账期没锁就是会动，哪怕此刻一件待办都没有——材料随时可能再进来。
  return { kind: 'moving', downMinor, upMinor, undeterminedMinor, openRefs };
}
