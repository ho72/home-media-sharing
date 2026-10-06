import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useMe } from './hooks/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Home from './pages/Home';
import AllPhotos from './pages/AllPhotos';
import Friends from './pages/Friends';
import Notifications from './pages/Notifications';
import Account from './pages/Account';
import Files from './pages/Files';
import PublicShare from './pages/PublicShare';
import Project from './pages/Project';
import ProjectSettings from './pages/ProjectSettings';

export default function App() {
  const location = useLocation();
  const { data: me, isLoading } = useMe();
  const isPublicShareRoute = location.pathname.startsWith('/share/');

  if (isPublicShareRoute) {
    return (
      <Routes>
        <Route path="/share/:token" element={<PublicShare />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-ink-50 text-ink-500">
        불러오는 중…
      </div>
    );
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/photos" element={<AllPhotos />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/files" element={<Files />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/account" element={<Account />} />
        <Route path="/projects/:id" element={<Project />} />
        <Route path="/projects/:id/settings" element={<ProjectSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
