import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { canAccessView, getHomeViewForUser } from '../utils/rbac';
import { readStoredUser, safeGetStorageItem } from '../utils/session-user';
import { activeViewFromPathname, appPath } from './app-paths';

export function RequireAuth() {
  const location = useLocation();

  let token: string | null = null;
  try {
    token = safeGetStorageItem('accessToken') ?? safeGetStorageItem('token');
  } catch {
    token = null;
  }

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  let user: ReturnType<typeof readStoredUser> = null;
  try {
    user = readStoredUser();
  } catch {
    user = null;
  }

  if (location.pathname.startsWith('/app')) {
    const view = activeViewFromPathname(location.pathname);
    if (view == null) {
      return <Navigate to={appPath(getHomeViewForUser(user))} replace />;
    }
    if (!canAccessView(user, view)) {
      return <Navigate to={appPath(getHomeViewForUser(user))} replace />;
    }
  }

  return <Outlet />;
}
