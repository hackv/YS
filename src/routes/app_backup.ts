import { Hono } from 'hono';
import { eq, like, count, and, desc, or, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import { Env } from '../types/env';
import { vods, types, users, playHistories, vodSources } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

function parsePlayUrl(pf: string, pu: string): Array<{ from: string, episodes: Array<{ name: string, url: string }> }> {
  // 彻底清理输入数据
  pf = String(pf || '').trim().replace(/^[`'\s]+|[`'\s]+$/g, '');
  pu = String(pu || '').trim().replace(/^[`'\s]+|[`'\s]+$/g);
  
  console.log('[parsePlayUrl] Input cleaned pf:', pf);
  console.log('[parsePlayUrl] Input cleaned pu:', pu);
  console.log('[parsePlayUrl] Input cleaned pu starts with http:', pu.startsWith('http'));
  
  if (!pf || !pu) {
    console.log('[parsePlayUrl] Missing pf or pu, returning empty');
    return [];
  }
  
  const fromArr = pf.split('$$$');
  const urlArr = pu.split('$$$');
  console.log('[parsePlayUrl] fromArr:', fromArr);
  console.log('[parsePlayUrl] urlArr:', urlArr);
  
  const result = fromArr.map((from, index) => {
    let urls = urlArr[index] || '';
    
    // 清理每个 URL（去除反引号、引号、空格）
    urls = urls.replace(/^[`'\s]+|[`'\s]+$/g, '').trim();
    
    console.log(`[parsePlayUrl] Processing from: ${index}, from: ${from}, urls: ${urls}`);
    console.log(`[parsePlayUrl] urls starts with http: ${urls.startsWith('http')}`);
    
    let episodes: Array<{ name: string, url: string }> = [];
    
    // 尝试多种格式解析
    if (urls.includes('#')) {
      // 格式 1: 第 1 集$url1#第 2 集$url2
      episodes = urls.split('#').map(ep => {
        const parts = ep.split('$');
        return {
          name: (parts[0] || '').trim(),
          url: (parts[1] || '').trim()
        };
      }).filter(ep => !!ep.url);
      console.log(`[parsePlayUrl] Format1 parsed: ${episodes.length} episodes`);
    } else if (urls.includes('$')) {
      // 格式 2: url1$url2$url3 (没有剧集名称，只有 URL)
      const urlList = urls.split('$').filter(u => u.trim());
      episodes = urlList.map((url, idx) => ({
        name: `第${idx + 1}集`,
        url: url.trim()
      }));
      console.log(`[parsePlayUrl] Format2 (multi-url) parsed: ${episodes.length} episodes`);
    } else {
      // 格式 3: 单个 URL（默认情况）
      if (urls) {
        episodes = [{
          name: '播放',
          url: urls
        }];
        console.log(`[parsePlayUrl] Format3 (single URL) parsed: ${episodes.length} episode(s)`);
      }
    }
    
    console.log(`[parsePlayUrl] Final episodes for ${from}:`, episodes);
    
    return {
      from,
      episodes
    };
  });
  
  console.log('[parsePlayUrl] Final result:', result);
  return result;
}

app.get('/vod/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { 
    page = '1', 
    pageSize = '20', 
    typeId, 
    keyword,
    area,
    year,
    sourceId,
    sortBy = 'updateTime',
    sortOrder = 'desc'
  } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  // 构建完整的 where 条件数组
  const whereConditions: any[] = [eq(vods.status, 1)];
  let typeNum = 0;
  let categoryIds: number[] = [];
  
  console.log(`[/vod/list] Received params:`, { typeId, keyword, area, year, sourceId });
  
  if (typeId) {
    typeNum = parseInt(typeId);
    // 获取所有子分类 ID（包括自身）
    const allTypes = await db.select().from(types).where(eq(types.status, 1));
    categoryIds = getAllChildCategoryIds(allTypes, typeNum);
    
    console.log(`[/vod/list] typeId=${typeId}, categoryIds count: ${categoryIds.length}, ids: [${categoryIds.join(', ')}]`);
    
    if (categoryIds.length > 1) {
      console.log(`[/vod/list] Using inArray with ${categoryIds.length} category IDs`);
      whereConditions.push(inArray(vods.typeId, categoryIds));
    } else {
      console.log(`[/vod/list] Using eq with single typeId: ${typeNum}`);
      whereConditions.push(eq(vods.typeId, typeNum));
    }
  }
  if (keyword) {
    whereConditions.push(like(vods.name, `%${keyword}%`));
  }
  if (area) {
    console.log(`[/vod/list] Adding area filter: ${area}`);
    whereConditions.push(eq(vods.area, area));
  } else {
    console.log(`[/vod/list] area is empty or undefined`);
  }
  if (year) {
    whereConditions.push(eq(vods.year, year));
  }
  if (sourceId && sourceId !== '') {
    whereConditions.push(eq(vods.sourceId, parseInt(sourceId)));
  }
  
  console.log(`[/vod/list] whereConditions built:`, whereConditions.length, 'conditions');

  const orderField = sortBy === 'hits' ? vods.hits : vods.updateTime;
const orderDirection = sortOrder === 'desc' ? desc(orderField) : orderField;

// 构建完整的 WHERE 子句
let whereClause = 'WHERE ys_vod.status = 1';
if (typeId && categoryIds && categoryIds.length > 0) {
  if (categoryIds.length > 1) {
    whereClause += ` AND ys_vod.type_id IN (${categoryIds.join(',')})`;
  } else {
    whereClause += ` AND ys_vod.type_id = ${typeNum}`;
  }
}
if (keyword) {
  whereClause += ` AND LOWER(ys_vod.name) LIKE '%${keyword.toLowerCase()}%'`;
}
if (area) {
  whereClause += ` AND ys_vod.area = '${area}'`;
}
if (year) {
  whereClause += ` AND ys_vod.year = '${year}'`;
}
if (sourceId && sourceId !== '') {
  whereClause += ` AND ys_vod.source_id = ${parseInt(sourceId)}`;
}

console.log(`[/vod/list] Final SQL: ${whereClause}`);

// 使用纯 SQL 查询
const orderBy = `ORDER BY ${sortBy === 'hits' ? 'hits' : 'update_time'} ${sortOrder}`;

const listSQL = `SELECT * FROM ys_vod ${whereClause} ${orderBy} LIMIT ${pageSizeNum} OFFSET ${offset}`;
const countSQL = `SELECT COUNT(*) as cnt FROM ys_vod ${whereClause}`;

console.log(`[/vod/list] List SQL: ${listSQL}`);
console.log(`[/vod/list] Count SQL: ${countSQL}`);

const list = await db.execute(listSQL).then(r => r.rows);
const countResult = await db.execute(countSQL).then(r => r.rows);
const total = countResult[0]?.cnt || list.length;

return c.json(response.success({
  list,
  total,
  page: pageNum,
  pageSize: pageSizeNum
}));
});

app.get('/vod/detail/:id', async (c) => {
  const db = createDatabase(c.env.DB)
  const { id } = c.req.param()

  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get()

  if (!vod || vod.status !== 1) {
    return c.json(response.notFound('视频不存在'))
  }

  const sources = await db.select().from(vodSources).where(eq(vodSources.vodId, parseInt(id)))

  await db.update(vods)
    .set({ hits: vod.hits + 1, hitsDay: vod.hitsDay + 1 })
    .where(eq(vods.id, parseInt(id)))

  let sourcesWithPlayList = sources.map(source => {
    return {
      ...source,
      playList: parsePlayUrl(source.playFrom, source.playUrl)
    }
  })

  // 如果 vodSources 表没有数据，从 vods 表的 playUrl 和 playFrom 字段获取
  let playList = []
  if (sourcesWithPlayList.length === 0 && vod.playUrl) {
    sourcesWithPlayList = [{
      id: vod.id,
      vodId: vod.id,
      sourceId: vod.sourceId,
      sourceVodId: vod.sourceVodId,
      sourceName: 'default',
      playFrom: vod.playFrom || 'default',
      playUrl: vod.playUrl,
      playServer: '',
      playNote: '',
      priority: 1,
      status: 1,
      collectTime: vod.collectTime,
      playList: parsePlayUrl(vod.playFrom || 'default', vod.playUrl)
    }]
  }

  // 提取 playList 用于直接返回
  if (sourcesWithPlayList.length > 0) {
    playList = sourcesWithPlayList[0].playList
  }

  return c.json(response.success({
    ...vod,
    sources: sourcesWithPlayList,
    sourceCount: sourcesWithPlayList.length,
    playList: playList
  }))
});

app.get('/vod/detail-with-sources/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();

  if (!vod || vod.status !== 1) {
    return c.json(response.notFound('视频不存在'));
  }

  const sources = await db.select().from(vodSources).where(eq(vodSources.vodId, parseInt(id)));

  await db.update(vods)
    .set({ hits: vod.hits + 1, hitsDay: vod.hitsDay + 1 })
    .where(eq(vods.id, parseInt(id)));

  let sourcesWithPlayList = sources.map(source => {
    return {
      ...source,
      playList: parsePlayUrl(source.playFrom, source.playUrl)
    };
  });

  // 如果 vodSources 表没有数据，从 vods 表的 playUrl 和 playFrom 字段获取
  if (sourcesWithPlayList.length === 0 && vod.playUrl) {
    sourcesWithPlayList = [{
      id: vod.id,
      vodId: vod.id,
      sourceId: vod.sourceId,
      sourceVodId: vod.sourceVodId,
      sourceName: 'default',
      playFrom: vod.playFrom || 'default',
      playUrl: vod.playUrl,
      playServer: '',
      playNote: '',
      priority: 1,
      status: 1,
      collectTime: vod.collectTime,
      playList: parsePlayUrl(vod.playFrom || 'default', vod.playUrl)
    }];
  }

  return c.json(response.success({ 
    ...vod, 
    sources: sourcesWithPlayList,
    sourceCount: sourcesWithPlayList.length
  }));
});

// 调试接口：返回原始数据库数据（公开访问，无需认证）
app.get('/vod/debug/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const vid = parseInt(id);
  
  const vod = await db.select().from(vods).where(eq(vods.id, vid)).get();
  if (!vod) return c.json(response.notFound('视频不存在'));
  
  const sources = await db.select().from(vodSources).where(eq(vodSources.vodId, vid));
  
  // 详细解析数据
  const parsedSources = sources.map(source => {
    const playList = parsePlayUrl(source.playFrom, source.playUrl);
    return {
      ...source,
      playList,
      playFrom_raw: source.playFrom,
      playUrl_raw: source.playUrl,
      playFrom_length: source.playFrom?.length || 0,
      playUrl_length: source.playUrl?.length || 0,
      episode_count: playList.reduce((sum, p) => sum + p.episodes.length, 0)
    };
  });
  
  const vodFallback = vod.playUrl ? {
    playFrom: vod.playFrom,
    playUrl: vod.playUrl,
    playFrom_length: vod.playFrom?.length || 0,
    playUrl_length: vod.playUrl?.length || 0,
    parsed: parsePlayUrl(vod.playFrom || 'default', vod.playUrl),
    episode_count: parsePlayUrl(vod.playFrom || 'default', vod.playUrl).reduce((sum, p) => sum + p.episodes.length, 0)
  } : null;
  
  return c.json({
    success: true,
    code: 200,
    message: '调试数据',
    data: {
      vod,
      vod_playFrom: vod.playFrom,
      vod_playUrl: vod.playUrl,
      sources_count: sources.length,
      sources,
      parsedSources,
      vodFallback,
      final_sources_structure: sources.length > 0 ? parsedSources : (vodFallback ? [{
        id: vod.id,
        vodId: vod.id,
        sourceId: vod.sourceId,
        sourceVodId: vod.sourceVodId,
        sourceName: 'default',
        playFrom: vod.playFrom || 'default',
        playUrl: vod.playUrl,
        playServer: '',
        playNote: '',
        priority: 1,
        status: 1,
        collectTime: vod.collectTime,
        playList: vodFallback.parsed
      }] : []),
      debug_info: {
        sources_from_db: sources.length > 0,
        fallback_used: sources.length === 0 && vod.playUrl,
        has_episodes: sources.length > 0 
          ? parsedSources.some(s => s.playList.some(p => p.episodes.length > 0))
          : (vodFallback ? vodFallback.episode_count > 0 : false),
        timestamp: new Date().toISOString()
      }
    }
  });
});

app.get('/vod/hot', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20' } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const list = await db.select()
    .from(vods)
    .where(eq(vods.status, 1))
    .orderBy(desc(vods.hits))
    .limit(pageSizeNum)
    .offset(offset);

  return c.json(response.success(list));
});

app.get('/vod/recommend', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20' } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const list = await db.select()
    .from(vods)
    .where(and(eq(vods.status, 1), vods.level.gt(0)))
    .orderBy(desc(vods.level))
    .orderBy(desc(vods.hits))
    .limit(pageSizeNum)
    .offset(offset);

  return c.json(response.success(list));
});

app.get('/type/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { parentId = 0, status = 1 } = c.req.query();

  const list = await db.select().from(types)
    .where(and(eq(types.parentId, parseInt(parentId)), eq(types.status, parseInt(status))))
    .orderBy(types.sort)
    .orderBy(types.id);

  return c.json(response.success(list));
});

app.get('/type/tree', async (c) => {
  const db = createDatabase(c.env.DB);

  const allTypes = await db.select().from(types)
    .where(eq(types.status, 1))
    .orderBy(types.sort)
    .orderBy(types.id);

  const tree = buildTree(allTypes);
  return c.json(response.success(tree));
});

app.get('/area/list', async (c) => {
  const db = createDatabase(c.env.DB);

  const areas = await db.select({ area: vods.area })
    .from(vods)
    .where(and(eq(vods.status, 1), vods.area.isNotNull()))
    .groupBy(vods.area);

  return c.json(response.success(areas.map(a => a.area).filter(Boolean)));
});

app.get('/year/list', async (c) => {
  const db = createDatabase(c.env.DB);

  const years = await db.select({ year: vods.year })
    .from(vods)
    .where(and(eq(vods.status, 1), vods.year.isNotNull()))
    .groupBy(vods.year)
    .orderBy(desc(vods.year));

  return c.json(response.success(years.map(y => y.year).filter(Boolean)));
});

app.post('/user/login', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, password } = await c.req.json();

  let user = await db.select().from(users).where(eq(users.username, username)).get();
  
  if (!user) {
    user = await db.select().from(users).where(eq(users.phone, username)).get();
  }

  if (!user) {
    return c.json(response.error('用户名或密码错误', 1001));
  }

  if (user.status !== 1) {
    return c.json(response.error('账号已被禁用', 1002));
  }

  if (password !== user.password) {
    return c.json(response.error('用户名或密码错误', 1001));
  }

  await db.update(users)
    .set({ lastLoginTime: new Date().toISOString() })
    .where(eq(users.id, user.id));

  delete user.password;
  return c.json(response.success(user, '登录成功'));
});

app.post('/user/register', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, password, nickname, phone } = await c.req.json();

  const existUser = await db.select().from(users)
    .where(or(eq(users.username, username), eq(users.phone, phone))).get();

  if (existUser) {
    return c.json(response.error('用户已存在', 1003));
  }

  const result = await db.insert(users).values({
    username,
    password,
    nickname: nickname || username,
    phone,
    status: 1
  }).returning();

  const user = result[0];
  delete user.password;

  return c.json(response.success(user, '注册成功'));
});

app.post('/user/play-history', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId, vodId, episode, progress, duration } = await c.req.json();

  const existing = await db.select().from(playHistories)
    .where(and(eq(playHistories.userId, userId), eq(playHistories.vodId, vodId))).get();

  if (existing) {
    await db.update(playHistories)
      .set({ episode, progress, duration, updateTime: new Date().toISOString() })
      .where(and(eq(playHistories.userId, userId), eq(playHistories.vodId, vodId)));
  } else {
    await db.insert(playHistories).values({
      userId,
      vodId,
      episode,
      progress,
      duration
    });
  }

  return c.json(response.success(null, '保存成功'));
});

app.get('/user/play-history/:userId', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId } = c.req.param();
  const { page = '1', pageSize = '20' } = c.req.query();
  
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const list = await db.select()
    .from(playHistories)
    .where(eq(playHistories.userId, parseInt(userId)))
    .orderBy(desc(playHistories.updateTime))
    .limit(pageSizeNum)
    .offset(offset);

  return c.json(response.success(list));
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

// 递归获取所有子分类 ID（包括自身）
function getAllChildCategoryIds(types: any[], parentId: number): number[] {
  const ids = [parentId];
  const children = types.filter(t => t.parentId === parentId);
  
  console.log(`[getAllChildCategoryIds] ParentId: ${parentId}, Children count: ${children.length}`);
  
  children.forEach(type => {
    console.log(`[getAllChildCategoryIds] - Child: ${type.name} (id=${type.id})`);
    ids.push(...getAllChildCategoryIds(types, type.id));
  });
  
  console.log(`[getAllChildCategoryIds] All IDs: ${ids.join(', ')}`);
  return ids;
}

export default app;