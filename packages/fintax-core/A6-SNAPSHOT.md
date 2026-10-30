# A6 换 harness 快照 · `@moneycome/fintax-core`

> 验收 A6：`fintax-core` 与 moneycome 同源文件的逻辑行 diff 为空。
> 基线：moneycome develop 的提交 `422cbfe30c7832e0753248685c602a6b8ff78371`（下称 `422cbfe3`），2026-10-23 换基线。上一版基线是 `f9f469d7`（2026-08-17）。

## 汇总

| 指标 | 数字 |
|---|---|
| 搬来的源文件 | 24 个，6,169 行（含文件头） |
| 搬来的 spec | 12 个，3,862 行 |
| 搬来的 fixture | 1 个，244 行 |
| 对 diff 的文件合计 | 37 个 |
| 逻辑行 diff 总数 | 0 |
| 本包自己写的文件 | `src/index.ts`（桶）、`src/shims/prisma-client.ts`（垫片）、`tests/arch/no-domain-constants.spec.ts`（A1） |

复算：`node scripts/a6-diff.mjs [moneycome 路径] [基线提交]`，逻辑行非 0 时退出码为 1。脚本先跑两条分类器自测（多行 import 改路径加一行逻辑改动；多行转导出改路径加本地导出改名），自测不过就不跑正式 diff。只跑自测：`node scripts/a6-diff.mjs --selftest`。

重新搬运：`node scripts/port-from-moneycome.mjs <moneycome 路径> <40 位提交>`，清单写在脚本里。

## 与上一版基线相比

- 去掉 `finance-onboarding/opening-balance-verification.ts` 与它的 spec。开源范围不含期初核对；它在 develop 上依赖 `tax-business-facts` → `sandbox/contracts/official-tax-details`，后者属于不开源的报税与沙箱。`src/errors.ts` 原本只为它而写，一并删除。
- 新增闭包内的两个文件：`finance-ledger/business-intent.ts`、`shared/time/accounting-time-zone.ts`。
- `finance-intake/invoice-self-checks.ts` 在 develop 上从 `@prisma/client` 取 `Prisma.Decimal`。搬运时这一行 import 改指 `src/shims/prisma-client.ts`，垫片转到 `decimal.js`（MIT），逻辑行不变。

## 判定口径

`diff -u -b` 的每一行改动归三类之一：

1. 文件头：本包加的 `// 来源：…` 与 `// 原样搬入…` / `// 断言原样搬入…` 两行；
2. import 行：import 语句与 `export … from` 转导出语句覆盖到的行，含多行花括号里的每一行；
3. 其余即逻辑行，目标 0。

允许的改动只有三种：相对 import 补 `.js`；spec 指向 harness/src 的路径改指本包 src（目录层级不同）；`@prisma/client` 改指垫片。

## src

| moneycome 路径 @ `422cbfe3` | 本包路径 | import 改动行 | 逻辑行 diff |
|---|---|---|---|
| `harness/src/finance-disclosure/figure-certainty.ts` | `src/finance-disclosure/figure-certainty.ts` | 0 | 0 |
| `harness/src/finance-handoff/week-key.ts` | `src/finance-handoff/week-key.ts` | 0 | 0 |
| `harness/src/finance-intake/book-write.contract.ts` | `src/finance-intake/book-write.contract.ts` | 0 | 0 |
| `harness/src/finance-intake/chinese-amount.ts` | `src/finance-intake/chinese-amount.ts` | 0 | 0 |
| `harness/src/finance-intake/invoice-facts.contract.ts` | `src/finance-intake/invoice-facts.contract.ts` | 0 | 0 |
| `harness/src/finance-intake/invoice-self-checks.ts` | `src/finance-intake/invoice-self-checks.ts` | 6 | 0 |
| `harness/src/finance-intake/invoice-subject-direction.ts` | `src/finance-intake/invoice-subject-direction.ts` | 2 | 0 |
| `harness/src/finance-intake/material-figures.ts` | `src/finance-intake/material-figures.ts` | 2 | 0 |
| `harness/src/finance-intake/material-intake-turn.ts` | `src/finance-intake/material-intake-turn.ts` | 0 | 0 |
| `harness/src/finance-intake/statement-import-checks.ts` | `src/finance-intake/statement-import-checks.ts` | 0 | 0 |
| `harness/src/finance-ledger/accounting-pack.contract.ts` | `src/finance-ledger/accounting-pack.contract.ts` | 2 | 0 |
| `harness/src/finance-ledger/business-date.ts` | `src/finance-ledger/business-date.ts` | 2 | 0 |
| `harness/src/finance-ledger/business-intent.ts` | `src/finance-ledger/business-intent.ts` | 0 | 0 |
| `harness/src/finance-ledger/ledger-posting.engine.ts` | `src/finance-ledger/ledger-posting.engine.ts` | 2 | 0 |
| `harness/src/finance-onboarding/opening-balance.contract.ts` | `src/finance-onboarding/opening-balance.contract.ts` | 0 | 0 |
| `harness/src/finance-period/closing-checks.ts` | `src/finance-period/closing-checks.ts` | 2 | 0 |
| `harness/src/finance-read/book-read.contract.ts` | `src/finance-read/book-read.contract.ts` | 0 | 0 |
| `harness/src/finance-tasks/question-gate.ts` | `src/finance-tasks/question-gate.ts` | 0 | 0 |
| `harness/src/message-channel/client-card.renderer.ts` | `src/message-channel/client-card.renderer.ts` | 2 | 0 |
| `harness/src/message-channel/message-channel.constants.ts` | `src/message-channel/message-channel.constants.ts` | 0 | 0 |
| `harness/src/message-channel/message-channel.contract.ts` | `src/message-channel/message-channel.contract.ts` | 2 | 0 |
| `harness/src/message-channel/message-channel.registry.ts` | `src/message-channel/message-channel.registry.ts` | 8 | 0 |
| `harness/src/message-channel/wechat-text.renderer.ts` | `src/message-channel/wechat-text.renderer.ts` | 2 | 0 |
| `harness/src/shared/time/accounting-time-zone.ts` | `src/shared/time/accounting-time-zone.ts` | 0 | 0 |

## tests

| moneycome 路径 @ `422cbfe3` | 本包路径 | import 改动行 | 逻辑行 diff |
|---|---|---|---|
| `harness/test/unit/finance-disclosure/figure-certainty.spec.ts` | `tests/finance-disclosure/figure-certainty.spec.ts` | 2 | 0 |
| `harness/test/unit/finance-handoff/week-key.spec.ts` | `tests/finance-handoff/week-key.spec.ts` | 2 | 0 |
| `harness/test/unit/finance-intake/invoice-self-checks.spec.ts` | `tests/finance-intake/invoice-self-checks.spec.ts` | 6 | 0 |
| `harness/test/unit/finance-intake/invoice-subject-direction.spec.ts` | `tests/finance-intake/invoice-subject-direction.spec.ts` | 4 | 0 |
| `harness/test/unit/finance-intake/statement-import-checks.spec.ts` | `tests/finance-intake/statement-import-checks.spec.ts` | 2 | 0 |
| `harness/test/unit/finance-ledger/business-date.spec.ts` | `tests/finance-ledger/business-date.spec.ts` | 2 | 0 |
| `harness/test/unit/finance-ledger-accounting-pack.spec.ts` | `tests/finance-ledger/finance-ledger-accounting-pack.spec.ts` | 4 | 0 |
| `harness/test/unit/finance-ledger/fixtures/accounting-packs.ts` | `tests/finance-ledger/fixtures/accounting-packs.ts` | 0 | 0 |
| `harness/test/unit/finance-ledger/ledger-posting-engine.spec.ts` | `tests/finance-ledger/ledger-posting-engine.spec.ts` | 4 | 0 |
| `harness/test/unit/finance-ledger/pack-swap.spec.ts` | `tests/finance-ledger/pack-swap.spec.ts` | 4 | 0 |
| `harness/test/unit/finance-period/closing-checks.spec.ts` | `tests/finance-period/closing-checks.spec.ts` | 2 | 0 |
| `harness/test/unit/finance-tasks/question-gate.spec.ts` | `tests/finance-tasks/question-gate.spec.ts` | 2 | 0 |
| `harness/test/unit/message-channel-dual-render.spec.ts` | `tests/message-channel/message-channel-dual-render.spec.ts` | 6 | 0 |
