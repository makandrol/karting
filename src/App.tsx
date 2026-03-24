import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider } from './services/auth';
import { TrackProvider } from './services/trackContext';
import { PageVisibilityProvider } from './services/pageVisibility';
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
const AdminPanel = lazy(() => import('./pages/Auth/AdminPanel'));
const DatabaseStats = lazy(() => import('./pages/Auth/DatabaseStats'));
const Monitoring = lazy(() => import('./pages/Auth/Monitoring'));
const CollectorLog = lazy(() => import('./pages/Auth/CollectorLog'));
const PageSettings = lazy(() => import('./pages/Auth/PageSettings'));
const CompetitionManager = lazy(() => import('./pages/Auth/CompetitionManager'));
const ScoringSettings = lazy(() => import('./pages/Auth/ScoringSettings'));
const Changelog = lazy(() => import('./pages/Changelog'));
const SessionsList = lazy(() => import('./pages/Sessions/SessionsList'));
const SessionDetail = lazy(() => import('./pages/Sessions/SessionDetail'));
const PilotProfile = lazy(() => import('./pages/Pilots/PilotProfile'));

function PageLoader() {
  return <div className="text-center py-20 text-dark-500">Завантаження...</div>;
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
                  <Route path="/home" element={<HomePage />} />

                  {/* Results */}
                  <Route path="/results" element={<Navigate to="/results/current" replace />} />
                  <Route path="/results/current" element={<CurrentRace />} />
                  <Route path="/results/:type" element={<CompetitionPage />} />
                  <Route path="/results/:type/:eventId" element={<CompetitionPage />} />
                  <Route path="/results/:type/:eventId/:phaseId" element={<CompetitionPage />} />

                  {/* Info / Analytics */}
                  <Route path="/info" element={<Navigate to="/info/timing" replace />} />
                  <Route path="/info/timing" element={<Timing />} />
                  <Route path="/onboard" element={<Onboard />} />
                  <Route path="/onboard/:kartId" element={<Onboard />} />
                  <Route path="/info/tracks" element={<Tracks />} />
                  <Route path="/info/karts" element={<Karts />} />
                  <Route path="/info/karts/:kartId" element={<KartDetail />} />
                  <Route path="/info/videos" element={<Videos />} />

                  {/* Auth */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/admin" element={<AdminPanel />} />
                  <Route path="/admin/db" element={<DatabaseStats />} />
                  <Route path="/admin/monitoring" element={<Monitoring />} />
                  <Route path="/admin/collector-log" element={<CollectorLog />} />
                  <Route path="/admin/pages" element={<PageSettings />} />
                  <Route path="/admin/competitions" element={<CompetitionManager />} />
                  <Route path="/admin/scoring" element={<ScoringSettings />} />

                  {/* Sessions */}
                  <Route path="/sessions" element={<SessionsList />} />
                  <Route path="/sessions/:sessionId" element={<SessionDetail />} />

                  {/* Pilots */}
                  <Route path="/pilots/:pilotName" element={<PilotProfile />} />

                  {/* Changelog */}
                  <Route path="/changelog" element={<Changelog />} />

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
