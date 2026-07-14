import type { Metadata } from "next";
import { Fraunces, Geist_Mono, Inter, Manrope } from "next/font/google";
import "./globals.css";

import { EnvelopeTransition } from "@/components/sobre/EnvelopeTransition";
import { LOGO_SRC } from "@/lib/config";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

// v2 design system (dashboard): Manrope for display headings, Geist Mono for
// amounts. Loaded globally but only referenced inside `.sobre-v2` scopes.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const SITE = "https://sobre-mocha.vercel.app";
const TITLE = "Sobre";
const DESC =
  "Remittances auto-split into named envelopes the moment they land. Both members see the same balances in real time, on Stellar.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESC,
  icons: [{ rel: "icon", url: LOGO_SRC }],
  openGraph: {
    title: TITLE,
    description: DESC,
    url: SITE,
    siteName: "Sobre",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESC,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${fraunces.variable} ${manrope.variable} ${geistMono.variable} sobre-v2 h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <EnvelopeTransition />
      </body>
    </html>
  );
}
