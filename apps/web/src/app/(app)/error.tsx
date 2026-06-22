"use client";

import { useEffect } from "react";
import { StatusScreen } from "@/components/status-screen";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the failure observable in logs; never shown to the user.
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      code="500"
      title="Something didn't develop."
      description="An unexpected error interrupted this page. You can try again, or head back to your library."
      actions={[
        { label: "Try again", onClick: reset },
        { label: "Back to library", href: "/", variant: "outline" },
      ]}
    />
  );
}
