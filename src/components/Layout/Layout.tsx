import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';
import { trackPageView } from '../../services/analytics';
import { useAuth } from '../../services/auth';

export default function Layout() {
  const location = useLocation();
  const { user } = useAuth();

  // Track page views on navigation
  useEffect(() => {
    trackPageView(location.pathname, user ? { email: user.email, name: user.name } : null);
  }, [location.pathname, user]);

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
