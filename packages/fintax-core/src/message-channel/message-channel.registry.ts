// 来源：moneycome harness/src/message-channel/message-channel.registry.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * @runtime-status 未接线：本层已建，但当前无消费者；B4 微信通道接入时才进入运行路径。
 *
 * L6 渠道注册表 — 按渠道 id 取渲染器。
 *
 * 渠道是可插拔实现：接钉钉、飞书、短信时只加一个渲染器并在此登记，
 * 业务层零改动、零分支。
 *
 * 契约：`docs/modules/fintax-accounting-slice-v1.md` §5。
 */

import type { MessageChannel } from './message-channel.constants.js';
import type { ChannelRenderer } from './message-channel.contract.js';
import { ClientCardRenderer } from './client-card.renderer.js';
import { WechatTextRenderer } from './wechat-text.renderer.js';

const RENDERERS: Readonly<Record<MessageChannel, ChannelRenderer>> = {
  client: new ClientCardRenderer(),
  wechat: new WechatTextRenderer(),
};

export function resolveChannelRenderer(
  channel: MessageChannel,
): ChannelRenderer {
  return RENDERERS[channel];
}

export function registeredChannels(): readonly MessageChannel[] {
  return Object.keys(RENDERERS) as MessageChannel[];
}
