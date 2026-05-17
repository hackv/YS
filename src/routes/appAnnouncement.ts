import { Hono } from 'hono';
import { Env } from '../types/env';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

/**
 * 将数据库返回的蛇形命名转换为前端使用的驼峰命名
 */
function convertToCamelCase(row: any): any {
  if (!row) return row;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    type: row.type,
    targetType: row.target_type,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    startTime: row.start_time,
    endTime: row.end_time,
    sort: row.sort,
    status: row.status,
    isPopup: row.is_popup,
    viewCount: row.view_count,
    adminId: row.admin_id,
    createTime: row.create_time,
    updateTime: row.update_time
  };
}

/**
 * 获取公告列表（APP 公开接口）
 * GET /api/app/announcement/list?page=1&pageSize=20
 */
app.get('/list', async (c) => {
  const page = c.req.query('page') || '1';
  const pageSize = c.req.query('pageSize') || '20';
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM ys_announcement WHERE status = 1'
  ).first();
  const total = countResult ? parseInt(String(countResult.total)) : 0;

  if (total > 0) {
    const listResult = await c.env.DB.prepare(
      'SELECT * FROM ys_announcement WHERE status = 1 ORDER BY create_time DESC LIMIT ? OFFSET ?'
    ).bind(pageSizeNum, offset).all();
    
    const list = (listResult.results || []).map(row => convertToCamelCase(row));
    
    return c.json(response.success({
      list,
      total,
      page: pageNum,
      pageSize: pageSizeNum
    }));
  }

  return c.json(response.success({
    list: [],
    total: 0,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

/**
 * 获取弹窗公告（APP 公开接口）
 * GET /api/app/announcement/popup
 */
app.get('/popup', async (c) => {
  const popupResult = await c.env.DB.prepare(
    'SELECT * FROM ys_announcement WHERE status = 1 AND is_popup = 1 ORDER BY create_time DESC LIMIT 1'
  ).first();

  if (popupResult) {
    return c.json(response.success(convertToCamelCase(popupResult)));
  }

  return c.json(response.success(null));
});

/**
 * 获取公告详情（APP 公开接口）
 * GET /api/app/announcement/:id
 */
app.get('/:id', async (c) => {
  const { id } = c.req.param();

  const result = await c.env.DB.prepare(
    'SELECT * FROM ys_announcement WHERE id = ?'
  ).bind(parseInt(id)).first();
  
  if (!result) {
    return c.json(response.notFound('公告不存在'));
  }

  return c.json(response.success(convertToCamelCase(result)));
});

export default app;