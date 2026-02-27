import * as vscode from "vscode";

/** Focuses the active editor group. */
export async function focusActiveEditorGroup(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
}