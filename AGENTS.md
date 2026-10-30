# AGENTS.md

Guidance for coding agents (and humans) working in this repository.

## Layout

| Path | What it is |
|---|---|
| `packages/dsh-qianlai` | The DSH plugin: tools (`src/`), WeChat channel (`src/wechat/`), browser half (`client/`), preset and wiring (`cordis.patch.yml`), real-model scenarios (`e2e/`). |
| `packages/fintax-core` | Domain core copied from Qianlai's internal repository. |

## Checks

```sh
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm test
```

All four must pass. Follow docs/maintaining.md: do not enable, launch or rerun hosted CI for this import. Historical CI configuration is archived under docs/history/source-ci.yml.disabled. A change to the UI, the WeChat channel or the preset also needs a run in a real DSH: install the plugin into a separate `DSH_HOME` and start `dsh --profile web --host 127.0.0.1 --port <port> --no-open`.

`node packages/dsh-qianlai/e2e/run.mjs` talks to the real DeepSeek API (needs `DEEPSEEK_API_KEY`, costs money, not in CI). Run the scenarios that touch what you changed.

## Rules

- **Do not hand-edit copied files in `packages/fintax-core/src` and `tests`.** They must stay identical to upstream; changes go upstream first and are re-copied with `scripts/port-from-moneycome.mjs`.
- **The tool surface of the Zhangjie preset is a security boundary.** Adding a tool to the preset, or giving it shell, file or network access, needs maintainer review.
- **Amounts are integer cents** (`bigint` in code, `INTEGER` in SQLite). Never use floating point for money.
- **Schema changes** append a migration to `MIGRATIONS` in `packages/dsh-qianlai/src/store.ts`; never edit an existing one.
- **Synthetic data only.** No real company names, invoices, statements, WeChat accounts or tax IDs in code, tests or fixtures.
- **No secrets in the repository.** Pass `DEEPSEEK_API_KEY` through the environment only. Do not set `DEEPSEEK_BASE_URL` for DSH; it makes DeepSeek requests fail.
- **Use your own `DSH_HOME`** for development so you never touch a real `~/.dsh`.
- Runtime dependencies must be MIT, Apache-2.0, ISC or BSD licensed; no GPL or AGPL.
- Conventional commits (`feat:`, `fix:`, `docs:` …). Record user-visible changes in `CHANGELOG.md`.

## Public contribution rules

Follow CONTRIBUTING.md, docs/issue-reporting.md, docs/maintaining.md and the existing PR template. Public issue identifiers are this repository's GitHub numbers; use S1/S2/S3 or unsure. Legacy Q identifiers are provenance only. Use professional descriptions and synthetic reproductions, not private chat transcripts. Changes to copied financial-core logic require maintainer/upstream coordination. Keep all temporary files outside tracked source and never commit credentials or real financial data.
