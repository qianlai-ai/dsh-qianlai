// 来源：moneycome harness/src/message-channel/message-channel.constants.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * @runtime-status 未接线：本层已建，但当前无消费者；B4 微信通道接入时才进入运行路径。
 *
 * L6 消息与渠道分离层 — 闭集词表与纯判定。
 *
 * 纯数据 + 纯函数，不依赖 NestJS / Prisma，服务与单测消费同一份真相源
 * （沿用 `notification-preference.constants.ts` 的约定）。
 *
 * 契约：`docs/modules/fintax-accounting-slice-v1.md` §5。
 */

/**
 * 消息六类。**类型是结构化字段，不是文案风格**——渠道强度与重发策略绑在
 * 类型上，不靠写文案的人拿捏。
 */
export const MESSAGE_KINDS = [
  /** 采集请求：每日巡检触发。请求句，轻，允许随手点「没有」。 */
  'collection_request',
  /** 差异补事实：周或月核对发现对不上。直说差异，只问客观事实。 */
  'discrepancy_fact',
  /** 截止提醒：申报日历、材料节点。明确日期与后果。 */
  'deadline_reminder',
  /** 异常与阻断：申报失败、回执异常、结账被拦、登录过期。 */
  'exception_block',
  /** 授权与确认：结账、申报、缴款。官方术语与精确数字为主体。 */
  'authorization_confirm',
  /** 状态通知：完成类事件。简短，可合并。 */
  'status_notice',
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * 允许用请求句、允许软化的两类。
 *
 * 其余四类必须直说——提醒和通知本来就该直接，把「你的账被拦住了」写成
 * 请求句会让用户读不出严重性。
 */
const SOFTENABLE_KINDS: ReadonlySet<MessageKind> = new Set([
  'collection_request',
  'discrepancy_fact',
]);

/** 常规类：每天合并成一条推送，防提醒疲劳。 */
const DAILY_MERGEABLE_KINDS: ReadonlySet<MessageKind> = new Set([
  'collection_request',
  'status_notice',
]);

/** 独立直发，不参与合并；紧急的双端连发。 */
const DIRECT_SEND_KINDS: ReadonlySet<MessageKind> = new Set([
  'deadline_reminder',
  'exception_block',
  'authorization_confirm',
]);

export function isSoftenable(kind: MessageKind): boolean {
  return SOFTENABLE_KINDS.has(kind);
}

export function isDailyMergeable(kind: MessageKind): boolean {
  return DAILY_MERGEABLE_KINDS.has(kind);
}

export function requiresDirectSend(kind: MessageKind): boolean {
  return DIRECT_SEND_KINDS.has(kind);
}

export function isMessageKind(value: string): value is MessageKind {
  return (MESSAGE_KINDS as readonly string[]).includes(value);
}

/**
 * 渠道闭集。切片只做两个实现，但渲染器按可插拔设计——接钉钉、飞书、短信时
 * 只加渲染器，业务层零改动。
 */
export const MESSAGE_CHANNELS = ['client', 'wechat'] as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * 业务层期待用户回什么。渠道层据此决定怎么渲染可选项与提示语，
 * 但**不改变业务语义**。
 */
export const REPLY_EXPECTATIONS = [
  /** 从可选项里选一个。 */
  'choice',
  /** 交材料（拍照、文件、截图）。 */
  'material',
  /** 只需知悉，无需回复。 */
  'acknowledge',
] as const;

export type ReplyExpectation = (typeof REPLY_EXPECTATIONS)[number];
