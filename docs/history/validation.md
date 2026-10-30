# 本次接入验证

来源快照：`dad68cf856fae0bb2bb2ea954f6e9400a0e69098`；日期：2026-10-30；本地 Windows / Node 24.18.0 / pnpm 12.3.4。

| 检查 | 结果 |
| --- | --- |
| 原锁文件安装 | 通过；pnpm 12.3.4，未改依赖版本或锁文件 |
| pnpm build | 通过 |
| pnpm typecheck | 通过 |
| pnpm lint | 通过 |
| pnpm test | 通过：309 + 62 = 371 项 |
| 编译微信入口运行 | 通过：普通链接、Windows Global junction 各 1 项；合成 iLink 出码、保存登录态重启 |
| A6 分类器两项自测 | 具备 Git for Windows diff 且允许 MSYS 启动的正常进程中通过 |
| 隔离真实 DSH/mock-iLink | 通过；详见 validation.json |
| Q-008 材料离线校验 | 通过；详见 validation.json |

A6 首次额外检查失败：默认 PATH 中找不到外部 diff（ENOENT）；在受限进程启动 MSYS 也受阻。补足实际工具前置条件并在正常进程重跑后两项自测通过。未修改该脚本。完整 A6 与内部上游对比本次未执行，原 A6-SNAPSHOT.md 属来源快照记录。

本次不启用远端 CI，也未调用收费模型、真实微信、真实账本；未进行桌面 GUI 人工验收。原三系统六组 CI、Q-008 批量模型对照与四组冒烟都是历史记录，详见 [legacy-prs.md](legacy-prs.md)，不能冒充本次结果。

可复核命令：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
node packages/dsh-qianlai/e2e/q008/run.mjs --validate
node --test packages/dsh-qianlai/tests/wechat-runtime.test.mjs
node packages/dsh-qianlai/scripts/check-dsh-wechat.mjs /path/to/dsh/lib/bin.js
node packages/fintax-core/scripts/a6-diff.mjs --selftest
```

最后一项另需 GNU diff 可被进程找到；DSH 项使用固定的 0.2.1-rc.3 和脚本创建的隔离数据环境。没有把用户的既有 DSH_HOME 或凭据用于这些检查。
