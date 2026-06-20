"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bottom-left heart overlay on a grid tile. Persistent (filled) when the photo
 * is favorited; a faint outline that appears on tile hover when it isn't. Clicks
 * toggle favorite for this one photo and never select/open the tile.
 */
export function FavoriteHeart({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={active ? "Remove from Favorites" : "Add to Favorites"}
      aria-pressed={active}
      title={active ? "Remove from Favorites" : "Add to Favorites"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "absolute bottom-1.5 left-1.5 z-20 flex size-7 items-center justify-center rounded-full text-white",
        "drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] transition-[opacity,transform] hover:scale-110",
        active ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100",
      )}
    >
      <Heart className="size-4" fill={active ? "currentColor" : "none"} strokeWidth={2} aria-hidden />
    </button>
  );
}
