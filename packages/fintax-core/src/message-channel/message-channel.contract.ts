// 来源：moneycome harness/src/message-channel/message-channel.contract.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * @runtime-status 未接线：本层已建，但当前无消费者；B4 微信通道接入时才进入运行路径。
 *
 * L6 消息与渠道分离层 — 契约。
 *
 * 业务层只产出 {@link OutboundMessage}：类型、收件人、可选项、期待什么回复。
 * **它不知道自己会被渲染成什么**。渠道层负责渲染，并把该渠道的原始回复反向
 * 归一成 {@link NormalizedReply}——微信里回的「1」与客户端里点的按钮，在业务
 * 层是同一个对象。
 *
 * 这一层的存在理由：iLink 若直接调各业务 service，将来接钉钉、飞书、短信要
 * 各写一遍，且业务代码里会长出 `if (channel === ...)`。
 *
 * 契约：`docs/modules/fintax-accounting-slice-v1.md` §5。
 */

import type {
  MessageChannel,
  MessageKind,
  ReplyExpectation,
} from './message-channel.constants.js';

/** 一个可选项。`optionId` 是业务语义 id，与渠道无关。 */
export interface MessageOption {
  readonly optionId: string;
  readonly label: string;
}

/** 业务层产出的消息。 */
export interface OutboundMessage {
  readonly messageId: string;
  readonly kind: MessageKind;
  readonly recipientActorRef: string;
  /** 一句话主体。 */
  readonly headline: string;
  /** 客观事实行（日期、金额、账户）。渲染器逐行展示，不重排不解释。 */
  readonly facts?: readonly string[];
  readonly options?: readonly MessageOption[];
  readonly expects: ReplyExpectation;
}

/** 客户端渲染产物：卡片，选项带按钮语义。 */
export interface ClientCardRendering {
  readonly channel: 'client';
  readonly kind: MessageKind;
  readonly headline: string;
  readonly facts: readonly string[];
  readonly actions: readonly MessageOption[];
  /** 是否展示交材料入口（拍照 / 选文件）。 */
  readonly materialUpload: boolean;
}

/**
 * 微信渲染产物：纯文本。微信对话里没有按钮和卡片，交互退化为
 * 「回复数字做选择、发图片交材料」两个原语。
 */
export interface WechatTextRendering {
  readonly channel: 'wechat';
  readonly text: string;
}

export type ChannelRendering = ClientCardRendering | WechatTextRendering;

/** 反向归一后的业务动作。两个渠道的等价意图必须产出相等的对象。 */
export interface NormalizedReply {
  readonly messageId: string;
  readonly expects: ReplyExpectation;
  /** 选了哪一项；`acknowledge` 类为 null。 */
  readonly optionId: string | null;
}

export interface ChannelRenderer {
  readonly channel: MessageChannel;
  render(message: OutboundMessage): ChannelRendering;
  /**
   * 把该渠道的原始回复归一成业务动作。
   *
   * **fail-closed**：认不出就返回 null，绝不猜。猜错会把「我没说有」变成
   * 「我说没有」，那是一条会进账的事实。
   */
  normalizeReply(
    message: OutboundMessage,
    rawReply: string,
  ): NormalizedReply | null;
}
