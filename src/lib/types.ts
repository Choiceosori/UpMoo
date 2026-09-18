export type SubmissionUnit = "grade" | "class";

export type FileCategory = "hwp" | "pdf" | "excel_general" | "excel_expense";

export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  hwp: "HWP/HWPX",
  pdf: "PDF",
  excel_general: "엑셀(일반)",
  excel_expense: "엑셀(지출)",
};

export const FILE_CATEGORY_EXTENSIONS: Record<FileCategory, string[]> = {
  hwp: [".hwp", ".hwpx"],
  pdf: [".pdf"],
  excel_general: [".xlsx", ".xls"],
  excel_expense: [".xlsx", ".xls"],
};

export interface School {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface ClassStructure {
  id: string;
  school_id: string;
  year: number;
  semester: number;
  grade: number;
  class_count: number;
}

export interface CollectionTask {
  id: string;
  school_id: string;
  name: string;
  description: string | null;
  deadline: string | null;
  unit: SubmissionUnit;
  allowed_file_types: FileCategory[];
  position: number;
  created_at: string;
}

export interface Submission {
  id: string;
  school_id: string;
  task_id: string;
  grade: number;
  class_no: number | null;
  file_category: FileCategory;
  original_filename: string;
  stored_filename: string;
  storage_path: string;
  size_bytes: number;
  pii_flagged: boolean;
  expense_flagged: boolean;
  created_at: string;
  updated_at: string;
}

export const EXPENSE_COLUMNS = ["내용", "규격", "단위", "수량", "예상단가"] as const;
