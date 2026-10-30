// 来源：moneycome harness/test/unit/message-channel-dual-render.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
/**
 * A5 单消息双端渲染（`docs/modules/fintax-accounting-slice-v1.md` §7）。
 *
 * 证明业务层不知道渠道：同一条消息渲染成客户端卡片与微信编号文本，两端的
 * 等价回复归一成同一个业务动作。
 */

import {
  MESSAGE_KINDS,
  isSoftenable,
  isDailyMergeable,
  requiresDirectSend,
  type MessageKind,
} from '../../src/message-channel/message-channel.constants.js';
import type {
  ClientCardRendering,
  OutboundMessage,
  WechatTextRendering,
} from '../../src/message-channel/message-channel.contract.js';
import {
  registeredChannels,
  resolveChannelRenderer,
} from '../../src/message-channel/message-channel.registry.js';

/** 样本的日常采集请求：昨天有没有收付款。 */
const collectionRequest: OutboundMessage = {
  messageId: 'msg-collect-1',
  kind: 'collection_request',
  recipientActorRef: 'actor-front-desk',
  headline: '昨天公司有收付款吗？把材料发我，我来生成记录',
  options: [
    { optionId: 'none', label: '没有' },
    { optionId: 'has', label: '有，我来传' },
  ],
  expects: 'choice',
};

/** 样本 E3：3,000 元到账没有材料。 */
const discrepancy: OutboundMessage = {
  messageId: 'msg-gap-e3',
  kind: 'discrepancy_fact',
  recipientActorRef: 'actor-front-desk',
  headline: '有笔 3,000 元收款我缺材料',
  facts: ['3 月 26 日  招行一般户  收到 3,000.00', '对方：丙贸易有限公司'],
  options: [
    { optionId: 'pick-contract', label: '从已有合同里选' },
    { optionId: 'upload', label: '传个材料给你看' },
    { optionId: 'ask-owner', label: '我去问问负责人' },
  ],
  expects: 'choice',
};

describe('A5 · 同一条消息渲染到两个端', () => {
  it('客户端渲染成卡片，选项带按钮语义', () => {
    const rendering = resolveChannelRenderer('client').render(
      collectionRequest,
    ) as ClientCardRendering;

    expect(rendering.channel).toBe('client');
    expect(rendering.headline).toBe(collectionRequest.headline);
    expect(rendering.actions).toEqual([
      { optionId: 'none', label: '没有' },
      { optionId: 'has', label: '有，我来传' },
    ]);
    // 卡片保留消息类型：姿态由类型决定，不在渲染层把六类拍平。
    expect(rendering.kind).toBe('collection_request');
  });

  it('微信渲染成编号选项文本', () => {
    const rendering = resolveChannelRenderer('wechat').render(
      collectionRequest,
    ) as WechatTextRendering;

    expect(rendering.channel).toBe('wechat');
    expect(rendering.text).toContain('回复 1 = 没有');
    expect(rendering.text).toContain('回复 2 = 有，我来传');
  });

  it('事实行逐行保留，不重排不解释', () => {
    const wechat = resolveChannelRenderer('wechat').render(
      discrepancy,
    ) as WechatTextRendering;
    const client = resolveChannelRenderer('client').render(
      discrepancy,
    ) as ClientCardRendering;

    for (const fact of discrepancy.facts ?? []) {
      expect(wechat.text).toContain(fact);
    }
    expect(client.facts).toEqual(discrepancy.facts);
  });

  it('交材料在两端各自退化：客户端给上传入口，微信给发图提示', () => {
    const material: OutboundMessage = {
      messageId: 'msg-material-1',
      kind: 'collection_request',
      recipientActorRef: 'actor-front-desk',
      headline: '把这个月的流水传给我',
      expects: 'material',
    };

    const client = resolveChannelRenderer('client').render(
      material,
    ) as ClientCardRendering;
    const wechat = resolveChannelRenderer('wechat').render(
      material,
    ) as WechatTextRendering;

    expect(client.materialUpload).toBe(true);
    expect(wechat.text).toContain('直接发给我');
  });
});

describe('A5 · 反向归一：两端等价回复是同一个业务动作', () => {
  it('微信回「2」与客户端点第二个按钮，归一结果相等', () => {
    const fromWechat = resolveChannelRenderer('wechat').normalizeReply(
      collectionRequest,
      '2',
    );
    const fromClient = resolveChannelRenderer('client').normalizeReply(
      collectionRequest,
      'has',
    );

    expect(fromWechat).toEqual(fromClient);
    expect(fromWechat).toEqual({
      messageId: 'msg-collect-1',
      expects: 'choice',
      optionId: 'has',
    });
  });

  it('微信回「1」= 没有，与客户端点第一个按钮相等', () => {
    expect(
      resolveChannelRenderer('wechat').normalizeReply(collectionRequest, ' 1 '),
    ).toEqual(
      resolveChannelRenderer('client').normalizeReply(
        collectionRequest,
        'none',
      ),
    );
  });

  it('三选项消息在两端同样对齐', () => {
    expect(
      resolveChannelRenderer('wechat').normalizeReply(discrepancy, '3'),
    ).toEqual(
      resolveChannelRenderer('client').normalizeReply(discrepancy, 'ask-owner'),
    );
  });
});

describe('A5 · 归一 fail-closed', () => {
  it.each([
    ['序号越界', '9'],
    ['自由文本', '有'],
    ['带标点的序号', '1.'],
    ['空回复', '   '],
  ])('微信 %s → null，不猜', (_label, raw) => {
    expect(
      resolveChannelRenderer('wechat').normalizeReply(collectionRequest, raw),
    ).toBeNull();
  });

  it('客户端提交不存在的 optionId → null', () => {
    expect(
      resolveChannelRenderer('client').normalizeReply(
        collectionRequest,
        'not-an-option',
      ),
    ).toBeNull();
  });

  it('acknowledge 类不需要选项，两端都归一成无选项动作', () => {
    const notice: OutboundMessage = {
      messageId: 'msg-done-1',
      kind: 'status_notice',
      recipientActorRef: 'actor-boss',
      headline: '3 月的账已定下来',
      expects: 'acknowledge',
    };

    const expected = {
      messageId: 'msg-done-1',
      expects: 'acknowledge',
      optionId: null,
    };
    expect(resolveChannelRenderer('wechat').normalizeReply(notice, '')).toEqual(
      expected,
    );
    expect(resolveChannelRenderer('client').normalizeReply(notice, '')).toEqual(
      expected,
    );
  });
});

describe('消息六类的姿态与调度是结构化字段', () => {
  it('恰好六类', () => {
    expect([...MESSAGE_KINDS]).toEqual([
      'collection_request',
      'discrepancy_fact',
      'deadline_reminder',
      'exception_block',
      'authorization_confirm',
      'status_notice',
    ]);
  });

  it('只有采集请求与差异补事实可软化，其余四类必须直说', () => {
    const softenable = MESSAGE_KINDS.filter((kind: MessageKind) =>
      isSoftenable(kind),
    );
    expect(softenable).toEqual(['collection_request', 'discrepancy_fact']);
  });

  it('可合并的与必须直发的互斥，且覆盖不重叠', () => {
    for (const kind of MESSAGE_KINDS) {
      expect(isDailyMergeable(kind) && requiresDirectSend(kind)).toBe(false);
    }
    expect(MESSAGE_KINDS.filter((k) => requiresDirectSend(k))).toEqual([
      'deadline_reminder',
      'exception_block',
      'authorization_confirm',
    ]);
  });
});

describe('渠道可插拔', () => {
  it('当前登记两个渠道，各自 channel 标识自洽', () => {
    expect([...registeredChannels()]).toEqual(['client', 'wechat']);
    for (const channel of registeredChannels()) {
      expect(resolveChannelRenderer(channel).channel).toBe(channel);
    }
  });
});
