import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Footer } from "@/components/layout/footer";
import { MaintenanceBanner } from "@/components/layout/maintenance-banner";
import { Navbar } from "@/components/layout/navbar";
import { SkipLink } from "@/components/layout/skip-link";
import { site } from "@/lib/site";
import "./globals.css";

const title = `${site.name} | ${site.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: title, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: site.name,
    title,
    description: site.description,
    url: "/",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title, description: site.description },
};

export const viewport: Viewport = {
  themeColor: "#090909",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <SkipLink />
        <Suspense fallback={null}><MaintenanceBanner /></Suspense>
        <Navbar />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
