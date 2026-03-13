import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadTracksJson } from './data/tracks';
import { loadChampionsLeague2025 } from './mock/competitionEvents';
import './index.css';

// Завантажити дані до рендеру
Promise.all([loadTracksJson(), loadChampionsLeague2025()]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
