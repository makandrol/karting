import { trackDisplayId } from '../../data/tracks';

const BASE_IDS = Array.from({ length: 11 }, (_, i) => i + 1);
const REVERSE_IDS = BASE_IDS.map(id => id + 100);
export const ALL_TRACK_IDS = [...BASE_IDS, ...REVERSE_IDS];

interface TrackFilterProps {
  selected: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export default function TrackFilter({ selected, onToggle, onSelectAll, onClearAll }: TrackFilterProps) {
  const allSelected = ALL_TRACK_IDS.every(id => selected.has(id));
  const noneSelected = selected.size === 0;

  const Row = ({ ids }: { ids: number[] }) => (
    <div className="grid grid-cols-11 gap-1">
      {ids.map(id => {
        const isActive = selected.has(id);
        return (
          <button
            key={id}
            onClick={() => onToggle(id)}
            className={`px-1 py-0.5 rounded text-[11px] font-medium transition-colors text-center ${
              isActive
                ? 'bg-primary-600 text-white ring-1 ring-primary-400'
                : 'bg-dark-800 text-dark-400 hover:text-white hover:bg-dark-700'
            }`}
          >
            {trackDisplayId(id)}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Траси</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onSelectAll}
            disabled={allSelected}
            className="text-primary-400 text-[10px] hover:text-primary-300 transition-colors disabled:text-dark-700 disabled:cursor-default"
          >вибрати всі</button>
          <span className="text-dark-700">|</span>
          <button
            onClick={onClearAll}
            disabled={noneSelected}
            className="text-red-400/60 text-[10px] hover:text-red-400 transition-colors disabled:text-dark-700 disabled:cursor-default"
          >прибрати всі</button>
        </div>
      </div>
      <Row ids={BASE_IDS} />
      <Row ids={REVERSE_IDS} />
    </div>
  );
}
