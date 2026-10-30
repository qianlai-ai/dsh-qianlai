// 把 client/client.src.js 里的头像占位换成内联图片，写到 lib/client.js。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const source = readFileSync(new URL('client/client.src.js', root), 'utf8')
const avatar = readFileSync(new URL('assets/zhangjie/avatar.png', root)).toString('base64')
mkdirSync(new URL('lib/', root), { recursive: true })
writeFileSync(new URL('lib/client.js', root), source.replace('__AVATAR_DATA_URL__', `data:image/png;base64,${avatar}`))
