---
name: sobre-security
description: Security practices for Sobre — a non-custodial Stellar wallet handling real funds and KYC/SEP-9 data. Use when handling keys/secrets, signing, wallet connection, the fiat on/off-ramp (MoneyGram/PDAX), KYC data, or any code review with a security angle.
---

# Sobre Security

Sobre custodies real money on Stellar mainnet and will handle KYC/SEP-9 PII for
the fiat ramps. Treat anything touching keys, signing, secrets, or user identity
as security-sensitive. The threat model: a compromised client, a leaked secret,
or a contract auth gap all lead directly to fund loss.

## Non-negotiables

### Keys and secrets
- **The user's private key never leaves their device.** Web signs via the
  Freighter extension; mobile will sign via a deep-linked wallet app (or, later,
  a passkey smart wallet). Sobre code must never request, store, transmit, or
  log a seed phrase or private key.
- **Server secrets live in Vercel env vars only** — OAuth client id/secret, the
  Sobre wallet's SEP-10 keypair, PDAX API key/secret. Never commit them, never
  ship them to the browser, never log them. Read via `process.env` inside route
  handlers; check `.env.example` for the expected names and keep real values out
  of git (`.gitignore` already excludes `.env`).
- **The Sobre wallet SEP-10 keypair is server-side credential-grade** — it
  authenticates the *app* as a MoneyGram anchor client, not an end user. Guard
  it like the OAuth secret.

### Never trust the client / never trust upstream
- All provider auth and signing happen server-side (`Browser → /api/* →
  provider`). The browser never holds a provider credential.
- Validate every external response before using it (the php-rate route checks
  type/finiteness/positivity before returning the rate). Same for any provider
  JSON, any RPC result, any user input that becomes a contract arg.
- Validate amounts and addresses at the edge: positive `bigint` stroops, valid
  Stellar address (`Address.fromString` throws on bad input — let it), envelope
  percentages summing to 100. Don't push unvalidated values into `invokeWrite`.

### On-chain authorization
- The contract is the real access-control boundary (see **sobre-contracts**):
  `require_auth()` on the acting address, admin-only gates on admin methods,
  Savings always protected, member spend limits enforced on-chain. UI checks are
  convenience only — never the security boundary.

### KYC / PII (SEP-9 — for the ramps)
- SEP-9 KYC fields (name, birth date, address, passport/ID, financial account)
  are highly sensitive. **Pass them through the proxy to MoneyGram/PDAX and
  never log or persist them.** Sobre stores nothing server-side today — keep it
  that way. If persistence ever becomes necessary, it requires a DB with
  encryption at rest, introduced deliberately, not by accident.
- Map KYC form fields to SEP-9 field names so you're not inventing a custom
  schema for sensitive data.

### Transport & integrity
- HTTPS everywhere (SEP-24 *requires* it and rejects non-HTTPS endpoints). TLS
  is the encryption layer — don't roll custom crypto.
- Idempotency keys on non-idempotent writes (deposit init, order create) so a
  retry can't double-spend. Pass through provider `Retry-After` on 429.

### Logging
Log: timestamp, endpoint, status, latency, error code. **Never** log: secrets,
JWTs, private keys, seed phrases, SEP-9/KYC data, full request bodies, or
stack traces containing any of the above.

## Mobile-specific
- Keep the crypto polyfills intact (`react-native-get-random-values` provides a
  real CSPRNG for the SDK — see **sobre-mobile**). A weak RNG silently weakens
  any key/nonce generation.
- The deep-link signing handoff is a trust boundary: validate the XDR you send
  to and receive back from the wallet app; show the user what they're signing.

## When reviewing or building security-sensitive code

1. Run the **`/security-review`** skill on the diff (contract changes, new proxy
   routes, signing/wallet code, anything touching secrets or PII).
2. For contracts specifically, focus on: missing `require_auth`, integer
   overflow in envelope splits, policy-bypass paths, and storage-layout breaks
   across `upgrade()`.
3. For proxy routes: secret leakage into responses/logs, missing input
   validation, missing idempotency, and CORS/HTTPS compliance.

This is authorized defensive work on the team's own product — apply best
practices thoroughly.