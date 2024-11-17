import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blinksend | Instant File Sharing",
  description: "Blinksend is a simple and secure way to share files instantly.",
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
