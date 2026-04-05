import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './services/auth';
import { TrackProvider } from './services/trackContext';
import { PageVisibilityProvider, usePageVisibility } from './services/pageVisibility';
import ErrorBoundary from './components/ErrorBoundary';

const HomePage = lazy(() => import('./pages/Home'));
const CurrentRace = lazy(() => import('./pages/Results/CurrentRace'));
const CompetitionPage = lazy(() => import('./pages/Results/CompetitionPage'));
const Timing = lazy(() => import('./pages/Info/Timing'));
const Onboard = lazy(() => import('./pages/Info/Onboard'));
const Tracks = lazy(() => import('./pages/Info/Tracks'));
const Karts = lazy(() => import('./pages/Info/Karts'));
const KartDetail = lazy(() => import('./pages/Info/KartDetail'));
const Videos = lazy(() => import('./pages/Info/Videos'));
const Login = lazy(() => import('./pages/Auth/Login'));
const AccessSettings = lazy(() => import('./pages/Auth/AccessSettings'));
const DatabaseStats = lazy(() => import('./pages/Auth/DatabaseStats'));
const Monitoring = lazy(() => import('./pages/Auth/Monitoring'));
const CollectorLog = lazy(() => import('./pages/Auth/CollectorLog'));
const CompetitionManager = lazy(() => import('./pages/Auth/CompetitionManager'));
const ScoringSettings = lazy(() => import('./pages/Auth/ScoringSettings'));
const Changelog = lazy(() => import('./pages/Changelog'));
const SessionsList = lazy(() => import('./pages/Sessions/SessionsList'));
const SessionDetail = lazy(() => import('./pages/Sessions/SessionDetail'));
const PilotProfile = lazy(() => import('./pages/Pilots/PilotProfile'));

function PageLoader() {
  return <div className="text-center py-20 text-dark-500">Завантаження...</div>;
}

function PageGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const { isPathAccessible } = usePageVisibility();

  const role = user?.role ?? 'user';
  const email = user?.email;

  if (!isPathAccessible(location.pathname, role, email)) {
    return <PageBlocked />;
  }

  return <>{children}</>;
}

function PageBlocked() {
  return (
    <div className="text-center py-20">
      <div className="text-5xl mb-4">🔒</div>
      <h1 className="text-2xl font-bold text-white mb-2">Доступ обмежений</h1>
      <p className="text-dark-400">Ця сторінка зараз недоступна для вашого акаунту.</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PageVisibilityProvider>
      <TrackProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<Timing />} />
                  <Route path="/home" element={<PageGuard><HomePage /></PageGuard>} />

                  {/* Results */}
                  <Route path="/results" element={<PageGuard><CompetitionPage /></PageGuard>} />
                  <Route path="/results/current" element={<PageGuard><CurrentRace /></PageGuard>} />
                  <Route path="/results/:type" element={<PageGuard><CompetitionPage /></PageGuard>} />
                  <Route path="/results/:type/:eventId" element={<PageGuard><CompetitionPage /></PageGuard>} />
                  <Route path="/results/:type/:eventId/:phaseId" element={<PageGuard><CompetitionPage /></PageGuard>} />

                  {/* Info / Analytics */}
                  <Route path="/info" element={<Navigate to="/info/timing" replace />} />
                  <Route path="/info/timing" element={<Timing />} />
                  <Route path="/onboard" element={<PageGuard><Onboard /></PageGuard>} />
                  <Route path="/onboard/:kartId" element={<PageGuard><Onboard /></PageGuard>} />
                  <Route path="/info/tracks" element={<PageGuard><Tracks /></PageGuard>} />
                  <Route path="/info/karts" element={<PageGuard><Karts /></PageGuard>} />
                  <Route path="/info/karts/:kartId" element={<PageGuard><KartDetail /></PageGuard>} />
                  <Route path="/info/videos" element={<PageGuard><Videos /></PageGuard>} />

                  {/* Auth */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/admin" element={<Navigate to="/admin/access" replace />} />
                  <Route path="/admin/access" element={<AccessSettings />} />
                  <Route path="/admin/pages" element={<Navigate to="/admin/access" replace />} />
                  <Route path="/admin/db" element={<DatabaseStats />} />
                  <Route path="/admin/monitoring" element={<Monitoring />} />
                  <Route path="/admin/collector-log" element={<CollectorLog />} />
                  <Route path="/admin/competitions" element={<CompetitionManager />} />
                  <Route path="/admin/scoring" element={<ScoringSettings />} />

                  {/* Sessions */}
                  <Route path="/sessions" element={<PageGuard><SessionsList /></PageGuard>} />
                  <Route path="/sessions/:sessionId" element={<PageGuard><SessionDetail /></PageGuard>} />

                  {/* Pilots */}
                  <Route path="/pilots/:pilotName" element={<PageGuard><PilotProfile /></PageGuard>} />

                  {/* Changelog */}
                  <Route path="/changelog" element={<PageGuard><Changelog /></PageGuard>} />

                  {/* 404 */}
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </TrackProvider>
      </PageVisibilityProvider>
    </AuthProvider>
  );
}

function NotFound() {
  return (
    <div className="text-center py-20">
      <div className="text-6xl mb-4">🏎️</div>
      <h1 className="text-3xl font-bold text-white mb-2">404</h1>
      <p className="text-dark-400">Цю сторінку не знайдено. Можливо, вона з'їхала з траси.</p>
    </div>
  );
}
