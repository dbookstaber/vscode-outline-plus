import {
    type GetLevel2Keys,
    getOutlinePlusConfig,
    setGlobalOutlinePlusConfigValue,
} from "./regionHelperConfig";

export type RegionsViewConfig = Readonly<{
  shouldAutoHighlightActiveRegion: boolean;
}>;

type RawRegionsViewConfigKey = keyof RegionsViewConfig;

const defaultRegionsViewConfig = {
  shouldAutoHighlightActiveRegion: true,
} as const satisfies RegionsViewConfig;

export function setGlobalRegionsViewConfigValue<K extends RawRegionsViewConfigKey>(
  key: K,
  value: RegionsViewConfig[K]
): Thenable<void> {
  const fullConfigKey = getRegionsViewConfigKey(key);
  return setGlobalOutlinePlusConfigValue(fullConfigKey, value);
}

export function getGlobalRegionsViewConfigValue<K extends RawRegionsViewConfigKey>(
  key: K
): RegionsViewConfig[K] {
  const regionsViewConfig = getRegionsViewConfig();
  return regionsViewConfig[key];
}

function getRegionsViewConfigKey(key: RawRegionsViewConfigKey): GetLevel2Keys<"regionsView"> {
  return `regionsView.${key}`;
}

export function getRegionsViewConfig(): RegionsViewConfig {
  const outlinePlusConfig = getOutlinePlusConfig();
  const regionsViewConfig = outlinePlusConfig.get<RegionsViewConfig>("regionsView");
  return regionsViewConfig ?? defaultRegionsViewConfig;
}
