* #region FirstRegion
local x = 42
* #endregion

* #region Second Region
program define myprog
    * #region InnerRegion
    di "inner"
    * #endregion

    * #region
    di "unnamed"
    * #endregion
end
* #endregion
