import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';
import { useAuth } from '../../services/auth';
import { COMPETITION_CONFIGS, PHASE_CONFIGS, getPhasesForFormat, type CompetitionFormat } from '../../data/competitions';
import { useTrack } from '../../services/trackContext';
import { trackDisplayId } from '../../data/tracks';
import { isValidSession } from '../../utils/timing';

interface Competition {
  id: string;
  name: string;
  format: string;
  date: string;
  status: string;
  sessions: { sessionId: string; phase: string | null }[];
  results?: any;
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

type Step = 'closed' | 'format' | 'competition' | 'phase' | 'change_phase_all' | 'change_phase_single';

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
    const name = `${config.shortName}, ${dateStr}, Тр. ${trackDisplayId(currentTrack.id)}`;
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
      
      const compRes = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(selectedComp.id)}`);
      const comp = compRes.ok ? await compRes.json() : null;
      const results = comp ? (typeof comp.results === 'string' ? JSON.parse(comp.results) : (comp.results || {})) : {};
      const groupCount = results?.groupCountOverride ?? results?.autoDetectedGroups ?? null;
      const phases = getPhasesForFormat(selectedComp.format, groupCount);
      const phaseIdx = phases.findIndex(p => p.id === phaseId);
      if (phaseIdx >= 0) {
        await autoLinkSurroundingSessions(selectedComp.id, sessionId, phases, phaseIdx);
      }
    } catch {}
    setLoading(false);
    setStep('closed');
    onChanged?.();
  };

  const autoLinkSurroundingSessions = async (compId: string, currentSessionId: string, _phases: { id: string }[], currentPhaseIdx: number) => {
    const sessionTs = currentSessionId.match(/session-(\d+)/);
    if (!sessionTs) return;
    const currentTime = parseInt(sessionTs[1]);
    const currentDate = new Date(currentTime);
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

    try {
      const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${dateStr}`);
      if (!res.ok) return;
      const allSessions: { id: string; start_time: number; end_time: number | null; competition_id?: string | null; merged_session_ids?: string[] }[] = await res.json();

      const available = allSessions
        .filter(s => s.end_time && isValidSession(s))
        .filter(s => (!s.competition_id || s.competition_id === compId) && s.id !== currentSessionId);

      const allForDetection = allSessions
        .filter(s => s.end_time && isValidSession(s))
        .filter(s => s.id !== currentSessionId);

      const after = allForDetection.filter(s => s.start_time > currentTime).sort((a, b) => a.start_time - b.start_time);

      const detectOrder = [{ id: currentSessionId, start_time: currentTime, end_time: null, merged_session_ids: undefined as string[] | undefined }, ...after];

      const sessionPilots = new Map<string, Set<string>>();
      for (const s of detectOrder) {
        const sid = s.merged_session_ids?.[0] || s.id;
        try {
          const lapsRes = await fetch(`${COLLECTOR_URL}/db/laps?session=${sid}`);
          if (lapsRes.ok) {
            const laps: { pilot: string }[] = await lapsRes.json();
            sessionPilots.set(sid, new Set(laps.map(l => l.pilot)));
          }
        } catch {}
      }

      const format = selectedFormat || selectedComp?.format || '';
      const formatMaxGroups = format === 'champions_league' ? 2 : format === 'gonzales' ? 2 : 3;
      const isKartName = (name: string) => /^Карт\s+\d+$/i.test(name.trim());

      let detectedGroups = 1;
      const cumulativePilots = new Set<string>();
      let qualiCount = 0;
      for (const s of detectOrder) {
        const sid = s.merged_session_ids?.[0] || s.id;
        const pilots = sessionPilots.get(sid);
        if (!pilots || pilots.size === 0) continue;

        if (cumulativePilots.size === 0) {
          qualiCount = 1;
          for (const p of pilots) cumulativePilots.add(p);
          continue;
        }

        if (format === 'gonzales') {
          const realNames = [...pilots].filter(p => !isKartName(p)).length;
          if (realNames / pilots.size > 0.5) {
            qualiCount++;
            for (const p of pilots) cumulativePilots.add(p);
          }
          break;
        }

        let overlap = 0;
        for (const p of pilots) { if (cumulativePilots.has(p)) overlap++; }
        const overlapRatio = overlap / pilots.size;

        if (overlapRatio >= 0.5) break;

        qualiCount++;
        for (const p of pilots) cumulativePilots.add(p);
      }
      detectedGroups = Math.min(Math.max(qualiCount, 1), formatMaxGroups);
      const phases = getPhasesForFormat(format, detectedGroups);
      const currentIdx = phases.findIndex(p => p.id === _phases[currentPhaseIdx]?.id);
      const effectiveIdx = currentIdx >= 0 ? currentIdx : Math.min(currentPhaseIdx, phases.length - 1);

      await apiPatch(`/competitions/${encodeURIComponent(compId)}`, {
        results: { autoDetectedGroups: detectedGroups },
      });

      const availableAfter = available
        .filter(s => s.start_time > currentTime)
        .sort((a, b) => a.start_time - b.start_time);

      const remainingPhases = phases.length - effectiveIdx - 1;
      for (let i = 0; i < remainingPhases && i < availableAfter.length; i++) {
        const session = availableAfter[i];
        const phaseId = phases[effectiveIdx + 1 + i]?.id;
        if (!phaseId) continue;
        const sid = session.merged_session_ids?.[0] || session.id;
        await apiPost(`/competitions/${encodeURIComponent(compId)}/link-session`, { sessionId: sid, phase: phaseId });
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

  const handleChangePhaseAll = async (phaseId: string) => {
    if (!currentCompetitionId || !sessionId || !currentFormat) return;
    setLoading(true);
    try {
      const compRes = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(currentCompetitionId)}`);
      if (!compRes.ok) return;
      const comp: Competition = await compRes.json();
      const results = typeof comp.results === 'string' ? JSON.parse(comp.results) : (comp.results || {});
      const groupCount = results?.groupCountOverride ?? results?.autoDetectedGroups ?? null;

      const sessionTs = sessionId.match(/session-(\d+)/);
      const currentTime = sessionTs ? parseInt(sessionTs[1]) : 0;

      // Unlink this session and all sessions after it
      for (const s of comp.sessions) {
        const sTs = s.sessionId.match(/session-(\d+)/);
        const sTime = sTs ? parseInt(sTs[1]) : 0;
        if (sTime >= currentTime) {
          await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/unlink-session`, { sessionId: s.sessionId });
        }
      }

      // Link current session with new phase
      await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/link-session`, { sessionId, phase: phaseId });

      // Auto-link sessions after this one
      const allPhases = getPhasesForFormat(currentFormat, groupCount);
      const phaseIdx = allPhases.findIndex(p => p.id === phaseId);
      if (phaseIdx >= 0) {
        const dateStr = new Date(currentTime).toISOString().split('T')[0];
        const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${dateStr}`);
        if (res.ok) {
          const allSessions: { id: string; start_time: number; end_time: number | null; competition_id?: string | null; merged_session_ids?: string[] }[] = await res.json();
          const after = allSessions
            .filter(s => s.end_time && isValidSession(s) && s.start_time > currentTime && !s.competition_id && s.id !== sessionId)
            .sort((a, b) => a.start_time - b.start_time);
          const remainingPhases = allPhases.length - phaseIdx - 1;
          for (let i = 0; i < remainingPhases && i < after.length; i++) {
            const sid = after[i].merged_session_ids?.[0] || after[i].id;
            await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/link-session`, { sessionId: sid, phase: allPhases[phaseIdx + 1 + i].id });
          }
        }
      }
    } catch {}
    setLoading(false);
    setStep('closed');
    onChanged?.();
  };

  const handleChangePhaseSingle = async (phaseId: string) => {
    if (!currentCompetitionId || !sessionId) return;
    setLoading(true);
    try {
      // If phase is already taken by another session, unlink that session
      const compRes = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(currentCompetitionId)}`);
      if (compRes.ok) {
        const comp: Competition = await compRes.json();
        const existing = comp.sessions.find(s => s.phase === phaseId && s.sessionId !== sessionId);
        if (existing) {
          await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/unlink-session`, { sessionId: existing.sessionId });
        }
      }
      await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/link-session`, { sessionId, phase: phaseId });
    } catch {}
    setLoading(false);
    setStep('closed');
    onChanged?.();
  };

  if (!canManage) return null;

  const isLinked = !!currentCompetitionId;
  const compConfig = currentFormat ? COMPETITION_CONFIGS[currentFormat as CompetitionFormat] : null;
  const phaseConfig = currentFormat && currentPhase ? PHASE_CONFIGS[currentFormat]?.phases.find(p => p.id === currentPhase) : null;

  if (isLinked && compConfig) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          to={`/results/${currentFormat}/${currentCompetitionId}`}
          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors"
        >
          {compConfig.name}
        </Link>
        <div ref={dropdownRef} className="relative inline-block">
          <button
            onClick={() => setStep(step === 'closed' ? 'format' : 'closed')}
            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors"
          >
            {phaseConfig?.shortLabel || currentPhase || '?'} ▾
          </button>
          {step !== 'closed' && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1.5 z-50">
              {renderLinkedMenu()}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        onClick={() => setStep(step === 'closed' ? 'format' : 'closed')}
        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-dark-800 text-dark-400 hover:text-white transition-colors"
      >
        Прокат ▾
      </button>
      {step !== 'closed' && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1.5 z-50">
          {renderUnlinkedMenu()}
        </div>
      )}
    </div>
  );

  function getCompPhases(format: string, comp?: Competition | null): { id: string; label: string }[] {
    if (!comp) return PHASE_CONFIGS[format]?.phases || [];
    return getPhasesForFormat(format, null);
  }

  function renderLinkedMenu() {
    return (
      <>
        {step === 'format' && (
          <>
            <button
              onClick={() => {
                setSelectedComp({ id: currentCompetitionId!, name: '', format: currentFormat!, date: '', status: 'live', sessions: [] });
                setStep('change_phase_all');
              }}
              className="w-full text-left px-3 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
              Змінити етап (цей і далі)
            </button>
            <button
              onClick={() => {
                setSelectedComp({ id: currentCompetitionId!, name: '', format: currentFormat!, date: '', status: 'live', sessions: [] });
                setStep('change_phase_single');
              }}
              className="w-full text-left px-3 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
              Змінити етап (тільки цей)
            </button>
            <button onClick={handleUnlink}
              className="w-full text-left px-3 py-2 text-sm text-yellow-400/80 hover:text-yellow-400 hover:bg-dark-800 transition-colors">
              Зробити прокатом
            </button>
            <button onClick={handleDeleteCompetition}
              className="w-full text-left px-3 py-2 text-sm text-red-400/60 hover:text-red-400 hover:bg-dark-800 transition-colors">
              Видалити змагання
            </button>
          </>
        )}
        {renderPhaseSteps()}
      </>
    );
  }

  function renderUnlinkedMenu() {
    return (
      <>
        {step === 'format' && (
          <>
            <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">Тип заїзду</div>
            {Object.values(COMPETITION_CONFIGS).filter(c => c.format !== 'marathon').map(config => (
              <button key={config.format} onClick={() => handleFormatSelect(config.format)}
                className="w-full text-left px-3 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
                {config.name}
              </button>
            ))}
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
                  <button key={comp.id} onClick={() => handleCompetitionSelect(comp)}
                    className="w-full text-left px-3 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
                    {comp.name}
                    <span className="text-dark-600 text-[10px] ml-1">({comp.sessions.length} заїздів)</span>
                  </button>
                ))}
                <button onClick={handleCreateCompetition}
                  className="w-full text-left px-3 py-2 text-sm text-primary-400 hover:text-primary-300 hover:bg-dark-800 transition-colors">
                  + Створити нове змагання
                </button>
              </>
            )}
            <button onClick={() => setStep('format')} className="w-full text-left px-3 py-1.5 text-[10px] text-dark-600 hover:text-dark-400 transition-colors">← Назад</button>
          </>
        )}
        {step === 'phase' && selectedComp && (
          <>
            <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">{selectedComp.name} — етап</div>
            {(PHASE_CONFIGS[selectedComp.format]?.phases || []).map(phase => {
              const alreadyUsed = selectedComp.sessions.some(s => s.phase === phase.id);
              return (
                <button key={phase.id} onClick={() => !alreadyUsed && handlePhaseSelect(phase.id)} disabled={alreadyUsed}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${alreadyUsed ? 'text-dark-600 cursor-default' : 'text-dark-300 hover:text-white hover:bg-dark-800'}`}>
                  {phase.label}{alreadyUsed && <span className="text-dark-700 text-[10px] ml-1">(зайнято)</span>}
                </button>
              );
            })}
            <button onClick={() => setStep('competition')} className="w-full text-left px-3 py-1.5 text-[10px] text-dark-600 hover:text-dark-400 transition-colors">← Назад</button>
          </>
        )}
        {renderPhaseSteps()}
      </>
    );
  }

  function renderPhaseSteps() {
    return (
      <>
        {step === 'change_phase_all' && selectedComp && (
          <>
            <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">Змінити етап (цей і далі)</div>
            {(PHASE_CONFIGS[selectedComp.format]?.phases || []).map(phase => (
              <button key={phase.id} onClick={() => handleChangePhaseAll(phase.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${phase.id === currentPhase ? 'text-primary-400 font-medium' : 'text-dark-300 hover:text-white hover:bg-dark-800'}`}>
                {phase.label}{phase.id === currentPhase && <span className="text-dark-600 text-[10px] ml-1">(поточний)</span>}
              </button>
            ))}
            <button onClick={() => setStep('format')} className="w-full text-left px-3 py-1.5 text-[10px] text-dark-600 hover:text-dark-400 transition-colors">← Назад</button>
          </>
        )}
        {step === 'change_phase_single' && selectedComp && (
          <>
            <div className="px-3 py-1.5 text-[10px] text-dark-500 uppercase tracking-wider">Змінити етап (тільки цей)</div>
            {(PHASE_CONFIGS[selectedComp.format]?.phases || []).map(phase => (
              <button key={phase.id} onClick={() => handleChangePhaseSingle(phase.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${phase.id === currentPhase ? 'text-primary-400 font-medium' : 'text-dark-300 hover:text-white hover:bg-dark-800'}`}>
                {phase.label}{phase.id === currentPhase && <span className="text-dark-600 text-[10px] ml-1">(поточний)</span>}
              </button>
            ))}
            <button onClick={() => setStep('format')} className="w-full text-left px-3 py-1.5 text-[10px] text-dark-600 hover:text-dark-400 transition-colors">← Назад</button>
          </>
        )}
      </>
    );
  }
}
