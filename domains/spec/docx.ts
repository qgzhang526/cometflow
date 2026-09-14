import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';

// Minimal, dependency-free reader for the two things we need out of a .docx:
// the ZIP container (word/document.xml) and the block structure of WordprocessingML.
// Everything else (styles, images, footnotes) is intentionally ignored.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;

function findEndOfCentralDirectory(zip: Buffer): number {
  for (let offset = zip.length - 22; offset >= 0; offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

export function extractZipEntry(zip: Buffer, entryName: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(zip);
  if (eocd === -1) throw new Error('不是有效的 zip/docx 文件：找不到中央目录结束记录');

  const entryCount = zip.readUInt16LE(eocd + 10);
  const directoryOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directoryOffset === ZIP64_MARKER) {
    throw new Error('暂不支持 ZIP64 格式的 docx');
  }

  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error('docx 已损坏：中央目录条目无效');

    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (name === entryName) {
      if (zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error('docx 已损坏：本地文件头无效');
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error('docx 使用了不支持的压缩方式：' + method);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

export interface DocTextBlock {
  kind: 'text';
  text: string;
  /** 1-based heading level, or null for a body paragraph. */
  headingLevel: number | null;
}

export interface DocTableBlock {
  kind: 'table';
  /** First row is the header row as written in the document. */
  rows: string[][];
}

export type DocBlock = DocTextBlock | DocTableBlock;

const TAG_PATTERN = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/gu;

interface Range {
  start: number;
  end: number;
}

function findTopLevelRanges(xml: string, tagName: string): Range[] {
  const ranges: Range[] = [];
  let depth = 0;
  let start = -1;

  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(xml)) !== null) {
    if (match[2] !== tagName || match[4] === '/') continue;

    if (match[1] !== '/') {
      if (depth === 0) start = match.index;
      depth += 1;
      continue;
    }

    depth -= 1;
    if (depth === 0 && start >= 0) {
      ranges.push({ start, end: TAG_PATTERN.lastIndex });
      start = -1;
    }
  }

  return ranges;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gu, '&');
}

/** Visible text of a run container: concatenates `w:t`, turns tabs/breaks into whitespace. */
function extractText(xml: string): string {
  let text = '';
  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(xml)) !== null) {
    if (match[2] === 'w:tab' || match[2] === 'w:br' || match[2] === 'w:cr') {
      text += ' ';
      continue;
    }
    if (match[2] !== 'w:t' || match[1] === '/') continue;
    const closeIndex = xml.indexOf('</w:t>', TAG_PATTERN.lastIndex);
    if (closeIndex === -1) continue;
    text += decodeXmlEntities(xml.slice(TAG_PATTERN.lastIndex, closeIndex));
    TAG_PATTERN.lastIndex = closeIndex;
  }
  return text.replace(/[\t\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function headingLevelOf(paragraphXml: string): number | null {
  const style = /<w:pStyle[^>]*w:val="([^"]*)"/u.exec(paragraphXml)?.[1]?.trim() ?? '';
  const named = /(?:heading|标题)\s*([1-9])/iu.exec(style);
  if (named) return Number(named[1]);
  if (/^[1-9]$/u.test(style)) return Number(style);

  const outline = /<w:outlineLvl[^>]*w:val="([0-8])"/u.exec(paragraphXml)?.[1];
  if (outline !== undefined) return Number(outline) + 1;
  return null;
}

function parseTable(tableXml: string): string[][] {
  return findTopLevelRanges(tableXml, 'w:tr').map((row) =>
    findTopLevelRanges(tableXml.slice(row.start, row.end), 'w:tc').map((cell) =>
      extractText(tableXml.slice(row.start + cell.start, row.start + cell.end)),
    ),
  );
}

/**
 * Walks the document in order, returning headings/paragraphs and tables.
 * Paragraphs inside table cells are not emitted: they belong to the table.
 */
export function parseDocumentXml(xml: string): DocBlock[] {
  const tables = findTopLevelRanges(xml, 'w:tbl');

  let outside = xml;
  if (tables.length > 0) {
    const chars = [...outside];
    for (const table of tables) {
      for (let index = table.start; index < table.end; index += 1) chars[index] = ' ';
    }
    outside = chars.join('');
  }

  const blocks: { offset: number; block: DocBlock }[] = [];

  for (const table of tables) {
    blocks.push({ offset: table.start, block: { kind: 'table', rows: parseTable(xml.slice(table.start, table.end)) } });
  }

  for (const paragraph of findTopLevelRanges(outside, 'w:p')) {
    const paragraphXml = outside.slice(paragraph.start, paragraph.end);
    const text = extractText(paragraphXml);
    if (text === '') continue;
    blocks.push({ offset: paragraph.start, block: { kind: 'text', text, headingLevel: headingLevelOf(paragraphXml) } });
  }

  return blocks.sort((left, right) => left.offset - right.offset).map((entry) => entry.block);
}

export async function readDocxBlocks(filePath: string): Promise<DocBlock[]> {
  const zip = await fs.readFile(filePath);
  const document = extractZipEntry(zip, 'word/document.xml');
  if (!document) throw new Error('docx 缺少 word/document.xml');
  return parseDocumentXml(document.toString('utf8'));
}
