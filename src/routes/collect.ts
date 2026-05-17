import { Hono } from 'hono';
import { eq, like, count, and, desc, or } from 'drizzle-orm';
import { Env } from '../types/env';
import { collectTasks, collectTaskLogs, spiderSources, vods, types, vodSources } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

// 采集配置
const DEFAULT_REQ_TIMEOUT = 30000;

// 通用日志中间件
app.use('*', async (c, next) => {
  console.log(`[collect] ${c.req.method} ${c.req.path}`);
  await next();
});

app.get('/list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', name, sourceId, status } = c.req.query();
  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = db.select().from(collectTasks);
  if (name) query = query.where(like(collectTasks.name, `%${name}%`));
  if (sourceId !== undefined && sourceId !== '') {
    query = query.where(eq(collectTasks.sourceId, parseInt(sourceId)));
  }
  if (status !== undefined && status !== '') {
    query = query.where(eq(collectTasks.status, parseInt(status)));
  }

  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(collectTasks),
    query.orderBy(desc(collectTasks.createTime)).limit(pageSizeNum).offset(offset)
  ]);

  // 为每个任务添加爬虫源信息
  const listWithSource = await Promise.all(
    list.map(async (task) => {
      const source = await db.select().from(spiderSources).where(eq(spiderSources.id, task.sourceId)).get();
      return {
        ...task,
        source: source || null
      };
    })
  );

  return c.json(response.success({
    list: listWithSource,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.get('/detail/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const task = await db.select().from(collectTasks).where(eq(collectTasks.id, parseInt(id))).get();
  if (!task) return c.json(response.notFound('采集任务不存在'));
  return c.json(response.success(task));
});

app.post('/create', async (c) => {
  const db = createDatabase(c.env.DB);
  let body;
  try { body = await c.req.json(); } catch (e) { return c.json(response.error('请求体格式错误')); }
  const { name, sourceId, type, schedule, params, status, collectMode } = body;
  
  const source = await db.select().from(spiderSources).where(eq(spiderSources.id, sourceId)).get();
  if (!source) return c.json(response.error('爬虫源不存在'));

  const result = await db.insert(collectTasks).values({
    name,
    sourceId,
    type: type || 2,
    schedule,
    params: typeof params === 'string' ? params : JSON.stringify(params || {}),
    status: status || 0,
    collectMode: collectMode || 2
  }).returning();

  return c.json(response.success(result[0], '创建成功'));
});

app.put('/update/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  let body;
  try { body = await c.req.json(); } catch (e) { return c.json(response.error('请求体格式错误')); }
  const { name, sourceId, type, schedule, params, status } = body;
  
  const numId = parseInt(id);
  const task = await db.select().from(collectTasks).where(eq(collectTasks.id, numId)).get();
  if (!task) return c.json(response.notFound('采集任务不存在'));

  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (sourceId !== undefined) {
    const sid = parseInt(sourceId);
    if (isNaN(sid)) return c.json(response.error('爬虫源 ID 必须为数字'));
    updateData.sourceId = sid;
  }
  if (type !== undefined) updateData.type = type;
  if (schedule !== undefined) updateData.schedule = schedule;
  if (params !== undefined) updateData.params = typeof params === 'string' ? params : JSON.stringify(params || {});
  if (status !== undefined) updateData.status = status;
  updateData.updateTime = new Date().toISOString();

  try {
    await db.update(collectTasks).set(updateData).where(eq(collectTasks.id, numId));
    return c.json(response.success(null, '更新成功'));
  } catch (error) {
    return c.json(response.serverError('更新失败：' + (error as Error).message));
  }
});

app.delete('/delete/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  await db.delete(collectTasks).where(eq(collectTasks.id, parseInt(id)));
  return c.json(response.success(null, '删除成功'));
});

app.post('/execute/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const { categoryId, pageLimit = 5 } = await c.req.json().catch(() => ({}));
  // 根据 Cloudflare Workers 50 个子请求限制，pageLimit 必须限制为 2（每分类 2 页列表）
  // 动态规划策略：pageLimit 越大，分类数越少；pageLimit 越小，分类数越多
  // 公式：分类数 = floor(45 / (pageLimit + 20))
  const MIN_PAGELIMIT = 2;
  const MAX_SAFE_PAGELIMIT = 5; // 最多 5 页，防止分类数为 0
  const effectivePageLimit = (pageLimit && pageLimit >= MIN_PAGELIMIT && pageLimit <= MAX_SAFE_PAGELIMIT) 
    ? pageLimit 
    : (pageLimit && pageLimit > 0 ? MIN_PAGELIMIT : MAX_SAFE_PAGELIMIT);
  
  console.log('[collect/execute] ==================== EXECUTE REQUEST RECEIVED ====================');
  console.log('[collect/execute] Task ID:', id);
  console.log(`[collect/execute] Params - categoryId: ${categoryId}, pageLimit: ${pageLimit} -> effectivePageLimit: ${effectivePageLimit} (min: ${MIN_PAGELIMIT}, dynamic)`);
  
  const taskIdNum = parseInt(id);
  const task = await db.select().from(collectTasks).where(eq(collectTasks.id, taskIdNum)).get();
  
  if (!task) {
    console.error('[collect/execute] Task not found:', id);
    return c.json(response.notFound('采集任务不存在'));
  }
  
  const source = await db.select().from(spiderSources).where(eq(spiderSources.id, task.sourceId)).get();
  
  if (!source) {
    console.error('[collect/execute] Source not found for task:', id);
    return c.json(response.error('采集源不存在'));
  }
  
  console.log(`[collect/execute] Starting collection: task=${task.name}, source=${source.name}`);
  
  const startTime = new Date();
  
  // 执行后清理旧日志，只保留最新的 100 条
  const deleteOldLogsSQL = `
    DELETE FROM ys_collect_task_log 
    WHERE id NOT IN (
      SELECT id FROM ys_collect_task_log 
      ORDER BY create_time DESC 
      LIMIT 100
    )
  `;
  await c.env.DB.prepare(deleteOldLogsSQL).run();
  
  await db.update(collectTasks).set({ 
    status: 1, 
    startTime: startTime.toISOString()
  }).where(eq(collectTasks.id, taskIdNum));
  
  try {
    const result = await collectWithApi(db, source, task, null, effectivePageLimit, startTime, 0, -1, 20, categoryId);
    console.log(`[collect/execute] Collection completed: total=${result.total}, success=${result.success}, failed=${result.failed}`);
    
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    
    await db.update(collectTasks).set({
      status: 2,
      endTime: endTime.toISOString(),
      total: result.total,
      success: result.success,
      failed: result.failed
    }).where(eq(collectTasks.id, taskIdNum));
    
    // 创建执行记录日志
    await db.insert(collectTaskLogs).values({
      taskId: taskIdNum,
      taskName: task.name,
      sourceId: source.id,
      sourceName: source.name,
      taskType: task.type || 1, // 手动执行
      status: 1, // 成功
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration,
      total: result.total || 0,
      success: result.success || 0,
      failed: result.failed || 0,
      createTime: endTime.toISOString(),
      updateTime: new Date().toISOString()
    });
    
    console.log(`[collect/execute] Execution log created successfully`);
    
    return c.json(response.success({ 
      total: result.total, 
      success: result.success, 
      failed: result.failed 
    }, '采集完成'));
  } catch (error) {
    console.error('[collect/execute] Collection error:', error);
    const endTime = new Date();
    const errorMsg = String(error);
    
    await db.update(collectTasks).set({
      status: 3,
      endTime: endTime.toISOString(),
      errorLog: errorMsg
    }).where(eq(collectTasks.id, taskIdNum));
    
    // 创建失败执行记录日志
    await db.insert(collectTaskLogs).values({
      taskId: taskIdNum,
      taskName: task.name,
      sourceId: source.id,
      sourceName: source.name,
      taskType: task.type || 1, // 手动执行
      status: 2, // 失败
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: 0,
      total: 0,
      success: 0,
      failed: 0,
      errorLog: errorMsg,
      createTime: endTime.toISOString(),
      updateTime: new Date().toISOString()
    });
    
    console.log(`[collect/execute] Failed execution log created`);
    
    return c.json(response.error(`采集失败: ${errorMsg}`));
  }
});

// 调试接口：直接执行一次采集并返回结果（仅用于调试）
app.post('/debug-collect/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const task = await db.select().from(collectTasks).where(eq(collectTasks.id, parseInt(id))).get();
  if (!task) return c.json(response.notFound('采集任务不存在'));
  const source = await db.select().from(spiderSources).where(eq(spiderSources.id, task.sourceId)).get();
  if (!source) return c.json(response.error('爬虫源不存在'));
  // 直接调用同步采集函数（不走异步 setTimeout）
  try {
    const result = await collectWithApi(db, source, task, null, 5, new Date(), 0, -1, 20, null);
    return c.json(response.success(result));
  } catch (e) {
    console.error('debug-collect error:', e);
    return c.json(response.serverError('调试采集失败'));
  }
});

app.post('/stop/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  
  console.log('[collect/stop] Stopping task:', id);
  
  const numId = parseInt(id);
  const task = await db.select().from(collectTasks).where(eq(collectTasks.id, numId)).get();
  if (!task) return c.json(response.notFound('采集任务不存在'));
  
  const result = await db.update(collectTasks).set({
    status: 4,
    endTime: new Date().toISOString(),
    errorLog: '任务已停止'
  }).where(eq(collectTasks.id, numId)).returning();
  
  return c.json(response.success(result[0], '任务已停止'));
});

app.get('/logs/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  
  console.log('[collect/logs] Getting logs for task:', id);
  
  const numId = parseInt(id);
  const logs = await db.select().from(collectTaskLogs).where(eq(collectTaskLogs.taskId, numId)).orderBy(desc(collectTaskLogs.createTime)).all();
  
  return c.json(response.success(logs));
});

async function executeCollectionAsync(db: any, env: any, task: any, source: any, categoryId: string | null, pageLimit: number) {
  const startTime = new Date();
  let total = 0;
  let success = 0;
  let failed = 0;
  const taskId = task.id;
  
  try {
    const params = task.params ? JSON.parse(task.params) : {};
    const effectivePageLimit = pageLimit || params.pageLimit || (task.type === 1 ? 0 : 5);
    
    console.log(`[collect/executeAsync] Start collection: source=${source.name}, type=${source.type}, pageLimit=${effectivePageLimit}`);
    
    if (source.apiHost || source.script) {
      console.log(`[collect/executeAsync] Starting collectWithApi...`);
      const result = await collectWithApi(
        db, source, task, null, effectivePageLimit, startTime, 0, -1, 20, categoryId
      );
      console.log(`[collect/executeAsync] collectWithApi completed, result:`, result);
      total = result.total || 0;
      success = result.success || 0;
      failed = result.failed || 0;
    } else {
      throw new Error('采集源未配置 API 地址或脚本');
    }
    
    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    
    console.log(`[collect/executeAsync] Completed: total=${total}, success=${success}, failed=${failed}, duration=${duration}s`);
    
    await db.update(collectTasks).set({
      status: 2,
      endTime: endTime.toISOString(),
      total,
      success,
      failed
    }).where(eq(collectTasks.id, taskId));
    
    await db.insert(collectTaskLogs).values({
      taskId,
      taskName: task.name,
      sourceId: source.id,
      sourceName: source.name,
      taskType: task.type,
      status: 1, // 成功
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration,
      total,
      success,
      failed,
      createTime: endTime.toISOString(),
      updateTime: new Date().toISOString()
    });
    
    // 执行后清理旧日志，只保留最新的 100 条
    const deleteOldLogsSQL = `
      DELETE FROM ys_collect_task_log 
      WHERE id NOT IN (
        SELECT id FROM ys_collect_task_log 
        ORDER BY create_time DESC 
        LIMIT 100
      )
    `;
    await env.DB.prepare(deleteOldLogsSQL).run();
    
    await db.update(spiderSources).set({
      lastCollectTime: endTime.toISOString(),
      collectCount: (source.collectCount || 0) + total,
      successCount: (source.successCount || 0) + success,
      failCount: (source.failCount || 0) + failed
    }).where(eq(spiderSources.id, source.id));
    
  } catch (error) {
    console.error(`[collect/executeAsync] Failed:`, error);
    console.error(`[collect/executeAsync] Stack:`, (error as Error).stack);
    const endTime = new Date();
    const errorMsg = `采集失败：${(error as Error).message}`;
    
    await db.update(collectTasks).set({
      status: 3,
      endTime: endTime.toISOString(),
      errorLog: errorMsg
    }).where(eq(collectTasks.id, taskId));
    
    await db.insert(collectTaskLogs).values({
      taskId,
      taskName: task.name,
      sourceId: source.id,
      sourceName: source.name,
      taskType: task.type,
      status: 2, // 失败
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: 0,
      total: 0,
      success: 0,
      failed: 0,
      errorLog: errorMsg,
      createTime: endTime.toISOString(),
      updateTime: new Date().toISOString()
    });
    
    // 执行后清理旧日志，只保留最新的 100 条
    const deleteOldLogsSQL = `
      DELETE FROM ys_collect_task_log 
      WHERE id NOT IN (
        SELECT id FROM ys_collect_task_log 
        ORDER BY create_time DESC 
        LIMIT 100
      )
    `;
    await env.DB.prepare(deleteOldLogsSQL).run();
  }
}

function parseApiData(apiData: any): any[] {
  if (!apiData) return [];
  
  if (Array.isArray(apiData)) {
    return apiData;
  }
  
  const possibleFields = [
    'list', 'data', 'tsid', 'jsonlist', 'sb', 'catlist', 'menu',
    'filterdata', 'types', 'types_data'
  ];
  
  for (const field of possibleFields) {
    if (apiData[field] && Array.isArray(apiData[field])) {
      return apiData[field];
    }
  }
  
  if (apiData.obj && Array.isArray(apiData.obj)) {
    return apiData.obj;
  }
  
  if (apiData.msg && Array.isArray(apiData.msg)) {
    return apiData.msg;
  }
  
  return [];
}

function parseVodData(item: any): any {
  if (typeof item === 'string') {
    try {
      item = JSON.parse(item);
    } catch {
      return { name: '', playUrl: '', sourceVodId: '' };
    }
  }
  
  const vod: any = {
    name: item.name || item.typename || item.type || item.typenew || '',
    subName: item.sub_name || item.type_nick || '',
    enName: item.en_name || item.type_en || '',
    letter: item.letter || '',
    color: item.color || '',
    typeId: item.type_id || 0,
    typeId1: item.type_id1 || 0,
    status: item.status || 1,
    pic: item.pic || item.vod_pic || item.img || '',
    picThumb: item.pic_thumb || '',
    picSlide: item.pic_slide || '',
    blurb: item.blurb || item.type_blurb || item.remarks || item.type_remarks || '',
    tag: item.type_tag || item.vod_tag || '',
    class: item.type_class || item.vod_class || '',
    area: item.type_area || item.vod_area || '',
    lang: item.type_lang || item.vod_lang || '',
    year: item.type_year || item.vod_year || '',
    version: item.type_version || item.vod_version || '',
    director: item.type_director || item.vod_director || '',
    state: item.type_state || item.vod_state || '',
    note: item.note || item.vod_note || '',
    actor: item.actor || item.vod_actor || '',
    content: item.content || item.vod_content || '',
    script: item.script || item.vod_script || '',
    playDirective: item.play_director || item.vod_play_director || '',
    sourceVodId: item.id ? String(item.id) : 
                  item.type_id ? String(item.type_id) : 
                  (item.name ? stringToId(item.name) : ''),
    playUrl: '',
    playFrom: item.type_name || item.vod_name || 'default',
    playServer: item.type_server || item.vod_server || 'default',
    playUrl2: item.play_url2 || item.vod_play_url2 || ''
  };
  
  if (!vod.playUrl || vod.playUrl.trim() === '') {
    if (item.vod_play_url) vod.playUrl = item.vod_play_url;
    else if (item.play_url) vod.playUrl = item.play_url;
    else if (item.urls) vod.playUrl = item.urls;
    else if (item.url) vod.playUrl = item.url;
    else vod.playUrl = '';
  }
  
  vod.normalizedName = vod.name.toLowerCase().replace(/\s+/g, '');
  
  return vod;
}

function stringToId(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString();
}

async function collectWithApi(
  db: any,
  source: any,
  task: any,
  cache: KVNamespace | null,
  pageLimit: number,
  startTime: Date,
  startCategoryIndex: number = 0,
  categoriesToProcess: number = -1,
  minDetailPerCategory: number = 20,
  categoryId: string | null = null,
  abortCheck?: () => Promise<void>
) {
  console.log(`[collectWithApi] Start collection with API mode`);
  console.log(`[collectWithApi] Batch mode: startIndex=${startCategoryIndex}, processCount=${categoriesToProcess}, minDetail=${minDetailPerCategory}`);
  
  let total = 0;
  let success = 0;
  let failed = 0;
  
  // ========== 核心参数配置（Cloudflare Workers 优化策略）==========
  // Cloudflare Workers 子请求限制：50 个（硬性限制，无法通过延迟重置）
  const MAX_SUBREQUESTS = 50;
  const RESERVE_REQUESTS = 2; // 预留 2 个用于数据库操作
  const AVAILABLE_REQUESTS = MAX_SUBREQUESTS - RESERVE_REQUESTS; // 实际可用：48 个
  
  // 数据完整性硬性要求（必须满足）
  const MIN_DETAIL_PER_CATEGORY = 20; // 每个分类最少采集 20 个详情（硬性要求，不可妥协）
  const MIN_PAGES_PER_CATEGORY = 1; // 优化：每分类最少 1 页列表（减少列表开销）
  
  // 可配置参数（从前端获取）
  const REQUESTED_PAGES = pageLimit || MIN_PAGES_PER_CATEGORY;
  const PAGES_PER_CATEGORY = Math.max(MIN_PAGES_PER_CATEGORY, REQUESTED_PAGES);
  
  // 动态计算逻辑：优先保证每个分类最少 20 个详情
  // 公式：总子请求 = 分类数 x (列表页数 + 详情数) <= 48
  // 优化：手动设置每批次分类数为 3（平衡速度和限制）
  const COST_PER_CATEGORY = PAGES_PER_CATEGORY + MIN_DETAIL_PER_CATEGORY;
  const CATEGORIES_PER_BATCH = 10; // 每批次处理 10 个分类（优化后）
  
  // 批次控制参数（严格遵守）
  const BATCH_SIZE = 10; // 每批并发请求数
  const BATCH_DELAY_MS = 500; // 批次之间的延迟（0.5 秒）
  const CATEGORY_DELAY_MS = 1000; // 分类间延迟（1 秒）
  const INTER_BATCH_DELAY_MS = 500; // 分类批次之间的延迟（0.5 秒）
  
  console.log(`[collectWithApi] ====== CLOUDFLARE WORKERS 采集优化策略 ======`);
  console.log(`[collectWithApi] 🔒 环境限制: MAX_SUBREQUESTS=${MAX_SUBREQUESTS}, RESERVE_REQUESTS=${RESERVE_REQUESTS}, AVAILABLE_REQUESTS=${AVAILABLE_REQUESTS}`);
  console.log(`[collectWithApi] ✅ 硬性要求: MIN_DETAIL_PER_CATEGORY=${MIN_DETAIL_PER_CATEGORY}个详情/分类（不可妥协）`);
  console.log(`[collectWithApi] 📄 列表配置: PAGES_PER_CATEGORY=${PAGES_PER_CATEGORY} (requested: ${pageLimit})`);
  console.log(`[collectWithApi] 🔢 计算过程:`);
  console.log(`[collectWithApi]   - 每分类开销: ${COST_PER_CATEGORY} = ${PAGES_PER_CATEGORY}(列表) + ${MIN_DETAIL_PER_CATEGORY}(详情)`);
  console.log(`[collectWithApi]   - 每批次分类数: ${CATEGORIES_PER_BATCH} 个分类`);
  console.log(`[collectWithApi] ⏱️  批次控制: BATCH_SIZE=${BATCH_SIZE}, BATCH_DELAY=${BATCH_DELAY_MS}ms, CATEGORY_DELAY=${CATEGORY_DELAY_MS}ms, INTER_BATCH_DELAY=${INTER_BATCH_DELAY_MS}ms`);
  console.log(`[collectWithApi] =============================================`);
  // ========== 参数配置结束 ==========
  
  // 优先从 script 字段中提取 API 配置
  let apiHost = source.apiHost?.replace(/\/$/, '');
  const script = source.script;
  
  console.log(`[collectWithApi] Source script length: ${script ? script.length : 0}`);
  
  // 尝试从 JS 脚本中提取 API 地址
  if (script) {
    // 优先匹配 API_URL_PRIMARY
    const apiUrlMatch = script.match(/const\s+API_URL_PRIMARY\s*=\s*['"]([^'"]+)['"]/);
    if (apiUrlMatch) {
      apiHost = apiUrlMatch[1].replace(/\/$/, '');
      console.log(`[collectWithApi] Extracted API_URL_PRIMARY from script: ${apiHost}`);
    } else {
      // 尝试匹配 API_HOST_PRIMARY
      const apiHostMatch = script.match(/const\s+API_HOST_PRIMARY\s*=\s*['"]([^'"]+)['"]/);
      if (apiHostMatch) {
        apiHost = apiHostMatch[1].replace(/\/$/, '');
        console.log(`[collectWithApi] Extracted API_HOST_PRIMARY from script: ${apiHost}`);
      } else {
        // 尝试匹配 API_URL（去掉路径，只保留域名）
        const apiUrlSimpleMatch = script.match(/const\s+API_URL\s*=\s*['"]([^'"]+)['"]/);
        if (apiUrlSimpleMatch) {
          let apiUrl = apiUrlSimpleMatch[1];
          // 保留完整的 API 路径，不要只提取域名
          apiHost = apiUrl.replace(/\/$/, '');
          console.log(`[collectWithApi] Extracted full API_URL from script: ${apiHost}`);
        } else {
          // 尝试匹配 API_HOST
          const apiHostSimpleMatch = script.match(/const\s+API_HOST\s*=\s*['"]([^'"]+)['"]/);
          if (apiHostSimpleMatch) {
            apiHost = apiHostSimpleMatch[1].replace(/\/$/, '');
            console.log(`[collectWithApi] Extracted API_HOST from script: ${apiHost}`);
          }
        }
      }
    }
  }
  
  console.log(`[collectWithApi] Final apiHost: ${apiHost}`);
  
  if (!apiHost) {
    console.error('[collectWithApi] Error: No API host configured!');
    throw new Error('采集源未配置 API 地址');
  }
  
  const config = source.config ? JSON.parse(source.config) : {};
  
  const imdbTypes = config.imdbTypes || {};
  const typeMapping = new Map<string, number>();
  
  console.log(`[collectWithApi] Source config:`, { apiHost, imdbTypes: Object.keys(imdbTypes) });
  
  // 获取本地分类
  const categories = await db.select().from(types).where(eq(types.status, 1));
  console.log(`[collectWithApi] Found ${categories.length} local categories`);
  
  // 获取或创建未知分类作为 fallback
  let unknownCategory = categories.find(cat => 
    cat.name === '未知' || cat.name === '其他' || cat.enName === 'unknown'
  );
  
  if (!unknownCategory) {
    try {
      const newCategory = await db.insert(types).values({
        name: '未知',
        enName: 'unknown',
        parentId: 0,
        sort: 999,
        status: 1,
        type: 1,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString()
      }).returning();
      
      if (newCategory && newCategory.length > 0) {
        unknownCategory = newCategory[0];
        console.log(`[collectWithApi] Created unknown category:`, unknownCategory);
      }
    } catch (e) {
      console.error(`[collectWithApi] Failed to create unknown category:`, e);
    }
  }
  
  // 如果仍然没有未知分类，使用第一个分类
  const fallbackCategory = unknownCategory || (categories.length > 0 ? categories[0] : null);
  if (!fallbackCategory) {
    console.error(`[collectWithApi] No categories available for fallback!`);
    return { total: 0, success: 0, failed: 1 };
  }
  
  // 第一步：先请求首页获取源分类列表
  let sourceCategories: any[] = [];
  try {
    const homeUrl = `${apiHost}?ac=list&pg=1`;
    console.log(`[collectWithApi] Fetching home page to get categories: ${homeUrl}`);
    
    const homeResp = await fetch(homeUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(DEFAULT_REQ_TIMEOUT)
    });
    
    if (homeResp.ok) {
      const homeData = await homeResp.json();
      if (homeData.class && Array.isArray(homeData.class)) {
        sourceCategories = homeData.class;
        console.log(`[collectWithApi] Got ${sourceCategories.length} source categories from home page`);
      }
    }
  } catch (e) {
    console.error(`[collectWithApi] Failed to fetch home categories:`, e);
  }
  
  // 建立分类映射
  console.log(`[collectWithApi] categoryId param: ${categoryId}`);
  console.log(`[collectWithApi] sourceCategories from API:`, sourceCategories.map(c => ({type_id: c.type_id, type_name: c.type_name})));
  console.log(`[collectWithApi] local categories:`, categories.map(c => ({id: c.id, name: c.name, enName: c.enName})));
  console.log(`[collectWithApi] imdbTypes config:`, imdbTypes);
  
  if (categoryId) {
    const targetCategory = categories.find(cat => 
      cat.enName === categoryId || cat.id === parseInt(categoryId)
    );
    
    if (targetCategory) {
      const sourceTypeId = String(imdbTypes[targetCategory.enName] || imdbTypes[targetCategory.name] || targetCategory.id);
      typeMapping.set(sourceTypeId, targetCategory.id);
      console.log(`[collectWithApi] Category filter: ${sourceTypeId} -> ${targetCategory.name}`);
    } else {
      console.log(`[collectWithApi] Target category not found for categoryId: ${categoryId}`);
    }
  } else {
    // 使用从首页获取到的源分类，结合本地分类建立映射
    if (sourceCategories.length > 0) {
      let processedCount = 0;
      for (const sourceCat of sourceCategories) {
        const sourceTypeId = String(sourceCat.type_id);
        console.log(`[collectWithApi] Processing source category (${processedCount + 1}/${sourceCategories.length}): type_id=${sourceTypeId}, type_name=${sourceCat.type_name}`);
        
        // 尝试找到匹配的本地分类
        let targetCategory = categories.find(cat => 
          String(imdbTypes[cat.enName]) === sourceTypeId || 
          String(imdbTypes[cat.name]) === sourceTypeId ||
          cat.name === sourceCat.type_name ||
          String(cat.id) === sourceTypeId
        );
        
        // 如果精确匹配失败，尝试模糊匹配
        if (!targetCategory) {
          targetCategory = categories.find(cat => 
            sourceCat.type_name.includes(cat.name) || 
            cat.name.includes(sourceCat.type_name)
          );
        }
        
        if (targetCategory) {
          typeMapping.set(sourceTypeId, targetCategory.id);
          console.log(`[collectWithApi] ✓ Mapping found: ${sourceCat.type_name}(${sourceTypeId}) -> ${targetCategory.name}`);
          processedCount++;
        } else {
          // 如果找不到对应本地分类，使用未知分类作为 fallback
          typeMapping.set(sourceTypeId, fallbackCategory.id);
          console.log(`[collectWithApi] ⚠️ No mapping found, using fallback: ${sourceCat.type_name}(${sourceTypeId}) -> ${fallbackCategory.name}`);
          processedCount++;
        }
      }
    } else {
      // 如果没有获取到源分类，继续使用旧逻辑
      console.log(`[collectWithApi] No source categories from API, using local categories`);
      for (const cat of categories) {
        const sourceTypeId = String(imdbTypes[cat.enName] || imdbTypes[cat.name] || cat.id);
        typeMapping.set(sourceTypeId, cat.id);
        console.log(`[collectWithApi] Mapping local category: ${cat.name} -> sourceTypeId ${sourceTypeId}`);
      }
    }
  }
  
  if (typeMapping.size === 0) {
    console.error(`[collectWithApi] No categories to collect!`);
    return { total: 0, success: 0, failed: 1 };
  }
  
  console.log(`[collectWithApi] Starting collection: ${typeMapping.size} categories, ${PAGES_PER_CATEGORY} pages each`);
  
  // 延迟函数
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // 第一步：分批次获取所有分类的列表数据
  const itemsByCategory = new Map<string, any[]>(); // key: sourceTypeId, value: items
  
  console.log(`[collectWithApi] Starting list collection with ${typeMapping.size} categories`);
  
  // 请求计数器（用于监控 Cloudflare Workers 子请求限制）
  let listRequestCount = 0;   // 列表请求计数
  let detailRequestCount = 0; // 详情请求计数
  let totalSubRequests = 0;   // 总子请求数
  const categoryArray = Array.from(typeMapping.entries());
  
  // 子请求监控函数（严格控制 Cloudflare Workers 50 个子请求限制）
  const checkSubrequestLimit = (additionalRequests: number = 0) => {
    const projectedTotal = totalSubRequests + additionalRequests;
    if (projectedTotal >= AVAILABLE_REQUESTS) {
      console.warn(`[collectWithApi] ⚠️ SUBREQUEST LIMIT WARNING! Current: ${totalSubRequests}, Projected: ${projectedTotal}, Available: ${AVAILABLE_REQUESTS}`);
      console.warn(`[collectWithApi] ⚠️ Maximum allowed subrequests exceeded, stopping collection to avoid Cloudflare blocking`);
      return true;
    }
    return false;
  };
  
  const incrementSubRequests = (count: number) => {
    totalSubRequests += count;
    const usagePercent = Math.round((totalSubRequests / MAX_SUBREQUESTS) * 100);
    console.log(`[collectWithApi] 📊 Subrequest usage: ${totalSubRequests}/${MAX_SUBREQUESTS} (${usagePercent}%) [list: ${listRequestCount}, detail: ${detailRequestCount}]`);
    
    // 超过 80% 时发出警告
    if (totalSubRequests >= MAX_SUBREQUESTS * 0.8) {
      console.warn(`[collectWithApi] ⚠️ Subrequest usage exceeds 80%: ${totalSubRequests}/${MAX_SUBREQUESTS}`);
    }
  };
  
  // 批次执行函数（确保严格的批次控制）
  const executeInBatches = async <T>(
    items: T[],
    batchSize: number,
    delayMs: number,
    processor: (item: T, index: number) => Promise<void>
  ) => {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    
    console.log(`[collectWithApi] 🔄 Preparing ${batches.length} batches (${batchSize} items/batch, delay: ${delayMs}ms)`);
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[collectWithApi] 📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} items)`);
      
      await Promise.all(batch.map((item, idx) => processor(item, batchIndex * batchSize + idx)));
      
      // 最后一批不需要延迟
      if (batchIndex < batches.length - 1) {
        console.log(`[collectWithApi] ⏳ Batch ${batchIndex + 1} completed, waiting ${delayMs}ms before next batch...`);
        await delay(delayMs);
      }
    }
  };
  
  const totalCategories = categoryArray.length;
  
  const actualStartIndex = startCategoryIndex;
  const maxCategoriesPerBatch = 1; // Cloudflare 限制：每批次最多处理1个分类
  const actualProcessCount = categoriesToProcess === -1 ? Math.min(maxCategoriesPerBatch, totalCategories - actualStartIndex) : categoriesToProcess;
  const endIndex = Math.min(actualStartIndex + actualProcessCount, totalCategories);
  
  console.log(`[collectWithApi] 🔄 Batch processing: categories ${actualStartIndex + 1}-${endIndex} of ${totalCategories}`);
  
  let allCategoriesProcessed = false;
  if (actualStartIndex >= totalCategories) {
    console.log(`[collectWithApi] All categories processed! Resetting to start`);
    allCategoriesProcessed = true;
    return { total: 0, success: 0, failed: 0, allCategoriesProcessed };
  }
  
  // 重置子请求计数器（单批次处理）
  listRequestCount = 0;
  detailRequestCount = 0;
  totalSubRequests = 0;
  
  for (let categoryIdx = actualStartIndex; categoryIdx < endIndex; categoryIdx++) {
    if (abortCheck) await abortCheck();
    
    const [sourceTypeId, targetTypeId] = categoryArray[categoryIdx];
    console.log(`[collectWithApi] Processing category (${categoryIdx + 1}/${totalCategories}, batch: ${categoryIdx - actualStartIndex + 1}/${actualProcessCount}): ${sourceTypeId} -> ${targetTypeId}`);
    
    const categoryItems: any[] = [];
    let pagesFetched = 0;
    let itemsNeeded = minDetailPerCategory;
    
    let subCategories: number[] = [];
    
    while (categoryItems.length < itemsNeeded && pagesFetched < PAGES_PER_CATEGORY) {
      pagesFetched++;
      
      if (abortCheck) await abortCheck();
      
      listRequestCount++;
      incrementSubRequests(1);
      
      if (checkSubrequestLimit()) {
        console.warn(`[collectWithApi] Subrequest limit approaching, stopping list collection`);
        break;
      }
      
      if (listRequestCount > 1 && (listRequestCount - 1) % BATCH_SIZE === 0) {
        console.log(`[collectWithApi] List batch completed (${listRequestCount - 1} requests), waiting ${BATCH_DELAY_MS}ms...`);
        await delay(BATCH_DELAY_MS);
      }
      
      try {
        const apiUrl = `${apiHost}?ac=list&t=${sourceTypeId}&pg=${pagesFetched}`;
        console.log(`[collectWithApi] Fetch list (${listRequestCount}): ${apiUrl}`);
        
        const resp = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(DEFAULT_REQ_TIMEOUT)
        });
        
        if (!resp.ok) {
          console.error(`[collectWithApi] List failed: ${resp.status}`);
          continue;
        }
        
        const apiData = await resp.json();
        
        console.log(`[collectWithApi] API response keys: ${Object.keys(apiData).join(', ')}`);
        
        if (!apiData.list || !Array.isArray(apiData.list) || apiData.list.length === 0) {
          if (apiData.class && Array.isArray(apiData.class) && subCategories.length === 0) {
            subCategories = apiData.class
              .filter((c: any) => Number(c.type_pid) === Number(sourceTypeId))
              .map((c: any) => c.type_id);
            
            console.log(`[collectWithApi] Found ${subCategories.length} subcategories for ${sourceTypeId}: ${subCategories.join(', ')}`);
          }
          
          if (subCategories.length > 0) {
            const firstSubCat = subCategories.shift();
            console.log(`[collectWithApi] Switching to subcategory ${firstSubCat} since main category is empty`);
            
            const subCatUrl = `${apiHost}?ac=list&t=${firstSubCat}&pg=1`;
            const subCatResp = await fetch(subCatUrl, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              signal: AbortSignal.timeout(DEFAULT_REQ_TIMEOUT)
            });
            
            if (subCatResp.ok) {
              const subCatData = await subCatResp.json();
              console.log(`[collectWithApi] Subcategory ${firstSubCat} response keys: ${Object.keys(subCatData).join(', ')}`);
              
              if (subCatData.list && Array.isArray(subCatData.list) && subCatData.list.length > 0) {
                for (const item of subCatData.list) {
                  const itemId = item.vod_id || item.id || item.vodId;
                  if (itemId && categoryItems.length < itemsNeeded) {
                    categoryItems.push({ ...item, targetTypeId, vod_id: itemId });
                  }
                }
                console.log(`[collectWithApi] Got ${subCatData.list.length} items from subcategory ${firstSubCat}`);
              }
            }
          }
          
          continue;
        }
        
        for (const item of apiData.list) {
          const itemId = item.vod_id || item.id || item.vodId;
          if (itemId && categoryItems.length < itemsNeeded) {
            categoryItems.push({ ...item, targetTypeId, vod_id: itemId });
          }
        }
        
        console.log(`[collectWithApi] Category ${sourceTypeId} page ${pagesFetched}: Got ${apiData.list.length} items, category total: ${categoryItems.length}`);
        
      } catch (e) {
        console.error(`[collectWithApi] List error for category ${sourceTypeId}:`, e);
        break;
      }
    }
    
    if (categoryItems.length === 0 && subCategories.length > 0) {
      console.log(`[collectWithApi] Trying remaining subcategories: ${subCategories.join(', ')}`);
      
      for (const subCatId of subCategories) {
        if (categoryItems.length >= itemsNeeded) break;
        
        listRequestCount++;
        incrementSubRequests(1);
        
        try {
          const subCatUrl = `${apiHost}?ac=list&t=${subCatId}&pg=1`;
          console.log(`[collectWithApi] Fetch from subcategory: ${subCatUrl}`);
          
          const resp = await fetch(subCatUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: AbortSignal.timeout(DEFAULT_REQ_TIMEOUT)
          });
          
          if (resp.ok) {
            const apiData = await resp.json();
            if (apiData.list && Array.isArray(apiData.list) && apiData.list.length > 0) {
              for (const item of apiData.list) {
                const itemId = item.vod_id || item.id || item.vodId;
                if (itemId && categoryItems.length < itemsNeeded) {
                  categoryItems.push({ ...item, targetTypeId, vod_id: itemId });
                }
              }
              console.log(`[collectWithApi] Got ${apiData.list.length} items from subcategory ${subCatId}`);
            }
          }
        } catch (e) {
          console.error(`[collectWithApi] Error fetching subcategory ${subCatId}:`, e);
        }
      }
    }
    
    if (categoryItems.length > 0) {
      itemsByCategory.set(sourceTypeId, categoryItems);
      console.log(`[collectWithApi] Category ${sourceTypeId} collected ${categoryItems.length} items`);
    }
    
    // 分类间延迟（已设为0秒，快速处理）
    if (CATEGORY_DELAY_MS > 0) {
      console.log(`[collectWithApi] ⏳ Category ${sourceTypeId} completed, waiting ${CATEGORY_DELAY_MS}ms...`);
      await delay(CATEGORY_DELAY_MS);
    }
  }
  
  console.log(`[collectWithApi] List collection completed. Categories with items: ${itemsByCategory.size}, processed: ${categoriesToProcess}/${totalCategories} categories`);
  
  // 列表和详情之间添加延迟
  console.log(`[collectWithApi] ⏳ Waiting ${BATCH_DELAY_MS}ms before detail collection...`);
  await delay(BATCH_DELAY_MS);
  
  // 第二步：分批次获取详情，确保每个分类最少采集 MIN_DETAIL_PER_CATEGORY 个详情
  const processedItems: any[] = [];
  
  for (const [sourceTypeId, categoryItems] of itemsByCategory) {
    console.log(`[collectWithApi] Processing details for category ${sourceTypeId}, items available: ${categoryItems.length}`);
    
    if (abortCheck) await abortCheck();
    
    const itemsToProcess = categoryItems.slice(0, MIN_DETAIL_PER_CATEGORY);
    console.log(`[collectWithApi] Will process ${itemsToProcess.length} items for this category`);
    
    // 处理这个分类的详情请求
    for (const item of itemsToProcess) {
      if (abortCheck) await abortCheck();
      
      // 检查子请求限制
      if (checkSubrequestLimit()) {
        console.warn(`[collectWithApi] Subrequest limit approaching, stopping detail collection`);
        break;
      }
      
      // 每 BATCH_SIZE 个请求后添加延迟
      if (detailRequestCount > 0 && detailRequestCount % BATCH_SIZE === 0) {
        console.log(`[collectWithApi] Detail batch completed (${detailRequestCount} requests), waiting ${BATCH_DELAY_MS}ms...`);
        await delay(BATCH_DELAY_MS);
      }
      
      detailRequestCount++;
      incrementSubRequests(1);
      
      try {
        const detailUrl = `${apiHost}?ac=videolist&ids=${item.vod_id}`;
        console.log(`[collectWithApi] Fetch detail (${detailRequestCount}): ${detailUrl}`);
          
          const detailResp = await fetch(detailUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: AbortSignal.timeout(15000)
          });
          
          if (detailResp.ok) {
            const detailJson = await detailResp.json();
            console.log(`[collectWithApi] ========== DETAIL API RESPONSE ==========`);
            console.log(`[collectWithApi] Detail response status: ${detailResp.status}`);
            console.log(`[collectWithApi] Detail response keys: ${Object.keys(detailJson).join(', ')}`);
            console.log(`[collectWithApi] Detail response:`, JSON.stringify(detailJson).substring(0, 500));
            
            // 尝试多种可能的数据结构
            let detailData = null;
            let detailSource = ''; // 记录数据来源
            if (detailJson.list && Array.isArray(detailJson.list) && detailJson.list.length > 0) {
              detailData = detailJson.list[0];
              detailSource = 'list';
              console.log(`[collectWithApi] ✓ Found data in 'list' field`);
            } else if (detailJson.data && Array.isArray(detailJson.data) && detailJson.data.length > 0) {
              detailData = detailJson.data[0];
              detailSource = 'data[]';
              console.log(`[collectWithApi] ✓ Found data in 'data' field`);
            } else if (detailJson.tsid && Array.isArray(detailJson.tsid) && detailJson.tsid.length > 0) {
              detailData = detailJson.tsid[0];
              detailSource = 'tsid';
              console.log(`[collectWithApi] ✓ Found data in 'tsid' field`);
            } else if (detailJson.code === 1 && detailJson.data) {
              if (Array.isArray(detailJson.data)) {
                detailData = detailJson.data[0];
              } else {
                detailData = detailJson.data;
              }
              detailSource = 'data object';
              console.log(`[collectWithApi] ✓ Found data in 'data' object`);
            }
            
            if (detailData) {
              console.log(`[collectWithApi] ✓ Detail data found for ${item.vod_id} (source: ${detailSource})`);
              console.log(`[collectWithApi] Detail data keys:`, Object.keys(detailData));
              
              // 详细的字段检查
              const possiblePicFields = ['vod_pic', 'pic', 'img', 'image', 'cover', 'vod_pic_small', 'pic_thumb'];
              const possiblePlayUrlFields = ['vod_play_url', 'play_url', 'urls', 'playurl', 'playUrl'];
              
              for (const field of possiblePicFields) {
                console.log(`[collectWithApi] Checking ${field}: ${detailData[field] !== undefined ? 'found' : 'not found'}, value: ${detailData[field] ? String(detailData[field]).substring(0, 100) : 'undefined/null'}`);
              }
              
              for (const field of possiblePlayUrlFields) {
                console.log(`[collectWithApi] Checking ${field}: ${detailData[field] !== undefined ? 'found' : 'not found'}, value: ${detailData[field] ? String(detailData[field]).substring(0, 200) : 'undefined/null'}`);
              }
              
              // 尝试从多个字段中提取 vod_pic 和 vod_play_url
              if (!detailData.vod_pic) {
                for (const field of possiblePicFields) {
                  if (detailData[field]) {
                    detailData.vod_pic = detailData[field];
                    console.log(`[collectWithApi] ✓ Fallback: set vod_pic from ${field}`);
                    break;
                  }
                }
              }
              
              if (!detailData.vod_play_url) {
                for (const field of possiblePlayUrlFields) {
                  if (detailData[field]) {
                    detailData.vod_play_url = detailData[field];
                    console.log(`[collectWithApi] ✓ Fallback: set vod_play_url from ${field}`);
                    break;
                  }
                }
              }
              
              console.log(`[collectWithApi] After fallback - Has vod_pic: ${!!detailData.vod_pic}, Has vod_play_url: ${!!detailData.vod_play_url}`);
              
              // 基本验证：必须有海报和播放链接（详细过滤在下方进行）
              if (!detailData.vod_pic || !detailData.vod_play_url) {
                console.log(`[collectWithApi] ⚠️ Skipping ${item.vod_id}: missing required fields (vod_pic=${!!detailData.vod_pic}, vod_play_url=${!!detailData.vod_play_url})`);
                // 打印完整数据以便调试
                console.log(`[collectWithApi] Full detailData:`, JSON.stringify(detailData).substring(0, 1000));
                failed++;
                continue;
              }
              
              processedItems.push({ ...detailData, targetTypeId: item.targetTypeId, vod_id: item.vod_id });
            } else {
              console.log(`[collectWithApi] ⚠️ No detail data found for ${item.vod_id}, skipping (no fallback)`);
              failed++;
            }
          } else {
            const text = await detailResp.text();
            console.log(`[collectWithApi] Detail request failed (${detailResp.status}) for ${item.vod_id}: ${text.substring(0, 200)}`);
            failed++;
          }
        } catch (e) {
          console.error(`[collectWithApi] Detail error for ${item.vod_id}:`, e);
          failed++;
        }
      }
    
    // 分类间延迟（已设为0秒，快速处理）
    if (CATEGORY_DELAY_MS > 0) {
      console.log(`[collectWithApi] Category ${sourceTypeId} completed, waiting ${CATEGORY_DELAY_MS}ms before next category...`);
      await delay(CATEGORY_DELAY_MS);
    }
  }
  
  console.log(`[collectWithApi] Detail collection completed. Total detail requests: ${detailRequestCount}, processed items: ${processedItems.length}`);
  console.log(`[collectWithApi] Subrequest usage after detail collection: ${totalSubRequests}/50`);
  
  // 返回最终统计
  console.log(`[collectWithApi] Final statistics: total=${total}, success=${success}, failed=${failed}`);
  console.log(`[collectWithApi] Request breakdown: list=${listRequestCount}, detail=${detailRequestCount}, total subrequests=${totalSubRequests}`);
  
  // 第三步：保存数据
  for (const item of processedItems) {
    const vodData = item;
    const targetTypeId = item.targetTypeId;
          
          // 数据清洗：移除 HTML 标签，清理数据
          const cleanHtml = (str: string | undefined): string => {
            if (!str) return '';
            return str
              .replace(/<[^>]*>/g, '')  // 移除 HTML 标签
              .replace(/&nbsp;/g, ' ')
              .replace(/&/g, '&')
              .replace(/</g, '<')
              .replace(/>/g, '>')
              .replace(/"/g, '"')
              .replace(/'/g, "'")
              .replace(/\s+/g, ' ')
              .trim();
          };
          
          // 根据多可能的字段名称获取影片名称和简介
          const getFirst = (src:any, keys:string[]) => {
            for (const k of keys) {
              if (src && src[k] !== undefined && src[k] !== null && src[k] !== '') {
                return src[k];
              }
            }
            return '';
          };
          // 详细日志：显示 API 返回的所有字段
            console.log(`[collectWithApi] ========== SAVING VOD DATA ==========`);
            console.log(`[collectWithApi] vodData keys:`, Object.keys(vodData));
            console.log(`[collectWithApi] Has vod_pic: ${vodData.vod_pic !== undefined}, value: ${vodData.vod_pic ? 'exists' : 'undefined/null'}`);
            console.log(`[collectWithApi] Has vod_play_url: ${vodData.vod_play_url !== undefined}, value: ${vodData.vod_play_url ? 'exists' : 'undefined/null'}`);
            console.log(`[collectWithApi] Has vod_play_from: ${vodData.vod_play_from !== undefined}, value: ${vodData.vod_play_from || 'undefined/null'}`);
            console.log(`[collectWithApi] vod_pic value:`, vodData.vod_pic);
            console.log(`[collectWithApi] vod_play_url value:`, vodData.vod_play_url);
            console.log(`[collectWithApi] vod_play_from value:`, vodData.vod_play_from);
            
            const vodNameRaw = getFirst(vodData, ['vod_name','title','name','type_name','vod_title']);
            const vodContentRaw = getFirst(vodData, ['vod_content','content','description','intro','detail','summary']);
            const vodName = cleanHtml(vodNameRaw);
            const vodContent = cleanHtml(vodContentRaw);
            const vodPic = vodData.vod_pic || vodData.pic || '';
            const vodPlayUrlRaw = vodData.vod_play_url || vodData.play_url || '';
            
            // 解析播放链接，提取 m3u8 格式
            const parsePlayUrls = (playUrlStr: string): { playUrl: string, playFrom: string } => {
              if (!playUrlStr) return { playUrl: '', playFrom: 'default' };
              
              console.log(`[collectWithApi] Parsing playUrlStr:`, playUrlStr.substring(0, 200));
              
              // 直接使用原始格式保存所有播放链接
              // 格式：第 1 集$链接#第 2 集$链接
              const cleanedPlayUrl = String(playUrlStr).trim();
              
              console.log(`[collectWithApi] Parsed ${cleanedPlayUrl.split('#').length} episodes, keeping all links`);
              
              return {
                playUrl: cleanedPlayUrl,
                playFrom: vodData.vod_play_from || vodPlayFrom || 'default'
              };
            };
            
            const { playUrl, playFrom } = parsePlayUrls(vodPlayUrlRaw);
            
            console.log(`[collectWithApi] vodName="${vodName}", contentLen=${vodContent.length}, finalPlayUrl=${playUrl ? playUrl.length : 0}, pic=${!!vodPic}`);
          
          // ========== 数据采集过滤规则 ==========
          // 1. 过滤年份距今超过 20 年的老旧视频
          const currentYear = new Date().getFullYear();
          // 优先使用 vodData.vod_year，其次使用 item.type_year
          const vodYearStr = vodData.vod_year || item.type_year || item.vod_year || '0';
          const vodYear = parseInt(vodYearStr);
          const minYear = currentYear - 20;
          
          console.log(`[collectWithApi] 📅 Year check: vodYearStr="${vodYearStr}", vodYear=${vodYear}, currentYear=${currentYear}, minYear=${minYear}`);
          
          // 年份过滤：年份必须有效且在 20 年内，特殊情况：vodYear=0 或 vodYear 未设置时不跳过（允许数据采集）
          if (vodYear && vodYear > 0 && vodYear < minYear) {
            console.log(`[collectWithApi] ⚠️ Filtering out old video: ${vodName} (year=${vodYear}, minYear=${minYear}, filtered because older than 20 years)`);
            failed++;
            continue;
          }
          
          // 2. 过滤无名称的视频
          if (!vodName || vodName.trim() === '') {
            console.log(`[collectWithApi] ⚠️ Filtering out video with no name`);
            failed++;
            continue;
          }
          
          // 3. 过滤无封面的视频
          if (!vodPic || vodPic.trim() === '') {
            console.log(`[collectWithApi] ⚠️ Filtering out video with no cover (vod_pic)`);
            failed++;
            continue;
          }
          
          // 4. 过滤无播放地址的视频
          if (!playUrl || playUrl.trim() === '') {
            console.log(`[collectWithApi] ⚠️ Filtering out video with no playUrl`);
            failed++;
            continue;
          }
          
          // 5. 过滤无播放源的视频
          if (!playFrom || playFrom.trim() === '') {
            console.log(`[collectWithApi] ⚠️ Filtering out video with no playFrom`);
            failed++;
            continue;
          }
          
          console.log(`[collectWithApi] ✅ Video passed all filters: ${vodName}, year=${vodYear || 'unknown'}, hasPic=${!!vodPic}, hasPlayUrl=${!!playUrl}, hasPlayFrom=${!!playFrom}`);
          
          try {
            let existingVod = null;
            
            // 优先通过 sourceVodId 查找已存在的记录
            if (item.vod_id && item.vod_id !== 'undefined') {
              existingVod = await db.select().from(vods)
                .where(eq(vods.sourceVodId, String(item.vod_id)))
                .get();
            }
            
            // 如果没有找到，尝试通过名称和来源查找
            if (!existingVod && vodName && vodName.trim()) {
              existingVod = await db.select().from(vods)
                .where(and(
                  eq(vods.sourceId, source.id),
                  eq(vods.name, vodName)
                ))
                .get();
            }
            
            // 获取完整的原始播放链接用于保存
            const rawPlayUrl = vodData.vod_play_url || item.vod_play_url || '';
            const rawPlayFrom = vodData.vod_play_from || item.vod_play_from || 'default';
            // 使用解析后的播放信息，优先保存有效的 m3u8 链接
            const { playUrl: parsedPlayUrl, playFrom: parsedPlayFrom } = parsePlayUrls(vodPlayUrlRaw);
            
            const insertData = {
              name: vodName,
              subName: cleanHtml(vodData.vod_sub_name || item.vod_sub_name || ''),
              enName: cleanHtml(vodData.vod_en || item.vod_en || ''),
              typeId: targetTypeId,
              pic: vodData.vod_pic || item.vod_pic || '',
              actor: cleanHtml(vodData.vod_actor || item.vod_actor || ''),
              director: cleanHtml(vodData.vod_director || item.vod_director || ''),
              content: vodContent,
              remarks: cleanHtml(vodData.vod_remarks || item.vod_remarks || ''),
              year: vodData.vod_year || item.vod_year || '',
              area: cleanHtml(vodData.vod_area || item.vod_area || ''),
              lang: cleanHtml(vodData.vod_lang || item.vod_lang || ''),
              // 若解析得到有效的播放链接则使用，否则回退至原始链接
              playFrom: parsedPlayUrl ? parsedPlayFrom : rawPlayFrom,
              playUrl: parsedPlayUrl || rawPlayUrl,
              sourceId: source.id,
              sourceVodId: String(item.vod_id || ''),
              updateTime: new Date().toISOString(),
              collectTime: new Date().toISOString()
            };
            
            console.log(`[collectWithApi] Processing vod: ${insertData.name}, sourceVodId: ${insertData.sourceVodId}, playUrl length: ${insertData.playUrl ? insertData.playUrl.length : 0}`);
            
            // 数据已在上方完成验证，这里不再重复检查
            
            if (task && task.type === 1 && existingVod) {
              console.log(`[collectWithApi] Skip existing vod (incremental): ${insertData.name}`);
              continue;
            }
            
            let vodId: number;
            
            if (existingVod) {
              console.log(`[collectWithApi] Updating existing vod: ${insertData.name} (id=${existingVod.id})`);
              await db.update(vods).set({
                name: insertData.name,
                subName: insertData.subName,
                enName: insertData.enName,
                typeId: insertData.typeId,
                pic: insertData.pic,
                actor: insertData.actor,
                director: insertData.director,
                content: insertData.content,
                remarks: insertData.remarks,
                year: insertData.year,
                area: insertData.area,
                lang: insertData.lang,
                playFrom: insertData.playFrom,
                playUrl: insertData.playUrl,
                updateTime: new Date().toISOString(),
                collectTime: new Date().toISOString()
              }).where(eq(vods.id, existingVod.id));
              
              vodId = existingVod.id;
              success++;
            } else {
              console.log(`[collectWithApi] Creating new vod: ${insertData.name}`);
              insertData.status = 1;
              insertData.level = 0;
              const [newVod] = await db.insert(vods).values(insertData).returning();
              vodId = newVod.id;
              success++;
              total++;
            }
            
            // 保存播放源到 vodSources 表
            if (rawPlayUrl) {
              try {
                // 检查是否已存在该播放源
                const existingSource = await db.select()
                  .from(vodSources)
                  .where(and(
                    eq(vodSources.vodId, vodId),
                    eq(vodSources.sourceId, source.id),
                    eq(vodSources.sourceVodId, String(item.vod_id || ''))
                  ))
                  .get();
                
                const sourceData = {
                  vodId: vodId,
                  sourceId: source.id,
                  sourceVodId: String(item.vod_id || ''),
                  sourceName: source.name || 'unknown',
                  playFrom: rawPlayFrom,
                  playUrl: parsedPlayUrl || rawPlayUrl,
                  playServer: vodData.vod_play_server || item.vod_play_server || '',
                  playNote: cleanHtml(vodData.vod_remarks || item.vod_remarks || ''),
                  priority: source.priority || 0,
                  status: 1,
                  collectTime: new Date().toISOString(),
                  updateTime: new Date().toISOString()
                };
                
                if (existingSource) {
                  await db.update(vodSources).set(sourceData)
                    .where(eq(vodSources.id, existingSource.id));
                } else {
                  sourceData.createTime = new Date().toISOString();
                  await db.insert(vodSources).values(sourceData);
                }
                
                console.log(`[collectWithApi] Saved vodSource for ${insertData.name}`);
              } catch (sourceError) {
                console.error(`[collectWithApi] Failed to save vodSource:`, sourceError);
                // 不阻止主流程
              }
            }
            
            // 添加短暂延迟，避免请求过快
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (vodError) {
            console.error(`[collectWithApi] Failed processing vod:`, vodError);
            failed++;
          }
        }
      
        // 检查是否所有分类都已处理
        if (endIndex >= totalCategories) {
          allCategoriesProcessed = true;
          console.log(`[collectWithApi] All ${totalCategories} categories have been processed!`);
        }
        
        if (abortCheck) await abortCheck();
      
        return { total, success, failed, allCategoriesProcessed, aborted: false };
}

app.get('/debug/vod/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  
  const vod = await db.select().from(vods).where(eq(vods.id, parseInt(id))).get();
  
  if (!vod) {
    return c.json(response.notFound('影片不存在'));
  }
  
  return c.json(response.success({
    vod,
    fields: {
      hasName: !!vod.name,
      hasPic: !!vod.pic,
      hasPlayUrl: !!vod.playUrl,
      hasPlayFrom: !!vod.playFrom,
      hasContent: !!vod.content,
      hasActor: !!vod.actor,
      hasDirector: !!vod.director,
      hasYear: !!vod.year,
      hasArea: !!vod.area,
      hasTypeId: !!vod.typeId,
    }
  }));
});

app.get('/debug/vod-list', async (c) => {
  const db = createDatabase(c.env.DB);
  const { limit = '10' } = c.req.query();
  
  const vodsList = await db.select()
    .from(vods)
    .orderBy(desc(vods.collectTime))
    .limit(parseInt(limit))
    .all();
  
  const result = vodsList.map(vod => ({
    id: vod.id,
    name: vod.name,
    pic: vod.pic ? `exists (${vod.pic.length} chars)` : 'empty',
    playUrl: vod.playUrl ? `exists (${vod.playUrl.length} chars)` : 'empty',
    playFrom: vod.playFrom || 'empty',
    content: vod.content ? `exists (${vod.content.length} chars)` : 'empty',
    actor: vod.actor || 'empty',
    director: vod.director || 'empty',
    year: vod.year || 'empty',
    area: vod.area || 'empty',
    typeId: vod.typeId || 'empty',
    collectTime: vod.collectTime,
    sourceVodId: vod.sourceVodId,
    sourceId: vod.sourceId,
  }));
  
  return c.json(response.success({
    total: vodsList.length,
    items: result
  }));
});

app.get('/debug/source/:sourceId', async (c) => {
  const db = createDatabase(c.env.DB);
  const { sourceId } = c.req.param();
  
  const source = await db.select().from(spiderSources).where(eq(spiderSources.id, parseInt(sourceId))).get();
  
  if (!source) {
    return c.json(response.notFound('采集源不存在'));
  }
  
  let apiHost = source.apiHost?.replace(/\/$/, '');
  const script = source.script;
  
  if (script) {
    const apiUrlMatch = script.match(/const\s+API_URL_PRIMARY\s*=\s*['"]([^'"]+)['"]/);
    if (apiUrlMatch) {
      apiHost = apiUrlMatch[1].replace(/\/$/, '');
    } else {
      const apiHostMatch = script.match(/const\s+API_HOST_PRIMARY\s*=\s*['"]([^'"]+)['"]/);
      if (apiHostMatch) {
        apiHost = apiHostMatch[1].replace(/\/$/, '');
      } else {
        const apiUrlSimpleMatch = script.match(/const\s+API_URL\s*=\s*['"]([^'"]+)['"]/);
        if (apiUrlSimpleMatch) {
          apiHost = apiUrlSimpleMatch[1].replace(/\/$/, '');
        } else {
          const apiHostSimpleMatch = script.match(/const\s+API_HOST\s*=\s*['"]([^'"]+)['"]/);
          if (apiHostSimpleMatch) {
            apiHost = apiHostSimpleMatch[1].replace(/\/$/, '');
          }
        }
      }
    }
  }
  
  const categories = await db.select().from(types).where(eq(types.status, 1));
  
  const config = source.config ? JSON.parse(source.config) : {};
  const imdbTypes = config.imdbTypes || {};
  
  const homeUrl = `${apiHost}?ac=list&pg=1`;
  let sourceCategories = [];
  let homeResponse = null;
  
  try {
    const resp = await fetch(homeUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(30000)
    });
    
    homeResponse = await resp.json();
    if (homeResponse.class && Array.isArray(homeResponse.class)) {
      sourceCategories = homeResponse.class;
    }
  } catch (e) {
    console.error('[debug/source] Failed to fetch home page:', e);
    homeResponse = { error: String(e) };
  }
  
  return c.json(response.success({
    source: {
      id: source.id,
      name: source.name,
      apiHost: apiHost,
      scriptLength: script ? script.length : 0,
      config: config
    },
    apiTest: {
      url: homeUrl,
      response: homeResponse,
      sourceCategories: sourceCategories
    },
    localCategories: categories.slice(0, 10),
    imdbTypes: imdbTypes
  }));
});

app.get('/execution/logs', async (c) => {
  const db = createDatabase(c.env.DB);
  const { page = '1', pageSize = '20', taskId, taskType, status } = c.req.query();
  const pageNum = parseInt(page) || 1;
  const pageSizeNum = parseInt(pageSize) || 20;
  const offset = (pageNum - 1) * pageSizeNum;
  
  const conditions: any[] = [];
  if (taskId && taskId !== '') {
    conditions.push(eq(collectTaskLogs.taskId, parseInt(taskId)));
  }
  if (taskType && taskType !== '') {
    conditions.push(eq(collectTaskLogs.taskType, parseInt(taskType)));
  }
  if (status && status !== '') {
    conditions.push(eq(collectTaskLogs.status, parseInt(status)));
  }
  
  let query = db.select().from(collectTaskLogs);
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  
  const [totalResult, list] = await Promise.all([
    db.select({ count: count() }).from(collectTaskLogs).where(conditions.length > 0 ? and(...conditions) : undefined),
    query.orderBy(desc(collectTaskLogs.createTime)).limit(pageSizeNum).offset(offset)
  ]);
  
  return c.json(response.success({
    list,
    total: totalResult[0].count,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

app.delete('/execution/log/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  await db.delete(collectTaskLogs).where(eq(collectTaskLogs.id, parseInt(id)));
  return c.json(response.success(null, '删除成功'));
});

/**
 * 一键删除所有执行日志
 * DELETE /spider/execution-log/clear
 */
app.delete('/execution-log/clear', async (c) => {
  const db = createDatabase(c.env.DB);
  await db.delete(collectTaskLogs);
  return c.json(response.success(null, '已清空所有执行日志'));
});

app.post('/schedule', async (c) => {
  const db = createDatabase(c.env.DB);
  const { tasks } = await c.req.json();
  
  for (const task of tasks || []) {
    try {
      await db.update(collectTasks).set({
        status: 0,
        schedule: task.schedule
      }).where(eq(collectTasks.id, parseInt(task.id)));
    } catch (e) {
      console.error('Schedule update failed:', e);
    }
  }
  
  return c.json(response.success(null, '调度更新成功'));
});

app.post('/batch-delete', async (c) => {
  const db = createDatabase(c.env.DB);
  const { ids } = await c.req.json();
  if (!ids || ids.length === 0) return c.json(response.error('未选择要删除的任务'));
  
  for (const id of ids) {
    try {
      await db.delete(collectTasks).where(eq(collectTasks.id, parseInt(id)));
    } catch (e) {
      console.error('Batch delete failed:', e);
    }
  }
  
  return c.json(response.success(null, '删除成功'));
});

// 手动触发定时任务（仅用于调试）
app.post('/trigger-scheduled', async (c) => {
  const db = createDatabase(c.env.DB);
  const { spiderSources, collectTasks, collectTaskLogs } = await import('../db');
  const { eq, and, desc, or } = await import('drizzle-orm');
  
  console.log('[trigger-scheduled] Manually triggering scheduled collection tasks...');
  
  const activeSources = await db.select().from(spiderSources).where(eq(spiderSources.status, 1));
  console.log(`[trigger-scheduled] Found ${activeSources.length} active spider sources`);
  
  const results: any[] = [];
  
  for (const source of activeSources) {
    try {
      console.log(`[trigger-scheduled] Processing source: ${source.name} (${source.code})`);
      
      // 查找已配置好的定时采集任务
      let scheduledTask = await db.select()
        .from(collectTasks)
        .where(
          and(
            eq(collectTasks.sourceId, source.id),
            eq(collectTasks.schedule, '30 * * * *')
          )
        )
        .get();
      
      if (!scheduledTask) {
        // 降级查找任何可执行的任务
        scheduledTask = await db.select()
          .from(collectTasks)
          .where(
            and(
              eq(collectTasks.sourceId, source.id),
              or(
                eq(collectTasks.status, 0),
                eq(collectTasks.status, 2),
                eq(collectTasks.status, 3)
              )
            )
          )
          .orderBy(desc(collectTasks.createTime))
          .get();
      }
      
      if (!scheduledTask) {
        console.log(`[trigger-scheduled] No task found for source ${source.name}`);
        results.push({ source: source.name, status: 'skipped', reason: 'no_task' });
        continue;
      }
      
      console.log(`[trigger-scheduled] Found task: ${scheduledTask.id} - ${scheduledTask.name}`);
      
      const taskId = scheduledTask.id;
      const startTime = new Date();
      
      // 启动任务
      await db.update(collectTasks)
        .set({ 
          status: 1, 
          startTime: startTime.toISOString() 
        })
        .where(eq(collectTasks.id, taskId));
      
      // 执行采集
      const result = await collectWithApi(db, source, scheduledTask, null, 2, startTime, 0, -1, 20, null);
      
      const endTime = new Date();
      
      await db.update(collectTasks)
        .set({ 
          status: 2, 
          endTime: endTime.toISOString(),
          total: result.total,
          success: result.success,
          failed: result.failed
        })
        .where(eq(collectTasks.id, taskId));
      
      await db.insert(collectTaskLogs).values({
      taskId,
      taskName: scheduledTask.name,
      taskType: scheduledTask.type || 1,
      sourceId: source.id,
      sourceName: source.name,
      status: 1, // 成功
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      total: result.total,
      success: result.success,
      failed: result.failed,
      duration: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString()
    });
    
    // 执行后清理旧日志，只保留最新的 100 条
    const deleteOldLogsSQL = `
      DELETE FROM ys_collect_task_log 
      WHERE id NOT IN (
        SELECT id FROM ys_collect_task_log 
        ORDER BY create_time DESC 
        LIMIT 100
      )
    `;
    await c.env.DB.prepare(deleteOldLogsSQL).run();
    
    await db.update(spiderSources)
        .set({ lastCollectTime: new Date().toISOString() })
        .where(eq(spiderSources.id, source.id));
      
      console.log(`[trigger-scheduled] Task ${taskId} completed: total=${result.total}, success=${result.success}`);
      results.push({ 
        source: source.name, 
        status: 'success', 
        taskId,
        total: result.total,
        success: result.success,
        failed: result.failed
      });
      
    } catch (error) {
      console.error(`[trigger-scheduled] Failed for source ${source.name}:`, error);
      const endTime = new Date();
      const errorMsg = String(error);
      
      await db.insert(collectTaskLogs).values({
        taskId,
        taskName: scheduledTask.name,
        taskType: scheduledTask.type || 1,
        sourceId: source.id,
        sourceName: source.name,
        status: 2, // 失败
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        duration: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
        total: 0,
        success: 0,
        failed: 0,
        errorLog: errorMsg,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString()
      });
      
      // 执行后清理旧日志，只保留最新的 100 条
      const deleteOldLogsSQL = `
        DELETE FROM ys_collect_task_log 
        WHERE id NOT IN (
          SELECT id FROM ys_collect_task_log 
          ORDER BY create_time DESC 
          LIMIT 100
        )
      `;
      await c.env.DB.prepare(deleteOldLogsSQL).run();
      
      results.push({ 
        source: source.name, 
        status: 'error', 
        error: errorMsg
      });
    }
  }
  
  return c.json(response.success({ results, message: `Triggered ${results.length} sources` }));
});

/**
 * 调试接口：返回采集任务的原始数据库数据，包括任务本身、关联的日志以及来源信息。
 * 用于前端字段匹配排查，帮助快速定位缺失的海报、播放链接等字段。
 */
app.get('/debug/:id', async (c) => {
  const db = createDatabase(c.env.DB);
  const { id } = c.req.param();
  const taskId = parseInt(id);
  
  const task = await db.select().from(collectTasks).where(eq(collectTasks.id, taskId)).get();
  if (!task) return c.json(response.notFound('采集任务不存在'));
  
  const logs = await db.select().from(collectTaskLogs).where(eq(collectTaskLogs.taskId, taskId)).orderBy(desc(collectTaskLogs.createTime)).all();
  const source = await db.select().from(spiderSources).where(eq(spiderSources.id, task.sourceId)).get();
  
  // 尝试解析 params
  let parsedParams = {};
  try {
    parsedParams = JSON.parse(task.params || '{}');
  } catch (e) {
    console.error('[debug] Failed to parse params:', task.params);
  }
  
  return c.json(response.success({ 
    task, 
    taskParamsRaw: task.params,
    taskParamsParsed: parsedParams,
    logs, 
    source 
  }));
});

/**
 * 检查部署版本
 * GET /api/collect/version
 */
app.get('/version', async (c) => {
  return c.json(response.success({
    version: '0.1.1',
    buildTime: new Date().toISOString(),
    message: 'Latest version deployed'
  }));
});

/**
 * 手动测试采集接口
 * GET /api/collect/test-collect?sourceId=2&pageLimit=2
 */
app.get('/test-collect', async (c) => {
  const db = createDatabase(c.env.DB);
  const { spiderSources } = await import('../db');
  
  const sourceId = parseInt(c.req.query('sourceId') || '2');
  const pageLimit = parseInt(c.req.query('pageLimit') || '2');
  const source = await db.select().from(spiderSources).where(eq(spiderSources.id, sourceId)).get();
  
  if (!source) {
    return c.json(response.error('采集源不存在'));
  }
  
  console.log(`[test-collect] Starting test collection for source ${source.name} with pageLimit=${pageLimit}`);
  
  try {
    const { collectWithApi } = await import('./collect');
    const task = { id: 0, type: 1, params: '{}' };
    const result = await collectWithApi(db, source, task, null, pageLimit, new Date(), 0, -1, 20, null);
    
    console.log(`[test-collect] Result:`, result);
    
    return c.json(response.success({
      source: source.name,
      pageLimit,
      ...result
    }));
  } catch (error) {
    console.error('[test-collect] Error:', error);
    return c.json(response.error(`采集失败: ${String(error)}`));
  }
});

/**
 * 调试接口：测试 API 连接是否正常
 * GET /api/collect/test-api?sourceId=2
 */
app.get('/test-api', async (c) => {
  const db = createDatabase(c.env.DB);
  const { spiderSources } = await import('../db');
  
  const sourceId = parseInt(c.req.query('sourceId') || '2');
  const source = await db.select().from(spiderSources).where(eq(spiderSources.id, sourceId)).get();
  
  if (!source) {
    return c.json(response.error('采集源不存在'));
  }
  
  try {
    // 从脚本中提取 API 地址
    let apiHost = source.apiHost?.replace(/\/$/, '');
    const script = source.script;
    
    if (script) {
      const apiUrlMatch = script.match(/const\s+API_URL_PRIMARY\s*=\s*['"]([^'"]+)['"]/);
      if (apiUrlMatch) {
        apiHost = apiUrlMatch[1].replace(/\/$/, '');
      } else {
        const apiHostMatch = script.match(/const\s+API_HOST_PRIMARY\s*=\s*['"]([^'"]+)['"]/);
        if (apiHostMatch) {
          apiHost = apiHostMatch[1].replace(/\/$/, '');
        } else {
          const apiUrlSimpleMatch = script.match(/const\s+API_URL\s*=\s*['"]([^'"]+)['"]/);
          if (apiUrlSimpleMatch) {
            let apiUrl = apiUrlSimpleMatch[1];
            if (apiUrl.includes('/api')) {
              apiHost = apiUrl.split('/api')[0].replace(/\/$/, '');
            } else {
              apiHost = apiUrl.replace(/\/$/, '');
            }
          } else {
            const apiHostSimpleMatch = script.match(/const\s+API_HOST\s*=\s*['"]([^'"]+)['"]/);
            if (apiHostSimpleMatch) {
              apiHost = apiHostSimpleMatch[1].replace(/\/$/, '');
            }
          }
        }
      }
    }
    
    if (!apiHost) {
      return c.json(response.error('未找到 API 地址'));
    }
    
    // 测试请求首页获取分类
    const homeUrl = `${apiHost}?ac=list&pg=1`;
    console.log(`[test-api] Testing: ${homeUrl}`);
    
    const homeResp = await fetch(homeUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(30000)
    });
    
    if (homeResp.ok) {
      const homeData = await homeResp.json();
      return c.json(response.success({
        apiHost,
        homeUrl,
        status: 'success',
        response: homeData,
        categories: homeData.class ? homeData.class.length : 0,
        lists: homeData.list ? homeData.list.length : 0
      }));
    } else {
      return c.json(response.error(`API 请求失败: ${homeResp.status} ${homeResp.statusText}`));
    }
    
  } catch (error) {
    console.error('[test-api] Error:', error);
    return c.json(response.error(`请求错误: ${String(error)}`));
  }
});

export { collectWithApi };

export default app;