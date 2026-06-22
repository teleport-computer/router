import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";
import { ServerInfoProvider } from "@/lib/server-info";

const newsreader = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Teleport Router",
  description: "Team shared notebook for AI conversations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${plexMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            if (localStorage.getItem('router_theme') === 'dark') {
              document.documentElement.classList.add('dark');
            }
          } catch {}
        `}} />
      </head>
      <body className="min-h-full flex flex-col">
        <ServerInfoProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </ServerInfoProvider>
      </body>
    </html>
  );
}
