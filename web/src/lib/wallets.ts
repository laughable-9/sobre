"use client";

import type { Session } from "@supabase/supabase-js";

import { connect, signup } from "@/lib/passkey";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Google display name → email → "Sobre" fallback chain. Used both in the
 *  passkey prompt (the name the user sees there) and in dashboard UI. */
export function displayNameFromSession(session: Session): string {
  return (
    session.user.user_metadata?.full_name ?? session.user.email ?? "Sobre"
  );
}

/**
 * Bridge between Google identity (Supabase auth.users) and the passkey-backed
 * smart wallet on Stellar. Either reads the existing wallet for this signed-in
 * user, or — on first sign-in — fires passkey registration, deploys a new
 * smart-wallet contract, and writes the link to the wallets table.
 *
 * Call only after `supabase.auth.getSession()` returns non-null; this assumes
 * a signed-in Supabase user.
 */

export interface WalletRow {
  id: string;
  auth_id: string;
  contract_id: string;
  credential_id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
}

export interface FindOrCreateResult {
  wallet: WalletRow;
  /** `true` when this call deployed a new smart wallet; `false` for an
   *  existing-wallet reconnect. Useful for one-time onboarding UI. */
  wasCreated: boolean;
}

export async function findOrCreateWallet(
  authUserId: string,
  displayName: string,
  email: string,
): Promise<FindOrCreateResult> {
  const supabase = getSupabaseBrowserClient();

  const { data: existing, error: lookupErr } = await supabase
    .from("wallets")
    .select("*")
    .eq("auth_id", authUserId)
    .maybeSingle();

  if (lookupErr) {
    throw new Error(`wallet lookup failed: ${lookupErr.message}`);
  }

  if (existing) {
    const row = existing as WalletRow;
    // Returning user — re-attach to the existing wallet so subsequent signs
    // route to the right contract. Pass the stored credential_id +
    // contract_id to skip the WebAuthn selection prompt.
    await connect({
      keyIdBase64: row.credential_id,
      contractId: row.contract_id,
    });
    return { wallet: row, wasCreated: false };
  }

  // First visit — fire WebAuthn registration and deploy the smart wallet.
  // signup() throws on submission failure, so reaching the next line means
  // the deploy is confirmed on chain.
  const signupResult = await signup(email || displayName);

  const { data: inserted, error: insertErr } = await supabase
    .from("wallets")
    .insert({
      auth_id: authUserId,
      contract_id: signupResult.contractId,
      credential_id: signupResult.keyIdBase64,
      display_name: displayName,
      email,
    })
    .select()
    .single();

  if (insertErr) {
    // Common cause: RLS policy blocks the insert. Re-check that
    // `auth.uid() = auth_id` evaluates true (session is live).
    throw new Error(`wallet insert failed: ${insertErr.message}`);
  }

  return { wallet: inserted as WalletRow, wasCreated: true };
}
