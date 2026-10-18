import { pdfSafeText, sourceLine, timesLine, type ShareableRecipe } from '@recipe-app/domain';
import { jsPDF } from 'jspdf';

type PdfRecipe = Omit<ShareableRecipe, 'tags'>;
export type PdfPhoto = { dataUrl: string; width: number; height: number };

// Letter, in points.
const PAGE = { width: 612, height: 792, margin: 54 };
const BOTTOM = PAGE.height - PAGE.margin - 18;
const TWO_COLUMNS_ABOVE = 12;

/** FR-26: the recipe as a tidy PDF, made on the phone. */
export function buildRecipePdf(recipe: PdfRecipe, photo: PdfPhoto | null): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: false });
  const width = PAGE.width - PAGE.margin * 2;
  let y = PAGE.margin;

  const ensure = (height: number) => {
    if (y + height > BOTTOM) {
      doc.addPage();
      y = PAGE.margin;
    }
  };
  const write = (
    text: string,
    size: number,
    style: 'normal' | 'bold' = 'normal',
    indent = 0,
    gap = 4,
  ) => {
    doc.setFont('helvetica', style).setFontSize(size);
    for (const part of doc.splitTextToSize(pdfSafeText(text), width - indent) as string[]) {
      ensure(size * 1.25);
      doc.text(part, PAGE.margin + indent, y + size);
      y += size * 1.25;
    }
    y += gap;
  };

  write(recipe.title, 22, 'bold', 0, 6);
  if (photo) {
    const scale = Math.min(width / photo.width, 220 / photo.height, 1);
    const w = photo.width * scale;
    const h = photo.height * scale;
    ensure(h + 8);
    doc.addImage(photo.dataUrl, 'JPEG', PAGE.margin, y, w, h);
    y += h + 8;
  }
  const times = timesLine(recipe);
  if (times) write(times, 11, 'normal', 0, 10);

  if (recipe.ingredients.length > 0) {
    write('Ingredients', 14, 'bold');
    const lines = recipe.ingredients.map((item) => (item.heading ? item.raw : `• ${item.raw}`));
    const twoColumns =
      recipe.ingredients.filter((item) => !item.heading).length > TWO_COLUMNS_ABOVE;
    const rowHeight = 11 * 1.35;
    const half = Math.ceil(lines.length / 2);
    if (twoColumns && y + half * rowHeight <= BOTTOM) {
      doc.setFont('helvetica', 'normal').setFontSize(11);
      const column = (width - 18) / 2;
      lines.forEach((line, index) => {
        const left = index < half;
        const row = left ? index : index - half;
        const text = (doc.splitTextToSize(pdfSafeText(line), column) as string[])[0] ?? '';
        doc.text(text, PAGE.margin + (left ? 0 : column + 18), y + 11 + row * rowHeight);
      });
      y += half * rowHeight + 10;
    } else {
      for (const line of lines) write(line, 11, 'normal', 0, 1);
      y += 8;
    }
  }

  if (recipe.steps.length > 0) {
    write('Steps', 14, 'bold');
    recipe.steps.forEach((step, index) => write(`${index + 1}. ${step.text}`, 11, 'normal', 0, 6));
    y += 4;
  }
  if (recipe.notes.trim()) {
    write('Notes', 14, 'bold');
    write(recipe.notes.trim(), 11);
  }
  const source = sourceLine(recipe);
  if (source) write(source, 10);

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(120);
    doc.text('Shared from Recipes', PAGE.width / 2, PAGE.height - PAGE.margin / 2, {
      align: 'center',
    });
    doc.setTextColor(0);
  }
  return doc;
}

/** "<Title>.pdf", without characters a file name can't have (Review Focus 2). */
export function pdfFileName(title: string): string {
  const clean = title
    .replace(/[/\\]/g, '-')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[<>"|?*]/g, '')
    // Control characters, by code: no file system allows them.
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return `${clean || 'Recipe'}.pdf`;
}

export function recipePdfFile(recipe: PdfRecipe, photo: PdfPhoto | null): File {
  const blob = buildRecipePdf(recipe, photo).output('blob');
  return new File([blob], pdfFileName(recipe.title), { type: 'application/pdf' });
}
