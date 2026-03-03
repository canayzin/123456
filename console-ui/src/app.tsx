import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './ui/Layout';
import { ToastProvider } from './ui/Toasts';
import { Login } from './pages/Login';
import { OrgSelect } from './pages/OrgSelect';
import { OrgOverview } from './pages/OrgOverview';
import { ProjectOverview } from './pages/ProjectOverview';
import { ProjectsList } from './pages/ProjectsList';
import { ApiKeys } from './pages/ApiKeys';
import { HostingReleases } from './pages/HostingReleases';
import { RemoteConfigVersions } from './pages/RemoteConfigVersions';
import { MessagingReceipts } from './pages/MessagingReceipts';
import { MessagingDLQ } from './pages/MessagingDLQ';
import { AppCheckDenies } from './pages/AppCheckDenies';
import { Logs } from './pages/Logs';
import { Exports } from './pages/Exports';
import { Settings } from './pages/Settings';

function Secure({ children }: { children: JSX.Element }) {
  return <RequireAuth><Layout>{children}</Layout></RequireAuth>;
}

export function App() {
  return <AuthProvider><ToastProvider><BrowserRouter><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/orgs" element={<Secure><OrgSelect /></Secure>} />
    <Route path="/orgs/:orgId" element={<Secure><OrgOverview /></Secure>} />
    <Route path="/projects/:projectId" element={<Secure><ProjectOverview /></Secure>} />
    <Route path="/orgs/:orgId/projects" element={<Secure><ProjectsList /></Secure>} />
    <Route path="/projects/:projectId/apikeys" element={<Secure><ApiKeys /></Secure>} />
    <Route path="/projects/:projectId/hosting" element={<Secure><HostingReleases /></Secure>} />
    <Route path="/projects/:projectId/remoteconfig" element={<Secure><RemoteConfigVersions /></Secure>} />
    <Route path="/projects/:projectId/messaging/receipts" element={<Secure><MessagingReceipts /></Secure>} />
    <Route path="/projects/:projectId/messaging/dlq" element={<Secure><MessagingDLQ /></Secure>} />
    <Route path="/projects/:projectId/appcheck/denies" element={<Secure><AppCheckDenies /></Secure>} />
    <Route path="/projects/:projectId/logs" element={<Secure><Logs /></Secure>} />
    <Route path="/projects/:projectId/exports" element={<Secure><Exports /></Secure>} />
    <Route path="/settings" element={<Secure><Settings /></Secure>} />
    <Route path="*" element={<Navigate to="/orgs" replace />} />
  </Routes></BrowserRouter></ToastProvider></AuthProvider>;
}
