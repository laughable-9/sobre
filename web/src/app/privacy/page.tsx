import Link from "next/link";
import type { Metadata } from "next";

import { LandingHeader } from "@/components/sobre/LandingHeader";

export const metadata: Metadata = {
  title: "Privacy Policy — Sobre",
  description:
    "What data Sobre collects, why, and who we share it with. Plain English.",
};

export default function PrivacyPage() {
  return (
    <>
      <LandingHeader />

      <main className="sobre-privacy">
        <div className="sobre-privacy-inner">
          <h1 className="sobre-h1">Privacy Policy</h1>
          <p className="sobre-privacy-updated">Last updated: July 14, 2026</p>

          <p className="sobre-lede sobre-privacy-lede">
            Sobre is a shared family wallet built on the Stellar blockchain.
            This page explains what data we collect, why, and who we share it
            with. Plain English, no legal fluff.
          </p>

          <h2>Who we are</h2>
          <p>
            Sobre is a hackathon-stage project built for the Rise In × Stellar
            APAC Hackathon (Philippines track, 2026). We do not yet operate as
            a licensed commercial financial service. Questions or requests
            about your data can go to{" "}
            <a href="mailto:clarencekyl3@gmail.com">clarencekyl3@gmail.com</a>.
          </p>

          <h2>What we collect</h2>

          <h3>From Google, when you sign in</h3>
          <ul>
            <li>Your name, as it appears on your Google account</li>
            <li>Your email address</li>
            <li>A Google-issued account ID (used to link you back on return visits)</li>
          </ul>

          <h3>From your device, when you set up your wallet</h3>
          <ul>
            <li>
              A <strong>passkey credential ID</strong> — a reference to a
              signing key stored on your device. The private key itself never
              leaves your device; we only see the public ID.
            </li>
            <li>
              Your <strong>Stellar wallet address</strong> — the on-chain smart
              contract that holds your envelopes.
            </li>
          </ul>

          <h3>When you deposit money (via PDAX)</h3>
          <ul>
            <li>The amount, in PHP and USDC</li>
            <li>The deposit status (pending, confirmed, failed)</li>
            <li>Stellar transaction hashes for the deposit and the auto-split</li>
          </ul>

          <h3>When you cash out (via PDAX)</h3>
          <ul>
            <li>The amount and which envelope it came from</li>
            <li>
              The beneficiary bank code, account name, and account number for
              the payout
            </li>
            <li>Transaction hashes for the withdrawal and the bank transfer</li>
          </ul>

          <h3>When you log an expense</h3>
          <ul>
            <li>A short note describing the expense (up to 200 characters)</li>
            <li>Optional: amount, vendor, category, receipt image, timestamp</li>
          </ul>

          <h3>What we don&apos;t collect</h3>
          <ul>
            <li>Analytics or behavior tracking (no PostHog, Mixpanel, or session recording)</li>
            <li>Location data</li>
            <li>Your contacts</li>
            <li>Anything from third-party services beyond what&apos;s listed above</li>
          </ul>

          <h2>Where the data lives</h2>
          <ul>
            <li>
              <strong>Account fields, wallet metadata, deposit and cash-out
              records, expense logs</strong> — stored in a Supabase-hosted
              PostgreSQL database.
            </li>
            <li>
              <strong>Your passkey private key</strong> — stays on your device
              (iCloud Keychain, Google Password Manager, or the device&apos;s
              secure enclave). We never see it and cannot recover it.
            </li>
            <li>
              <strong>On-chain data</strong> (wallet address, balances,
              transfers, envelope splits) — recorded on the public Stellar
              blockchain. Anyone can look up transactions on a Stellar explorer;
              they&apos;re pseudonymous (linked to your wallet address, not
              your name), which is how blockchains work.
            </li>
          </ul>

          <h2>Who we share it with</h2>
          <ul>
            <li>
              <strong>PDAX</strong> — when you deposit or cash out, we send
              PDAX the amount, your wallet address, and (for cash-outs) your
              beneficiary bank details, so they can move fiat pesos on your
              behalf. PDAX has its own privacy policy.
            </li>
            <li>
              <strong>MoneyGram</strong> (roadmap) — same shape as PDAX, for
              international cash pickups.
            </li>
            <li>
              <strong>Google</strong> — sign-in flows through Google OAuth. We
              receive your profile fields from them; they see that you used
              Google to sign in to Sobre.
            </li>
            <li>
              <strong>Supabase</strong> — hosts our database and handles auth
              sessions. They process data on our behalf.
            </li>
            <li>
              <strong>The Stellar network</strong> — on-chain transaction data
              is public by design and validated by network nodes worldwide.
            </li>
          </ul>
          <p>We don&apos;t sell your data. We don&apos;t share it with advertisers.</p>

          <h2>How long we keep it</h2>
          <p>
            We keep your account and transaction history for as long as your
            wallet is active. If you want it deleted, email the address above:
            we can remove your Supabase records, which erases the joint-wallet
            metadata and expense logs. On-chain transactions on Stellar cannot
            be erased — that&apos;s true of every public blockchain.
          </p>

          <h2>Your rights</h2>
          <ul>
            <li>Sign out at any time from the wallet menu.</li>
            <li>Ask us to delete your Supabase records (email above).</li>
            <li>Ask us what we&apos;ve stored about you (email above).</li>
          </ul>
          <p>
            Because Sobre is a hackathon project and not yet a licensed
            financial institution, we don&apos;t offer the formal data-subject
            workflows of a regulated bank. If Sobre becomes a commercial
            service, this page will be updated to reflect the applicable
            regulations (the Philippines Data Privacy Act of 2012, and other
            frameworks that apply where you live).
          </p>

          <h2>Children</h2>
          <p>
            Sobre is designed for adult members of a family household. Please
            do not use it if you are under 18.
          </p>

          <h2>Changes to this page</h2>
          <p>
            If we make changes, we&apos;ll update the &quot;Last updated&quot;
            date at the top. Material changes will be flagged in the app.
          </p>

          <p className="sobre-privacy-back">
            <Link href="/">← Back to home</Link>
          </p>
        </div>
      </main>
    </>
  );
}
