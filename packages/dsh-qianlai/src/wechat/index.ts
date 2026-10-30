import { randomUUID } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type * as QRCodeType from 'qrcode'

import { downloadMedia, getBotQrcode, IlinkConnection, imageMediaType, pollQrStatus, type IlinkMessage } from './ilink.js'

// Windows 受限安装可能生成 Node 未识别的 Global junction；先取得原生真实路径，
// 让 qrcode 的间接依赖从实际包目录解析。正常目录和其他系统沿用同一个库。
const require = createRequire(import.meta.url)
const QRCode = require(realpathSync.native(require.resolve('qrcode'))) as typeof QRCodeType

/**
 * 微信薄通道：把一个扫码绑定的微信 bot 接到张姐会话上。
 *
 * 只做三件事：扫码登录；老板发来的文字、图片、文件原样交给张姐会话；张姐这一轮说完的最后一段话
 * 转成纯文本发回微信。账怎么记、票怎么核全在张姐会话里，和网页里是同一本账、同一套工具。
 *
 * 宿主层插件，默认不开；启动 DSH 前设 `MONEYCOME_WECHAT=1` 才加载。
 */
export const inject = ['sessionController']

export interface Config {
  /** 状态文件目录，默认 `$DSH_HOME/moneycome`。 */
  readonly stateDir?: string
  readonly agentPreset?: string
}

interface State {
  botToken?: string
  cursor?: string
  /** 扫码登录的那个微信就是老板；服务端没给扫码人时，第一个发消息的人是老板。重新扫码登录时保留。 */
  ownerUserId?: string
  contextToken?: string
  sessionId?: string
}

type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }
  | { type: 'file'; receiptId: string }

/** 从微信消息里取出来、还没交给会话的内容。文件要先上传到会话才拿得到 receiptId。 */
type Incoming = Exclude<PromptPart, { type: 'file' }> | { type: 'fileBytes'; name: string; bytes: Buffer }

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
/** DSH 的 RemoteError 按 `code` 区分；会话被删了是 `session/not-found`。 */
const sessionGone = (error: unknown) => (error as { code?: unknown } | null)?.code === 'session/not-found'

interface SessionEventLike {
  readonly type: string
  readonly data?: {
    readonly turn?: number
    readonly source?: { readonly rpcId?: unknown }
    readonly message?: { readonly content?: readonly { readonly type: string; readonly text?: string }[] }
    readonly reason?: { readonly kind?: string }
  }
}

interface Context {
  effect(fn: () => () => void): void
  on(event: 'session/event', listener: (session: { id: string }, event: SessionEventLike) => void): () => void
  get(name: string): unknown
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void }
  sessionController: {
    create(request: { agentPreset: string; cwd: string }): Promise<{ sessionId: string }>
    prompt(
      request: { sessionId: string; requestId: string; mode: 'queue'; content: PromptPart[]; clientTimeZone?: string },
      signal: AbortSignal,
    ): Promise<unknown>
  }
}

interface FileUploads {
  uploadStream(request: { sessionId: string; data: AsyncIterable<Uint8Array>; name?: string }): Promise<{ receiptId: string }>
}

/** 单条微信消息的字数上限取保守值，超了按段落拆成几条发。 */
const MAX_WECHAT_CHARS = 1500

/**
 * Markdown 转微信纯文本：去掉粗体、标题号、行内代码，表格改成一行一条、格子用「｜」隔开。
 * 微信不渲染 Markdown，原样发过去满屏是星号和竖线。
 */
export function toWechatText(markdown: string): string {
  const lines: string[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue
    if (/^\s*\|.*\|\s*$/.test(line)) {
      lines.push(
        line
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
          .join('｜'),
      )
      continue
    }
    lines.push(line.replace(/^#{1,6}\s+/, ''))
  }
  return lines
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 按段落拆成不超过上限的几段。 */
export function splitForWechat(text: string, limit = MAX_WECHAT_CHARS): string[] {
  const chunks: string[] = []
  let current = ''
  for (const paragraph of text.split('\n\n')) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph
    if (next.length <= limit) {
      current = next
      continue
    }
    if (current) chunks.push(current)
    current = paragraph
    while (current.length > limit) {
      chunks.push(current.slice(0, limit))
      current = current.slice(limit)
    }
  }
  if (current) chunks.push(current)
  return chunks
}

export function apply(ctx: Context, config: Config = {}): void {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const stateDir = config.stateDir ?? join(home, 'moneycome')
  const statePath = join(stateDir, 'wechat.json')
  const workspace = join(stateDir, 'wechat-workspace')
  const agentPreset = config.agentPreset ?? 'moneycome-zhangjie'
  // 收发都记一行到 wechat.log（只记事件与条数，不记消息内容），同时交给 DSH 的 logger。
  const logPath = join(stateDir, 'wechat.log')
  const line = (level: string, message: string) => {
    try {
      mkdirSync(stateDir, { recursive: true })
      appendFileSync(logPath, `${new Date().toISOString()} ${level} ${message}\n`)
    } catch {
      // 日志写不进去不影响收发；DSH 的 logger 仍有一份。
    }
  }
  const log = {
    info: (m: string) => (line('info', m), ctx.logger.info(m)),
    warn: (m: string) => (line('warn', m), ctx.logger.warn(m)),
    error: (m: string) => (line('error', m), ctx.logger.error(m)),
  }

  const load = (): State => (existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as State) : {})
  let state = load()
  // 状态里有 bot token，只给本机用户读写。
  const save = () => {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 })
    chmodSync(statePath, 0o600)
  }

  ctx.effect(() => {
    let stopped = false
    let connection: IlinkConnection | undefined
    const abort = new AbortController()
    /** 等回复的 turn：turn 号 → 这一轮里收集到的最后一段话。 */
    const turns = new Map<number, { text: string; typing: NodeJS.Timeout }>()
    const pendingRequests = new Set<string>()
    let lastTurnStart = 0

    const reply = async (text: string) => {
      if (!connection || !state.ownerUserId) return
      for (const chunk of splitForWechat(toWechatText(text))) {
        try {
          await connection.sendText(state.ownerUserId, state.contextToken, chunk)
        } catch (error) {
          log.error(`moneycome-wechat: send failed: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
      }
      log.info(`moneycome-wechat: replied ${text.length} chars`)
    }

    const offEvents = ctx.on('session/event', (session, event) => {
      if (session.id !== state.sessionId) return
      const data = event.data ?? {}
      if (event.type === 'turn/start' && typeof data.turn === 'number') lastTurnStart = data.turn
      if (event.type === 'user/message' && typeof data.source?.rpcId === 'string' && pendingRequests.delete(data.source.rpcId)) {
        if (!turns.has(lastTurnStart)) {
          const typing = setInterval(() => void connection?.sendTyping(state.ownerUserId!, state.contextToken), 15_000)
          turns.set(lastTurnStart, { text: '', typing })
        }
      }
      const pending = typeof data.turn === 'number' ? turns.get(data.turn) : undefined
      if (!pending) return
      if (event.type === 'assistant/message') {
        const text = (data.message?.content ?? [])
          .filter((c) => c.type === 'text' && c.text?.trim())
          .map((c) => c.text!)
          .join('\n')
        if (text) pending.text = text
      }
      if (event.type === 'turn/end') {
        clearInterval(pending.typing)
        turns.delete(data.turn!)
        const completed = data.reason?.kind === 'completed'
        void reply(
          pending.text && completed
            ? pending.text
            : pending.text || '刚才这一步没做完，您再说一次，或者换个说法试试。',
        )
      }
    })

    const ensureSession = async (fresh = false): Promise<string> => {
      if (state.sessionId && !fresh) return state.sessionId
      mkdirSync(workspace, { recursive: true })
      const created = await ctx.sessionController.create({ agentPreset, cwd: workspace })
      state.sessionId = created.sessionId
      save()
      log.info(`moneycome-wechat: session ${created.sessionId}`)
      return created.sessionId
    }

    /**
     * 先把消息里的东西都取下来，再碰会话：图片、文件下载失败是网络问题，和会话无关，
     * 告诉老板重发就行，不能因此换一个新会话。
     */
    const collect = async (message: IlinkMessage) => {
      const items: Incoming[] = []
      const notReceived = new Set<string>()
      let voiceWithoutText = false
      let unsupported = false
      for (const item of message.item_list ?? []) {
        if (item.text_item?.text?.trim()) items.push({ type: 'text', text: item.text_item.text.trim() })
        else if (item.voice_item) {
          const text = item.voice_item.text?.trim()
          if (text) items.push({ type: 'text', text: `（老板发的语音，微信转成的文字）${text}` })
          else voiceWithoutText = true
        } else if (item.image_item?.media) {
          try {
            const bytes = await downloadMedia(item.image_item.media, item.image_item.hd_size)
            const mediaType = imageMediaType(bytes)
            if (mediaType) items.push({ type: 'image', mediaType, data: bytes.toString('base64') })
            else items.push({ type: 'text', text: '（老板发来一张图片，但格式认不出来。）' })
          } catch (error) {
            log.warn(`moneycome-wechat: image download failed: ${errorMessage(error)}`)
            notReceived.add('图片')
          }
        } else if (item.file_item?.media) {
          const name = item.file_item.file_name ?? 'file'
          try {
            items.push({ type: 'fileBytes', name, bytes: await downloadMedia(item.file_item.media, Number(item.file_item.len ?? 0)) })
          } catch (error) {
            log.warn(`moneycome-wechat: file download failed: ${errorMessage(error)}`)
            notReceived.add(`文件「${name}」`)
          }
        } else unsupported = true
      }
      const notes: string[] = []
      if (notReceived.size) notes.push(`刚才的${[...notReceived].join('和')}没收到，可能是网络断了一下，麻烦再发一次。`)
      if (voiceWithoutText) notes.push('这条语音微信没转出文字，麻烦打字说，或者发截图。')
      if (unsupported) notes.push('视频这类消息我看不了，麻烦打字，或者发截图、文件。')
      return { items, notes }
    }

    const toParts = async (items: readonly Incoming[], sessionId: string): Promise<PromptPart[]> => {
      const parts: PromptPart[] = []
      for (const item of items) {
        if (item.type !== 'fileBytes') {
          parts.push(item)
          continue
        }
        const uploads = ctx.get('fileUploads') as FileUploads | undefined
        if (!uploads) {
          parts.push({ type: 'text', text: `（老板发来文件「${item.name}」，但这里收不了文件。）` })
          continue
        }
        const receipt = await uploads.uploadStream({
          sessionId,
          name: item.name,
          data: (async function* () {
            yield new Uint8Array(item.bytes)
          })(),
        })
        parts.push({ type: 'file', receiptId: receipt.receiptId })
      }
      return parts
    }

    const onMessage = async (message: IlinkMessage) => {
      const from = message.from_user_id
      if (!from) return
      if (!state.ownerUserId) {
        state.ownerUserId = from
        log.info('moneycome-wechat: bound owner')
      }
      if (from !== state.ownerUserId) {
        log.warn('moneycome-wechat: ignored a message from someone other than the bound owner')
        return
      }
      if (message.context_token) state.contextToken = message.context_token
      save()
      void connection?.sendTyping(from, state.contextToken)
      const { items, notes } = await collect(message)
      if (notes.length) await reply(notes.join('\n'))
      if (!items.length) return
      const send = async (sessionId: string) => {
        const content = await toParts(items, sessionId)
        const requestId = randomUUID()
        pendingRequests.add(requestId)
        await ctx.sessionController.prompt(
          { sessionId, requestId, mode: 'queue', content, clientTimeZone: 'Asia/Shanghai' },
          abort.signal,
        )
        log.info(`moneycome-wechat: prompt ${content.map((p) => p.type).join('+')}`)
      }
      try {
        try {
          await send(await ensureSession())
        } catch (error) {
          // 只有存着的会话被删了才开新会话；别的错误换会话也没用，还会把之前的对话丢掉。
          if (!sessionGone(error)) throw error
          log.warn(`moneycome-wechat: session gone, starting a new one: ${errorMessage(error)}`)
          await send(await ensureSession(true))
        }
      } catch (error) {
        log.error(`moneycome-wechat: prompt failed: ${errorMessage(error)}`)
        await reply('我这边出了点问题，这条没收到，您稍后再发一次。')
      }
    }

    const connect = (botToken: string) => {
      connection = new IlinkConnection(botToken, onMessage, {
        ...(state.cursor ? { initialCursor: state.cursor } : {}),
        onCursor(cursor) {
          state.cursor = cursor
          save()
        },
        onExpired() {
          log.warn('moneycome-wechat: login expired, scan again')
          // 登录凭据作废，老板和会话留着：重新扫码后还是同一个老板、接着同一段对话。
          state = {
            ...(state.ownerUserId ? { ownerUserId: state.ownerUserId } : {}),
            ...(state.sessionId ? { sessionId: state.sessionId } : {}),
          }
          save()
          void login().catch((error) => log.error(`moneycome-wechat: login failed: ${errorMessage(error)}`))
        },
        onError(message, consecutive) {
          log.warn(`moneycome-wechat: ${message} (consecutive ${consecutive})`)
        },
      })
      connection.start()
      log.info('moneycome-wechat: connected')
    }

    const login = async () => {
      for (let attempt = 0; attempt < 10 && !stopped; attempt++) {
        const { qrcode, imgUrl } = await getBotQrcode()
        const png = join(stateDir, 'wechat-login.png')
        mkdirSync(stateDir, { recursive: true })
        await QRCode.toFile(png, imgUrl, { width: 360, margin: 1 })
        const terminal = await QRCode.toString(imgUrl, { type: 'terminal', small: true })
        process.stdout.write(`\n用微信扫下面的二维码，把张姐接到微信上（二维码图片也存在 ${png}）：\n${terminal}\n`)
        while (!stopped) {
          const status = await pollQrStatus(qrcode)
          if (status.status === 'confirmed') {
            state.botToken = status.botToken
            delete state.cursor
            if (status.userId) {
              if (state.ownerUserId && state.ownerUserId !== status.userId) {
                log.warn('moneycome-wechat: a different WeChat scanned; it is now the owner')
                delete state.contextToken
              }
              state.ownerUserId = status.userId
            }
            save()
            process.stdout.write('微信已接上。用这个微信给张姐发一句话，她就能回你。\n')
            connect(status.botToken)
            return
          }
          if (status.status === 'expired') break
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
      if (!stopped) log.warn('moneycome-wechat: no scan after 10 QR codes; restart DSH to try again')
    }

    if (state.botToken) connect(state.botToken)
    else
      void login().catch((error) => log.error(`moneycome-wechat: login failed: ${error instanceof Error ? error.message : String(error)}`))

    return () => {
      stopped = true
      abort.abort()
      connection?.stop()
      offEvents()
      for (const pending of turns.values()) clearInterval(pending.typing)
    }
  })
}
