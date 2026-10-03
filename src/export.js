// 내보내기: txt, docx, 백업(JSON)
import { blocks, stripMarkers } from './text.js';

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

const safeName = (s) => (s || '원고').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || '원고';

// items: [{heading, title, text}]
export function exportTxt(name, items, header) {
  const parts = [];
  if (header) parts.push(header);
  for (const it of items) parts.push(it.heading, stripMarkers(it.text).trim());
  download(safeName(name) + '.txt', new Blob([parts.join('\n\n\n').replace(/\n{4,}/g, '\n\n\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
}

export async function exportDocx(name, items, header) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ShadingType } = await import('docx');
  const children = [];
  if (header) {
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(header)] }));
  }
  items.forEach((it, i) => {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: i > 0 || !!header,
      spacing: { after: 360 },
      children: [new TextRun(it.heading)],
    }));
    for (const b of blocks(it.text)) {
      if (b.bubble) {
        const me = b.bubble === 'me';
        children.push(new Paragraph({
          alignment: me ? AlignmentType.RIGHT : AlignmentType.LEFT,
          indent: me ? { left: 2880 } : { right: 2880 },
          spacing: { after: 120, line: 320 },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: me ? '3478F6' : 'EFEFF1' },
          children: b.lines.map((line, j) => new TextRun(j ? { text: line, break: 1, color: me ? 'FFFFFF' : '26272B' } : { text: line, color: me ? 'FFFFFF' : '26272B' })),
        }));
      } else if (b.scene) {
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new TextRun('* * *')] }));
      } else {
        children.push(new Paragraph({
          spacing: { after: 200, line: 360 },
          children: b.lines.map((line, j) => new TextRun(j ? { text: line, break: 1 } : { text: line })),
        }));
      }
    }
  });
  const doc = new Document({
    creator: '원고 보관함',
    title: name,
    styles: {
      default: { document: { run: { font: { ascii: 'Batang', eastAsia: '바탕', hAnsi: 'Batang' }, size: 22 } } },
    },
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(doc);
  download(safeName(name) + '.docx', blob);
}

export function exportBackup(work, chapters) {
  const data = {
    app: 'manuscript-archive', version: 1, exportedAt: new Date().toISOString(),
    works: [{
      title: work.title, subtitle: work.subtitle || '', target: work.target ?? null, targetBasis: work.targetBasis || 'noSpace',
      chapters: chapters.map((c) => ({
        kind: c.kind, title: c.title, text: c.text, status: c.status || 'draft', order: c.order,
        deleted: !!c.deletedAt,
      })),
    }],
  };
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  download(`${safeName(work.title)}_백업_${stamp}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
}

export function parseBackup(json) {
  const data = JSON.parse(json);
  if (!data || data.app !== 'manuscript-archive' || !Array.isArray(data.works)) throw new Error('원고 보관함 백업 파일이 아니에요.');
  return data.works;
}
