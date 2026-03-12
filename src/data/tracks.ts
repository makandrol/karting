export interface TrackConfig {
  id: number;
  name: string;
  length: string;           // "510m" or "XXX m"
  image: string;            // URL to image
  turns: number;
  /** SVG path data for animating karts on the track */
  svgPath: string;
  /** SVG viewBox */
  svgViewBox: string;
}

/**
 * Всі 11 конфігурацій траси "Жага швидкості".
 * SVG paths — спрощені контури кожної конфігурації для анімації.
 */
export const TRACK_CONFIGS: TrackConfig[] = [
  {
    id: 1,
    name: 'Конфігурація №1',
    length: '510m',
    image: '/tracks/nfs_01.jpg',
    turns: 13,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,240 60,300 L 60,380 Q 60,420 100,440 L 350,440 Q 400,440 420,400 L 450,340 Q 470,300 510,300 L 600,300 Q 640,300 660,260 L 680,200 Q 690,170 680,140 Z',
  },
  {
    id: 2,
    name: 'Конфігурація №2',
    length: 'XXX m',
    image: '/tracks/nfs_02.jpg',
    turns: 12,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,240 60,300 L 60,400 Q 60,440 100,440 L 400,440 Q 440,440 460,400 L 500,300 Q 520,260 560,260 L 640,260 Q 680,260 680,220 L 680,140 Z',
  },
  {
    id: 3,
    name: 'Конфігурація №3',
    length: '506m',
    image: '/tracks/nfs_03.jpg',
    turns: 13,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 350,60 Q 280,60 250,120 L 120,280 Q 80,340 80,400 L 120,440 Q 160,460 250,460 L 400,440 Q 450,430 480,400 L 550,300 Q 580,260 620,260 L 660,260 Q 690,260 690,220 L 680,140 Z',
  },
  {
    id: 4,
    name: 'Конфігурація №4',
    length: 'XXX m',
    image: '/tracks/nfs_04.jpg',
    turns: 11,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,250 60,320 L 60,400 Q 60,440 100,440 L 500,440 Q 560,440 600,400 L 660,300 Q 680,260 680,200 L 680,140 Z',
  },
  {
    id: 5,
    name: 'Конфігурація №5',
    length: 'XXX m',
    image: '/tracks/nfs_05.jpg',
    turns: 16,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,250 60,320 L 60,400 Q 60,440 100,440 L 350,440 Q 400,440 430,400 L 460,340 Q 490,290 530,290 L 580,290 Q 620,290 640,260 L 680,180 Z',
  },
  {
    id: 6,
    name: 'Конфігурація №6',
    length: 'XXX m',
    image: '/tracks/nfs_06.jpg',
    turns: 14,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,260 60,340 L 60,400 Q 60,440 100,440 L 380,440 Q 440,440 470,400 L 540,300 Q 570,260 610,260 L 660,260 Q 690,240 690,200 L 680,140 Z',
  },
  {
    id: 7,
    name: 'Конфігурація №7',
    length: 'XXX m',
    image: '/tracks/nfs_07.jpg',
    turns: 15,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,250 60,320 L 60,400 Q 60,440 100,440 L 380,440 Q 430,440 460,400 L 500,340 Q 530,290 570,290 L 620,290 Q 660,290 670,250 L 680,140 Z',
  },
  {
    id: 8,
    name: 'Конфігурація №8',
    length: 'XXX m',
    image: '/tracks/nfs_08.jpg',
    turns: 12,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,250 60,320 L 60,400 Q 60,440 100,440 L 500,440 Q 540,440 570,400 L 640,280 Q 660,240 680,200 L 680,140 Z',
  },
  {
    id: 9,
    name: 'Конфігурація №9',
    length: 'XXX m',
    image: '/tracks/nfs_09.jpg',
    turns: 13,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,260 60,340 L 60,400 Q 60,440 100,440 L 400,440 Q 450,440 480,400 L 550,300 Q 580,260 620,260 L 650,260 Q 680,240 680,200 L 680,140 Z',
  },
  {
    id: 10,
    name: 'Конфігурація №10',
    length: 'XXX m',
    image: '/tracks/nfs_10.jpg',
    turns: 14,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,260 60,340 L 60,400 Q 60,440 100,440 L 440,440 Q 500,440 530,400 L 600,300 Q 630,260 660,240 L 680,200 L 680,140 Z',
  },
  {
    id: 11,
    name: 'Конфігурація №11',
    length: 'XXX m',
    image: '/tracks/nfs_11.jpg',
    turns: 15,
    svgViewBox: '0 0 800 500',
    svgPath: 'M 680,140 L 680,100 Q 680,60 640,60 L 300,60 Q 240,60 200,100 L 100,200 Q 60,260 60,340 L 60,400 Q 60,440 100,440 L 360,440 Q 420,440 450,400 L 520,300 Q 550,260 590,260 L 640,260 Q 670,240 680,200 L 680,140 Z',
  },
];

export function getTrackById(id: number): TrackConfig | undefined {
  return TRACK_CONFIGS.find((t) => t.id === id);
}
