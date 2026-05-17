import { Hono } from 'hono';
import { eq, like, count, and } from 'drizzle-orm';
import { Env } from '../types/env';
import { announcements } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

// 将数据库返回的蛇形命名转换为前端使用的驼峰命名
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

// 获取公告类型（必须在 /:id 之前定义以避免路由冲突）
app.get('/types', async (c) => {
  return c.json(response.success([
    { value: 1, label: '普通' },
    { value: 2, label: '系统' },
    { value: 3, label: '紧急' }
  ]));
});

// 获取目标用户类型（必须在 /:id 之前定义以避免路由冲突）
app.get('/target-types', async (c) => {
  return c.json(response.success([
    { value: 1, label: '全部用户' },
    { value: 2, label: 'VIP 用户' },
    { value: 3, label: '普通用户' }
  ]));
});

app.get('/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', keyword, title, status } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  // 构建 WHERE 条件
  const conditions = [];
  if (status !== undefined && status !== '' && status !== null) {
    conditions.push(`status = ${parseInt(status)}`);
  }
  
  // 兼容 frontend 传递的 keyword 和 title 参数，只处理非空值
  const searchKeyword = (keyword && keyword !== '') || (title && title !== '');
  if (searchKeyword) {
    const kw = keyword || title;
    conditions.push(`title LIKE '%${kw}%'`);
  }
  
  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  
  // 查询总数
  const countSql = `SELECT COUNT(*) as total FROM ys_announcement ${whereClause}`;
  const countResult = await c.env.DB.prepare(countSql).first();
  const total = countResult ? parseInt(countResult.total) : 0;

  // 只有当数据存在时才返回列表
  if (total > 0) {
    const listSql = `SELECT * FROM ys_announcement ${whereClause} ORDER BY create_time DESC LIMIT ${pageSizeNum} OFFSET ${offset}`;
    const listResult = await c.env.DB.prepare(listSql).all();
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

// 根路径作为 /list 的别名
app.get('/', (c) => {
  return c.rewrite('/list');
});

app.get('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const announcement = await db.select().from(announcements).where(eq(announcements.id, parseInt(id))).get();
  if (!announcement) {
    return c.json(response.notFound('公告不存在'));
  }

  return c.json(response.success(convertToCamelCase(announcement)));
});

app.post('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { title, content, type, status, isPopup, startTime, endTime, targetType, imageUrl, linkUrl, sort, adminId } = await c.req.json();

  const result = await db.insert(announcements).values({
    title,
    content,
    type: type || 1,
    status: status || 1,
    isPopup: isPopup || 0,
    startTime,
    endTime,
    targetType: targetType || 1,
    imageUrl: imageUrl || '',
    linkUrl: linkUrl || '',
    sort: sort || 0,
    adminId
  }).returning();

  return c.json(response.success(result[0], '创建成功'));
});

app.put('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const body = await c.req.json();
  const { title, content, type, status, isPopup, startTime, endTime, targetType, imageUrl, linkUrl, sort, adminId } = body;

  // 检查公告是否存在
  const announcement = await db.select().from(announcements).where(eq(announcements.id, parseInt(id))).get();
  if (!announcement) {
    return c.json(response.notFound('公告不存在'));
  }

  // 使用原生 D1 API 进行更新，确保所有值都有默认值
  const isPopupVal = isPopup !== undefined && isPopup !== null ? (isPopup === true || isPopup === 1 ? 1 : 0) : 0;
  const statusVal = status !== undefined && status !== null ? parseInt(status) : 1;
  const typeVal = type !== undefined && type !== null ? parseInt(type) : 1;
  const targetTypeVal = targetType !== undefined && targetType !== null ? parseInt(targetType) : 1;
  const sortVal = sort !== undefined && sort !== null ? parseInt(sort) : 0;
  const imageUrlVal = imageUrl || '';
  const linkUrlVal = linkUrl || '';
  const startTimeVal = startTime && startTime !== '' ? startTime : null;
  const endTimeVal = endTime && endTime !== '' ? endTime : null;
  const adminIdVal = adminId !== undefined && adminId !== null && adminId !== '' ? parseInt(adminId) : null;
  
  const updateSql = `
    UPDATE ys_announcement 
    SET title = ?, content = ?, type = ?, status = ?, is_popup = ?, 
        start_time = ?, end_time = ?, target_type = ?, 
        image_url = ?, link_url = ?, sort = ?, 
        admin_id = ?, update_time = ?
    WHERE id = ?
  `;
  
  await c.env.DB.prepare(updateSql).bind(
    String(title || ''), 
    String(content || ''), 
    typeVal, 
    statusVal, 
    isPopupVal,
    startTimeVal, 
    endTimeVal, 
    targetTypeVal,
    String(imageUrlVal || ''), 
    String(linkUrlVal || ''), 
    sortVal,
    adminIdVal, 
    new Date().toISOString(),
    parseInt(id)
  ).run();

  return c.json(response.success(null, '更新成功'));
});

app.delete('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const announcement = await db.select().from(announcements).where(eq(announcements.id, parseInt(id))).get();
  if (!announcement) {
    return c.json(response.notFound('公告不存在'));
  }

  await db.delete(announcements).where(eq(announcements.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

// 快速切换公告状态
app.put('/status/:id', async (c) => {
  const { id } = c.req.param();
  const { status } = await c.req.json();

  // 验证状态值
  if (status === undefined || status === null) {
    return c.json(response.badRequest('状态值不能为空'));
  }

  // 使用原生 D1 API 更新状态
  const statusVal = parseInt(status) === 1 ? 1 : 0;
  const updateSql = `
    UPDATE ys_announcement 
    SET status = ?, update_time = ?
    WHERE id = ?
  `;
  
  const result = await c.env.DB.prepare(updateSql)
    .bind(statusVal, new Date().toISOString(), parseInt(id))
    .run();
    
  if (result.success) {
    return c.json(response.success(null, '状态更新成功'));
  } else {
    return c.json(response.notFound('公告不存在'));
  }
});

// 兼容旧路由
app.get('/app/list', async (c) => {
  const db = createDatabase(c.env.DB);

  const listResult = await c.env.DB.prepare(
    'SELECT * FROM ys_announcement WHERE status = 1 ORDER BY create_time DESC'
  ).all();

  return c.json(response.success(listResult.results || []));
});

app.get('/app/popup', async (c) => {
  const db = createDatabase(c.env.DB);

  const popupResult = await c.env.DB.prepare(
    'SELECT * FROM ys_announcement WHERE status = 1 AND is_popup = 1 ORDER BY create_time DESC LIMIT 1'
  ).first();

  return c.json(response.success(popupResult));
});

export default app;