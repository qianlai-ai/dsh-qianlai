# 问题记录格式 / Reporting an issue

每条记录只描述一个问题。中文或英文均可。无需先运行测试套件，也不要求上传附件。

## 可复制模板

以下九个字段的名称和顺序固定。空白模板用于填写，不代表完整记录。

```text
【编号】
【级别】
【对应测试项】
【环境】
【操作步骤】
【预期】
【实际】
【能否复现】
【附件】
```

## 填写规则

| 字段 | 如何填写 |
| --- | --- |
| 编号 | 公开记录使用该仓库 GitHub Issue 的 #数字。首次提交可留空或写“待登记”，由维护者提交后补全；不是 YAML 自动生成自定义编号。尚未登记不能声称编号验收通过。内部准备记录使用 PREP-日期-三位序号，校验样例用 SAMPLE- 前缀，不冒充真实 Issue。 |
| 级别 | 使用下表的 S1、S2、S3；无法判断写“暂不确定”，维护者分流时复核。 |
| 对应测试项 | 填真实测试文件、测试名称或检查项；没有则写“不适用”及原因，不编造测试。 |
| 环境 | 填与问题有关的系统、插件或源码提交、DSH、Node、使用通道；不清楚的版本写“不知道”。 |
| 操作步骤 | 按 1、2、3 描述实际操作；静态发现写检查了什么文件。尚未执行的建议复现步骤必须明确注明。 |
| 预期 | 单独描述期望结果；财务案例写虚构金额或分录。 |
| 实际 | 单独描述实际观察，并区分事实、推测、未验证影响。 |
| 能否复现 | 使用“未验证”“每次可复现”“间歇可复现”“本次观察到，尚未再次复现”“目前无法复现”。静态发现不等于运行时复现。 |
| 附件 | 写实际附件名称及用途，没有则写“无”。表单允许留空，整理完整记录时补“无”。 |

初期级别只描述影响，不代表响应或修复时限：

- **S1 严重**：核心流程阻断，或账务结果可能错误且无可靠绕过方法。
- **S2 一般**：部分功能异常，有可行绕过方法。
- **S3 轻微**：文案、显示或文档问题，不影响账务结果。
- **暂不确定**：信息不足，由维护者复核。不要为了提交而猜测严重程度。

请勿提交 API key、含 token 的访问 URL、微信凭据、真实税号或银行卡号、未脱敏票据、账本数据库、完整私人聊天记录。只用虚构案例与最小脱敏片段。安全漏洞按 SECURITY.md 的私密渠道报告；一般社区冲突按行为规范的渠道处理。

## 表单与人工校验的边界

故障表单按上述顺序设置九个字段。级别、复现状态使用限定选项；对应测试项、环境、步骤、预期、实际必填。编号与附件允许初次留空，以免阻碍反馈。

表单只能限制字段填写与选项，不能判断内容真实性、单一问题、编号唯一性、引用是否存在，或是否已经复现。空白 Issue 入口保留，维护者引导补齐同一格式；不能声称所有入口强制执行了九字段验证。

维护者逐条检查：

1. 九字段完整、顺序一致，没有重复或合并。
2. 一条只包含一个问题；多个独立现象拆开记录并关联。
3. 编号合法且不重复；“待登记”明确标为待补充。
4. 级别使用统一定义，不混用其他分级。
5. 内容实际填写；“不适用”附原因，“未验证”“无”如实使用。
6. 操作步骤有先后顺序，未做的操作没有写成已做。
7. 预期与实际独立且具体。
8. 测试项、附件、问题引用可以追溯；缺失引用标为待补充。
9. 复现结论有观察依据；格式通过不等于确认 Bug。

检查结论写“通过”或“待补充”，并逐项说明缺失字段或规则。不应因此自动扩大到业务修复。

## English summary

Use one record per problem, in this order: ID, severity, related test/check,
environment, steps, expected result, actual result, reproducibility, attachments.
Unknown versions, unverified reproduction, no attachments, and a test that is not
applicable with an explanation are valid states. New reports may omit the ID;
maintainers register the repository's GitHub issue number after submission.
S1 means a blocked core flow or potentially incorrect bookkeeping without a
reliable workaround; S2 means a partial failure with a workaround; S3 covers
minor documentation or display issues without an accounting impact. “Unsure”
is acceptable. These are impact categories, not response-time commitments.

Forms enforce required fields and dropdown choices only. Maintainers verify
one problem per record, unique identifiers, genuine evidence and references.
Never upload secrets, credentials, private ledgers or real financial records.
Use the private channel in SECURITY.md for vulnerabilities.

## 表单依据

结构按 GitHub 的 [Issue Forms 语法](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms)
与 [表单字段 schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema) 核对。
模板进入默认分支后才向用户生效；本地解析通过不代表远端已上线。
