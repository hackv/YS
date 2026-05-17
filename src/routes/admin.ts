import { Hono } from 'hono';
import { eq, like, count } from 'drizzle-orm';
import { Env } from '../types/env';
import { admins } from '../db';
import { createDatabase } from '../db';
import { hash } from '../utils/bcrypt';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', username, nickname } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(admins);
  
  if (username) {
    query = query.where(like(admins.username, `%${username}%`));
  }
  if (nickname) {
    query = query.where(like(admins.nickname, `%${nickname}%`));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(admins),
    query.orderBy(admins.createTime).limit(pageSizeNum).offset(offset)
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
  const { page = '1', pageSize = '20', username, nickname } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(admins);
  
  if (username) {
    query = query.where(like(admins.username, `%${username}%`));
  }
  if (nickname) {
    query = query.where(like(admins.nickname, `%${nickname}%`));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(admins),
    query.orderBy(admins.createTime).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const admin = await db.select().from(admins).where(eq(admins.id, parseInt(id))).get();

  if (!admin) {
    return c.json(response.notFound('管理员不存在'));
  }

  delete admin.password;
  return c.json(response.success(admin));
});

app.get('/detail/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const admin = await db.select().from(admins).where(eq(admins.id, parseInt(id))).get();

  if (!admin) {
    return c.json(response.notFound('管理员不存在'));
  }

  delete admin.password;
  return c.json(response.success(admin));
});

app.post('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, password, nickname, email, phone, role, status } = await c.req.json();

  const existAdmin = await db.select().from(admins).where(eq(admins.username, username)).get();
  if (existAdmin) {
    return c.json(response.error('用户名已存在', 1003));
  }

  const hashedPassword = await hash(password, 10);

  const result = await db.insert(admins).values({
    username,
    password: hashedPassword,
    nickname: nickname || username,
    email,
    phone,
    role: role || 1,
    status: status || 1
  }).returning();

  const admin = result[0];
  delete admin.password;

  return c.json(response.success(admin, '创建成功'));
});

app.post('/create', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, password, nickname, email, phone, role, status } = await c.req.json();

  const existAdmin = await db.select().from(admins).where(eq(admins.username, username)).get();
  if (existAdmin) {
    return c.json(response.error('用户名已存在', 1003));
  }

  const hashedPassword = await hash(password, 10);

  const result = await db.insert(admins).values({
    username,
    password: hashedPassword,
    nickname: nickname || username,
    email,
    phone,
    role: role || 1,
    status: status || 1
  }).returning();

  const admin = result[0];
  delete admin.password;

  return c.json(response.success(admin, '创建成功'));
});

app.put('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { username, nickname, email, phone, role, status } = await c.req.json();

  const admin = await db.select().from(admins).where(eq(admins.id, parseInt(id))).get();
  if (!admin) {
    return c.json(response.notFound('管理员不存在'));
  }

  if (username && username !== admin.username) {
    const existAdmin = await db.select().from(admins).where(eq(admins.username, username)).get();
    if (existAdmin) {
      return c.json(response.error('用户名已存在', 1003));
    }
  }

  await db.update(admins)
    .set({ username, nickname, email, phone, role, status, updateTime: new Date().toISOString() })
    .where(eq(admins.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.put('/update/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { username, nickname, email, phone, role, status } = await c.req.json();

  const admin = await db.select().from(admins).where(eq(admins.id, parseInt(id))).get();
  if (!admin) {
    return c.json(response.notFound('管理员不存在'));
  }

  if (username && username !== admin.username) {
    const existAdmin = await db.select().from(admins).where(eq(admins.username, username)).get();
    if (existAdmin) {
      return c.json(response.error('用户名已存在', 1003));
    }
  }

  await db.update(admins)
    .set({ username, nickname, email, phone, role, status, updateTime: new Date().toISOString() })
    .where(eq(admins.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.delete('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const admin = await db.select().from(admins).where(eq(admins.id, parseInt(id))).get();
  if (!admin) {
    return c.json(response.notFound('管理员不存在'));
  }

  if (admin.role === 2) {
    return c.json(response.error('不能删除超级管理员'));
  }

  await db.delete(admins).where(eq(admins.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.delete('/delete/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const admin = await db.select().from(admins).where(eq(admins.id, parseInt(id))).get();
  if (!admin) {
    return c.json(response.notFound('管理员不存在'));
  }

  if (admin.role === 2) {
    return c.json(response.error('不能删除超级管理员'));
  }

  await db.delete(admins).where(eq(admins.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.put('/password/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { password } = await c.req.json();

  const admin = await db.select().from(admins).where(eq(admins.id, parseInt(id))).get();
  if (!admin) {
    return c.json(response.notFound('管理员不存在'));
  }

  const hashedPassword = await hash(password, 10);

  await db.update(admins)
    .set({ password: hashedPassword, updateTime: new Date().toISOString() })
    .where(eq(admins.id, parseInt(id)));

  return c.json(response.success(null, '密码重置成功'));
});

export default app;