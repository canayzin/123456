import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setTenant } from '../api/http';

export function OrgSelect() {
  const [orgId, setOrgId] = useState('default-org');
  const [projectId, setProjectId] = useState('default-project');
  setTenant(orgId, projectId);
  return <div className="card"><h2>Select Org / Project</h2>
    <div className="row gap"><input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="orgId" />
    <input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="projectId" /></div>
    <div className="grid2">
      <Link to={`/orgs/${orgId}`}>Open Org Overview</Link>
      <Link to={`/projects/${projectId}`}>Open Project Overview</Link>
      <Link to={`/orgs/${orgId}/projects`}>Projects List</Link>
      <Link to={`/projects/${projectId}/logs`}>Logs</Link>
      <Link to={`/projects/${projectId}/exports`}>Exports</Link>
    </div>
  </div>;
}
