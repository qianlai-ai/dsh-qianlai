import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { apply } from '../src/index.js'

// 企业是编的。这里测的是工具入口：参数校验、出错兜底、和别的进程抢同一本账。

interface Tool {
  execute(args: unknown): Promise<unknown>
}

function plugin() {
  const bookPath = join(mkdtempSync(join(tmpdir(), 'qianlai-tools-')), 'book.sqlite')
  const tools = new Map<string, Tool>()
  apply({ effect: (fn) => void fn(), tools: { register: (t) => (tools.set(t.name, t), () => {}) } }, { bookPath })
  const call = (name: string, args: unknown) => tools.get(name)!.execute(args) as Promise<Record<string, unknown>>
  return { bookPath, call }
}

async function ownBook() {
  const p = plugin()
  await p.call('moneycome_open_book', { companyName: '杭州青禾数据服务有限公司', accountingStartMonth: '2026-01', replaceSampleBook: true })
  await p.call('moneycome_set_opening_balances', { balances: [] })
  return p
}

const ENTRY = {
  date: '2026-01-05',
  summary: '股东实缴注册资本',
  eventKind: 'capital_contribution',
  facts: { 'settlement.method': 'bank', 'capital.nature': 'registeredCapital' },
  amounts: { contract: '1000.00' },
}

describe('工具入口', () => {
  it('参数类型不对时拒绝并指出位置，不抛异常', async () => {
    const { call } = await ownBook()
    expect(await call('moneycome_set_opening_balances', { balances: '' })).toMatchObject({ accepted: false, code: 'ARGUMENT_INVALID' })
    const nested = await call('moneycome_set_opening_balances', { balances: [null] })
    expect(nested).toMatchObject({ accepted: false, code: 'ARGUMENT_INVALID' })
    expect(nested.message).toContain('balances[0]')
    expect(await call('moneycome_check_invoice', { invoiceNumber: true })).toMatchObject({ accepted: false, code: 'ARGUMENT_INVALID' })
    expect(await call('moneycome_record_entry', { ...ENTRY, facts: undefined })).toMatchObject({ accepted: false, code: 'ARGUMENT_INVALID' })
  })

  it('可选参数给 null 当没给，字符串参数给数字转成字符串', async () => {
    const { call } = await ownBook()
    const preview = await call('moneycome_record_entry', { ...ENTRY, amounts: { contract: 1000 }, invoiceNumber: null, preview: true })
    expect(preview).toMatchObject({ accepted: true })
  })

  it('执行中出错时整笔回滚，返回 TOOL_FAILED', async () => {
    const { bookPath, call } = await ownBook()
    const other = new DatabaseSync(bookPath)
    // 写完凭证头、写分录时出错。
    other.exec('DROP TABLE voucher_leg')
    const result = await call('moneycome_record_entry', ENTRY)
    expect(result).toMatchObject({ accepted: false, code: 'TOOL_FAILED' })
    expect(other.prepare('SELECT count(*) AS n FROM voucher').get()).toEqual({ n: 0 })
    other.close()
  })

  it('另一个进程正占着写锁时等它写完，不报 database is locked', async () => {
    const { bookPath, call } = await ownBook()
    const holder = spawn(process.execPath, [
      '-e',
      `const { DatabaseSync } = require('node:sqlite')
       const db = new DatabaseSync(${JSON.stringify(bookPath)})
       db.exec('BEGIN IMMEDIATE')
       console.log('locked')
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
       db.exec('COMMIT')`,
    ])
    await once(holder.stdout, 'data')
    expect(await call('moneycome_record_entry', ENTRY)).toMatchObject({ accepted: true })
    await once(holder, 'exit')
  })
})
