// 내보내기: txt, docx, 백업(JSON)
import { blocks, plainText } from './text.js';

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
  for (const it of items) parts.push(it.heading, plainText(it.text).trim());
  download(safeName(name) + '.txt', new Blob([parts.join('\n\n\n').replace(/\n{4,}/g, '\n\n\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
}

export async function exportDocx(name, items, header) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, ShadingType, Table, TableRow, TableCell, WidthType, LevelFormat } = await import('docx');
  let listNo = 0;
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
      if (b.youtube) {
        const d = b.youtube;
        const image = (src, width, height) => {
          const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(src || '');
          if (!m) return null;
          return new ImageRun({ type: m[1] === 'jpeg' ? 'jpg' : 'png', data: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)), transformation: { width, height } });
        };
        const frame = image(d.image, d.ratio === 'portrait' ? 202 : 360, d.ratio === 'portrait' ? 360 : 202);
        if (frame) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [frame] }));
        if (d.title) children.push(new Paragraph({ children: [new TextRun({ text: d.title, bold: true })], spacing: { after: 80 } }));
        const videoMeta = [d.channel, d.subscribers, d.views, d.published, d.likes && '좋아요 ' + d.likes].filter(Boolean).join(' · ');
        if (videoMeta) children.push(new Paragraph({ children: [new TextRun({ text: videoMeta, size: 18, color: '606060' })], spacing: { after: 160 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: `댓글${d.commentCount ? ' ' + d.commentCount : ''} · ${d.sort === 'latest' ? '최신순' : '인기순'}`, bold: true })], spacing: { after: 120 } }));
        const addComment = (c, reply = false) => {
          const av = image(c.avatar, 20, 20);
          children.push(new Paragraph({ indent: reply ? { left: 480 } : undefined, spacing: { after: 60 }, children: [...(av ? [av, new TextRun(' ')] : []), new TextRun({ text: [c.author, c.time].filter(Boolean).join(' · '), size: 18, color: '606060' })] }));
          children.push(new Paragraph({ indent: reply ? { left: 480 } : undefined, spacing: { after: 60 }, children: c.text.split('\n').map((t, i) => new TextRun({ text: t, ...(i ? { break: 1 } : {}) })) }));
          const counts = [c.likes && '좋아요 ' + c.likes, !reply && (c.replyCount || c.replies.length) && `답글 ${c.replyCount || c.replies.length}개`].filter(Boolean).join(' · ');
          if (counts) children.push(new Paragraph({ indent: reply ? { left: 480 } : undefined, spacing: { after: 120 }, children: [new TextRun({ text: counts, size: 18, color: '606060' })] }));
        };
        for (const c of d.comments) { addComment(c); for (const r of c.replies) addComment(r, true); }
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
      } else if (b.list) {
        const items = b.items.filter((t) => t.trim());
        const inst = ++listNo;
        for (const t of items) {
          children.push(new Paragraph({
            spacing: { after: 80, line: 320 },
            ...(b.list === 'ordered' ? { numbering: { reference: 'num', level: 0, instance: inst } } : { bullet: { level: 0 } }),
            children: [new TextRun(t)],
          }));
        }
        children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      } else if (b.table) {
        const cols = b.table[0].length;
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.table.map((row, ri) => new TableRow({
            tableHeader: ri === 0,
            children: row.map((c) => new TableCell({
              width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
              shading: ri === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F0' } : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [new Paragraph({ children: [new TextRun({ text: c, bold: ri === 0 })] })],
            })),
          })),
        }));
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
      } else if (b.bubble) {
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
    numbering: { config: [{ reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 480, hanging: 300 } } } }] }] },
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
