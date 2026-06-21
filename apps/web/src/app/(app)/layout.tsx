import { redirect } from "next/navigation";
import { getSettings } from "@lumio/db";
import { AppSidebar } from "@/components/app-sidebar";
import { SoundSettingsProvider } from "@/components/sound-settings-provider";
import { getServerSession } from "@/lib/server-session";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const settings = await getSettings();

  return (
    <>
      <SoundSettingsProvider enabled={settings.soundEffectsEnabled} />
      {/* Sidebar is fixed (not in flow); offset content by its 76px width. */}
      <AppSidebar />
      <div className="min-h-dvh pl-[76px]">{children}</div>
    </>
  );
}
