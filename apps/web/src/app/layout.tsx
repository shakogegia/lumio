import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ALBUM_COLUMNS_STORAGE_KEY,
  ALBUM_DEFAULT_COLUMNS,
  COLUMNS_MAX,
  COLUMNS_MIN,
  DEFAULT_COLUMNS,
  GRID_COLUMNS_STORAGE_KEY,
} from "@/lib/grid-layout";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Runs before first paint: reads each persisted column count and sets the
// matching CSS variable on <html>, so server-rendered grids (the photo-grid
// skeleton's --grid-columns; the albums listing's --album-columns) paint at the
// chosen density instead of flashing the default and snapping after hydration
// reads localStorage. (Same approach as the theme no-flash script.)
const gridColumnsScript = `try{function s(k,d,p){var v=localStorage.getItem(k);var n=v?parseInt(v,10):d;if(!(n>=${COLUMNS_MIN}&&n<=${COLUMNS_MAX}))n=d;document.documentElement.style.setProperty(p,n+'');}s(${JSON.stringify(
  GRID_COLUMNS_STORAGE_KEY,
)},${DEFAULT_COLUMNS},'--grid-columns');s(${JSON.stringify(
  ALBUM_COLUMNS_STORAGE_KEY,
)},${ALBUM_DEFAULT_COLUMNS},'--album-columns');}catch(e){}`;

export const metadata: Metadata = {
  // `default` covers routes without their own title (e.g. the redirect index);
  // `template` wraps each page's `title` export, so "Photos" → "Photos · Lumio".
  title: { default: "Lumio", template: "%s · Lumio" },
  description: "Your photo library.",
  // iOS home-screen launch: standalone chrome + a black status bar to match the
  // dark splash. (The manifest already covers Android/desktop installability.)
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Lumio",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${fontMono.variable} h-full font-sans antialiased`}
    >
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: gridColumnsScript }} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster position="bottom-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
