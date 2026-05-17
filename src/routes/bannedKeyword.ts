import { Hono } from 'hono';
import { eq, like, count } from 'drizzle-orm';
import { Env } from '../types/env';
import { bannedKeywords } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

// 驼峰转下划线
const camelToSnake = (str: string): string => {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
};

// 转换对象的键名从驼峰到下划线
const convertKeysToSnake = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(convertKeysToSnake);
  }
  if (obj !== null && typeof obj === 'object') {
    const newObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        newObj[camelToSnake(key)] = obj[key];
      }
    }
    return newObj;
  }
  return obj;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', keyword, type } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(bannedKeywords);
  
  if (keyword) {
    query = query.where(like(bannedKeywords.keyword, `%${keyword}%`));
  }
  if (type !== undefined) {
    query = query.where(eq(bannedKeywords.type, parseInt(type)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(bannedKeywords),
    query.orderBy(bannedKeywords.id).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list: convertKeysToSnake(list),
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', keyword, type, sourceId, status } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(bannedKeywords);
  
  if (keyword) {
    query = query.where(like(bannedKeywords.keyword, `%${keyword}%`));
  }
  if (type !== undefined && type !== '') {
    query = query.where(eq(bannedKeywords.type, parseInt(type)));
  }
  if (sourceId !== undefined && sourceId !== '') {
    query = query.where(eq(bannedKeywords.sourceId, parseInt(sourceId)));
  }
  if (status !== undefined && status !== '') {
    query = query.where(eq(bannedKeywords.status, parseInt(status)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(bannedKeywords),
    query.orderBy(bannedKeywords.id).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list: convertKeysToSnake(list),
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/types', async (c) => {
  const types = [
    { value: 1, label: '视频标题' },
    { value: 2, label: '演员名称' },
    { value: 3, label: '导演名称' },
    { value: 4, label: '视频简介' },
    { value: 5, label: '全部字段' }
  ];
  return c.json(response.success(types));
});

app.get('/match-fields', async (c) => {
  const fields = [
    { value: 'name', label: '视频名称' },
    { value: 'actor', label: '演员' },
    { value: 'director', label: '导演' },
    { value: 'blurb', label: '简介' },
    { value: 'all', label: '全部字段' }
  ];
  return c.json(response.success(fields));
});

app.get('/match-modes', async (c) => {
  const modes = [
    { value: 'contains', label: '包含匹配' },
    { value: 'equals', label: '完全匹配' },
    { value: 'regex', label: '正则匹配' }
  ];
  return c.json(response.success(modes));
});

app.post('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { keyword, type = 1 } = await c.req.json();

  const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.keyword, keyword)).get();
  if (exist) {
    return c.json(response.error('关键词已存在'));
  }

  const result = await db.insert(bannedKeywords).values({
    keyword,
    type
  }).returning();

  return c.json(response.success(convertKeysToSnake(result[0]), '添加成功'));
});

app.post('/create', async (c) => {
  const db = createDatabase(c.env.DB);
  const { keyword, type = 1, sourceId, matchField = 'all', matchMode = 'contains', status = 1, remark } = await c.req.json();

  const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.keyword, keyword)).get();
  if (exist) {
    return c.json(response.error('关键词已存在'));
  }

  const result = await db.insert(bannedKeywords).values({
    keyword,
    type,
    sourceId,
    matchField,
    matchMode,
    status,
    remark
  }).returning();

  return c.json(response.success(result[0], '添加成功'));
});

app.get('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const keyword = await db.select().from(bannedKeywords).where(eq(bannedKeywords.id, parseInt(id))).get();
  if (!keyword) {
    return c.json(response.notFound('关键词不存在'));
  }

  return c.json(response.success(convertKeysToSnake(keyword)));
});

app.put('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { keyword, type } = await c.req.json();

  const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.id, parseInt(id))).get();
  if (!exist) {
    return c.json(response.notFound('关键词不存在'));
  }

  if (keyword && keyword !== exist.keyword) {
    const duplicate = await db.select().from(bannedKeywords).where(eq(bannedKeywords.keyword, keyword)).get();
    if (duplicate) {
      return c.json(response.error('关键词已存在'));
    }
  }

  await db.update(bannedKeywords)
    .set({ keyword, type })
    .where(eq(bannedKeywords.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.put('/update/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { keyword, type, sourceId, matchField, matchMode, status, remark } = await c.req.json();

  const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.id, parseInt(id))).get();
  if (!exist) {
    return c.json(response.notFound('关键词不存在'));
  }

  if (keyword && keyword !== exist.keyword) {
    const duplicate = await db.select().from(bannedKeywords).where(eq(bannedKeywords.keyword, keyword)).get();
    if (duplicate) {
      return c.json(response.error('关键词已存在'));
    }
  }

  await db.update(bannedKeywords)
    .set({ keyword, type, sourceId, matchField, matchMode, status, remark })
    .where(eq(bannedKeywords.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.put('/status/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { status } = await c.req.json();

  const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.id, parseInt(id))).get();
  if (!exist) {
    return c.json(response.notFound('关键词不存在'));
  }

  await db.update(bannedKeywords)
    .set({ status })
    .where(eq(bannedKeywords.id, parseInt(id)));

  return c.json(response.success(null, '状态更新成功'));
});

app.delete('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.id, parseInt(id))).get();
  if (!exist) {
    return c.json(response.notFound('关键词不存在'));
  }

  await db.delete(bannedKeywords).where(eq(bannedKeywords.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.delete('/delete/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.id, parseInt(id))).get();
  if (!exist) {
    return c.json(response.notFound('关键词不存在'));
  }

  await db.delete(bannedKeywords).where(eq(bannedKeywords.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.post('/batch-delete', async (c) => {
  const db = createDatabase(c.env.DB);
  const { ids } = await c.req.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json(response.error('请选择要删除的关键词'));
  }

  await db.delete(bannedKeywords).where(bannedKeywords.id.in(ids.map(id => parseInt(id))));

  return c.json(response.success(null, `成功删除 ${ids.length} 条记录`));
});

app.post('/batch-create', async (c) => {
  const db = createDatabase(c.env.DB);
  const { keywords, type = 1 } = await c.req.json();

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return c.json(response.error('请提供关键词列表'));
  }

  const inserted = [];
  const skipped = [];

  for (const keyword of keywords) {
    const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.keyword, keyword)).get();
    if (exist) {
      skipped.push(keyword);
    } else {
      const result = await db.insert(bannedKeywords).values({
        keyword,
        type
      }).returning();
      inserted.push(result[0]);
    }
  }

  return c.json(response.success({
    inserted,
    skipped,
    message: `成功添加 ${inserted.length} 条，跳过 ${skipped.length} 条重复记录`
  }));
});

app.get('/export', async (c) => {
  const db = createDatabase(c.env.DB);
  const keywords = await db.select().from(bannedKeywords).orderBy(bannedKeywords.id);
  
  const csv = keywords.map(k => `${k.id},${k.keyword},${k.type},${k.status}`).join('\n');
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=banned_keywords.csv'
    }
  });
});

app.post('/import', async (c) => {
  const db = createDatabase(c.env.DB);
  const { data } = await c.req.json();

  if (!Array.isArray(data) || data.length === 0) {
    return c.json(response.error('请提供导入数据'));
  }

  const inserted = [];
  const skipped = [];

  for (const item of data) {
    const exist = await db.select().from(bannedKeywords).where(eq(bannedKeywords.keyword, item.keyword)).get();
    if (exist) {
      skipped.push(item.keyword);
    } else {
      const result = await db.insert(bannedKeywords).values({
        keyword: item.keyword,
        type: item.type || 1
      }).returning();
      inserted.push(result[0]);
    }
  }

  return c.json(response.success({
    inserted,
    skipped,
    message: `成功导入 ${inserted.length} 条，跳过 ${skipped.length} 条重复记录`
  }));
});

app.post('/check', async (c) => {
  const db = createDatabase(c.env.DB);
  const { text } = await c.req.json();

  const keywords = await db.select().from(bannedKeywords).where(eq(bannedKeywords.status, 1));

  const matched: string[] = [];
  keywords.forEach(k => {
    if (text.includes(k.keyword)) {
      matched.push(k.keyword);
    }
  });

  return c.json(response.success({
    hasBanned: matched.length > 0,
    matched
  }));
});

export default app;