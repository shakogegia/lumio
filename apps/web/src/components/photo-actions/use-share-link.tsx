"use client";

import { useCallback, useState } from "react";
import { ShareLinkDialog } from "@/components/photo-actions/share-link-dialog";

export interface ShareLinkControls {
  /** Open the create-share-link dialog for the given photos. */
  share: (ids: string[]) => void;
  /** The share-link dialog. Render once per view. */
  element: React.ReactNode;
}

/**
 * The grid-independent half of the share flow: captures a target id set and
 * renders the create-link dialog. Mirrors `useAddToAlbum` — `usePhotoActions`
 * consumes it so the toolbar and the context menu share one dialog instance.
 */
export function useShareLink(): ShareLinkControls {
  const [ids, setIds] = useState<string[] | null>(null);

  const share = useCallback((targetIds: string[]) => {
    if (targetIds.length === 0) return;
    setIds(targetIds);
  }, []);

  const element = (
    <ShareLinkDialog
      ids={ids ?? []}
      open={ids !== null}
      onOpenChange={(open) => {
        if (!open) setIds(null);
      }}
    />
  );

  return { share, element };
}
