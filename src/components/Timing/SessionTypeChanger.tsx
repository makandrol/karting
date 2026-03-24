import { useState, useEffect, useRef } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { useAuth } from '../../services/auth';
import { COMPETITION_CONFIGS, PHASE_CONFIGS, type CompetitionFormat } from '../../data/competitions';
import { useTrack } from '../../services/trackContext';

interface Competition {
  id: string;
  name: string;
  format: string;
  date: string;
  status: string;
  sessions: { sessionId: string; phase: string | null }[];
}

interface SessionTypeChangerProps {
  sessionId: string | null;
  currentFormat?: string | null;
  currentPhase?: string | null;
  currentCompetitionId?: string | null;
  onChanged?: () => void;
}

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

async function apiPost(path: string, body: object) {
  return fetch(`${COLLECTOR_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify(body),
  });
}

async function apiPatch(path: string, body: object) {
  return fetch(`${COLLECTOR_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify(body),
  });
}

type Step = 'closed' | 'format' | 'competition' | 'phase' | 'change_phase';

export default function SessionTypeChanger({ sessionId, currentFormat, currentPhase, currentCompetitionId, onChanged }: SessionTypeChangerProps) {
  const { hasPermission } = useAuth();
  const { currentTrack } = useTrack();
  const canManage = hasPermission('manage_results');

  const [step, setStep] = useState<Step>('closed');
  const [selectedFormat, setSelectedFormat] = useState<CompetitionFormat | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedComp, setSelectedComp] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setStep('closed');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchCompetitions = async (format: CompetitionFormat) => {
    setLoading(true);
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions?format=${format}`);
      if (res.ok) {
        const all: Competition[] = await res.json();
        setCompetitions(all.filter(c => c.status === 'live'));
      }
    } catch {}
    setLoading(false);
  };

  const handleFormatSelect = (format: CompetitionFormat) => {
    setSelectedFormat(format);
    fetchCompetitions(format);
    setStep('competition');
  };

  const handleCreateCompetition = async () => {
    if (!selectedFormat || !sessionId) return;
    setLoading(true);
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getFullYear()).slice(2)}`;
    const config = COMPETITION_CONFIGS[selectedFormat];
    const name = `${config.name}, ${dateStr}, Траса ${currentTrack.id}`;
    const id = `${selectedFormat}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${Date.now().toString(36)}`;
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ id, name, format: selectedFormat, date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }),
      });
      if (res.ok) {
        const comp: Competition = await res.json();
        setSelectedComp(comp);
        setStep('phase');
      }
    } catch {}
    setLoading(false);
  };

  const handleCompetitionSelect = (comp: Competition) => {
    setSelectedComp(comp);
    setStep('phase');
  };

  const handlePhaseSelect = async (phaseId: string) => {
    if (!selectedComp || !sessionId) return;
    setLoading(true);
    try {
      await apiPost(`/competitions/${encodeURIComponent(selectedComp.id)}/link-session`, { sessionId, phase: phaseId });
      
      // Auto-link previous sessions
      const phases = PHASE_CONFIGS[selectedComp.format]?.phases || [];
      const phaseIdx = phases.findIndex(p => p.id === phaseId);
      if (phaseIdx > 0) {
        await autoLinkPreviousSessions(selectedComp.id, sessionId, phases, phaseIdx);
      }
    } catch {}
    setLoading(false);
    setStep('closed');
    onChanged?.();
  };

  const autoLinkPreviousSessions = async (compId: string, currentSessionId: string, phases: { id: string }[], currentPhaseIdx: number) => {
    const sessionTs = currentSessionId.match(/session-(\d+)/);
    if (!sessionTs) return;
    const currentDate = new Date(parseInt(sessionTs[1]));
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

    try {
      const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${dateStr}`);
      if (!res.ok) return;
      const allSessions: { id: string; start_time: number; end_time: number | null; competition_id?: string | null; merged_session_ids?: string[] }[] = await res.json();

      const validSessions = allSessions
        .filter(s => s.end_time && (s.end_time - s.start_time) >= 60000)
        .filter(s => s.start_time < parseInt(sessionTs[1]))
        .filter(s => !s.competition_id)
        .sort((a, b) => b.start_time - a.start_time);

      for (let i = currentPhaseIdx - 1; i >= 0 && (currentPhaseIdx - 1 - i) < validSessions.length; i--) {
        const session = validSessions[currentPhaseIdx - 1 - i];
        const allIds = session.merged_session_ids || [session.id];
        await apiPost(`/competitions/${encodeURIComponent(compId)}/link-session`, { sessionId: allIds[0], phase: phases[i].id });
      }
    } catch {}
  };

  const handleUnlink = async () => {
    if (!currentCompetitionId || !sessionId) return;
    setLoading(true);
    try {
      await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/unlink-session`, { sessionId });
    } catch {}
    setLoading(false);
    setStep('closed');
    onChanged?.();
  };

  const handleDeleteCompetition = async () => {
    if (!currentCompetitionId) return;
    setLoading(true);
    try {
      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(currentCompetitionId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
      });
    } catch {}
    setLoading(false);
    setStep('closed');
    onChanged?.();
  };

  const handleChangePhase = async (phaseId: string) => {
    if (!currentCompetitionId || !sessionId) return;
    setLoading(true);
    try {
      await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/link-session`, { sessionId, phase: phaseId });
    } catch {}
    setLoading(false);
    setStep('closed');
    onChanged?.();
  };

  if (!canManage) return null;

  const isLinked = !!currentCompetitionId;
  const label = isLinked && currentFormat && currentPhase
    ? `${COMPETITION_CONFIGS[currentFormat as CompetitionFormat]?.name || currentFormat} · ${PHASE_CONFIGS[currentFormat]?.phases.find(p => p.id === currentPhase)?.shortLabel || currentPhase}`
    : isLinked && currentFormat
    ? COMPETITION_CONFIGS[currentFormat as CompetitionFormat]?.name || currentFormat
    : 'Прокат';

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        onClick={() => setStep(step === 'closed' ? 'format' : 'closed')}
        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
          isLinked ? 'bg-purple-500/15 text-purple-400 hover:bg-purple-500/25' : 'bg-dark-800 text-dark-400 hover:text-white'
        }`}
      >
        {label} ▾
      </button>

      {step !== 'closed' && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1.5 z-50">
          {step === 'format' && !isLinked && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">Тип заїзду</div>
              {Object.values(COMPETITION_CONFIGS).filter(c => c.format !== 'sprint' && c.format !== 'marathon').map(config => (
                <button
                  key={config.format}
                  onClick={() => handleFormatSelect(config.format)}
                  className="w-full text-left px-3 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors"
                >
                  {config.name}
                </button>
              ))}
            </>
          )}

          {step === 'format' && isLinked && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">{label}</div>
              <button
                onClick={() => {
                  setSelectedComp({ id: currentCompetitionId!, name: '', format: currentFormat!, date: '', status: 'live', sessions: [] });
                  setStep('change_phase');
                }}
                className="w-full text-left px-3 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors"
              >
                Змінити етап
              </button>
              <button
                onClick={handleUnlink}
                className="w-full text-left px-3 py-2 text-sm text-yellow-400/80 hover:text-yellow-400 hover:bg-dark-800 transition-colors"
              >
                Зробити прокатом
              </button>
              <button
                onClick={handleDeleteCompetition}
                className="w-full text-left px-3 py-2 text-sm text-red-400/60 hover:text-red-400 hover:bg-dark-800 transition-colors"
              >
                Видалити змагання
              </button>
            </>
          )}

          {step === 'change_phase' && selectedComp && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">Змінити етап</div>
              {(PHASE_CONFIGS[selectedComp.format]?.phases || []).map(phase => (
                <button
                  key={phase.id}
                  onClick={() => handleChangePhase(phase.id)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    phase.id === currentPhase ? 'text-primary-400 font-medium' : 'text-dark-300 hover:text-white hover:bg-dark-800'
                  }`}
                >
                  {phase.label}
                  {phase.id === currentPhase && <span className="text-dark-600 text-[10px] ml-1">(поточний)</span>}
                </button>
              ))}
              <button onClick={() => setStep('format')} className="w-full text-left px-3 py-1.5 text-[10px] text-dark-600 hover:text-dark-400 transition-colors">
                ← Назад
              </button>
            </>
          )}

          {step === 'competition' && selectedFormat && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">
                {COMPETITION_CONFIGS[selectedFormat].name} — змагання
              </div>
              {loading ? (
                <div className="px-3 py-2 text-dark-500 text-sm">Завантаження...</div>
              ) : (
                <>
                  {competitions.map(comp => (
                    <button
                      key={comp.id}
                      onClick={() => handleCompetitionSelect(comp)}
                      className="w-full text-left px-3 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors"
                    >
                      {comp.name}
                      <span className="text-dark-600 text-[10px] ml-1">({comp.sessions.length} заїздів)</span>
                    </button>
                  ))}
                  <button
                    onClick={handleCreateCompetition}
                    className="w-full text-left px-3 py-2 text-sm text-primary-400 hover:text-primary-300 hover:bg-dark-800 transition-colors"
                  >
                    + Створити нове змагання
                  </button>
                </>
              )}
              <button onClick={() => setStep('format')} className="w-full text-left px-3 py-1.5 text-[10px] text-dark-600 hover:text-dark-400 transition-colors">
                ← Назад
              </button>
            </>
          )}

          {step === 'phase' && selectedComp && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">
                {selectedComp.name} — етап
              </div>
              {(PHASE_CONFIGS[selectedComp.format]?.phases || []).map(phase => {
                const alreadyUsed = selectedComp.sessions.some(s => s.phase === phase.id);
                return (
                  <button
                    key={phase.id}
                    onClick={() => !alreadyUsed && handlePhaseSelect(phase.id)}
                    disabled={alreadyUsed}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      alreadyUsed ? 'text-dark-600 cursor-default' : 'text-dark-300 hover:text-white hover:bg-dark-800'
                    }`}
                  >
                    {phase.label}
                    {alreadyUsed && <span className="text-dark-700 text-[10px] ml-1">(зайнято)</span>}
                  </button>
                );
              })}
              <button onClick={() => setStep('competition')} className="w-full text-left px-3 py-1.5 text-[10px] text-dark-600 hover:text-dark-400 transition-colors">
                ← Назад
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
