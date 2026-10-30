import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readBalances } from '../src/balances.js'
import { apply } from '../src/index.js'
import { loadPack } from '../src/pack.js'
import { SAMPLE_COMPANY, seedSampleBook } from '../src/sample-book.js'
import { BookStore } from '../src/store.js'

const NOW = new Date('2026-04-01T00:00:00Z')

function sampleStore(): BookStore {
  const store = new BookStore(':memory:')
  seedSampleBook(store, loadPack(), NOW)
  return store
}

const balanceOf = (result: ReturnType<typeof readBalances>, code: string) =>
  result.accepted ? result.rows.find((r) => r.subjectCode === code) : undefined

describe('样本账', () => {
  it('经会计包记账，凭证按期间连续编号', () => {
    const store = sampleStore()
    expect(store.company()).toEqual({ ...SAMPLE_COMPANY, isSample: true })
    expect(store.postedPeriods()).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('已有企业时不重复建', () => {
    const store = sampleStore()
    expect(seedSampleBook(store, loadPack(), NOW)).toBe(false)
    expect(store.postedPeriods()).toHaveLength(3)
  })

  it('每张凭证借贷平衡，累计净额合计为零', () => {
    const store = sampleStore()
    const total = store.movements('2026-03').reduce((sum, m) => sum + m.netDebitCents, 0n)
    expect(total).toBe(0n)
  })
})

describe('查余额', () => {
  it('3 月末银行存款、库存现金、应收账款、应交增值税', () => {
    const result = readBalances(sampleStore(), '2026-03')
    // 银行：300000 - 1280 + 50500 - 860.50 - 25 - 5000 - 3200 + 80800 - 30 - 920.40 - 25
    expect(balanceOf(result, '1002')).toMatchObject({ side: '借', balance: '419959.10' })
    expect(balanceOf(result, '1001')).toMatchObject({ side: '借', balance: '4700.00' })
    expect(balanceOf(result, '1122')).toMatchObject({ side: '借', balance: '60600.00' })
    expect(balanceOf(result, '222101')).toMatchObject({ side: '贷', balance: '1900.00' })
    expect(balanceOf(result, '4001')).toMatchObject({ side: '贷', balance: '300000.00' })
  })

  it('1 月末只累计到 1 月', () => {
    const result = readBalances(sampleStore(), '2026-01')
    expect(balanceOf(result, '1002')).toMatchObject({ balance: '348334.50' })
    expect(balanceOf(result, '1001')).toBeUndefined()
  })

  it.each([
    ['2025-12', 'PERIOD_BEFORE_BOOK'],
    ['2026-04', 'PERIOD_NOT_POSTED'],
    ['2026-3', 'PERIOD_INVALID'],
    ['2026-13', 'PERIOD_INVALID'],
  ])('%s 照实拒绝（%s）', (periodKey, code) => {
    expect(readBalances(sampleStore(), periodKey)).toMatchObject({ accepted: false, code })
  })

  it('没有账本时拒绝', () => {
    expect(readBalances(new BookStore(':memory:'), '2026-03')).toMatchObject({ accepted: false, code: 'NO_BOOK' })
  })
})

describe('插件入口', () => {
  it('注册查余额工具，账本落在给定路径，卸载时关闭', async () => {
    const registered: { name: string; execute(args: Record<string, unknown>): Promise<unknown> }[] = []
    let disposer: (() => void) | undefined
    let unregistered = 0
    const ctx = {
      effect(fn: () => () => void) {
        disposer = fn()
      },
      tools: {
        register(tool: (typeof registered)[number]) {
          registered.push(tool)
          return () => {
            unregistered++
          }
        },
      },
    }
    const bookPath = join(mkdtempSync(join(tmpdir(), 'dsh-qianlai-')), 'book.sqlite')
    apply(ctx as never, { bookPath })
    expect(registered.map((t) => t.name)).toContain('moneycome_read_balances')
    expect(registered.every((t) => t.name.startsWith('moneycome_'))).toBe(true)
    const balances = registered.find((t) => t.name === 'moneycome_read_balances')!
    await expect(balances.execute({ periodKey: '2026-02' })).resolves.toMatchObject({
      accepted: true,
      isSampleBook: true,
      bookedThrough: '2026-03',
    })
    disposer!()
    expect(unregistered).toBe(registered.length)
    const reopened = new BookStore(bookPath)
    expect(reopened.postedPeriods()).toHaveLength(3)
    reopened.close()
  })
})

describe('界面那一行', () => {
  it('mode: ui 不注册工具、不开账本', () => {
    let effects = 0
    apply({ effect: () => effects++, tools: { register: () => () => undefined } } as never, { mode: 'ui' })
    expect(effects).toBe(0)
  })
})
