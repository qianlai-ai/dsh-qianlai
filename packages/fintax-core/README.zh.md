---
description: "钱来财税的领域核：记账引擎、会计包校验、发票与流水自查、结账检查等确定性纯函数，从钱来主仓原样搬来。"
kind: "package-library"
---

# @moneycome/fintax-core

[English](README.md) | 中文

## 概述

钱来财税的领域核。`dsh-qianlai` 插件的记账、核票、流水自查、结账检查都调这里的函数。

这些文件从钱来内部仓库 `harness/src/finance-*` 与 `src/message-channel/` 原样搬来，逻辑一行不改：每个文件头写着上游路径和提交，`A6-SNAPSHOT.md` 列出逐文件对比的结果（逻辑行差异为 0）。本包没有 DSH 依赖，也不连数据库；运行时依赖只有 `zod`（校验会计包）和 `decimal.js`。

## 使用本包

本包是库，不是插件：没有 `ctx`、没有注册、没有状态，也不做 I/O。调用方把会计包、业务事实和金额传进来，拿回确定的结果。

```ts
import { postParsedEvent, runClosingChecks, runInvoiceSelfChecks } from '@moneycome/fintax-core'
```

## API

目录结构与上游 `harness/src/` 一一对应，便于逐文件对比。

| 模块 | 主要导出 |
|---|---|
| `finance-ledger/ledger-posting.engine` | `postEvent` / `postParsedEvent`（事实 + 金额 + 会计包 → 一张凭证的分录）、`matchRule`、`checkEvidenceRequirements` |
| `finance-ledger/accounting-pack.contract` | 会计包的 zod schema、`parseAccountingPackPayload`、`AccountingPackPayload` |
| `finance-period/closing-checks` | `runClosingChecks`：结账前六项检查，全部跑完不短路 |
| `finance-intake/invoice-self-checks` | `runInvoiceSelfChecks`：一张发票自身的一致性检查 |
| `finance-intake/invoice-subject-direction` | `resolveInvoiceSubjectDirection`：这张票我方是买方还是卖方 |
| `finance-intake/chinese-amount` | `parseChineseAmountToCents`：大写金额 |
| `finance-intake/statement-import-checks` | `runStatementImportChecks`、`runPrintedFigureChecks`：流水的日期、金额、余额连续、重复行、覆盖区间、原件印的数字 |
| `finance-onboarding/opening-balance.contract` | 期初余额的提交形状与结论状态 |
| `finance-tasks/question-gate` | `selectQuestionsToAsk`：一轮问几个问题 |
| `finance-disclosure/figure-certainty` | `assessFigure`：一个数说得清还是说不清，缺哪些事实 |
| `message-channel/*` | 网页卡片与微信纯文本两种渲染 |

桶文件 `src/index.ts` 平铺转发。`opening-balance.contract` 与 `ledger-posting.engine` 都有 `parseAmountToCents` / `formatCents`，前者在桶里改名转发为 `parseOpeningBalanceAmountToCents` / `formatOpeningBalanceCents`。

领域知识全部从会计包（`AccountingPackPayload`）读：换一本包就换一套科目、记账规则、检查项和报表行，`tests/finance-ledger/pack-swap.spec.ts` 验证换包不需要改代码。`tests/arch/no-domain-constants.spec.ts` 扫描源码，确保代码里不写税种名、科目号、税率这类领域常量。

## 模型体验

本包基本不组装模型输入：数字由确定性函数算好，放进工具结果给模型读，模型不需要自己算。唯一的例外是 `finance-intake/material-intake-turn`，它是收材料时的问句文本，按理应放在使用它的插件里。

## 已知限制与延期工作

- **编译开关比仓库根宽松两档。** 本包关掉了 `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes`，和上游一致。打开会在搬来的四个文件上报 20 处，要消掉就得改逻辑。
- **一份测试没进类型检查。** `tests/finance-ledger/finance-ledger-accounting-pack.spec.ts` 有 6 处类型错误（只读 fixture 被赋值、联合类型没有收窄），换成上游的编译设置照样报，是测试本身的问题。它照常运行，只是被 `tsconfig.test.json` 排除在类型检查外。
- **领域常量扫描照不到「位数集合」。** `invoice-self-checks.ts` 里的发票号码与税号位数集合登记为豁免，测试会在它们被移走那天失败，提醒删掉豁免。
- `chinese-amount`、`book-read.contract`、`invoice-facts.contract`、`opening-balance.contract` 没有专属测试，经别的测试间接覆盖。

## 开发备注

`scripts/port-from-moneycome.mjs` 从上游指定提交整批重新搬运；`scripts/a6-diff.mjs <上游仓库路径> [提交]` 逐文件对比逻辑行，不为 0 时退出码为 1。这两个脚本需要能读钱来内部仓库，只给维护者用。搬来的文件不要手改，要改先改上游，再重新搬。
