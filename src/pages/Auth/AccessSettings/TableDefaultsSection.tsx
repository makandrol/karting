import { useState, useRef } from 'react';
import { useLayoutPrefs, PAGE_SECTIONS, type SectionPref } from '../../../services/layoutPrefs';

const PAGE_LABELS: Record<string, string> = {
  timing: 'Таймінг',
  sessionDetail: 'Деталі заїзду',
  competition: 'Змагання (ЛЛ / ЛЧ)',
};

export default function TableDefaultsSection() {
  const { serverDefaults, saveServerDefaults, refreshServerDefaults } = useLayoutPrefs();
  const [local, setLocal] = useState<Record<string, SectionPref[]>>(() => {
    const result: Record<string, SectionPref[]> = {};
    for (const [pageId, sections] of Object.entries(PAGE_SECTIONS)) {
      const server = serverDefaults[pageId];
      result[pageId] = server ? [...server.sections] : sections.map(s => ({ id: s.id, visible: true }));
    }
    return result;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dragState, setDragState] = useState<{ pageId: string; fromIdx: number } | null>(null);
  const wasDragged = useRef(false);

  const handleToggle = (pageId: string, sectionId: string) => {
    if (wasDragged.current) { wasDragged.current = false; return; }
    setLocal(prev => ({
      ...prev,
      [pageId]: prev[pageId].map(s => s.id === sectionId ? { ...s, visible: !s.visible } : s),
    }));
    setSaved(false);
  };

  const handleDragStart = (pageId: string, idx: number) => {
    setDragState({ pageId, fromIdx: idx });
    wasDragged.current = false;
  };

  const handleDrop = (pageId: string, toIdx: number) => {
    if (!dragState || dragState.pageId !== pageId || dragState.fromIdx === toIdx) {
      setDragState(null);
      return;
    }
    wasDragged.current = true;
    setLocal(prev => {
      const arr = [...prev[pageId]];
      const [moved] = arr.splice(dragState.fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...prev, [pageId]: arr };
    });
    setDragState(null);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const defaults: Record<string, { sections: SectionPref[]; version: number }> = {};
    for (const [pageId, sections] of Object.entries(local)) {
      const prevVersion = serverDefaults[pageId]?.version ?? 0;
      defaults[pageId] = { sections, version: prevVersion + 1 };
    }
    try {
      await saveServerDefaults(defaults);
      await refreshServerDefaults();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Дефолтні настройки таблиць</h2>
        <p className="text-dark-400 text-sm">Порядок та видимість секцій на сторінках (для нових користувачів)</p>
      </div>

      {Object.entries(PAGE_SECTIONS).map(([pageId, sections]) => (
        <div key={pageId} className="card">
          <h3 className="text-white font-semibold mb-3">{PAGE_LABELS[pageId] || pageId}</h3>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(local[pageId] || []).map((pref, i) => {
              const meta = sections.find(s => s.id === pref.id);
              if (!meta) return null;
              const isDragging = dragState?.pageId === pageId && dragState.fromIdx === i;
              return (
                <button
                  key={pref.id}
                  draggable
                  onClick={() => handleToggle(pageId, pref.id)}
                  onDragStart={() => handleDragStart(pageId, i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(pageId, i)}
                  onDragEnd={() => setDragState(null)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-grab active:cursor-grabbing select-none ${
                    isDragging ? 'opacity-40 ring-1 ring-primary-400' :
                    pref.visible ? 'bg-green-500/20 text-green-400' : 'bg-dark-800 text-dark-500 hover:text-dark-300'
                  }`}
                >
                  {pref.visible ? '✓ ' : ''}{meta.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button
        onClick={handleSave}
        disabled={saving}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          saved ? 'bg-green-500/20 text-green-400' :
          saving ? 'bg-dark-800 text-dark-500 cursor-wait' :
          'bg-primary-600 text-white hover:bg-primary-500'
        }`}
      >
        {saved ? 'Збережено ✓' : saving ? 'Зберігається...' : 'Зберегти для всіх'}
      </button>
    </div>
  );
}
