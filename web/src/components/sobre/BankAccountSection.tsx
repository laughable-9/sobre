"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, Building, Pencil } from "lucide-react";

import { BANKS } from "@/lib/banks";
import { maskAccountNumber } from "@/lib/format";

interface BankRecord {
  bank_code: string;
  account_name: string;
  account_number: string;
}

/**
 * Settings-tab bank management. Same `/api/member/bank` endpoint the
 * PdaxWithdrawModal's inline RegisterBankStep hits — the only difference
 * is the entry point: cashout mid-flight vs. a standalone Settings row
 * the user can update whenever. Members and sub-account holders both
 * consume this via their respective Profile tabs.
 *
 * A single member has one beneficiary bank on file. Editing replaces
 * (upsert), so no history is kept in the UI. If we ever need multi-bank
 * support the schema is already one-per-member so it'd be a broader
 * refactor than a UI toggle.
 */
export function BankAccountSection() {
  const [bank, setBank] = useState<BankRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/member/bank");
      const j = (await r.json()) as { bank: BankRecord | null };
      setBank(j.bank);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const bankName = bank
    ? (BANKS.find((b) => b.code === bank.bank_code)?.name ?? bank.bank_code)
    : null;

  return (
    <section className="sobre-envs-section" aria-label="Bank account">
      <div className="sobre-envs-section-head">
        <h3>Bank account</h3>
        {bank && !editing ? (
          <button
            type="button"
            className="sobre-envs-section-action"
            onClick={() => setEditing(true)}
          >
            Change
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="sobre-card-flat" style={{ padding: 14 }}>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>Loading…</div>
        </div>
      ) : editing ? (
        <BankAccountForm
          initial={bank ?? undefined}
          onCancel={bank ? () => setEditing(false) : undefined}
          onSaved={(b) => {
            setBank(b);
            setEditing(false);
          }}
        />
      ) : bank ? (
        <div
          className="sobre-card-flat"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 14,
          }}
        >
          <div
            className="grid place-items-center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--accent-soft)",
              color: "var(--sobre-accent)",
              flexShrink: 0,
            }}
          >
            <ArrowDownToLine size={18} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {bank.account_name}
            </div>
            <div
              className="tabular"
              style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}
            >
              {bankName} · {maskAccountNumber(bank.account_number)}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="sobre-card-flat"
          style={{ padding: 14, display: "grid", gap: 10 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Building
              size={18}
              strokeWidth={2}
              style={{ color: "var(--text-3)" }}
            />
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
              No bank account on file. Cashouts land here.
            </span>
          </div>
          <button
            type="button"
            className="sobre-btn sobre-btn-primary"
            onClick={() => setEditing(true)}
            style={{ padding: "10px 14px", fontSize: 13 }}
          >
            <Pencil size={12} strokeWidth={2.4} />
            Add bank
          </button>
        </div>
      )}

      {error ? (
        <p
          className="text-xs mt-2"
          style={{ color: "var(--sobre-danger)" }}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function BankAccountForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: BankRecord;
  onSaved: (b: BankRecord) => void;
  onCancel?: () => void;
}) {
  const [bankCode, setBankCode] = useState<string>(
    initial?.bank_code ?? BANKS[0].code,
  );
  const [accountName, setAccountName] = useState(initial?.account_name ?? "");
  const [accountNumber, setAccountNumber] = useState(
    initial?.account_number ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid =
    accountName.trim().length > 0 && accountNumber.trim().length > 0;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/member/bank", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bank_code: bankCode,
          account_name: accountName.trim(),
          account_number: accountNumber.trim(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onSaved({
        bank_code: bankCode,
        account_name: accountName.trim(),
        account_number: accountNumber.trim(),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sobre-card-flat" style={{ padding: 14 }}>
      <div className="sobre-input-group">
        <label>Bank</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {BANKS.map((b) => {
            const active = b.code === bankCode;
            return (
              <button
                key={b.code}
                type="button"
                onClick={() => setBankCode(b.code)}
                disabled={saving}
                className="p-3 rounded-[10px] text-left"
                style={{
                  border: active
                    ? "1.5px solid var(--sobre-accent)"
                    : "1px solid var(--border)",
                  background: active
                    ? "var(--accent-soft)"
                    : "var(--surface-alt)",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                <div
                  className="text-[13px] font-medium"
                  style={{
                    color: active ? "var(--sobre-accent)" : "var(--text-1)",
                  }}
                >
                  {b.name}
                </div>
                <div
                  className="text-[11px] tabular mt-0.5"
                  style={{ color: "var(--text-3)" }}
                >
                  {b.code}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sobre-input-group">
        <label htmlFor="bank-acct-name">Account holder name</label>
        <input
          id="bank-acct-name"
          className="sobre-input"
          type="text"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          disabled={saving}
          maxLength={120}
        />
      </div>

      <div className="sobre-input-group">
        <label htmlFor="bank-acct-num">Account number</label>
        <input
          id="bank-acct-num"
          className="sobre-input tabular"
          type="text"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) =>
            setAccountNumber(e.target.value.replace(/[^0-9]/g, ""))
          }
          disabled={saving}
          maxLength={32}
        />
      </div>

      {err ? (
        <p
          className="text-xs break-all mb-3"
          style={{ color: "var(--sobre-danger)" }}
        >
          {err}
        </p>
      ) : null}

      <div
        className="sobre-modal-actions"
        style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
      >
        {onCancel ? (
          <button
            type="button"
            className="sobre-btn sobre-btn-soft"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="sobre-btn sobre-btn-primary"
          onClick={() => void handleSave()}
          disabled={!valid || saving}
          style={!valid || saving ? { opacity: 0.5 } : {}}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
