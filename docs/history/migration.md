# 源码与问题迁移记录

本次只提交一个源码接入 PR：以公开仓库 `07a4b0638daed67bd9b6ddeed774818928abf0b4` 为基线，导入维护快照 `dad68cf856fae0bb2bb2ea954f6e9400a0e69098` 的最新源码及已合入修复。跟踪任务 [#2](https://github.com/qianlai-ai/dsh-qianlai/issues/2)。

## 范围与来源

- 导入两个 workspace 包、原锁文件和构建配置、合成样本与测试素材、已筛查的 Q-008 八文件复现包。
- 五个原 PR 的问题背景、修复方法、验证和来源提交保存在 [legacy-prs.md](legacy-prs.md)、[legacy-changes.json](legacy-changes.json)；四个直接修复补丁保存在 patches/，PR 13 的材料本身已提供，不重复巨型补丁。
- 保留公开仓库既有 Issue 表单、PR 模板、CODEOWNERS、社区和安全文件；更新源码接入后的使用、贡献及许可说明。公开编号和严重程度遵从本库规则。
- 不导入旧 Git 对象、原邮件身份、私人截图/聊天、凭据、账本、node_modules、构建产物和本机分析日志。可公开材料均来自合成测试。
- 张姐四张图片按原“仅随插件展示”授权保留；原素材与上游声明未移除。
- 不启用远端 CI；原工作流保存为 [source-ci.yml.disabled](source-ci.yml.disabled)，不在 .github/workflows 中。
- 接入不是 npm 包、Release、tag 或生产部署发布。

## 问题对应与状态

| 原编号 | 原记录 | 本库记录 | 迁移状态 |
| --- | --- | --- | --- |
| Q-002 | 旧维护问题 1 | [#3](https://github.com/qianlai-ai/dsh-qianlai/issues/3) | 历史已修复关闭；源码仍须本接入 PR 合入 |
| Q-003 | 旧维护问题 3 | [#4](https://github.com/qianlai-ai/dsh-qianlai/issues/4) | 历史已修复关闭；源码仍须本接入 PR 合入 |
| Q-004 | 旧维护问题 5 | [#5](https://github.com/qianlai-ai/dsh-qianlai/issues/5) | Open，仍未解决或需求待实现 |
| Q-005 | 旧维护问题 6 | [#6](https://github.com/qianlai-ai/dsh-qianlai/issues/6) | Open，仍未解决或需求待实现 |
| Q-006 | 旧维护问题 7 | [#7](https://github.com/qianlai-ai/dsh-qianlai/issues/7) | Open，仍未解决或需求待实现 |
| Q-007 | 旧维护问题 8 | [#8](https://github.com/qianlai-ai/dsh-qianlai/issues/8) | Open，仍未解决或需求待实现 |
| Q-008 | 旧维护问题 9 | [#9](https://github.com/qianlai-ai/dsh-qianlai/issues/9) | Open，仍未解决或需求待实现 |
| Q-009 | 旧维护问题 11 | [#10](https://github.com/qianlai-ai/dsh-qianlai/issues/10) | 历史已修复关闭；源码仍须本接入 PR 合入 |
| Q-010 | 旧维护问题 14 | [#11](https://github.com/qianlai-ai/dsh-qianlai/issues/11) | Open，仍未解决或需求待实现 |

已修复记录按历史归档处理，不表示尚未合入的 main 已拥有源码。Q-008 虽已改善，事实复述及承诺误认遗留项继续打开；正常业务邀约和账务提醒不算人设缺陷。其他需求不因为迁移而视为实现。

## 校验与隐私

本次实际验证见 [validation.md](validation.md) 和 [validation.json](validation.json)。来源文件清单、差异与筛查方法见 [import-review.json](import-review.json)。原始 PR/Issue 的私人附件和本机路径没有整体复制；所有公开内容均在导入分支独立整理。只保留测试所需的合成对话可见部分，不含内部推理。
