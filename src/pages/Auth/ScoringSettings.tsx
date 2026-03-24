import { useState, useEffect } from 'react';

interface ScoringData {
  positionPoints: {
    label: string;
    minPilots: number;
    maxPilots: number;
    groups: Record<string, number[]>;
  }[];
  overtakesGroup1: number[][];
  overtakesGroup2: number[];
  overtakesGroup3: number[];
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
      if (!parsed.positionPoints || !parsed.speedPoints) throw new Error('Invalid format');
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
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-dark-800">
              <h3 className="text-white font-semibold text-sm">Бали за швидкість (топ-5)</h3>
            </div>
            <div className="p-4">
              <div className="flex gap-4">
                {data.speedPoints.map((p, i) => (
                  <div key={i} className="text-center">
                    <div className="text-dark-500 text-[10px]">#{i + 1}</div>
                    <div className="text-green-400 font-mono font-bold">{p}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Position points */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-dark-800">
              <h3 className="text-white font-semibold text-sm">Бали за позицію</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-dark-800/50">
                    <th className="px-2 py-1.5 text-left text-dark-300">Категорія</th>
                    <th className="px-2 py-1.5 text-center text-dark-300">Група</th>
                    <th className="px-2 py-1.5 text-center text-dark-300" colSpan={13}>Позиція 1-13</th>
                  </tr>
                </thead>
                <tbody>
                  {data.positionPoints.map(cat => (
                    Object.entries(cat.groups).map(([group, points], gi) => (
                      <tr key={`${cat.label}-${group}`} className="border-b border-dark-800/50">
                        {gi === 0 && (
                          <td rowSpan={Object.keys(cat.groups).length} className="px-2 py-1 text-dark-300 border-r border-dark-700">
                            {cat.label}
                          </td>
                        )}
                        <td className="px-2 py-1 text-center text-dark-400 border-r border-dark-700">{group}</td>
                        {points.map((p, pi) => (
                          <td key={pi} className="px-1.5 py-1 text-center font-mono text-dark-300">{p}</td>
                        ))}
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Overtakes group 1 */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-dark-800">
              <h3 className="text-white font-semibold text-sm">Бали за обгони — Група I</h3>
              <p className="text-dark-500 text-[10px]">Рядки = кількість обгонів, Колонки = стартова позиція (з 14-ї до 3-ї)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-dark-800/50">
                    <th className="px-2 py-1 text-center text-dark-300">Обгонів</th>
                    {data.overtakesGroup1[0]?.map((_, i) => (
                      <th key={i} className="px-1.5 py-1 text-center text-dark-400">з {14 - i}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.overtakesGroup1.map((row, ri) => (
                    <tr key={ri} className="border-b border-dark-800/50">
                      <td className="px-2 py-1 text-center font-mono text-dark-400">{ri + 1}</td>
                      {row.map((val, ci) => (
                        <td key={ci} className="px-1.5 py-1 text-center font-mono text-dark-300">{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Overtakes groups 2-3 */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-dark-800">
              <h3 className="text-white font-semibold text-sm">Бали за обгони — Групи II та III</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-dark-800/50">
                    <th className="px-2 py-1 text-center text-dark-300">Обгонів</th>
                    <th className="px-2 py-1 text-center text-dark-300">Група II</th>
                    <th className="px-2 py-1 text-center text-dark-300">Група III</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overtakesGroup2.map((val, i) => (
                    <tr key={i} className="border-b border-dark-800/50">
                      <td className="px-2 py-1 text-center font-mono text-dark-400">{i + 1}</td>
                      <td className="px-2 py-1 text-center font-mono text-dark-300">{val}</td>
                      <td className="px-2 py-1 text-center font-mono text-dark-300">{data.overtakesGroup3[i] ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
