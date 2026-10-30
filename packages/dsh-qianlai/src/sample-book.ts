import { postParsedEvent } from '@moneycome/fintax-core'

import type { LoadedPack } from './pack.js'
import type { BookStore } from './store.js'

/**
 * 样本账：一家虚构的小规模纳税人企业 2026 年 1–3 月的账。
 *
 * 企业名、金额、日期全部是编的，不对应任何真实企业。每一笔都经会计包的记账规则推出分录，
 * 和老板自己记的账走同一条路，所以样本账也是会计包能用的证据。
 */
export const SAMPLE_COMPANY = {
  name: '示例小店科技有限公司（样本账）',
  accountingStartMonth: '2026-01',
} as const

interface SampleEvent {
  readonly date: string
  readonly summary: string
  readonly facts: Readonly<Record<string, string>>
  readonly amounts: Readonly<Record<string, string>>
}

const bank = { 'settlement.method': 'bank' }

const SAMPLE_EVENTS: readonly SampleEvent[] = [
  {
    date: '2026-01-05',
    summary: '股东投入注册资本',
    facts: { 'event.kind': 'capital_contribution', ...bank, 'capital.nature': 'registeredCapital' },
    amounts: { contract: '300000.00' },
  },
  {
    date: '2026-01-12',
    summary: '购买办公用品',
    facts: { 'event.kind': 'office_supply', ...bank },
    amounts: { invoice_total: '1280.00' },
  },
  {
    date: '2026-01-20',
    summary: '技术服务收入（开票 1%）',
    facts: { 'event.kind': 'sale_service', ...bank },
    amounts: { invoice_total: '50500.00', invoice_net: '50000.00', invoice_tax: '500.00' },
  },
  {
    date: '2026-01-25',
    summary: '1 月水电费',
    facts: { 'event.kind': 'utility', ...bank },
    amounts: { invoice_total: '860.50' },
  },
  {
    date: '2026-01-31',
    summary: '银行账户管理费',
    facts: { 'event.kind': 'bank_fee', ...bank },
    amounts: { settlement: '25.00' },
  },
  {
    date: '2026-02-03',
    summary: '提取备用金',
    facts: { 'event.kind': 'cash_withdrawal', ...bank },
    amounts: { settlement: '5000.00' },
  },
  {
    date: '2026-02-10',
    summary: '客户拜访差旅费',
    facts: { 'event.kind': 'travel', ...bank },
    amounts: { invoice_total: '3200.00' },
  },
  {
    date: '2026-02-18',
    summary: '技术服务收入（开票 1%）',
    facts: { 'event.kind': 'sale_service', ...bank },
    amounts: { invoice_total: '80800.00', invoice_net: '80000.00', invoice_tax: '800.00' },
  },
  {
    date: '2026-02-28',
    summary: '银行账户管理费',
    facts: { 'event.kind': 'bank_fee', ...bank },
    amounts: { settlement: '30.00' },
  },
  {
    date: '2026-03-06',
    summary: '现金购买打印纸',
    facts: { 'event.kind': 'office_supply', 'settlement.method': 'cash' },
    amounts: { invoice_total: '300.00' },
  },
  {
    date: '2026-03-15',
    summary: '技术服务收入，客户月底前付款（开票 1%）',
    facts: { 'event.kind': 'sale_service', 'settlement.method': 'unsettled' },
    amounts: { invoice_total: '60600.00', invoice_net: '60000.00', invoice_tax: '600.00' },
  },
  {
    date: '2026-03-25',
    summary: '3 月水电费',
    facts: { 'event.kind': 'utility', ...bank },
    amounts: { invoice_total: '920.40' },
  },
  {
    date: '2026-03-31',
    summary: '银行账户管理费',
    facts: { 'event.kind': 'bank_fee', ...bank },
    amounts: { settlement: '25.00' },
  },
]

/** 在空账本里建样本企业并记入样本凭证。账本里已有企业时什么都不做。 */
export function seedSampleBook(store: BookStore, pack: LoadedPack, now: Date): boolean {
  // 在事务里再看一次：两个进程同时打开空账本时只种一次。
  return store.transaction(() => {
    if (store.company()) return false
    store.createCompany({ ...SAMPLE_COMPANY, isSample: true })
    SAMPLE_EVENTS.forEach((event, index) => {
      const periodKey = event.date.slice(0, 7)
      const posting = postParsedEvent(pack.payload, pack.packRef, {
        eventId: `sample-${String(index + 1).padStart(3, '0')}`,
        facts: event.facts,
        amounts: event.amounts,
        periodKey,
      })
      const eventKind = event.facts['event.kind']!
      // 样本账是编的，凭据按包的要求视为齐全。
      const requiredRoles = pack.payload.evidenceRequirements.find((e) => e.eventKind === eventKind)?.requiredRoles ?? []
      store.postVoucher({
        periodKey,
        voucherDate: event.date,
        summary: event.summary,
        eventKind,
        facts: event.facts,
        posting,
        requiredRoles,
        evidenceRoles: requiredRoles,
        now,
      })
    })
    return true
  })
}
