import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { Env } from '../types/env';
import { admins } from '../db';
import { createDatabase } from '../db';
import { signToken } from '../utils/jwt';
import { compare, hash } from '../utils/bcrypt';
import { generateCaptcha, verifyCaptcha } from '../utils/captcha';
import { adminAuth } from '../middleware/auth';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/captcha', async (c) => {
  try {
    const { captchaId, svg } = await generateCaptcha(c.env);
    return c.json(response.success({ captchaId, svg }));
  } catch (error) {
    return c.json(response.serverError('生成验证码失败'));
  }
});

app.post('/login', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, password } = await c.req.json();

  const admin = await db.select().from(admins).where(eq(admins.username, username)).get();

  if (!admin) {
    return c.json(response.error('用户名或密码错误', 1001));
  }

  if (admin.status !== 1) {
    return c.json(response.error('账号已被禁用', 1002));
  }

  const isMatch = await compare(password, admin.password);
  if (!isMatch) {
    return c.json(response.error('用户名或密码错误', 1001));
  }

  const token = await signToken(
    { id: admin.id, username: admin.username, role: admin.role },
    c.env.JWT_SECRET || 'ys-admin-jwt-secret',
    c.env.JWT_EXPIRES_IN || '7d'
  );

  await db.update(admins)
    .set({
      lastLoginTime: new Date().toISOString(),
      loginCount: admin.loginCount + 1
    })
    .where(eq(admins.id, admin.id));

  return c.json(response.success({
    token,
    user: {
      id: admin.id,
      username: admin.username,
      nickname: admin.nickname,
      email: admin.email,
      avatar: admin.avatar,
      role: admin.role
    }
  }, '登录成功'));
});

app.post('/register', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, password, nickname, email, phone } = await c.req.json();

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
    role: 1,
    status: 1
  }).returning();

  const admin = result[0];

  return c.json(response.success({
    id: admin.id,
    username: admin.username
  }, '注册成功'));
});

app.post('/logout', (c) => {
  return c.json(response.success(null, '登出成功'));
});

app.get('/profile', adminAuth, async (c) => {
  const admin = c.get('admin');
  if (!admin) {
    return c.json(response.unauthorized());
  }

  const db = createDatabase(c.env.DB);
  const adminData = await db.select({
    id: admins.id,
    username: admins.username,
    nickname: admins.nickname,
    email: admins.email,
    phone: admins.phone,
    avatar: admins.avatar,
    role: admins.role,
    status: admins.status,
    lastLoginTime: admins.lastLoginTime,
    loginCount: admins.loginCount,
    createTime: admins.createTime
  }).from(admins).where(eq(admins.id, admin.id)).get();

  if (!adminData) {
    return c.json(response.notFound('用户不存在'));
  }

  return c.json(response.success(adminData));
});

app.put('/profile', adminAuth, async (c) => {
  const admin = c.get('admin');
  if (!admin) {
    return c.json(response.unauthorized());
  }

  const { nickname, email, phone, avatar } = await c.req.json();
  const db = createDatabase(c.env.DB);

  await db.update(admins)
    .set({ nickname, email, phone, avatar, updateTime: new Date().toISOString() })
    .where(eq(admins.id, admin.id));

  return c.json(response.success(null, '更新成功'));
});

app.put('/change-password', adminAuth, async (c) => {
  const admin = c.get('admin');
  if (!admin) {
    return c.json(response.unauthorized());
  }

  const { oldPassword, newPassword } = await c.req.json();
  const db = createDatabase(c.env.DB);

  const adminData = await db.select().from(admins).where(eq(admins.id, admin.id)).get();
  if (!adminData) {
    return c.json(response.notFound('用户不存在'));
  }

  const isMatch = await compare(oldPassword, adminData.password);
  if (!isMatch) {
    return c.json(response.error('原密码错误', 1004));
  }

  const hashedPassword = await hash(newPassword, 10);
  await db.update(admins)
    .set({ password: hashedPassword, updateTime: new Date().toISOString() })
    .where(eq(admins.id, admin.id));

  return c.json(response.success(null, '密码修改成功'));
});

export default app;