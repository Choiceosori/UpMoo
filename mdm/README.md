# 우리반 수업도우미 — 학생 기기 통제 및 수업 관리 시스템

학생 태블릿과 선생님 화면을 하나로 묶어 활동지·화이트보드·에듀테크 링크·퀴즈를 한 곳에서 보내고 살펴보는
수업 관리(MDM) 시스템입니다. 기획서([`PLAN.md`](PLAN.md))와, 함께 받은 **'우리반 수업도우미' 사용 안내**와
**선생님 화면**을 기준으로 다시 만들었습니다.

```
[ 선생님 화면 /teacher ] ──REST + WebSocket──▶ [ 수업 서버 (Node.js) ] ◀──WebSocket── [ 학생 화면 / ]
                                                     │                              ▲ 웹 브라우저 또는
                                             data/ (반·수업·필기·기록)               └ '우리반 수업' 안드로이드 앱(WebView)
```

> 기존 UpMoo(Next.js, Vercel)와는 **별도 프로세스**입니다. 상시 WebSocket 연결이 필요해 학교 서버/PC,
> NCP Server(VM), Docker 같은 상시 실행 환경에 띄웁니다.

## 폴더 구조

```
mdm/
  PLAN.md                      # 처음 기획서
  server/
    src/index.js               # 서버 시작
    src/hub.js                 # 실시간 중계: 입장(방 코드+번호), 판서·필기, 링크, 멈춤, 화면 공유·발표, 학생 화면 보기, 모둠, 퀴즈
    src/http.js                # REST: 로그인(구글·관리자 비밀번호)·사용 신청, 관리, 수업·쪽·활동지 올리기, 링크 확인, 기록·피드백·CSV, 퀴즈
    src/lesson.js              # 수업 모델(순수 함수): 쪽, 획 검증, 링크 정리(유튜브·패들렛), 카드 상태, 모둠 나누기, 퀴즈 채점, 통계
    src/store.js               # 파일 저장소 (data/db.json, data/lessons/*.json, data/files/*)
    src/auth.js                # HMAC 토큰, 구글 ID 토큰 검증(RS256), 로그인 횟수 제한
    public/teacher.html        # 선생님 화면 (+ js/teacher.js)
    public/student.html        # 학생 화면: 방 코드 숫자판 → 번호 → 수업 (+ js/student.js)
    public/guide.html          # 사용 안내 / app.html 학생 앱 설치 / privacy.html 처리방침
    public/js/common.js        # 판(Board: 쪽 바탕 + 필기 층), 펜 도구, PDF→그림, QR
    public/css/app.css, icons.svg, brand/mark.svg
    test/                      # 단위 테스트 + 선생님·학생 WebSocket 통합 테스트
  android-agent/               # '우리반 수업' 안드로이드 앱 (Kotlin, minSdk 26)
```

## 기능

| 사용 안내 항목 | 구현 |
|---|---|
| 로그인 · 사용 신청 · 관리자 승인 | 구글 로그인(Google Identity Services, 서버에서 ID 토큰 서명 검증) + 관리자 비밀번호. 처음 온 선생님은 사용 신청 → 관리자가 반을 골라 승인/거절 |
| 반 고르기 · 관리 | 반 만들기·이름·삭제, 반별 담당 선생님 체크, 선생님 등록·관리자 지정, 저장 공간, 모든 반 활용 기록 CSV |
| 학생 들어오기 | 4자리 방 코드 + 번호(로그인 없음), QR(TV 크게), 이미 앉은 번호는 막힘, **입장 잠그기**(새 기기 차단·선생님에게 알림, 들어왔던 기기는 재접속 가능), 자리 비우기 |
| 반 설정 | 마지막 번호, 빈 번호(전출) 끄기, 이름표 — **이름은 선생님 기기에만 저장**(서버에는 번호만), 엑셀 이름 목록 붙여넣기 |
| 활동지 · 내 판서 | PDF(쪽마다)·사진 올리기(브라우저에서 pdf.js로 그림 변환), 선생님 판서가 학생 화면에 실시간, 학생 필기는 학생·선생님 화면에만, 따라오기, ← → 쪽 넘기기 |
| 화이트보드 | 흰 판·모눈·줄 공책, 새 수업을 화이트보드로 시작, "학생 화면도 데려오기" |
| 링크 보내기 | 서버가 사이트 헤더(X-Frame-Options·CSP)를 확인해 **앱 안에서 열기/새 창으로 열기** 자동 선택, 학생 화면 미리 보기, 유튜브(t= 시작 시각)·패들렛 전용 주소 변환, 로그인 필요(새 창에서 로그인 → 돌아오면 다시 열기), 모두 돌아오기(학생이 연 새 창도 닫기), 최근에 보낸 링크 |
| 수업 자료(쪽 순서) | 활동지·화이트보드·**링크 쪽** 순서 바꾸기·지우기, 따라오기 중 링크 쪽으로 가면 학생 화면에 열림, 지난 수업(맡은 다른 반 포함)에서 가져오기 |
| 학생 찾아보기 | 구글 안전 검색·주소를 화면 안 탭(3개)으로, 선생님 링크 쪽 바로 열기, 찾아본 곳이 카드·기록에 남음 |
| 학생 보기 · 통제 | 카드(초록 수업 화면 / 빨강 깜빡임 앱 벗어남·이탈 n / 하늘색 링크 보는 중·링크로 나감·확인 필요 / 흐림 안 들어옴·연결 끊김), 거르기, 카드 크기, 학생별 필기 미리 보기, 크게 보기(쪽 넘기기, 연 탭·찾아본 곳), **모두 멈춤**("선생님을 봐 주세요") |
| 화면 공유 | 선생님 화면(크롬·엣지·웨일 `getDisplayMedia`)을 학생 기기로, 학생 화면을 **모두에게 보여 주기**(발표) |
| 실시간 화면 | 최대 6명, 1명 ≈ 초당 8장 → 6명 ≈ 3장, 한 화면만 크게, 노트북 학생은 '화면 선택·공유' 허용, 앱 학생은 녹화 허용(거절하면 앱 화면 그림으로) |
| 모둠 활동 | 모둠 나누기(번호 순서·골고루 섞기), 판 바탕(빈 판·모눈·활동지 쪽), 모둠원이 한 판에 함께 쓰기·메모, 선생님 함께 쓰기·이 모둠 멈춤, 산출물 PNG 저장, 지난 모둠 판 이어 쓰기 |
| 퀴즈 | 객관식·O·X·단답형·서술형, 모든 반 공유, 결과 바로/나중에 보여 주기, 현황판(제출·평균·문제별 정답률·안 낸 학생), 정답 인정·서술형 점수, 지난 결과와 점수 변화(▲%p), 학생별 점수 CSV |
| 수업 끝내기 · 기록 | 수업 끝내기(학생 화면 "수업이 끝났어요", 방 코드 만료), 끝내지 않고 새 수업도 가능, 활용 기록 표·CSV(결과보고서용 기능별 횟수), 수업 돌아보기(학생 활동·학생 화면·모둠 판), 학생별 피드백 자동 저장, 이 자료로 새 수업 |
| 학생 앱 '우리반 수업' | 새 창도 앱 안 탭으로(크롬으로 안 나감), 카드에 "앱 · 탭 2" "탭: …", 앱 탭 모두 닫기, 학생 화면 보기(4초마다 작은 그림), 실시간 화면, 구글 로그인 탭(크롬 Custom Tab), 앱 고정(Device Owner면 확인 없이 + 홈·알림창·전원 메뉴 차단, 앱 삭제·안전모드 우회 방지) |

## 1. 서버 실행

Node.js 20 이상.

```bash
cd mdm/server
npm install
MDM_ADMIN_PASSWORD='관리자비밀번호' MDM_SCHOOL_NAME='○○초등학교' npm start
```

```
[woori] 우리반 수업도우미 실행 중 — 포트 8787
  선생님 화면: http://192.168.0.10:8787/teacher
  학생 입장:   http://192.168.0.10:8787/
```

1. `/teacher`에서 관리자 비밀번호로 들어가 **관리 → 반 만들기**, 선생님 이메일 등록·반 배정.
2. 구글 로그인을 쓰려면 Google Cloud Console에서 **OAuth 클라이언트 ID(웹 애플리케이션)** 를 만들고
   승인된 자바스크립트 원본에 서버 주소(예: `https://class.school.kr`)를 넣은 뒤 `MDM_GOOGLE_CLIENT_ID`로 줍니다.
   구글 로그인은 **HTTPS 주소**(또는 `http://localhost`)에서만 동작하므로 학교 밖에서 쓰면 리버스 프록시로 HTTPS를 붙이세요.

Docker:

```bash
cd mdm/server
docker build -t woori-class .
docker run -d -p 8787:8787 -v woori-data:/data -e MDM_ADMIN_PASSWORD=... -e MDM_SCHOOL_NAME=... woori-class
```

### 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MDM_ADMIN_PASSWORD` | (임시 생성 후 출력) | 관리자 비밀번호 |
| `MDM_GOOGLE_CLIENT_ID` | (없음 → 구글 로그인 숨김) | Google Identity Services 웹 클라이언트 ID |
| `MDM_ADMIN_EMAILS` | | 처음부터 관리자인 구글 계정(쉼표) |
| `MDM_SCHOOL_NAME` / `MDM_APP_NAME` | `우리 학교` / `우리반 수업도우미` | 화면에 보이는 이름 |
| `MDM_LOGIN_SITES` | | '로그인이 필요해요'를 저절로 켤 도메인(쉼표, 예: 경북AI배움터 도메인) |
| `MDM_PORT` / `MDM_HOST` | `8787` / `0.0.0.0` | |
| `MDM_DATA_DIR` | `server/data` | 저장 폴더 |
| `MDM_SECRET` | (data에 자동 생성) | 토큰 서명 키 |
| `MDM_TIMEZONE` | `Asia/Seoul` | CSV 날짜 |
| `MDM_SNAP_INTERVAL_MS` / `MDM_SNAP_MAX_WIDTH` | `4000` / `360` | 학생 화면 보기 |
| `MDM_LIVE_MAX_WIDTH` | `960` | 실시간 화면 |
| `MDM_MAX_UPLOAD_BYTES` | `8000000` | 활동지 한 쪽 최대 크기 |

### 테스트

```bash
cd mdm/server
npm test   # 링크 정리·획 검증·카드 상태·모둠·퀴즈 채점·구글 토큰 검증 + 실제 WebSocket 통합 시나리오
```

통합 시나리오: 관리자 로그인·반·선생님 승인/거절 → 수업 시작(모눈 화이트보드) → 활동지 올리기 → 학생 입장
(빈 번호·이미 앉은 번호 거부) → 판서/필기/되돌리기 → 따라오기·모두 멈춤 → 앱 벗어남 감지 → 링크 보내기·모두
돌아오기 → 입장 잠그기(새 기기 거부, 기존 기기 재입장) → 학생 화면 보기 → 모두에게 보여 주기 → 자리 비우기 →
퀴즈(정답 비공개·채점·정답 인정) → 모둠(그리기·메모·멈춤) → 수업 끝내기 → 활용 기록·돌아보기·피드백·CSV →
지난 수업 자료로 새 수업.

## 2. 학생 앱 '우리반 수업' (Android)

```bash
cd mdm/android-agent
./gradlew assembleRelease   # 또는 Android Studio에서 열어 빌드
```

빌드한 APK를 `mdm/server/public/app/woori-class.apk`로 두면 `/app` 페이지의 QR로 학생이 설치할 수 있어요.

앱은 학생 화면(`/`)을 WebView로 띄우고 `WooriApp` 자바스크립트 다리로 다음을 해요.

| 다리 함수 | 하는 일 |
|---|---|
| `setCapture(mode, intervalMs, maxWidth)` | `snap`: 앱 화면을 PixelCopy로 4초마다(허락 창 없음) / `live`: MediaProjection 허락 후 태블릿 전체 화면, 거절하면 앱 화면 / `off` |
| `openTab(url, title)`, `closeTabs()` | 앱 위쪽 탭(최대 5개). 사이트가 여는 새 창(`window.open`, `target=_blank`)도 탭으로. `accounts.google.com`은 크롬 Custom Tab |
| `setPinned(bool)` | 수업에 들어오면 앱 고정(`startLockTask`) + 연결 유지용 포그라운드 서비스 |
| 앱 → 화면 | `window.wooriApp.onFrame(b64,w,h)`, `onTabs(json)`, `onCaptureState(state)` |

**Device Owner(권장, 학교 지급 기기)**: 초기화 직후 다른 계정이 없는 기기에서

```bash
adb install woori-class.apk
adb shell dpm set-device-owner com.upmoo.mdm.agent/.MdmDeviceAdminReceiver
```

→ 앱 고정이 확인 창 없이 되고 홈·최근 앱·알림창·전원 메뉴가 막히며(`LOCK_TASK_FEATURE_NONE`), 앱 삭제와 안전모드
부팅 우회가 막혀요. 대량 배포는 QR 프로비저닝, Samsung Knox Mobile Enrollment, Zero-touch를 쓰세요.

## 3. 통신 요약 (WebSocket `/ws`, JSON)

| 방향 | type |
|---|---|
| 학생→서버 | `hello{role:"student",code,seat,deviceId,kind}`, `status{visible,link,page,tab,tabs}`, `ink`/`ink_undo`/`ink_clear`, `gink`/`gmemo`/`gmemo_del`, `link_open`, `explore`, `frame`, `capture_state`, `quiz_submit` |
| 서버→학생 | `welcome`/`rejected`/`released`/`ended`, `flags{follow,teacherPage,locked,explore}`, `pages`, `title`, `ink`/`ink_set`, `link`, `close_tabs`, `share`/`share_frame`, `capture{mode,intervalMs,maxWidth}`, `group`, `gink`/`gmemo`/…, `quiz` |
| 선생님→서버 | `hello{role:"teacher",token,classId}`, `set{follow,teacherPage,locked,explore,entryLocked}`, `ink`…, `link_send`/`link_back`, `release_seat`, `close_tabs`, `share_start`/`share_frame`/`share_stop`, `snap`, `live{seats}`, `present{seat}`, `group_set`/`group_start`/`group_stop`/`group_lock`/`gink`/`gmemo`, `quiz_start`/`quiz_reveal`/`quiz_end`/`quiz_accept`/`quiz_score` |
| 서버→선생님 | `state`(반·수업·자리·실행 상태 전체), `seat`, `flags`, `pages`, `ink`/`ink_set`, `link`, `runtime`, `frame`, `entry_blocked`, `groups`/`group_state`, `quiz_dash` |

## 4. 원본(사용 안내)과 다른 점

받은 사용 안내는 Cloudflare(Workers·Durable Objects·Realtime) 위에서 도는 서비스를 설명합니다. 이 저장소의
구현은 학교 서버에서 도는 Node.js라서 아래가 다르며, `public/guide.html`도 이에 맞게 고쳐 썼습니다.

- **저장**: Durable Objects 대신 서버의 `data/` 폴더(JSON + 그림 파일).
- **실시간 화면 '영상'(WebRTC, Cloudflare Realtime)** 은 넣지 않았어요. 모두 그림(JPEG) 중계이며, 밀린 그림은 버려 늘 최신 화면을 보여요.
- **"선생님이 불러요" 알림**은 웹 푸시(서버 푸시) 없이, 학생 화면 탭이 살아 있을 때 브라우저 알림으로만 가요.
- **아이패드 앱**은 없어요(웹 주소로 사용).
- 학교 이름·교표·저작권 표시는 넣지 않았어요(`MDM_SCHOOL_NAME`으로 학교 이름만 표시).
- 함께 받은 선생님 화면 HTML(저장된 페이지)은 화면 구성과 요소 이름을 맞추는 데만 참고했고, 저장소에는 넣지 않았어요(브라우저 확장 프로그램 코드가 섞여 있음).

## 5. 보안·운영 참고

- 선생님 토큰은 HMAC 서명(14일), 승인이 취소되면 바로 막혀요. 맡은 반만 볼 수 있어요(관리자는 전체).
- 학생은 방 코드 + 번호 + 기기 값으로 구분하고 이름은 서버에 없어요. 입장 잠그기로 낯선 기기를 막아요.
- 링크 확인(`/api/link-check`)은 선생님만 쓸 수 있고, 내부망 주소로는 요청하지 않아요(SSRF 방지).
- 학생 화면 그림은 서버가 중계만 하고 저장하지 않아요. 학생 화면에 보고 있다는 표시가 떠요.
- 학교 밖에 노출하면 반드시 HTTPS(리버스 프록시)를 쓰세요. 학생 앱은 내부망을 위해 평문 HTTP도 허용합니다.
- 한 서버 프로세스 기준이에요. 여러 대로 늘리려면 `store.js`를 PostgreSQL(기존 NCP Cloud DB)로, 실시간 중계를 Redis Pub/Sub으로 바꾸세요.

## 6. 검증 범위 / 알려진 한계

- 서버: 단위·통합 테스트 11개 통과. 선생님·학생 화면은 Chromium으로 전체 흐름(입장·판서·멈춤·링크·퀴즈·모둠·끝내기·기록)과
  앱 다리(학생 화면 보기·탭 보고·탭 닫기·실시간)를 자동 점검했어요.
- 안드로이드 앱: 개발 환경에 Android SDK가 없어 **APK 빌드와 실기기 시험은 하지 못했어요.** Kotlin 소스는 Android 15
  프레임워크 클래스(Robolectric android-all)로 컴파일 검증했습니다.
- 앱 안(iframe)에 넣을 수 있는지는 사이트 헤더로 판단해요. 헤더 없이 스크립트로 막는 사이트는 미리 보기로 확인해 주세요.
- 인터넷이 끊긴 동안 쓴 학생 필기는 화면에는 남지만 서버로 다시 보내지는 않아요.
