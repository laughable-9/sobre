# PDAX and MoneyGram Integration

**Document type:** API access research brief  
**Project:** Sobre — shared family wallet for OFW households  
**Team:** Team Legends, UP Baguio

---

## Background

Sobre is a shared budget wallet built on the Stellar blockchain. When an OFW sends money home, the smart contract splits it automatically into named budget categories — Groceries, Tuition, Savings — in a single transaction. Both the sender abroad and the family in the Philippines see the same balances in real time.

The contract handles allocation well. What it does not handle is how money gets in and how the family converts it to cash. That is the gap this integration addresses.

---

## Why PDAX and MoneyGram

Sobre splits money well. It does not move money in or out. MoneyGram and PDAX fill those two gaps.

### The problem without them

- The OFW has no way to fund the Sobre wallet from abroad without manually buying crypto first
- The family has no way to convert what is in the wallet to PHP cash without leaving the app
- Without both, Sobre is useful only to people who already own and understand crypto — which is not the target user

### Why MoneyGram

- Sobre needs money to arrive on Stellar as USDC — most remittance providers (Wise, Western Union, Remitly) settle into bank accounts, not blockchains
- MoneyGram is one of the only providers with a Stellar anchor, meaning it delivers USDC directly on-chain with no bank intermediary
- It uses the same open standards Stellar wallets already speak — SEP-10 for authentication and SEP-24 for deposits — so the integration fits naturally into the existing stack
- OFWs pay in their local currency (SAR, AED, SGD, HKD, JPY) at a MoneyGram counter or app — MoneyGram handles the currency conversion internally, so the OFW never needs to touch crypto
- MoneyGram has a physical agent network across Southeast Asia and the Middle East, so OFWs without a bank account or smartphone can still send money from a counter

### Why PDAX

- The family needs to convert USDC to PHP and withdraw to a bank or GCash — this requires a BSP-licensed Philippine crypto exchange
- PDAX is the only BSP-regulated exchange with a REST API that Sobre can call programmatically to request a quote, create a sell order, and trigger a PHP withdrawal
- Coins.ph does not offer a suitable partner API for this use case
- Binance PH does not provide the programmatic withdrawal flow needed
- Being BSP-licensed matters — it means PDAX operates legally in the Philippines and users are protected under local financial regulations

### Why not the alternatives

**On-ramp alternatives to MoneyGram:**

| Provider | Why it does not work for Sobre |
|---|---|
| **Wise** | Settles into bank accounts only. No blockchain delivery. The family would need a Philippine bank account to receive the money before it could enter Sobre. |
| **Western Union** | Same as Wise — bank or cash pickup only. No on-chain settlement. |
| **Remitly** | Bank and mobile wallet delivery only. No Stellar integration. |
| **Transak** | Supports USDC on Stellar across 64+ countries and may support PHP as a fiat input. This is a viable alternative to MoneyGram and worth evaluating. The main unknown is whether it covers the OFW's sending countries (Saudi Arabia, UAE, Singapore) and what its fee structure looks like compared to MoneyGram. No KYB requirement found — appears more self-serve for developers. |

Transak is the most credible alternative to MoneyGram for the on-ramp. If MoneyGram's KYB process or volume limits are a blocker at this stage, Transak is the next option to try.

**Off-ramp alternatives to PDAX:**

| Provider | Why it does not work for Sobre |
|---|---|
| **Coins.ph** | Does not offer a programmable partner API for sell orders and withdrawals. Users would have to manually transfer and sell inside the Coins.ph app — Sobre cannot trigger this programmatically. |
| **Binance PH** | No confirmed partner API for programmatic USDC → PHP sell and withdrawal flow suitable for third-party integration. |
| **GCash** | Fiat only. No crypto support. Cannot receive USDC directly. |
| **Maya (PayMaya)** | No crypto off-ramp API available for third-party apps. |

PDAX is currently the only BSP-licensed Philippine exchange with an API that supports the full flow: quote → sell → withdraw to bank or GCash.

---

### Why these two work with the existing Sobre stack

- The Sobre contract is already token-agnostic — `init` accepts any SEP-41 token address, so redeploying with USDC instead of XLM is a constructor argument, not a code change
- `deposit()` and `spend()` are already implemented — MoneyGram calls `deposit()` after settlement, PDAX is called after `spend()`
- The Next.js app already has a server-side proxy pattern for external APIs (see `web/src/app/api/php-rate/route.ts`) — the same pattern is used for both integrations
- All API best practices (authentication, idempotency, rate limiting, monitoring) can be applied within the existing Next.js and Vercel infrastructure without adding new services

---

## How money moves and what it costs

OFWs work in many countries — Saudi Arabia, UAE, Hong Kong, Singapore, Japan. They earn in SAR, AED, HKD, SGD, JPY. None of those currencies can move directly onto a blockchain, so they pass through conversion steps before reaching Sobre.

### Target architecture: two conversions

```
OFW's local currency  →  USDC  →  PHP
(SAR, AED, SGD, etc.)
```

This is the preferred path. MoneyGram handles the first step — the OFW pays in their local currency and USDC lands in the Sobre wallet. PDAX handles the second — the family sells USDC for PHP and withdraws to their bank or GCash. XLM is not involved in the money flow at all.

This requires:
- The Sobre contract redeployed with USDC as the payment token instead of XLM
- PDAX supporting USDC → PHP trading pairs (to be confirmed once sandbox access is granted)

### What the old three-step chain looked like

The original plan used XLM as the on-chain token:

```
Local currency  →  USDC  →  XLM  →  PHP
```

That added a Stellar DEX swap in the middle — an extra fee and an extra point of price volatility. Removing XLM from the flow eliminates both.

### What each step costs in the two-step path

| Step | Conversion | Who handles it | Cost |
|---|---|---|---|
| 1 | Local currency → USDC | MoneyGram | Transfer fee (shown upfront) + exchange rate spread (not shown, built into the rate) |
| 2 | USDC → PHP | PDAX | Trading fee + withdrawal fee to bank or GCash |

**Fee** is a flat charge shown upfront. **Spread** is the gap between the real market rate and the rate MoneyGram gives the OFW — it is not a visible line item but reduces the final amount. That is where most remittance companies make their margin.

With two steps instead of three, the total cost to the family is lower and the flow is simpler. Sobre does not control either fee — it only ensures that whatever USDC arrives is split and tracked exactly as agreed.

### Why USDC and not the OFW's local currency directly

USDC is a stablecoin — always worth exactly $1 USD, issued by Circle and backed by real USD reserves. It is the bridge MoneyGram uses because it can move on the Stellar blockchain while fiat currencies like SAR or AED cannot. The OFW never touches USDC directly — they pay in their local currency at a MoneyGram counter or app, and MoneyGram handles the conversion before anything hits Stellar.

### Why MoneyGram specifically for this

Most remittance providers settle into bank accounts. That means Sobre would need to receive PHP into a bank, convert it to a crypto token, and then deposit — adding cost, delay, and a custodial step. MoneyGram is one of the only providers with a Stellar anchor, meaning it delivers USDC directly on-chain with no intermediary bank step. It also has a physical agent network across Southeast Asia and the Middle East, so OFWs without bank accounts can still send money from a counter.

---

## Important: contract needs to be redeployed for USDC

MoneyGram's Ramps product settles in **USDC on Stellar** — not XLM. Transaction limits on the sandbox are 10–20 USDC per transaction (100 USDC aggregate). Production limits are 5–950 USDC on-ramp and 5–2,500 USDC off-ramp.

The current Sobre contract on mainnet is deployed with XLM as the payment token. To support the two-step USDC → PHP path, a new Sobre contract instance needs to be deployed with the USDC SEP-41 contract address in the constructor instead of the XLM SAC address. The contract code itself does not change — only the token it is initialized with.

The XLM contract can stay live for users already on it. New wallets opened after the USDC deploy would use the USDC version.

---

## MoneyGram Ramps

MoneyGram operates as a Stellar anchor — a regulated service that bridges fiat money onto the Stellar blockchain. It implements the Stellar Ecosystem Proposals (SEP) that Stellar wallets use as a standard protocol.

### How it fits into the app

```
OFW opens Sobre → taps Send Money
  → server authenticates with MoneyGram via OAuth 2.0 + SEP-10
  → app opens the MoneyGram interactive deposit window (SEP-24)
  → OFW completes payment in local currency (USD, AED, SGD)
  → MoneyGram delivers USDC to the Sobre wallet address on Stellar
  → app detects the incoming USDC and calls deposit()
  → contract splits the amount across the three envelopes
```

### Actual endpoints (from MoneyGram and Stellar SEP-24 documentation)

| # | Request | Purpose |
|---|---|---|
| 1 | `GET /oauth/accesstoken?grant_type=client_credentials` | Get an OAuth 2.0 access token using client ID and secret (Basic auth, Base64 encoded) |
| 2 | `GET /.well-known/stellar.toml` | Fetch anchor config — confirms supported assets, SEP-10 endpoint, SEP-24 endpoint |
| 3 | `GET <WEB_AUTH_ENDPOINT>?account=<stellar_address>` | SEP-10 step 1 — server requests a challenge transaction from MoneyGram |
| 4 | `POST <WEB_AUTH_ENDPOINT>` | SEP-10 step 2 — submit the signed challenge, receive a JWT session token |
| 5 | `GET /info` | Confirm supported assets, deposit/withdrawal limits, and fees |
| 6 | `POST /transactions/deposit/interactive` | SEP-24 — initiate a deposit session, receive a URL to open for the OFW |
| 7 | `GET /transaction?id=<id>` | Poll transaction status until `completed` |

All requests after step 1 include:

```
Authorization: Bearer <JWT from SEP-10>
Accept: application/json
```

### What MoneyGram requires before granting access

- Submit a KYB (Know Your Business) application at `business.moneygram.com`
- Sign a legal agreement with MoneyGram
- Add the Sobre app domain to their wallet allowlist — email `[email protected]`
- Host a valid `stellar.toml` file at `https://sobre-mocha.vercel.app/.well-known/stellar.toml`
- Pass certification by submitting test cases through their sandbox

### Sandbox limits

- Per transaction: 10–20 USDC
- Aggregate: 100 USDC total

### What we are asking MoneyGram for

- Allowlist approval for the Sobre app domain
- Sandbox credentials (client ID and secret) for the OAuth 2.0 token endpoint
- Confirmation of the USDC trustline requirements for the Sobre wallet
- Clarification on whether a hackathon-stage app can proceed to production limits after certification

---

## PDAX

PDAX is a BSP-regulated Philippine crypto exchange. The family uses it to convert USDC from their Sobre wallet into PHP, then withdraw to a local bank account or GCash.

### How it fits into the app

```
Family member taps Cash Out on an envelope
  → app calls spend() on the smart contract
  → USDC moves from the Sobre wallet to the member's personal Stellar address
  → app requests a quote from PDAX (USDC → PHP)
  → member confirms the rate
  → app creates a sell order on PDAX
  → PDAX fills the order and sends PHP to the member's bank or GCash
```

### Endpoints needed

PDAX's public API documentation is behind a partner access gate, so the endpoint structure below is based on standard exchange REST API conventions and will be confirmed once sandbox access is granted.

| # | Request | Purpose |
|---|---|---|
| 1 | `GET /users/me` | Confirm the user has completed KYC on PDAX |
| 2 | `GET /market/quote?from=USDC&to=PHP&amount=<n>` | Get the current USDC/PHP rate before the member confirms |
| 3 | `POST /orders` | Create a sell order for the specified USDC amount |
| 4 | `GET /orders/:id` | Poll until the order status is `filled` |
| 5 | `POST /withdrawals` | Send the PHP proceeds to the member's bank or GCash |

### What we are asking PDAX for

- API key and secret for the PDAX REST API (market data, orders, withdrawals)
- Sandbox environment access to test the sell and withdrawal flow without real funds
- Confirmation of the actual endpoint structure and authentication method
- Guidance on whether Sobre can trigger withdrawals programmatically on behalf of a verified user, or if the withdrawal step requires action inside the PDAX app

---

## Where each API sits relative to the contract

Neither API touches the smart contract directly. They sit at the edges of the flow, with the existing `deposit()` and `spend()` functions as the handoff points.

```
MoneyGram                            PDAX
(money in)                           (money out)
    |                                    |
    v                                    ^
deposit() ----> SobreContract ----> spend()
                (envelopes)
```

Both `deposit()` and `spend()` are already implemented and working. The integration adds the fiat layer on either side without changing the contract.

---

## Open questions

1. **PDAX USDC support** — the target path is USDC → PHP. This needs to be confirmed with PDAX before committing to the USDC contract redeploy. If PDAX does not support USDC → PHP, XLM remains the fallback and the three-step chain applies.
2. **stellar.toml** — MoneyGram requires Sobre to host a valid `stellar.toml` at the app domain before the allowlist application can proceed. This file needs to be created at `https://sobre-mocha.vercel.app/.well-known/stellar.toml`.
3. **KYC on PDAX** — does the family member need a separate PDAX account, or can Sobre embed PDAX's hosted KYC flow inside the app?
4. **USDC deposit address** — PDAX requires the token to arrive at the user's PDAX deposit address, not the Sobre contract. The spend() call sends tokens to the member's personal wallet first. A cleaner implementation would use the PDAX deposit address as the spend destination directly.
5. **Exchange rate source** — the app currently shows XLM/PHP rates from CoinGecko. With the USDC path, this should switch to a USDC/PHP rate, and the PDAX quote rate should take precedence during cashout since that is the actual rate the member receives.

---

## Best practices confirmed from provider documentation

These are practices specific to the Stellar/SEP ecosystem and the providers involved, found while researching this integration — not generic API advice.

### SEP-9: KYC field standard

Both MoneyGram (via SEP-24) and potentially PDAX exchange KYC data using **SEP-9**, the Stellar-wide standard for customer information fields (name, birth date, address, ID documents, financial account details). Sobre should map any KYC form fields to SEP-9 field names when passing customer information to MoneyGram's interactive deposit flow — this avoids a custom mapping layer and matches what the anchor expects natively.

SEP-9 data is sensitive by definition (passport numbers, proof of address, photo ID). Per the open questions above, Sobre's current architecture stores nothing server-side — KYC data should pass through the proxy to MoneyGram/PDAX and never be logged or persisted, consistent with the "Database" section below.

### SEP-10: signed challenge, not a password

MoneyGram's authentication (SEP-10) does not use a username/password or a static secret for the user — it proves wallet ownership via a signed Stellar transaction. The practical implication: the Sobre **wallet's own keypair** (not the user's) signs the SEP-10 challenge during server-to-server setup, since this authenticates the Sobre application as a registered anchor client, not an individual family member. This keypair must be managed with the same care as the OAuth client secret — both are server-side credentials.

### SEP-24 requires HTTPS and CORS by spec

The SEP-24 specification mandates that anchors reject non-HTTPS endpoints and that every response include `Access-Control-Allow-Origin: *`. This is enforced by MoneyGram, not optional — confirms the "HTTPS only" practice in this doc is not just good hygiene but a hard requirement for the integration to function at all.

### Interactive flow uses short-lived, one-time JWTs in the URL

SEP-24's interactive deposit/withdrawal flow (the popup/webview the OFW completes payment in) passes a **short-lived, one-time-use JWT as a URL query parameter**, separate from the longer-lived session JWT used for API calls. This means two token lifetimes need to be tracked: the session JWT (for `/transactions`, `/transaction` polling) and the interactive-flow JWT (single use, embedded in the popup URL). The proxy should generate the interactive JWT fresh for each deposit attempt rather than reusing one.

### MoneyGram's actual limits shape the demo

Sandbox limits are 10–20 USDC per transaction, 100 USDC aggregate. This caps what can be demonstrated end-to-end during the 30-day build — any demo flow should use amounts within these bounds, and the UI should handle the "amount exceeds anchor limit" error response from `/transactions/deposit/interactive` gracefully rather than treating it as a generic failure.

---

## API design and security

### Authentication

**MoneyGram** uses two layers:

1. OAuth 2.0 — client ID and secret encoded as Base64, sent as a Basic auth header to get an access token:
   ```
   Authorization: Basic base64({clientId}:{secret})
   ```
2. SEP-10 — a Stellar-native challenge-response. The server requests a challenge transaction from MoneyGram, signs it with the Sobre wallet's key, and submits it back to receive a JWT. That JWT is then used on all SEP-24 calls:
   ```
   Authorization: Bearer <JWT>
   ```

**PDAX** uses an API key and secret pair. The exact signing method (HMAC, header-based, etc.) will be confirmed once sandbox access is granted.

All authenticated requests happen server-side. The browser never calls MoneyGram or PDAX directly.

```
Browser → /api/moneygram (our Next.js server) → MoneyGram
Browser → /api/pdax      (our Next.js server) → PDAX
```

---

### Versioning

Integrations target a pinned API version. If either provider releases a breaking change, only the server-side proxy files need updating — not the frontend.

```
GET /api/v1/transactions
GET /api/v1/orders
```

---

### Resource naming

Where we control the naming (our proxy routes), we use clear, plural nouns consistent with how each provider names their resources:

```
/api/moneygram/transactions
/api/pdax/orders
/api/pdax/withdrawals
```

---

### Idempotency

Deposit initiation and order creation are non-idempotent — calling them twice creates two transactions. The proxy attaches a unique idempotency key to every write request so that network retries do not double-execute:

```
Idempotency-Key: <uuid generated once per user action>
```

---

### Filtering, sorting, and pagination

When fetching transaction or order history, requests include explicit filters. The proxy never pulls all records and filters in memory:

```
GET /transactions?status=completed&sort=createdAt_desc&page=1&pageSize=20
```

---

### Rate limiting

Both providers enforce rate limits on their APIs. The proxy handles this by:

- Caching quote responses for 10 seconds so repeated UI renders do not fire duplicate upstream requests (same pattern as the existing CoinGecko proxy in `web/src/app/api/php-rate/route.ts`)
- Passing through the provider's `Retry-After` header if a 429 is returned, so the browser knows when to retry

---

### Monitoring and logging

Every proxy request logs the following without recording sensitive values:

- Timestamp
- Endpoint called
- HTTP status returned
- Latency in milliseconds
- Error code if the request failed (no API keys, no stack traces, no user data)

Logs surface in Vercel's built-in log drain. A spike in 4xx or 5xx errors will be visible there before users report it.

---

### Encryption

Sobre does not implement a custom encryption layer. It relies on what the stack already provides:

- All API calls use HTTPS. TLS encrypts everything in transit between the browser, the Next.js server, and the provider.
- Stellar transactions are signed by the user's Freighter wallet. The private key never leaves the user's device.
- OAuth and API credentials are stored in Vercel environment variables, encrypted at rest and injected only at runtime.

The gap to watch: if a future version stores user-linked data — for example, mapping a PDAX account ID to a Stellar address — that record would need a database with encryption at rest. The current architecture avoids this by storing nothing.

---

### Database

Sobre has no backend database. All state — balances, members, transaction history, spending policy — lives in Soroban contract storage on Stellar. The app reads it via `simulateTransaction` on the RPC endpoint.

For this integration that means:

- Order IDs and transaction IDs are not persisted server-side. They live in the browser session during the cashout or deposit flow.
- If a user closes the tab mid-transaction, they need to check their PDAX account or MoneyGram receipt directly to confirm the status.
- The blockchain event log is the only audit trail. There is no server-side record of who initiated what.

If persistence becomes necessary — to resume interrupted flows or link provider accounts to Stellar addresses — a database with encryption at rest would need to be introduced at that point.

---

### Documentation

Each proxy route is the single source of truth for how Sobre calls that provider:

- `web/src/app/api/moneygram/route.ts` — OAuth token fetch, SEP-10 challenge, SEP-24 deposit initiation, transaction polling
- `web/src/app/api/pdax/route.ts` — quote fetch, order creation, order polling, withdrawal

---

## Getting access

### MoneyGram

1. Submit a KYB application at `https://business.moneygram.com`
2. Email `[email protected]` to request wallet domain allowlisting — include the Sobre app URL and a description of the integration
3. Once approved, credentials are issued through the developer portal at `https://developer.moneygram.com`
4. Sandbox environment available immediately after credentials are issued; production requires passing their certification test cases

### PDAX

Start at `https://developer.pdax.ph` or email `developers@pdax.ph`.

The Sobre demo day was held at the PDAX Office in Manila. That existing contact is the most direct path — send this document and ask for sandbox API credentials.
