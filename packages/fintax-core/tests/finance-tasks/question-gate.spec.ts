// 来源：moneycome harness/test/unit/finance-tasks/question-gate.spec.ts @ 422cbfe30
// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。
import {
  DEFAULT_ASK_LIMIT,
  isWithinMergeBudget,
  selectQuestionsToAsk,
  type OutstandingQuestion,
  type PendingQuestion,
} from '../../src/finance-tasks/question-gate.js';

function q(
  over: Partial<PendingQuestion> & { questionId: string },
): PendingQuestion {
  return {
    rootCauseKey: `rc-${over.questionId}`,
    periodKey: '2026-03',
    blocksClosing: false,
    assignee: 'reception',
    createdSeq: 1,
    ...over,
  };
}

describe('提问下发闸', () => {
  describe('默认一次只下发一件', () => {
    it('三个待问只出一个，其余排队且标明原因', () => {
      const decision = selectQuestionsToAsk([
        q({ questionId: 'a', createdSeq: 1 }),
        q({ questionId: 'b', createdSeq: 2 }),
        q({ questionId: 'c', createdSeq: 3 }),
      ]);

      expect(decision.toAsk).toEqual(['a']);
      expect(decision.queued).toEqual(['b', 'c']);
      expect(decision.queuedReason).toEqual({
        b: 'budget_full',
        c: 'budget_full',
      });
    });

    it('排队的一个都不能丢——Z1 禁止「预算满了就静默入账」', () => {
      const pending = [
        q({ questionId: 'a' }),
        q({ questionId: 'b' }),
        q({ questionId: 'c' }),
        q({ questionId: 'd' }),
      ];
      const decision = selectQuestionsToAsk(pending);

      expect([...decision.toAsk, ...decision.queued].sort()).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
    });

    it('默认上限就是 1', () => {
      expect(DEFAULT_ASK_LIMIT).toBe(1);
    });
  });

  describe('优先级：挡结账 > 期间早 > 先产生', () => {
    it('挡结账的插到前面，哪怕它产生得更晚', () => {
      const decision = selectQuestionsToAsk([
        q({ questionId: 'early', createdSeq: 1, blocksClosing: false }),
        q({ questionId: 'blocker', createdSeq: 9, blocksClosing: true }),
      ]);

      expect(decision.toAsk).toEqual(['blocker']);
    });

    it('同为挡结账时，期间早的先问', () => {
      const decision = selectQuestionsToAsk([
        q({ questionId: 'apr', periodKey: '2026-04', blocksClosing: true }),
        q({ questionId: 'mar', periodKey: '2026-03', blocksClosing: true }),
      ]);

      expect(decision.toAsk).toEqual(['mar']);
    });

    it('其余条件相同时先产生的先问', () => {
      const decision = selectQuestionsToAsk([
        q({ questionId: 'later', createdSeq: 7 }),
        q({ questionId: 'earlier', createdSeq: 2 }),
      ]);

      expect(decision.toAsk).toEqual(['earlier']);
    });

    it('输入顺序不影响结果——可复算', () => {
      const rows = [
        q({ questionId: 'a', createdSeq: 3 }),
        q({ questionId: 'b', createdSeq: 1, blocksClosing: true }),
        q({ questionId: 'c', createdSeq: 2 }),
      ];
      const forward = selectQuestionsToAsk(rows);
      const reversed = selectQuestionsToAsk([...rows].reverse());

      expect(reversed).toEqual(forward);
    });
  });

  describe('已下发的占预算，已转发的不占', () => {
    it('已有一个 asked 时，新问题全部排队', () => {
      const outstanding: OutstandingQuestion[] = [
        { questionId: 'old', assignee: 'reception', state: 'asked' },
      ];
      const decision = selectQuestionsToAsk(
        [q({ questionId: 'new' })],
        outstanding,
      );

      expect(decision.toAsk).toEqual([]);
      expect(decision.queued).toEqual(['new']);
    });

    it('转发给老板之后前台能接着做下一件——waiting 不占预算', () => {
      const outstanding: OutstandingQuestion[] = [
        { questionId: 'forwarded', assignee: 'reception', state: 'waiting' },
      ];
      const decision = selectQuestionsToAsk(
        [q({ questionId: 'next' })],
        outstanding,
      );

      expect(decision.toAsk).toEqual(['next']);
    });
  });

  describe('两个人各自独立预算', () => {
    it('前台占满不挡老板的问题', () => {
      const outstanding: OutstandingQuestion[] = [
        { questionId: 'r1', assignee: 'reception', state: 'asked' },
      ];
      const decision = selectQuestionsToAsk(
        [
          q({ questionId: 'forReception', assignee: 'reception' }),
          q({ questionId: 'forBoss', assignee: 'boss' }),
        ],
        outstanding,
      );

      expect(decision.toAsk).toEqual(['forBoss']);
      expect(decision.queued).toEqual(['forReception']);
    });

    it('一次调用里两个人各拿一个', () => {
      const decision = selectQuestionsToAsk([
        q({ questionId: 'r', assignee: 'reception', createdSeq: 1 }),
        q({ questionId: 'b', assignee: 'boss', createdSeq: 2 }),
      ]);

      expect([...decision.toAsk].sort()).toEqual(['b', 'r']);
    });
  });

  describe('同根因不同时下发（第二道保险）', () => {
    it('⑦ 合并漏了也不会让同一件事问两遍', () => {
      const decision = selectQuestionsToAsk(
        [
          q({
            questionId: 'a',
            rootCauseKey: 'missing-invoice-E4',
            createdSeq: 1,
          }),
          q({
            questionId: 'b',
            rootCauseKey: 'missing-invoice-E4',
            createdSeq: 2,
          }),
        ],
        [],
        5,
      );

      expect(decision.toAsk).toEqual(['a']);
      expect(decision.queuedReason.b).toBe('same_root_cause_already_asked');
    });

    it('同根因排队的原因与预算满区分得开', () => {
      const decision = selectQuestionsToAsk(
        [
          q({ questionId: 'a', rootCauseKey: 'same' }),
          q({ questionId: 'b', rootCauseKey: 'same' }),
          q({ questionId: 'c', rootCauseKey: 'other' }),
        ],
        [],
        1,
      );

      expect(decision.queuedReason.b).toBe('same_root_cause_already_asked');
      expect(decision.queuedReason.c).toBe('budget_full');
    });

    // 以下三条是 2026-08-15 修：初版根因去重只在单次调用内生效，跨调用漏。
    // limit=1 且同承办人时预算恰好兜住，看不出来；分派给两个人就露馅。
    it('跨调用也挡：已下发给前台，同根因的老板问题不再下发', () => {
      const decision = selectQuestionsToAsk(
        [q({ questionId: 'b', rootCauseKey: 'same', assignee: 'boss' })],
        [
          {
            questionId: 'a',
            assignee: 'reception',
            state: 'asked',
            rootCauseKey: 'same',
          },
        ],
        1,
      );

      expect(decision.toAsk).toEqual([]);
      expect(decision.queuedReason.b).toBe('same_root_cause_already_asked');
    });

    it('已转发的不占预算，但占根因', () => {
      const outstanding: OutstandingQuestion[] = [
        {
          questionId: 'a',
          assignee: 'reception',
          state: 'waiting',
          rootCauseKey: 'same',
        },
      ];

      // 不同根因：waiting 不占预算，照常下发（不变式 2 不变）。
      expect(
        selectQuestionsToAsk(
          [q({ questionId: 'other', rootCauseKey: 'different' })],
          outstanding,
        ).toAsk,
      ).toEqual(['other']);

      // 同根因：转出去恰恰说明这件事有人在办，不该再问一遍。
      expect(
        selectQuestionsToAsk(
          [q({ questionId: 'b', rootCauseKey: 'same' })],
          outstanding,
        ).queuedReason.b,
      ).toBe('same_root_cause_already_asked');
    });

    it('outstanding 不带 rootCauseKey 时退回单次调用内去重', () => {
      const decision = selectQuestionsToAsk(
        [q({ questionId: 'b', rootCauseKey: 'same', assignee: 'boss' })],
        [{ questionId: 'a', assignee: 'reception', state: 'asked' }],
        1,
      );

      expect(decision.toAsk).toEqual(['b']);
    });
  });

  describe('06 样本 Z1：不同根因的缺口达到 5 个', () => {
    it('只下发最关键的一个，其余四个原样排队', () => {
      const decision = selectQuestionsToAsk([
        q({ questionId: 'z1', rootCauseKey: 'gap1', createdSeq: 1 }),
        q({
          questionId: 'z2',
          rootCauseKey: 'gap2',
          createdSeq: 2,
          blocksClosing: true,
        }),
        q({ questionId: 'z3', rootCauseKey: 'gap3', createdSeq: 3 }),
        q({ questionId: 'z4', rootCauseKey: 'gap4', createdSeq: 4 }),
        q({ questionId: 'z5', rootCauseKey: 'gap5', createdSeq: 5 }),
      ]);

      expect(decision.toAsk).toEqual(['z2']);
      expect(decision.queued).toHaveLength(4);
    });
  });

  describe('入参校验', () => {
    it.each([0, -1, 1.5, Number.NaN])('拒绝非法上限 %p', (bad) => {
      expect(() => selectQuestionsToAsk([], [], bad)).toThrow(RangeError);
    });

    it('空队列返回空决策，不报错', () => {
      expect(selectQuestionsToAsk([])).toEqual({
        toAsk: [],
        queued: [],
        queuedReason: {},
      });
    });
  });

  describe('合并质量指标与下发闸是两回事', () => {
    it('06 §4.2 的预算是 3，测的是合并做得好不好', () => {
      expect(isWithinMergeBudget(3)).toBe(true);
      expect(isWithinMergeBudget(4)).toBe(false);
    });

    it('合并超预算不影响下发——该修的是合并逻辑，不是吞掉问题', () => {
      const fiveDistinct = Array.from({ length: 5 }, (_, i) =>
        q({ questionId: `q${i}`, rootCauseKey: `rc${i}`, createdSeq: i }),
      );

      expect(isWithinMergeBudget(fiveDistinct.length)).toBe(false);

      const decision = selectQuestionsToAsk(fiveDistinct);
      expect(decision.toAsk).toHaveLength(1);
      expect(decision.queued).toHaveLength(4);
    });
  });
});
