import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function getEnvConfig(): S3Config {
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 env vars are not fully configured");
  }
  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function getClient(config: S3Config) {
  return {
    client: new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: false,
    }),
    bucket: config.bucket,
  };
}

export async function presignUpload(input: { key: string; contentType: string; expiresIn: number }) {
  const { client, bucket } = getClient(getEnvConfig());
  const command = new PutObjectCommand({ Bucket: bucket, Key: input.key, ContentType: input.contentType });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: input.expiresIn });
  return { uploadUrl, bucket };
}

export async function presignUploadWithConfig(input: {
  key: string;
  contentType: string;
  expiresIn: number;
  config: S3Config;
}) {
  const { client, bucket } = getClient(input.config);
  const command = new PutObjectCommand({ Bucket: bucket, Key: input.key, ContentType: input.contentType });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: input.expiresIn });
  return { uploadUrl, bucket };
}

export async function presignDownload(input: {
  key: string;
  filename: string;
  disposition: "inline" | "attachment";
  expiresIn: number;
}) {
  const { client, bucket } = getClient(getEnvConfig());
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ResponseContentDisposition: `${input.disposition}; filename="${input.filename}"`,
  });
  const url = await getSignedUrl(client, command, { expiresIn: input.expiresIn });
  return { url };
}
