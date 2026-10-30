# 维护流程 / Maintenance

初期维护者见 [MAINTAINERS](../MAINTAINERS.md)，本分支已接入源码，尚无 npm / Release 发布。

## 分流

确认反馈类型、是否含隐私信息与仓库范围。故障使用[九字段规范](issue-reporting.md)。
`status: needs-triage`、`status: needs-info`、`status: accepted` 互斥，转移时移除旧状态。
重复项链接原记录，不实施的请求说明原因；接受的任务关联 PR，只有实际发布后才回告版本。
不默认启用自动关闭不活跃 Issue 的机器人。

`good first issue` 必须有目标、修改位置、验收方式和维护者。
标签见 [.github/labels.json](../.github/labels.json)，文件更改后仍须同步远端。

## 合并与验证

任务分支经完整差异审阅和相关本地验证后 squash 合并，自动删除分支。
main 禁止强推和删除，要求 PR 与已解决的审阅讨论；单维护者阶段不强制另一个人批准。
当前无远端 CI required check，不为合并启动、启用或重跑远端 CI，
不把未运行检查报告为成功。真实发现的问题仍须修复并复验。

文档核对双语、链接和公开范围；表单核对 YAML、字段、标签与实际页面。
源码改动按 CONTRIBUTING.md 执行构建、类型、lint、测试和必要运行验证；本地结果与历史 CI 分开记录。

## 私密受理

管理员查看私密漏洞报告及 Settings → Moderation → Reported content，
按 [SECURITY](../SECURITY.md) 和[行为规范](../CODE_OF_CONDUCT.md)处理。
邮件投递取决于账号设置，管理员仍需主动查看受理页面，不承诺固定响应时限。

## English

Triage by type, privacy and scope. Use the nine-field guide, keep status labels
mutually exclusive, link duplicates and explain declined requests. Define real
starter tasks before labeling them; label files do not update GitHub automatically.

Use task branches and PRs, full diff review and relevant local checks, then squash
merge. Main disallows force push and deletion. The one-maintainer setup does not
require another approver or hosted CI. Never claim unrun checks passed.
Inspect security and moderation reports directly; email delivery depends on account
settings. No fixed response schedule is promised.
