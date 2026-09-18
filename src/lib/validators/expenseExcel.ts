import { EXPENSE_COLUMNS } from "../types";

export interface ExpenseValidationResult {
  valid: boolean;
  invalidRowIndexes: number[]; // 0-based index within data rows (헤더 제외)
  headerFound: boolean;
}

type CellValue = string | number | boolean | null | undefined;

function normalize(value: CellValue): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * 지출 엑셀 표준 양식([내용, 규격, 단위, 수량, 예상단가])을 검사합니다.
 * - 헤더 행을 찾아 컬럼 인덱스를 매핑합니다 (헤더가 없으면 A~E 순서를 그대로 사용).
 * - "규격"은 비어 있어도 정상.
 * - "내용", "단위", "수량" 중 하나라도 비어 있는 (완전 공백이 아닌) 행이 있으면 invalid.
 */
export function validateExpenseRows(rows: CellValue[][]): ExpenseValidationResult {
  if (rows.length === 0) {
    return { valid: true, invalidRowIndexes: [], headerFound: false };
  }

  const headerRow = rows[0].map(normalize);
  const headerFound = EXPENSE_COLUMNS.every((col) => headerRow.includes(col));

  let colIndex: Record<(typeof EXPENSE_COLUMNS)[number], number>;
  let dataRows: CellValue[][];

  if (headerFound) {
    colIndex = {
      내용: headerRow.indexOf("내용"),
      규격: headerRow.indexOf("규격"),
      단위: headerRow.indexOf("단위"),
      수량: headerRow.indexOf("수량"),
      예상단가: headerRow.indexOf("예상단가"),
    };
    dataRows = rows.slice(1);
  } else {
    // 헤더가 없다면 컬럼 순서를 고정 규격으로 간주: [내용, 규격, 단위, 수량, 예상단가]
    colIndex = { 내용: 0, 규격: 1, 단위: 2, 수량: 3, 예상단가: 4 };
    dataRows = rows;
  }

  const invalidRowIndexes: number[] = [];

  dataRows.forEach((row, idx) => {
    const content = normalize(row[colIndex.내용]);
    const unit = normalize(row[colIndex.단위]);
    const qty = normalize(row[colIndex.수량]);
    const spec = normalize(row[colIndex.규격]);
    const price = normalize(row[colIndex.예상단가]);

    const isFullyBlankRow = !content && !unit && !qty && !spec && !price;
    if (isFullyBlankRow) return;

    const missingRequired = !content || !unit || !qty;
    if (missingRequired) {
      invalidRowIndexes.push(idx);
    }
  });

  return { valid: invalidRowIndexes.length === 0, invalidRowIndexes, headerFound };
}

export const EXPENSE_VALIDATION_WARNING_MESSAGE =
  "⚠️ 내용, 단위, 수량 세 칸이 모두 기재되어 있지 않을 경우 '내용, 단위, 수량' 칸을 확인해주세요!";
