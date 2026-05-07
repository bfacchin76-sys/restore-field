import "server-only";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  PresignedGet,
  PresignedGetInput,
  PresignedPut,
  PresignedPutInput,
  Storage,
} from "./types";
import { env } from "@/lib/env";

const DEFAULT_PUT_TTL = 60 * 15;
const DEFAULT_GET_TTL = 60 * 15;

export class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
    this.bucket = env.S3_BUCKET;
  }

  async presignedPut(input: PresignedPutInput): Promise<PresignedPut> {
    const ttl = input.ttlSeconds ?? DEFAULT_PUT_TTL;
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.maxSizeBytes,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttl });
    return {
      url,
      headers: { "Content-Type": input.contentType },
      key: input.key,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  async presignedGet(input: PresignedGetInput): Promise<PresignedGet> {
    const ttl = input.ttlSeconds ?? DEFAULT_GET_TTL;
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttl });
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async getObjectBytes(key: string): Promise<Buffer> {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!r.Body) throw new Error(`Empty body for key ${key}`);
    const chunks: Buffer[] = [];
    for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async putObjectBytes(
    key: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async copyObject(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `/${this.bucket}/${encodeURIComponent(fromKey)}`,
        Key: toKey,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
