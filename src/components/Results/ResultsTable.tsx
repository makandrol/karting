import type { RaceResult } from '../../types';

interface ResultsTableProps {
  results: RaceResult[];
  title?: string;
}

export default function ResultsTable({ results, title }: ResultsTableProps) {
  return (
    <div className="card p-0 overflow-hidden">
      {title && (
        <div className="px-4 py-3 border-b border-dark-800">
          <h3 className="text-white font-semibold">{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-12">#</th>
              <th className="table-cell text-left">Пілот</th>
              <th className="table-cell text-center">Карт</th>
              <th className="table-cell text-right">Найкраще коло</th>
              <th className="table-cell text-right">Загальний час</th>
              <th className="table-cell text-center">Кола</th>
              <th className="table-cell text-right">Відставання</th>
              <th className="table-cell text-center">Очки</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={`${r.pilot}-${r.position}`} className="table-row">
                <td className="table-cell text-center font-mono font-bold text-white">
                  {r.position}
                </td>
                <td className="table-cell text-left font-medium text-white">
                  {r.pilot}
                </td>
                <td className="table-cell text-center font-mono text-dark-300">
                  {r.kart || '—'}
                </td>
                <td className="table-cell text-right font-mono text-green-400">
                  {r.bestLap || '—'}
                </td>
                <td className="table-cell text-right font-mono text-dark-200">
                  {r.totalTime || '—'}
                </td>
                <td className="table-cell text-center font-mono text-dark-400">
                  {r.laps || '—'}
                </td>
                <td className="table-cell text-right font-mono text-dark-400 text-sm">
                  {r.gap || '—'}
                </td>
                <td className="table-cell text-center font-bold text-primary-400">
                  {r.points || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
