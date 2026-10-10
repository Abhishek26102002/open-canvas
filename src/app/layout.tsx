import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Nunito, Shantell_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const hand = Shantell_Sans({ variable: "--font-hand", subsets: ["latin"] });
const normal = Nunito({ variable: "--font-normal", subsets: ["latin"] });
const code = Geist_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OpenCanvas",
  description: "An open, hand-drawn style whiteboard for sketching diagrams and ideas.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${hand.variable} ${normal.variable} ${code.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden overscroll-none">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
