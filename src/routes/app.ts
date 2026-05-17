import { Hono } from 'hono';
import { eq, like, and, or, sql } from 'drizzle-orm';
import { Env } from '../types/env';
import { vods, types, users, playHistories, vodSources, createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

function getAllChildCategoryIds(types: any[], parentId: number): number[] {
  const ids = [parentId];
  const children = types.filter(t => t.parentId === parentId);
  children.forEach(type => {
    ids.push(...getAllChildCategoryIds(types, type.id));
  });
  return ids;
}

function parsePlayUrl(pf: string, pu: string): Array<{ from: string, episodes: Array<{ name: string, url: string }> }> {
  pf = String(pf || '').trim();
  pu = String(pu || '').trim();
  if (!pf || !pu) return [];
  const fromArr = pf.split('$$$');
  const urlArr = pu.split('$$$');
  const result = fromArr.map((from, index) => {
    let urls = urlArr[index] || '';
    urls = urls.trim();
    let episodes: Array<{ name: string, url: string }> = [];
    if (urls.includes('#')) {
      episodes = urls.split('#').map(ep => {
        const parts = ep.split('$');
        return { name: (parts[0] || '').trim(), url: (parts[1] || '').trim() };
      }).filter(ep => !!ep.url);
    } else if (urls.includes('$')) {
      episodes = urls.split('$').map((url, idx) => ({ name: `第${idx + 1}集`, url: url.trim() })).filter(u => u.url);
    } else if (urls) {
      episodes = [{ name: '播放', url: urls }];
    }
    return { from, episodes };
  });
  return result;
}

app.get('/vod/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', typeId, keyword, area, year, sourceId, sortBy = 'updateTime', sortOrder = 'desc' } = c.req.query();
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const conditions = ['ys_vod.status = 1'];
  
  if (typeId) {
    const typeNum = parseInt(typeId);
    const allTypes = await db.select().from(types).where(eq(types.status, 1));
    const categoryIds = getAllChildCategoryIds(allTypes, typeNum);
    if (categoryIds.length > 1) {
      conditions.push(`ys_vod.type_id IN (${categoryIds.join(',')})`);
    } else {
      conditions.push(`ys_vod.type_id = ${typeNum}`);
    }
  }
  if (keyword) conditions.push(`ys_vod.name LIKE '%${keyword.replace(/'/g, "''")}%'`);
  if (area) conditions.push(`ys_vod.area = '${area.replace(/'/g, "''")}'`);
  if (year) conditions.push(`ys_vod.year = '${year}'`);
  if (sourceId && sourceId !== '') conditions.push(`ys_vod.source_id = ${parseInt(sourceId)}`);

  const whereClause = conditions.join(' AND ');
  const orderColumn = sortBy === 'hits' ? 'hits' : 'update_time';
  const listSQL = `SELECT * FROM ys_vod WHERE ${whereClause} ORDER BY ys_vod.${orderColumn} ${sortOrder} LIMIT ${pageSizeNum} OFFSET ${offset}`;
  const countSQL = `SELECT COUNT(*) as cnt FROM ys_vod WHERE ${whereClause}`;

  const [listResult, countResult] = await Promise.all([
    c.env.DB.prepare(listSQL).all(),
    c.env.DB.prepare(countSQL).first()
  ]);

  const list = listResult.results || [];
  const total = countResult ? parseInt(String(countResult.cnt)) : list.length;

  return c.json(response.success({ list, total, page: pageNum, pageSize: pageSizeNum }));
});

app.get('/vod/detail/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();
  if (!vod || vod.status !== 1) return c.json(response.notFound('视频不存在'));
  const sources = await db.select().from(vodSources).where(eq(vodSources.vodId, parseInt(id)));
  await db.update(vods).set({ hits: vod.hits + 1, hitsDay: vod.hitsDay + 1 }).where(eq(vods.id, parseInt(id)));
  let loadedSources = sources.map(s => ({ ...s, playList: parsePlayUrl(s.play_from, s.play_url) }));
  if (loadedSources.length === 0 && vod.play_url) {
    loadedSources = [{ id: vod.id, vodId: vod.id, sourceId: vod.source_id, sourceVodId: vod.source_vod_id, sourceName: 'default', playFrom: vod.play_from || 'default', playUrl: vod.play_url, playServer: '', playNote: '', priority: 1, status: 1, collectTime: vod.collect_time, playList: parsePlayUrl(vod.play_from || 'default', vod.play_url) }];
  }
  return c.json(response.success({ ...vod, sources: loadedSources, sourceCount: loadedSources.length, playList: loadedSources[0]?.playList || [] }));
});

app.get('/vod/detail-with-sources/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();
  if (!vod || vod.status !== 1) return c.json(response.notFound('视频不存在'));
  const sources = await db.select().from(vodSources).where(eq(vodSources.vodId, parseInt(id)));
  let loadedSources = sources.map(s => ({ ...s, playList: parsePlayUrl(s.play_from, s.play_url) }));
  if (loadedSources.length === 0 && vod.play_url) {
    loadedSources = [{ id: vod.id, vodId: vod.id, sourceId: vod.source_id, sourceVodId: vod.source_vod_id, sourceName: 'default', playFrom: vod.play_from || 'default', playUrl: vod.play_url, playServer: '', playNote: '', priority: 1, status: 1, collectTime: vod.collect_time, playList: parsePlayUrl(vod.play_from || 'default', vod.play_url) }];
  }
  return c.json(response.success({ ...vod, sources: loadedSources, sourceCount: loadedSources.length }));
});

app.get('/vod/hot', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20' } = c.req.query();
  const limit = parseInt(pageSize);
  const offset = (parseInt(page) - 1) * limit;
  const list = await db.select().from(vods).where(eq(vods.status, 1)).limit(limit).offset(offset);
  return c.json(response.success(list));
});

app.get('/type/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { parentId = 0, status = 1 } = c.req.query();
  const list = await db.select().from(types).where(and(eq(types.parentId, parseInt(parentId)), eq(types.status, parseInt(status))));
  return c.json(response.success(list));
});

app.get('/type/tree', async (c) => {
  const db = createDatabase(c.env.DB);
  const allTypes = await db.select().from(types).where(eq(types.status, 1));
  const map = new Map();
  const roots = [];
  allTypes.forEach(t => map.set(t.id, { ...t, children: [] }));
  allTypes.forEach(t => { const node = map.get(t.id); if (t.parentId && map.has(t.parentId)) map.get(t.parentId).children.push(node); else roots.push(node); });
  return c.json(response.success(roots));
});

/**
 * 获取视频详情
 * GET /api/app/detail?id=xxx
 */
app.get('/detail', async (c) => {
  const { id } = c.req.query();
  
  if (!id) {
    return c.json(response.error('视频 ID 不能为空', 1001));
  }

  const vodId = parseInt(id);
  
  // 联表查询获取视频信息
  const vodSQL = `
    SELECT v.*, t.name as type_name 
    FROM ys_vod v
    LEFT JOIN ys_type t ON v.type_id = t.id
    WHERE v.id = ? AND v.status = 1
  `;
  const vodResult = await c.env.DB.prepare(vodSQL).bind(vodId).all();
  const vod = vodResult.results?.[0] as any;
  
  if (!vod) {
    return c.json(response.notFound('视频不存在'));
  }
  
  // 获取分类信息
  const currentTypeSQL = 'SELECT id, name, parent_id FROM ys_type WHERE id = ?';
  const currentTypeResult = await c.env.DB.prepare(currentTypeSQL).bind(vod.type_id).first();
  
  let typeName = '';  // 一级分类名称
  let tag = '';       // 二级分类名称或一级分类
  
  if (currentTypeResult) {
    if (currentTypeResult.parent_id && currentTypeResult.parent_id !== 0) {
      // 当前是二级分类
      // 获取一级分类名称
      const parentTypeSQL = 'SELECT name FROM ys_type WHERE id = ?';
      const parentTypeResult = await c.env.DB.prepare(parentTypeSQL).bind(currentTypeResult.parent_id).first();
      typeName = parentTypeResult?.name || currentTypeResult.name;
      tag = currentTypeResult.name;  // tag 返回二级分类
    } else {
      // 当前是一级分类
      typeName = currentTypeResult.name;
      tag = currentTypeResult.name;  // tag 返回一级分类
    }
  }
  
  vod.type_name = typeName;
  vod.tag = tag;

  // 获取播放源列表
  const sourcesSQL = 'SELECT * FROM ys_vod_source WHERE vod_id = ?';
  const sourcesResult = await c.env.DB.prepare(sourcesSQL).bind(vodId).all();
  const sources = (sourcesResult.results || []) as any[];

  // 更新播放热度
  const updateHitsSQL = 'UPDATE ys_vod SET hits = hits + 1, hits_day = hits_day + 1 WHERE id = ?';
  await c.env.DB.prepare(updateHitsSQL).bind(vodId).run();

  // 构建播放列表
  let playList: any[] = [];
  
  if (sources.length > 0) {
    // 从 vod_sources 表获取播放源
    for (const s of sources) {
      const from = s.source_name || s.play_from || '默认';
      const playUrl = String(s.play_url || '');
      const playFrom = String(s.play_from || '');
      
      if (playUrl) {
        // 解析单个播放源的 URL
        const urls = playUrl.split('$$$')[0] || '';
        let episodes: any[] = [];
        
        if (urls.indexOf('#') >= 0) {
          // 格式：第 1 集$url1#第 2 集$url2
          episodes = urls.split('#').map(ep => {
            const parts = ep.split('$');
            return { name: (parts[0] || '').trim(), url: (parts[1] || '').trim() };
          }).filter(ep => !!ep.url);
        } else if (urls.indexOf('$') >= 0) {
          const parts = urls.split('$');
          if (parts.length === 2 && parts[1].startsWith('http')) {
            // 格式：名称$url（单集）
            episodes = [{ name: parts[0].trim() || '播放', url: parts[1].trim() }];
          } else {
            // 格式：url1$url2$url3（多集无名称）
            episodes = parts.map((url, idx) => ({ 
              name: `第${idx + 1}集`, 
              url: url.trim() 
            })).filter(u => u.url);
          }
        } else if (urls) {
          episodes = [{ name: '播放', url: urls }];
        }
        
        playList.push({ from, episodes });
      }
    }
  } else if (vod.play_url) {
    // 使用 vod 表中的播放信息
    const playUrl = String(vod.play_url || '');
    const playFrom = String(vod.play_from || '');
    
    if (playUrl) {
      const urls = playUrl.split('$$$')[0] || '';
      let episodes: any[] = [];
      
      if (urls.indexOf('#') >= 0) {
        // 格式：第 1 集$url1#第 2 集$url2
        episodes = urls.split('#').map(ep => {
          const parts = ep.split('$');
          return { name: (parts[0] || '').trim(), url: (parts[1] || '').trim() };
        }).filter(ep => !!ep.url);
      } else if (urls.indexOf('$') >= 0) {
        const parts = urls.split('$');
        if (parts.length === 2 && parts[1].startsWith('http')) {
          // 格式：名称$url（单集）
          episodes = [{ name: parts[0].trim() || '播放', url: parts[1].trim() }];
        } else {
          // 格式：url1$url2$url3（多集无名称）
          episodes = parts.map((url, idx) => ({ 
            name: `第${idx + 1}集`, 
            url: url.trim() 
          })).filter(u => u.url);
        }
      } else if (urls) {
        episodes = [{ name: '播放', url: urls }];
      }
      
      playList = [{ from: playFrom || '默认', episodes }];
    }
  }

  const vodDetail = {
    id: vod.id,
    name: vod.name,
    subName: vod.sub_name,
    pic: vod.pic,
    score: vod.score && vod.score > 0 ? String(vod.score) : '',
    year: vod.year,
    area: vod.area,
    type_name: vod.type_name,  // 分类名称
    typeName: vod.type_name,    // 驼峰命名
    director: vod.director,
    vod_actor: vod.vod_actor,
    actor: vod.vod_actor,       // 兼容命名
    tag: vod.tag,
    remarks: vod.remarks,
    vod_content: vod.content,
    vod_hits: vod.hits,
    hits: vod.hits,             // 兼容命名
    playList: playList
  };

  return c.json(response.success(vodDetail));
});

/**
 * 搜索视频
 * GET /api/app/search?wd=xxx&page=1&pageSize=20
 */
app.get('/search', async (c) => {
  const wd = c.req.query('wd');
  const page = c.req.query('page') || '1';
  const pageSize = c.req.query('pageSize') || '20';
  
  if (!wd || wd.trim() === '') {
    return c.json(response.success({ list: [] }));
  }

  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const searchPattern = `%${wd}%`;
  
  const countSQL = 'SELECT COUNT(*) as cnt FROM ys_vod WHERE status = 1 AND name LIKE ?';
  const countResult = await c.env.DB.prepare(countSQL).bind(searchPattern).first();
  const total = countResult?.cnt || 0;

  const listSQL = `
    SELECT * FROM ys_vod 
    WHERE status = 1 AND name LIKE ?
    ORDER BY update_time DESC
    LIMIT ? OFFSET ?
  `;
  const listResult = await c.env.DB.prepare(listSQL).bind(searchPattern, pageSizeNum, offset).all();
  const list = (listResult.results || []).map((vod: any) => ({
    id: vod.id,
    name: vod.name,
    pic: vod.pic,
    score: vod.score && vod.score > 0 ? String(vod.score) : '',
    year: vod.year,
    area: vod.area,
    actor: vod.actor,
    remarks: vod.remarks,
    hits: vod.hits
  }));

  return c.json(response.success({ list, total, page: pageNum, pageSize: pageSizeNum }));
});

app.post('/user/login', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, password } = await c.req.json();
  let user = await db.select().from(users).where(eq(users.username, username)).get();
  if (!user) user = await db.select().from(users).where(eq(users.phone, username)).get();
  if (!user || user.status !== 1 || password !== user.password) {
    return c.json(response.error('用户名或密码错误', 1001));
  }
  delete user.password;
  return c.json(response.success(user, '登录成功'));
});

app.post('/user/register', async (c) => {
  const db = createDatabase(c.env.DB);
  const { username, password, nickname, phone } = await c.req.json();
  
  if (!username || !password) {
    return c.json(response.error('用户名和密码不能为空', 1001));
  }

  const existByUsername = await db.select().from(users).where(eq(users.username, username)).get();
  if (existByUsername) {
    return c.json(response.error('用户名已存在', 1003));
  }

  if (phone) {
    const existByPhone = await db.select().from(users).where(eq(users.phone, phone)).get();
    if (existByPhone) {
      return c.json(response.error('手机号已被注册', 1003));
    }
  }

  const result = await db.insert(users).values({ 
    username, 
    password, 
    nickname: nickname || username, 
    phone: phone || null, 
    status: 1 
  }).returning();
  
  delete result[0].password;
  return c.json(response.success(result[0], '注册成功'));
});

app.post('/user/play-history', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId, vodId, episode, progress, duration } = await c.req.json();
  const exist = await db.select().from(playHistories).where(and(eq(playHistories.userId, userId), eq(playHistories.vodId, vodId))).get();
  if (exist) {
    await db.update(playHistories).set({ episode, progress, duration, updateTime: new Date().toISOString() }).where(and(eq(playHistories.userId, userId), eq(playHistories.vodId, vodId)));
  } else {
    await db.insert(playHistories).values({ userId, vodId, episode, progress, duration });
  }
  return c.json(response.success(null, '保存成功'));
});

app.get('/user/play-history/:userId', async (c) => {
  const db = createDatabase(c.env.DB);
  const { userId } = c.req.param();
  const { page = '1', pageSize = '20' } = c.req.query();
  const limit = parseInt(pageSize);
  const offset = (parseInt(page) - 1) * limit;
  const list = await db.select().from(playHistories).where(eq(playHistories.userId, parseInt(userId))).limit(limit).offset(offset);
  return c.json(response.success(list));
});

export default app;