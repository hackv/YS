import { Hono } from 'hono';
import { eq, like, count, and } from 'drizzle-orm';
import { Env } from '../types/env';
import { users, pointsRecords } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', username, nickname, phone, status } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(users);
  
  if (username) {
    query = query.where(like(users.username, `%${username}%`));
  }
  if (nickname) {
    query = query.where(like(users.nickname, `%${nickname}%`));
  }
  if (phone) {
    query = query.where(like(users.phone, `%${phone}%`));
  }
  if (status !== undefined) {
    query = query.where(eq(users.status, parseInt(status)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(users),
    query.orderBy(users.createTime).limit(pageSizeNum).offset(offset)
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

  const user = await db.select().from(users).where(eq(users.id, parseInt(id))).get();

  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  delete user.password;
  return c.json(response.success(user));
});

app.post('/create', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, nickname, email, phone, avatar, groupId, status } = await c.req.json();
  // 必要校验
  if (!username) {
    return c.json(response.error('用户名不能为空', 400));
  }
  try {
    const result = await db.insert(users).values({
      username,
      nickname: nickname || username,
      email,
      phone,
      avatar,
      groupId: groupId || 1,
      status: status || 1
    }).returning();
    const user = result[0];
    delete user.password;
    return c.json(response.success(user, '创建成功'));
  } catch (e) {
    console.error('Create user error:', e);
    return c.json(response.serverError('创建用户失败')); // 统一返回 500
  }
});

app.put('/update/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { nickname, email, phone, avatar, groupId, status, points } = await c.req.json();

  const user = await db.select().from(users).where(eq(users.id, parseInt(id))).get();
  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  await db.update(users)
    .set({ nickname, email, phone, avatar, groupId, status, points, updateTime: new Date().toISOString() })
    .where(eq(users.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.put('/status/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { status } = await c.req.json();

  const user = await db.select().from(users).where(eq(users.id, parseInt(id))).get();
  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  await db.update(users)
    .set({ status, updateTime: new Date().toISOString() })
    .where(eq(users.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.delete('/delete/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const user = await db.select().from(users).where(eq(users.id, parseInt(id))).get();
  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  await db.delete(users).where(eq(users.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.put('/reset-password/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { newPassword } = await c.req.json();

  const user = await db.select().from(users).where(eq(users.id, parseInt(id))).get();
  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  const bcrypt = await import('../utils/bcrypt');
  const hashedPassword = await bcrypt.hash(newPassword);

  await db.update(users)
    .set({ password: hashedPassword, updateTime: new Date().toISOString() })
    .where(eq(users.id, parseInt(id)));

  return c.json(response.success(null, '密码重置成功'));
});

app.get('/:id/points', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { page = '1', pageSize = '20' } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(pointsRecords).where(eq(pointsRecords.userId, parseInt(id))),
    db.select().from(pointsRecords)
      .where(eq(pointsRecords.userId, parseInt(id)))
      .orderBy(pointsRecords.createTime)
      .limit(pageSizeNum)
      .offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.post('/:id/points', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { points, description, type = 1 } = await c.req.json();

  const user = await db.select().from(users).where(eq(users.id, parseInt(id))).get();
  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  const newBalance = user.points + points;

  await db.transaction(async (tx) => {
    await tx.update(users)
      .set({ points: newBalance, updateTime: new Date().toISOString() })
      .where(eq(users.id, parseInt(id)));

    await tx.insert(pointsRecords).values({
      userId: parseInt(id),
      type,
      points,
      balance: newBalance,
      description
    });
  });

  return c.json(response.success({ balance: newBalance }, '操作成功'));
});

export default app;