import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function Layout({ children }: { children: React.ReactNode }) {
  return <div className="layout"><Sidebar /><div className="main"><Topbar />{children}</div></div>;
}
