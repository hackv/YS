import { Hono } from 'hono';
import { eq, like, count, and, desc } from 'drizzle-orm';
import { Env } from '../types/env';
import { rechargePackages, paymentOrders, pointsRecords, users } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/packages', async (c) => {
  const db = createDatabase(c.env.DB);
  
  const packages = await db.select()
    .from(rechargePackages)
    .where(eq(rechargePackages.status, 1))
    .orderBy(rechargePackages.sort);

  return c.json(response.success(packages));
});

app.post('/order', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId, packageId, amount } = await c.req.json();

  const pkg = await db.select().from(rechargePackages).where(eq(rechargePackages.id, packageId)).get();
  if (!pkg) {
    return c.json(response.notFound('套餐不存在'));
  }

  const orderNo = 'ORD' + Date.now().toString() + Math.random().toString(36).substr(2, 6).toUpperCase();

  const result = await db.insert(paymentOrders).values({
    orderNo,
    userId,
    packageId,
    amount: amount || pkg.price,
    status: 0,
    createTime: new Date().toISOString()
  }).returning();

  return c.json(response.success(result[0], '订单创建成功'));
});

app.post('/payment', async (c) => {
  const db = createDatabase(c.env.DB);
  const { orderId, payType = 'wechat' } = await c.req.json();

  const order = await db.select().from(paymentOrders).where(eq(paymentOrders.id, orderId)).get();
  if (!order) {
    return c.json(response.notFound('订单不存在'));
  }

  if (order.status !== 0) {
    return c.json(response.error('订单状态异常'));
  }

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  
  await db.update(paymentOrders)
    .set({ 
      status: 1, 
      payType,
      expireTime,
      updateTime: new Date().toISOString()
    })
    .where(eq(paymentOrders.id, orderId));

  return c.json(response.success({
    orderNo: order.orderNo,
    amount: order.amount,
    payType,
    expireTime
  }, '支付请求已处理'));
});

app.get('/status/:orderId', async (c) => {
  const db = createDatabase(c.env.DB);
  const { orderId } = c.req.param();

  const order = await db.select().from(paymentOrders).where(eq(paymentOrders.id, parseInt(orderId))).get();
  if (!order) {
    return c.json(response.notFound('订单不存在'));
  }

  const statusMap: Record<number, string> = {
    0: '待支付',
    1: '处理中',
    2: '已完成',
    3: '已取消',
    4: '已退款'
  };

  return c.json(response.success({
    ...order,
    statusText: statusMap[order.status] || '未知'
  }));
});

app.post('/callback', async (c) => {
  const db = createDatabase(c.env.DB);
  const { orderNo, transactionId, status } = await c.req.json();

  const order = await db.select().from(paymentOrders).where(eq(paymentOrders.orderNo, orderNo)).get();
  if (!order) {
    return c.json(response.error('订单不存在'));
  }

  if (status === 'success') {
    const pkg = await db.select().from(rechargePackages).where(eq(rechargePackages.id, order.packageId)).get();
    
    await db.transaction(async (tx) => {
      await tx.update(paymentOrders)
        .set({ 
          status: 2, 
          transactionId,
          payTime: new Date().toISOString(),
          updateTime: new Date().toISOString()
        })
        .where(eq(paymentOrders.orderNo, orderNo));

      if (pkg) {
        const totalPoints = pkg.points + (pkg.giftPoints || 0);
        
        const user = await tx.select().from(users).where(eq(users.id, order.userId)).get();
        const newBalance = (user?.points || 0) + totalPoints;

        await tx.update(users)
          .set({ points: newBalance, updateTime: new Date().toISOString() })
          .where(eq(users.id, order.userId));

        await tx.insert(pointsRecords).values({
          userId: order.userId,
          type: 1,
          points: totalPoints,
          balance: newBalance,
          description: `充值获得 ${totalPoints} 积分`,
          orderNo
        });
      }
    });

    return c.json(response.success(null, '支付成功'));
  } else {
    await db.update(paymentOrders)
      .set({ status: 3, updateTime: new Date().toISOString() })
      .where(eq(paymentOrders.orderNo, orderNo));

    return c.json(response.success(null, '支付失败'));
  }
});

app.post('/exchange-vip', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId, duration } = await c.req.json();

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  const pointsNeeded = duration * 100;
  if (user.points < pointsNeeded) {
    return c.json(response.error('积分不足'));
  }

  const newBalance = user.points - pointsNeeded;
  const expireTime = user.vipExpireTime 
    ? new Date(new Date(user.vipExpireTime).getTime() + duration * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();

  await db.transaction(async (tx) => {
    await tx.update(users)
      .set({ points: newBalance, vipExpireTime: expireTime, updateTime: new Date().toISOString() })
      .where(eq(users.id, userId));

    await tx.insert(pointsRecords).values({
      userId,
      type: 2,
      points: -pointsNeeded,
      balance: newBalance,
      description: `兑换VIP时长 ${duration} 天`
    });
  });

  return c.json(response.success({ vipExpireTime: expireTime }, '兑换成功'));
});

app.get('/points-info', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId } = c.req.query();

  const user = await db.select().from(users).where(eq(users.id, parseInt(userId || '0'))).get();
  if (!user) {
    return c.json(response.notFound('用户不存在'));
  }

  return c.json(response.success({
    points: user.points,
    vipExpireTime: user.vipExpireTime,
    isVip: user.vipExpireTime && new Date(user.vipExpireTime) > new Date()
  }));
});

app.get('/points-records', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId, page = '1', pageSize = '20' } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(pointsRecords).where(eq(pointsRecords.userId, parseInt(userId || '0'))),
    db.select().from(pointsRecords)
      .where(eq(pointsRecords.userId, parseInt(userId || '0')))
      .orderBy(desc(pointsRecords.createTime))
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

app.get('/records', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId, page = '1', pageSize = '20' } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(paymentOrders).where(eq(paymentOrders.userId, parseInt(userId || '0'))),
    db.select().from(paymentOrders)
      .where(eq(paymentOrders.userId, parseInt(userId || '0')))
      .orderBy(desc(paymentOrders.createTime))
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

export default app;