import type { Worksheet } from "exceljs";

type CellValue = string | number | boolean | null | undefined;

/** ExcelJS 워크시트를 2차원 배열(행 x 열)로 변환합니다. */
export function sheetToRows(worksheet: Worksheet): CellValue[][] {
  const rows: CellValue[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[];
    // ExcelJS row.values는 1-based 배열이므로 index 0을 제거
    const rowArray = values.slice(1).map((v) => {
      if (v && typeof v === "object" && "text" in (v as Record<string, unknown>)) {
        return String((v as { text: unknown }).text);
      }
      if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) {
        return (v as { result: unknown }).result as CellValue;
      }
      return v as CellValue;
    });
    rows.push(rowArray);
  });
  return rows;
}

/** 시트 이름을 Excel 규칙(31자 제한, 금지문자 제거)에 맞게 정리합니다. */
export function sanitizeSheetName(name: string, usedNames: Set<string>): string {
  let cleaned = name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
  if (!cleaned) cleaned = "Sheet";
  let candidate = cleaned;
  let suffix = 1;
  while (usedNames.has(candidate)) {
    const suffixStr = `_${suffix}`;
    candidate = `${cleaned.slice(0, 31 - suffixStr.length)}${suffixStr}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}
