import { Request, Response, NextFunction } from 'express';
import { getAdminBySession, hasAdmin } from '../services/adminService';

declare global {
  namespace Express {
    interface Request {
      admin?: { id: number; username: string };
    }
  }
}

export function adminBootstrapGuard(req: Request, res: Response, next: NextFunction) {
  if (!hasAdmin() && !req.path.startsWith('/admin/setup')) {
    return res.redirect('/admin/setup');
  }
  return next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const admin = getAdminBySession(req.cookies.admin_session);
  if (!admin) {
    return res.redirect('/admin/login');
  }
  req.admin = admin;
  return next();
}
