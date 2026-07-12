import * as assert from "assert";
import * as vscode from "vscode";
import {
    _getModifierCacheDocumentCount,
    _getModifierCacheTotalEntryCount,
    clearModifierCache,
    extractSymbolModifiers,
    extractSymbolModifiersWithCache,
} from "../../lib/symbolModifiers";

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

  // #region Bracket / @-decorator language gating (CODE_REVIEW_MAY #8)
  //
  // Pre-fix: `[keyword]` and `@keyword` patterns were tested for every language.
  // That produced false positives:
  //   - `{ [abstract]: true }` in TypeScript flagged isAbstract.
  //   - `@async` substrings in any language flagged isAsync.
  // Post-fix: brackets are C# only; `@keyword` is gated to languages whose
  // memberKeywords already contain an `@`-prefixed entry (i.e. Python today).

  test("TypeScript: object computed-property `[abstract]` does NOT set isAbstract", async () => {
    const doc = await makeDocument([
      "const lookup = { [abstract]: true };",
      "function regular(): void {}",
    ], "typescript");
    const symbol = createSymbol("regular", 1, vscode.SymbolKind.Function);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isAbstract, false,
      "TypeScript computed-property `[abstract]` must not trigger isAbstract");
  });

  test("TypeScript: object computed-property `[static]` does NOT set isStatic", async () => {
    const doc = await makeDocument([
      "const lookup = { [static]: true };",
      "function regular(): void {}",
    ], "typescript");
    const symbol = createSymbol("regular", 1, vscode.SymbolKind.Function);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, false,
      "TypeScript computed-property `[static]` must not trigger isStatic");
  });

  test("TypeScript: literal `@async` substring does NOT set isAsync", async () => {
    // Regression test for the @-decorator false-positive. `@async` here is just
    // text appearing inside the declaration scan window; TS has no @async
    // decorator concept.
    const doc = await makeDocument([
      "// see also: @async upstream helper",
      "function plainFunction(): void {}",
    ], "typescript");
    const symbol = createSymbol("plainFunction", 1, vscode.SymbolKind.Function);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isAsync, false,
      "TypeScript should not interpret a bare `@async` substring as isAsync");
  });

  test("Java: literal `@static` substring does NOT set isStatic", async () => {
    // `@` prefix is the Java annotation syntax, but `@static` is not a real
    // annotation. We previously fired isStatic on this text.
    const doc = await makeDocument([
      "@SomeAnnotation",
      "public void notStatic() {}",
    ], "java");
    const symbol = createSymbol("notStatic", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, false,
      "Java @SomeAnnotation must not trigger isStatic via a `@${keyword}` match");
  });

  test("C#: bracket form still detected on the same line (preserved for csharp)", async () => {
    // The bracket gate is C#-only after the fix. We test on the declaration
    // line itself because the backward-scan stops at lines ending in `]`
    // (see getSymbolDeclarationText), so attribute-on-prior-line scenarios
    // are out of reach. Same-line attributes like `[Obsolete] public ...` are
    // the realistic case the bracket form serves.
    const doc = await makeDocument([
      "[abstract] public void Decorated() {}",
    ], "csharp");
    const symbol = createSymbol("Decorated", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isAbstract, true,
      "C# bracket-form attribute match on declaration line should still fire");
  });

  test("Python: @-decorator-style member keywords still match (gating preserves Python decorators)", async () => {
    // Sanity test — the `@${keyword}` form should still fire for Python
    // (the language whose config has @-prefixed entries).
    const doc = await makeDocument([
      "@staticmethod",
      "def factory(): pass",
    ], "python");
    const symbol = createSymbol("factory", 1);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, true);
  });

  // #endregion

  // #region modifierCache version invalidation (CODE_REVIEW_MAY #9)

  test("modifierCache: a new document version replaces the prior version's entries", async () => {
    clearModifierCache();
    const doc = await makeDocument(
      ["public void Method() {}"],
      "csharp"
    );
    const symbol = createSymbol("Method", 0);
    extractSymbolModifiersWithCache(symbol, doc);
    // After one extraction at version v, we should have exactly 1 URI entry
    // and exactly 1 cached symbol.
    assert.strictEqual(_getModifierCacheDocumentCount(), 1);
    assert.strictEqual(_getModifierCacheTotalEntryCount(), 1);

    // Simulate a document version bump by creating a doc that masquerades as
    // the same URI but a different `version`. extractSymbolModifiersWithCache
    // keys on `document.uri.toString()` + `document.version`, so we wrap the
    // real doc and override `version` to feed in a higher one.
    const bumpedDoc: vscode.TextDocument = new Proxy(doc, {
      get(target, prop, receiver): unknown {
        if (prop === "version") return doc.version + 1;
        return Reflect.get(target, prop, receiver);
      },
    });

    extractSymbolModifiersWithCache(symbol, bumpedDoc);
    // The new version should have evicted the old entries — total entries
    // stays at 1, NOT 2 (would-be 2 was the bug: stale per-version entries
    // accumulating until the LRU's bulk eviction kicked in).
    assert.strictEqual(_getModifierCacheDocumentCount(), 1,
      "URI count stays 1 across versions");
    assert.strictEqual(_getModifierCacheTotalEntryCount(), 1,
      "Total entries stays 1 — prior-version entries should be evicted");
  });

  test("modifierCache: 25 simulated edits do NOT inflate the per-URI entry count", async () => {
    clearModifierCache();
    const doc = await makeDocument(
      ["public void M1() {}", "public void M2() {}"],
      "csharp"
    );
    const sym1 = createSymbol("M1", 0);
    const sym2 = createSymbol("M2", 1);

    for (let i = 0; i < 25; i++) {
      const versionedDoc: vscode.TextDocument = new Proxy(doc, {
        get(target, prop, receiver): unknown {
          if (prop === "version") return doc.version + i;
          return Reflect.get(target, prop, receiver);
        },
      });
      extractSymbolModifiersWithCache(sym1, versionedDoc);
      extractSymbolModifiersWithCache(sym2, versionedDoc);
    }

    // After 25 simulated edits × 2 symbols, the previous design would have
    // accumulated 50 entries. The new design holds only the current version's
    // entries: 2.
    assert.strictEqual(_getModifierCacheDocumentCount(), 1);
    assert.strictEqual(_getModifierCacheTotalEntryCount(), 2,
      "Should only hold entries for the latest version (2 symbols), not 50");
  });

  test("modifierCache: separate URIs each get their own per-URI entry", async () => {
    clearModifierCache();
    const docA = await makeDocument(["public void A() {}"], "csharp");
    const docB = await makeDocument(["public void B() {}"], "csharp");
    extractSymbolModifiersWithCache(createSymbol("A", 0), docA);
    extractSymbolModifiersWithCache(createSymbol("B", 0), docB);
    assert.strictEqual(_getModifierCacheDocumentCount(), 2);
    assert.strictEqual(_getModifierCacheTotalEntryCount(), 2);
  });

  // #endregion

  // #region Plan 2.2 — wrong visibility on everyday code

  // (i) Earliest-position matching (not keyword length).
  // Pre-fix: extractVisibility sorted keywords by descending length and returned
  // the first match, so "private" (7) beat "public" (6) in the same declaration.
  test("2.2(i): auto-property with 'private set' keeps the declared 'public' visibility", async () => {
    const doc = await makeDocument(
      ["public int X { get; private set; }"],
      "csharp"
    );
    const symbol = createSymbol("X", 0, vscode.SymbolKind.Property);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "Property declared 'public' with a 'private set' accessor must read as public (earliest keyword wins)");
  });

  test("2.2(i): earliest-position still prefers the longer combined modifier at the same index", async () => {
    const doc = await makeDocument(
      ["protected internal int Y { get; private set; }"],
      "csharp"
    );
    const symbol = createSymbol("Y", 0, vscode.SymbolKind.Property);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "protected-internal",
      "Combined 'protected internal' at index 0 must win over 'protected' at index 0 and over later 'private'");
  });

  // (ii) String literals must be stripped before keyword scanning.
  // The string keyword is placed BEFORE the real visibility keyword so that an
  // earliest-position matcher alone would still pick the wrong one — this
  // isolates the string-stripping fix.
  test("2.2(ii): visibility keyword inside a string literal is ignored", async () => {
    const doc = await makeDocument(
      ['[Obsolete("Use the private API instead")] public void Foo() {}'],
      "csharp"
    );
    const symbol = createSymbol("Foo", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "'private' inside a string literal must not override the real 'public' keyword");
  });

  test("2.2(ii): member-modifier keyword inside a string literal is ignored", async () => {
    const doc = await makeDocument(
      ['public string Sql = "static readonly rows";'],
      "csharp"
    );
    const symbol = createSymbol("Sql", 0, vscode.SymbolKind.Field);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, false,
      "'static' inside a string literal must not set isStatic");
    assert.strictEqual(result.memberModifiers.isReadonly, false,
      "'readonly' inside a string literal must not set isReadonly");
  });

  // (iii) Parameter-property modifiers must not leak onto the enclosing symbol.
  test("2.2(iii): TypeScript constructor parameter property does NOT mark the constructor private", async () => {
    const doc = await makeDocument(
      ["  constructor(private readonly foo: Foo) {}"],
      "typescript"
    );
    const symbol = createSymbol("constructor", 0, vscode.SymbolKind.Constructor);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "default",
      "A 'private' parameter property must not make the constructor itself private");
    assert.strictEqual(result.memberModifiers.isReadonly, false,
      "A 'readonly' parameter property must not set isReadonly on the constructor");
  });

  test("2.2(iii): a real modifier before the parameter list is still honored", async () => {
    const doc = await makeDocument(
      ["  private constructor(public bar: Bar) {}"],
      "typescript"
    );
    const symbol = createSymbol("constructor", 0, vscode.SymbolKind.Constructor);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "private",
      "The 'private' before 'constructor' is a real modifier and must be honored (only the parameter list is stripped)");
  });

  // #endregion

  // #region Plan 2.3 — case-sensitive keyword matching

  // Pre-fix: regexes carried the `i` flag, so capitalized identifiers matched
  // keywords in case-sensitive languages.
  test("2.3: TypeScript identifier 'Static' is NOT treated as the static modifier", async () => {
    const doc = await makeDocument(
      ["function Static(): void {}"],
      "typescript"
    );
    const symbol = createSymbol("Static", 0, vscode.SymbolKind.Function);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, false,
      "Capitalized 'Static' identifier must not be matched case-insensitively as 'static'");
  });

  test("2.3: TypeScript identifier 'Override' is NOT treated as the override modifier", async () => {
    const doc = await makeDocument(
      ["function Override(): void {}"],
      "typescript"
    );
    const symbol = createSymbol("Override", 0, vscode.SymbolKind.Function);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isOverride, false,
      "Capitalized 'Override' identifier must not be matched case-insensitively as 'override'");
  });

  test("2.3: C# method named 'Public' does NOT read as public visibility", async () => {
    const doc = await makeDocument(
      ["void Public() {}"],
      "csharp"
    );
    const symbol = createSymbol("Public", 0);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "default",
      "Capitalized identifier 'Public' must not match the 'public' visibility keyword");
  });

  // #endregion

  // #region Plan 4.2 — no per-tick RegExp construction

  // Precompiled patterns mean extraction must not call `new RegExp(...)` on the
  // hot path. We count constructor invocations by wrapping the global RegExp.
  // (Regex *literals* used by the sanitizers are not created via this
  // constructor, so they are intentionally not counted.)
  test("4.2: extraction constructs zero RegExp objects on the hot path", async () => {
    const doc = await makeDocument(
      ["public static readonly int Cache = 0;"],
      "csharp"
    );
    const symbol = createSymbol("Cache", 0, vscode.SymbolKind.Field);

    const OriginalRegExp = globalThis.RegExp;
    let constructCount = 0;
    const CountingRegExp = new Proxy(OriginalRegExp, {
      construct(target, args): object {
        constructCount++;
        return Reflect.construct(target, args) as object;
      },
    });
    try {
      globalThis.RegExp = CountingRegExp;
      const result = extractSymbolModifiers(symbol, doc);
      // Sanity: the extraction still works.
      assert.strictEqual(result.visibility, "public");
      assert.strictEqual(result.memberModifiers.isStatic, true);
      assert.strictEqual(result.memberModifiers.isReadonly, true);
    } finally {
      globalThis.RegExp = OriginalRegExp;
    }

    assert.strictEqual(constructCount, 0,
      "extractSymbolModifiers must not compile new RegExp objects per call (patterns are precompiled)");
  });

  // #endregion

  // #region Plan 2.9 — C++ access-specifier sections

  // Pre-fix: only the FIRST member after an access label was colored, because
  // the backward line scan stopped at the previous member's ';'.
  test("2.9: C++ second field in a 'private:' section is still private", async () => {
    const doc = await makeDocument([
      "class Widget {",
      "private:",
      "    int firstField;",
      "    int secondField;",
      "};",
    ], "cpp");
    const symbol = createSymbol("secondField", 3, vscode.SymbolKind.Field);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "private",
      "The second member of a 'private:' section must also be private");
  });

  test("2.9: C++ member after a nested method body still tracks its access section", async () => {
    const doc = await makeDocument([
      "class Service {",
      "public:",
      "    void start() {",
      "        run();",
      "    }",
      "    void stop();",
      "};",
    ], "cpp");
    const symbol = createSymbol("stop", 5);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "public",
      "A member following a full method body must still see the enclosing 'public:' label");
  });

  test("2.9: C++ later 'protected:' section overrides an earlier 'public:' section", async () => {
    const doc = await makeDocument([
      "class Model {",
      "public:",
      "    int visible;",
      "protected:",
      "    int guarded;",
      "};",
    ], "cpp");
    const symbol = createSymbol("guarded", 4, vscode.SymbolKind.Field);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.visibility, "protected",
      "The nearest preceding access label ('protected:') governs the member");
  });

  // Removing plain "c" from cppPatterns: C files get no modifier config at all.
  test("2.9: plain C ('c' languageId) yields default modifiers (no config)", async () => {
    const doc = await makeDocument(
      ["static void c_helper(void) {}"],
      "c"
    );
    const symbol = createSymbol("c_helper", 0, vscode.SymbolKind.Function);
    const result = extractSymbolModifiers(symbol, doc);
    assert.strictEqual(result.memberModifiers.isStatic, false,
      "Plain C is no longer a supported modifier language, so 'static' must not be detected");
    assert.strictEqual(result.visibility, "default");
  });

  // #endregion
});
