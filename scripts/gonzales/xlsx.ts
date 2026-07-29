/**
 * Мінімальний читач .xlsx — значення + КОЛІР ЗАЛИВКИ клітинок, без залежностей.
 *
 * Потрібен тому, що CSV-експорт Google Sheets втрачає форматування, а в таблиці
 * Гонзалеса стартові слоти пілотів позначені саме жовтою заливкою.
 *
 * Розпаковує zip власною inflate-реалізацією через `zlib.inflateRawSync`.
 */
import { inflateRawSync } from 'node:zlib';

export interface XlsxCell {
  row: number;
  col: number;
  value: string | null;
  /** Колір заливки у вигляді `RRGGBB`, або null якщо заливки немає / вона біла. */
  fill: string | null;
}

export interface XlsxSheet {
  name: string;
  cells: Map<string, XlsxCell>;
}

// --- zip ---

interface ZipEntry { name: string; data: Buffer }

function readZip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  // Скануємо central directory з кінця — надійніше за послідовний парсинг,
  // бо local headers можуть мати streaming-розміри (bit 3 у flags).
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx: не знайдено EOCD (не zip?)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx: пошкоджений central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));

    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// --- xml helpers ---

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&');
}

export function colNumOf(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)![0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function colNameOf(n: number): string {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

// --- workbook ---

export function readXlsx(buf: Buffer): XlsxSheet[] {
  const files = readZip(buf);
  const text = (name: string): string => {
    const f = files.get(name);
    return f ? f.toString('utf8') : '';
  };

  // sharedStrings
  const shared: string[] = [];
  for (const m of text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  }

  // styles → fills, cellXfs
  const stylesXml = text('xl/styles.xml');
  const fills: { rgb: string | null; pattern: string }[] = [];
  const fillsBlock = stylesXml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/);
  if (fillsBlock) {
    for (const m of fillsBlock[1].matchAll(/<fill>([\s\S]*?)<\/fill>|<fill\s*\/>/g)) {
      const inner = m[1] || '';
      const fg = inner.match(/<fgColor[^>]*rgb="([0-9A-Fa-f]{6,8})"/);
      const pat = inner.match(/patternType="([^"]+)"/);
      fills.push({ rgb: fg ? fg[1] : null, pattern: pat ? pat[1] : 'none' });
    }
  }
  const cellXfs: number[] = [];
  const xfBlock = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (xfBlock) {
    for (const m of xfBlock[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)) {
      const fid = m[0].match(/fillId="(\d+)"/);
      cellXfs.push(fid ? +fid[1] : 0);
    }
  }
  const fillOf = (styleIdx: number | null): string | null => {
    if (styleIdx == null) return null;
    const f = fills[cellXfs[styleIdx]];
    if (!f || f.pattern === 'none' || !f.rgb) return null;
    const rgb = (f.rgb.length === 8 ? f.rgb.slice(2) : f.rgb).toUpperCase();
    return rgb === 'FFFFFF' ? null : rgb;
  };

  // rId → target
  const rels = new Map<string, string>();
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    rels.set(m[1], m[2]);
  }

  const sheets: XlsxSheet[] = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"[^>]*?\/>/g)) {
    const target = rels.get(m[2]);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = text(path);
    if (!xml) continue;

    const cells = new Map<string, XlsxCell>();
    for (const rm of xml.matchAll(/<row\b[^>]*?r="(\d+)"[^>]*?>([\s\S]*?)<\/row>/g)) {
      const rowNum = +rm[1];
      for (const cm of rm[2].matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cm[1] || cm[2] || '';
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        if (!ref) continue;
        const sIdx = attrs.match(/s="(\d+)"/);
        const t = attrs.match(/t="([^"]+)"/)?.[1];
        const body = cm[3] || '';
        let value: string | null = null;
        if (t === 'inlineStr') {
          value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        } else {
          const v = body.match(/<v>([\s\S]*?)<\/v>/);
          if (v) value = t === 's' ? (shared[+v[1]] ?? null) : decodeXml(v[1]);
        }
        cells.set(ref, { row: rowNum, col: colNumOf(ref), value, fill: fillOf(sIdx ? +sIdx[1] : null) });
      }
    }
    sheets.push({ name: decodeXml(m[1]), cells });
  }
  return sheets;
}

export async function fetchXlsx(bookId: string): Promise<Buffer> {
  const url = `https://docs.google.com/spreadsheets/d/${bookId}/export?format=xlsx`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`xlsx ${bookId} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
