import { useState } from 'react';
import { FORMAT_DEFAULT_RACE_PILOTS } from '../../utils/competitionLinking';

interface CompetitionParamsProps {
  pilotCount: number;
  pilotOverride: number | null;
  pilotLocked: boolean;
  groupOverride: number | null;
  autoGroups: number;
  maxGroups: number;
  canManage: boolean;
  onSave: (partial: Record<string, any>) => Promise<void>;
  format?: string;
  racePilotCount?: number | null;
}

/**
 * Тригер: 3 поля з emoji-іконками + auto-toggle "А" біля кожного.
 * 👥 Пілотів  🔢 Груп  🏁 Пілотів у гонці (тільки LL/CL/Sprint)
 *
 * Винесено з CompetitionPage.tsx у v0.9.440.
 */
export default function CompetitionParams({
  pilotCount, pilotOverride, pilotLocked,
  groupOverride, autoGroups, maxGroups, canManage,
  onSave, format, racePilotCount,
}: CompetitionParamsProps) {
  const effectivePilots = (pilotLocked && pilotOverride !== null) ? pilotOverride : pilotCount;
  const effectiveGroups = groupOverride ?? autoGroups;
  const pilotsAuto = pilotOverride === null;
  const groupsAuto = groupOverride === null;

  const defaultRacePilots = FORMAT_DEFAULT_RACE_PILOTS[format ?? ''] ?? 36;
  const autoRacePilots = Math.min(defaultRacePilots, effectivePilots);
  const effectiveRacePilots = racePilotCount ?? autoRacePilots;
  const racePilotsAuto = racePilotCount == null;

  const [pilotDraft, setPilotDraft] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<string | null>(null);
  const [racePilotDraft, setRacePilotDraft] = useState<string | null>(null);

  const commitPilots = () => {
    if (pilotDraft === null) return;
    const v = parseInt(pilotDraft);
    if (!isNaN(v) && v > 0) onSave({ totalPilotsOverride: v, totalPilotsLocked: true });
    setPilotDraft(null);
  };
  const commitGroups = () => {
    if (groupDraft === null) return;
    const v = parseInt(groupDraft);
    if (!isNaN(v) && v > 0 && v <= maxGroups) onSave({ groupCountOverride: v });
    setGroupDraft(null);
  };
  const commitRacePilots = () => {
    if (racePilotDraft === null) return;
    const v = parseInt(racePilotDraft);
    if (!isNaN(v) && v > 0) onSave({ racePilotCount: v });
    setRacePilotDraft(null);
  };

  return (
    <div className="flex items-center gap-3 text-xs">
      {/* Pilots */}
      <div className="border border-dark-700 rounded px-2 py-1 flex items-center gap-1">
        <span title="Пілоти">👥</span>
        {canManage ? (
          <input type="text" inputMode="numeric"
            value={pilotDraft !== null ? pilotDraft : effectivePilots}
            onChange={e => setPilotDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitPilots(); }}
            onBlur={commitPilots}
            disabled={pilotsAuto}
            className={`w-8 bg-transparent text-center font-mono outline-none border-b border-dark-700 focus:border-primary-500 ${pilotsAuto ? 'text-dark-500 cursor-default' : 'text-dark-300'}`} />
        ) : (
          <span className="text-dark-300 font-mono">{effectivePilots || '—'}</span>
        )}
        {canManage && (
          <button onClick={() => onSave({ totalPilotsOverride: pilotsAuto ? effectivePilots : null, totalPilotsLocked: pilotsAuto })}
            className={`text-[10px] font-bold transition-colors ${pilotsAuto ? 'bg-red-600 text-white px-1 rounded' : 'text-dark-500 hover:text-dark-300'}`}
            title={pilotsAuto ? 'Вимкнути авто' : 'Включити авто'}>
            А
          </button>
        )}
      </div>

      {/* Groups */}
      <div className="border border-dark-700 rounded px-2 py-1 flex items-center gap-1">
        <span title="Групи">🔢</span>
        {canManage ? (
          <input type="text" inputMode="numeric"
            value={groupDraft !== null ? groupDraft : effectiveGroups}
            onChange={e => setGroupDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitGroups(); }}
            onBlur={commitGroups}
            disabled={groupsAuto}
            className={`w-8 bg-transparent text-center font-mono outline-none border-b border-dark-700 focus:border-primary-500 ${groupsAuto ? 'text-dark-500 cursor-default' : 'text-dark-300'}`} />
        ) : (
          <span className="text-dark-300 font-mono">{effectiveGroups}</span>
        )}
        {canManage && (
          <button onClick={() => onSave({ groupCountOverride: groupsAuto ? effectiveGroups : null })}
            className={`text-[10px] font-bold transition-colors ${groupsAuto ? 'bg-red-600 text-white px-1 rounded' : 'text-dark-500 hover:text-dark-300'}`}
            title={groupsAuto ? 'Вимкнути авто' : 'Включити авто'}>
            А
          </button>
        )}
      </div>

      {(format === 'light_league' || format === 'champions_league' || format === 'sprint') && (
        <div className="border border-dark-700 rounded px-2 py-1 flex items-center gap-1">
          <span title="Пілотів у гонці">🏁</span>
          {canManage ? (
            <input type="text" inputMode="numeric"
              value={racePilotDraft !== null ? racePilotDraft : effectiveRacePilots}
              onChange={e => setRacePilotDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRacePilots(); }}
              onBlur={commitRacePilots}
              disabled={racePilotsAuto}
              className={`w-8 bg-transparent text-center font-mono outline-none border-b border-dark-700 focus:border-primary-500 ${racePilotsAuto ? 'text-dark-500 cursor-default' : 'text-dark-300'}`} />
          ) : (
            <span className="text-dark-300 font-mono">{effectiveRacePilots}</span>
          )}
          {canManage && (
            <button onClick={() => onSave({ racePilotCount: racePilotsAuto ? effectiveRacePilots : null })}
              className={`text-[10px] font-bold transition-colors ${racePilotsAuto ? 'bg-red-600 text-white px-1 rounded' : 'text-dark-500 hover:text-dark-300'}`}
              title={racePilotsAuto ? 'Вимкнути авто' : 'Включити авто'}>
              А
            </button>
          )}
        </div>
      )}
    </div>
  );
}
