import ExcelJS from "exceljs";
import { sanitizeSheetName } from "./readSheet";

export interface GeneralMergeInput {
  /** 시트 이름 접두어로 사용할 라벨 (예: "1학년_3반") */
  label: string;
  buffer: Buffer;
}

/**
 * 여러 개의 엑셀(일반) 파일을 하나의 워크북으로 병합합니다.
 * 각 원본 파일의 시트를 그대로 유지하면서, 시트 이름 앞에 제출자 라벨을 붙여
 * 새 워크북에 순서대로 추가합니다 (시트별 분리/추가).
 */
export async function mergeGeneralExcel(inputs: GeneralMergeInput[]): Promise<Buffer> {
  const outputWorkbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();

  for (const { label, buffer } of inputs) {
    const sourceWorkbook = new ExcelJS.Workbook();
    await sourceWorkbook.xlsx.load(toArrayBuffer(buffer));

    sourceWorkbook.eachSheet((sourceSheet) => {
      const sheetName = sanitizeSheetName(`${label}_${sourceSheet.name}`, usedNames);
      const targetSheet = outputWorkbook.addWorksheet(sheetName);

      // 컬럼 너비 복사
      targetSheet.columns = sourceSheet.columns.map((col) => ({
        width: col?.width,
      }));

      sourceSheet.eachRow({ includeEmpty: true }, (sourceRow, rowNumber) => {
        const targetRow = targetSheet.getRow(rowNumber);
        sourceRow.eachCell({ includeEmpty: true }, (sourceCell, colNumber) => {
          const targetCell = targetRow.getCell(colNumber);
          targetCell.value = sourceCell.value;
          if (sourceCell.style) {
            targetCell.style = { ...sourceCell.style };
          }
        });
        targetRow.commit();
      });

      // 병합 셀 정보 복사
      const merges = (sourceSheet.model.merges ?? []) as string[];
      merges.forEach((range) => {
        try {
          targetSheet.mergeCells(range);
        } catch {
          // 잘못된 범위는 무시
        }
      });
    });
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
