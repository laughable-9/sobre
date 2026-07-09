"use client";

import { useMemo, useState } from "react";
import { CheckIcon, ClockIcon, XIcon } from "@phosphor-icons/react";

import type { SplitProposal } from "@/hooks/useSplitProposals";
import {
  useCancelSplitProposal,
  useVoteSplitProposal,
} from "@/hooks/useSplitProposalMutations";
import { Avatar } from "@/components/sobre/Avatar";
import { relativeTime, shortenAddress } from "@/lib/format";

/**
 * The proposal-review card that renders above <EnvelopeSplitForm> in
 * Settings when a family has a live pending proposal. The card knows the
 * viewer's identity so it can pick the right action set — proposer sees
 * "Cancel", other admins see "Approve / Reject", both roles converge on
 * a "Waiting on N of M admins" status line while the vote lands.
 */
export function SplitProposalCard({
  proposal,
  currentPercents,
  currentWalletId,
  envelopeNames,
  adminCount,
  onResolved,
}: {
  proposal: SplitProposal;
  currentPercents: [number, number, number];
  /** family_members.wallet_id of the caller so we can pick their vote
   *  state without re-fetching. Null while the wallet row is loading. */
  currentWalletId: string | null;
  envelopeNames: string[];
  /** Live admin count from useWalletState.state.admin_count. Feeds the
   *  "N of M" status line. */
  adminCount: number;
  /** Called when the vote resolves (approved / rejected / cancelled) so
   *  the parent can toast + trigger a wallet-state refresh. */
  onResolved: (kind: "approved" | "rejected" | "cancelled") => void;
}) {
  const { vote, pending: voting } = useVoteSplitProposal();
  const { cancel, pending: cancelling } = useCancelSplitProposal();
  const [error, setError] = useState<string | null>(null);

  const isProposer =
    currentWalletId !== null && currentWalletId === proposal.proposerWalletId;
  const hasVoted =
    currentWalletId !== null &&
    (proposal.approversWalletIds.includes(currentWalletId) ||
      proposal.rejectersWalletIds.includes(currentWalletId));

  const approvals = proposal.approversWalletIds.length;
  const busy = voting || cancelling;

  const proposerLabel = useMemo(() => {
    if (proposal.proposerName) return proposal.proposerName;
    if (proposal.proposerAddress)
      return shortenAddress(proposal.proposerAddress);
    return "An admin";
  }, [proposal.proposerName, proposal.proposerAddress]);

  const handleVote = async (choice: "approve" | "reject") => {
    setError(null);
    try {
      const result = await vote(proposal.id, choice);
      if (result.outcome === "approved") onResolved("approved");
      else if (result.outcome === "rejected") onResolved("rejected");
      else if (result.outcome === "expired")
        setError("Proposal expired. Ask the proposer to submit again.");
      else if (result.outcome === "already_resolved")
        setError(`Already ${result.status}. Refresh to see the latest.`);
      else if (result.outcome === "not_admin")
        setError("Only admins can vote on split proposals.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCancel = async () => {
    setError(null);
    try {
      const result = await cancel(proposal.id);
      if (result.outcome === "cancelled") onResolved("cancelled");
      else if (result.outcome === "not_proposer")
        setError("Only the proposer can cancel this.");
      else if (result.outcome === "already_resolved")
        setError(`Already ${result.status}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="sobre-proposal" aria-label="Split proposal">
      <div className="head">
        <Avatar
          src={proposal.proposerAvatarUrl}
          name={proposerLabel}
          size={40}
        />
        <div className="who">
          <div className="title">
            {isProposer ? "You" : proposerLabel} proposed a split change
          </div>
          <div className="meta">
            <ClockIcon size={11} weight="regular" />
            <span>Proposed {relativeTime(proposal.createdAt)}</span>
          </div>
        </div>
      </div>

      <div className="diff">
        <PercentColumn label="Current" percents={currentPercents} names={envelopeNames} muted />
        <span className="arrow" aria-hidden>→</span>
        <PercentColumn label="Proposed" percents={proposal.percents} names={envelopeNames} />
      </div>

      <div className="status">
        Waiting on <b>{approvals}</b> of <b>{adminCount}</b> admin
        {adminCount === 1 ? "" : "s"}
        {hasVoted ? " · You voted approve" : ""}
      </div>

      {error ? <div className="err">{error}</div> : null}

      <div className="actions">
        {isProposer ? (
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={busy}
            className="sobre-btn sobre-btn-soft"
          >
            <XIcon size={14} weight="bold" />
            {cancelling ? "Cancelling…" : "Cancel proposal"}
          </button>
        ) : hasVoted ? (
          <div className="voted">
            <CheckIcon size={14} weight="bold" /> Waiting on the other admin
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleVote("reject")}
              disabled={busy}
              className="sobre-btn sobre-btn-soft danger"
            >
              <XIcon size={14} weight="bold" />
              Reject
            </button>
            <button
              type="button"
              onClick={() => void handleVote("approve")}
              disabled={busy}
              className="sobre-btn sobre-btn-primary"
            >
              <CheckIcon size={14} weight="bold" />
              {voting ? "Approving…" : "Approve change"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function PercentColumn({
  label,
  percents,
  names,
  muted,
}: {
  label: string;
  percents: [number, number, number];
  names: string[];
  muted?: boolean;
}) {
  return (
    <div className={`col${muted ? " muted" : ""}`}>
      <div className="col-label">{label}</div>
      <div className="rows">
        {percents.map((p, i) => (
          <div key={i} className="row">
            <span className="name">{names[i]}</span>
            <span className="pct tabular">{p}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
