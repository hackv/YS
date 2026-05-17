import { Hono } from 'hono';
import { eq, like, count, and, desc, sum } from 'drizzle-orm';
import { Env } from '../types/env';
import { paymentOrders, pointsRecords, users } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/orders', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', orderNo, userId, status } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(paymentOrders);
  
  if (orderNo) {
    query = query.where(like(paymentOrders.orderNo, `%${orderNo}%`));
  }
  if (userId !== undefined) {
    query = query.where(eq(paymentOrders.userId, parseInt(userId)));
  }
  if (status !== undefined) {
    query = query.where(eq(paymentOrders.status, parseInt(status)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(paymentOrders),
    query.orderBy(desc(paymentOrders.createTime)).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/orders/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const order = await db.select().from(paymentOrders).where(eq(paymentOrders.id, parseInt(id))).get();

  if (!order) {
    return c.json(response.notFound('订单不存在'));
  }

  const user = await db.select({ username: users.username, nickname: users.nickname }).from(users).where(eq(users.id, order.userId)).get();

  return c.json(response.success({
    ...order,
    user
  }));
});

app.get('/points-records', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', userId, type } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(pointsRecords);
  
  if (userId !== undefined) {
    query = query.where(eq(pointsRecords.userId, parseInt(userId)));
  }
  if (type !== undefined) {
    query = query.where(eq(pointsRecords.type, parseInt(type)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(pointsRecords),
    query.orderBy(desc(pointsRecords.createTime)).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.post('/adjust-points', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId, points, description } = await c.req.json();

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  const newBalance = user.points + points;

  await db.transaction(async (tx) => {
    await tx.update(users)
      .set({ points: newBalance, updateTime: new Date().toISOString() })
      .where(eq(users.id, userId));

    await tx.insert(pointsRecords).values({
      userId,
      type: points > 0 ? 1 : 3,
      points,
      balance: newBalance,
      description: description || (points > 0 ? '管理员增加积分' : '管理员扣减积分')
    });
  });

  return c.json(response.success({ balance: newBalance }, '积分调整成功'));
});

app.get('/statistics', async (c) => {
  const db = createDatabase(c.env.DB);
  const { startDate, endDate } = c.req.query();

  let orderQuery = db.select({
    totalAmount: sum(paymentOrders.amount).as('totalAmount'),
    totalCount: count().as('totalCount')
  }).from(paymentOrders).where(eq(paymentOrders.status, 2));

  let pointsQuery = db.select({
    totalPoints: sum(pointsRecords.points).as('totalPoints'),
    totalRecords: count().as('totalRecords')
  }).from(pointsRecords).where(eq(pointsRecords.type, 1));

  if (startDate) {
    orderQuery = orderQuery.where(paymentOrders.createTime.gte(startDate));
    pointsQuery = pointsQuery.where(pointsRecords.createTime.gte(startDate));
  }
  if (endDate) {
    orderQuery = orderQuery.where(paymentOrders.createTime.lte(endDate));
    pointsQuery = pointsQuery.where(pointsRecords.createTime.lte(endDate));
  }

  const [orderStats, pointsStats] = await Promise.all([orderQuery, pointsQuery]);

  const userStats = await db.select({
    totalUsers: count().as('totalUsers'),
    activeUsers: count().as('activeUsers')
  }).from(users).where(eq(users.status, 1));

  return c.json(response.success({
    orders: orderStats[0],
    points: pointsStats[0],
    users: userStats[0]
  }));
});

export default app;