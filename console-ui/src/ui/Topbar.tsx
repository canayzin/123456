import { useAuth } from '../auth/useAuth';

export function Topbar() {
  const { logout } = useAuth();
  return <header className="topbar"><span>Hosted Console</span><button onClick={logout}>Logout</button></header>;
}
