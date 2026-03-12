import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import HomePage from './pages/Home';
import CurrentRace from './pages/Results/CurrentRace';
import Gonzales from './pages/Results/Gonzales';
import LightLeague from './pages/Results/LightLeague';
import ChampionsLeague from './pages/Results/ChampionsLeague';
import Sprints from './pages/Results/Sprints';
import Marathons from './pages/Results/Marathons';
import Timing from './pages/Info/Timing';
import Karts from './pages/Info/Karts';
import Videos from './pages/Info/Videos';

export default function App() {
  return (
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
          <Route path="/info/karts" element={<Karts />} />
          <Route path="/info/videos" element={<Videos />} />

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
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
