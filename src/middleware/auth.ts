import { Context, Next } from 'hono';
import { Env } from '../types/env';
import { verifyToken } from '../utils/jwt';
import * as response from '../utils/response';

export const adminAuth = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(response.unauthorized('未登录'), 401);
  }

  try {
    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET || 'ys-admin-jwt-secret');
    
    if (!payload || !payload.id) {
      return c.json(response.unauthorized('无效的token'), 401);
    }
    
    c.set('admin', payload);
    await next();
  } catch {
    return c.json(response.unauthorized('token已过期'), 401);
  }
};

export const superAdminAuth = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(response.unauthorized('未登录'), 401);
  }

  try {
    const token = authHeader.substring(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET || 'ys-admin-jwt-secret');
    
    if (!payload || !payload.id) {
      return c.json(response.unauthorized('无效的token'), 401);
    }
    
    if (payload.role !== 2) {
      return c.json(response.forbidden('需要超级管理员权限'), 403);
    }
    
    c.set('admin', payload);
    await next();
  } catch {
    return c.json(response.unauthorized('token已过期'), 401);
  }
};