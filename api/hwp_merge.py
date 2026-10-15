"""
Vercel Python Serverless Function.
여러 HWP(한글) 파일을 하나로 병합합니다. Next.js API Route
(src/app/api/merge/route.ts)가 category="hwp"일 때 내부적으로 이 엔드포인트를
호출합니다.

요청: POST { "urls": ["<입력 파일의 서명된 GET URL>", ...], "uploadUrl": "<병합
      결과를 올릴 서명된 PUT URL>" }  (urls는 제출 순서대로)
응답: 200 { "ok": true }
      4xx/5xx { "error": "메시지" }

파일 내용을 요청/응답 바디에 직접 base64로 싣지 않는 이유: Vercel Serverless
Function의 요청/응답 바디는 약 4.5MB로 제한되어 있어(FUNCTION_PAYLOAD_TOO_LARGE
/ HTTP 413), 제출 파일이 여러 개이거나 하나라도 크면 쉽게 그 한도를 넘습니다.
대신 Node(src/lib/mergeHwp.ts, src/app/api/merge/route.ts)가 각 원본 파일의
R2 서명 GET URL과, 결과를 올릴 서명 PUT URL을 미리 발급해 넘겨주면, 이 함수는
표준 라이브러리(urllib)만으로 직접 내려받고 올립니다 — boto3 등 AWS SDK를
설치할 필요가 없어 Python 함수 배포 크기/안정성 문제도 피할 수 있습니다.

구현 방식과 한계는 api/_hwplib/merge.py 상단 주석을 참고하세요.
이 기능은 실제 한글(HWP) 프로그램으로 검증하지 못한 best-effort 구현입니다.
"""
import json
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler

from _hwplib.merge import HwpMergeError, merge_hwp_files


def _download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=25) as resp:
        return resp.read()


def _upload(url: str, data: bytes) -> None:
    request = urllib.request.Request(url, data=data, method="PUT")
    with urllib.request.urlopen(request, timeout=25) as resp:
        if resp.status not in (200, 201, 204):
            raise RuntimeError(f"업로드 응답이 비정상입니다 (HTTP {resp.status}).")


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, obj: dict):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw_body)
        except Exception:
            self._send_json(400, {"error": "요청 본문을 파싱하지 못했습니다."})
            return

        urls = payload.get("urls")
        upload_url = payload.get("uploadUrl")
        if not isinstance(urls, list) or not urls:
            self._send_json(400, {"error": "urls 배열이 필요합니다."})
            return
        if not isinstance(upload_url, str) or not upload_url:
            self._send_json(400, {"error": "uploadUrl이 필요합니다."})
            return

        try:
            buffers = [_download(u) for u in urls]
        except Exception as exc:  # noqa: BLE001
            self._send_json(502, {"error": f"원본 파일을 내려받지 못했습니다: {exc}"})
            return

        try:
            merged = merge_hwp_files(buffers)
        except HwpMergeError as exc:
            self._send_json(400, {"error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send_json(500, {"error": f"HWP 병합 중 알 수 없는 오류: {exc}"})
            return

        try:
            _upload(upload_url, merged)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            self._send_json(502, {"error": f"병합 결과 업로드에 실패했습니다: {exc}"})
            return

        self._send_json(200, {"ok": True})
