import { useCallback, useRef, useState } from 'react';
import { useLayoutPrefs, type PageLayout } from '../services/layoutPrefs';

interface Props {
  pageId: string;
  sections: { id: string; label: string }[];
}

export default function TableLayoutBar({ pageId, sections }: Props) {
  const { getPageLayout, toggleSection, reorderSections } = useLayoutPrefs();
  const layout = getPageLayout(pageId);
  const dragFromIdx = useRef<number | null>(null);
  const [previewOrder, setPreviewOrder] = useState<{ id: string; label: string }[] | null>(null);

  const ordered = sortByLayout(sections, layout);

  const handleDragStart = useCallback((idx: number, e: React.DragEvent<HTMLButtonElement>) => {
    dragFromIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }, []);

  const calcPreview = useCallback((toIdx: number) => {
    const from = dragFromIdx.current;
    if (from === null || from === toIdx) return ordered;
    const arr = [...ordered];
    const [moved] = arr.splice(from, 1);
    arr.splice(toIdx, 0, moved);
    return arr;
  }, [ordered]);

  const getDropIdx = useCallback((e: React.DragEvent) => {
    const bar = e.currentTarget as HTMLElement;
    const pills = bar.querySelectorAll<HTMLElement>('[data-pill-idx]');
    const x = e.clientX;
    let closest = pills.length;
    let minDist = Infinity;
    pills.forEach((pill) => {
      const rect = pill.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const dist = Math.abs(x - center);
      if (dist < minDist) {
        minDist = dist;
        closest = x < center
          ? parseInt(pill.dataset.pillIdx!)
          : parseInt(pill.dataset.pillIdx!) + 1;
      }
    });
    const from = dragFromIdx.current ?? 0;
    if (closest > from) closest = Math.max(closest - 1, 0);
    return Math.min(closest, ordered.length - 1);
  }, [ordered]);

  const handleBarDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dragFromIdx.current === null) return;
    const toIdx = getDropIdx(e);
    setPreviewOrder(calcPreview(toIdx));
  }, [getDropIdx, calcPreview]);

  const handleBarDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const from = dragFromIdx.current;
    if (from === null) return;
    const toIdx = getDropIdx(e);
    if (from !== toIdx) {
      const layoutIdx = (i: number) => layout.findIndex(l => l.id === ordered[i].id);
      reorderSections(pageId, layoutIdx(from), layoutIdx(toIdx));
    }
    dragFromIdx.current = null;
    setPreviewOrder(null);
  }, [pageId, layout, ordered, reorderSections, getDropIdx]);

  const handleDragEnd = useCallback(() => {
    dragFromIdx.current = null;
    setPreviewOrder(null);
  }, []);

  if (sections.length < 2) return null;

  const displayed = previewOrder ?? ordered;
  const dragging = dragFromIdx.current !== null;
  const draggedId = dragFromIdx.current !== null ? ordered[dragFromIdx.current]?.id : null;

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap border border-dark-700 rounded-lg px-2.5 py-1.5 w-fit"
      onDragOver={handleBarDragOver}
      onDrop={handleBarDrop}
    >
      <span className="text-dark-500 text-[9px]">Вид:</span>
      {displayed.map((s, i) => {
        const pref = layout.find(p => p.id === s.id);
        const visible = pref?.visible !== false;
        const isDragged = dragging && s.id === draggedId;
        const originalIdx = ordered.findIndex(o => o.id === s.id);
        return (
          <button
            key={s.id}
            data-pill-idx={i}
            draggable
            onClick={() => toggleSection(pageId, s.id)}
            onDragStart={(e) => handleDragStart(originalIdx, e)}
            onDragEnd={handleDragEnd}
            className={`px-1.5 py-0.5 rounded text-[9px] transition-colors select-none ${
              isDragged ? 'opacity-40' : ''
            } ${
              visible ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function sortByLayout(sections: { id: string; label: string }[], layout: PageLayout): { id: string; label: string }[] {
  const order = new Map(layout.map((s, i) => [s.id, i]));
  return [...sections].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}
