import { Hono } from 'hono';
import { Env } from '../types/env';
import { createDatabase } from '../db';
import { admins } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', async (c) => {
  const db = createDatabase(c.env.DB);
  
  try {
    await db.select().from(admins).limit(1);
    return c.json(response.success({ status: 'healthy', timestamp: new Date().toISOString() }, '服务运行正常'));
  } catch (error) {
    console.error('Health check failed:', error);
    return c.json(response.error('数据库连接失败', 503), 503);
  }
});

app.get('/ready', async (c) => {
  const db = createDatabase(c.env.DB);
  
  try {
    await db.select().from(admins).limit(1);
    return c.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    return c.json({ status: 'not_ready', error: 'database connection failed' }, 503);
  }
});

export default app;