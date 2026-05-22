import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

import { PhpRateBoot } from "@/lib/usePhpPerXlm";

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

const SITE = "https://sobre-mocha.vercel.app";
const TITLE = "Sobre — joint wallets for OFW families";
const DESC =
  "Remittances auto-split into named envelopes the moment they land. Both members see the same balances in real time, on Stellar.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESC,
  icons: [{ rel: "icon", url: "/sobre-logo2.svg" }],
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
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PhpRateBoot />
        {children}
      </body>
    </html>
  );
}
