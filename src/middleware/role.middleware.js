
  const normalize = (str) => (str ? str.toString().toLowerCase().trim() : "");



  export const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
      if (!req.user?.role_name) {
        return res.status(401).json({ message: "Chưa đăng nhập" });
      }

      const userRole = normalize(req.user.role_name);

      const hasPermission = allowedRoles
        .map(r => normalize(r))
        .includes(userRole);

      if (!hasPermission) {
        return res.status(403).json({
          message: "Bạn không có quyền thực hiện hành động này",
          required_roles: allowedRoles,
          your_role: req.user.role_name
        });
      }

      next();
    };
  };


  // Cho phép tất cả except 1 số role
  export const requireRoleExcept = (...excludedRoles) => {
    return (req, res, next) => {
      if (!req.user?.role_name) {
        return res.status(401).json({ message: "Chưa đăng nhập" });
      }

      const userRole = normalize(req.user.role_name);

      const isExcluded = excludedRoles
        .map(r => normalize(r))
        .includes(userRole);

      if (isExcluded) {
        return res.status(403).json({
          message: "Bạn không có quyền truy cập chức năng này",
          your_role: req.user.role_name
        });
      }

      next();
    };
  };







  // Alias
  export const requireNotCustomer = requireRoleExcept("khách hàng");
