# Sobre project skills

Repo-scoped Claude Code skills that load Sobre's conventions on demand, so any
contributor (or Claude) starts from the team's grounded best practices instead
of generic defaults. Each `SKILL.md` is auto-discovered by Claude Code and
triggers from its `description`.

| Skill | Fires when you're working on… |
|---|---|
| `sobre-web` | The Next.js 16 / React 19 web app in `web/` — UI, hooks, Soroban reads/writes from the browser |
| `sobre-mobile` | The Expo / React Native app in `apps/mobile/` — screens, RN components, porting web → native, wallet signing |
| `sobre-contracts` | The Rust / Soroban contracts in `contract/` — methods, tests, build/deploy |
| `sobre-api-proxy` | Server-side route handlers in `web/src/app/api/` — provider proxies, SEP-10/24, caching |
| `sobre-security` | Keys, secrets, signing, KYC/SEP-9 data, fund-handling, security review |
| `sobre-design-system` | Styling on either platform — palette, type, tokens, web↔mobile parity |

Each skill stays anchored to the real files (`lib/contract.ts`, `lib/config.ts`,
`globals.css`, `theme/tokens.ts`, …) and the design docs under `docs/`. When the
code or stack changes, update the matching skill so it doesn't drift.

Sources distilled into these skills:
- `README.md`, `web/AGENTS.md`
- `docs/tech-stack-architecture.md`, `docs/design-guide.md`,
  `docs/pdax-moneygram-integration.md`
- the actual `web/`, `apps/mobile/`, and `contract/` source.