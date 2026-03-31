import { useState, useEffect } from 'react';

interface OvertakeRule {
  startPosMin: number;
  startPosMax: number;
  perOvertake: number;
}

interface ScoringData {
  positionPoints: {
    label: string;
    minPilots: number;
    maxPilots: number;
    groups: Record<string, number[]>;
  }[];
  overtakePoints: {
    groupI: OvertakeRule[];
    groupII: number;
    groupIII: number;
  };
  speedPoints: number[];
}

export default function ScoringSettings() {
  const [data, setData] = useState<ScoringData | null>(null);
  const [editing, setEditing] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/data/scoring.json')
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const startEdit = () => {
    setJsonText(JSON.stringify(data, null, 2));
    setEditing(true);
    setError('');
  };

  const saveEdit = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed.positionPoints || !parsed.speedPoints || !parsed.overtakePoints) throw new Error('Invalid format');
      setData(parsed);
      setEditing(false);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Invalid JSON');
    }
  };

  if (!data) return <div className="card text-center py-12 text-dark-500">Завантаження...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Бали за змагання</h1>
        {!editing ? (
          <button onClick={startEdit} className="px-3 py-1.5 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-500 transition-colors">
            Редагувати JSON
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={saveEdit} className="px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-500 transition-colors">Зберегти</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 bg-dark-700 text-dark-300 text-xs rounded-lg hover:bg-dark-600 transition-colors">Скасувати</button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {error && <div className="text-red-400 text-sm">{error}</div>}
          <textarea
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            className="w-full h-[600px] bg-dark-800 border border-dark-700 rounded-xl p-4 text-dark-300 text-xs font-mono outline-none focus:border-primary-500"
          />
        </div>
      ) : (
        <>
          {/* Speed points */}
          <div className="card p-4">
            <h3 className="text-white font-semibold text-sm mb-3">Бали за швидкість (топ-5 найшвидших кіл)</h3>
            <div className="flex gap-4">
              {data.speedPoints.map((p, i) => (
                <div key={i} className="text-center">
                  <div className="text-dark-500 text-[10px]">#{i + 1}</div>
                  <div className="text-green-400 font-mono font-bold text-lg">{p}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Position points */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-dark-800">
              <h3 className="text-white font-semibold text-sm">Бали за фінальну позицію</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-dark-800/50">
                    <th className="px-2 py-1.5 text-left text-dark-300">Категорія</th>
                    <th className="px-2 py-1.5 text-center text-dark-300">Група</th>
                    {Array.from({ length: 13 }, (_, i) => (
                      <th key={i} className="px-1.5 py-1.5 text-center text-dark-400">{i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.positionPoints.map((cat, ci) =>
                    Object.entries(cat.groups).map(([group, points], gi) => (
                      <tr key={`${cat.label}-${group}`} className={`border-b border-dark-800/50 ${gi === 0 && ci > 0 ? 'border-t-2 border-t-dark-600' : ''}`}>
                        {gi === 0 && (
                          <td rowSpan={Object.keys(cat.groups).length} className="px-2 py-1 text-dark-300 border-r border-dark-700 whitespace-nowrap">
                            {cat.label}
                          </td>
                        )}
                        <td className="px-2 py-1 text-center text-purple-400 font-medium border-r border-dark-700">{group}</td>
                        {Array.from({ length: 13 }, (_, pi) => (
                          <td key={pi} className="px-1.5 py-1 text-center font-mono text-dark-300">
                            {points[pi] !== undefined ? points[pi] : ''}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Overtake points */}
          <div className="card p-4 space-y-4">
            <h3 className="text-white font-semibold text-sm">Бали за обгони</h3>

            <div>
              <h4 className="text-dark-400 text-xs mb-2">Група I (за 1 обгон)</h4>
              <div className="overflow-x-auto">
                <table className="text-[10px]">
                  <thead>
                    <tr className="bg-dark-800/50">
                      <th className="px-2 py-1 text-left text-dark-300">Стартова позиція</th>
                      <th className="px-2 py-1 text-center text-dark-300">Бали за обгон</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.overtakePoints.groupI.map((rule, i) => (
                      <tr key={i} className="border-b border-dark-800/50">
                        <td className="px-2 py-1 text-dark-300">
                          {rule.startPosMin === rule.startPosMax ? `${rule.startPosMin} місце` :
                           rule.startPosMax >= 99 ? `${rule.startPosMin}+ місце` :
                           `${rule.startPosMin}-${rule.startPosMax} місце`}
                        </td>
                        <td className="px-2 py-1 text-center font-mono text-green-400 font-bold">{rule.perOvertake}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-8">
              <div>
                <h4 className="text-dark-400 text-xs mb-1">Група II</h4>
                <div className="text-green-400 font-mono font-bold text-lg">{data.overtakePoints.groupII} за обгон</div>
              </div>
              <div>
                <h4 className="text-dark-400 text-xs mb-1">Група III</h4>
                <div className="text-green-400 font-mono font-bold text-lg">{data.overtakePoints.groupIII} за обгон</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
