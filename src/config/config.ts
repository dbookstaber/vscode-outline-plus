import * as vscode from "vscode";

export type ModifierDisplayMode =
  | "off"
  | "colorOnly"
  | "colorAndBadge"
  | "colorAndSvgOverlay"
  | "colorAndDescription";

export type FullOutlineViewConfig = Readonly<{
  shouldAutoHighlightActiveItem: boolean;
  /** Controls how symbol modifiers (visibility, static, etc.) are displayed */
  modifierDisplay: ModifierDisplayMode;
  /** Use distinct colors (chart colors) vs subtle symbol colors for visibility */
  useDistinctModifierColors: boolean;
}>;

export type RegionsViewConfig = Readonly<{
  shouldAutoHighlightActiveRegion: boolean;
}>;

const defaultFullOutlineViewConfig: FullOutlineViewConfig = {
  shouldAutoHighlightActiveItem: true,
  modifierDisplay: "colorAndBadge",
  useDistinctModifierColors: true,
};

const defaultRegionsViewConfig: RegionsViewConfig = {
  shouldAutoHighlightActiveRegion: true,
};

export function getOutlinePlusConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("outlinePlus");
}

export function getFullOutlineViewConfig(): FullOutlineViewConfig {
  return getOutlinePlusConfig().get<FullOutlineViewConfig>("fullOutlineView") ??
    defaultFullOutlineViewConfig;
}

export function getGlobalFullOutlineViewConfigValue<K extends keyof FullOutlineViewConfig>(
  key: K
): FullOutlineViewConfig[K] {
  return getFullOutlineViewConfig()[key];
}

export function setGlobalFullOutlineViewConfigValue<K extends keyof FullOutlineViewConfig>(
  key: K,
  value: FullOutlineViewConfig[K]
): Thenable<void> {
  return updateEffective(`fullOutlineView.${key}`, value);
}

export function getRegionsViewConfig(): RegionsViewConfig {
  return getOutlinePlusConfig().get<RegionsViewConfig>("regionsView") ?? defaultRegionsViewConfig;
}

export function getGlobalRegionsViewConfigValue<K extends keyof RegionsViewConfig>(
  key: K
): RegionsViewConfig[K] {
  return getRegionsViewConfig()[key];
}

export function setGlobalRegionsViewConfigValue<K extends keyof RegionsViewConfig>(
  key: K,
  value: RegionsViewConfig[K]
): Thenable<void> {
  return updateEffective(`regionsView.${key}`, value);
}

/**
 * Writes `key` to the scope that currently supplies its effective value. Always
 * writing Global is a silent no-op whenever a Workspace(-folder) override shadows
 * the setting: the update lands in user settings but the workspace value keeps
 * winning, so a view-title toggle appears to do nothing.
 */
function updateEffective(key: string, value: unknown): Thenable<void> {
  const config = getOutlinePlusConfig();
  const inspected = config.inspect(key);
  let target = vscode.ConfigurationTarget.Global;
  if (inspected?.workspaceFolderValue !== undefined) {
    target = vscode.ConfigurationTarget.WorkspaceFolder;
  } else if (inspected?.workspaceValue !== undefined) {
    target = vscode.ConfigurationTarget.Workspace;
  }
  return config.update(key, value, target);
}
