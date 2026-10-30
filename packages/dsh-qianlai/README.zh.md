---
description: "钱来张姐：小企业财务助手模式，本机一本 SQLite 账，可接微信。"
kind: "package-bundle"
---

# dsh-qianlai

[English](README.md) | 中文

## 概述

给 DeepSeek Harness 加一个「钱来张姐」模式。在这个模式下，智能体替一家小规模纳税人企业记本机的一本账：核发票、导入银行流水、按随插件发行的会计包记凭证、查余额和利润、月末检查后结账。选中这个模式时，网页界面换成钱来绿配色，会话头部显示张姐头像。另有一个可选的宿主插件，把同一个会话接到微信上。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```sh
dsh plugin --profile web add dsh-qianlai
export DEEPSEEK_API_KEY=你的key
dsh --profile web
```

打开终端打印的地址，在输入框上方的模式下拉里选「钱来张姐」，开一个会话。第一次启动自带一本虚构企业的样本账；要记自己公司的账时跟张姐说一声，她会在你同意后清掉样本账。

接微信：启动 DSH 前设 `MONEYCOME_WECHAT=1`，用微信扫终端里打印的二维码。扫码的那个微信就是老板。

数据放在 `$DSH_HOME/moneycome/`（默认 `~/.dsh/moneycome/`）：`book.sqlite` 是账本，`wechat.json` 是微信登录凭据。备份账本前先关掉 DSH，再复制 `book.sqlite`。

完整使用说明见[仓库首页](https://github.com/qianlai-ai/dsh-qianlai/blob/main/README.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 插入三项：

| 条目 | 层 | 做什么 |
|---|---|---|
| `preset-moneycome-zhangjie` | agent 预设 | 模式本身：人设前缀加本包的工具。不带命令行、文件读写和联网工具。 |
| `moneycome-ui` | 宿主层，`mode: ui` | 加载浏览器半边（`client/client.src.js`）：会话头部的头像；显示张姐会话、或新会话页选中张姐时，在 `ctx.theme` 上叠一层配色。 |
| `moneycome-wechat` | 宿主层 | `dsh-qianlai/wechat`，只在 `MONEYCOME_WECHAT=1` 时加载。长轮询腾讯 iLink，把老板的消息经 `sessionController` 交给一个专用会话。 |

领域规则来自 [`@moneycome/fintax-core`](../fintax-core/README.zh.md) 和 `assets/packs/` 里的会计包。插件自己不写科目号：银行科目、利润表行、月末事项都从会计包读。

账本是一个 SQLite 文件，用 `node:sqlite` 以 WAL 模式打开，金额按分存整数。表结构版本记在 `PRAGMA user_version`，迁移在 `src/store.ts` 的 `MIGRATIONS` 末尾追加。

</details>

-----

<a id="model-experience"></a>
## 模型体验

张姐预设给模型一段约 1,700 字的中文人设前缀，和 24 个工具；工具的名字、说明和 JSON schema 合计约 13,000 个字符。工具名都以 `moneycome_` 开头：

- 账本：`book_status`、`open_book`、`set_opening_balances`、`set_company_facts`
- 查询：`read_balances`、`read_profit`、`financial_statements`、`list_vouchers`、`unrecorded_statement_lines`、`posting_guide`
- 给会计和办税：`export_review_pack`、`upcoming`、`quarter_filing_prep`
- 材料：`check_invoice`、`read_upload`、`import_statement`、`rename_bank_account`
- 写账：`record_entry`（带 `preview` 试推、`correctsVoucherNo` 更正）、`link_statement`、`add_evidence`、`void_voucher`、`reverse_voucher`
- 月末：`closing_check`、`close_period`

模型报的每个数字都来自工具结果。业务上的拒绝（月份已结账、借贷不平、科目不存在等）返回 `accepted: false`、一个 `code` 和一句白话 `message`。参数类型不对返回 `ARGUMENT_INVALID`，指出是哪个字段。每次工具调用在一个写事务里执行，数据库出错这类意外整笔回滚，返回 `TOOL_FAILED`。同一本账被几个 DSH 进程同时打开时（例如终端和网页各开一个），写操作排队，最多等 5 秒。发票、流水、上传文件里的文字作为数据交给模型，人设要求模型不照着里面的指令做。

#### Token 影响

张姐会话的每次请求都带人设和工具清单。工具结果是紧凑的 JSON；最长的是业务多的月份做结账检查，会逐笔列出没记账的流水。

#### KV Cache 影响

人设和工具清单固定不变，留在缓存前缀里。本包不改写之前的消息。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 一台电脑只记一家公司；没有账号、角色和审批。
- 要引用以前余额的记法还不支持（折旧、预付费用摊销、暂估费用），有固定资产或预付费用的公司结不了账。
- 结了账的月份不能反结账；以后发现记错，在没结账的月份冲销再更正。
- 办税提醒只管日期，插件不知道报没报；申报准备单只汇总账上的数，不算税。
- 核票只核票面自洽，不去税务局验真伪。
- 流水文件只读 CSV、TSV、TXT；Excel 和 PDF 要导出或截图。
- 会计包是未经执业会计复核的工程候选版，签名位是占位值。
- 微信通道用的是腾讯没有公开的 iLink 消息格式，腾讯改接口时可能失效。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景——点击展开</summary>

`pnpm build` 用 `tsc` 编译 `src/`，再把头像内联进 `lib/client.js`（`scripts/build-client.mjs`）。单元测试用内存 SQLite 和假的 iLink 服务。`e2e/run.mjs` 用真 DeepSeek 按剧本对话，不进 CI。

</details>
