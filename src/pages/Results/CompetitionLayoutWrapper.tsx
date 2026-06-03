import { type ReactNode } from 'react';
import CompetitionTimeline from '../../components/Results/CompetitionTimeline';
import { useLayoutPrefs } from '../../services/layoutPrefs';
import type { Competition } from './competition-types';

interface CompetitionLayoutWrapperProps {
  sessionTimes: { sessionId: string; phase: string | null; startTime: number; endTime: number | null }[];
  competition: Competition;
  scrubTime: number | null;
  setScrubTime: (t: number | null) => void;
  allSessionsEnded: boolean;
  setLiveEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  groupCount?: number;
  children: Record<string, ReactNode>;
}

/**
 * Render-обгортка для секцій сторінки змагання, керована layoutPrefs:
 * `competition` сторінка має draggable секції з server-side defaults.
 * Спеціальна секція `timeline` рендериться вбудовано (бо не передається
 * через children — вона має знати про scrub).
 *
 * Винесено з CompetitionPage.tsx у v0.9.440.
 */
export default function CompetitionLayoutWrapper({
  sessionTimes, competition, scrubTime, setScrubTime,
  allSessionsEnded, setLiveEnabled, groupCount, children,
}: CompetitionLayoutWrapperProps) {
  const { isSectionVisible, getPageLayout } = useLayoutPrefs();

  const layout = getPageLayout('competition');

  const renderSection = (sectionId: string) => {
    if (!isSectionVisible('competition', sectionId)) return null;
    if (sectionId === 'timeline') {
      if (sessionTimes.length === 0) return null;
      return (
        <CompetitionTimeline
          key="timeline"
          format={competition.format}
          groupCount={groupCount}
          sessions={competition.sessions}
          sessionTimes={sessionTimes}
          currentTime={scrubTime}
          onTimeChange={(t) => { setScrubTime(t); if (t !== null) setLiveEnabled(false); else setLiveEnabled(true); }}
          isLive={competition.status === 'live' && !allSessionsEnded}
        />
      );
    }
    if (children[sectionId] !== undefined) return children[sectionId];
    return null;
  };

  return (
    <div className="space-y-4">
      {layout.map(s => renderSection(s.id))}
    </div>
  );
}
