import { LargeHeaderScreen } from "@/components/large-header";
import { SettingsMenuButton } from "@/components/settings-menu-button";
import { PhotoGridPlaceholder } from "@/components/ui/empty-tab";

export default function Photos() {
  return (
    <LargeHeaderScreen title="Photos" right={<SettingsMenuButton />}>
      <PhotoGridPlaceholder />
    </LargeHeaderScreen>
  );
}
