import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StatusScreenAction = {
  label: string;
  /** When set, the action renders as a link button (used by navigation actions). */
  href?: string;
  /** When set (and no href), the action renders as a plain button (used by `reset`). */
  onClick?: () => void;
  variant?: "default" | "outline";
};

/**
 * Branded, theme-aware full-area status screen shared by the App Router
 * not-found and error files. Presentational and hook-free so it can be rendered
 * from both Server Components (not-found) and Client Components (error.tsx).
 *
 * NOTE: `global-error.tsx` cannot use this — it renders outside the root layout
 * where `globals.css` (Tailwind + tokens) is not loaded, so it inlines its own
 * styles instead.
 */
export function StatusScreen({
  code,
  title,
  description,
  actions,
  className,
}: {
  code: string;
  title: string;
  description: string;
  actions: StatusScreenAction[];
  className?: string;
}) {
  return (
    <main
      className={cn(
        "flex min-h-dvh flex-col items-center justify-center px-6 text-center",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-6">
        <Logo className="size-7 text-muted-foreground" strokeWidth={1.6} />

        <span
          aria-hidden
          className="font-heading text-[7rem] leading-none font-semibold tracking-tighter text-muted-foreground/20 select-none sm:text-[9rem]"
        >
          {code}
        </span>

        <div className="flex max-w-md flex-col items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
            {title}
          </h1>
          <p className="text-sm/relaxed text-muted-foreground text-balance">
            {description}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {actions.map((action) =>
            action.href ? (
              <Button
                key={action.label}
                asChild
                size="lg"
                variant={action.variant ?? "default"}
              >
                <Link href={action.href}>{action.label}</Link>
              </Button>
            ) : (
              <Button
                key={action.label}
                size="lg"
                variant={action.variant ?? "default"}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ),
          )}
        </div>
      </div>
    </main>
  );
}
