import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const alt = "Sobre — one Sobre, no matter the distance.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CREAM = "#FDFAF3";
const MANGO = "#E8923C";
const INK = "#1F1B16";

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
 *  cream / mango palette as the live site. */
export default async function OpengraphImage() {
  // Defensive: the logo + Google Fonts fetches both have failure modes that
  // would otherwise 500 the whole route (and on dev that surfaces as the
  // landing page erroring out too). Fall back to a logo-less + system-font
  // render if either source is unavailable.
  let logoSrc: string | null = null;
  try {
    const logo = readFileSync(
      join(process.cwd(), "public", "sobre-logo2.svg"),
    ).toString("base64");
    logoSrc = `data:image/svg+xml;base64,${logo}`;
  } catch {
    logoSrc = null;
  }

  let fonts: { name: string; data: ArrayBuffer; style: "normal" | "italic"; weight: 600 }[] = [];
  try {
    const [[serifBold], [serifItalic]] = await Promise.all([
      googleFonts(
        "https://fonts.googleapis.com/css2?family=Fraunces:wght@600&display=swap",
      ),
      googleFonts(
        "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&display=swap",
      ),
    ]);
    fonts = [
      { name: "Fraunces", data: serifBold, style: "normal", weight: 600 },
      { name: "FrauncesItalic", data: serifItalic, style: "italic", weight: 600 },
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
          background: CREAM,
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
              fontFamily: "Fraunces",
              fontSize: 78,
              fontWeight: 600,
              color: INK,
              lineHeight: 1.04,
              letterSpacing: "-0.025em",
            }}
          >
            One Sobre.
          </div>
          <div
            style={{
              fontFamily: "Fraunces",
              fontSize: 78,
              fontWeight: 600,
              color: INK,
              lineHeight: 1.04,
              letterSpacing: "-0.025em",
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            <span>No matter the&nbsp;</span>
            <span
              style={{
                fontFamily: "FrauncesItalic",
                fontStyle: "italic",
                color: MANGO,
              }}
            >
              distance
            </span>
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
