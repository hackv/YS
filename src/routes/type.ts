import { Hono } from 'hono';
import { eq, like, count, and } from 'drizzle-orm';
import { Env } from '../types/env';
import { types, vods } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', name, parentId, status, type: typeFilter } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(types);
  
  if (name) {
    query = query.where(like(types.name, `%${name}%`));
  }
  if (parentId !== undefined) {
    query = query.where(eq(types.parentId, parseInt(parentId)));
  }
  if (status !== undefined) {
    query = query.where(eq(types.status, parseInt(status)));
  }
  if (typeFilter !== undefined) {
    query = query.where(eq(types.type, parseInt(typeFilter)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(types),
    query.orderBy(types.sort).orderBy(types.id).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { name, parentId, status, type: typeFilter } = c.req.query();

  let query = db.select().from(types);
  
  if (name) {
    query = query.where(like(types.name, `%${name}%`));
  }
  if (parentId !== undefined) {
    query = query.where(eq(types.parentId, parseInt(parentId)));
  }
  if (status !== undefined) {
    query = query.where(eq(types.status, parseInt(status)));
  }
  if (typeFilter !== undefined) {
    query = query.where(eq(types.type, parseInt(typeFilter)));
  }

  const list = await query.orderBy(types.sort).orderBy(types.id);

  return c.json(response.success(list));
});

app.get('/tree', async (c) => {
  const db = createDatabase(c.env.DB);
  const { status = 1, type = 1 } = c.req.query();

  const allTypes = await db.select().from(types)
    .where(and(eq(types.status, parseInt(status)), eq(types.type, parseInt(type))))
    .orderBy(types.sort).orderBy(types.id);

  const tree = buildTree(allTypes);
  return c.json(response.success(tree));
});

app.get('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const type = await db.select().from(types).where(eq(types.id, parseInt(id))).get();

  if (!type) {
    return c.json(response.notFound('分类不存在'));
  }

  return c.json(response.success(type));
});

app.get('/detail/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const type = await db.select().from(types).where(eq(types.id, parseInt(id))).get();

  if (!type) {
    return c.json(response.notFound('分类不存在'));
  }

  return c.json(response.success(type));
});

app.post('/', async (c) => {
  const db = createDatabase(c.env.DB);
  const { name, enName, parentId, sort, status, logo, pic, description, type, sourceId } = await c.req.json();

  const result = await db.insert(types).values({
    name,
    enName,
    parentId: parentId || 0,
    sort: sort || 0,
    status: status || 1,
    logo,
    pic,
    description,
    type: type || 1,
    sourceId
  }).returning();

  return c.json(response.success(result[0], '创建成功'));
});

app.post('/create', async (c) => {
  const db = createDatabase(c.env.DB);
  const { name, enName, parentId, sort, status, logo, pic, description, type, sourceId } = await c.req.json();

  const result = await db.insert(types).values({
    name,
    enName,
    parentId: parentId || 0,
    sort: sort || 0,
    status: status || 1,
    logo,
    pic,
    description,
    type: type || 1,
    sourceId
  }).returning();

  return c.json(response.success(result[0], '创建成功'));
});

app.put('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { name, enName, parentId, sort, status, logo, pic, description, type, sourceId } = await c.req.json();

  const typeData = await db.select().from(types).where(eq(types.id, parseInt(id))).get();
  if (!typeData) {
    return c.json(response.notFound('分类不存在'));
  }

  await db.update(types)
    .set({ name, enName, parentId, sort, status, logo, pic, description, type, sourceId, updateTime: new Date().toISOString() })
    .where(eq(types.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.put('/update/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { name, enName, parentId, sort, status, logo, pic, description, type, sourceId } = await c.req.json();

  const typeData = await db.select().from(types).where(eq(types.id, parseInt(id))).get();
  if (!typeData) {
    return c.json(response.notFound('分类不存在'));
  }

  await db.update(types)
    .set({ name, enName, parentId, sort, status, logo, pic, description, type, sourceId, updateTime: new Date().toISOString() })
    .where(eq(types.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.delete('/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const type = await db.select().from(types).where(eq(types.id, parseInt(id))).get();
  if (!type) {
    return c.json(response.notFound('分类不存在'));
  }

  const childCount = await db.select({ count: count() }).from(types).where(eq(types.parentId, parseInt(id))).get();
  if (childCount.count > 0) {
    return c.json(response.error('请先删除子分类'));
  }

  const vodCount = await db.select({ count: count() }).from(vods)
    .where(and(eq(vods.typeId, parseInt(id)), eq(vods.status, 1))).get();
  if (vodCount.count > 0) {
    return c.json(response.error('该分类下有视频，不能删除'));
  }

  await db.delete(types).where(eq(types.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.delete('/delete/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const type = await db.select().from(types).where(eq(types.id, parseInt(id))).get();
  if (!type) {
    return c.json(response.notFound('分类不存在'));
  }

  const childCount = await db.select({ count: count() }).from(types).where(eq(types.parentId, parseInt(id))).get();
  if (childCount.count > 0) {
    return c.json(response.error('请先删除子分类'));
  }

  const vodCount = await db.select({ count: count() }).from(vods)
    .where(and(eq(vods.typeId, parseInt(id)), eq(vods.status, 1))).get();
  if (vodCount.count > 0) {
    return c.json(response.error('该分类下有视频，不能删除'));
  }

  await db.delete(types).where(eq(types.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.put('/sort', async (c) => {
  const db = createDatabase(c.env.DB);
  const { items } = await c.req.json();

  for (const item of items) {
    await db.update(types)
      .set({ sort: item.sort, updateTime: new Date().toISOString() })
      .where(eq(types.id, item.id));
  }

  return c.json(response.success(null, '排序更新成功'));
});

app.post('/merge', async (c) => {
  const db = createDatabase(c.env.DB);
  const { keepId, deleteIds } = await c.req.json();

  const keepType = await db.select().from(types).where(eq(types.id, parseInt(keepId))).get();
  if (!keepType) {
    return c.json(response.notFound('保留的分类不存在'));
  }

  for (const deleteId of deleteIds) {
    await db.update(vods)
      .set({ typeId: parseInt(keepId), updateTime: new Date().toISOString() })
      .where(eq(vods.typeId, parseInt(deleteId)));

    await db.delete(types).where(eq(types.id, parseInt(deleteId)));
  }

  return c.json(response.success(null, '合并成功'));
});

function buildTree(types: any[]): any[] {
  const map = new Map<number, any>();
  const roots: any[] = [];

  types.forEach(type => {
    map.set(type.id, { ...type, children: [] });
  });

  types.forEach(type => {
    const node = map.get(type.id)!;
    if (type.parentId && map.has(type.parentId)) {
      map.get(type.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

export default app;