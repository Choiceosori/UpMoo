import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 제출 파일 저장소로 S3 호환 Object Storage(권장: Cloudflare R2)를 사용합니다.
// R2는 VPC/ACG 같은 네트워크 설정 없이 Access Key/Secret Key 발급만으로 바로
// 접속 가능하고, 서명(presigned) URL도 S3와 동일하게 지원해 기존 코드를 그대로
// 재사용할 수 있습니다.
let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;

  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const endpoint = process.env.S3_ENDPOINT;

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_ENDPOINT 환경변수가 설정되지 않았습니다. " +
        "Cloudflare R2(또는 다른 S3 호환 스토리지)에서 발급받은 값을 등록해주세요."
    );
  }

  client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error(
      "S3_BUCKET 환경변수가 설정되지 않았습니다. 생성한 버킷 이름을 등록해주세요."
    );
  }
  return bucket;
}

export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function downloadObject(key: string): Promise<Buffer> {
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );
  const byteArray = await result.Body?.transformToByteArray();
  if (!byteArray) throw new Error(`오브젝트를 다운로드하지 못했습니다: ${key}`);
  return Buffer.from(byteArray);
}

export async function removeObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await getClient().send(
    new DeleteObjectsCommand({
      Bucket: getBucket(),
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    })
  );
}

/** 다운로드 시 원래(한글) 파일명이 표시되도록 Content-Disposition을 지정한 서명 URL을 발급합니다. */
export async function getSignedDownloadUrl(
  key: string,
  expiresInSeconds: number,
  downloadFilename?: string
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ...(downloadFilename && {
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
        downloadFilename
      )}`,
    }),
  });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

/**
 * PUT 전용 서명 URL을 발급합니다. 외부 런타임(예: api/hwp_merge.py의 Python
 * 함수)이 AWS SDK 없이 평범한 HTTP PUT만으로 결과물을 올릴 수 있게 해줍니다.
 * ContentType을 서명에 포함하지 않으므로, 업로드 쪽에서 Content-Type 헤더를
 * 정확히 맞출 필요 없이 바디만 PUT하면 됩니다.
 */
export async function getSignedUploadUrl(
  key: string,
  expiresInSeconds: number
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}
