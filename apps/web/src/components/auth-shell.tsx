import { Logo } from "@/components/logo";
import { AuthPhotoStack } from "@/components/auth-photo-stack";

/** Two-column shell shared by /login and /setup: brand + form, with a photo collage. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center gap-2 font-medium">
          <Logo className="size-5" /> Lumio
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="bg-muted relative hidden items-center justify-center overflow-hidden lg:flex">
        <AuthPhotoStack />
      </div>
    </div>
  );
}
