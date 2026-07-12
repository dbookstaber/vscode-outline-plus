import * as vscode from "vscode";
import { type RegionStore } from "./RegionStore";

/**
 * Status-bar indicator for the large-file parse bail-out (plan 6.10).
 *
 * When the active document exceeds the parser's line threshold, region parsing
 * is skipped and the Regions view is empty — which is otherwise indistinguishable
 * from "this file genuinely has no regions". This surfaces a persistent-while-
 * active status-bar item explaining why: the signal must stay visible for as long
 * as the huge file is the reason regions are missing, not flash and vanish (a
 * transient toast would leave the user with an unexplained empty view again).
 *
 * The visibility is driven purely off {@link RegionStore.didBailOutOnLargeFile};
 * that flag is the unit-tested source of truth (this UI wrapper is a thin
 * projection of it).
 */
export class LargeFileBailoutStatusBar implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly regionStore: RegionStore,
    subscriptions: vscode.Disposable[]
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    this.statusBarItem.text = "$(warning) Outline++: regions paused";
    this.statusBarItem.tooltip =
      "This file is too large for region parsing, so the Regions view is paused. Region markers and folding are unavailable here.";
    subscriptions.push(this.statusBarItem, this);
    this.regionStore.onDidChangeLargeFileBailout(this.sync.bind(this), undefined, subscriptions);
    this.sync();
  }

  private sync(): void {
    if (this.regionStore.didBailOutOnLargeFile) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
