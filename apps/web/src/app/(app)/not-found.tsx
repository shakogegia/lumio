import { StatusScreen } from "@/components/status-screen";

export default function AppNotFound() {
  return (
    <StatusScreen
      code="404"
      title="This page took a different exposure."
      description="We couldn't find what you were looking for. It may have been moved, deleted, or never existed."
      actions={[
        { label: "Back to library", href: "/photos" },
        { label: "Go to albums", href: "/albums", variant: "outline" },
      ]}
    />
  );
}
