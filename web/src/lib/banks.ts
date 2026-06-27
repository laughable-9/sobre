/**
 * PDAX UAT supports two PHP banks today: Security Bank (BASECPH) and CTBC
 * (BACTBPH). The cashout pickers (member + sub-account) and the activity
 * feed's "Sent to <bank>" copy all read from this single source — when
 * PDAX adds a bank, this is the one site to edit.
 *
 * Mainnet's PDAX may admit more banks; the wider list goes here.
 */
export const BANKS = [
  { code: "BASECPH", name: "Security Bank" },
  { code: "BACTBPH", name: "CTBC Bank" },
] as const;

export type BankCode = (typeof BANKS)[number]["code"];

/** Map a bank code to its display name. Falls back to the code itself when
 *  it isn't one of the known codes (e.g. the row carries a legacy entry). */
export function bankName(code: string): string {
  return BANKS.find((b) => b.code === code)?.name ?? code;
}
