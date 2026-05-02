// Auto-scaffolded port. Adapters in this compound implement this contract.
import type { SettingKey, SettingValue } from "../public.js";
export interface SettingsRepository {
  describe(): string;
  readonly _settingkey?: SettingKey;
  readonly _settingvalue?: SettingValue;
}
