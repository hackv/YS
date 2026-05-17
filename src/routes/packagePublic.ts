import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { Env } from '../types/env';
import { rechargePackages } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

/**
 * 公共调试接口（无需鉴权）
 * 用于快速获取充值套餐的原始数据，帮助前端定位 "套餐不存在" 错误
 */
const app = new Hono<{ Bindings: Env }>();

app.get('/debug/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const pkg = await db.select().from(rechargePackages).where(eq(rechargePackages.id, parseInt(id))).get();
  if (!pkg) return c.json(response.notFound('套餐不存在'));
  return c.json(response.success(pkg));
});

export default app;
