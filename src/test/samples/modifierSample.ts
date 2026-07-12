// Modifier extraction stress-test sample (TypeScript).
//
// The TypeScript language server is guaranteed present in the test host, so
// `executeDocumentSymbolProvider` returns real symbols for this file. Each
// member is preceded by comments (and lives inside #region blocks) containing
// misleading visibility keywords; the extractor must ignore those and read the
// actual declaration.

// #region Private Helpers

export class ModifierShowcase {
  /**
   * Retrieve the private m_connections map from a running server instance.
   */
  public static publicAfterPrivateComment(): void {}

  // Generic private-field access helpers for white-box testing.
  public static publicAfterPrivateLineComment(): void {}

  /* This wraps a private implementation detail. */
  public publicAfterBlockComment(): void {}

  protected protectedMethod(): void {}

  private privateMethod(): void {}

  // #region Static Members

  public static staticMethod(): void {}

  public readonly readOnlyField: number = 42;

  // #endregion

  public async asyncMethod(): Promise<void> {}
}

// #endregion
