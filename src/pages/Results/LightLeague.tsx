import { useState } from 'react';
import { ResultsTable } from '../../components/Results';
import { MOCK_LIGHT_LEAGUE_RESULTS } from '../../mock/timingData';

export default function LightLeague() {
  const [selectedRound, setSelectedRound] = useState(0);
  const data = MOCK_LIGHT_LEAGUE_RESULTS;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">⭐ {data.name}</h1>
        <p className="text-dark-400 text-sm">
          Ліга для новачків та аматорів. Ідеальне місце для початку змагальної кар'єри.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {data.rounds.map((round, i) => (
          <button
            key={i}
            onClick={() => setSelectedRound(i)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedRound === i
                ? 'bg-primary-600 text-white'
                : 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700'
            }`}
          >
            {round.name}
            <span className="ml-2 text-xs opacity-60">{round.date}</span>
          </button>
        ))}
      </div>

      <ResultsTable
        results={data.rounds[selectedRound].results}
        title={data.rounds[selectedRound].name}
      />
    </div>
  );
}
