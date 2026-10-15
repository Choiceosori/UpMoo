"""
Python 함수(api/hwp_merge.py)에서 Cloudflare R2(S3 호환) Object Storage에
접근하기 위한 작은 래퍼입니다. src/lib/objectStorage.ts(Node 버전)와 같은
S3_* 환경변수를 그대로 사용합니다.

왜 필요한가: Vercel Serverless Function은 요청/응답 바디가 약 4.5MB로
제한되어 있어, 제출 파일을 base64로 실어 보내면 파일이 여러 개이거나 하나라도
크면 FUNCTION_PAYLOAD_TOO_LARGE(413)로 실패합니다. 그래서 hwp_merge.py는
파일 내용 자체를 주고받지 않고, Node가 넘겨준 서명 URL로 원본을 직접 R2에서
내려받고, 병합 결과도 R2에 업로드한 뒤 서명 URL만 작은 JSON으로 돌려줍니다.
"""
import os
import uuid
from urllib.parse import quote

import boto3
from botocore.client import Config


class StorageError(Exception):
    pass


def _client():
    access_key = os.environ.get("S3_ACCESS_KEY_ID")
    secret_key = os.environ.get("S3_SECRET_ACCESS_KEY")
    endpoint = os.environ.get("S3_ENDPOINT")
    if not access_key or not secret_key or not endpoint:
        raise StorageError(
            "S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_ENDPOINT 환경변수가 "
            "설정되지 않았습니다."
        )
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=os.environ.get("S3_REGION") or "auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _bucket() -> str:
    bucket = os.environ.get("S3_BUCKET")
    if not bucket:
        raise StorageError("S3_BUCKET 환경변수가 설정되지 않았습니다.")
    return bucket


def upload_and_sign(
    body: bytes, content_type: str, download_filename: str, expires_in: int = 300
) -> str:
    """병합 결과를 tmp/ 임시 객체로 업로드하고, Node가 즉시 내려받을 수 있는
    서명된 다운로드 URL을 돌려줍니다. 만료 시간이 짧으므로, 버킷에
    tmp/ prefix를 1일 정도로 자동 삭제하는 수명 주기 규칙을 걸어두면
    별도 정리 작업 없이도 안전합니다."""
    client = _client()
    bucket = _bucket()
    key = f"tmp/hwp-merge/{uuid.uuid4().hex}.hwp"
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
    disposition = f"attachment; filename*=UTF-8''{quote(download_filename)}"
    return client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ResponseContentDisposition": disposition,
        },
        ExpiresIn=expires_in,
    )
