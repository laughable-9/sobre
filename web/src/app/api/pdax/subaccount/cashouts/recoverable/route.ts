/**
 * GET /api/pdax/subaccount/cashouts/recoverable?contract_id=<C>
 *
 * Sub-account variant of /api/pdax/withdrawals/recoverable. Same idea:
 * find `pdax_withdrawals` rows the sub-account holder signed the spend
 * for on chain but whose SAC transfer to the relay didn't land — leaving
 * the row stuck at `status='pending'` with no `spend_tx_hash`.
 *
 * Auth: the caller must be a family member of the row's family (their
 * own auth) AND the row's `subaccount_id` must be one whose
 * `wallet_id` equals the caller's memberId. Sub-account holders can
 * ONLY recover their own cashouts; parents can't reach through this
 * endpoint to a kid's stranded row.
 *
 * localStorage stays the primary recovery signal; this exists so
 * cross-tab / cross-device (new phone, cleared storage) can still find
 * the stranded row.
 */

import { NextResponse } from "next/server";
import { Address, rpc, scValToNative } from "@stellar/stellar-sdk";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { NETWORK, STROOPS_PER_TOKEN } from "@/lib/config";
import { enforceDailyLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Memo the sub-account cashout leg writes on the on-chain
 *  `withdraw_subaccount` call. Matches SUBACCOUNT_CASHOUT_MEMO in
 *  useCashoutSignatures. */
const SUBACCOUNT_CASHOUT_MEMO = "Cash out";
/** Match `EVENT_LOOKBACK_LEDGERS` in the member recoverable route.
 *  ~7 hours on testnet, more than covers a realistic recovery window. */
const EVENT_LOOKBACK_LEDGERS = 5_000;
const MAX_EVENT_PAGES = 20;

interface RecoverableSubaccountCashout {
  identifier: string;
  subaccountId: string;
  amountStroops: string;
  amountPhp: number;
  amountToken: number;
  beneficiary_bank_code: string;
  beneficiary_account_name: string;
  beneficiary_account_number: string;
  spendTxHash: string;
  created_at: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contract_id");
  if (!contractId) {
    return NextResponse.json(
      { error: "Missing contract_id query param" },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const { data: familyRow } = await admin
    .from("family_wallets")
    .select("id")
    .eq("contract_id", contractId)
    .single();
  if (!familyRow) {
    return NextResponse.json(
      { error: "Family wallet not found for this contract" },
      { status: 404 },
    );
  }
  const familyWalletId = (familyRow as { id: string }).id;

  const ctx = await requireFamilyMember(familyWalletId);
  if (ctx instanceof NextResponse) return ctx;
  const { memberId } = ctx;

  const rate = await enforceDailyLimit({
    endpoint: "pdax_subaccount_cashouts_recoverable",
    walletId: memberId,
    familyWalletId,
    callerEmail: ctx.email,
    perUser: 15000,
    perFamily: 30000,
  });
  if (rate) return rate;

  // Sub-account holder's smart-wallet contract address — the event
  // caller topic matches this. The auth memberId belongs to a
  // wallets row; contract_id is the sub-account's own smart wallet.
  const { data: wallet } = await admin
    .from("wallets")
    .select("contract_id")
    .eq("id", memberId)
    .single();
  if (!wallet) {
    return NextResponse.json({ recoverable: [] });
  }
  const callerC = (wallet as { contract_id: string }).contract_id;

  // Sub-account rows have envelope IS NULL and subaccount_id NOT NULL.
  // Scope to the current caller as sub-account holder — a parent's
  // memberId won't match any subaccount_id's wallet_id, so the join
  // filters them out naturally.
  const { data: pendings } = await admin
    .from("pdax_withdrawals")
    .select(
      "identifier, subaccount_id, amount_usdc, amount_php, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, spend_tx_hash, created_at, family_subaccounts!inner(wallet_id)",
    )
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .is("envelope", null)
    .not("subaccount_id", "is", null)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (!pendings || pendings.length === 0) {
    return NextResponse.json({ recoverable: [] });
  }

  const server = new rpc.Server(NETWORK.rpcUrl);
  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    startLedger = Math.max(latest.sequence - EVENT_LOOKBACK_LEDGERS, 1);
  } catch {
    return NextResponse.json({ recoverable: [] });
  }

  type ParsedSubWithdraw = {
    txHash: string;
    caller: string;
    amount: bigint;
    memo: string;
    ledgerClosedAt: string;
  };
  const events: ParsedSubWithdraw[] = [];
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_EVENT_PAGES; page++) {
      const raw = await server.getEvents({
        filters: [{ type: "contract", contractIds: [contractId] }],
        ...(cursor ? { cursor } : { startLedger }),
      });
      for (const ev of raw.events) {
        const topics = ev.topic.map((t) => scValToNative(t));
        // Contract emits topic[0] as snake_case "sub_account_withdraw"
        // (see useTxFeed:638). Match case-insensitively to survive any
        // future casing tweaks.
        if (String(topics[0] ?? "").toLowerCase() !== "sub_account_withdraw")
          continue;
        const data = scValToNative(ev.value) as Record<string, unknown>;
        const memo = String(data.memo ?? "");
        if (memo !== SUBACCOUNT_CASHOUT_MEMO) continue;
        events.push({
          txHash: ev.txHash,
          caller: String(topics[1]),
          amount: data.amount as bigint,
          memo,
          ledgerClosedAt: ev.ledgerClosedAt,
        });
      }
      if (raw.events.length < 25) break;
      cursor = raw.cursor;
      if (!cursor) break;
    }
  } catch {
    return NextResponse.json({ recoverable: [] });
  }

  const usedHashes = new Set<string>();
  const recoverable: RecoverableSubaccountCashout[] = [];
  for (const row of pendings as Array<{
    identifier: string;
    subaccount_id: string;
    amount_usdc: number;
    amount_php: number | null;
    beneficiary_bank_code: string;
    beneficiary_account_name: string;
    beneficiary_account_number: string;
    spend_tx_hash: string | null;
    created_at: string;
  }>) {
    if (row.spend_tx_hash) continue;
    const expectedStroops = BigInt(
      Math.round(row.amount_usdc * STROOPS_PER_TOKEN),
    );
    const rowSince = new Date(row.created_at).getTime();
    const callerScVal = Address.fromString(callerC).toString();
    const match = events.find(
      (e) =>
        !usedHashes.has(e.txHash) &&
        e.caller === callerScVal &&
        e.amount === expectedStroops &&
        new Date(e.ledgerClosedAt).getTime() >= rowSince - 60_000,
    );
    if (!match) continue;
    usedHashes.add(match.txHash);
    recoverable.push({
      identifier: row.identifier,
      subaccountId: row.subaccount_id,
      amountStroops: expectedStroops.toString(),
      amountPhp: row.amount_php ?? 0,
      amountToken: row.amount_usdc,
      beneficiary_bank_code: row.beneficiary_bank_code,
      beneficiary_account_name: row.beneficiary_account_name,
      beneficiary_account_number: row.beneficiary_account_number,
      spendTxHash: match.txHash,
      created_at: row.created_at,
    });
  }

  return NextResponse.json({ recoverable });
}
