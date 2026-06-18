"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      title="Log out"
      onClick={async () => {
        await signOut();
        router.replace("/login");
      }}
      className="group flex w-14 flex-col items-center gap-1 rounded-2xl py-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <LogOut
        className="h-[26px] w-[26px] transition-transform duration-200 group-active:scale-90"
        strokeWidth={1.8}
        aria-hidden
      />
      <span className="text-[10px] leading-none tracking-wide font-medium">
        Logout
      </span>
    </button>
  );
}
