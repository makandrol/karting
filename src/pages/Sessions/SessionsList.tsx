import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getAllDates, getSessionsByDate } from '../../mock/sessionData';

export default function SessionsList() {
  const dates = getAllDates();
  const [selectedDate, setSelectedDate] = useState(dates[dates.length - 1] || '');
  const sessions = getSessionsByDate(selectedDate);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">📅 Заїзди</h1>
        <p className="text-dark-400 text-sm">Виберіть день щоб побачити всі заїзди</p>
      </div>

      {/* Date picker */}
      <div className="flex flex-wrap gap-2">
        {dates.map((d) => (
          <button
            key={d}
            onClick={() => setSelectedDate(d)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              d === selectedDate ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700'
            }`}
          >
            {new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', weekday: 'short' })}
          </button>
        ))}
      </div>

      {/* Sessions */}
      {sessions.length === 0 ? (
        <div className="card text-center py-8 text-dark-500">Немає заїздів за цей день</div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Link key={s.id} to={`/sessions/${s.id}`} className="card flex items-center justify-between hover:border-dark-600 transition-colors group">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-dark-800 rounded-xl flex items-center justify-center font-mono font-bold text-xl text-white group-hover:bg-primary-600 transition-colors">
                  {s.number}
                </div>
                <div>
                  <div className="text-white font-semibold group-hover:text-primary-400 transition-colors">
                    Заїзд #{s.number}
                    {s.competitionName && (
                      <span className="ml-2 text-xs text-primary-400 font-normal">{s.competitionName}</span>
                    )}
                  </div>
                  <div className="text-dark-500 text-xs">
                    {s.startTime.slice(0, 5)} – {s.endTime.slice(0, 5)} • {s.pilots.length} пілотів •
                    <span className={s.competitionName ? 'text-primary-400/60' : 'text-dark-600'}>
                      {' '}{s.competitionName ? s.type === 'qualifying' ? 'Квала' : s.type === 'gonzales_round' ? 'Раунд' : 'Гонка' : 'Прокат'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-dark-300 font-mono text-sm">{s.laps.length} кіл</div>
                <div className="text-dark-500 text-xs">
                  {s.pilots.slice(0, 3).join(', ')}{s.pilots.length > 3 ? ` +${s.pilots.length - 3}` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
