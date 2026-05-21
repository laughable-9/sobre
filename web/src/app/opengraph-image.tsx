import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Sobre — joint wallets for OFW families";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CREAM = "#FDFAF3";
const MANGO = "#E8923C";
const PALM = "#2E6B4C";
const INK = "#1F1B16";
const INK_2 = "#5B544A";

/** Renders the share-preview card at request time. Same brand tokens as the
 *  landing page so the OG card and the live site feel like the same product. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 88px",
          background: CREAM,
          fontFamily: "Inter, sans-serif",
        }}
      >
        {/* Top row: logo + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#fff",
              border: "2px solid #efe7d4",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 42,
            }}
          >
            ✉️
          </div>
          <div
            style={{
              fontFamily: "serif",
              fontSize: 56,
              fontWeight: 700,
              color: INK,
              letterSpacing: "-0.02em",
            }}
          >
            Sobre
          </div>
        </div>

        {/* Headline + tagline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontFamily: "serif",
              fontSize: 76,
              fontWeight: 600,
              color: INK,
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
              maxWidth: 1024,
            }}
          >
            A joint account for families living worlds apart.
          </div>
          <div
            style={{
              fontSize: 28,
              color: INK_2,
              lineHeight: 1.35,
              maxWidth: 980,
            }}
          >
            Remittances auto-split into named envelopes the moment they
            land. Both members see the same balances in real time, on Stellar.
          </div>
        </div>

        {/* Bottom row: envelope chips + Stellar tag */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", gap: 14 }}>
            <Chip label="Groceries" pct="50%" color={MANGO} />
            <Chip label="Tuition" pct="30%" color={INK} />
            <Chip label="Savings" pct="20%" color={PALM} />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 22,
              fontWeight: 600,
              color: INK_2,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: MANGO,
              }}
            />
            Built on Stellar
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

function Chip({
  label,
  pct,
  color,
}: {
  label: string;
  pct: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "16px 22px",
        background: "#fff",
        border: "2px solid #efe7d4",
        borderRadius: 16,
      }}
    >
      <div style={{ fontSize: 16, color: INK_2, fontWeight: 500 }}>{label}</div>
      <div
        style={{
          fontFamily: "serif",
          fontSize: 32,
          fontWeight: 700,
          color,
          letterSpacing: "-0.02em",
        }}
      >
        {pct}
      </div>
    </div>
  );
}
