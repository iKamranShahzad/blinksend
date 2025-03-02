import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

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
      <body>
        {children}
        <Toaster
          position="bottom-center"
          richColors
          toastOptions={{
            style: {
              background: "var(--background, #ffffff)",
              color: "var(--foreground, #000000)",
              border: "1px solid var(--border, #e2e8f0)",
              padding: "16px",
              borderRadius: "12px",
              boxShadow:
                "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
              fontWeight: 500,
            },
            className: "dark:bg-zinc-800 dark:border-zinc-700 dark:text-white",
          }}
        />
      </body>
    </html>
  );
}
