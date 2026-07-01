import { useEffect, useState } from 'react';
import { api } from '../../services/api';

interface EditLogEntry {
  pilot: string;
  action: string;
  detail: string;
  user: string;
  ts: number;
}

/**
 * Журнал ручних змін змагання. Рендериться як окрема layout-секція
 * (`editLog`) на сторінці змагання, тож його позицію можна перетягувати
 * через панель "Вид:" (див. CompetitionLayoutWrapper).
 */
export default function CompetitionEditLog({ competitionId }: { competitionId: string }) {
  const [log, setLog] = useState<EditLogEntry[]>([]);

  useEffect(() => {
    api.competitions.getNormalized(competitionId)
      .then(c => setLog((c.results.editLog || []).slice().reverse()))
      .catch(() => {});
  }, [competitionId]);

  return (
    <div className="card p-0 overflow-hidden max-h-60 overflow-y-auto">
      {log.length === 0 ? (
        <div className="px-4 py-3 text-dark-600 text-[10px]">Немає записів</div>
      ) : (
        <table className="text-[10px]" style={{ tableLayout: 'auto', width: 'auto' }}>
          <thead><tr className="bg-dark-800/50 sticky top-0">
            <th className="px-2 py-1 text-left text-dark-400">Час</th>
            <th className="px-2 py-1 text-left text-dark-400">Користувач</th>
            <th className="px-2 py-1 text-left text-dark-400">Пілот</th>
            <th className="px-2 py-1 text-left text-dark-400">Дія</th>
          </tr></thead>
          <tbody>
            {log.map((entry, i) => (
              <tr key={i} className="border-b border-dark-800/50">
                <td className="px-2 py-1 text-dark-500 whitespace-nowrap">{new Date(entry.ts).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                <td className="px-2 py-1 text-dark-400">{entry.user.split('@')[0]}</td>
                <td className="px-2 py-1 text-white">{entry.pilot}</td>
                <td className="px-2 py-1 text-dark-300">{entry.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
