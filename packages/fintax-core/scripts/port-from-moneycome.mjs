#!/usr/bin/env node
// 从 moneycome 的一个提交重新搬入 fintax-core。
//
// 用法：node scripts/port-from-moneycome.mjs <moneycome 仓库路径> <提交>
//
// 规则与 A6 一致：逻辑行原样，只改两类东西——
// 1. import 路径：相对路径补 `.js`；测试里指向 harness/src 的路径改指本包 src；
//    `@prisma/client` 改指 `src/shims/prisma-client.ts`（只用到 Prisma.Decimal）。
// 2. 文件头：前置两行，记录来源路径、提交与改动口径。
//
// 清单写在下面两张表里；搬完后跑 `node scripts/a6-diff.mjs <仓库> <提交>` 复核。

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..')

// 本包 src 下的相对路径（不带 .ts），与 moneycome harness/src 下的路径一一对应。
export const SRC = [
  'finance-tasks/question-gate',
  'finance-read/book-read.contract',
  'finance-intake/book-write.contract',
  'finance-intake/material-figures',
  'finance-intake/invoice-subject-direction',
  'finance-intake/chinese-amount',
  'finance-intake/material-intake-turn',
  'finance-intake/statement-import-checks',
  'finance-intake/invoice-self-checks',
  'finance-intake/invoice-facts.contract',
  'finance-disclosure/figure-certainty',
  'finance-onboarding/opening-balance.contract',
  'finance-period/closing-checks',
  'message-channel/message-channel.registry',
  'message-channel/client-card.renderer',
  'message-channel/wechat-text.renderer',
  'message-channel/message-channel.contract',
  'message-channel/message-channel.constants',
  'finance-ledger/business-date',
  'finance-ledger/business-intent',
  'finance-ledger/accounting-pack.contract',
  'finance-ledger/ledger-posting.engine',
  'finance-handoff/week-key',
  'shared/time/accounting-time-zone',
]

// [本包 tests 下的路径, moneycome harness/test/unit 下的路径]
export const TESTS = [
  ['finance-tasks/question-gate.spec.ts', 'finance-tasks/question-gate.spec.ts'],
  ['finance-intake/invoice-self-checks.spec.ts', 'finance-intake/invoice-self-checks.spec.ts'],
  ['finance-intake/statement-import-checks.spec.ts', 'finance-intake/statement-import-checks.spec.ts'],
  ['finance-intake/invoice-subject-direction.spec.ts', 'finance-intake/invoice-subject-direction.spec.ts'],
  ['finance-disclosure/figure-certainty.spec.ts', 'finance-disclosure/figure-certainty.spec.ts'],
  ['finance-period/closing-checks.spec.ts', 'finance-period/closing-checks.spec.ts'],
  ['message-channel/message-channel-dual-render.spec.ts', 'message-channel-dual-render.spec.ts'],
  ['finance-ledger/business-date.spec.ts', 'finance-ledger/business-date.spec.ts'],
  ['finance-ledger/finance-ledger-accounting-pack.spec.ts', 'finance-ledger-accounting-pack.spec.ts'],
  ['finance-ledger/ledger-posting-engine.spec.ts', 'finance-ledger/ledger-posting-engine.spec.ts'],
  ['finance-ledger/pack-swap.spec.ts', 'finance-ledger/pack-swap.spec.ts'],
  ['finance-handoff/week-key.spec.ts', 'finance-handoff/week-key.spec.ts'],
  ['finance-ledger/fixtures/accounting-packs.ts', 'finance-ledger/fixtures/accounting-packs.ts'],
]

const PRISMA_SHIM = 'shims/prisma-client'

function show(repo, commit, path) {
  return execFileSync('git', ['-C', repo, 'show', `${commit}:${path}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

const rel = (fromFile, toFile) => {
  const r = posix.relative(posix.dirname(fromFile), toFile)
  return r.startsWith('.') ? r : `./${r}`
}

// 把 import / export … from 的说明符按 map 改写；其余字符一个不动。
function rewriteSpecifiers(text, map) {
  return text.replace(/(\bfrom\s+|\bimport\s+|\bimport\(\s*)(['"])([^'"]+)\2/g, (m, lead, q, spec) => {
    const next = map(spec)
    return next === spec ? m : `${lead}${q}${next}${q}`
  })
}

function portSrc(repo, commit, path) {
  const text = show(repo, commit, `harness/src/${path}.ts`)
  const here = `src/${path}.ts`
  const out = rewriteSpecifiers(text, (spec) => {
    if (spec === '@prisma/client') return `${rel(here, `src/${PRISMA_SHIM}`)}.js`
    if (spec.startsWith('.') && !spec.endsWith('.js')) return `${spec}.js`
    return spec
  })
  const head = [
    `// 来源：moneycome harness/src/${path}.ts @ ${commit.slice(0, 9)}`,
    '// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。',
  ]
  return `${head.join('\n')}\n${out}`
}

function portTest(repo, commit, [mine, theirs]) {
  const text = show(repo, commit, `harness/test/unit/${theirs}`)
  const theirFile = `harness/test/unit/${theirs}`
  const here = `tests/${mine}`
  const testMap = new Map(TESTS.map(([m, t]) => [`harness/test/unit/${t}`.replace(/\.ts$/, ''), `tests/${m}`.replace(/\.ts$/, '')]))
  const out = rewriteSpecifiers(text, (spec) => {
    if (!spec.startsWith('.')) return spec === '@prisma/client' ? `${rel(here, `src/${PRISMA_SHIM}`)}.js` : spec
    const target = posix.normalize(posix.join(posix.dirname(theirFile), spec)).replace(/\.js$/, '')
    if (target.startsWith('harness/src/')) return `${rel(here, `src/${target.slice('harness/src/'.length)}`)}.js`
    const mapped = testMap.get(target)
    if (mapped) return `${rel(here, mapped)}.js`
    throw new Error(`${theirs}: 指向搬运清单之外的 ${spec}`)
  })
  const head = [
    `// 来源：moneycome harness/test/unit/${theirs} @ ${commit.slice(0, 9)}`,
    '// 断言原样搬入，只改 import 路径与扩展名；运行器由 jest 换成 vitest（globals: true）。',
  ]
  return `${head.join('\n')}\n${out}`
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repo, commit] = process.argv.slice(2)
  if (!repo || !commit || !/^[0-9a-f]{40}$/.test(commit)) {
    console.error('用法：node scripts/port-from-moneycome.mjs <moneycome 仓库路径> <40 位提交>')
    process.exit(2)
  }
  for (const path of SRC) write(join(PKG, 'src', `${path}.ts`), portSrc(repo, commit, path))
  for (const pair of TESTS) write(join(PKG, 'tests', pair[0]), portTest(repo, commit, pair))
  console.log(`搬入 ${SRC.length} 个源文件、${TESTS.length} 个测试文件，基线 ${commit}`)
  console.log(`本包相对仓库路径：${relative(process.cwd(), PKG) || '.'}`)
}
