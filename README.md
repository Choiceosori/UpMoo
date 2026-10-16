# UpMoo — 학교 업무 자료 수합 시스템

Next.js(App Router) + TypeScript + Tailwind CSS 기반의 학교 업무 자료 수합/병합 웹 서비스입니다.
프론트엔드와 백엔드(Serverless API Routes)가 하나의 Next.js 프로젝트로 통합되어 있어 Vercel에 그대로 배포할 수 있습니다.
데이터베이스는 일반 Postgres(권장: **Neon**), 파일 저장소는 S3 호환 Object Storage(권장:
**Cloudflare R2**)를 사용합니다 — 둘 다 VPC/방화벽 설정 없이 API 키 발급만으로 바로 연동됩니다.

## 기술 스택

- **Next.js 15 (App Router)** — 프론트엔드 + API Routes(서버리스 함수), 배포: Vercel
- **TypeScript, React, Tailwind CSS**
- **Postgres** — `pg`로 직접 접속하는 메타데이터 저장소 (권장: Neon, Vercel Postgres도 호환)
- **S3 호환 Object Storage** — `@aws-sdk/client-s3`로 접근하는 제출 파일 저장소 (권장: Cloudflare R2)
- **exceljs** — 서버(API Route)에서의 엑셀 병합
- **pdf-lib** — 제출된 PDF를 페이지 단위로 이어 붙여 하나의 PDF로 병합
- **jszip** — 파일 종류 무관하게 제출 자료 전체를 ZIP으로 묶어 다운로드
- **xlsx (SheetJS)** — 브라우저에서의 엑셀 파싱/유효성 검사
- **@hello-pangea/dnd** — 수합 업무 순서 Drag & Drop
- **Python + olefile (Vercel Python 함수)** — HWP(한글) 파일 병합 전용. Next.js와 같은
  Vercel 프로젝트에 `api/hwp_merge.py`로 함께 배포되는 별도 런타임입니다(실험적 기능, 아래
  "알려진 한계" 참고)

## 폴더 구조

```
src/
  app/
    layout.tsx, page.tsx, globals.css     # 랜딩(역할·학교 코드 선택) 페이지
    admin/page.tsx                        # 전체 관리자: 학교 등록/목록/삭제, DB/스토리지 연결 진단
    manager/
      page.tsx                            # 담당자 홈
      classes/page.tsx                    # 학년별 학급 수 등록
      tasks/page.tsx                      # 수합 업무 등록 + 순서 변경(DnD)
      tasks/[taskId]/page.tsx             # 업무 상세: 제출 현황 + 통합 파일 수합
    submit/page.tsx                       # 제출자: 학년/반/업무 선택, 업로드, 검증, 보관/수정
    api/
      schools/route.ts, schools/[id]/route.ts
      classes/route.ts
      tasks/route.ts, tasks/[taskId]/route.ts, tasks/reorder/route.ts
      tasks/[taskId]/example/route.ts     # 업무별 예시 양식 파일 업로드/다운로드/삭제
      submissions/route.ts, submissions/[id]/route.ts
      submissions/[id]/correction/route.ts # 담당자의 수정 요청 등록/해제
      merge/route.ts                      # 엑셀(일반/지출)·PDF 병합 후 파일 다운로드 응답
      zip/route.ts                        # 업무의 전체 제출 파일을 ZIP으로 묶어 다운로드
      admin/diagnostics/route.ts          # DB/Object Storage 연결 상태 진단
  components/
    Navbar.tsx, SchoolGate.tsx, FileDropzone.tsx, WarningModal.tsx
  context/SchoolContext.tsx               # 선택된 학교/역할 정보(로컬 스토리지 유지)
  lib/
    types.ts, filename.ts, clientFileScan.ts
    db.ts                                 # Postgres 커넥션 풀 + 쿼리 헬퍼
    objectStorage.ts                      # Object Storage 업로드/다운로드/서명 URL (S3 호환)
    mergePdf.ts                           # PDF 여러 개를 페이지 순서대로 병합
    validators/pii.ts                     # 이름/주민등록번호 패턴 검출
    validators/expenseExcel.ts            # 지출 엑셀 [내용,규격,단위,수량,예상단가] 검증
    excel/mergeGeneral.ts                 # 시트별 분리/추가 병합
    excel/mergeExpense.ts                 # 기존 데이터 하단에 Append 병합
    mergeHwp.ts                           # api/hwp_merge.py(Python 함수) 호출 브리지
api/
  hwp_merge.py                            # Vercel Python 함수: HWP 병합 진입점
  _hwplib/cfb.py                          # OLE2 Compound File 라이터(직접 구현)
  _hwplib/merge.py                        # HWP5 BodyText 섹션 병합 + DocInfo 패치
requirements.txt                          # api/hwp_merge.py용 Python 의존성(olefile)
db/schema.sql                             # Postgres 테이블 생성 스크립트
```

## 권한 모델

- **전체 관리자**: `ADMIN_PASSWORD` 환경변수로 보호되는 `/admin` 페이지에서 학교를 등록하면
  학교 전용 **접속 코드**가 발급됩니다.
- **업무 담당자 / 학급 담임(제출자)**: 랜딩 페이지에서 역할과 학교 접속 코드를 함께 선택해 입장합니다.
  선택한 역할은 `SchoolContext`(로컬 스토리지)에 학교 정보와 함께 저장되고, `SchoolGate`
  컴포넌트가 각 페이지에 `requiredRole`을 지정해 역할이 다르면 자신의 홈으로 자동 리다이렉트합니다 —
  즉 학급 담임은 `/manager/*` 관리 화면에, 업무 담당자는 `/submit` 제출 화면에 접근할 수 없습니다.
  (이는 클라이언트 라우팅 수준의 구분이며, API 자체는 같은 학교 코드로 인증된 두 역할 모두가 호출할
  수 있는 구조입니다.)
- 이후 모든 데이터(`schools.id` 기준)는 학교별로 완전히 분리되어 조회/저장됩니다 — 이것이
  "학교별 Database 관리 권한"에 해당합니다. 코드를 아는 사람만 해당 학교의 작업 공간에 접근할 수
  있습니다.
- 별도 회원가입 없이 학교 코드 + 학년/반 선택으로 "제출자 본인"을 식별하는 경량 모델입니다.
- Supabase처럼 "anon/service_role 키 + PostgREST + RLS" 계층이 없습니다. API Route가
  `DATABASE_URL`로 DB에 직접 접속하며, 이 자격증명은 서버 환경변수로만 존재하고 클라이언트에는
  절대 노출되지 않습니다.

## 로컬 개발

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

### DB/스토리지 준비

#### 1. Postgres (권장: Neon)

가장 쉬운 방법은 **Vercel 대시보드에서 바로 연동**하는 것입니다.

1. Vercel 프로젝트 → **Storage** 탭 → **Create Database** → **Neon (Postgres)** 선택
   → 생성/연결하면 `DATABASE_URL`(또는 `POSTGRES_URL`)이 프로젝트 환경변수에 자동으로
   채워집니다. VPC/방화벽 설정이 전혀 필요 없습니다.
2. (또는) [neon.tech](https://neon.tech)에서 직접 무료 프로젝트를 만들고, 생성된 연결
   문자열 중 **Pooled connection**(호스트명에 `-pooler`가 붙은 형태 — 서버리스 환경에 적합)을
   복사해 `.env.local`의 `DATABASE_URL`에 붙여넣습니다.
3. Neon 콘솔의 SQL Editor(또는 `psql`)로 접속해 `db/schema.sql` 내용을 실행합니다.

#### 2. Object Storage (권장: Cloudflare R2)

1. Cloudflare 대시보드 → **R2** → 버킷 생성(예: `upmoo-submissions`).
2. **R2 > API 토큰 관리**에서 Access Key ID / Secret Access Key를 발급합니다.
3. 버킷 설정에서 **S3 API 엔드포인트**를 확인합니다 (`https://<계정ID>.r2.cloudflarestorage.com`
   형태).
4. `.env.local`에 `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`를
   입력합니다 (`S3_REGION`은 `auto` 기본값 그대로 두면 됩니다).

> 이 프로젝트는 AWS SDK v3(S3 호환 API)만 사용하므로, R2 대신 다른 S3 호환 스토리지
> (MinIO, Backblaze B2 등)로도 동일한 환경변수 체계로 바꿔 쓸 수 있습니다.

#### 3. 관리자 비밀번호

`.env.local`에 `ADMIN_PASSWORD`를 입력합니다.

## Vercel 배포

1. GitHub 저장소를 Vercel에 Import 합니다 (Framework Preset: Next.js — 자동 감지).
2. Neon을 Vercel Storage 탭에서 연동했다면 `DATABASE_URL`은 이미 채워져 있습니다. 나머지
   (`S3_*`, `ADMIN_PASSWORD`)는 **Environment Variables**에 직접 등록합니다.
3. Deploy — App Router 페이지, Next.js API Routes(Node 서버리스 함수), 그리고
   `api/hwp_merge.py`(Python 서버리스 함수, `requirements.txt`의 `olefile` 자동 설치)가
   모두 함께 배포됩니다. 별도 설정은 필요 없습니다(Vercel이 `/api` 아래 `.py` 파일을 자동
   인식합니다).
4. 환경변수를 나중에 추가/수정한 경우 반드시 **재배포**해야 반영됩니다.
5. `/admin` 페이지 로그인 후 "DB/스토리지 연결 확인" 버튼으로 실제 접속이 되는지 확인할 수
   있습니다.

## 핵심 기능 흐름

### 제출자 페이지 (`app/submit/page.tsx`)
1. 학년 → 반 선택 (업무의 수합 단위가 "학년별"이면 반 선택은 비활성화)
2. 업무명 선택 → 해당 업무에서 허용한 파일 종류 중 선택
3. 드래그 앤 드롭 업로드 시:
   - 엑셀 파일은 브라우저에서 SheetJS로 파싱해 전체 셀 텍스트에서 이름/주민등록번호 패턴을 검사합니다.
     PDF/HWP 등 바이너리 포맷은 완전한 텍스트 파싱이 어려워 best-effort로만 스캔합니다(README 한계 참고).
   - "엑셀(지출)" 선택 시 `[내용, 규격, 단위, 수량, 예상단가]` 양식을 검사해 필수 칸 누락 여부를 확인합니다.
   - 위 검사에서 문제가 발견되면 지정된 문구의 경고 팝업이 표시됩니다(제출을 막지는 않고 확인만 요구).
4. 제출 시 서버가 `[학년(_반)_업무명_원본파일명]` 규칙으로 표시용 파일명을 생성해 DB에 저장합니다.
   실제 Object Storage 저장 경로는 한글/공백을 피해 UUID 기반으로 별도 생성됩니다.
5. 업무에 담당자가 올린 **예시 양식 파일**이 있으면 업무명 아래에 다운로드 링크로 표시됩니다.
6. "내 제출 자료" 목록에서 재업로드/삭제가 가능합니다. 담당자가 수정을 요청한 건은 목록 상단에
   빨간 배너로 요청 메시지가 표시되며, 재업로드하면 요청 표시가 자동으로 해제됩니다.

### 담당자 업무 상세 (`app/manager/tasks/[taskId]/page.tsx`)
- **예시 양식**: 제출자가 참고할 양식 파일을 업로드/교체/삭제할 수 있습니다.
- **엑셀(일반) 통합 다운로드**: `app/api/merge/route.ts`가 exceljs로 각 제출 파일의 시트를 그대로
  유지한 채 하나의 워크북에 순서대로 추가합니다(시트명 앞에 제출자 라벨 부여).
- **엑셀(지출) 통합 다운로드**: 동일 양식의 데이터 행을 새 워크북의 기존 데이터 하단에 이어붙입니다(Append).
- **PDF 통합 다운로드**: pdf-lib로 제출 순서(학년/반 순)대로 페이지를 이어 붙여 하나의 PDF를
  생성합니다.
- **HWP 통합 다운로드 (실험적)**: `api/hwp_merge.py`(Vercel Python 함수)가 각 파일의
  BodyText 섹션을 이어 붙이고 DocInfo의 섹션 개수를 패치해 하나의 .hwp로 병합합니다. HWP5는
  한컴의 독점 바이너리(OLE2 Compound File) 포맷이라 공개된 파서/라이터 라이브러리가 없어서,
  이 프로젝트는 OLE2 컨테이너 자체를 직접 구현한 라이터(`api/_hwplib/cfb.py`)로 처리합니다 —
  `olefile`로 구조적 정합성은 충분히 검증했지만, **실제 한글(HWP) 프로그램으로는 검증하지
  못했습니다.** 모든 제출 파일이 같은 예시 양식에서 비롯된 경우(이 앱의 기본 흐름)에 안전할
  가능성이 높지만, 사용 전 반드시 실제 한글에서 열어 확인하세요. 컨테이너 크기가 약 7MB를
  넘거나 문제가 발견되면 아래 "전체 파일 ZIP 다운로드"로 대체하세요.
- **전체 파일 ZIP 다운로드**: 파일 종류 상관없이 해당 업무의 모든 제출 파일을 ZIP 하나로
  묶어 받습니다. HWP 통합이 믿을 수 없거나 실패할 때의 안전한 대안입니다.
- **수정 요청**: 제출 현황 표에서 각 건에 메시지를 남겨 재제출을 요청할 수 있습니다. 제출자
  화면에 즉시 표시되며, 제출자가 재업로드하면 요청이 자동으로 해제됩니다.

## 문제 해결 (Troubleshooting)

- **DB 연결 실패 / `DATABASE_URL이 설정되지 않았습니다`**: Vercel Environment Variables에
  `DATABASE_URL`을 등록했는지, 재배포했는지 확인하세요. `/admin` → "DB/스토리지 연결 확인"
  버튼으로 실제 연결 여부와 실패 사유를 바로 확인할 수 있습니다.
- **`relation "schools" does not exist`류 오류**: `db/schema.sql`이 아직 실행되지 않았습니다.
  DB에 접속해 전체 내용을 실행하세요.
- **예시 양식/수정 요청 기능이 에러를 낸다면**: 이미 예전 버전의 `db/schema.sql`을 실행해둔
  DB라면 `example_storage_path`, `example_filename`, `correction_requested`,
  `correction_message` 컬럼이 없을 수 있습니다. `db/schema.sql` 파일을 다시 열어 하단의
  `alter table ... add column if not exists ...` 구문만 복사해 실행하면 됩니다(재실행해도
  안전합니다).
- **Object Storage 관련 오류**: `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_ENDPOINT`/
  `S3_BUCKET` 값이 정확한지, 버킷이 실제로 존재하는지 확인하세요. `/admin` → "DB/스토리지
  연결 확인"으로 확인 가능합니다.
- **`Invalid key: ...`(파일 업로드 실패)**: Object Storage의 오브젝트 키에 한글/공백이 포함되면
  거부되는 경우가 있습니다. 실제 저장 경로는 UUID 기반 ASCII 문자열로만 구성하고, 한글이 포함된
  원래 파일명은 DB 컬럼(`stored_filename`)에만 보관해 다운로드 시 표시합니다.

## 보안 참고사항

`npm audit` 기준으로 아래 항목이 남아있으며, 실사용 전 인지해두는 것을 권장합니다.

- **xlsx (SheetJS)**: npm 레지스트리에 배포된 버전에는 패치되지 않은 Prototype Pollution / ReDoS
  이슈가 있습니다(SheetJS는 패치 버전을 자체 CDN에서만 배포). 제출자가 업로드한 파일만 파싱하는
  내부용 도구라는 점에서 위험도는 제한적이지만, 운영 환경에서는 `https://cdn.sheetjs.com`에서
  제공하는 최신 패치 버전으로 교체하는 것을 권장합니다.
- **exceljs → uuid(전이 의존성)**: exceljs가 내부적으로 사용하는 uuid 패키지에 알려진 이슈가
  있으나, 외부 입력과 무관한 내부 ID 생성용으로만 사용되어 영향은 제한적입니다.
- **next 번들 postcss**: Next.js가 빌드 도구 내부에 번들한 postcss 버전 관련 경고이며, 프로젝트가
  직접 사용하는 postcss(빌드 시점에만 사용)와는 별개입니다. Next.js 메이저 업그레이드 시 함께
  해소됩니다.

## 알려진 한계 (스캐폴드 범위)

- **HWP 통합 병합은 검증되지 않은 실험적 기능입니다.** HWP5 바이너리 포맷(OLE2 Compound
  File)을 다루는 공개 라이브러리가 없어, `api/_hwplib/cfb.py`가 OLE2 컨테이너 자체를
  직접 구현합니다. `olefile`로 구조적 정합성(섹터/FAT/디렉터리 트리)은 충분히 테스트했지만,
  DocInfo의 DocumentProperties 레코드 레이아웃 등 HWP5 세부 사양에 대한 이해가 실제
  한글 프로그램으로 한 번도 검증되지 않았습니다. 사용 전 반드시 실제 결과물을 한글에서
  열어 확인하고, 신뢰할 수 없으면 ZIP 다운로드로 대체하세요. 서로 다른 스타일/서식 체계를
  가진 문서를 섞으면 문단모양/글자모양 참조가 어긋나 깨질 수 있습니다 — 같은 예시 양식에서
  비롯된 제출물일 때 가장 안전합니다. 컨테이너 크기는 내부적으로 약 7MB(109 FAT 섹터)로
  제한되어 있으며, 초과 시 조용히 깨지는 대신 명확한 에러를 반환합니다.
- **HWP 병합은 별도 런타임(Python)에 의존합니다.** `api/hwp_merge.py`는 Vercel Python
  서버리스 함수로 배포되며(`requirements.txt`의 `olefile` 설치), Next.js의
  `/api/merge`가 내부적으로 이 함수를 호출합니다. 처음엔 원본 파일을 base64로 요청 본문에
  직접 실어 보냈다가 Vercel 함수의 요청/응답 바디 한도(약 4.5MB)를 넘어
  `FUNCTION_PAYLOAD_TOO_LARGE`(413)로 실패하는 문제가 있었습니다. 지금은 파일 내용을
  직접 주고받지 않습니다 — Node(`route.ts`)가 각 원본의 R2 서명 GET URL과, 병합 결과를
  올릴 서명 PUT URL을 미리 발급해 Python에 넘기면, Python은 표준 라이브러리(`urllib`)
  만으로 직접 R2에서 내려받고 업로드합니다. (처음엔 Python 쪽에서 `boto3`로 직접
  업로드/서명하게 했다가 그 무거운 의존성 자체가 Python 함수 배포/실행을 깨뜨려 500
  에러를 냈습니다 — AWS SDK 없이 presigned URL만 주고받는 지금 방식이 훨씬 가볍고
  안정적입니다.) 두 함수 사이의 호출 바디에는 URL 목록처럼 작은 JSON만 오가므로 4.5MB
  한도에 걸리지 않습니다.
  또한 `api/_hwplib/`는 `api/hwp_merge.py`가 import하는 로컬 서브패키지인데, Vercel의
  Python 빌더가 이런 로컬 서브패키지를 자동으로 함수에 함께 포함시켜주지 않을 수 있어
  (명시 설정 없이는 `ModuleNotFoundError`로 매 요청마다 500이 나는 문제가 있었습니다),
  `vercel.json`에 `functions["api/hwp_merge.py"].includeFiles`로 `api/_hwplib/**`를
  명시적으로 포함시켰습니다. 혹시 이 함수를 수정/이동하게 되면 `vercel.json`도 같이
  맞춰주세요 — 안 그러면 조용히 같은 증상(모든 요청이 500)으로 되돌아갑니다.
- PDF/HWP 파일의 개인정보 검출은 브라우저에서 완전한 파싱이 불가능해 best-effort 수준입니다.
  운영 환경에서는 서버 측에서 `pdf-parse`, HWP 파서 등을 붙여 정밀도를 높이는 것을 권장합니다.
- Vercel 서버리스 함수의 기본 요청 본문 크기 제한(약 4.5MB)으로 인해 대용량 파일은 실패할 수 있습니다.
  대용량 파일 지원이 필요하면 Object Storage에 클라이언트에서 직접 업로드(Presigned PUT URL)하는
  방식으로 전환하세요.
- 제출자 식별은 별도 로그인 없이 학교 코드 + 학년/반 조합을 사용하는 경량 모델입니다.
- `lib/db.ts`의 커넥션 풀은 인스턴스당 최대 3개로 제한되어 있습니다. Neon의 Pooled connection을
  사용하면 이 위에 Neon 자체 풀러가 한 번 더 붙어 안전성이 높아집니다.
- 학교 삭제 시 DB 레코드는 `on delete cascade`로 정리되지만, Object Storage에 남아있는 해당
  학교의 제출 파일은 자동으로 삭제되지 않습니다.
