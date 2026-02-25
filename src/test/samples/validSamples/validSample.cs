#region FirstRegion
int x = 42;
#endregion

#region Second Region
class MyClass {
    #region    InnerRegion  
    readonly int x = 42;
    int y = 100;
    protected int z = 200;
    private void MyMethod() {}
    #endregion   ends  InnerRegion    

    #region
    static void MyMethod2() {}
    #endregion  
}
#endregion
