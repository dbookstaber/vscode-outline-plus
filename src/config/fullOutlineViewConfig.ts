import {
  type GetLevel2Keys,
  getRegionHelperConfig,
  setGlobalRegionHelperConfigValue,
} from "./regionHelperConfig";

export type ModifierDisplayMode = "off" | "colorOnly" | "colorAndDescription";

export type FullOutlineViewConfig = Readonly<{
  isVisible: boolean;
  shouldAutoHighlightActiveItem: boolean;
  /** Controls how symbol modifiers (visibility, static, etc.) are displayed */
  modifierDisplay: ModifierDisplayMode;
  /** Use distinct colors (chart colors) vs subtle symbol colors for visibility */
  useDistinctModifierColors: boolean;
}>;

type RawFullOutlineViewConfigKey = keyof FullOutlineViewConfig;

const defaultFullOutlineViewConfig = {
  isVisible: true,
  shouldAutoHighlightActiveItem: true,
  modifierDisplay: "colorOnly",
  useDistinctModifierColors: true,
} as const satisfies FullOutlineViewConfig;

export function setGlobalFullOutlineViewConfigValue<K extends RawFullOutlineViewConfigKey>(
  key: K,
  value: FullOutlineViewConfig[K]
): Thenable<void> {
  const fullConfigKey = getFullOutlineViewConfigKey(key);
  return setGlobalRegionHelperConfigValue(fullConfigKey, value);
}

export function getGlobalFullOutlineViewConfigValue<K extends RawFullOutlineViewConfigKey>(
  key: K
): FullOutlineViewConfig[K] {
  const regionHelperConfig = getFullOutlineViewConfig();
  return regionHelperConfig[key];
}

function getFullOutlineViewConfigKey(
  key: RawFullOutlineViewConfigKey
): GetLevel2Keys<"fullOutlineView"> {
  return `fullOutlineView.${key}`;
}

export function getFullOutlineViewConfig(): FullOutlineViewConfig {
  const regionHelperConfig = getRegionHelperConfig();
  const fullOutlineViewConfig = regionHelperConfig.get<FullOutlineViewConfig>("fullOutlineView");
  return fullOutlineViewConfig ?? defaultFullOutlineViewConfig;
}
