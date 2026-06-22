"use client";

import { TwoFactorEnable } from "./two-factor-enable";
import { TwoFactorManage } from "./two-factor-manage";

export function TwoFactorSection({ enabled }: { enabled: boolean }) {
  return enabled ? <TwoFactorManage /> : <TwoFactorEnable />;
}
