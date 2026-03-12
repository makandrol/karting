import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider } from './services/auth';
import { TrackProvider } from './services/trackContext';
import HomePage from './pages/Home';
import CurrentRace from './pages/Results/CurrentRace';
import Gonzales from './pages/Results/Gonzales';
import LightLeague from './pages/Results/LightLeague';
import ChampionsLeague from './pages/Results/ChampionsLeague';
import Sprints from './pages/Results/Sprints';
import Marathons from './pages/Results/Marathons';
import Timing from './pages/Info/Timing';
import Tracks from './pages/Info/Tracks';
import Karts from './pages/Info/Karts';
import KartDetail from './pages/Info/KartDetail';
import Videos from './pages/Info/Videos';
import Login from './pages/Auth/Login';
import AdminPanel from './pages/Auth/AdminPanel';

export default function App() {
  return (
    <AuthProvider>
      <TrackProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />

              {/* Results */}
              <Route path="/results" element={<Navigate to="/results/current" replace />} />
              <Route path="/results/current" element={<CurrentRace />} />
              <Route path="/results/gonzales" element={<Gonzales />} />
              <Route path="/results/light-league" element={<LightLeague />} />
              <Route path="/results/champions-league" element={<ChampionsLeague />} />
              <Route path="/results/sprints" element={<Sprints />} />
              <Route path="/results/marathons" element={<Marathons />} />

              {/* Info / Analytics */}
              <Route path="/info" element={<Navigate to="/info/timing" replace />} />
              <Route path="/info/timing" element={<Timing />} />
              <Route path="/info/tracks" element={<Tracks />} />
              <Route path="/info/karts" element={<Karts />} />
              <Route path="/info/karts/:kartId" element={<KartDetail />} />
              <Route path="/info/videos" element={<Videos />} />

              {/* Auth */}
              <Route path="/login" element={<Login />} />
              <Route path="/admin" element={<AdminPanel />} />

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TrackProvider>
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
