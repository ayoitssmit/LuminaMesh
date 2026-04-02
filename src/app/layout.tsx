import type { Metadata } from "next";
import { Geist, Geist_Mono, Chakra_Petch } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const chakraPetch = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://luminamesh.vercel.app"),
  title: "LuminaMesh — Peer-to-Peer File Sharing",
  description: "Share files directly between browsers through an encrypted WebRTC mesh network. No server uploads, no size limits, zero persistence.",
  icons: {
    icon: "/lmlogo.png",
    shortcut: "/lmlogo.png",
    apple: "/lmlogo.png",
    other: [
      {
        rel: 'icon',
        type: 'image/png',
        url: '/lmlogo.png',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/lmlogo.png" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${chakraPetch.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
