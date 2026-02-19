import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout/Layout';
import Login from './components/Auth/Login';
import Dashboard from './components/Dashboard/Dashboard';
import CertificateList from './components/Certificates/CertificateList';
import CertificateDetail from './components/Certificates/CertificateDetail';
import CAList from './components/CA/CAList';
import CSRList from './components/CSR/CSRList';
import CSRWizard from './components/CSR/CSRWizard';
import ServerList from './components/Servers/ServerList';
import Settings from './components/Settings/Settings';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function App() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" /> : <Login />}
      />

      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="certificates" element={<CertificateList />} />
        <Route path="certificates/:id" element={<CertificateDetail />} />
        <Route path="ca" element={<CAList />} />
        <Route path="csr" element={<CSRList />} />
        <Route path="csr/new" element={<CSRWizard />} />
        <Route path="servers" element={<ServerList />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
