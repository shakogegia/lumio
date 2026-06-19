"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Monitor, MoreHorizontal, Moon, Settings, Sun, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SidebarMore() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const settingsActive = pathname === "/settings" || pathname.startsWith("/settings/");

  async function handleLogout() {
    await signOut();
    router.replace("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="More"
        aria-current={settingsActive ? "page" : undefined}
        className={cn(
          "group flex w-14 flex-col items-center gap-1 rounded-2xl py-2.5 outline-none transition-colors",
          "data-[state=open]:bg-muted data-[state=open]:text-foreground",
          settingsActive
            ? "text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <MoreHorizontal
          className="h-[26px] w-[26px] transition-transform duration-200 group-active:scale-90"
          strokeWidth={settingsActive ? 2.4 : 1.8}
          aria-hidden
        />
        <span
          className={cn(
            "text-[10px] leading-none tracking-wide",
            settingsActive ? "font-semibold" : "font-medium",
          )}
        >
          More
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-44">
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/trash">
            <Trash2 aria-hidden />
            Trash
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Monitor aria-hidden />
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={setTheme}
            >
              <DropdownMenuRadioItem value="system">
                <Monitor aria-hidden />
                System
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">
                <Sun aria-hidden />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon aria-hidden />
                Dark
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void handleLogout();
          }}
        >
          <LogOut aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
