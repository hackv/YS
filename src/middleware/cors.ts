import { Context, Next } from 'hono';
import { Env } from '../types/env';
import * as response from '../utils/response';

export const corsMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  await next();

  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
};

export const errorHandler = async (c: Context<{ Bindings: Env }>, next: Next) => {
  try {
    await next();
  } catch (error) {
    console.error('Error:', error);
    
    if (error instanceof Error) {
      return c.json(response.error(error.message || '服务器内部错误', 500), 500);
    }
    
    return c.json(response.serverError(), 500);
  }
};