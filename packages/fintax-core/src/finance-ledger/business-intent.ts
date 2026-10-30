// 来源：moneycome harness/src/finance-ledger/business-intent.ts @ 422cbfe30
// 原样搬入，逻辑行未改；允许的改动只有 import 路径与扩展名，逐条见 A6-SNAPSHOT.md。
/**
 * 经营意图闭集：老板在上岗谈话里答的那句「今年打不打算贷款 / 投标 / 引投资」。
 *
 * 放在 finance-ledger 而不是读侧，是因为它现在有两个消费方，一个在读侧、一个在包里：
 * `FinTenantProfile.businessIntents` 存老板答的那份事实，会计包的 `scheme_fit` 目录按同
 * 一批码声明「哪种打算该配哪一档记法」。放在读侧会让包契约反过来 import 读侧。
 *
 * `none`（都没有，正常经营）与其余三项互斥——两个都选下去，存进来的就不是一个事实。
 * 界面上的中文写在 console-fe，harness 只认这四个码。
 */

export const BUSINESS_INTENTS = [
  'loan',
  'bidding',
  'fundraising',
  'none',
] as const;

export type BusinessIntent = (typeof BUSINESS_INTENTS)[number];

export function isBusinessIntent(value: string): value is BusinessIntent {
  return (BUSINESS_INTENTS as readonly string[]).includes(value);
}
