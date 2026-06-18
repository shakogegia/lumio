import { redirect } from "next/navigation";
import { Aperture } from "lucide-react";
import { hasAnyUser } from "@lumio/db";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Fresh install with no account yet → go create the admin.
  if (!(await hasAnyUser())) redirect("/setup");

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center gap-2 font-medium">
          <Aperture className="size-5" /> Lumio
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <LoginForm />
          </div>
        </div>
      </div>
      <div className="bg-muted relative hidden lg:block">
        <div className="absolute inset-0 flex items-center justify-center">
          <Aperture className="text-muted-foreground/30 size-40" strokeWidth={1} />
        </div>
      </div>
    </div>
  );
}
