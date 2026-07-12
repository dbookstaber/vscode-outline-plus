#region FirstRegion
$x = 42
#endregion

#endregion Invalid end boundary
#region Invalid start boundary

#region Second Region
class MyClass {
    #region InnerRegion
    [void] Method() { }
    #endregion ends InnerRegion

    #region
    [void] Method2() { }
    #endregion
}
#endregion
