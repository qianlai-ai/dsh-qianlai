// 来源：moneycome harness/src/finance-ledger/ledger-posting.engine.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * @runtime-status 已接线：落库层 `finance-posting/entry-posting.service.ts` 经
 * `cap.finance.book.create_entry_draft`（BER 登记 + owner GO 2026-08-16）调
 * `postParsedEvent`，分录进 `FinLedgerEntry`。
 *
 * L3 通用记账引擎（开发计划 B3a · 交付物 3.2）。
 *
 * 一句话职责：**给一笔业务事实和一份领域规则包，推出借贷分录。**
 *
 * 代码不认识任何科目、税种、地区或准则。科目目录、记账规则、金额取哪个来源、
 * 需要哪几类证据，全部来自包。引擎只做三件事：按事实匹配规则、按规则解析
 * 分录腿、校验借贷平衡。由架构验收 A1 机器判定本文件零领域常量。
 *
 * 这份文件是 G2 分水岭的判定对象：`pack-swap.spec.ts` 用两份结构相同、内容
 * 不同的包跑同一笔事实，推出不同且各自正确的分录，而本文件一行不改。换不动
 * 就说明分层是假的。
 */

import {
  isSkipRule,
  parseAccountingPackPayload,
  type AccountingPackPayload,
  type AccountingPackPostingRule,
  type AccountingPackRule,
} from './accounting-pack.contract.js';

/** 一笔待记账的业务事实。事实键与取值都是包定义的词，引擎不解释含义。 */
export interface LedgerPostingEvent {
  readonly eventId: string;
  /** `factKey -> value`，如 `{'event.kind': 'revenue'}`。 */
  readonly facts: Readonly<Record<string, string>>;
  /** `amountSource -> 十进制字符串`，如 `{settlement: '12800.00'}`。 */
  readonly amounts: Readonly<Record<string, string>>;
  /** Trusted posting period, supplied by the consumer, not event facts. */
  readonly periodKey?: string;
  /** Loaded from the tenant ledger under the existing source fence. */
  readonly referencedBalance?: {
    readonly sourceEventId: string;
    readonly subjectCode: string;
    readonly sourceDirection: 'debit' | 'credit';
    readonly availableAmount: string;
    readonly scheduledAmount?: string;
  };
}

export interface PostedLeg {
  readonly direction: 'debit' | 'credit';
  readonly subjectCode: string;
  readonly subjectName: string;
  readonly amount: string;
  readonly amountSource: string;
}

/**
 * 一次推导的产物 = 一张凭证。
 *
 * **不含凭证号**：号是按期间连续编的（`PZ-202603-011`），要知道本期已经编到
 * 几号，那是落库层的事。纯函数不问库，也就编不了号——硬编只能编出一个每次
 * 调用都从 1 开始的假号。落库时补，见 `FinLedgerEntry.voucherNo`。
 */
export interface LedgerPosting {
  readonly eventId: string;
  /** 推导所依据的包精确引用，格式 `packId@version#digest`。 */
  readonly packRef: string;
  readonly ruleId: string;
  readonly legs: readonly PostedLeg[];
}

export type LedgerPostingErrorCode =
  | 'LEDGER_NO_RULE_MATCHED'
  | 'LEDGER_AMBIGUOUS_RULE'
  | 'LEDGER_RULE_SKIPS_EVENT'
  | 'LEDGER_AMOUNT_SOURCE_MISSING'
  | 'LEDGER_AMOUNT_INVALID'
  | 'LEDGER_UNKNOWN_SUBJECT'
  | 'LEDGER_UNBALANCED'
  | 'LEDGER_RECOGNITION_PERIOD_MISMATCH'
  | 'LEDGER_REFERENCED_BALANCE_REQUIRED';

export class LedgerPostingError extends Error {
  constructor(
    readonly code: LedgerPostingErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'LedgerPostingError';
  }
}

/**
 * 金额一律走整数分。会计的借贷平衡是逐分比较，`0.1 + 0.2 !== 0.3` 会让一张
 * 平的分录被判成不平。
 *
 * 注：`finance-onboarding` 的期初核验有一份同样的实现。两批分别在各自分支上
 * 落地，合并后应合并成一处；在那之前不跨批次互相 import，免得制造分支依赖。
 */
export function parseAmountToCents(raw: string): bigint | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const cents =
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}

export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n)
    .toString()
    .padStart(2, '0')}`;
}

/**
 * 匹配记账规则。命中策略是 **UNIQUE**：必须恰好一条。
 *
 * 零命中不能默默跳过——那笔业务就没进账，而没人会发现。多条命中更危险：
 * 挑第一条等于让规则在包里的书写顺序决定账怎么记，包一重排账就变了。两种
 * 情况都 fail-closed，交给人。
 */
/**
 * 记法只提供缺省值，不能覆盖已经确认的单笔业务事实。包没声明记法时原样返回；声明了而
 * `schemeCode` 为 null（老板还没选）用 `defaultScheme`；给了包里没有的档就抛——
 * 那是调用方拿错了，不是「按默认」。
 */
export function applySchemePolicy(
  pack: AccountingPackPayload,
  schemeCode: string | null,
  facts: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const scheme = resolveScheme(pack, schemeCode);
  if (scheme === undefined) return facts;
  return {
    ...Object.fromEntries(scheme.policyFacts.map((f) => [f.factKey, f.value])),
    ...facts,
  };
}

export function resolveScheme(
  pack: AccountingPackPayload,
  schemeCode: string | null,
): AccountingPackPayload['schemes'][number] | undefined {
  // 手工拼的旧 payload 可能没有这一格：没声明记法就没有政策，不是错。
  if (pack.schemes === undefined || pack.schemes.length === 0) return undefined;
  const code = schemeCode ?? pack.defaultScheme;
  const scheme = pack.schemes.find((s) => s.schemeCode === code);
  if (scheme === undefined) {
    throw new LedgerPostingError(
      'LEDGER_NO_RULE_MATCHED',
      'scheme is not declared by the bound pack',
      { schemeCode: code },
    );
  }
  return scheme;
}

export function matchRule(
  pack: AccountingPackPayload,
  event: LedgerPostingEvent,
): AccountingPackRule {
  const matched = pack.decisionTables.flatMap((table) =>
    table.rules.filter((rule) =>
      rule.when.every(
        (clause) => event.facts[clause.factKey] === clause.equals,
      ),
    ),
  );

  if (matched.length === 0) {
    throw new LedgerPostingError(
      'LEDGER_NO_RULE_MATCHED',
      'no posting rule in the bound pack matches this event',
      { eventId: event.eventId, facts: event.facts },
    );
  }
  if (matched.length > 1) {
    throw new LedgerPostingError(
      'LEDGER_AMBIGUOUS_RULE',
      'more than one posting rule matches this event; the pack must disambiguate',
      { eventId: event.eventId, ruleIds: matched.map((rule) => rule.ruleId) },
    );
  }
  return matched[0];
}

/**
 * 把一笔业务事实推成分录。
 *
 * 拒绝的四种情况都不给"尽力而为"的降级：宁可不记，也不记一笔说不清的账。
 * 一笔错账进了账本，后面每一步都建立在它上面。
 */
export function postEvent(
  packPayload: unknown,
  packRef: string,
  event: LedgerPostingEvent,
): LedgerPosting {
  return postParsedEvent(
    parseAccountingPackPayload(packPayload),
    packRef,
    event,
  );
}

/**
 * 同 `postEvent`，但收已验真的包。`AccountingRulePackService.resolve` 交出来的
 * 就是这一形状（归一化后没有信封的 `kind`），再喂给 `postEvent` 会被信封 schema
 * 拒掉——落库层用这一个。
 */
export function postParsedEvent(
  pack: AccountingPackPayload,
  packRef: string,
  event: LedgerPostingEvent,
): LedgerPosting {
  const matched = matchRule(pack, event);
  if (isSkipRule(matched)) {
    // 这一档明说不记这笔。不是引擎故障，是包的处理；调用方按 treatment 说人话。
    throw new LedgerPostingError(
      'LEDGER_RULE_SKIPS_EVENT',
      'the matched rule records nothing for this event under the current scheme',
      {
        eventId: event.eventId,
        ruleId: matched.ruleId,
        treatment: matched.treatment,
      },
    );
  }
  if (
    matched.recognitionPeriodFactKey !== undefined &&
    (!event.periodKey ||
      event.facts[matched.recognitionPeriodFactKey] !== event.periodKey)
  ) {
    throw new LedgerPostingError(
      'LEDGER_RECOGNITION_PERIOD_MISMATCH',
      'recognition period must match the attributable event period',
      { eventId: event.eventId, factKey: matched.recognitionPeriodFactKey },
    );
  }
  const transfer = matched.referencedBalance;
  if (
    transfer !== undefined &&
    (!event.referencedBalance ||
      event.referencedBalance.sourceEventId !==
        event.facts[transfer.sourceEventFactKey] ||
      event.referencedBalance.subjectCode !== transfer.subjectCode ||
      event.referencedBalance.sourceDirection !== transfer.sourceDirection ||
      (parseAmountToCents(event.referencedBalance.availableAmount) ?? -1n) <=
        0n)
  ) {
    throw new LedgerPostingError(
      'LEDGER_REFERENCED_BALANCE_REQUIRED',
      'a positive verified balance of the related posting is required',
      { eventId: event.eventId },
    );
  }
  if (transfer?.consumption === 'requested') {
    const requested = parseAmountToCents(
      event.amounts[transfer.amountSource] ?? '',
    );
    const available = parseAmountToCents(
      event.referencedBalance!.availableAmount,
    )!;
    if (
      requested === undefined ||
      requested < 0n ||
      requested > available ||
      (transfer.schedule !== undefined &&
        requested !==
          parseAmountToCents(event.referencedBalance!.scheduledAmount ?? ''))
    ) {
      throw new LedgerPostingError(
        'LEDGER_REFERENCED_BALANCE_REQUIRED',
        'the requested consumption exceeds the verified related balance or differs from the scheduled period amount',
        { eventId: event.eventId },
      );
    }
  }
  const rule: AccountingPackPostingRule = matched;
  const subjects = new Map(
    pack.catalogs[0].subjects.map((subject) => [subject.subjectCode, subject]),
  );

  let debit = 0n;
  let credit = 0n;
  const legs: PostedLeg[] = rule.legs.map((leg) => {
    const subject = subjects.get(leg.subjectCode);
    if (!subject) {
      // 包验真已挡过一次；这里是运行期兜底，因为落错科目的账无法事后辨认。
      throw new LedgerPostingError(
        'LEDGER_UNKNOWN_SUBJECT',
        'posting rule references a subject absent from the bound catalog',
        { ruleId: rule.ruleId, subjectCode: leg.subjectCode },
      );
    }

    const raw =
      transfer !== undefined &&
      transfer.consumption !== 'requested' &&
      leg.amountSource === transfer.amountSource
        ? event.referencedBalance!.availableAmount
        : event.amounts[leg.amountSource];
    if (raw === undefined) {
      throw new LedgerPostingError(
        'LEDGER_AMOUNT_SOURCE_MISSING',
        'the event carries no amount for the source this rule requires',
        {
          eventId: event.eventId,
          ruleId: rule.ruleId,
          amountSource: leg.amountSource,
        },
      );
    }
    const cents = parseAmountToCents(raw);
    if (cents === undefined || cents < 0n) {
      throw new LedgerPostingError(
        'LEDGER_AMOUNT_INVALID',
        'event amount is not a valid non-negative two-decimal amount',
        { eventId: event.eventId, amountSource: leg.amountSource },
      );
    }

    if (leg.direction === 'debit') debit += cents;
    else credit += cents;

    return {
      direction: leg.direction,
      subjectCode: subject.subjectCode,
      subjectName: subject.subjectName,
      amount: formatCents(cents),
      amountSource: leg.amountSource,
    };
  });

  if (debit !== credit) {
    // 常见成因：规则的两条腿取了不同来源，而那两个来源的金额本就不等
    // （合同与到账差一笔手续费是常态）。这时缺的是第三条腿，属包的问题，
    // 不是引擎该替它凑平的。
    throw new LedgerPostingError(
      'LEDGER_UNBALANCED',
      'the posting derived from this rule does not balance',
      {
        eventId: event.eventId,
        ruleId: rule.ruleId,
        debitTotal: formatCents(debit),
        creditTotal: formatCents(credit),
        difference: formatCents(debit - credit),
      },
    );
  }

  return { eventId: event.eventId, packRef, ruleId: rule.ruleId, legs };
}

export interface EvidenceCheckResult {
  readonly satisfied: boolean;
  readonly requiredRoles: readonly string[];
  readonly missingRoles: readonly string[];
}

/**
 * 按包声明的证据要求检查一笔业务事实的证据够不够。
 *
 * 与记账分开：记账回答"这笔账怎么记"，本函数回答"够不够格记"。哪几类证据
 * 算够，是包说了算——两份 fixture 对同一业务形态要求的角色就不同。
 *
 * 包里没为该业务形态声明要求 → `satisfied: true`。没声明不等于不许记；真要
 * 禁止某形态，包里给它一条要求不到的角色即可，那是包的表达，不是引擎的默认。
 */
export function checkEvidenceRequirements(
  packPayload: unknown,
  eventKind: string,
  presentRoles: readonly string[],
): EvidenceCheckResult {
  const pack = parseAccountingPackPayload(packPayload);
  const requirement = pack.evidenceRequirements.find(
    (item) => item.eventKind === eventKind,
  );
  if (!requirement) {
    return { satisfied: true, requiredRoles: [], missingRoles: [] };
  }
  const present = new Set(presentRoles);
  const missingRoles = requirement.requiredRoles.filter(
    (role) => !present.has(role),
  );
  return {
    satisfied: missingRoles.length === 0,
    requiredRoles: requirement.requiredRoles,
    missingRoles,
  };
}
