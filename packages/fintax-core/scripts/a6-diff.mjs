/**
 * A6 换 harness 验收：本包每个搬来的文件与 moneycome 同源文件的逻辑行 diff。
 *
 * 基线是 moneycome 的**提交**（默认 A6_BASE，见下），不是工作树——2026-08-17 搬运
 * 当天工作树正在被改（`accounting-pack.contract.ts` 半小时内从 541 行长到 594 行），
 * 拿工作树当基线，数字会随别人敲键盘变。
 *
 * 判定口径：`diff -u -b` 出来的每一行改动，归三类之一——
 *   - 本包加的文件头（`// 来源：` / `// 原样搬入` / `// 断言原样搬入` / `// 本文件是` / `// 注意：`）；
 *   - import 语句覆盖的行（含多行 import 花括号里的每一行）；
 *   - 其余即**逻辑行**。目标是 0。
 *
 * 用法：node scripts/a6-diff.mjs <moneycome 仓库路径> [基线 commit]（需要能读钱来主仓）
 *       node scripts/a6-diff.mjs --selftest   只跑分类器自测，不碰 moneycome
 * 退出码：逻辑行 diff 非 0 时为 1；分类器自测不过时为 1（每次运行都先跑自测）。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const MC = process.argv[2]
const BASE = process.argv[3] ?? '422cbfe30c7832e0753248685c602a6b8ff78371'
const PKG = join(dirname(new URL(import.meta.url).pathname), '..')
const TMP = mkdtempSync(join(tmpdir(), 'a6-'))

/** 搬进本包时换了目录的文件，其余按同名映射。 */
const TEST_ORIGIN = {
  'finance-ledger/finance-ledger-accounting-pack.spec.ts':
    'harness/test/unit/finance-ledger-accounting-pack.spec.ts',
  'message-channel/message-channel-dual-render.spec.ts':
    'harness/test/unit/message-channel-dual-render.spec.ts',
  'finance-ledger/fixtures/accounting-packs.ts':
    'harness/test/unit/finance-ledger/fixtures/accounting-packs.ts',
}

/** 本包自己写的、moneycome 没有对应物的文件，不参与 diff。 */
const OURS_ONLY = {
  src: ['index.ts', 'shims/prisma-client.ts'],
  tests: ['arch/no-domain-constants.spec.ts'],
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

const isHeader = (line) => /^\/\/ (来源：|原样搬入|断言原样搬入|本文件是|注意：)/.test(line)

/** 一条 import 语句在这一行结束：`from '…'`、裸的副作用 import，或以分号收尾。 */
function endsImportStatement(line) {
  return (
    /\bfrom\s+['"][^'"]*['"]\s*;?$/.test(line) ||
    /^import\s+['"][^'"]*['"]\s*;?$/.test(line) ||
    /;$/.test(line)
  )
}

/**
 * 一个文件里所有 import 语句覆盖到的行（去空白后的原文），用于把 import 改动摘出去。
 *
 * 边界按**语句**判，不按分号判：本仓与 moneycome 的源文件分号风格不一致，早期版本
 * 只认分号，遇到不带分号的 import 会一路 `inside` 到文件尾，把整个文件当成 import，
 * 逻辑行恒为 0——门禁静默失真。现在多行 import 到 `from '…'` 那一行为止，另认裸的
 * 副作用 import、分号收尾与空行三种断点。
 */
function importLines(text) {
  const set = new Set()
  let inside = false
  // 转导出 `export { … } from '…'` / `export * from '…'` 也是路径语句，但 `export {` 开头的
  // 也可能是本地导出。先暂存，只有这条语句以 `from '…'` 收尾才计入。
  let reexport = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (reexport) {
      if (line.length === 0) { reexport = null; continue }
      reexport.push(line)
      if (/\bfrom\s+['"][^'"]*['"]\s*;?$/.test(line)) { reexport.forEach((l) => set.add(l)); reexport = null }
      else if (/;$/.test(line)) reexport = null
      continue
    }
    if (!inside) {
      if (/^export\s+(type\s+)?(\{|\*)/.test(line)) {
        if (/\bfrom\s+['"][^'"]*['"]\s*;?$/.test(line)) set.add(line)
        else if (!/;$/.test(line) && !/\}\s*;?$/.test(line)) reexport = [line]
        continue
      }
      // `import(` 是动态 import 表达式，属逻辑行，不开语句。
      if (!/^import\b/.test(line) || /^import\s*\(/.test(line)) continue
      inside = true
    } else if (line.length === 0) {
      inside = false
      continue
    }
    set.add(line)
    if (endsImportStatement(line)) inside = false
  }
  return set
}

/** 把一对文本的 diff 归成三类。 */
function classify(baseText, oursText) {
  const baseFile = join(TMP, 'base.ts')
  const oursFile = join(TMP, 'ours.ts')
  writeFileSync(baseFile, baseText)
  writeFileSync(oursFile, oursText)

  const imports = new Set([...importLines(baseText), ...importLines(oursText)])
  let raw = ''
  try {
    execFileSync('diff', ['-u', '-b', baseFile, oursFile], { encoding: 'utf8', maxBuffer: 1 << 26 })
  } catch (err) {
    raw = err.stdout ?? ''
  }
  const changed = raw
    .split('\n')
    .filter(
      (l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---'),
    )
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 0)

  return {
    importChanges: changed.filter((l) => imports.has(l)).length,
    headerLines: changed.filter((l) => isHeader(l)).length,
    logic: changed.filter((l) => !imports.has(l) && !isHeader(l)),
  }
}

/**
 * 分类器自测：不带分号的多行 import 改了路径，另加一行逻辑改动。
 * 期望 import±2、logic±1；旧的分号识别器在这里会报 logic±0。
 */
function selfTest() {
  const base = [
    '// 来源：selftest',
    'import {',
    '  alpha,',
    '  beta',
    "} from '../x'",
    '',
    'export const answer = alpha + beta',
    '',
  ].join('\n')
  const ours = [
    '// 来源：selftest',
    'import {',
    '  alpha,',
    '  beta',
    "} from '../x.js'",
    '',
    'export const answer = alpha + beta',
    'export const extra = 1',
    '',
  ].join('\n')

  const got = classify(base, ours)
  const ok = got.importChanges === 2 && got.logic.length === 1
  console.log(
    `自测（不带分号的多行 import + 一行逻辑改动）：import±${got.importChanges} logic±${got.logic.length} → ${ok ? 'ok' : 'FAIL'}`,
  )
  if (!ok) {
    console.error('分类器失真：期望 import±2 logic±1，实测如上。不跑正式 diff。')
    process.exit(1)
  }

  // 第二例：多行转导出只改路径算 import；本地 `export { … }` 的改动仍算逻辑行。
  const reBase = ['export {', '  a,', '  b,', "} from '../y'", 'const q = 1', 'export { q }', ''].join('\n')
  const reOurs = ['export {', '  a,', '  b,', "} from '../y.js'", 'const q = 1', 'export { q as qq }', ''].join('\n')
  const re = classify(reBase, reOurs)
  const reOk = re.importChanges === 2 && re.logic.length === 2
  console.log(
    `自测（多行转导出改路径 + 本地导出改名）：import±${re.importChanges} logic±${re.logic.length} → ${reOk ? 'ok' : 'FAIL'}`,
  )
  if (!reOk) {
    console.error('分类器失真：期望 import±2 logic±2，实测如上。不跑正式 diff。')
    process.exit(1)
  }
}

function compare(baseDir, originMap, originPrefix, skip) {
  const rows = []
  for (const file of walk(join(PKG, baseDir)).sort()) {
    const rel = relative(join(PKG, baseDir), file)
    if (skip.includes(rel)) continue
    const origin = originMap[rel] ?? `${originPrefix}${rel}`
    const baseText = execFileSync('git', ['-C', MC, 'show', `${BASE}:${origin}`], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    })
    rows.push({ file: `${baseDir}/${rel}`, origin, ...classify(baseText, readFileSync(file, 'utf8')) })
  }
  return rows
}

selfTest()
if (process.argv.includes('--selftest')) process.exit(0)
if (!MC) {
  console.error('要给出钱来主仓的路径：node scripts/a6-diff.mjs <moneycome 仓库路径> [基线 commit]')
  process.exit(1)
}

const rows = [
  ...compare('src', {}, 'harness/src/', OURS_ONLY.src),
  ...compare('tests', TEST_ORIGIN, 'harness/test/unit/', OURS_ONLY.tests),
]

let total = 0
for (const row of rows) {
  total += row.logic.length
  console.log(
    `${row.file}\t← ${row.origin}\timport±${row.importChanges}\thead+${row.headerLines}\tlogic±${row.logic.length}`,
  )
  for (const line of row.logic) console.log(`      LOGIC> ${line}`)
}
console.log(`--- 文件数 ${rows.length}，逻辑行 diff 总数 ${total}（基线 ${BASE.slice(0, 8)}）`)
process.exit(total === 0 ? 0 : 1)
