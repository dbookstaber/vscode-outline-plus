import * as assert from "assert";
import * as vscode from "vscode";
import { clearModifierCache, extractSymbolModifiers } from "../../lib/symbolModifiers";

/**
 * Tests for extractSymbolModifiers — verifying that visibility and member modifiers
 * are correctly extracted from symbol declaration text, especially in the presence
 * of comments that contain visibility keywords.
 *
 * Bug context: XML doc comments like `/// Retrieve the private field...` and line
 * comments like `// private-field helpers` were being scanned for visibility keywords,
 * causing public methods to be misclassified as private.
 */
suite("Extract Symbol Modifiers", function () {
  this.timeout(5000);

  setup(() => {
    clearModifierCache();
  });

  // Helper to create a minimal DocumentSymbol pointing at a specific line.
  // Only selectionRange.start.line, range, and name are used by extractSymbolModifiers.
  function createSymbol(
    name: string,
    line: number,
    kind: vscode.SymbolKind = vscode.SymbolKind.Method
  ): vscode.DocumentSymbol {
    const range = new vscode.Range(line, 0, line + 1, 0);
    const selectionRange = new vscode.Range(line, 0, line, name.length);
    return new vscode.DocumentSymbol(name, "", kind, range, selectionRange);
  }

  async function makeDocument(lines: string[], language: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({
      content: lines.join("\n"),
      language,
    });
  }

  // #region Basic visibility extraction

  test("detects public visibility on a simple declaration", async () => {
    const doc = await makeDocument(
      ["public static void MyMethod() {}"],
      "csharp"
    );
    const symbol = createSymbol("MyMethod", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public");
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  test("detects private visibility on a simple declaration", async () => {
    const doc = await makeDocument(
      ["private void Secret() {}"],
      "csharp"
    );
    const symbol = createSymbol("Secret", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "private");
  });

  test("detects protected visibility", async () => {
    const doc = await makeDocument(
      ["protected int Value { get; set; }"],
      "csharp"
    );
    const symbol = createSymbol("Value", 0, vscode.SymbolKind.Property);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "protected");
  });

  test("detects internal visibility", async () => {
    const doc = await makeDocument(
      ["internal void Helper() {}"],
      "csharp"
    );
    const symbol = createSymbol("Helper", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "internal");
  });

  test("detects protected internal visibility", async () => {
    const doc = await makeDocument(
      ["protected internal void SharedHelper() {}"],
      "csharp"
    );
    const symbol = createSymbol("SharedHelper", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "protected-internal");
  });

  test("detects private protected visibility", async () => {
    const doc = await makeDocument(
      ["private protected void LimitedHelper() {}"],
      "csharp"
    );
    const symbol = createSymbol("LimitedHelper", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "private-protected");
  });

  // #endregion

  // #region Comment-keyword false-match prevention (the primary bug fix)

  test("XML doc comment with 'private' does NOT override public visibility", async () => {
    const doc = await makeDocument([
      "/// <summary>",
      "/// Retrieve the private m_connections dictionary from a running server instance.",
      "/// </summary>",
      "public static IDictionary<string, TwsConnection> GetConnections(TwsRtdServer server)",
    ], "csharp");
    const symbol = createSymbol("GetConnections", 3);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Should be 'public', not 'private' from XML doc comment");
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  test("line comment with 'private-field' does NOT override public visibility", async () => {
    const doc = await makeDocument([
      "// Generic private-field access helpers for white-box testing.",
      "public static T GetField<T>(object target, string fieldName)",
    ], "csharp");
    const symbol = createSymbol("GetField", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Should be 'public', not 'private' from line comment containing 'private-field'");
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  test("block comment with 'private' does NOT override public visibility", async () => {
    const doc = await makeDocument([
      "/* This wraps a private implementation detail. */",
      "public void BlockCommentMethod() {}",
    ], "csharp");
    const symbol = createSymbol("BlockCommentMethod", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Should be 'public', not 'private' from block comment");
  });

  test("XML doc comment with 'protected' does NOT override public visibility", async () => {
    const doc = await makeDocument([
      "/// <summary>",
      "/// Returns the protected member list for testing.",
      "/// </summary>",
      "public List<string> GetMembers() { return null; }",
    ], "csharp");
    const symbol = createSymbol("GetMembers", 3);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Should be 'public', not 'protected' from XML doc comment");
  });

  test("XML doc comment with 'internal' does NOT override public visibility", async () => {
    const doc = await makeDocument([
      "/// <summary>",
      "/// Exposes internal state for diagnostics.",
      "/// </summary>",
      "public string GetState() { return \"\"; }",
    ], "csharp");
    const symbol = createSymbol("GetState", 3);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Should be 'public', not 'internal' from XML doc comment");
  });

  test("line comment with 'static' does NOT cause false static modifier", async () => {
    const doc = await makeDocument([
      "// This is not a static helper, just a regular method.",
      "public void RegularMethod() {}",
    ], "csharp");
    const symbol = createSymbol("RegularMethod", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, false,
      "'static' in a comment should not set isStatic");
    assert.strictEqual(result.visibility, "public");
  });

  test("multi-line block comment with visibility keywords is ignored", async () => {
    const doc = await makeDocument([
      "/*",
      " * private protected internal members are handled here.",
      " */",
      "public void AfterBlockComment() {}",
    ], "csharp");
    const symbol = createSymbol("AfterBlockComment", 3);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Multi-line block comment keywords must not affect visibility");
  });

  // #endregion

  // #region Member modifiers

  test("detects static modifier on declaration line", async () => {
    const doc = await makeDocument(
      ["public static void StaticMethod() {}"],
      "csharp"
    );
    const symbol = createSymbol("StaticMethod", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  test("detects readonly modifier", async () => {
    const doc = await makeDocument(
      ["public readonly int ReadOnlyField = 42;"],
      "csharp"
    );
    const symbol = createSymbol("ReadOnlyField", 0, vscode.SymbolKind.Field);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isReadonly, true);
  });

  test("detects const modifier", async () => {
    const doc = await makeDocument(
      ["public const string TestHost = \"127.0.0.1\";"],
      "csharp"
    );
    const symbol = createSymbol("TestHost", 0, vscode.SymbolKind.Constant);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isConst, true);
  });

  test("detects abstract modifier", async () => {
    const doc = await makeDocument(
      ["public abstract void AbstractMethod();"],
      "csharp"
    );
    const symbol = createSymbol("AbstractMethod", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isAbstract, true);
  });

  test("detects async modifier", async () => {
    const doc = await makeDocument(
      ["public async Task AsyncMethod() {}"],
      "csharp"
    );
    const symbol = createSymbol("AsyncMethod", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isAsync, true);
  });

  // #endregion

  // #region Backward scanning boundary conditions

  test("stops scanning at empty lines (does not read prior method)", async () => {
    const doc = await makeDocument([
      "private void PriorMethod() {}",
      "",
      "public void CurrentMethod() {}",
    ], "csharp");
    const symbol = createSymbol("CurrentMethod", 2);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Empty line should prevent scanning into prior method's 'private' keyword");
  });

  test("stops scanning at closing brace", async () => {
    const doc = await makeDocument([
      "private void PriorMethod()",
      "{",
      "    return;",
      "}",
      "public void CurrentMethod() {}",
    ], "csharp");
    const symbol = createSymbol("CurrentMethod", 4);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public");
  });

  test("handles symbol on first line of document", async () => {
    const doc = await makeDocument(
      ["public void FirstLineMethod() {}"],
      "csharp"
    );
    const symbol = createSymbol("FirstLineMethod", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public");
  });

  test("handles symbol with no visibility keyword (returns default)", async () => {
    const doc = await makeDocument(
      ["void ImplicitMethod() {}"],
      "csharp"
    );
    const symbol = createSymbol("ImplicitMethod", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "default");
  });

  // #endregion

  // #region Cross-language: Java

  test("Java: detects public visibility correctly", async () => {
    const doc = await makeDocument(
      ["public static void main(String[] args) {}"],
      "java"
    );
    const symbol = createSymbol("main", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public");
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  test("Java: comment with 'private' does NOT override public", async () => {
    const doc = await makeDocument([
      "// private field accessor",
      "public String getField() { return null; }",
    ], "java");
    const symbol = createSymbol("getField", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Should be 'public', not 'private' from comment");
  });

  test("Java: no visibility keyword returns package-private", async () => {
    const doc = await makeDocument(
      ["void packageMethod() {}"],
      "java"
    );
    const symbol = createSymbol("packageMethod", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "package",
      "Java methods with no visibility keyword should be package-private");
  });

  // #endregion

  // #region Cross-language: TypeScript

  test("TypeScript: detects private member", async () => {
    const doc = await makeDocument(
      ["private helper(): void {}"],
      "typescript"
    );
    const symbol = createSymbol("helper", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "private");
  });

  test("TypeScript: comment with 'protected' does NOT override public", async () => {
    const doc = await makeDocument([
      "// Protected members are listed below.",
      "public getData(): string[] { return []; }",
    ], "typescript");
    const symbol = createSymbol("getData", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Should be 'public', not 'protected' from comment");
  });

  // #endregion

  // #region Cross-language: Python (naming conventions)

  test("Python: double underscore prefix is private", async () => {
    const doc = await makeDocument(
      ["def __secret(self): pass"],
      "python"
    );
    const symbol = createSymbol("__secret", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "private");
  });

  test("Python: single underscore prefix is protected", async () => {
    const doc = await makeDocument(
      ["def _internal(self): pass"],
      "python"
    );
    const symbol = createSymbol("_internal", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "protected");
  });

  test("Python: no underscore is public", async () => {
    const doc = await makeDocument(
      ["def public_api(self): pass"],
      "python"
    );
    const symbol = createSymbol("public_api", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public");
  });

  test("Python: dunder methods are public (not private)", async () => {
    const doc = await makeDocument(
      ["def __init__(self): pass"],
      "python"
    );
    const symbol = createSymbol("__init__", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Dunder methods (__init__) should be public, not private");
  });

  // #endregion

  // #region Edge cases and stress tests

  test("triple-slash XML doc with multiple visibility keywords", async () => {
    const doc = await makeDocument([
      "/// <summary>",
      "/// This private protected internal method is actually public.",
      "/// </summary>",
      "public void ConfusingCommentMethod() {}",
    ], "csharp");
    const symbol = createSymbol("ConfusingCommentMethod", 3);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "All visibility keywords in XML comments must be ignored");
  });

  test("inline comment after declaration does not affect visibility", async () => {
    const doc = await makeDocument([
      "public void Method() {} // actually this is private in the base class",
    ], "csharp");
    const symbol = createSymbol("Method", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public");
  });

  test("C# attribute between comment and declaration is captured", async () => {
    const doc = await makeDocument([
      "/// <summary>Private stuff</summary>",
      "[Obsolete]",
      "public void DecoratedMethod() {}",
    ], "csharp");
    const symbol = createSymbol("DecoratedMethod", 2);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "XML comment with 'Private' must not override actual public keyword");
  });

  test("unsupported language returns default modifiers", async () => {
    const doc = await makeDocument(
      ["public void Foo() {}"],
      "plaintext"
    );
    const symbol = createSymbol("Foo", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "default");
    assert.strictEqual(result.memberModifiers.isStatic, false);
  });

  test("empty document returns default modifiers", async () => {
    const doc = await makeDocument([""], "csharp");
    const symbol = createSymbol("Missing", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "default");
  });

  // #endregion

  // #region Preprocessor directive false-match prevention

  test("C# #region with visibility keyword does NOT affect visibility", async () => {
    const doc = await makeDocument([
      "#region Private Helpers",
      "public void Helper1() {}",
    ], "csharp");
    const symbol = createSymbol("Helper1", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "C# #region directive with 'Private' must not override actual public keyword");
  });

  test("C# #region with 'protected' does NOT affect visibility", async () => {
    const doc = await makeDocument([
      "#region Protected Members",
      "public void ProtHelper() {}",
    ], "csharp");
    const symbol = createSymbol("ProtHelper", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "C# #region directive with 'Protected' must not override actual public keyword");
  });

  test("C# #region with 'internal' does NOT affect visibility", async () => {
    const doc = await makeDocument([
      "#region Internal Utilities",
      "public void Util() {}",
    ], "csharp");
    const symbol = createSymbol("Util", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "#region 'Internal' must not override actual visibility");
  });

  test("C# #region with 'static' does NOT set isStatic", async () => {
    const doc = await makeDocument([
      "#region Static Helpers",
      "public void NonStaticHelper() {}",
    ], "csharp");
    const symbol = createSymbol("NonStaticHelper", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, false,
      "#region 'Static' must not set isStatic modifier");
  });

  // #endregion

  // #region Python # comment false-match prevention

  test("Python: standalone # comment with 'async' does NOT set isAsync", async () => {
    const doc = await makeDocument([
      "# This is an async helper function",
      "def helper(): pass",
    ], "python");
    const symbol = createSymbol("helper", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isAsync, false,
      "Python # comment with 'async' must not set isAsync modifier");
  });

  test("Python: # in string literal is NOT corrupted by comment stripping", async () => {
    // Regression test: inline # stripping must not corrupt string literals.
    // We only strip standalone # comment lines (where # is first non-whitespace).
    const doc = await makeDocument([
      'def create_pattern(pattern: str = "#[a-z]+") -> bool: pass',
    ], "python");
    const symbol = createSymbol("create_pattern", 0);
    // Should not throw or produce unexpected modifiers
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public");
    assert.strictEqual(result.memberModifiers.isStatic, false);
  });

  test("Python: @staticmethod decorator IS correctly detected", async () => {
    const doc = await makeDocument([
      "@staticmethod",
      "def factory(): pass",
    ], "python");
    const symbol = createSymbol("factory", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, true,
      "@staticmethod decorator should still be detected");
  });

  test("Python: @abstractmethod decorator IS correctly detected", async () => {
    const doc = await makeDocument([
      "@abstractmethod",
      "def compute(self): pass",
    ], "python");
    const symbol = createSymbol("compute", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isAbstract, true,
      "@abstractmethod decorator should still be detected");
  });

  // #endregion

  // #region Additional stress tests

  test("C# multi-line method signature with visibility on prior line", async () => {
    const doc = await makeDocument([
      "public static Dictionary<string, List<int>>",
      "    GetComplexReturn(string param1, int param2)",
    ], "csharp");
    const symbol = createSymbol("GetComplexReturn", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Multi-line declaration should capture visibility from prior line");
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  test("C++ public: section label is correctly detected", async () => {
    const doc = await makeDocument([
      "public:",
      "    void method();",
    ], "cpp");
    const symbol = createSymbol("method", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public");
  });

  test("C++ private: section label is correctly detected", async () => {
    const doc = await makeDocument([
      "private:",
      "    int secret_field;",
    ], "cpp");
    const symbol = createSymbol("secret_field", 1, vscode.SymbolKind.Field);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "private");
  });

  test("Java: Javadoc with 'protected' does NOT override public", async () => {
    const doc = await makeDocument([
      "/**",
      " * This protected helper is actually public.",
      " */",
      "public void javaMethod() {}",
    ], "java");
    const symbol = createSymbol("javaMethod", 3);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Javadoc with 'protected' must not override actual public keyword");
  });

  test("exact reproduction: TestHelpers.GetConnections scenario", async () => {
    // Exact reproduction of the original bug from TestHelpers.cs
    const doc = await makeDocument([
      "        }",
      "",
      "        /// <summary>",
      "        /// Retrieve the private m_connections dictionary from a running server instance.",
      "        /// </summary>",
      "        public static IDictionary<string, TwsConnection> GetConnections(TwsRtdServer server)",
    ], "csharp");
    const symbol = createSymbol("GetConnections", 5);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Exact reproduction of TestHelpers.cs GetConnections bug");
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  test("exact reproduction: TestHelpers.GetField scenario", async () => {
    // Exact reproduction of the original bug from TestHelpers.cs
    const doc = await makeDocument([
      "        }",
      "",
      "        // Generic private-field access helpers for white-box testing.",
      "        public static T GetField<T>(object target, string fieldName)",
    ], "csharp");
    const symbol = createSymbol("GetField", 3);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Exact reproduction of TestHelpers.cs GetField bug");
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  // #endregion
});
