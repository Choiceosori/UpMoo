# Windows HWP 병합 서비스

HWP(한글) 파일을 진짜 한글 프로그램으로 병합하는 작은 HTTP 서비스입니다.
Vercel은 Linux 서버리스 환경이라 한글 프로그램을 실행할 수 없어서, 이
서비스는 **한글 프로그램이 설치된 Windows PC에서 직접 실행**해야 합니다.

## 왜 필요한가

Vercel에 함께 배포되는 `api/hwp_merge.py`는 HWP5(OLE2 Compound File) 포맷을
처음부터 직접 구현해서 병합을 흉내 내는 실험적 기능입니다. 구조적으로는
문제가 없어 보여도, 실제 한글 프로그램으로 열어보면 한컴의 비공개 내부
검증을 통과하지 못할 수 있습니다. 이 서비스는 흉내 내는 대신 **실제 한글
프로그램 자체**(COM 자동화, `comtypes`)가 파일을 열고 이어 붙이고 저장하게
하므로, 결과물이 항상 한글에서 정상적으로 열립니다.

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
set MERGE_SECRET=원하는-비밀값
set PORT=8765
python server.py
```

`MERGE_SECRET`은 외부(인터넷)에서 아무나 이 서비스를 호출하지 못하게 막는
공유 비밀값입니다. 반드시 설정하세요 — 설정하지 않으면 경고 메시지가
표시됩니다.

## 외부에 노출하기

Vercel(클라우드)이 이 PC로 요청을 보낼 수 있어야 합니다. 집 공유기
포트포워딩이나 고정 IP 없이 가장 간단한 방법은 **Cloudflare Tunnel**입니다.

1. [Cloudflare Tunnel 설치](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/)
2. 아래처럼 로컬 포트를 외부 HTTPS 주소로 연결:
   ```
   cloudflared tunnel --url http://localhost:8765
   ```
3. 터미널에 출력되는 `https://xxxxx.trycloudflare.com` 같은 주소가 외부 공개
   URL입니다. (매번 바뀌는 임시 주소이므로, 계속 쓰려면 Cloudflare
   계정으로 고정 터널을 만드는 걸 권장합니다 — 위 링크의 "Named tunnels" 참고)

ngrok 등 다른 터널 서비스를 써도 동일하게 동작합니다.

## Vercel에 연결하기

Vercel 프로젝트 환경변수에 아래 두 개를 등록하고 재배포하세요:

```
HWP_MERGE_SERVICE_URL=https://<터널 공개 주소>/merge
HWP_MERGE_SERVICE_SECRET=<MERGE_SECRET과 동일한 값>
```

이 값이 설정되어 있으면 앱의 HWP 통합 다운로드가 자동으로 이 서비스를
호출합니다. 설정하지 않으면 기존 `api/hwp_merge.py`(실험적, 비권장)로
자동 대체됩니다.

## 동작 확인

서비스를 실행한 뒤, 업무 상세 화면에서 "HWP 통합 다운로드"를 눌러보세요.
PC에서 한글 창이 잠깐 (숨김 상태로) 떴다가 사라지면서 병합이 진행됩니다.
병합된 파일을 실제로 열어서 정상적으로 보이는지 꼭 확인하세요.

## 제약 사항

- 이 PC가 꺼져 있거나 네트워크가 끊기면 HWP 통합 다운로드가 실패합니다.
- 한 번에 하나의 병합 요청만 처리합니다(동시 요청은 503으로 거부).
- 파일이 매우 크거나 개수가 많으면 한글이 파일을 열고 붙이는 데 시간이
  걸릴 수 있습니다.
