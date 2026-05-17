export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  BACKUP_BUCKET: R2Bucket;
  JWT_SECRET: string;
  JWT_EXPIRES_IN?: string;
  ENVIRONMENT?: string;
}