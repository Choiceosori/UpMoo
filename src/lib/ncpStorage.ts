import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 네이버 클라우드 플랫폼 Object Storage는 S3 호환 API를 제공하므로
// AWS SDK v3의 S3Client를 NCP 엔드포인트로 그대로 사용할 수 있습니다.
let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;

  const accessKeyId = process.env.NCP_ACCESS_KEY;
  const secretAccessKey = process.env.NCP_SECRET_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "NCP_ACCESS_KEY / NCP_SECRET_KEY 환경변수가 설정되지 않았습니다. " +
        "네이버 클라우드 콘솔 > Object Storage > 인증키 관리에서 발급받은 값을 등록해주세요."
    );
  }

  client = new S3Client({
    region: process.env.NCP_OBJECT_STORAGE_REGION || "kr-standard",
    endpoint: process.env.NCP_OBJECT_STORAGE_ENDPOINT || "https://kr.object.ncloudstorage.com",
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return client;
}

function getBucket(): string {
  const bucket = process.env.NCP_STORAGE_BUCKET;
  if (!bucket) {
    throw new Error(
      "NCP_STORAGE_BUCKET 환경변수가 설정되지 않았습니다. Object Storage에서 생성한 버킷 이름을 등록해주세요."
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
