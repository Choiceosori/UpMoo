import * as XLSX from "xlsx";
import { scanTextForPii } from "./validators/pii";
import { validateExpenseRows } from "./validators/expenseExcel";

type CellValue = string | number | boolean | null | undefined;

export interface ExcelParseResult {
  allText: string;
  firstSheetRows: CellValue[][];
}

const EXCEL_EXTENSIONS = [".xlsx", ".xls"];

function hasExtension(filename: string, extensions: string[]): boolean {
  const lower = filename.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

/** 브라우저에서 엑셀 파일을 파싱해 전체 텍스트와 첫 번째 시트의 행 데이터를 추출합니다. */
export async function parseExcelFile(file: File): Promise<ExcelParseResult> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  const textChunks: string[] = [];
  let firstSheetRows: CellValue[][] = [];

  workbook.SheetNames.forEach((name, idx) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    if (idx === 0) firstSheetRows = rows;
    rows.forEach((row) => row.forEach((cell) => textChunks.push(String(cell ?? ""))));
  });

  return { allText: textChunks.join(" "), firstSheetRows };
}

/**
 * 파일 내용에서 개인정보(이름/주민등록번호) 패턴을 검출합니다.
 * 엑셀 파일은 셀 텍스트를 직접 파싱하고, 그 외(PDF/HWP 등) 파일은
 * 브라우저에서 완전한 파싱이 어려우므로 텍스트로 디코딩 가능한 범위 내에서
 * best-effort로 스캔합니다.
 */
export async function scanFileForPii(file: File): Promise<boolean> {
  if (hasExtension(file.name, EXCEL_EXTENSIONS)) {
    const { allText } = await parseExcelFile(file);
    return scanTextForPii(allText).flagged;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(arrayBuffer);
    if (scanTextForPii(utf8Text).flagged) return true;

    const euckrText = new TextDecoder("euc-kr", { fatal: false }).decode(arrayBuffer);
    return scanTextForPii(euckrText).flagged;
  } catch {
    return false;
  }
}

/** 엑셀(지출) 양식 검사: 내용/단위/수량 칸 누락 여부 확인 */
export async function scanExpenseExcel(file: File): Promise<boolean> {
  const { firstSheetRows } = await parseExcelFile(file);
  return !validateExpenseRows(firstSheetRows).valid;
}
