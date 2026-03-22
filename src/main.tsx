import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadTracksJson } from './data/tracks';
import './index.css';

loadTracksJson().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
