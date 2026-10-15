import { PDFDocument } from "pdf-lib";

export interface PdfMergeInput {
  label: string;
  buffer: Buffer;
}

/**
 * 여러 개의 PDF 파일을 제출 순서(학년/반 순)대로 이어 붙여 하나의 PDF로 합칩니다.
 */
export async function mergePdfFiles(inputs: PdfMergeInput[]): Promise<Buffer> {
  const outputPdf = await PDFDocument.create();

  for (const { buffer } of inputs) {
    const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = await outputPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    pages.forEach((page) => outputPdf.addPage(page));
  }

  const bytes = await outputPdf.save();
  return Buffer.from(bytes);
}
