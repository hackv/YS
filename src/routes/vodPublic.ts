import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { Env } from '../types/env';
import { vods, vodSources } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

/**
 * 公共调试接口（无需鉴权）
 * 用于快速排查视频数据，返回视频主记录及其播放源。
 * 访问路径：`/api/vod/debug-public/:id`
 */
const app = new Hono<{ Bindings: Env }>();

app.get('/debug-public/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const vid = parseInt(id);
  const vod = await db.select().from(vods).where(eq(vods.id, vid)).get();
  if (!vod) return c.json(response.notFound('视频不存在'));
  const sources = await db.select().from(vodSources).where(eq(vodSources.vodId, vid)).all();
  return c.json(response.success({ vod, sources }));
});

export default app;
