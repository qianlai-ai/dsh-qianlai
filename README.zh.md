# 钱来张姐 · dsh-qianlai

[English](README.md)

面向小企业的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 财务助手插件。

**当前状态：源码接入候选，尚未发布 npm 包或 Release。** 本次从既有维护版本 `dad68cf856fae0bb2bb2ea954f6e9400a0e69098` 导入最新代码、已合入修复和筛查后的测试材料；接入前后差异与验证边界见 [迁移记录](docs/history/migration.md)。

## 功能与范围

- 单机、单企业 SQLite 账本，首次启动提供合成样本账。
- 发票自洽校验、银行流水导入、期初余额、凭证试算与确认记账。
- 余额、利润、简表、结账检查与结账、作废和冲销、会计复核 CSV 导出。
- 可选微信 iLink 通道，与桌面/网页使用同一本账；会话上下文独立，完整跨端接续尚待实现。
- Excel/PDF 流水解析、桌面二维码入口、微信首次欢迎等需求仍未完成，见 [问题迁移清单](docs/history/migration.md)。

功能细节与限制见 [插件说明](packages/dsh-qianlai/README.zh.md)。AI 回复须经工具与账本事实核实，不能替代会计，不提供税务申报或付款执行。发送模型的对话和上传材料会经过相应模型/微信服务；账本本体存放在本机。

## 从源码构建与验证

需要 Node.js 22.19 以上的 22.x 或 24 以上，以及项目声明的 pnpm 12.3.4。不是所有 22.19 之后的非 LTS 主版本都在支持范围内。

```sh
git clone https://github.com/qianlai-ai/dsh-qianlai.git
cd dsh-qianlai
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
node packages/dsh-qianlai/e2e/q008/run.mjs --validate
```

在已有 DSH 中安装时，指定**构建后的子目录** `packages/dsh-qianlai` 的绝对路径，不是仓库根目录。桌面插件页可填写该路径；CLI 示例：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-qianlai/packages/dsh-qianlai
```

Windows 示例路径：`D:\work\dsh-qianlai\packages\dsh-qianlai`。使用独立 `DSH_HOME`，避免测试影响日常数据与登录配置。当前源码使用 workspace 财税核心依赖，分发包的依赖发布与安装仍须单独验收；本次不提供未经核实的 npm 安装命令。

## 微信与真模型测试

微信可选：在启动 DSH 的进程环境中设置 `MONEYCOME_WECHAT=1`；首次登录码由终端输出，并写入独立 DSH_HOME 的 `moneycome/wechat-login.png`。不要提交登录文件。当前仍需用户先发消息，没有扫码自动欢迎。

[Q-008 复现材料](packages/dsh-qianlai/e2e/q008/README.md)包含固定场景、异常回复与三版人设。离线校验无需 Key；真模型测试另行显式启动，使用测试者自己的 `DEEPSEEK_API_KEY` 环境变量，会产生费用。无须提供内部仓库或原作者的凭据。

## 协作、许可和状态

- [问题反馈](https://github.com/qianlai-ai/dsh-qianlai/issues/new/choose)、[讨论](https://github.com/qianlai-ai/dsh-qianlai/discussions)、[贡献指南](CONTRIBUTING.md)、[九字段规范](docs/issue-reporting.md)。
- [原五个 PR 的修复和验证记录](docs/history/legacy-prs.md)、[来源与隐私审查](docs/history/import-review.json)。历史验证与本次验证分别标注，不能将历史 CI 当作本库 CI。
- 按当前维护规则，本次不启用远端 CI。原配置以非工作流文件归档，构建和运行检查在本地执行。
- 项目由 qianlai-ai 社区维护，初期维护者见 [MAINTAINERS.md](MAINTAINERS.md)；不代表 DeepSeek 官方。
- 代码按 [Apache-2.0](LICENSE) 提供；张姐图片只限随插件展示，见 [NOTICE](NOTICE) 和 [素材声明](packages/dsh-qianlai/assets/zhangjie/NOTICE.md)。
- 仅提交合成数据和最小脱敏证据，安全问题按 [SECURITY.md](SECURITY.md) 私密报告。
