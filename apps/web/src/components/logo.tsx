import { Aperture } from "lucide-react";
import { cn } from "@/lib/utils";

/** The Lumio brand mark. Single source for the logo icon — swap it here later. */
export function Logo({
  className,
  strokeWidth = 1.9,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <Aperture className={cn("size-6", className)} strokeWidth={strokeWidth} aria-hidden />
  );
}
