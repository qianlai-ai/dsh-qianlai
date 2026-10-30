// 来源：moneycome harness/src/message-channel/wechat-text.renderer.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * @runtime-status 未接线：本层已建，但当前无消费者；B4 微信通道接入时才进入运行路径。
 *
 * L6 渠道渲染器 — 微信纯文本。
 *
 * 微信对话里没有按钮和卡片，交互退化为两个原语：回复数字做选择、发图片交
 * 材料。编号退化归本渲染器所有——**不改会话表单契约**，那里的 `replyMode`
 * 是纯前端展示字段，harness 无运行时消费。
 *
 * 契约：`docs/modules/fintax-accounting-slice-v1.md` §5。
 */

import type {
  ChannelRenderer,
  NormalizedReply,
  OutboundMessage,
  WechatTextRendering,
} from './message-channel.contract.js';

/** 「发图片交材料」这条原语的固定提示语。 */
const MATERIAL_HINT = '（票据、转账截图直接发给我就行）';

export class WechatTextRenderer implements ChannelRenderer {
  readonly channel = 'wechat' as const;

  render(message: OutboundMessage): WechatTextRendering {
    const lines: string[] = [message.headline];

    for (const fact of message.facts ?? []) {
      lines.push(fact);
    }

    const options = message.options ?? [];
    if (options.length > 0) {
      lines.push(
        options
          .map((option, index) => `回复 ${index + 1} = ${option.label}`)
          .join('；'),
      );
    }

    if (message.expects === 'material') {
      lines.push(MATERIAL_HINT);
    }

    return { channel: 'wechat', text: lines.join('\n') };
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

    // 只认纯数字序号。用户回「有」「1.」「第一个」一律不归一——
    // fail-closed 交给上层追问，好过猜错一条会进账的事实。
    if (!/^\d+$/.test(reply)) {
      return null;
    }

    const options = message.options ?? [];
    const index = Number(reply) - 1;
    const matched = options[index];
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
