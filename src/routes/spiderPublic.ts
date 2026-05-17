import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { Env } from '../types/env';
import { spiderSources } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

/**
 * 公共调试接口（无需鉴权）
 * 用于快速获取爬虫源的原始数据，帮助前端排查 "爬虫源不存在" 错误
 */
const app = new Hono<{ Bindings: Env }>();

app.get('/debug/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const spider = await db.select().from(spiderSources).where(eq(spiderSources.id, parseInt(id))).get();
  if (!spider) return c.json(response.notFound('爬虫源不存在'));
  return c.json(response.success(spider));
});

export default app;
