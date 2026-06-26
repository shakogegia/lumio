import { ImageOff } from "lucide-react";
import { Logo } from "@/components/logo";

export function ShareUnavailable() {
  return (
    <main className="flex min-h-dvh flex-col p-6 md:p-10">
      {/* Brand top-left, mirroring the login/setup layout. */}
      <div className="flex items-center gap-2 font-medium">
        <Logo className="size-5" /> Lumio
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <ImageOff className="size-10 text-muted-foreground/60" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">This link is no longer available</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The share link may have been revoked, expired, or disabled.
        </p>
      </div>
    </main>
  );
}
