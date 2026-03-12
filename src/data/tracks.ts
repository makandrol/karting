export interface TrackConfig {
  id: number;
  name: string;
  length: string;           // "510m" or "XXX m"
  image: string;            // URL to image
  turns: number;
  /** SVG path data for animating karts on the track (in image pixel coords 1280x720) */
  svgPath: string;
}

/** Всі картинки трас 1280×720 */
export const TRACK_SVG_VIEWBOX = '0 0 1280 720';

/**
 * Всі 11 конфігурацій траси "Жага швидкості".
 * svgPath — контури в координатах картинки (1280×720).
 * Намалюй через tools/path-editor.html і встав сюди.
 */
export const TRACK_CONFIGS: TrackConfig[] = [
  {
    id: 1,
    name: 'Конфігурація №1',
    length: '510m',
    image: '/tracks/nfs_01.jpg',
    turns: 13,
    svgPath: '',
  },
  {
    id: 2,
    name: 'Конфігурація №2',
    length: 'XXX m',
    image: '/tracks/nfs_02.jpg',
    turns: 12,
    svgPath: '',
  },
  {
    id: 3,
    name: 'Конфігурація №3',
    length: '506m',
    image: '/tracks/nfs_03.jpg',
    turns: 13,
    svgPath: '',
  },
  {
    id: 4,
    name: 'Конфігурація №4',
    length: 'XXX m',
    image: '/tracks/nfs_04.jpg',
    turns: 11,
    svgPath: '',
  },
  {
    id: 5,
    name: 'Конфігурація №5',
    length: 'XXX m',
    image: '/tracks/nfs_05.jpg',
    turns: 16,
    svgPath: '',
  },
  {
    id: 6,
    name: 'Конфігурація №6',
    length: 'XXX m',
    image: '/tracks/nfs_06.jpg',
    turns: 14,
    svgPath: '',
  },
  {
    id: 7,
    name: 'Конфігурація №7',
    length: 'XXX m',
    image: '/tracks/nfs_07.jpg',
    turns: 15,
    svgPath: '',
  },
  {
    id: 8,
    name: 'Конфігурація №8',
    length: 'XXX m',
    image: '/tracks/nfs_08.jpg',
    turns: 12,
    svgPath: '',
  },
  {
    id: 9,
    name: 'Конфігурація №9',
    length: 'XXX m',
    image: '/tracks/nfs_09.jpg',
    turns: 13,
    svgPath: '',
  },
  {
    id: 10,
    name: 'Конфігурація №10',
    length: 'XXX m',
    image: '/tracks/nfs_10.jpg',
    turns: 14,
    svgPath: '',
  },
  {
    id: 11,
    name: 'Конфігурація №11',
    length: 'XXX m',
    image: '/tracks/nfs_11.jpg',
    turns: 15,
    svgPath: '',
  },
];

export function getTrackById(id: number): TrackConfig | undefined {
  return TRACK_CONFIGS.find((t) => t.id === id);
}
