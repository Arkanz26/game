import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SILIKA", template: "%s · SILIKA" },
  description: "Sistem Informasi Likuidasi Bank — Lembaga Penjamin Simpanan",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
