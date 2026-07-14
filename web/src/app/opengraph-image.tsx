import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LOGO_FILENAME } from "@/lib/config";

export const alt = "Sobre — one Sobre, no matter the distance.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#FFFFFF";
const GREEN = "#22A45C";
const INK = "#0F1A14";

async function googleFonts(cssUrl: string): Promise<ArrayBuffer[]> {
  const css = await fetch(cssUrl, {
    headers: { "User-Agent": "Mozilla/5.0 Sobre/og" },
  }).then((r) => r.text());
  const urls = [...css.matchAll(/url\((https:\/\/[^)]+)\) format/g)].map(
    (m) => m[1],
  );
  return Promise.all(
    urls.map((u) => fetch(u).then((r) => r.arrayBuffer())),
  );
}

/** Landing-hero headline + Sobre logo as a 1200x630 share preview. Same
 *  pure-white + Green 600 palette + Manrope display as the live v2 site. */
export default async function OpengraphImage() {
  // Defensive: the logo + Google Fonts fetches both have failure modes that
  // would otherwise 500 the whole route (and on dev that surfaces as the
  // landing page erroring out too). Fall back to a logo-less + system-font
  // render if either source is unavailable.
  let logoSrc: string | null = null;
  try {
    const logo = readFileSync(
      join(process.cwd(), "public", LOGO_FILENAME),
    ).toString("base64");
    logoSrc = `data:image/svg+xml;base64,${logo}`;
  } catch {
    logoSrc = null;
  }

  let fonts: { name: string; data: ArrayBuffer; style: "normal"; weight: 700 }[] = [];
  try {
    const [manropeBold] = await googleFonts(
      "https://fonts.googleapis.com/css2?family=Manrope:wght@700&display=swap",
    );
    fonts = [
      { name: "Manrope", data: manropeBold, style: "normal", weight: 700 },
    ];
  } catch {
    fonts = [];
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BG,
          padding: "70px 80px",
          alignItems: "center",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            paddingRight: 24,
          }}
        >
          <div
            style={{
              fontFamily: "Manrope",
              fontSize: 78,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.04,
              letterSpacing: "-0.025em",
            }}
          >
            One Sobre.
          </div>
          <div
            style={{
              fontFamily: "Manrope",
              fontSize: 78,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.04,
              letterSpacing: "-0.025em",
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            <span>No matter the&nbsp;</span>
            <span style={{ color: GREEN }}>distance</span>
            <span>.</span>
          </div>
        </div>

        {logoSrc ? (
          <div
            style={{
              width: 380,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            { }
            <img
              src={logoSrc}
              alt=""
              width={360}
              height={360}
              style={{ objectFit: "contain" }}
            />
          </div>
        ) : null}
      </div>
    ),
    { ...size, fonts: fonts.length > 0 ? fonts : undefined },
  );
}
