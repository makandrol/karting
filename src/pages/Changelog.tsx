import { CHANGELOG, APP_VERSION } from '../data/changelog';

export default function Changelog() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">📋 Історія змін</h1>
        <p className="text-dark-400 text-sm">
          Поточна версія: <span className="text-primary-400 font-mono font-bold">v{APP_VERSION}</span>
        </p>
      </div>

      <div className="space-y-4">
        {CHANGELOG.map((entry, idx) => (
          <div key={entry.version} className={`card ${idx === 0 ? 'border-primary-500/30' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className={`font-mono font-bold text-lg ${idx === 0 ? 'text-primary-400' : 'text-dark-200'}`}>
                  v{entry.version}
                </span>
                {idx === 0 && (
                  <span className="bg-primary-600/20 text-primary-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    ПОТОЧНА
                  </span>
                )}
              </div>
              <span className="text-dark-500 text-xs font-mono">{entry.date}</span>
            </div>
            <h3 className="text-white font-semibold text-sm mb-2">{entry.title}</h3>
            <ul className="space-y-1">
              {entry.changes.map((change, ci) => (
                <li key={ci} className="text-dark-400 text-sm flex gap-2">
                  <span className="text-dark-600 shrink-0">•</span>
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
