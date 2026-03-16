import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ALL_COMPETITION_EVENTS } from '../../mock/competitionEvents';

export default function SessionsList() {
  // Group events by date
  const eventsByDate = new Map<string, typeof ALL_COMPETITION_EVENTS>();
  for (const ev of ALL_COMPETITION_EVENTS) {
    const list = eventsByDate.get(ev.date) || [];
    list.push(ev);
    eventsByDate.set(ev.date, list);
  }
  const dates = [...eventsByDate.keys()].sort().reverse();
  const [selectedDate, setSelectedDate] = useState(dates[0] || '');
  const events = eventsByDate.get(selectedDate) || [];

  const FORMAT_MAP: Record<string, string> = {
    gonzales: 'gonzales',
    light_league: 'light-league',
    champions_league: 'champions-league',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">📅 Заїзди</h1>
        <p className="text-dark-400 text-sm">Історія змагань та заїздів</p>
      </div>

      {/* Date picker */}
      <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
        {dates.map((d) => (
          <button
            key={d}
            onClick={() => setSelectedDate(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              d === selectedDate ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700'
            }`}
          >
            {new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', weekday: 'short' })}
          </button>
        ))}
      </div>

      {/* Events for date */}
      {events.length === 0 ? (
        <div className="card text-center py-8 text-dark-500">Немає заїздів за цей день</div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => {
            const urlType = FORMAT_MAP[ev.format] || ev.format;
            return (
              <Link key={ev.id} to={`/results/${urlType}/${ev.id}`}
                className="card flex items-center justify-between hover:border-dark-600 transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-dark-800 rounded-xl flex items-center justify-center text-xl group-hover:bg-primary-600 transition-colors">
                    {ev.format === 'gonzales' ? '🏆' : ev.format === 'light_league' ? '⭐' : '👑'}
                  </div>
                  <div>
                    <div className="text-white font-semibold group-hover:text-primary-400 transition-colors">
                      {ev.name}
                    </div>
                    <div className="text-dark-500 text-xs">
                      Траса {ev.trackConfigId} • {ev.phases.length} фаз • {ev.phases[0]?.results?.length || 0} пілотів
                    </div>
                  </div>
                </div>
                <div className="text-dark-400 text-xs">
                  {ev.phases.map(p => p.name).slice(0, 3).join(', ')}
                  {ev.phases.length > 3 && ` +${ev.phases.length - 3}`}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
