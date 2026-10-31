import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import PDFDocument from 'pdfkit';
import type { ResumeContent } from '../db/schema.js';

const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
const ACCENT = '0075DE';

const lines = (c: ResumeContent) => [c.header.headline, [c.header.email, c.header.location, ...(c.header.links ?? [])].filter(Boolean).join(' · ')].filter(Boolean);

export async function exportDocx(content: ResumeContent, template: string): Promise<Buffer> {
  const compact = template === 'compact';
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: content.header.name, bold: true, size: compact ? 34 : 40 })] }),
    ...lines(content).map((l) => new Paragraph({ children: [new TextRun({ text: l, color: '555555', size: 20 })] })),
  ];
  for (const sec of content.sections) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: compact ? 160 : 260, after: 80 },
      border: { bottom: { color: 'DDDDDD', space: 2, style: BorderStyle.SINGLE, size: 6 } },
      children: [new TextRun({ text: sec.title.toUpperCase(), bold: true, color: ACCENT, size: 22 })],
    }));
    for (const en of sec.entries) {
      if (en.heading) {
        children.push(new Paragraph({
          spacing: { before: 100 },
          children: [new TextRun({ text: en.heading, bold: true, size: 22 }), ...(en.subheading ? [new TextRun({ text: ` — ${en.subheading}`, size: 22 })] : []), ...(en.period ? [new TextRun({ text: `   ${en.period}`, color: '777777', size: 18 })] : [])],
        }));
      }
      for (const b of en.bullets) {
        const isProse = sec.type === 'summary';
        children.push(new Paragraph({ bullet: isProse || sec.type === 'skills' ? undefined : { level: 0 }, alignment: AlignmentType.LEFT, spacing: { after: 40 }, children: [new TextRun({ text: b.text, size: 20 })] }));
      }
    }
  }
  const doc = new Document({ styles: { default: { document: { run: { font: 'Calibri' } } } }, sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 860, right: 860 } } }, children }] });
  return Packer.toBuffer(doc);
}

export async function exportPdf(content: ResumeContent, template: string): Promise<Buffer> {
  const compact = template === 'compact';
  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 54, right: 54 }, info: { Title: `${content.header.name} — CV`, Creator: 'CareerPilot' } });
  doc.registerFont('Body', resolve(FONT_DIR, 'NotoSans-Regular.ttf'));
  doc.registerFont('Bold', resolve(FONT_DIR, 'NotoSans-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const width = doc.page.width - 108;
  const gap = compact ? 4 : 8;

  doc.font('Bold').fontSize(compact ? 18 : 22).fillColor('#111111').text(content.header.name);
  for (const l of lines(content)) doc.font('Body').fontSize(10).fillColor('#555555').text(l);
  for (const sec of content.sections) {
    doc.moveDown(compact ? 0.6 : 0.9);
    doc.font('Bold').fontSize(11).fillColor(`#${ACCENT}`).text(sec.title.toUpperCase());
    const y = doc.y + 2;
    doc.moveTo(54, y).lineTo(54 + width, y).lineWidth(0.6).strokeColor('#dddddd').stroke();
    doc.moveDown(0.3);
    for (const en of sec.entries) {
      if (en.heading) {
        doc.moveDown(0.2);
        doc.font('Bold').fontSize(10.5).fillColor('#111111').text(`${en.heading}${en.subheading ? ` — ${en.subheading}` : ''}`, { continued: !!en.period });
        if (en.period) doc.font('Body').fontSize(9).fillColor('#777777').text(`   ${en.period}`);
      }
      for (const b of en.bullets) {
        const prose = sec.type === 'summary' || sec.type === 'skills';
        doc.font('Body').fontSize(10).fillColor('#222222');
        if (prose) doc.text(b.text, { width, paragraphGap: gap / 2 });
        else doc.text(`•  ${b.text}`, { width, indent: 0, paragraphGap: gap / 2 });
      }
    }
  }
  doc.end();
  return done;
}
