import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { Env } from '../types/env';
import { announcements } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

/**
 * 公共调试接口（无需鉴权）
 * 用于快速获取公告的原始数据，帮助前端定位 "公告不存在" 错误
 */
const app = new Hono<{ Bindings: Env }>();

app.get('/debug/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const ann = await db.select().from(announcements).where(eq(announcements.id, parseInt(id))).get();
  if (!ann) return c.json(response.notFound('公告不存在'));
  return c.json(response.success(ann));
});

export default app;
