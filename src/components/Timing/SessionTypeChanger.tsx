import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { apiPost as httpPost, apiPatch as httpPatch } from '../../services/api/http';
import { useAuth } from '../../services/auth';
import { COMPETITION_CONFIGS, PHASE_CONFIGS, getPhasesForFormat, type CompetitionFormat } from '../../data/competitions';
import { useTrack } from '../../services/trackContext';
import { trackDisplayId } from '../../data/tracks';
import { isValidSession } from '../../utils/timing';
import { fmtDateISO } from '../../utils/datetime';
import {
  detectGroupsFromSessionSequence,
  planAutoLink,
  type SequentialSession,
} from '../../utils/competitionLinking';

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

async function apiPost(path: string, body: object) {
  try { await httpPost(path, body); return { ok: true } as Response; }
  catch { return { ok: false } as Response; }
}

async function apiPatch(path: string, body: object) {
  try { await httpPatch(path, body); return { ok: true } as Response; }
  catch { return { ok: false } as Response; }
}

type Step = 'closed' | 'format' | 'change_phase_all' | 'change_phase_single';

export default function SessionTypeChanger({ sessionId, currentFormat, currentPhase, currentCompetitionId, onChanged }: SessionTypeChangerProps) {
  const { hasPermission } = useAuth();
  const { currentTrack } = useTrack();
  const canManage = hasPermission('manage_results');

  const [step, setStep] = useState<Step>('closed');
  const [selectedComp, setSelectedComp] = useState<Competition | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setStep('closed');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Вибір формату → одразу нове змагання, перший заїзд стає першим етапом
  // (Кваліфікація 1). Без проміжних кроків вибору змагання чи етапу.
  const handleFormatSelect = async (format: CompetitionFormat) => {
    if (!sessionId) return;
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getFullYear()).slice(2)}`;
    const config = COMPETITION_CONFIGS[format];
    const name = `${config.shortName}, ${dateStr}, Тр. ${trackDisplayId(currentTrack.id)}`;
    const isoDate = fmtDateISO(now);
    const id = `${format}-${isoDate}-${Date.now().toString(36)}`;
    try {
      const comp = await api.competitions.create({ id, name, format, date: isoDate }) as unknown as Competition;
      setSelectedComp(comp);
      const firstPhase = getPhasesForFormat(format, null)[0];
      if (firstPhase) await linkSessionToPhase(comp, firstPhase.id);
    } catch {}
    setStep('closed');
    onChanged?.();
  };

  const linkSessionToPhase = async (comp: Competition, phaseId: string) => {
    if (!sessionId) return;
    try {
      await apiPost(`/competitions/${encodeURIComponent(comp.id)}/link-session`, { sessionId, phase: phaseId });

      let fresh: any = null;
      try { fresh = await api.competitions.getSafeNormalized(comp.id); } catch {}
      const results = fresh?.results ?? {};
      const groupCount = results?.groupCountOverride ?? results?.autoDetectedGroups ?? null;
      const phases = getPhasesForFormat(comp.format, groupCount);
      const phaseIdx = phases.findIndex(p => p.id === phaseId);
      if (phaseIdx >= 0) {
        await autoLinkSurroundingSessions(comp.id, comp.format, sessionId, phases, phaseIdx);
      }
    } catch {}
  };

  const autoLinkSurroundingSessions = async (compId: string, compFormat: string, currentSessionId: string, _phases: { id: string }[], currentPhaseIdx: number) => {
    const sessionTs = currentSessionId.match(/session-(\d+)/);
    if (!sessionTs) return;
    const currentTime = parseInt(sessionTs[1]);
    const currentDate = new Date(currentTime);
    const dateStr = fmtDateISO(currentDate);

    try {
      let allSessions: { id: string; start_time: number; end_time: number | null; competition_id?: string | null; merged_session_ids?: string[]; best_lap_time?: string | null }[];
      try {
        allSessions = await api.sessions.byDate(dateStr) as any;
      } catch { return; }

      const available = allSessions
        .filter(s => s.end_time && isValidSession(s) && s.best_lap_time != null)
        .filter(s => (!s.competition_id || s.competition_id === compId) && s.id !== currentSessionId);

      const allForDetection = allSessions
        .filter(s => s.end_time && isValidSession(s))
        .filter(s => s.id !== currentSessionId);

      const after = allForDetection.filter(s => s.start_time > currentTime).sort((a, b) => a.start_time - b.start_time);

      // Build SequentialSession entries (current + after) for detectGroupsFromSessionSequence
      const detectOrder = [
        { id: currentSessionId, start_time: currentTime, end_time: null as number | null, merged_session_ids: undefined as string[] | undefined },
        ...after,
      ];

      const seqSessions: SequentialSession[] = [];
      for (const s of detectOrder) {
        const sid = s.merged_session_ids?.[0] || s.id;
        try {
          const laps = await api.laps.bySession(sid);
          const pilots = new Set((laps as any[]).map(l => l.pilot));
          const lapCounts = new Map<string, number>();
          for (const l of laps as any[]) lapCounts.set(l.pilot, (lapCounts.get(l.pilot) || 0) + 1);
          seqSessions.push({
            id: sid,
            pilots,
            lapCounts,
            isFinished: s.end_time != null,
          });
        } catch {
          seqSessions.push({ id: sid, pilots: new Set(), lapCounts: new Map(), isFinished: false });
        }
      }

      const { groupCount: detectedGroups, qualifyingCount } = detectGroupsFromSessionSequence(seqSessions, compFormat);

      // Гонзалес: кількість раундів = MAX(12, унікальних пілотів з усіх квалі-сесій).
      // Перші `qualifyingCount` сесій у seqSessions — кваліфікаційні.
      let gonzalesRoundCount: number | undefined;
      if (compFormat === 'gonzales') {
        const qualiPilots = new Set<string>();
        for (let i = 0; i < qualifyingCount && i < seqSessions.length; i++) {
          for (const p of seqSessions[i].pilots) qualiPilots.add(p);
        }
        gonzalesRoundCount = Math.max(12, qualiPilots.size);
      }

      const phases = getPhasesForFormat(compFormat, detectedGroups, gonzalesRoundCount);
      const currentIdx = phases.findIndex(p => p.id === _phases[currentPhaseIdx]?.id);
      const effectiveIdx = currentIdx >= 0 ? currentIdx : Math.min(currentPhaseIdx, phases.length - 1);

      await apiPatch(`/competitions/${encodeURIComponent(compId)}`, {
        results: {
          autoDetectedGroups: detectedGroups,
          ...(gonzalesRoundCount != null ? { gonzalesRoundCount } : {}),
        },
      });

      const availableAfter = available
        .filter(s => s.start_time > currentTime)
        .sort((a, b) => a.start_time - b.start_time)
        .map(s => ({ id: s.merged_session_ids?.[0] || s.id }));

      const plan = planAutoLink({
        format: compFormat,
        groupCount: detectedGroups,
        currentPhaseIdx: effectiveIdx,
        availableSessionsAfter: availableAfter,
        gonzalesRoundCount,
      });

      for (const link of plan) {
        await apiPost(`/competitions/${encodeURIComponent(compId)}/link-session`, {
          sessionId: link.sessionId,
          phase: link.phaseId,
        });
      }
    } catch {}
  };

  const handleUnlink = async () => {
    if (!currentCompetitionId || !sessionId) return;
    try {
      await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/unlink-session`, { sessionId });
    } catch {}
    setStep('closed');
    onChanged?.();
  };

  const handleDeleteCompetition = async () => {
    if (!currentCompetitionId) return;
    try {
      await api.competitions.remove(currentCompetitionId);
    } catch {}
    setStep('closed');
    onChanged?.();
  };

  const handleChangePhaseAll = async (phaseId: string) => {
    if (!currentCompetitionId || !sessionId || !currentFormat) return;
    try {
      let comp: Competition;
      try { comp = await api.competitions.getNormalized(currentCompetitionId) as unknown as Competition; }
      catch { return; }
      const results = comp.results ?? {};
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
        try {
          const allSessions = await api.sessions.byDate(dateStr) as any as { id: string; start_time: number; end_time: number | null; competition_id?: string | null; merged_session_ids?: string[]; best_lap_time?: string | null }[];
          const after = allSessions
            .filter(s => s.end_time && isValidSession(s) && s.best_lap_time != null && s.start_time > currentTime && !s.competition_id && s.id !== sessionId)
            .sort((a, b) => a.start_time - b.start_time);
          const remainingPhases = allPhases.length - phaseIdx - 1;
          for (let i = 0; i < remainingPhases && i < after.length; i++) {
            const sid = after[i].merged_session_ids?.[0] || after[i].id;
            await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/link-session`, { sessionId: sid, phase: allPhases[phaseIdx + 1 + i].id });
          }
        } catch {}
      }
    } catch {}
    setStep('closed');
    onChanged?.();
  };

  const handleChangePhaseSingle = async (phaseId: string) => {
    if (!currentCompetitionId || !sessionId) return;
    try {
      // If phase is already taken by another session, unlink that session
      try {
        const comp = await api.competitions.get(currentCompetitionId) as unknown as Competition;
        const existing = comp.sessions.find(s => s.phase === phaseId && s.sessionId !== sessionId);
        if (existing) {
          await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/unlink-session`, { sessionId: existing.sessionId });
        }
      } catch {}
      await apiPost(`/competitions/${encodeURIComponent(currentCompetitionId)}/link-session`, { sessionId, phase: phaseId });
    } catch {}
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
