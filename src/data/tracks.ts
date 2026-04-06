export interface TrackPoint {
  x: number;
  y: number;
}

export interface SpeedProfilePoint {
  progress: number;
  time: number;
}

export interface TrackConfig {
  id: number;
  name: string;
  length: string;
  image: string;
  turns: number;
  svgPath: string;
  s1Point: TrackPoint | null;
  /** Час S1 в секундах для reference кола (наприклад 18.2с для 42с кола) */
  s1Time: number;
  gridPositions: TrackPoint[];
  pitPositions: TrackPoint[];
  speedProfile: SpeedProfilePoint[];
  referenceLapTime: number;
  /** true для реверсних конфігурацій */
  reverse: boolean;
}

/** Всі картинки трас 1280×720 */
export const TRACK_SVG_VIEWBOX = '0 0 1280 720';

/** ID реверсної траси = baseId + 100 */
export const REVERSE_OFFSET = 100;

export function isReverseTrack(id: number): boolean {
  return id > REVERSE_OFFSET;
}

export function baseTrackId(id: number): number {
  return id > REVERSE_OFFSET ? id - REVERSE_OFFSET : id;
}

export function trackDisplayId(id: number): string {
  return id > REVERSE_OFFSET ? `${id - REVERSE_OFFSET}R` : String(id);
}

/** Базова інфо про треки (без даних шляхів) */
const TRACK_BASE: Omit<TrackConfig, 'svgPath' | 's1Point' | 's1Time' | 'gridPositions' | 'pitPositions' | 'speedProfile' | 'referenceLapTime'>[] = [
  { id: 1,  name: 'Конфігурація №1',  length: '510m',  image: '/tracks/nfs_01.jpg', turns: 13, reverse: false },
  { id: 2,  name: 'Конфігурація №2',  length: 'XXX m', image: '/tracks/nfs_02.jpg', turns: 12, reverse: false },
  { id: 3,  name: 'Конфігурація №3',  length: '506m',  image: '/tracks/nfs_03.jpg', turns: 13, reverse: false },
  { id: 4,  name: 'Конфігурація №4',  length: 'XXX m', image: '/tracks/nfs_04.jpg', turns: 11, reverse: false },
  { id: 5,  name: 'Конфігурація №5',  length: 'XXX m', image: '/tracks/nfs_05.jpg', turns: 16, reverse: false },
  { id: 6,  name: 'Конфігурація №6',  length: 'XXX m', image: '/tracks/nfs_06.jpg', turns: 14, reverse: false },
  { id: 7,  name: 'Конфігурація №7',  length: 'XXX m', image: '/tracks/nfs_07.jpg', turns: 15, reverse: false },
  { id: 8,  name: 'Конфігурація №8',  length: 'XXX m', image: '/tracks/nfs_08.jpg', turns: 12, reverse: false },
  { id: 9,  name: 'Конфігурація №9',  length: 'XXX m', image: '/tracks/nfs_09.jpg', turns: 13, reverse: false },
  { id: 10, name: 'Конфігурація №10', length: 'XXX m', image: '/tracks/nfs_10.jpg', turns: 14, reverse: false },
  { id: 11, name: 'Конфігурація №11', length: 'XXX m', image: '/tracks/nfs_11.jpg', turns: 15, reverse: false },
];

const TRACK_BASE_WITH_REVERSE: typeof TRACK_BASE = [
  ...TRACK_BASE,
  ...TRACK_BASE.map(t => ({
    ...t,
    id: t.id + REVERSE_OFFSET,
    name: t.name.replace('№', '№') + 'R',
    image: t.image,
    reverse: true,
  })),
];

const EMPTY_TRACK_DATA = {
  svgPath: '',
  s1Point: null,
  s1Time: 0,
  gridPositions: [] as TrackPoint[],
  pitPositions: [] as TrackPoint[],
  speedProfile: [] as SpeedProfilePoint[],
  referenceLapTime: 42,
};

/** Конфіги з дефолтними порожніми даними (оновлюються через loadTracksJson) */
export let TRACK_CONFIGS: TrackConfig[] = TRACK_BASE_WITH_REVERSE.map((b) => ({
  ...b,
  ...EMPTY_TRACK_DATA,
}));

/** Завантажує дані трас з /tracks/tracks.json */
export async function loadTracksJson(): Promise<void> {
  try {
    const resp = await fetch('/tracks/tracks.json');
    if (!resp.ok) return;
    const data = await resp.json();

    TRACK_CONFIGS = TRACK_BASE_WITH_REVERSE.map((base) => {
      const jsonId = base.reverse ? `${baseTrackId(base.id)}R` : String(baseTrackId(base.id));
      const json = data[jsonId] || (base.reverse ? null : data[String(base.id)]);
      if (!json || !json.svgPath) return { ...base, ...EMPTY_TRACK_DATA };
      return {
        ...base,
        svgPath: json.svgPath || '',
        s1Point: json.s1Point || null,
        s1Time: json.s1Time || 0,
        gridPositions: json.gridPositions || [],
        pitPositions: json.pitPositions || [],
        speedProfile: json.speedProfile || [],
        referenceLapTime: json.referenceLapTime || 42,
      };
    });
  } catch {
    // tracks.json не доступний — використовуємо порожні дані
  }
}

export function getTrackById(id: number): TrackConfig | undefined {
  return TRACK_CONFIGS.find((t) => t.id === id);
}
