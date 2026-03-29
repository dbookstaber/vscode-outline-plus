import * as vscode from "vscode";
import { type FullOutlineViewConfig } from "./fullOutlineViewConfig";
import { type RegionsViewConfig } from "./regionsViewConfig";

type OutlinePlusConfig = {
  regionsView: RegionsViewConfig;
  fullOutlineView: FullOutlineViewConfig;
  enableDebugLogging: boolean;
  regionBoundaryPatternByLanguageId: unknown;
};

type ConfigKeyLevel1 = keyof OutlinePlusConfig;

export type GetLevel2Keys<
  K1 extends ConfigKeyLevel1,
  K2 extends keyof OutlinePlusConfig[K1] = K1 extends K1 ? keyof OutlinePlusConfig[K1] : never
> = K2 extends string ? `${K1}.${K2}` : never;

type ConfigKeyLevel2<K1 extends keyof OutlinePlusConfig = keyof OutlinePlusConfig> =
  K1 extends string ? GetLevel2Keys<K1> : never;

type OutlinePlusConfigKey = ConfigKeyLevel1 | ConfigKeyLevel2;

export function setGlobalOutlinePlusConfigValue<K extends OutlinePlusConfigKey>(
  key: K,
  value: K extends ConfigKeyLevel1
    ? OutlinePlusConfig[K]
    : K extends GetLevel2Keys<infer K1, infer K2>
    ? OutlinePlusConfig[K1][K2]
    : never
): Thenable<void> {
  const config = getOutlinePlusConfig();
  return config.update(key, value, vscode.ConfigurationTarget.Global);
}

export function getOutlinePlusConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("outlinePlus");
}
