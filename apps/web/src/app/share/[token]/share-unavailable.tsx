import { ImageOff } from "lucide-react";
import { Logo } from "@/components/logo";

export function ShareUnavailable() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <Logo className="size-8 text-muted-foreground" />
      <ImageOff className="size-10 text-muted-foreground/60" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">This link is no longer available</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The share link may have been revoked, expired, or disabled.
      </p>
    </main>
  );
}
