import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Lumio",
  description: "Your photo library.",
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fontMono.variable} h-full font-sans antialiased`}
    >
      <body className="min-h-full">
        {/* Sidebar is fixed (not in flow), so it stays pinned regardless of the
            window scroll — which lets the photo overlay lock background scroll
            without the sidebar drifting. Offset the content by its 76px width. */}
        <AppSidebar />
        <div className="min-h-dvh pl-[76px]">{children}</div>
        {modal}
      </body>
    </html>
  );
}
