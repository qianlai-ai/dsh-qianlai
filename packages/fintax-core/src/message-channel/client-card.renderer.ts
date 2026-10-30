// 来源：moneycome harness/src/message-channel/client-card.renderer.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * @runtime-status 未接线：本层已建，但当前无消费者；B4 微信通道接入时才进入运行路径。
 *
 * L6 渠道渲染器 — 客户端卡片。
 *
 * 契约：`docs/modules/fintax-accounting-slice-v1.md` §5。
 */

import type {
  ChannelRenderer,
  ClientCardRendering,
  NormalizedReply,
  OutboundMessage,
} from './message-channel.contract.js';

export class ClientCardRenderer implements ChannelRenderer {
  readonly channel = 'client' as const;

  render(message: OutboundMessage): ClientCardRendering {
    return {
      channel: 'client',
      // 卡片保留消息类型：姿态由类型决定，前端据此选语气与视觉强度，
      // 不在这里把六类拍平成一种样式。
      kind: message.kind,
      headline: message.headline,
      facts: message.facts ?? [],
      actions: message.options ?? [],
      materialUpload: message.expects === 'material',
    };
  }

  normalizeReply(
    message: OutboundMessage,
    rawReply: string,
  ): NormalizedReply | null {
    const reply = rawReply.trim();

    if (message.expects === 'acknowledge') {
      return {
        messageId: message.messageId,
        expects: 'acknowledge',
        optionId: null,
      };
    }

    // 客户端回的就是 optionId 本身，但仍要对着本条消息的可选项校验——
    // 不校验就等于接受任意 id，客户端一旦被改就能提交不存在的选项。
    const matched = (message.options ?? []).find(
      (option) => option.optionId === reply,
    );
    if (!matched) {
      return null;
    }

    return {
      messageId: message.messageId,
      expects: message.expects,
      optionId: matched.optionId,
    };
  }
}
