import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../services/auth';
import { Navigate, Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';

interface Competition {
  id: string;
  name: string;
  format: string | null;
  date: string | null;
  sessions: string[];
  results: any | null;
  uploaded_results: any | null;
}

interface DbSession {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  track_id: number;
  race_number: number | null;
  is_race: number;
  date: string;
}

const FORMAT_OPTIONS = [
  { value: 'light_league', label: 'Лайт Ліга' },
  { value: 'champions_league', label: 'Ліга Чемпіонів' },
  { value: 'gonzales', label: 'Гонзалес' },
  { value: 'sprint', label: 'Спринт' },
  { value: 'marathon', label: 'Марафон' },
];

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(startMs: number, endMs: number | null): string {
  if (!endMs) return 'active';
  const sec = Math.round((endMs - startMs) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}хв ${s}с` : `${s}с`;
}

function adminHeaders(): Record<string, string> {
  const token = import.meta.env.VITE_ADMIN_TOKEN || '';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export default function CompetitionManager() {
  const { isOwner } = useAuth();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFormat, setNewFormat] = useState('light_league');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions`);
      if (res.ok) {
        const data = await res.json();
        setCompetitions(data.map((c: any) => ({
          ...c,
          sessions: (c.sessions || []).map((s: any) => typeof s === 'string' ? s : s.sessionId),
        })));
      }
    } catch { setError('Collector недоступний'); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createCompetition = async () => {
    if (!newName.trim()) return;
    const id = `${newFormat}-${newDate}-${Date.now().toString(36)}`;
    await fetch(`${COLLECTOR_URL}/competitions`, {
      method: 'POST', headers: adminHeaders(),
      body: JSON.stringify({ id, name: newName.trim(), format: newFormat, date: newDate, sessions: [] }),
    });
    setNewName(''); setShowCreate(false);
    fetchAll();
  };

  const deleteCompetition = async (id: string) => {
    if (!confirm('Видалити змагання?')) return;
    await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: adminHeaders() });
    fetchAll();
  };

  const updateSessions = async (id: string, sessions: string[]) => {
    await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: adminHeaders(),
      body: JSON.stringify({ sessions }),
    });
    fetchAll();
  };

  const updateResults = async (id: string, results: any) => {
    await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: adminHeaders(),
      body: JSON.stringify({ results }),
    });
    fetchAll();
  };

  const updateUploadedResults = async (id: string, uploaded_results: any) => {
    await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: adminHeaders(),
      body: JSON.stringify({ uploaded_results }),
    });
    fetchAll();
  };

  if (!isOwner) return <Navigate to="/login" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/admin/access" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">Змагання</h1>
          <p className="text-dark-400 text-sm">Управління змаганнями та прив'язка заїздів</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition-colors"
        >
          + Створити
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {showCreate && (
        <div className="card space-y-3">
          <h3 className="text-white font-semibold text-sm">Нове змагання</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Назва (напр. Лайт Ліга 2026 Етап 3)"
              className="bg-dark-800 border border-dark-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary-500 outline-none sm:col-span-2"
            />
            <select value={newFormat} onChange={e => setNewFormat(e.target.value)}
              className="bg-dark-800 border border-dark-700 text-white rounded-lg px-3 py-2 text-sm outline-none">
              {FORMAT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
              className="bg-dark-800 border border-dark-700 text-white rounded-lg px-3 py-2 text-sm outline-none" />
            <button onClick={createCompetition}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition-colors">
              Створити
            </button>
            <button onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg text-sm text-dark-400 hover:text-white transition-colors">
              Скасувати
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card text-center py-12 text-dark-500">Завантаження...</div>
      ) : competitions.length === 0 ? (
        <div className="card text-center py-12 text-dark-500">Немає змагань. Натисніть "+ Створити" щоб додати.</div>
      ) : (
        <div className="space-y-3">
          {competitions.map(comp => (
            <CompetitionCard
              key={comp.id}
              competition={comp}
              expanded={expanded === comp.id}
              onToggle={() => setExpanded(expanded === comp.id ? null : comp.id)}
              onDelete={() => deleteCompetition(comp.id)}
              onUpdateSessions={(sessions) => updateSessions(comp.id, sessions)}
              onUpdateResults={(results) => updateResults(comp.id, results)}
              onUpdateUploadedResults={(uploaded) => updateUploadedResults(comp.id, uploaded)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompetitionCard({ competition: comp, expanded, onToggle, onDelete, onUpdateSessions, onUpdateResults, onUpdateUploadedResults }: {
  competition: Competition;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onUpdateSessions: (sessions: string[]) => void;
  onUpdateResults: (results: any) => void;
  onUpdateUploadedResults: (uploaded: any) => void;
}) {
  const [tab, setTab] = useState<'sessions' | 'auto' | 'uploaded'>('sessions');
  const [sessionData, setSessionData] = useState<Record<string, DbSession>>({});
  const [dateSessions, setDateSessions] = useState<DbSession[]>([]);
  const [pickingDate, setPickingDate] = useState(comp.date || '');
  const [showPicker, setShowPicker] = useState(false);
  const [uploadJson, setUploadJson] = useState('');

  const formatLabel = FORMAT_OPTIONS.find(f => f.value === comp.format)?.label || comp.format || '';

  useEffect(() => {
    if (!expanded || comp.sessions.length === 0) return;
    const ids = comp.sessions.filter(id => !sessionData[id]);
    if (ids.length === 0) return;
    (async () => {
      const date = comp.date;
      if (!date) return;
      const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`);
      if (!res.ok) return;
      const all: DbSession[] = await res.json();
      const map: Record<string, DbSession> = { ...sessionData };
      for (const s of all) map[s.id] = s;
      setSessionData(map);
    })();
  }, [expanded, comp.sessions, comp.date]);

  const loadDateSessions = async (date: string) => {
    setPickingDate(date);
    const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`);
    if (res.ok) {
      const all: DbSession[] = await res.json();
      setDateSessions(all);
      const map: Record<string, DbSession> = { ...sessionData };
      for (const s of all) map[s.id] = s;
      setSessionData(map);
    }
  };

  const addSession = (sessionId: string) => {
    if (comp.sessions.includes(sessionId)) return;
    onUpdateSessions([...comp.sessions, sessionId]);
  };

  const removeSession = (sessionId: string) => {
    onUpdateSessions(comp.sessions.filter(id => id !== sessionId));
  };

  const moveSession = (idx: number, dir: -1 | 1) => {
    const arr = [...comp.sessions];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= arr.length) return;
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    onUpdateSessions(arr);
  };

  const handleUpload = () => {
    try {
      const parsed = JSON.parse(uploadJson);
      onUpdateUploadedResults(parsed);
      setUploadJson('');
    } catch {
      alert('Невалідний JSON');
    }
  };

  const hasTimingData = comp.sessions.length > 0 && comp.sessions.some(id => sessionData[id]);

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-dark-800/30 transition-colors" onClick={onToggle}>
        <svg className={`w-4 h-4 text-dark-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium text-sm truncate">{comp.name}</div>
          <div className="text-dark-500 text-xs">{formatLabel} {comp.date && `\u00b7 ${comp.date}`} {`\u00b7 ${comp.sessions.length} заїздів`}</div>
        </div>
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          className="text-dark-600 hover:text-red-400 text-xs px-2 py-1 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0">
          Видалити
        </button>
      </div>

      {expanded && (
        <div className="border-t border-dark-800">
          {/* Tabs */}
          <div className="flex border-b border-dark-800">
            {(['sessions', 'auto', 'uploaded'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  tab === t ? 'text-primary-400 border-b-2 border-primary-400' : 'text-dark-400 hover:text-white'
                } ${(t === 'auto' && !hasTimingData) ? 'opacity-40 cursor-not-allowed' : ''}`}
                disabled={t === 'auto' && !hasTimingData}
              >
                {t === 'sessions' ? `Заїзди (${comp.sessions.length})` : t === 'auto' ? 'Авто-результати' : 'Завантажені результати'}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'sessions' && (
              <div className="space-y-3">
                {/* Linked sessions */}
                {comp.sessions.length === 0 ? (
                  <div className="text-dark-500 text-sm text-center py-4">Немає прив'язаних заїздів</div>
                ) : (
                  <div className="space-y-1">
                    {comp.sessions.map((sid, idx) => {
                      const s = sessionData[sid];
                      return (
                        <div key={sid} className="flex items-center gap-2 bg-dark-800/50 rounded-lg px-3 py-2">
                          <span className="text-dark-500 text-xs font-mono w-5">{idx + 1}</span>
                          {s ? (
                            <>
                              <span className="text-white text-xs font-mono">{fmtTime(s.start_time)}</span>
                              <span className="text-dark-500 text-xs">–</span>
                              <span className="text-dark-300 text-xs font-mono">{s.end_time ? fmtTime(s.end_time) : 'active'}</span>
                              <span className="text-dark-400 text-xs">{s.pilot_count} pilot(s)</span>
                              <span className="text-dark-600 text-xs">{fmtDuration(s.start_time, s.end_time)}</span>
                            </>
                          ) : (
                            <span className="text-dark-500 text-xs font-mono">{sid}</span>
                          )}
                          <div className="flex-1" />
                          <button onClick={() => moveSession(idx, -1)} disabled={idx === 0}
                            className="text-dark-500 hover:text-white disabled:opacity-20 p-0.5">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                          </button>
                          <button onClick={() => moveSession(idx, 1)} disabled={idx === comp.sessions.length - 1}
                            className="text-dark-500 hover:text-white disabled:opacity-20 p-0.5">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </button>
                          <button onClick={() => removeSession(sid)}
                            className="text-dark-600 hover:text-red-400 text-xs transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add session picker */}
                <div className="pt-2 border-t border-dark-800/50">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-dark-400 text-xs">Додати заїзд за дату:</span>
                    <input type="date" value={pickingDate}
                      onChange={e => loadDateSessions(e.target.value)}
                      className="bg-dark-800 border border-dark-700 text-white rounded-lg px-2 py-1 text-xs outline-none" />
                    <button onClick={() => { setShowPicker(!showPicker); if (!showPicker) loadDateSessions(pickingDate); }}
                      className="px-2 py-1 rounded-lg text-xs bg-dark-700 text-dark-300 hover:text-white transition-colors">
                      {showPicker ? 'Приховати' : 'Показати заїзди'}
                    </button>
                  </div>

                  {showPicker && (
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {dateSessions.length === 0 ? (
                        <div className="text-dark-600 text-xs text-center py-3">Немає заїздів за цю дату</div>
                      ) : dateSessions.map(s => {
                        const linked = comp.sessions.includes(s.id);
                        return (
                          <button key={s.id} onClick={() => !linked && addSession(s.id)} disabled={linked}
                            className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors ${
                              linked ? 'bg-dark-800/30 text-dark-600 cursor-default' : 'bg-dark-800/50 text-dark-300 hover:bg-dark-700 hover:text-white'
                            }`}>
                            <span className="font-mono text-white">{fmtTime(s.start_time)}</span>
                            <span className="text-dark-500">–</span>
                            <span className="font-mono">{s.end_time ? fmtTime(s.end_time) : '...'}</span>
                            <span>{s.pilot_count} pilots</span>
                            <span className="text-dark-600">{fmtDuration(s.start_time, s.end_time)}</span>
                            {linked && <span className="ml-auto text-dark-600">linked</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'auto' && (
              <div className="space-y-3">
                {comp.results ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-dark-300 text-xs font-semibold">Авто-розрахунок з таймінгу</span>
                      <button onClick={() => onUpdateResults(null)}
                        className="text-dark-600 hover:text-red-400 text-xs transition-colors">Очистити</button>
                    </div>
                    <pre className="bg-dark-800 rounded-lg p-3 text-xs text-dark-300 overflow-auto max-h-96 font-mono">
                      {JSON.stringify(comp.results, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="text-dark-500 text-sm text-center py-6">
                    Авто-результати ще не розраховані.
                    <br />
                    <span className="text-dark-600 text-xs">Функціонал розрахунку буде додано пізніше.</span>
                  </div>
                )}
              </div>
            )}

            {tab === 'uploaded' && (
              <div className="space-y-3">
                {comp.uploaded_results ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-dark-300 text-xs font-semibold">Завантажені реальні результати</span>
                      <button onClick={() => onUpdateUploadedResults(null)}
                        className="text-dark-600 hover:text-red-400 text-xs transition-colors">Очистити</button>
                    </div>
                    <pre className="bg-dark-800 rounded-lg p-3 text-xs text-dark-300 overflow-auto max-h-96 font-mono">
                      {JSON.stringify(comp.uploaded_results, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-dark-500 text-sm text-center py-2">Вставте JSON з результатами</div>
                    <textarea value={uploadJson} onChange={e => setUploadJson(e.target.value)}
                      rows={8} placeholder='{"pilots": [...], "standings": [...]}'
                      className="w-full bg-dark-800 border border-dark-700 text-dark-300 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-primary-500 resize-y" />
                    <button onClick={handleUpload} disabled={!uploadJson.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition-colors disabled:opacity-40">
                      Завантажити
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
