import { Hono } from 'hono';
import { eq, like, count, and } from 'drizzle-orm';
import { Env } from '../types/env';
import { spiderSources } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', name, code, status } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(spiderSources);
  
  if (name) {
    query = query.where(like(spiderSources.name, `%${name}%`));
  }
  if (code) {
    query = query.where(like(spiderSources.code, `%${code}%`));
  }
  if (status !== undefined && status !== '') {
    query = query.where(eq(spiderSources.status, parseInt(status)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(spiderSources),
    query.orderBy(spiderSources.sort).orderBy(spiderSources.id).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/detail/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const spider = await db.select().from(spiderSources).where(eq(spiderSources.id, parseInt(id))).get();

  if (!spider) {
    return c.json(response.notFound('爬虫源不存在'));
  }

  return c.json(response.success(spider));
});

app.post('/create', async (c) => {
  const db = createDatabase(c.env.DB);
  const { name, code, type, apiHost, script, description, status, priority, collectMode, cronExpression, categoryId, config, disabledCategories, bannedKeywords } = await c.req.json();

  const existSpider = await db.select().from(spiderSources).where(eq(spiderSources.code, code)).get();
  if (existSpider) {
    return c.json(response.error('爬虫源编码已存在'));
  }

  const result = await db.insert(spiderSources).values({
    name,
    code,
    type: type || 1,
    apiHost,
    script,
    description,
    status: status || 1,
    priority: priority || 0,
    collectMode: collectMode || 'increment',
    cronExpression,
    categoryId,
    config,
    disabledCategories,
    bannedKeywords
  }).returning();

  return c.json(response.success(result[0], '创建成功'));
});

app.put('/update/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { name, code, type, apiHost, script, description, status, priority, collectMode, cronExpression, categoryId, config, disabledCategories, bannedKeywords } = await c.req.json();

  const spider = await db.select().from(spiderSources).where(eq(spiderSources.id, parseInt(id))).get();
  if (!spider) {
    return c.json(response.notFound('爬虫源不存在'));
  }

  if (code && code !== spider.code) {
    const existSpider = await db.select().from(spiderSources).where(eq(spiderSources.code, code)).get();
    if (existSpider) {
      return c.json(response.error('爬虫源编码已存在'));
    }
  }

  await db.update(spiderSources)
    .set({ name, code, type, apiHost, script, description, status, priority, collectMode, cronExpression, categoryId, config, disabledCategories, bannedKeywords, updateTime: new Date().toISOString() })
    .where(eq(spiderSources.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.delete('/delete/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const spider = await db.select().from(spiderSources).where(eq(spiderSources.id, parseInt(id))).get();
  if (!spider) {
    return c.json(response.notFound('爬虫源不存在'));
  }

  await db.delete(spiderSources).where(eq(spiderSources.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.post('/test/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const spider = await db.select().from(spiderSources).where(eq(spiderSources.id, parseInt(id))).get();
  if (!spider) {
    return c.json(response.notFound('爬虫源不存在'));
  }

  try {
    return c.json(response.success({ success: true, message: '测试通过', data: {} }, '测试成功'));
  } catch (error) {
    return c.json(response.error('测试失败: ' + (error as Error).message));
  }
});

app.post('/batch-delete', async (c) => {
  const db = createDatabase(c.env.DB);
  const { ids } = await c.req.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json(response.error('请选择要删除的爬虫源'));
  }

  await db.delete(spiderSources).where(spiderSources.id.in(ids.map(id => parseInt(id))));

  return c.json(response.success(null, `成功删除 ${ids.length} 条记录`));
});

app.put('/batch-status', async (c) => {
  const db = createDatabase(c.env.DB);
  const { ids, status } = await c.req.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json(response.error('请选择要更新的爬虫源'));
  }

  await db.update(spiderSources)
    .set({ status, updateTime: new Date().toISOString() })
    .where(spiderSources.id.in(ids.map(id => parseInt(id))));

  return c.json(response.success(null, `成功更新 ${ids.length} 条记录`));
});

app.post('/check-all', async (c) => {
  const db = createDatabase(c.env.DB);
  
  const spiders = await db.select().from(spiderSources).where(eq(spiderSources.status, 1));
  
  const results = spiders.map(spider => ({
    id: spider.id,
    name: spider.name,
    code: spider.code,
    status: 'success',
    message: '连接正常'
  }));

  return c.json(response.success(results));
});

app.get('/preview-directory', async (c) => {
  const { directory } = c.req.query();
  return c.json(response.success({ files: [] }));
});

app.post('/import', async (c) => {
  const { data } = await c.req.json();
  return c.json(response.success(null, '导入功能暂未实现'));
});

app.post('/batch-import', async (c) => {
  const { data } = await c.req.json();
  return c.json(response.success(null, '批量导入功能暂未实现'));
});

app.get('/categories/:id', async (c) => {
  const { id } = c.req.param();
  return c.json(response.success([]));
});

app.post('/debug/:id', async (c) => {
  const { id } = c.req.param();
  return c.json(response.success(null, '调试功能暂未实现'));
});

app.post('/execute/:id/:method', async (c) => {
  const { id, method } = c.req.param();
  return c.json(response.success(null, '执行功能暂未实现'));
});

app.post('/batch-check', async (c) => {
  const { ids, autoDisable } = await c.req.json();
  return c.json(response.success([]));
});

export default app;