import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

function getClient() {
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 env vars are not fully configured");
  }
  return {
    client: new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: false,
    }),
    bucket,
  };
}

export async function presignUpload(input: { key: string; contentType: string; expiresIn: number }) {
  const { client, bucket } = getClient();
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
  const { client, bucket } = getClient();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ResponseContentDisposition: `${input.disposition}; filename="${input.filename}"`,
  });
  const url = await getSignedUrl(client, command, { expiresIn: input.expiresIn });
  return { url };
}
