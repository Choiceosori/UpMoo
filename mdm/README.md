# Smart Class Control MDM — 학생 기기 통제 및 수업 관리 시스템

교실에서 학생 기기(Android 태블릿/스마트폰, PC 브라우저)를 실시간으로 모니터링·제어하는 MDM입니다.
기획서([`PLAN.md`](PLAN.md))의 3계층 구조를 그대로 따릅니다.

```
[ 교사 웹 콘솔 ]  <── REST + WebSocket ──>  [ MDM 서버 (Node.js) ]  <── WebSocket ──>  [ 학생 에이전트 ]
  server/public/                              server/src/                                android-agent/ (Android)
                                                   │                                     server/public/student.html (웹)
                                             data/mdm.json (정책·학생·기록)
```

> 기존 UpMoo(Next.js, Vercel)와는 **별도 프로세스**입니다. Vercel 서버리스 함수는 상시 WebSocket 연결을
> 유지할 수 없기 때문에, MDM 서버는 학교 내 PC/서버 또는 NCP Server(VM)·Docker 등 상시 실행 환경에 띄웁니다.

## 폴더 구조

```
mdm/
  server/                     # 백엔드 + 교사 콘솔 (의존성: ws 하나)
    src/index.js              # HTTP/WebSocket 서버 진입점
    src/hub.js                # 교사 ↔ 학생 실시간 중계 (명령, 화면 프레임, 원격 입력, 화면 전송)
    src/http.js               # REST API + 정적 파일
    src/policy.js             # 정책 모델/정규화/웹 필터 판정/프리셋
    src/scheduler.js          # 교시별 정책 예약, 방과 후 자동 해제
    src/store.js              # JSON 파일 저장소 (PostgreSQL/Redis로 교체 가능한 인터페이스)
    src/auth.js               # HMAC 토큰, 비밀번호 비교, 로그인 rate limit
    public/index.html, app.js # 교사 콘솔
    public/student.html, .js  # 웹 학생 에이전트 (PC/크롬북/테스트용)
    test/                     # node:test 단위 + 통합 테스트
  android-agent/              # Android 학생 에이전트 (Kotlin, minSdk 26)
```

## 기획서 대비 구현 현황

| 기획서 항목 | 구현 | 위치 |
|---|---|---|
| 앱 화이트리스트/블랙리스트 | ✅ 접근성 서비스로 전면 앱 감지 → 즉시 홈으로 튕김 + 위반 보고. Device Owner면 블랙리스트 앱 숨김(`setApplicationHidden`) | `BlockerAccessibilityService.kt`, `DeviceController.kt` |
| 웹사이트 차단 (도메인/키워드, 학습 사이트만 허용) | ✅ 주요 브라우저(Chrome, 삼성 인터넷, 웨일, Edge, Firefox, Brave, Opera) 주소창 감시 → 뒤로 가기 | `BlockerAccessibilityService.kt`, `policy.js` |
| 카메라/블루투스/핫스팟 비활성화 | ✅ `setCameraDisabled`, `DISALLOW_BLUETOOTH`, `DISALLOW_CONFIG_TETHERING` | `DeviceController.kt` |
| 볼륨 고정 / 밝기 고정 | ✅ 볼륨 변경 감지 시 재설정, 밝기는 `setSystemSetting` (DO) | `DeviceController.kt`, `AgentService.kt` |
| 전원/리부팅 방지, 설정 앱 접근 제한 | ✅ 키오스크 중 전원 메뉴 차단(Lock Task), 안전모드·초기화 금지, 설정 앱은 접근성으로 차단 | 〃 |
| 락다운(키오스크) 모드 | ✅ 단일 앱 고정 또는 허용 앱 전용 런처. DO면 `startLockTask` + `LOCK_TASK_FEATURE_NONE`(홈·최근 앱·알림창 차단) | `KioskActivity.kt` |
| 실시간 화면 그리드 뷰 + 이상 행위 경고 | ✅ MediaProjection JPEG 썸네일, 위반 시 타일 빨간 테두리 + 토스트 | `ScreenCaptureService.kt`, `app.js` |
| 교사 화면 전체 전송 (전자칠판) | ✅ 브라우저 `getDisplayMedia` → 학생 기기 전체 화면 뷰어 | `app.js`, `ScreenViewerActivity.kt` |
| 학생 화면 공유 (발표 모드) | ✅ 선택 학생 화면을 다른 학생 기기로 중계 | `hub.js` |
| 원격 제어 | ✅ 확대 화면에서 클릭/드래그/길게 누르기 → `dispatchGesture`, 뒤로/홈/최근 앱 | `BlockerAccessibilityService.kt` |
| 전체 화면 잠금 ("선생님을 보세요") | ✅ 전체/선택 학생, 재접속·재부팅 후에도 유지 | `LockScreenActivity.kt` |
| URL 일괄 열기 / 알림 메시지 | ✅ http(s)만 허용, 학생 기기의 웹 정책도 함께 검사 | `hub.js`, `AgentService.kt` |
| PIN / QR 접속 | ✅ 6자리 PIN, QR(웹 참여 페이지 → Android 앱 딥링크 `upmoo-mdm://join`) | `app.js`, `student.js`, `MainActivity.kt` |
| 접속 상태 실시간 파악 | ✅ 온라인/오프라인/잠금/키오스크/권한 누락/배터리/현재 앱 | `app.js` |
| 교시별 자동 정책 + 방과 후 해제 | ✅ 교시 경계에서만 적용(수업 중 교사 수동 변경 유지), 요일·시간대(Asia/Seoul) | `scheduler.js` |
| 네트워크 끊김 시 정책 유지 | ✅ 정책·잠금 상태를 기기에 저장, 오프라인에서도 계속 적용, 지수 백오프 재연결 | `AgentConfig.kt`, `AgentService.kt` |
| 리포트 (딴짓 횟수, 접속 기록) | ✅ 기간별 학생 위반/접속 집계, 최근 기록, CSV 다운로드 | `http.js`, `app.js` |
| 앱 삭제 방지 / 우회 차단 | ✅ DO: 에이전트 `setUninstallBlocked`, 안전모드 부팅 금지. 잠금·키오스크 중 홈/알림창 탈출 시 복귀 | `DeviceController.kt`, `BlockerAccessibilityService.kt` |
| 네트워크 부하 관리 | ✅ 아무도 안 보면 캡처 중지, 그리드는 3초·320px, 확대/발표만 0.6초·960px, 송신 큐가 밀리면 프레임 폐기 | `hub.js#updateCapture` |

## 1. 서버 실행

Node.js 20 이상이 필요합니다.

```bash
cd mdm/server
npm install
MDM_TEACHER_PASSWORD='원하는비밀번호' npm start
```

시작하면 같은 네트워크에서 접속할 주소가 출력됩니다.

```
[mdm] 서버 실행 중 — 포트 8787
  교사 콘솔:   http://192.168.0.10:8787/
  학생 에이전트 서버 주소: ws://192.168.0.10:8787/ws
```

Docker:

```bash
cd mdm/server
docker build -t upmoo-mdm .
docker run -d -p 8787:8787 -v upmoo-mdm-data:/data -e MDM_TEACHER_PASSWORD=... upmoo-mdm
```

### 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MDM_TEACHER_PASSWORD` | (임시 생성 후 콘솔 출력) | 교사 콘솔 로그인 비밀번호 |
| `MDM_PORT` / `PORT` | `8787` | 서버 포트 |
| `MDM_HOST` | `0.0.0.0` | 바인드 주소 |
| `MDM_SECRET` | (데이터 파일에 자동 생성) | 토큰 서명 키 |
| `MDM_DATA_FILE` | `server/data/mdm.json` | 저장 파일 경로 |
| `MDM_TIMEZONE` | `Asia/Seoul` | 시간표 기준 시간대 |
| `MDM_GRID_INTERVAL_MS` / `MDM_GRID_MAX_WIDTH` / `MDM_GRID_QUALITY` | `3000` / `320` / `45` | 그리드 썸네일 주기·폭·JPEG 품질 |
| `MDM_FOCUS_INTERVAL_MS` / `MDM_FOCUS_MAX_WIDTH` / `MDM_FOCUS_QUALITY` | `600` / `960` / `60` | 확대 보기·발표 화면 주기·폭·품질 |

### 테스트

```bash
cd mdm/server
npm test     # 정책/시간표/인증 단위 테스트 + 실제 WebSocket 교사·학생 통합 시나리오
```

## 2. 교사 콘솔 사용법

1. `http://서버주소:8787/` 접속 → 비밀번호로 로그인
2. **새 수업 만들기** → 6자리 PIN 발급. 상단 `PIN` 칩을 누르면 QR 코드가 표시됩니다.
3. **실시간 모니터링**: 학생 썸네일 그리드. 체크박스로 일부 학생만 선택해 명령할 수 있습니다.
   - 화면 잠금/해제, URL 열기, 메시지, 내 화면 전송, 키오스크 모드
   - 타일 클릭 → 확대 화면, **원격 제어 모드**, 개별 잠금, **발표 모드**(이 학생 화면을 전체 공유)
4. **기기 통제 정책**: 프리셋(자유/집중/수업/시험) 또는 직접 편집 → 저장 즉시 모든 학생 기기에 적용
5. **정책 시간표**: 교시별 프리셋 예약, 교시 외 시간 자동 해제
6. **리포트**: 오늘/7일/전체 기간 학생별 위반·접속 집계, 최근 기록, CSV 다운로드

## 3. 학생 기기 (Android 에이전트)

### 빌드

Android Studio(Ladybug 이상)에서 `mdm/android-agent` 폴더를 열고 실행하거나:

```bash
cd mdm/android-agent
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

### 기기 설정 순서

1. APK 설치 → **UpMoo 수업 관리** 앱 실행
2. 서버 주소(`192.168.0.10:8787` 형식도 가능), PIN, 이름/번호 입력 → **수업 참여하기**
   (교사 콘솔 QR을 스캔하면 웹 참여 페이지의 "앱으로 참여" 버튼으로 서버·PIN이 자동 입력됩니다)
3. 화면의 **필수 권한**을 모두 허용
   - 접근성 서비스: 앱·웹 차단, 원격 제어 (필수)
   - 화면 공유: 교사 모니터링 (Android 정책상 기기를 재부팅하면 다시 허용 필요)
   - 기기 관리자: 카메라 제한
   - 배터리 최적화 제외: 백그라운드 연결 유지

### Device Owner 설정 (권장 — 학교 지급 기기)

하드웨어 제한(블루투스/핫스팟/설치·삭제/안전모드/USB), 완전한 키오스크, 에이전트 삭제 방지, 밝기 고정은
**Device Owner** 권한이 있어야 동작합니다. 기기에 Google 계정 등 다른 계정이 없는 초기화 직후 상태에서:

```bash
adb install app-debug.apk
adb shell dpm set-device-owner com.upmoo.mdm.agent/.MdmDeviceAdminReceiver
```

대량 배포 시에는 QR 프로비저닝(공장 초기화 화면 6회 탭), Samsung Knox Mobile Enrollment,
Android Zero-touch 등록을 사용하세요. Device Owner 없이도 접근성 서비스 기반의 앱/웹 차단, 잠금,
소프트 키오스크(이탈 시 복귀), 모니터링, 원격 제어는 동작합니다.

> 참고: `앱 설치 금지` 제한이 켜져 있으면 에이전트 업데이트 설치도 막히므로 업데이트 전 정책을 "자유"로 바꾸세요.

### 웹 에이전트 (PC/크롬북/테스트)

`http://서버주소:8787/join?pin=123456` 에서 브라우저로 참여할 수 있습니다. 화면 잠금, 자료(URL) 열기,
교사 화면 수신, 내 화면 공유(모니터링)가 동작하지만, 브라우저 특성상 다른 앱/탭을 강제로 차단하지는 못합니다.

## 4. 통신 프로토콜 요약 (WebSocket `/ws`, JSON)

연결 후 첫 메시지는 `hello`이며, 10초 내 보내지 않으면 연결이 종료됩니다.

| 방향 | type | 내용 |
|---|---|---|
| 학생→서버 | `hello` | `{role:"student", pin, name, number, deviceId, platform, token?}` |
| 서버→학생 | `welcome` / `rejected` / `removed` | 학생 토큰, 수업명, 현재 정책, 잠금 상태 |
| 서버→학생 | `policy`, `lock`, `open_url`, `message`, `capture_config`, `remote_input`, `broadcast_start/frame/stop` | |
| 학생→서버 | `heartbeat` | 현재 앱, 배터리, 키오스크 여부, 권한 상태 (5초) |
| 학생→서버 | `frame` | base64 JPEG 화면 프레임 |
| 학생→서버 | `violation` | `{kind:"app"\|"web", target}` |
| 교사→서버 | `hello` | `{role:"teacher", token}` (`POST /api/login`으로 발급) |
| 교사→서버 | `subscribe`, `focus`, `command`, `remote_input`, `broadcast_start/frame/stop` | |
| 서버→교사 | `class_state`, `student_update`, `frame`, `violation`, `broadcast_state`, `student_removed` | |

REST: `POST /api/login`, `GET|POST /api/classes`, `GET|PATCH|DELETE /api/classes/:id`,
`GET|PUT /api/classes/:id/policy`, `POST /api/classes/:id/policy/preset`, `GET|PUT /api/classes/:id/schedule`,
`GET /api/classes/:id/report?since=`, `DELETE /api/classes/:id/students/:sid`, `POST /api/classes/:id/reset-violations`

## 5. 보안 및 운영 참고

- 교사 인증은 단일 비밀번호(HMAC 토큰, 12시간) 방식입니다. 여러 교사 계정/학교 단위 권한이 필요하면 기존
  UpMoo의 학교 코드 모델과 연동하세요.
- 학교 외부망에 노출할 경우 반드시 리버스 프록시(Nginx 등)로 **HTTPS/WSS**를 적용하세요. 학생 앱은 `wss://`
  주소도 지원합니다. (내부망 운영을 위해 Android 앱은 평문 `ws://`를 허용하도록 설정되어 있습니다.)
- 학생 화면이 서버를 거쳐 전송되므로 개인정보 처리 방침에 화면 모니터링 사실과 보관하지 않음(서버는 프레임을
  저장하지 않고 중계만 함)을 고지하세요. 학생 기기에는 화면 공유 중임을 알리는 상시 알림이 표시됩니다.
- 저장소는 JSON 파일(단일 프로세스)입니다. 여러 서버 인스턴스로 확장하려면 `store.js`를 PostgreSQL(기존 NCP
  Cloud DB)로, 실시간 세션 공유는 Redis Pub/Sub으로 교체하세요.

## 6. 알려진 한계 / 다음 단계

- 화면 스트리밍은 MVP 단계의 JPEG 프레임 중계입니다. 수십 명 고화질 동시 시청이 필요하면 WebRTC(SFU)로 전환하세요.
- 웹 필터링은 브라우저 주소창을 읽는 방식이라 목록에 없는 브라우저/인앱 브라우저는 감지하지 못합니다.
  화이트리스트 앱 모드로 허용된 브라우저만 쓰게 하거나, Device Owner의 Always-on VPN 기반 DNS 필터링으로 보강하세요.
- 화면 회전 시 캡처 해상도는 시작 시점 기준으로 유지됩니다.
- Android 에이전트는 개발 환경에 Android SDK가 없어 APK 빌드까지는 검증하지 못했고, Kotlin 소스는
  Android 15 프레임워크 클래스(Robolectric android-all)에 대해 컴파일 검증했습니다. 실기기 테스트가 필요합니다.
- iOS(Apple School Manager + MDM 프로토콜), Windows 에이전트는 범위 밖입니다.
