---
description: "Qianlai's finance domain core: deterministic pure functions for posting, accounting-pack validation, invoice and statement self-checks and closing checks, copied unchanged from Qianlai's main repository."
kind: "package-library"
---

# @moneycome/fintax-core

English | [中文](README.zh.md)

## Summary

The finance domain core of Qianlai. The `dsh-qianlai` plugin calls these functions to post entries, check invoices, check bank statements and run closing checks.

The files are copied without logic changes from Qianlai's internal repository (`harness/src/finance-*` and `src/message-channel/`). Each file header names its upstream path and commit, and `A6-SNAPSHOT.md` lists the per-file comparison (zero differing logic lines). The package has no DSH dependency and does no database access; its only runtime dependencies are `zod` (accounting-pack validation) and `decimal.js`.

## Use this package

This is a library, not a plugin: no `ctx`, no registration, no state, no I/O. Callers pass in an accounting pack, business facts and amounts, and get deterministic results back.

```ts
import { postParsedEvent, runClosingChecks, runInvoiceSelfChecks } from '@moneycome/fintax-core'
```

## API

The directory layout mirrors upstream `harness/src/` so files can be compared one to one.

| Module | Main exports |
|---|---|
| `finance-ledger/ledger-posting.engine` | `postEvent` / `postParsedEvent` (facts + amounts + pack → the legs of one voucher), `matchRule`, `checkEvidenceRequirements` |
| `finance-ledger/accounting-pack.contract` | the accounting-pack zod schema, `parseAccountingPackPayload`, `AccountingPackPayload` |
| `finance-period/closing-checks` | `runClosingChecks`: six pre-close checks, all run without short-circuiting |
| `finance-intake/invoice-self-checks` | `runInvoiceSelfChecks`: internal consistency of one invoice |
| `finance-intake/invoice-subject-direction` | `resolveInvoiceSubjectDirection`: whether we are the buyer or the seller |
| `finance-intake/chinese-amount` | `parseChineseAmountToCents`: amounts written in Chinese numerals |
| `finance-intake/statement-import-checks` | `runStatementImportChecks`, `runPrintedFigureChecks`: dates, amounts, balance chain, duplicate rows, period coverage and printed figures of a bank statement |
| `finance-onboarding/opening-balance.contract` | opening-balance submission shape and verdict states |
| `finance-tasks/question-gate` | `selectQuestionsToAsk`: how many questions to ask in one turn |
| `finance-disclosure/figure-certainty` | `assessFigure`: whether a figure can be stated, and which facts are missing if not |
| `message-channel/*` | web card and WeChat plain-text renderers |

The barrel `src/index.ts` re-exports everything. Both `opening-balance.contract` and `ledger-posting.engine` define `parseAmountToCents` / `formatCents`; the former are re-exported as `parseOpeningBalanceAmountToCents` / `formatOpeningBalanceCents`.

All domain knowledge comes from the accounting pack (`AccountingPackPayload`): a different pack brings different subjects, posting rules, checks and report lines. `tests/finance-ledger/pack-swap.spec.ts` verifies that swapping packs needs no code change, and `tests/arch/no-domain-constants.spec.ts` scans the source for tax names, subject codes, tax rates and similar domain constants.

## Model Experience

The package builds almost no model input: figures are computed by deterministic functions and handed to the model inside tool results, so the model reads them instead of calculating. The one exception is `finance-intake/material-intake-turn`, the question text used when collecting materials, which belongs in the plugin that uses it.

## Known Limitations and Deferred Work

- **Two compiler checks are off** compared with the repository base: `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, matching upstream. Turning them on reports 20 errors in four copied files, which cannot be fixed without changing logic.
- **One test file is excluded from type checking.** `tests/finance-ledger/finance-ledger-accounting-pack.spec.ts` has six type errors (assignments to a readonly fixture, a union not narrowed) that also appear with upstream's compiler settings. It still runs; `tsconfig.test.json` only leaves it out of `tsc`.
- **The domain-constant scan cannot see digit-length sets.** The invoice-number and tax-ID length sets in `invoice-self-checks.ts` are registered as exemptions; a test fails once they move, as a reminder to drop the exemption.
- `chinese-amount`, `book-read.contract`, `invoice-facts.contract` and `opening-balance.contract` have no dedicated tests and are covered through other tests.

## Dev Note

`scripts/port-from-moneycome.mjs` re-copies the files from a given upstream commit; `scripts/a6-diff.mjs <upstream repo path> [commit]` compares logic lines file by file and exits 1 when any differ. Both need read access to Qianlai's internal repository and are for maintainers only. Do not edit the copied files by hand: change upstream first, then copy again.
