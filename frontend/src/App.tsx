import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { applyUpdate } from './utils/serviceWorkerRegistration';
import { startRefreshScheduler, stopRefreshScheduler } from './utils/refreshScheduler';
import { ensureFriendRequestPushSubscription } from './utils/pushNotifications';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import GlobalCallHandler from './components/GlobalCallHandler';
import BeeLoader from './components/BeeLoader';
import './App.css';

// Eager load critical pages
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Eager load CreateProfilePage to avoid context issues
import CreateProfilePage from './pages/CreateProfilePage';
const HomePage = lazy(() => import('./pages/HomePage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const FriendsPage = lazy(() => import('./pages/FriendsPage'));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const CreateGigPage = lazy(() => import('./pages/CreateGigPage'));
const GigDetailPage = lazy(() => import('./pages/GigDetailPage'));
const EditGigPage = lazy(() => import('./pages/EditGigPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const SubscriptionPage = lazy(() => import('./pages/SubscriptionPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));

// Loading component
const LoadingFallback = () => (
  <BeeLoader message="Preparing HiveMate..." fullscreen />
);

function App() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    startRefreshScheduler();
    return () => stopRefreshScheduler();
  }, []);

  useEffect(() => {
    ensureFriendRequestPushSubscription().catch((error) => {
      console.error('Push subscription setup failed:', error);
    });
  }, []);

  useEffect(() => {
    const onUpdateAvailable = () => setUpdateAvailable(true);

    window.addEventListener('hivemate:update-available', onUpdateAvailable as EventListener);

    return () => {
      window.removeEventListener('hivemate:update-available', onUpdateAvailable as EventListener);
    };
  }, []);

  return (
    <ErrorBoundary>
      <ToastProvider>
        {updateAvailable && (
          <div className="app-update-banner" role="status" aria-live="polite">
            <span>New version available</span>
            <button
              type="button"
              className="app-update-btn"
              onClick={() => applyUpdate()}
            >
              Update now
            </button>
          </div>
        )}
        <Router>
          <GlobalCallHandler />
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/create-profile" element={<CreateProfilePage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/profile/:userId" element={<ProfilePage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/friends/:userId" element={<FriendsPage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/chat/:friendshipId" element={<ChatPage />} />
              <Route path="/gig/create" element={<CreateGigPage />} />
              <Route path="/gig/:gigId" element={<GigDetailPage />} />
              <Route path="/gig/:gigId/edit" element={<EditGigPage />} />
              <Route path="/subscription" element={<SubscriptionPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Router>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
