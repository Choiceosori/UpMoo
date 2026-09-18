import ExcelJS from "exceljs";
import { EXPENSE_COLUMNS } from "../types";
import { sheetToRows } from "./readSheet";

export interface ExpenseMergeInput {
  label: string;
  buffer: Buffer;
}

type CellValue = string | number | boolean | null | undefined;

function normalize(value: CellValue): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isBlankRow(row: CellValue[]): boolean {
  return row.every((cell) => normalize(cell) === "");
}

/**
 * 동일 양식([내용, 규격, 단위, 수량, 예상단가])의 지출 엑셀 파일들을
 * 기존 데이터 하단 빈 행에 이어서 병합(Append)합니다.
 */
export async function mergeExpenseExcel(inputs: ExpenseMergeInput[]): Promise<Buffer> {
  const outputWorkbook = new ExcelJS.Workbook();
  const sheet = outputWorkbook.addWorksheet("지출내역");

  sheet.columns = EXPENSE_COLUMNS.map((header) => ({ header, key: header, width: 18 }));
  sheet.getRow(1).font = { bold: true };

  for (const { buffer } of inputs) {
    const sourceWorkbook = new ExcelJS.Workbook();
    await sourceWorkbook.xlsx.load(toArrayBuffer(buffer));
    const sourceSheet = sourceWorkbook.worksheets[0];
    if (!sourceSheet) continue;

    const rows = sheetToRows(sourceSheet);
    if (rows.length === 0) continue;

    const headerRow = rows[0].map(normalize);
    const headerFound = EXPENSE_COLUMNS.every((col) => headerRow.includes(col));

    const colIndex = headerFound
      ? {
          내용: headerRow.indexOf("내용"),
          규격: headerRow.indexOf("규격"),
          단위: headerRow.indexOf("단위"),
          수량: headerRow.indexOf("수량"),
          예상단가: headerRow.indexOf("예상단가"),
        }
      : { 내용: 0, 규격: 1, 단위: 2, 수량: 3, 예상단가: 4 };

    const dataRows = headerFound ? rows.slice(1) : rows;

    for (const row of dataRows) {
      if (isBlankRow(row)) continue;
      sheet.addRow({
        내용: row[colIndex.내용] ?? "",
        규격: row[colIndex.규격] ?? "",
        단위: row[colIndex.단위] ?? "",
        수량: row[colIndex.수량] ?? "",
        예상단가: row[colIndex.예상단가] ?? "",
      });
    }
  }

  const arrayBuffer = await outputWorkbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}
