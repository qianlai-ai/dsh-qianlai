import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/lib/**', '**/dist/**', '**/node_modules/**', '.claude/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // React 的 hooks 规则，只铺在各包的浏览器半边 client/——那是发行出去的组件代码。测试目录不进：
  // 测试里的页面桩把组件写成对象字面量的 `render()` 方法，规则的命名启发式判不出它是组件，会误报。
  // 用 `flat['recommended-latest']`：v7 的 `configs.recommended` 仍是 eslintrc 形状（plugins 是字符串数组），
  // 扁平配置直接展开会被 ESLint 9 拒掉。
  { ...reactHooks.configs.flat['recommended-latest'], files: ['**/client/**/*.tsx', '**/client/**/*.ts'] },
  { files: ['**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['**/client/**/*.tsx', '**/client/**/*.ts'], languageOptions: { globals: globals.browser } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
  // fintax-core 是从 moneycome 原样搬来的文件，A6 要求逻辑行与来源一致；type-only import
  // 的写法随 moneycome 走，不在这里改。
  { files: ['packages/fintax-core/**'], rules: { '@typescript-eslint/consistent-type-imports': 'off' } },
)
