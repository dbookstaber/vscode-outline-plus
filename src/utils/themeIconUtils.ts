import * as vscode from "vscode";

/**
 * Converts a SymbolKind enum value to a kebab-case string that can be used as a valid theme icon
 * ID. For example, `SymbolKind.TypeParameter` becomes "symbol-type-parameter".
 */
export function getSymbolThemeIconId(symbolKind: vscode.SymbolKind): string {
  const pascalCaseSymbolKindName = vscode.SymbolKind[symbolKind];
  const kebabCaseSymbolKindName = toKebabCase(pascalCaseSymbolKindName);
  return `symbol-${kebabCaseSymbolKindName}`;
}

function toKebabCase(pascalCaseStr: string): string {
  return pascalCaseStr.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
