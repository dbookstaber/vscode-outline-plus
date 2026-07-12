#region FirstRegion
$x = 42
#endregion

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
