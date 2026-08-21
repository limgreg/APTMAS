import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LanguageProvider } from "@/components/language-context";

export const metadata: Metadata = {
  title: {
    default: "APTAMS · 可核实的体质评估",
    template: "%s · APTAMS",
  },
  description:
    "Adolescent Physical fitness Assessment and Tracking & Monitoring System — rule-based scoring, attributed explanation, traceable agent.",
};

export const viewport: Viewport = {
  themeColor: "#080908",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `translate="no"` + `notranslate` stop the browser/extensions (Google
    // Translate, Grammarly, etc.) from injecting wrapper elements into the
    // DOM. Such injection reparents React's streaming text nodes and causes
    // "Failed to execute 'removeChild' on 'Node'" crashes on the next token.
    // The app ships its own zh/en/ko switcher, so auto-translate is not needed.
    <html
      lang="zh"
      translate="no"
      className="notranslate"
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
