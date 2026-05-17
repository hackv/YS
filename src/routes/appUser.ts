import { Hono } from 'hono';
import { Env } from '../types/env';
import { signToken, verifyToken } from '../utils/jwt';
import { hash, compare } from '../utils/bcrypt';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

/**
 * 用户登录
 * POST /api/app/user/login
 */
app.post('/login', async (c) => {
  const { username, password, deviceId } = await c.req.json();
  
  if (!username || !password) {
    return c.json(response.error('用户名和密码不能为空', 1001));
  }

  // 查找用户 (支持用户名或手机号登录)
  const userSQL = 'SELECT * FROM ys_user WHERE (username = ? OR phone = ?) AND status = 1';
  const userResult = await c.env.DB.prepare(userSQL).bind(username, username).all();
  const user = userResult.results?.[0] as any;
  
  if (!user) {
    return c.json(response.error('用户名或密码错误', 1001));
  }

  // 验证密码（支持加密密码和明文密码）
  let isPasswordValid = false;
  if (user.password) {
    try {
      isPasswordValid = await compare(password, String(user.password));
    } catch (e) {
      isPasswordValid = password === user.password;
    }
  }
  
  if (!isPasswordValid) {
    return c.json(response.error('用户名或密码错误', 1001));
  }

  // 生成 JWT Token
  const token = await signToken(
    { id: Number(user.id), username: String(user.username), role: 0 },
    c.env.JWT_SECRET || 'ys-app-jwt-secret',
    c.env.JWT_EXPIRES_IN || '30d'
  );

  // 更新最后登录时间
  const updateSQL = 'UPDATE ys_user SET last_login_time = ? WHERE id = ?';
  await c.env.DB.prepare(updateSQL).bind(new Date().toISOString(), user.id).run();

  // 返回用户信息（不包含密码）
  const userInfo = {
    id: Number(user.id),
    username: String(user.username),
    nickname: String(user.nickname || user.username),
    avatar: user.avatar || null,
    points: Number(user.points || 0),
    vipExpireTime: user.vip_expire_time || null
  };

  return c.json(response.success({
    token,
    user: userInfo
  }, '登录成功'));
});

/**
 * 用户注册
 * POST /api/app/user/register
 */
app.post('/register', async (c) => {
  const { username, password, nickname, phone, deviceId } = await c.req.json();
  
  if (!username || !password) {
    return c.json(response.error('用户名和密码不能为空', 1001));
  }

  // 检查用户是否已存在
  const existSQL = 'SELECT * FROM ys_user WHERE username = ? OR phone = ?';
  const existResult = await c.env.DB.prepare(existSQL).bind(username, phone || '').all();
  const existUser = existResult.results?.[0];

  if (existUser) {
    return c.json(response.error('用户名已存在', 1003));
  }

  // 加密密码
  const hashedPassword = await hash(password, 10);

  // 创建用户
  const insertSQL = `
    INSERT INTO ys_user (username, password, nickname, phone, device_id, status, points, create_time, update_time)
    VALUES (?, ?, ?, ?, ?, 1, 0, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `;
  const insertResult = await c.env.DB.prepare(insertSQL).bind(
    username,
    hashedPassword,
    nickname || username,
    phone || null,
    deviceId || null
  ).run();

  const newUserId = insertResult.meta?.last_row_id || 0;

  // 生成 JWT Token
  const token = await signToken(
    { id: newUserId, username, role: 0 },
    c.env.JWT_SECRET || 'ys-app-jwt-secret',
    c.env.JWT_EXPIRES_IN || '30d'
  );

  const userInfo = {
    id: newUserId,
    username,
    nickname: nickname || username,
    avatar: null,
    points: 0,
    vipExpireTime: null
  };

  return c.json(response.success({
    token,
    user: userInfo
  }, '注册成功'));
});

/**
 * 获取用户信息
 * GET /api/app/user/info
 */
app.get('/info', async (c) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || authHeader.indexOf('Bearer ') !== 0) {
    return c.json(response.unauthorized());
  }

  const token = authHeader.substring(7);
  
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET || 'ys-app-jwt-secret');
    
    if (!payload || !(payload as any).id) {
      return c.json(response.unauthorized());
    }

    const userId = (payload as any).id;
    const userSQL = 'SELECT * FROM ys_user WHERE id = ? AND status = 1';
    const userResult = await c.env.DB.prepare(userSQL).bind(userId).all();
    const user = userResult.results?.[0] as any;
    
    if (!user) {
      return c.json(response.notFound('用户不存在'));
    }

    // 返回用户信息（不包含密码）
    const userInfo = {
      id: Number(user.id),
      username: String(user.username),
      nickname: String(user.nickname || user.username),
      avatar: user.avatar || null,
      points: Number(user.points || 0),
      vipExpireTime: user.vip_expire_time || null
    };

    return c.json(response.success(userInfo));
  } catch (error) {
    return c.json(response.unauthorized());
  }
});

export default app;