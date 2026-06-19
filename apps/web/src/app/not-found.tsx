import { StatusScreen } from "@/components/status-screen";

export default function NotFound() {
  return (
    <StatusScreen
      code="404"
      title="Nothing developed here."
      description="The page you're looking for doesn't exist. Let's get you back to your photos."
      actions={[{ label: "Back to library", href: "/photos" }]}
    />
  );
}
