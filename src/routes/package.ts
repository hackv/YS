import { Hono } from 'hono';
import { eq, count } from 'drizzle-orm';
import { Env } from '../types/env';
import { rechargePackages } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', status } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(rechargePackages);
  
  if (status !== undefined) {
    query = query.where(eq(rechargePackages.status, parseInt(status)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(rechargePackages),
    query.orderBy(rechargePackages.sort).orderBy(rechargePackages.id).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', status } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(rechargePackages);
  
  if (status !== undefined) {
    query = query.where(eq(rechargePackages.status, parseInt(status)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(rechargePackages),
    query.orderBy(rechargePackages.sort).orderBy(rechargePackages.id).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/active', async (c) => {
  const db = createDatabase(c.env.DB);

  const list = await db.select().from(rechargePackages)
    .where(eq(rechargePackages.status, 1))
    .orderBy(rechargePackages.sort)
    .orderBy(rechargePackages.id);

  return c.json(response.success(list));
});

app.get('/app/list', async (c) => {
  const db = createDatabase(c.env.DB);

  const list = await db.select().from(rechargePackages)
    .where(eq(rechargePackages.status, 1))
    .orderBy(rechargePackages.sort)
    .orderBy(rechargePackages.id);

  return c.json(response.success(list));
});

app.get('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const pkg = await db.select().from(rechargePackages).where(eq(rechargePackages.id, parseInt(id))).get();

  if (!pkg) {
    return c.json(response.notFound('套餐不存在'));
  }

  return c.json(response.success(pkg));
});

app.post('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { name, price, points, giftPoints, duration, status, sort, description } = await c.req.json();

  const result = await db.insert(rechargePackages).values({
    name,
    price,
    points,
    giftPoints: giftPoints || 0,
    duration: duration || 0,
    status: status || 1,
    sort: sort || 0,
    description
  }).returning();

  return c.json(response.success(result[0], '创建成功'));
});

app.put('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { name, price, points, giftPoints, duration, status, sort, description } = await c.req.json();

  const pkg = await db.select().from(rechargePackages).where(eq(rechargePackages.id, parseInt(id))).get();
  if (!pkg) {
    return c.json(response.notFound('套餐不存在'));
  }

  await db.update(rechargePackages)
    .set({ name, price, points, giftPoints, duration, status, sort, description, updateTime: new Date().toISOString() })
    .where(eq(rechargePackages.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.put('/:id/status', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { status } = await c.req.json();

  const pkg = await db.select().from(rechargePackages).where(eq(rechargePackages.id, parseInt(id))).get();
  if (!pkg) {
    return c.json(response.notFound('套餐不存在'));
  }

  await db.update(rechargePackages)
    .set({ status, updateTime: new Date().toISOString() })
    .where(eq(rechargePackages.id, parseInt(id)));

  return c.json(response.success(null, '状态更新成功'));
});

app.delete('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const pkg = await db.select().from(rechargePackages).where(eq(rechargePackages.id, parseInt(id))).get();
  if (!pkg) {
    return c.json(response.notFound('套餐不存在'));
  }

  await db.delete(rechargePackages).where(eq(rechargePackages.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

export default app;