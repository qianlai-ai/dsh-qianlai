/* global window */
/**
 * 张姐会话的界面插件（浏览器端）。
 *
 * 当前会话的模式是「钱来张姐」时：
 * - 会话头部加一个张姐头像。DSH 自己已经在标题旁写着模式名，这里不再配文字；
 * - 通过 DSH 主题服务的 `overrideTokens` 叠一层钱来配色：DeepSeek 蓝色色阶换成钱来绿，侧栏换浅绿灰底。
 *   新会话页（模式下拉选中「钱来张姐」后）只换配色，不加任何元素：下拉里已经写着「钱来张姐」。
 *   离开张姐会话、切回别的模式，这层配色撤掉，DSH 恢复原样；用户的明暗偏好不动。
 * 其他模式的会话什么都不渲染。
 *
 * 这个文件按 DSH 浏览器模块的格式手写（`window.__ModuleLoader__.load`），不经打包工具。
 * 构建时 `scripts/build-client.mjs` 把头像图片内联进来，产物是 `lib/client.js`。
 * 头像 © 钱来，保留所有权利，仅随本插件展示使用，见 `assets/zhangjie/NOTICE.md`。
 */
window.__ModuleLoader__.load({
  id: 'dsh-qianlai',
  factory: (require) => {
    const module = { exports: {} }
    const { useEffect } = require('react')
    const { jsx } = require('react/jsx-runtime')

    const PRESET = 'moneycome-zhangjie'
    const AVATAR = '__AVATAR_DATA_URL__'

    // 钱来配色层。DSH 的主色、气泡、选中态、焦点环都引用 deepseek 色阶，整组换成绿色即可跟着变；
    // 色阶本身不分明暗（明暗两套各取不同档），所以 light/dark 同值。
    const SCALE = {
      50: '#edf8f1',
      100: '#dcf2e4',
      200: '#c4eacf',
      300: '#9fdcb4',
      400: '#5fcf8e',
      450: '#2fb46e',
      500: '#1f8a5b',
      600: '#1b6f4a',
      800: '#24433a',
      900: '#1d332b',
    }
    const TOKENS = {
      ...Object.fromEntries(Object.entries(SCALE).map(([step, value]) => [`--dsw-static-deepseek-${step}`, { light: value, dark: value }])),
      '--dsw-specific-sidebar-fill': { light: '#f4f8f5', dark: 'var(--dsw-static-neutral-bluish-900)' },
      '--dsw-alias-label-primary-bluish': { light: '#1b5e40', dark: 'var(--dsw-static-neutral-bluish-50)' },
    }

    // 新会话页和会话头部可能同时挂着张姐组件，按引用计数叠一次、最后一个离开时撤掉。
    let theme
    let holders = 0
    let release
    const applyLayer = () => {
      if (theme && holders > 0 && !release) release = theme.overrideTokens('dsh-qianlai', TOKENS)
    }
    const dropLayer = () => {
      release?.()
      release = undefined
    }
    function useQianlaiTheme(active) {
      useEffect(() => {
        if (!active) return undefined
        holders += 1
        applyLayer()
        return () => {
          holders -= 1
          if (holders === 0) dropLayer()
        }
      }, [active])
    }

    function usePreset(sessionId, useSessions) {
      return useSessions((state) => {
        const value = state.byId[sessionId]?.projectionValues?.agentPreset
        return typeof value === 'string' ? value : undefined
      })
    }

    function Avatar() {
      return jsx('img', {
        src: AVATAR,
        alt: '张姐',
        title: '钱来张姐：小企业财务助手',
        width: 24,
        height: 24,
        style: { borderRadius: '50%', objectFit: 'cover', display: 'block' },
      })
    }

    function ZhangjieAvatar({ sessionId, useSessions }) {
      const active = usePreset(sessionId, useSessions) === PRESET
      useQianlaiTheme(active)
      return active ? jsx(Avatar, {}) : null
    }

    /** 新会话页：只跟着模式换配色，不渲染东西。 */
    function ZhangjieTheme({ sessionId, useSessions }) {
      useQianlaiTheme(usePreset(sessionId, useSessions) === PRESET)
      return null
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.inject(['theme'], (scope) => {
        theme = scope.theme
        applyLayer()
        scope.effect(() => () => {
          dropLayer()
          theme = undefined
        }, 'dsh-qianlai: theme layer')
      })
      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          { name: 'conversation.session.header.actions', id: 'moneycome-zhangjie', order: -20 },
          ZhangjieAvatar,
        ),
      )
      ctx.slots.inject('conversation.hero.options', () =>
        ctx.slots.register(
          { name: 'conversation.hero.options', id: 'moneycome-zhangjie', order: -20 },
          ZhangjieTheme,
        ),
      )
    }

    module.exports.apply = apply
    module.exports.inject = inject
    return module.exports
  },
})
