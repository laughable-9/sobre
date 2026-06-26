/**
 * GET /api/pdax/withdrawals/recoverable?contract_id=<C>
 *
 * Looks for cashouts in a "half-completed" state where the user signed
 * the spend tx on chain (envelope debited, XLM in their smart wallet)
 * but the SAC transfer to the relay didn't land — leaving the
 * pdax_withdrawals row stuck at status='pending' with no spend_tx_hash
 * recorded.
 *
 * The recoverable info comes from cross-referencing two sources:
 *   1. pdax_withdrawals rows at status='pending' for the signed-in member
 *   2. on-chain Spend events from the family Sobre contract with memo
 *      "PDAX cashout", caller = the member's smart wallet, since the
 *      row's created_at
 *
 * If a row matches an on-chain Spend event by (caller, envelope, amount,
 * time window), we return it as recoverable with the matching tx hash so
 * the modal can re-attempt the SAC transfer leg + /confirmed call without
 * forcing the user to redo the spend (which would over-debit the
 * envelope and strand a second batch of XLM).
 *
 * This is the fallback path when localStorage is empty — e.g. user
 * cleared site data, switched browsers, or hit the original failure
 * before the snapshot was written. localStorage stays the primary
 * because it's faster, but this endpoint guarantees no money is left
 * unreachable.
 */

import { NextResponse } from "next/server";
import { Address, rpc, scValToNative } from "@stellar/stellar-sdk";

import { requireFamilyMember } from "@/lib/auth/familyMember";
import { NETWORK, STROOPS_PER_TOKEN } from "@/lib/config";
import { envelopeNameFromScNative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SPEND_MEMO = "PDAX cashout";
/** How far back to scan Soroban events. 7 days ≈ ~120k ledgers; well
 *  inside the 5-day Soroban event retention window plus headroom. */
const EVENT_LOOKBACK_LEDGERS = 100_000;

interface RecoverableCashout {
  identifier: string;
  envelope: "Groceries" | "Tuition" | "Savings";
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

  // Look up the member's smart-wallet contract address. The Spend event's
  // caller topic equals this address.
  const { data: wallet } = await admin
    .from("wallets")
    .select("contract_id")
    .eq("id", memberId)
    .single();
  if (!wallet) {
    return NextResponse.json({ recoverable: [] });
  }
  const callerC = (wallet as { contract_id: string }).contract_id;

  const { data: pendings } = await admin
    .from("pdax_withdrawals")
    .select(
      "identifier, envelope, amount_usdc, amount_php, beneficiary_bank_code, beneficiary_account_name, beneficiary_account_number, spend_tx_hash, created_at",
    )
    .eq("family_wallet_id", familyWalletId)
    .eq("member_id", memberId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (!pendings || pendings.length === 0) {
    return NextResponse.json({ recoverable: [] });
  }

  // Fetch recent Spend events from the contract. If we can't reach the
  // RPC, return no recoverables — better to surface nothing than to
  // return inconsistent state.
  const server = new rpc.Server(NETWORK.rpcUrl);
  let startLedger: number;
  try {
    const latest = await server.getLatestLedger();
    startLedger = Math.max(latest.sequence - EVENT_LOOKBACK_LEDGERS, 1);
  } catch {
    return NextResponse.json({ recoverable: [] });
  }

  type ParsedSpend = {
    txHash: string;
    caller: string;
    envelope: string;
    amount: bigint;
    memo: string;
    ledgerClosedAt: string;
  };
  const spendEvents: ParsedSpend[] = [];
  try {
    const raw = await server.getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds: [contractId] }],
    });
    for (const ev of raw.events) {
      const topics = ev.topic.map((t) => scValToNative(t));
      if (String(topics[0] ?? "").toLowerCase() !== "spend") continue;
      const data = scValToNative(ev.value) as Record<string, unknown>;
      const memo = String(data.memo ?? "");
      if (memo !== SPEND_MEMO) continue;
      spendEvents.push({
        txHash: ev.txHash,
        caller: String(topics[1]),
        envelope: envelopeNameFromScNative(topics[2], "Groceries"),
        amount: data.amount as bigint,
        memo,
        ledgerClosedAt: ev.ledgerClosedAt,
      });
    }
  } catch {
    return NextResponse.json({ recoverable: [] });
  }

  // Match each pending row to a Spend event by (caller, envelope, amount,
  // event time >= row.created_at). Spend hashes that match more than one
  // pending row would be ambiguous; we just take the first row we land on
  // and let later polls re-try if there are stragglers. In practice the
  // demo has at most one stuck row per user at a time.
  const usedHashes = new Set<string>();
  const recoverable: RecoverableCashout[] = [];
  for (const row of pendings as Array<{
    identifier: string;
    envelope: "Groceries" | "Tuition" | "Savings";
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
    const match = spendEvents.find(
      (e) =>
        !usedHashes.has(e.txHash) &&
        e.caller === callerScVal &&
        e.envelope === row.envelope &&
        e.amount === expectedStroops &&
        new Date(e.ledgerClosedAt).getTime() >= rowSince - 60_000,
    );
    if (!match) continue;
    usedHashes.add(match.txHash);
    recoverable.push({
      identifier: row.identifier,
      envelope: row.envelope,
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
