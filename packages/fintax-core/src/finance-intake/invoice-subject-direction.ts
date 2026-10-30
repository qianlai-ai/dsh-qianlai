// 来源：moneycome harness/src/finance-intake/invoice-subject-direction.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 这张票的抬头是不是我们，我们在哪一边。
 *
 * @runtime-status 未接线：纯函数 + spec。我方主体的存放位置（租户级财税档案）
 * 由另一片落表，本文件只定判定逻辑，表落地后直接接。
 *
 * ## 为什么这件事要从模型手里拿走
 *
 * 「谁是购买方」决定这笔是进项还是销项，方向反了整笔账就是反的。今天这个判断
 * 落在模型读票的那一步——它把两个抬头填进 `buyerName` / `sellerName`，下游照单
 * 全收。而抬头对调是一类**静默**错：六项自检（价税恒等、税率一致、大小写一致、
 * 号码位数、日期、税号位数）对调之后全部照常通过，因为每个数自己都合法。
 *
 * 只要知道我方税号，这个判断就根本不需要模型参与：税号是精确串，比就完了。
 *
 * ## 这条检查抓不到什么（重要，别高估它）
 *
 * 它抓不到**一致的对调**。模型若把我方填进 `sellerName` 而把对方填进
 * `buyerName`，本函数会自信地回「销项」——一个确定的错误答案，比没有答案更难
 * 发现。2026-08-16 的 44 张真跑里 vl-max 正是这么错的：4 张把我方放进卖方槽，
 * 买方槽塞进 3 家外部公司和 1 个自然人。
 *
 * 所以这条检查的价值是**在抽取正确时把方向从模型手里拿走**，不是**发现抽取
 * 错了**。后者要另一层证据（材料是谁传的、我方有没有对应的开票记录），不在
 * 本文件。把「我方出现在卖方就一定是销项」当成结论去用，是把这条检查用超了。
 *
 * 相应地，本函数只报**票面上写着什么**，不报**这合不合理**。「这个租户该不该
 * 有销项」是领域判断，属于规则包，不属于引擎（A1 零领域常量）。
 *
 * ## 为什么名称也要比，不是只比税号
 *
 * 2026-08-16 的 44 张真跑里，`buyerTaxId` / `sellerTaxId` 各只有 30 张读到，
 * 14 张（收据、餐票、行程单一类）票面上根本不印税号；而 `buyerName` 44 张全有、
 * `sellerName` 40 张。只比税号的话，三分之一的材料这条检查等于不存在。
 *
 * 名称只做**精确相等**（归一化空白与全半角之后），不做包含、不做相似度。
 * 「杭州明途科技有限公司」与「杭州明途科技服务有限公司」是两家公司，
 * 包含匹配会把它们判成同一个——而这条检查一旦判错，错的是整笔账的方向。
 *
 * ## 结论分七种，因为下游动作有七种
 *
 * 词表与 `invoice-self-checks` 一致，不另起：`insufficient` 是「有这一栏但读
 * 不出」（值得让用户重拍），`notApplicable` 是「这类票本来就不印抬头」（别再
 * 问用户重拍，问了也没有）。压成一个「判不了」，前台就分不清该做什么。
 */

import {
  fieldValue,
  type InvoiceExtractedFacts,
  type InvoiceField,
  type InvoiceFieldState,
} from './invoice-facts.contract.js';

export type InvoiceSubjectDirection =
  /** 我方是购买方。 */
  | 'input'
  /** 我方是销售方。 */
  | 'output'
  /** 双方抬头都认出来了，都不是我方。 */
  | 'subjectMismatch'
  /** 我方同时出现在买卖两侧——真票不会这样，是读串了。 */
  | 'contradiction'
  /** 票面有抬头栏但读不出，重拍一张可能就有了。 */
  | 'insufficient'
  /** 这类票本来就不印抬头，重拍也不会有。 */
  | 'notApplicable'
  /** 还不知道我方是谁。 */
  | 'unregistered';

/** 判据强度：税号是精确串，名称可能重名或改名。 */
export type InvoiceSubjectDirectionEvidence = 'taxId' | 'name';

export interface InvoiceSubjectDirectionResult {
  readonly direction: InvoiceSubjectDirection;
  /** 只有真比中（或真比完两侧都不中）时才有。 */
  readonly evidence?: InvoiceSubjectDirectionEvidence;
  /** 人能照着核的信息：比的是哪两个串、各自什么状态。不放正文、不放存储引用。 */
  readonly detail?: Record<string, unknown>;
  /** 一句白话，前台与老板面直接显示。不出现财务名词。 */
  readonly plainText?: string;
}

/**
 * 我方主体。两项都可空——租户还没告诉我们的时候，这条检查不判也不拦。
 *
 * 不给默认值、不从别处猜。猜错的后果是把一整批别人的票认成自己的。
 */
export interface FinanceSubjectIdentity {
  readonly subjectName?: string;
  readonly subjectTaxId?: string;
}

export function resolveInvoiceSubjectDirection(
  facts: InvoiceExtractedFacts,
  subject: FinanceSubjectIdentity,
): InvoiceSubjectDirectionResult {
  const ownTaxId = normalizeTaxId(subject.subjectTaxId);
  const ownName = normalizeName(subject.subjectName);
  if (ownTaxId === undefined && ownName === undefined) {
    return {
      direction: 'unregistered',
      plainText:
        '还不知道咱们公司的全称和税号，先告诉我一次，以后这类票我自己认。',
    };
  }

  const byTaxId = matchSide(
    ownTaxId,
    facts.buyerTaxId,
    facts.sellerTaxId,
    normalizeTaxId,
  );
  const decidedByTaxId = decide(byTaxId, 'taxId');
  if (decidedByTaxId !== undefined) return decidedByTaxId;

  const byName = matchSide(
    ownName,
    facts.buyerName,
    facts.sellerName,
    normalizeName,
  );
  const decidedByName = decide(byName, 'name');
  if (decidedByName !== undefined) return decidedByName;

  // 两轮都没判出来。是「读不出」还是「本来就没印」，看四个字段的状态：
  // 只要有一个是 unreadable，就还值得重拍；全是 absent 说明这类票不印抬头。
  const states = {
    buyerTaxId: facts.buyerTaxId.state,
    sellerTaxId: facts.sellerTaxId.state,
    buyerName: facts.buyerName.state,
    sellerName: facts.sellerName.state,
  };
  const anyUnreadable = Object.values(states).some(
    (state: InvoiceFieldState) => state === 'unreadable',
  );
  return anyUnreadable
    ? {
        direction: 'insufficient',
        detail: states,
        plainText: '这张的抬头我没看清，能重拍一张吗？',
      }
    : {
        direction: 'notApplicable',
        detail: states,
        plainText: '这张票上没印抬头，认不出是给谁开的——这类票本来就这样。',
      };
}

interface SideMatch {
  /** 我方这一维（税号或名称）有没有登记。没登记这一轮直接跳过。 */
  readonly comparable: boolean;
  readonly buyer: boolean;
  readonly seller: boolean;
  /** 两侧都读到了值——只有这时「都不是我方」才是结论，否则是证据不足。 */
  readonly bothReadable: boolean;
  readonly detail: Record<string, unknown>;
}

function matchSide(
  own: string | undefined,
  buyerField: InvoiceField<string>,
  sellerField: InvoiceField<string>,
  normalize: (raw: string | undefined) => string | undefined,
): SideMatch {
  const buyer = normalize(fieldValue(buyerField));
  const seller = normalize(fieldValue(sellerField));
  return {
    comparable: own !== undefined,
    buyer: own !== undefined && buyer === own,
    seller: own !== undefined && seller === own,
    bothReadable: buyer !== undefined && seller !== undefined,
    detail: { own, buyer, seller },
  };
}

function decide(
  match: SideMatch,
  evidence: InvoiceSubjectDirectionEvidence,
): InvoiceSubjectDirectionResult | undefined {
  if (!match.comparable) return undefined;
  if (match.buyer && match.seller) {
    return {
      direction: 'contradiction',
      evidence,
      detail: match.detail,
      plainText: '这张票的买方和卖方写的都是咱们，肯定有一边读串了，得看原件。',
    };
  }
  if (match.buyer) {
    return { direction: 'input', evidence, detail: match.detail };
  }
  if (match.seller) {
    return { direction: 'output', evidence, detail: match.detail };
  }
  if (match.bothReadable) {
    return {
      direction: 'subjectMismatch',
      evidence,
      detail: match.detail,
      plainText: '这张票的抬头不是咱们公司，要不要还是记？',
    };
  }
  return undefined;
}

/**
 * 税号归一化：去掉所有空白、字母转大写。
 *
 * 统一社会信用代码含字母，票面与登记两处的大小写不该决定方向。不做位数校验——
 * 那是 `invoice-self-checks` 的 `taxIdShape`，两处各管各的。
 */
function normalizeTaxId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.replace(/\s+/g, '').toUpperCase();
  return value === '' ? undefined : value;
}

/**
 * 名称归一化：`NFKC` 折全半角（票面常见全角括号），去掉所有空白。
 *
 * 只到这一步。繁简转换、去后缀、去「有限公司」都不做：那些会把不同主体折成
 * 同一个，而这条检查判错的代价是整笔账的方向。
 */
function normalizeName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.normalize('NFKC').replace(/\s+/g, '');
  return value === '' ? undefined : value;
}
