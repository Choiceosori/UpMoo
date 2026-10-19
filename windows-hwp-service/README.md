# Windows HWP 병합 워커

HWP(한글) 파일을 진짜 한글 프로그램으로 병합하는 작은 폴링 워커입니다.
Vercel은 Linux 서버리스 환경이라 한글 프로그램을 실행할 수 없어서, 이
워커는 **한글 프로그램이 설치된 Windows PC에서 직접 실행**해야 합니다.

## 왜 필요한가

Vercel에 함께 배포되는 `api/hwp_merge.py`는 HWP5(OLE2 Compound File) 포맷을
처음부터 직접 구현해서 병합을 흉내 내는 실험적 기능입니다. 구조적으로는
문제가 없어 보여도, 실제 한글 프로그램으로 열어보면 한컴의 비공개 내부
검증을 통과하지 못할 수 있습니다. 이 워커는 흉내 내는 대신 **실제 한글
프로그램 자체**(COM 자동화, `comtypes`)가 파일을 열고 이어 붙이고 저장하게
하므로, 결과물이 항상 한글에서 정상적으로 열립니다.

## 왜 "폴링" 방식인가 (포트포워딩/터널 필요 없음)

Vercel이 이 PC를 직접 호출하는 방식(HTTP 서버를 띄우고 Cloudflare Tunnel이나
ngrok으로 외부에 노출)도 가능하지만, 학교·회사 네트워크가 이런 터널링 도구를
막는 경우가 흔합니다(SSL 검사 프록시가 터널 연결을 가로채 에러 페이지를
돌려주는 식으로 나타남). 그래서 이 워커는 반대로 동작합니다 — **이 PC가
Vercel에게 몇 초 간격으로 "할 일 있나요?"라고 계속 물어봅니다.** 이건
일반적인 웹 브라우징과 완전히 똑같은, 밖으로 나가는 HTTPS 요청이라 방화벽에
막힐 일이 없습니다. 포트를 열거나 터널링 도구를 설치할 필요가 전혀 없습니다.

## 준비물

- Windows PC (또는 Windows 서버/VM), 항상 켜져 있고 인터넷에 연결되어 있어야 함
- 정식 설치/라이선스된 한글 프로그램
- Python 3.9+ (Windows용)

## 설치

```
pip install -r requirements.txt
```

## 실행

```
set APP_BASE_URL=https://<Vercel 배포 주소>
set MERGE_SECRET=원하는-비밀값
python worker.py
```

- `APP_BASE_URL`: 앱이 배포된 Vercel 주소입니다 (예: `https://up-moo.vercel.app`).
- `MERGE_SECRET`: 아무나 작업을 가로채거나 가짜 완료 보고를 하지 못하게 막는
  공유 비밀값입니다. 반드시 설정하세요.

실행하면 "HWP 병합 워커 시작 — ...를 N초 간격으로 폴링합니다"라는 메시지가
뜨고 계속 실행 상태로 남아있습니다 — 이 창을 닫으면 워커가 멈춥니다. 작업이
들어오면 화면에 로그가 찍히면서 한글 창이 잠깐 (숨김 상태로) 떴다가 사라지며
병합이 진행됩니다.

## 자동 실행 설정 (Windows 로그인 시 자동 시작, 권장)

매번 PowerShell을 열어 수동으로 실행하는 건 번거롭고 깜빡하기 쉽습니다.
Windows에 로그인할 때 자동으로 워커가 떠 있도록 설정하세요.

1. `start-worker.bat` 파일을 `worker.py`와 **같은 폴더**에 받으세요:
   ```
   Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Choiceosori/UpMoo/claude/school-task-collection-system-p22kf0/windows-hwp-service/start-worker.bat" -OutFile "C:\Users\USER\Desktop\start-worker.bat"
   ```
2. `start-worker.bat`을 **메모장으로 열어서** `APP_BASE_URL`과 `MERGE_SECRET` 값을
   본인 환경에 맞게 수정하고 저장하세요 (Vercel에 등록한 값과 동일해야 합니다).
3. 더블클릭해서 정상적으로 뜨는지 먼저 확인하세요 (평소처럼 "HWP 병합 워커
   시작..." 메시지가 뜨면 성공).
4. Windows 시작 프로그램 폴더를 엽니다 — 키보드에서 `Win + R`을 누르고
   `shell:startup`을 입력한 뒤 Enter.
5. 열린 폴더에 `start-worker.bat`의 **바로가기**를 만들어 넣으세요 (`start-worker.bat`을
   우클릭 → 복사 → 그 폴더에서 우클릭 → "바로 가기 붙여넣기").

이제 이 PC에 로그인할 때마다 워커 창이 자동으로 뜹니다. 평소에는 창을 최소화해두시면
됩니다 — 닫으면 워커가 멈추니 닫지만 마세요. PC를 재부팅했다면 반드시 다시
로그인해야 워커가 켜집니다.

## 더 안정적인 자동 실행 (작업 스케줄러, 선택)

위 방법(시작프로그램 바로가기)은 간단하지만, 워커가 죽어도 자동으로 다시 켜지지
않고, 매번 직접 로그인해야 합니다. `setup-scheduled-task.ps1`로 Windows **작업
스케줄러**에 등록하면 죽어도 자동 재시작되고, 더 안정적으로 관리할 수 있습니다.

1. `start-worker.bat`에 `APP_BASE_URL`/`MERGE_SECRET` 값을 먼저 채워두세요(위
   "자동 실행 설정" 1~2번과 동일).
2. 같은 폴더에 설정 스크립트를 받으세요:
   ```
   Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Choiceosori/UpMoo/claude/school-task-collection-system-p22kf0/windows-hwp-service/setup-scheduled-task.ps1" -OutFile "C:\Users\USER\Desktop\setup-scheduled-task.ps1"
   ```
3. PowerShell을 **관리자 권한으로 실행**(시작 메뉴에서 PowerShell 우클릭 →
   "관리자 권한으로 실행")한 뒤, 파일이 있는 폴더로 이동해서 실행:
   ```
   cd C:\Users\USER\Desktop
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\setup-scheduled-task.ps1
   ```
   "등록 완료 (로그인 시 시작 + 자동 재시작)" 메시지가 뜨면 성공입니다. 이제
   시작프로그램 바로가기는 지워도 되고 그대로 둬도 됩니다(둘 다 있어도 워커가
   두 번 뜨지는 않도록 `-MultipleInstances IgnoreNew`로 막아뒀습니다).

### (실험적) 로그인 없이도 완전 무인 실행

```
.\setup-scheduled-task.ps1 -Unattended
```

이 모드는 PC가 켜지기만 하면 아무도 로그인하지 않아도 워커가 실행됩니다. 다만
Windows의 **Session 0 격리** 때문에 한글 같은 GUI 자동화 프로그램이 이 모드에서
정상 동작하지 않는 경우가 있습니다 — 반드시 직접 테스트해보세요:

```
Start-ScheduledTask -TaskName "UpMoo HWP Merge Worker"
```

실행 후 앱에서 "HWP 통합 다운로드"를 눌러보고, 보이는 창이 없으므로 결과는
`worker.log` 파일(스크립트와 같은 폴더에 생성됨)로 확인하세요. 안 되면 일반
모드로 다시 등록하면 됩니다:

```
.\setup-scheduled-task.ps1
```

### 등록된 작업 확인/삭제

Windows 검색에서 "작업 스케줄러"를 열면 "UpMoo HWP Merge Worker"라는 이름으로
보입니다. 삭제하려면:

```
Unregister-ScheduledTask -TaskName "UpMoo HWP Merge Worker" -Confirm:$false
```

## Vercel에 연결하기

Vercel 프로젝트 환경변수에 동일한 비밀값을 등록하고 재배포하세요:

```
HWP_MERGE_WORKER_SECRET=<MERGE_SECRET과 동일한 값>
```

이 값을 등록하면, 앱의 HWP 통합 다운로드가 자동으로 `hwp_merge_jobs`
테이블에 작업을 등록하고 이 워커가 가져가 처리하는 방식으로 동작합니다.
(DB 스키마는 `db/schema.sql`의 `hwp_merge_jobs` 테이블을 참고 — 이미 실행한
DB라면 하단의 idempotent 구문만 다시 실행하면 됩니다.)

## 동작 확인

워커를 실행한 뒤, 업무 상세 화면에서 "HWP 통합 다운로드"를 눌러보세요. 몇 초
안에 워커 창에 작업 로그가 뜨고, PC에서 한글 창이 잠깐 떴다가 사라지면서
병합이 진행됩니다. 병합된 파일을 실제로 열어서 정상적으로 보이는지 꼭
확인하세요.

## 제약 사항

- 이 PC가 꺼져 있거나 워커가 실행 중이 아니면, HWP 통합 다운로드가 최대 50초
  정도 기다리다가 "평일 업무시간에 다시 시도해달라"는 안내로 실패합니다.
- 한 번에 하나의 병합 작업만 처리합니다(HWP COM 자동화는 동시 실행에 약합니다).
  동시에 여러 업무를 병합하려면 순서대로 눌러주세요.
- 파일이 매우 크거나 개수가 많으면 한글이 파일을 열고 붙이는 데 시간이
  걸릴 수 있습니다.
