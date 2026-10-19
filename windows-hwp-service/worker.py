"""
Windows + 실제 설치된 한글(HWP) 프로그램을 이용해 여러 HWP 파일을 진짜로
병합하는 전용 워커입니다.

왜 필요한가: Vercel은 Linux 서버리스 환경이라 한글 프로그램 자체를 설치하거나
실행할 수 없습니다(COM 자동화는 Windows 전용 기술). api/hwp_merge.py처럼
OLE2/HWP5 바이너리 포맷을 처음부터 직접 구현해서 흉내 내려는 시도는 구조적
정합성은 맞출 수 있어도, 한컴의 비공개 내부 검증 로직까지는 따라가기 어렵다는
게 실제 한글로 테스트하며 확인됐습니다. 그래서 이 워커는 "흉내"가 아니라
사용자가 예전부터 쓰던 Tkinter 수합 프로그램과 동일하게, comtypes로 진짜
HWPFrame.HwpObject를 띄워 InsertFile/SaveAs를 시킵니다 — 실제 한글이 파일을
저장하므로 포맷이 항상 올바릅니다.

왜 서버가 아니라 "폴링 워커"인가: 처음엔 이 PC에서 HTTP 서버를 띄우고 Vercel이
직접 호출하는 방식(server.py, 지금은 레거시)으로 만들었는데, 학교/회사
네트워크가 Cloudflare Tunnel·ngrok 같은 터널링 도구를 막는 경우가 흔해서(SSL
검사 프록시가 터널 핸드셰이크를 가로채 HTML 에러 페이지를 돌려주는 식으로
나타남) 외부에서 이 PC로 들어오는 연결 자체를 만들 수 없는 환경이 많았습니다.
그래서 반대로 이 PC가 Vercel에 "할 일 있어?"라고 몇 초 간격으로 계속
물어보는(폴링) 방식으로 바꿨습니다 — 일반적인 웹 브라우징과 똑같은 **나가는**
HTTPS 요청만 하면 되므로 방화벽/프록시에 막힐 일이 없습니다. 포트 열기,
터널링 도구 설치가 전혀 필요 없습니다.

실행 전제 조건:
  - Windows PC (또는 Windows 서버/VM), 인터넷에 항상 연결되어 있어야 함
  - 한글 프로그램이 정식 설치/라이선스 되어 있어야 함
  - pip install -r requirements.txt

실행:
  set APP_BASE_URL=https://<Vercel 배포 주소>     (예: https://up-moo.vercel.app)
  set MERGE_SECRET=원하는-비밀값
  python worker.py

Vercel 프로젝트 환경변수에도 동일한 비밀값을 등록하세요:
  HWP_MERGE_WORKER_SECRET=<MERGE_SECRET과 동일한 값>

(HWP_MERGE_SERVICE_URL 환경변수는 설정하지 마세요 — 그게 설정되어 있으면
Next.js 쪽이 이 폴링 방식 대신 예전 직접 호출 방식을 쓰려고 시도합니다.)
"""
import json
import os
import shutil
import tempfile
import time
import urllib.error
import urllib.request

# 학교/회사 네트워크는 SSL 검사(인터셉션) 프록시를 두는 경우가 흔합니다 — 모든
# HTTPS 트래픽을 자체 인증서로 다시 서명해서 가로채는 방식인데, 브라우저는
# Windows가 그 인증서를 신뢰하도록 이미 설정되어 있어 정상으로 보이지만,
# Python은 자체 인증서 목록(certifi)을 따로 쓰기 때문에 그 인증서를 몰라
# "CERTIFICATE_VERIFY_FAILED"로 막힙니다. truststore는 Python의 ssl 모듈이
# Windows 자체 인증서 저장소(이미 그 프록시 인증서를 신뢰함)를 그대로 쓰게
# 해줘서, 인증서를 직접 찾아 설치할 필요 없이 바로 해결됩니다.
import truststore

truststore.inject_into_ssl()

import comtypes
import comtypes.client as client

APP_BASE_URL = os.environ.get("APP_BASE_URL", "").rstrip("/")
MERGE_SECRET = os.environ.get("MERGE_SECRET", "")
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "3"))


def _download(url: str, dest_path: str) -> None:
    with urllib.request.urlopen(url, timeout=60) as resp:
        data = resp.read()
    with open(dest_path, "wb") as f:
        f.write(data)


def _upload(url: str, path: str) -> None:
    with open(path, "rb") as f:
        data = f.read()
    request = urllib.request.Request(url, data=data, method="PUT")
    with urllib.request.urlopen(request, timeout=60) as resp:
        if resp.status not in (200, 201, 204):
            raise RuntimeError(f"업로드 응답이 비정상입니다 (HTTP {resp.status}).")


def merge_with_real_hwp(file_paths, output_path):
    """실제 한글 프로그램을 COM으로 띄워 file_paths를 순서대로 이어붙여
    output_path에 저장합니다. 로직은 사용자의 기존 Tkinter 수합 프로그램
    (HWPCombinerApp.combine_files)과 동일하며, GUI/대화상자만 제거했습니다."""
    comtypes.CoInitialize()
    hwp = None
    try:
        # dynamic=True: comtypes가 타입 라이브러리를 미리 분석해 정적 Python
        # 래퍼 코드를 생성하는 대신, 호출 시점마다 바로 디스패치합니다. 그
        # 정적 코드 생성 과정에서 한글 타입 라이브러리 안의 한국어 문자열을
        # 이 PC의 시스템 로캘(코드페이지)로 디코딩하지 못해 깨지는 경우가
        # 있어서(영어 로캘로 설정된 PC에서 흔함), 그 과정 자체를 건너뜁니다.
        hwp = client.CreateObject("HWPFrame.HwpObject", dynamic=True)
        hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        hwp.XHwpWindows.Item(0).Visible = False  # 한글 창 숨김

        first_file = file_paths[0]
        format_type = "HWPX" if first_file.lower().endswith(".hwpx") else "HWP"
        hwp.Open(first_file, format_type, "HWPC")
        time.sleep(1)  # 파일을 열 시간을 부여 (원본 스크립트와 동일)

        for file_path in file_paths[1:]:
            hwp.HAction.Run("MoveDocEnd")
            hwp.HAction.GetDefault("InsertFile", hwp.HParameterSet.HInsertFile.HSet)
            hwp.HParameterSet.HInsertFile.filename = file_path
            hwp.HParameterSet.HInsertFile.KeepSection = 1  # 다음 쪽에 이어 붙이기
            hwp.HAction.Execute("InsertFile", hwp.HParameterSet.HInsertFile.HSet)

            hwp.HAction.Run("MoveDocEnd")
            hwp.HAction.Run("InsertPage")
            time.sleep(0.5)  # 파일을 붙일 시간을 부여

        out_format = "HWPX" if output_path.lower().endswith(".hwpx") else "HWP"
        hwp.SaveAs(output_path, out_format, "HWPC")

        if not os.path.exists(output_path):
            raise RuntimeError("한글이 결과 파일을 생성하지 않았습니다.")
    finally:
        if hwp is not None:
            try:
                hwp.Quit()
            except Exception:
                pass
            # Quit() 호출이 반환되어도 한글 프로세스가 실제로 종료되고 입력
            # 파일의 핸들을 놓기까지는 약간의 시간이 걸립니다 — 곧바로 임시
            # 폴더를 정리하면 "다른 프로세스가 파일을 사용 중" 에러가 날 수
            # 있어 여유를 둡니다.
            time.sleep(1)
        comtypes.CoUninitialize()


def _request_json(method: str, path: str, body=None):
    url = f"{APP_BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if MERGE_SECRET:
        headers["X-Merge-Secret"] = MERGE_SECRET
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def poll_next_job():
    return _request_json("GET", "/api/hwp-merge-jobs/next")


def report_complete(job_id: str, ok: bool, error=None):
    body = {"ok": ok}
    if error:
        body["error"] = error
    _request_json("POST", f"/api/hwp-merge-jobs/{job_id}/complete", body)


def process_job(job: dict) -> None:
    job_id = job["id"]
    urls = job["urls"]
    upload_url = job["uploadUrl"]
    print(f"[{job_id}] 작업 시작 ({len(urls)}개 파일)")

    # tempfile.TemporaryDirectory()의 with 블록 대신 mkdtemp()를 직접 쓰고
    # 정리를 별도 finally에서 처리합니다 — 병합/업로드가 이미 끝난 뒤
    # 임시 폴더 정리가 "파일이 사용 중" 등으로 실패하더라도(한글 프로세스
    # 종료가 살짝 늦어지는 경우 등) 이미 성공한 작업이 실패로 보고되지
    # 않게 하기 위함입니다.
    tmp_dir = tempfile.mkdtemp(prefix="upmoo-hwp-")
    try:
        local_paths = []
        for i, url in enumerate(urls):
            p = os.path.join(tmp_dir, f"input_{i}.hwp")
            _download(url, p)
            local_paths.append(p)

        output_path = os.path.join(tmp_dir, "merged.hwp")
        merge_with_real_hwp(local_paths, output_path)
        _upload(upload_url, output_path)

        report_complete(job_id, ok=True)
        print(f"[{job_id}] 완료")
    except Exception as exc:  # noqa: BLE001
        print(f"[{job_id}] 실패: {exc}")
        try:
            report_complete(job_id, ok=False, error=str(exc))
        except Exception as report_exc:  # noqa: BLE001
            print(f"[{job_id}] 실패 보고도 실패: {report_exc}")
    finally:
        try:
            shutil.rmtree(tmp_dir)
        except OSError as exc:
            # 작업 자체는 이미 끝났으니 실패로 보고하지 않고, 남은 임시
            # 파일은 다음 번 OS 임시 폴더 정리 때 치워지도록 둡니다.
            print(f"[{job_id}] 임시 폴더 정리 실패(무시): {exc}")


def main():
    if not APP_BASE_URL:
        raise SystemExit(
            "APP_BASE_URL 환경변수가 설정되지 않았습니다. "
            "예: set APP_BASE_URL=https://up-moo.vercel.app"
        )
    if not MERGE_SECRET:
        print(
            "경고: MERGE_SECRET 환경변수가 설정되지 않았습니다. "
            "Vercel 쪽 HWP_MERGE_WORKER_SECRET도 비워뒀을 때만 동작합니다 — 운영에서는 꼭 설정하세요."
        )

    print(f"HWP 병합 워커 시작 — {APP_BASE_URL}를 {POLL_INTERVAL_SECONDS}초 간격으로 폴링합니다. (Ctrl+C로 종료)")
    while True:
        try:
            result = poll_next_job()
        except urllib.error.URLError as exc:
            print(f"폴링 실패(네트워크): {exc}")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        except Exception as exc:  # noqa: BLE001
            print(f"폴링 실패: {exc}")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        job = result.get("job")
        if not job:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        process_job(job)


if __name__ == "__main__":
    main()
