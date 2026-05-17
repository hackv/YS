import { Hono } from 'hono';
import { eq, like, count, and, or, gt, desc, inArray } from 'drizzle-orm';
import { Env } from '../types/env';
import { vods, types, vodSources } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

function parsePlayUrl(pf: string, pu: string): Array<{ from: string, episodes: Array<{ name: string, url: string }> }> {
  if (!pf || !pu) return [];
  
  const fromArr = pf.split('$$$');
  const urlArr = pu.split('$$$');
  
  return fromArr.map((from, index) => {
    const urls = urlArr[index] || '';
    const episodes = urls.split('#').map(ep => {
      const parts = ep.split('$');
      return {
        name: parts[0] || '',
        url: parts[1] || ''
      };
    }).filter(ep => ep.url);
    
    return {
      from,
      episodes
    };
  });
}

app.get('/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const {
    page = '1',
    pageSize = '20',
    name,
    typeId,
    typeId1,
    status,
    letter,
    area,
    year,
    keyword,
    orderBy
  } = c.req.query();

  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(vods);

  if (name) {
    query = query.where(like(vods.name, `%${name}%`));
  }
  if (typeId !== undefined) {
    query = query.where(eq(vods.typeId, parseInt(typeId)));
  }
  if (typeId1 !== undefined) {
    query = query.where(eq(vods.typeId1, parseInt(typeId1)));
  }
  if (status !== undefined) {
    query = query.where(eq(vods.status, parseInt(status)));
  }
  if (letter) {
    query = query.where(eq(vods.letter, letter));
  }
  if (area) {
    query = query.where(eq(vods.area, area));
  }
  if (year) {
    query = query.where(eq(vods.year, year));
  }
  if (keyword) {
    query = query.where(or(
      like(vods.name, `%${keyword}%`),
      like(vods.actor, `%${keyword}%`),
      like(vods.director, `%${keyword}%`),
      like(vods.blurb, `%${keyword}%`)
    ));
  }

  if (orderBy === 'createTime') {
    query = query.orderBy(vods.createTime);
  } else if (orderBy === 'hits') {
    query = query.orderBy(desc(vods.hits));
  } else {
    query = query.orderBy(desc(vods.updateTime));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(vods),
    query.limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/detail/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();

  if (!vod) {
    return c.json(response.notFound('视频不存在'));
  }

  await db.update(vods)
    .set({ hits: vod.hits + 1, hitsDay: vod.hitsDay + 1 })
    .where(eq(vods.id, parseInt(id)));

  return c.json(response.success(vod));
});

app.post('/create', async (c) => {
  const db = createDatabase(c.env.DB);
  const body = await c.req.json();

  const result = await db.insert(vods).values({
    name: body.name,
    subName: body.subName,
    enName: body.enName,
    typeId: body.typeId || 0,
    typeId1: body.typeId1 || 0,
    status: body.status || 1,
    letter: body.letter,
    normalizedName: body.normalizedName,
    color: body.color,
    tag: body.tag,
    class: body.class,
    pic: body.pic,
    picThumb: body.picThumb,
    picSlide: body.picSlide,
    picScreenshot: body.picScreenshot,
    actor: body.actor,
    director: body.director,
    writer: body.writer,
    blurb: body.blurb,
    remarks: body.remarks,
    pubdate: body.pubdate,
    total: body.total || 0,
    serial: body.serial || '0',
    area: body.area,
    lang: body.lang,
    year: body.year,
    version: body.version,
    state: body.state,
    level: body.level || 0,
    copyright: body.copyright || 0,
    points: body.points || 0,
    duration: body.duration,
    playFrom: body.playFrom,
    playServer: body.playServer,
    playNote: body.playNote,
    playUrl: body.playUrl,
    downFrom: body.downFrom,
    downServer: body.downServer,
    downNote: body.downNote,
    downUrl: body.downUrl,
    sourceId: body.sourceId,
    sourceVodId: body.sourceVodId
  }).returning();

  return c.json(response.success(result[0], '创建成功'));
});

app.put('/update/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const body = await c.req.json();

  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();
  if (!vod) {
    return c.json(response.notFound('视频不存在'));
  }

  await db.update(vods)
    .set({
      name: body.name,
      subName: body.subName,
      enName: body.enName,
      typeId: body.typeId,
      typeId1: body.typeId1,
      status: body.status,
      letter: body.letter,
      normalizedName: body.normalizedName,
      color: body.color,
      tag: body.tag,
      class: body.class,
      pic: body.pic,
      picThumb: body.picThumb,
      picSlide: body.picSlide,
      picScreenshot: body.picScreenshot,
      actor: body.actor,
      director: body.director,
      writer: body.writer,
      blurb: body.blurb,
      remarks: body.remarks,
      pubdate: body.pubdate,
      total: body.total,
      serial: body.serial,
      area: body.area,
      lang: body.lang,
      year: body.year,
      version: body.version,
      state: body.state,
      level: body.level,
      copyright: body.copyright,
      points: body.points,
      duration: body.duration,
      playFrom: body.playFrom,
      playServer: body.playServer,
      playNote: body.playNote,
      playUrl: body.playUrl,
      downFrom: body.downFrom,
      downServer: body.downServer,
      downNote: body.downNote,
      downUrl: body.downUrl,
      sourceId: body.sourceId,
      sourceVodId: body.sourceVodId,
      updateTime: new Date().toISOString()
    })
    .where(eq(vods.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.delete('/delete/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();
  if (!vod) {
    return c.json(response.notFound('视频不存在'));
  }

  await db.delete(vods).where(eq(vods.id, parseInt(id)));

  return c.json(response.success(null, '删除成功'));
});

app.post('/batch-delete', async (c) => {
  const db = createDatabase(c.env.DB);
  const { ids } = await c.req.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json(response.error('请选择要删除的视频'));
  }

  const numericIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
  
  if (numericIds.length === 0) {
    return c.json(response.error('没有有效的ID'));
  }

  await db.delete(vods).where(inArray(vods.id, numericIds));

  return c.json(response.success(null, `成功删除 ${ids.length} 条记录`));
});

app.post('/delete-by-source', async (c) => {
  const db = createDatabase(c.env.DB);
  const { sourceId } = await c.req.json();

  await db.delete(vods).where(eq(vods.sourceId, sourceId));

  return c.json(response.success(null, '删除成功'));
});

app.put('/status/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { status } = await c.req.json();

  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();
  if (!vod) {
    return c.json(response.notFound('视频不存在'));
  }

  await db.update(vods)
    .set({ status, updateTime: new Date().toISOString() })
    .where(eq(vods.id, parseInt(id)));

  return c.json(response.success(null, '更新成功'));
});

app.get('/filter-options', async (c) => {
  const db = createDatabase(c.env.DB);
  
  try {
    const areas = await db.selectDistinct({ value: vods.area }).from(vods);
    const years = await db.selectDistinct({ value: vods.year }).from(vods);
    const letters = await db.selectDistinct({ value: vods.letter }).from(vods);

    return c.json(response.success({
      areas: areas.map(a => a.value).filter(v => v),
      years: years.map(y => y.value).filter(v => v),
      letters: letters.map(l => l.value).filter(v => v)
    }));
  } catch (error) {
    console.error('filter-options error:', error);
    return c.json(response.success({
      areas: [],
      years: [],
      letters: []
    }));
  }
});

app.get('/search', async (c) => {
  const db = createDatabase(c.env.DB);
  const { keyword, page = '1', pageSize = '20' } = c.req.query();

  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(vods);

  if (keyword) {
    query = query.where(or(
      like(vods.name, `%${keyword}%`),
      like(vods.actor, `%${keyword}%`),
      like(vods.director, `%${keyword}%`),
      like(vods.blurb, `%${keyword}%`)
    ));
  }

  const [totalResult, list] = await Promise.all([
    query.clone().select({ count: count() }),
    query.orderBy(desc(vods.updateTime)).limit(pageSizeNum).offset(offset)
  ]);

  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/sources/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const sources = await db.select().from(vodSources).where(eq(vodSources.vodId, parseInt(id)));

  return c.json(response.success(sources));
});

app.get('/detail-with-sources/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();

  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();

  if (!vod) {
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

app.post('/source/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const body = await c.req.json();

  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();
  if (!vod) {
    return c.json(response.notFound('视频不存在'));
  }

  const result = await db.insert(vodSources).values({
    vodId: parseInt(id),
    name: body.name,
    url: body.url,
    sort: body.sort || 0
  }).returning();

  return c.json(response.success(result[0], '添加成功'));
});

app.put('/source/:id/:sourceId', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id, sourceId } = c.req.param();
  const body = await c.req.json();

  const source = await db.select().from(vodSources)
    .where(and(
      eq(vodSources.vodId, parseInt(id)),
      eq(vodSources.id, parseInt(sourceId))
    )).get();

  if (!source) {
    return c.json(response.notFound('播放源不存在'));
  }

  await db.update(vodSources)
    .set({
      name: body.name,
      url: body.url,
      sort: body.sort,
      updateTime: new Date().toISOString()
    })
    .where(and(
      eq(vodSources.vodId, parseInt(id)),
      eq(vodSources.id, parseInt(sourceId))
    ));

  return c.json(response.success(null, '更新成功'));
});

app.delete('/source/:id/:sourceId', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id, sourceId } = c.req.param();

  const source = await db.select().from(vodSources)
    .where(and(
      eq(vodSources.vodId, parseInt(id)),
      eq(vodSources.id, parseInt(sourceId))
    )).get();

  if (!source) {
    return c.json(response.notFound('播放源不存在'));
  }

  await db.delete(vodSources)
    .where(and(
      eq(vodSources.vodId, parseInt(id)),
      eq(vodSources.id, parseInt(sourceId))
    ));

  return c.json(response.success(null, '删除成功'));
});

app.get('/recommend', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20' } = c.req.query();

  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  const list = await db.select()
    .from(vods)
    .where(and(eq(vods.status, 1), gt(vods.level, 0)))
    .orderBy(desc(vods.level))
    .orderBy(desc(vods.hits))
    .limit(pageSizeNum)
    .offset(offset);

  return c.json(response.success(list));
});

app.get('/hot', async (c) => {
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

/**
 * 调试接口：返回视频的原始数据库记录以及关联的播放源信息。
 * 用于排查前端缺失海报、播放链接等字段的情况。
 */
app.get('/debug/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const vid = parseInt(id);
  const vod = await db.select().from(vods).where(eq(vods.id, vid)).get();
  if (!vod) return c.json(response.notFound('视频不存在'));
  const sources = await db.select().from(vodSources).where(eq(vodSources.vodId, vid)).all();
  return c.json(response.success({ vod, sources }));
});

export default app;
