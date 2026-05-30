* #region FirstRegion
local x = 42
* #endregion

* #endregion Invalid end boundary
* #region Invalid start boundary

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
