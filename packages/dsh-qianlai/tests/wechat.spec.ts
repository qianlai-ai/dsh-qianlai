import { describe, expect, it } from 'vitest'

import { imageMediaType } from '../src/wechat/ilink.js'
import { splitForWechat, toWechatText } from '../src/wechat/index.js'

describe('微信纯文本', () => {
  it('去掉粗体、标题号，表格一行一条', () => {
    const markdown = [
      '## 1月利润',
      '**利润：18,690.00 元**',
      '',
      '| 日期 | 金额 |',
      '|---|---|',
      '| 01-05 | 100,000.00 |',
      '用 `moneycome` 记的',
    ].join('\n')
    expect(toWechatText(markdown)).toBe('1月利润\n利润：18,690.00 元\n\n日期｜金额\n01-05｜100,000.00\n用 moneycome 记的')
  })

  it('超长按段落拆，每段不超上限', () => {
    const text = ['甲'.repeat(10), '乙'.repeat(10), '丙'.repeat(25)].join('\n\n')
    const chunks = splitForWechat(text, 22)
    expect(chunks[0]).toBe(`${'甲'.repeat(10)}\n\n${'乙'.repeat(10)}`)
    expect(chunks.every((c) => c.length <= 22)).toBe(true)
    expect(chunks.join('')).toContain('丙'.repeat(22))
  })

  it('按文件头认图片格式', () => {
    expect(imageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(imageMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png')
    expect(imageMediaType(Buffer.from('%PDF-1.7'))).toBeUndefined()
  })
})
