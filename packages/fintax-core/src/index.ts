/**
 * `@moneycome/fintax-core` 的桶文件。
 *
 * 这里只做转发，不定义任何东西：领域核的每个文件都是从 moneycome 原样搬来的，
 * 桶文件是本包新写的代码之一（另一个是 `shims/prisma-client.ts`）。目录结构与 moneycome
 * 的 `harness/src/` 保持一致，为的是 diff 能逐文件对齐。
 */

// L1 会计事实与 L3 通用引擎
export * from './finance-ledger/business-date.js'
export * from './finance-ledger/accounting-pack.contract.js'
export * from './finance-ledger/ledger-posting.engine.js'
export * from './finance-period/closing-checks.js'

// 材料进项：发票要素、自洽校验、大写金额、流水导入
export * from './finance-intake/invoice-facts.contract.js'
export * from './finance-intake/invoice-self-checks.js'
export * from './finance-intake/invoice-subject-direction.js'
export * from './finance-intake/chinese-amount.js'
export * from './finance-intake/material-figures.js'
export * from './finance-intake/statement-import-checks.js'
export * from './finance-intake/book-write.contract.js'
export * from './finance-intake/material-intake-turn.js'

// 读侧、期初、任务、披露、交接
export * from './finance-read/book-read.contract.js'
// moneycome 里 `opening-balance.contract` 与 `ledger-posting.engine` 各有一份同名的
// `parseAmountToCents` / `formatCents`，两份实现不同（期初那份只收两位小数写法）。
// 桶文件不合并、不挑一个，期初那两个加前缀转发；两个源文件里的名字一个字没动。
export {
  parseAmountToCents as parseOpeningBalanceAmountToCents,
  formatCents as formatOpeningBalanceCents,
  OPENING_BALANCE_CHECKS,
  OPENING_BALANCE_ERROR_CODES,
  resolveOpeningBalanceState,
  blockingOpeningBalanceChecks,
  pendingOpeningBalanceChecks,
} from './finance-onboarding/opening-balance.contract.js'
export type {
  OpeningBalanceCheck,
  OpeningBalanceCheckStatus,
  OpeningBalanceCheckResult,
  OpeningBalanceVerdict,
  OpeningBalanceVerification,
  OpeningBalanceEntryInput,
  AccountStatementBalanceInput,
  OpeningBalanceSubmission,
} from './finance-onboarding/opening-balance.contract.js'
export * from './finance-tasks/question-gate.js'
export * from './finance-disclosure/figure-certainty.js'
export * from './finance-handoff/week-key.js'

// L6 消息与渠道
export * from './message-channel/message-channel.constants.js'
export * from './message-channel/message-channel.contract.js'
export * from './message-channel/client-card.renderer.js'
export * from './message-channel/wechat-text.renderer.js'
export * from './message-channel/message-channel.registry.js'
