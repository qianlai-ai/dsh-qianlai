// 本包自己写的垫片，不是搬来的文件。
// moneycome 里 `invoice-self-checks.ts` 只从 `@prisma/client` 取 `Prisma.Decimal`，而它就是
// decimal.js 的 Decimal。开源包不该为一个十进制类拖进 Prisma，所以搬运时把那一行 import
// 指到这里，逻辑行不变。
import { Decimal } from 'decimal.js'

export const Prisma = { Decimal } as const
