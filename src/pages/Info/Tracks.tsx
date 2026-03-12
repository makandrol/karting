import { useState } from 'react';
import { TRACK_CONFIGS } from '../../data/tracks';
import { useTrack } from '../../services/trackContext';
import { useAuth } from '../../services/auth';

export default function Tracks() {
  const { currentTrack, setCurrentTrack } = useTrack();
  const { hasPermission } = useAuth();
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null);
  const canChangeTrack = hasPermission('change_track');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">🏁 Конфігурації трас</h1>
        <p className="text-dark-400 text-sm">
          Картодром "Жага швидкості" має 11 різних конфігурацій траси.
          {canChangeTrack && ' Ви можете змінити поточну конфігурацію.'}
        </p>
      </div>

      {/* Current track indicator */}
      <div className="card flex items-center gap-4">
        <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold font-mono shrink-0">
          {currentTrack.id}
        </div>
        <div className="flex-1">
          <div className="text-white font-semibold">Поточна конфігурація: {currentTrack.name}</div>
          <div className="text-dark-400 text-sm">
            Довжина: {currentTrack.length} • Поворотів: {currentTrack.turns}
          </div>
        </div>
      </div>

      {/* All tracks grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TRACK_CONFIGS.map((track) => {
          const isCurrent = track.id === currentTrack.id;
          const isSelected = track.id === selectedTrack;

          return (
            <div
              key={track.id}
              className={`card p-0 overflow-hidden cursor-pointer transition-all ${
                isCurrent
                  ? 'border-primary-500 ring-1 ring-primary-500/30'
                  : isSelected
                    ? 'border-dark-500'
                    : 'hover:border-dark-600'
              }`}
              onClick={() => setSelectedTrack(isSelected ? null : track.id)}
            >
              <div className="relative">
                <img
                  src={track.image}
                  alt={track.name}
                  className="w-full aspect-[16/10] object-cover"
                />
                {isCurrent && (
                  <div className="absolute top-2 right-2 badge-live text-xs">
                    Активна
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white font-semibold">{track.name}</div>
                    <div className="text-dark-500 text-xs">
                      {track.length} • {track.turns} поворотів
                    </div>
                  </div>
                  {canChangeTrack && !isCurrent && isSelected && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentTrack(track.id);
                        setSelectedTrack(null);
                      }}
                      className="bg-primary-600 hover:bg-primary-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      Встановити
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
