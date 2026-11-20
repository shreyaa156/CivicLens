import { StrictMode, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './index.css';
import { AppProvider } from './lib/AppContext';
import Layout from './components/Layout';
import Landing from './pages/Landing';
const ReportIssue = lazy(() => import('./pages/ReportIssue'));
const MapPage = lazy(() => import('./pages/MapPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ReportDetail = lazy(() => import('./pages/ReportDetail'));
const AgentActivity = lazy(() => import('./pages/AgentActivity'));
const Contact = lazy(() => import('./pages/Contact'));
const Messages = lazy(() => import('./pages/Messages'));

function NotFound() {
  return (
    <div className="container-page py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 text-3xl font-extrabold">Page not found</h1>
      <Link to="/" className="btn-primary mt-6">Go home</Link>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Landing />} />
            <Route path="report" element={<ReportIssue />} />
            <Route path="map" element={<MapPage />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="reports/:id" element={<ReportDetail />} />
            <Route path="agents" element={<AgentActivity />} />
            <Route path="agents/:runId" element={<AgentActivity />} />
            <Route path="contact" element={<Contact />} />
            <Route path="messages" element={<Messages />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
);
