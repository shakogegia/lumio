import type { Metadata } from "next";
import { getGlobalFeatureStates } from "@lumio/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GlobalFeaturesForm } from "./global-features-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Features" };

export default async function FeaturesSettingsPage() {
  const states = await getGlobalFeatureStates();
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Features</h1>
        <p className="text-sm text-muted-foreground">
          Turn optional features on or off across the whole app. Some can be
          refined per catalog in each catalog&apos;s settings.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>App features</CardTitle>
          <CardDescription>Global switches; a master for any per-catalog overrides.</CardDescription>
        </CardHeader>
        <CardContent>
          <GlobalFeaturesForm initial={states} />
        </CardContent>
      </Card>
    </main>
  );
}
