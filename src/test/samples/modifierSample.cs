// Modifier extraction stress-test sample.
// Each method is preceded by comments containing misleading visibility keywords.

#region Private Helpers

/// <summary>
/// Retrieve the private m_connections dictionary from a running server instance.
/// </summary>
public static void PublicAfterPrivateComment() {}

// Generic private-field access helpers for white-box testing.
public static void PublicAfterPrivateLineComment() {}

/* This wraps a private implementation detail. */
public void PublicAfterBlockComment() {}

protected void ProtectedMethod() {}

private void PrivateMethod() {}

internal void InternalMethod() {}

protected internal void ProtectedInternalMethod() {}

#endregion

#region Static Members

public static void StaticMethod() {}

public readonly int ReadOnlyField = 42;

public const string ConstField = "test";

#endregion
