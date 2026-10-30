import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseAccountingPackPayload, type AccountingPackPayload } from '@moneycome/fintax-core'

/**
 * 随插件发行的会计包：全国通用的小企业会计准则、小规模纳税人核心包。
 *
 * 来源：钱来 AI-SHOP `domain-packs/accounting-cn-small-enterprise-small-scale/candidate.artifact.json`
 * @ e7b09d77，原样复制。这是工程候选版，签名位是占位值，未经执业会计复核。
 */
const PACK_FILE = new URL('../assets/packs/accounting-cn-small-enterprise-small-scale.json', import.meta.url)

export interface LoadedPack {
  /** `packId@version#digest`，写进每张凭证。 */
  readonly packRef: string
  readonly displayName: string
  readonly payload: AccountingPackPayload
}

interface PackArtifact {
  readonly identity: { packId: string; version: string; digest: string; displayName: string }
  readonly payload: unknown
}

let cached: LoadedPack | undefined

export function loadPack(): LoadedPack {
  if (cached) return cached
  const artifact = JSON.parse(readFileSync(fileURLToPath(PACK_FILE), 'utf8')) as PackArtifact
  const { packId, version, digest, displayName } = artifact.identity
  cached = {
    packRef: `${packId}@${version}#${digest}`,
    displayName,
    payload: parseAccountingPackPayload(artifact.payload),
  }
  return cached
}

