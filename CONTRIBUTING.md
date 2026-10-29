# 贡献指南 / Contributing

当前是建仓阶段，尚无插件源码或构建环境。欢迎文档修改、双语校对、
使用场景建议及虚构财务案例；不要把项目定位当作已实现功能。

## 提交流程

1. 先查已有 Issue；较大改动先讨论，小的文字修正可直接 PR。
2. Fork 本仓库，从 `main` 创建任务分支，提交针对单一问题的改动。
3. 检查链接、Markdown 和涉及的 YAML；开 PR 说明目的、变化及实际验证结果。
4. 维护者审阅后合入，或说明需补充、延期和不接受的原因。

故障使用[九字段格式](docs/issue-reporting.md)。无需先跑测试套件，
未知版本可写“不知道”，附件可以没有。建议与求助可使用对应表单。

## 当前验证范围

本仓库只有文档、许可文件和 `.github/` 协作配置，没有 `package.json`、
插件包或 CI 工作流。文档 PR 核对双语一致、相对链接和页面显示；
表单 PR 核对 YAML、字段顺序、真实标签，并在合入后检查 New issue 页面。
不要宣传或运行尚不存在的安装、构建和测试命令。

## 后续源码贡献

接入源码后补充实际工具版本、目录和验证命令。若接入内部上游复制的
`fintax-core`，外部贡献者可提供问题、虚构案例和期望结果；复制文件的修改先联系维护者，
由维护者处理内部修复、同步和 A6 对比，并在公开 Issue / PR 保留进度与贡献归属。
外部贡献者不需要内部仓库权限。这不表示核心代码现在已在本仓库中。

运行验证使用独立 `DSH_HOME` 和合成数据。真实 API 模型测试有费用，不因文档检查自动启动。
不得提交密钥、真实票据、流水、账本、微信登录文件、带 token 的 URL 或私人聊天记录。

## 审阅与许可

初期维护者为 [@peyton-v5](https://github.com/peyton-v5)。通过任务分支和 PR 合并，
相关本地检查与完整差异审阅是当前合并依据；不承诺回复时限，不把未运行的 CI 声称为成功。
贡献沿用 Apache-2.0，不要求版权转让或额外 CLA。
遵守[行为规范](CODE_OF_CONDUCT.md)，安全问题走[私密报告](SECURITY.md)。

## English

Only community materials are currently present. Documentation, translations and
synthetic use cases are welcome. Fork, branch from main, make a focused change
and open a PR with actual validation results. Discuss large changes first.
Use the [nine-field guide](docs/issue-reporting.md) for bugs.

There are no source packages, build commands or CI workflows here yet. Validate
links, language consistency, YAML and issue-form behavior as appropriate.
When copied financial-core source is introduced, maintainers will handle internal
upstream fixes, synchronization and A6 comparison. External contributors can
provide synthetic cases without internal access; progress and attribution remain public.
Runtime checks require an isolated DSH_HOME. Paid model tests are separate work.
Never submit credentials or private financial records.

The initial maintainer is @peyton-v5. Changes use PRs, complete diff review and
relevant local validation. No response deadline or unrun CI success is claimed.
Contributions use Apache-2.0, without copyright assignment or an additional CLA.
