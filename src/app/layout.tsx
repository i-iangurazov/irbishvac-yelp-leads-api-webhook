import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yelp Leads Integration",
  description: "Production-ready Next.js backend for Yelp Leads webhooks and OAuth.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
