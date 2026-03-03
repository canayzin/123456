import { Link } from 'react-router-dom';

export function Sidebar() {
  return <aside className="sidebar">
    <h3>NovaCloud</h3>
    <nav>
      <Link to="/orgs">Orgs</Link>
      <Link to="/settings">Settings</Link>
    </nav>
  </aside>;
}
