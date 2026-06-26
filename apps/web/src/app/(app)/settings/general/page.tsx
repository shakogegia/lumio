import type { Metadata } from "next";
import { getGeneralSettings } from "@/lib/server/app-settings-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GeneralSettingsForm } from "./general-settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "General" };

export default async function GeneralSettingsPage() {
  const settings = await getGeneralSettings();
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">General</h1>
        <p className="text-sm text-muted-foreground">App-wide settings.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Public base URL</CardTitle>
          <CardDescription>
            The address this app is reachable at from the public internet (e.g.
            https://photos.example.com). Required before you can create share links.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeneralSettingsForm initial={settings.publicBaseUrl} />
        </CardContent>
      </Card>
    </main>
  );
}
