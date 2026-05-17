import { Hono } from 'hono';
import { eq, and, desc, or, lt } from 'drizzle-orm';
import { Env } from './types/env';
import { corsMiddleware, errorHandler } from './middleware/cors';
import { adminAuth } from './middleware/auth';
import { createDatabase } from './db';
import * as response from './utils/response';

import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import userRoutes from './routes/user';
import typeRoutes from './routes/type';
import vodRoutes from './routes/vod';
import vodPublicRoutes from './routes/vodPublic';
import appRoutes from './routes/app';
import appVodRoutes from './routes/appVod';
import appUserRoutes from './routes/appUser';
import appHistoryRoutes from './routes/appHistory';
import appPlayRoutes from './routes/appPlay';
import appAnnouncementRoutes from './routes/appAnnouncement';
import announcementRoutes from './routes/announcement';
import announcementPublicRoutes from './routes/announcementPublic';
import packageRoutes from './routes/package';
import packagePublicRoutes from './routes/packagePublic';
import healthRoutes from './routes/health';
import spiderRoutes from './routes/spider';
import spiderPublicRoutes from './routes/spiderPublic';
import collectRoutes from './routes/collect';
import rechargeRoutes from './routes/recharge';
import transactionRoutes from './routes/transaction';
import bannedKeywordRoutes from './routes/bannedKeyword';
import backupRoutes from './routes/backup';
import dataCleanRoutes from './routes/dataClean';

const app = new Hono<{ Bindings: Env }>();

app.use('*', corsMiddleware);
app.use('*', errorHandler);

// 健康检查端点
app.get('/', (c) => {
  return c.json(response.success({
    message: '影视资源管理系统 API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  }));
});

// 诊断端点：检查 cron 心跳状态
app.get('/api/diagnose/cron', async (c) => {
  try {
    const heartbeat = await c.env.CACHE.get('cron_heartbeat');
    const lastRun = await c.env.CACHE.get('cron_last_run');
    const lastCollect = await c.env.CACHE.get('cron_last_collect');
    const lockValue = await c.env.CACHE.get('collect_batch_running');
    const abortValue = await c.env.CACHE.get('collect_batch_abort');
    
    const lastRunMs = lastRun ? parseInt(lastRun) : 0;
    const lastCollectMs = lastCollect ? parseInt(lastCollect) : 0;
    const nowMs = Date.now();
    const sinceLastRun = lastRunMs > 0 ? Math.round((nowMs - lastRunMs) / 1000) : -1;
    const sinceLastCollect = lastCollectMs > 0 ? Math.round((nowMs - lastCollectMs) / 1000) : -1;
    
    return c.json(response.success({
      cronHeartbeat: heartbeat,
      cronLastRun: lastRun ? new Date(parseInt(lastRun)).toISOString() : null,
      cronLastCollect: lastCollect ? new Date(parseInt(lastCollect)).toISOString() : null,
      sinceLastRunSeconds: sinceLastRun,
      sinceLastCollectSeconds: sinceLastCollect,
      cronHealthy: sinceLastCollect >= 0 && sinceLastCollect < 180,
      cronTriggered: sinceLastRun >= 0 && sinceLastRun < 180,
      currentTime: new Date().toISOString(),
      currentTimeBeijing: getBeijingTime(),
      hasLock: !!lockValue,
      lockTimestamp: lockValue,
      hasAbort: !!abortValue,
    }));
  } catch (error) {
    return c.json(response.error('诊断检查失败: ' + String(error)));
  }
});

// 手动触发采集任务（用于诊断 cron 是否正常）
app.post('/api/diagnose/trigger-cron', async (c) => {
  try {
    const db = createDatabase(c.env.DB);
    const beijingTime = getBeijingTime();
    
    const lastCollectStr = await c.env.CACHE.get('cron_last_collect');
    const lastCollectMs = lastCollectStr ? parseInt(lastCollectStr) : 0;
    const sinceLastCollect = lastCollectMs > 0 ? (Date.now() - lastCollectMs) / 1000 : -1;
    
    if (sinceLastCollect >= 0 && sinceLastCollect < 180) {
      return c.json(response.success({
        message: '采集任务近期已执行，跳过',
        sinceLastCollectSeconds: Math.round(sinceLastCollect),
        triggerTime: beijingTime,
        skipped: true,
      }));
    }
    
    const lockValue = await c.env.CACHE.get('collect_batch_running');
    if (lockValue) {
      const lockTime = parseInt(lockValue);
      const elapsedMinutes = (Date.now() - lockTime) / (1000 * 60);
      if (elapsedMinutes < 5) {
        return c.json(response.success({
          message: '采集任务正在运行中，跳过执行',
          lockAgeMinutes: elapsedMinutes.toFixed(1),
          triggerTime: beijingTime,
          skipped: true,
        }));
      } else {
        await c.env.CACHE.delete('collect_batch_running');
        await c.env.CACHE.delete('collect_batch_abort');
      }
    }
    
    await c.env.CACHE.put('cron_heartbeat', beijingTime, { expirationTtl: 86400 });
    await c.env.CACHE.put('cron_last_run', String(Date.now()), { expirationTtl: 86400 });
    await c.env.CACHE.put('collect_batch_running', String(Date.now()), { expirationTtl: 300 });
    
    const abortKey = 'collect_batch_abort';
    const abortCheck = async () => {
      const abortSignal = await c.env.CACHE.get(abortKey);
      if (abortSignal) {
        throw new Error('TASK_ABORTED: 任务被强制中断');
      }
    };
    
    await executeBatchCollection(db, c.env.CACHE, abortCheck);
    
    await c.env.CACHE.delete('collect_batch_running');
    await c.env.CACHE.put('cron_last_collect', String(Date.now()), { expirationTtl: 86400 });
    
    return c.json(response.success({
      message: '手动触发了采集任务（Cloudflare Cron 可能已停止）',
      sinceLastCollectSeconds: Math.round(sinceLastCollect),
      triggerTime: beijingTime,
      skipped: false,
    }));
  } catch (error) {
    await c.env.CACHE.delete('collect_batch_running');
    await c.env.CACHE.delete('collect_batch_abort');
    return c.json(response.error('触发失败：' + String(error)));
  }
});

// 健康检查路由
app.route('/api', healthRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes, adminAuth);
app.route('/api/user', userRoutes, adminAuth);
app.route('/api/type', typeRoutes, adminAuth);
app.route('/api/vod', vodRoutes, adminAuth);
app.route('/api/vod', vodPublicRoutes);
app.route('/api/app', appRoutes);
app.route('/api/app/vod', appVodRoutes);
app.route('/api/app/user', appUserRoutes);
app.route('/api/app/history', appHistoryRoutes);
app.route('/api/app/play', appPlayRoutes);
app.route('/api/app/announcement', appAnnouncementRoutes);
app.route('/api/announcement', announcementRoutes, adminAuth);
app.route('/api/announcement', announcementPublicRoutes);
app.route('/api/package', packageRoutes, adminAuth);
app.route('/api/package', packagePublicRoutes);
app.route('/api/spider', spiderRoutes, adminAuth);
app.route('/api/spider', spiderPublicRoutes);
app.route('/api/collect', collectRoutes, adminAuth);
app.route('/api/recharge', rechargeRoutes);
app.route('/api/transaction', transactionRoutes, adminAuth);
app.route('/api/banned-keyword', bannedKeywordRoutes, adminAuth);
app.route('/api/backup', backupRoutes, adminAuth);
app.route('/api/data-clean', dataCleanRoutes, adminAuth);

function getBeijingTime(): string {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const beijingTime = new Date(utc + 8 * 3600000);
  return beijingTime.toISOString().replace('T', ' ').substring(0, 19);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = createDatabase(env.DB);
    const beijingTime = getBeijingTime();
    console.log('Scheduled task running (UTC+8):', beijingTime);
    console.log('Cron expression:', event.cron);
    
    await env.CACHE.put('cron_heartbeat', beijingTime, { expirationTtl: 86400 });
    await env.CACHE.put('cron_last_run', String(Date.now()), { expirationTtl: 86400 });
    
    switch (event.cron) {
      case '*/3 * * * *':
        console.log('[CRON] Starting batch collection...');
        await (async () => {
          const startTime = Date.now();
          try {
            const taskLockKey = 'collect_batch_running';
            const abortKey = 'collect_batch_abort';
            
            const lastCollectStr = await env.CACHE.get('cron_last_collect');
            const lastCollectMs = lastCollectStr ? parseInt(lastCollectStr) : 0;
            const sinceLastCollect = lastCollectMs > 0 ? (Date.now() - lastCollectMs) / 1000 : -1;
            
            if (sinceLastCollect > 600) {
              console.log(`[CRON] ⚠️ Self-heal: No collection for ${Math.round(sinceLastCollect)}s, cleaning up stale state`);
              await env.CACHE.delete(taskLockKey);
              await env.CACHE.delete(abortKey);
            }
            
            const lockValue = await env.CACHE.get(taskLockKey);
            
            if (lockValue) {
              const lockTime = parseInt(lockValue);
              const now = Date.now();
              const elapsedMinutes = (now - lockTime) / (1000 * 60);
              
              console.log(`[CRON] Lock detected: age=${elapsedMinutes.toFixed(1)}min, value=${lockValue}`);
              
              if (elapsedMinutes < 5) {
                console.log(`[CRON] 上一次采集任务仍在运行中（已运行${elapsedMinutes.toFixed(1)}分钟），跳过本次执行`);
                return;
              } else {
                console.log(`[CRON] ⚠️ 检测到 Zombie 锁（${elapsedMinutes.toFixed(1)}分钟 > 5 分钟），强制清理`);
                await env.CACHE.put(abortKey, String(Date.now()), { expirationTtl: 120 });
                
                for (let i = 0; i < 3; i++) {
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  const currentLock = await env.CACHE.get(taskLockKey);
                  if (!currentLock) {
                    console.log(`[CRON] Zombie 锁已被清理`);
                    break;
                  }
                  if (parseInt(currentLock) > parseInt(lockValue)) {
                    console.log(`[CRON] 新锁已生成，放弃清理`);
                    return;
                  }
                }
                
                const stillRunning = await env.CACHE.get(taskLockKey);
                if (stillRunning) {
                  console.log('[CRON] ⚠️ Zombie 锁仍然存在，强制删除');
                  await env.CACHE.delete(taskLockKey);
                  await new Promise(resolve => setTimeout(resolve, 2000));
                }
              }
            }
            
            console.log('[CRON] Setting new lock...');
            await env.CACHE.delete(abortKey);
            await env.CACHE.put(taskLockKey, String(Date.now()), { expirationTtl: 300 });
            
            const abortCheck = async () => {
              const abortSignal = await env.CACHE.get(abortKey);
              if (abortSignal) {
                throw new Error('TASK_ABORTED: 任务被强制中断');
              }
            };
            
            console.log('[CRON] Starting executeBatchCollection...');
            await executeBatchCollection(db, env.CACHE, abortCheck);
            
            await env.CACHE.delete(taskLockKey);
            
            await env.CACHE.put('cron_last_collect', String(Date.now()), { expirationTtl: 86400 });
            
            const duration = Date.now() - startTime;
            console.log(`[CRON] ✅ Task completed in ${duration}ms`);
          } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[CRON] ❌ Task failed after ${duration}ms:`, error);
            console.error('[CRON] Error stack:', (error as Error).stack);
            
            await env.CACHE.delete('collect_batch_running');
            await env.CACHE.delete('collect_batch_abort');
            
            await env.CACHE.put('cron_last_collect', String(Date.now()), { expirationTtl: 86400 });
          }
        })();
        break;
      case '0 0 */1 * *':
        // 每天凌晨执行采集任务
        ctx.waitUntil((async () => {
          try {
            console.log('[CRON] Executing daily collection at midnight');
            await dailyCollectionTask(db, '0 0 */1 * *');
            console.log('[CRON] Daily collection completed successfully');
          } catch (error) {
            console.error('[CRON] Daily collection task failed:', error);
            console.error('[CRON] Error stack:', (error as Error).stack);
          }
        })());
        break;
      default:
        console.warn('[CRON] Unknown cron expression:', event.cron);
        console.warn('[CRON] Available cron expressions: */5 * * * *, 30 * * * *, 0 0 */1 * *');
    }
  }
};

async function cleanupExpiredOrders(db: ReturnType<typeof createDatabase>) {
  const expiredTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  console.log('Cleaning up expired orders before:', expiredTime);
}

async function dailyCollectionTask(db: ReturnType<typeof createDatabase>, cronExpr: string = '0 0 */1 * *') {
  try {
    await executeCollectionTasks(db, cronExpr);
  } catch (error) {
    console.error('Daily collection task failed:', error);
  }
}

async function executeCollectionTasks(db: ReturnType<typeof createDatabase>, cronExpr: string = '*/3 * * * *') {
  const { spiderSources, collectTasks, collectTaskLogs } = await import('./db');
  const activeSources = await db.select().from(spiderSources).where(eq(spiderSources.status, 1));
  
  for (const source of activeSources) {
    try {
      // 查找已配置好的定时采集任务（schedule 匹配当前 cron 表达式）
      let scheduledTask = await db.select()
        .from(collectTasks)
        .where(
          and(
            eq(collectTasks.sourceId, source.id),
            eq(collectTasks.schedule, cronExpr)
          )
        )
        .get();
      
      if (!scheduledTask) {
        // 如果没有 schedule 匹配的任务，尝试找一个最近完成的或者待执行的任务
        scheduledTask = await db.select()
          .from(collectTasks)
          .where(
            and(
              eq(collectTasks.sourceId, source.id),
              or(
                eq(collectTasks.status, 0), // 待执行
                eq(collectTasks.status, 2), // 已完成（可以重复执行）
                eq(collectTasks.status, 3)  // 失败（可以重试）
              )
            )
          )
          .orderBy(desc(collectTasks.createTime))
          .get();
        
        if (scheduledTask) {
          console.log(`Using fallback task (no schedule): ${scheduledTask.id} - ${scheduledTask.name}, status=${scheduledTask.status}`);
        }
      }
      
      if (!scheduledTask) {
        console.log(`No configured task found for source ${source.name}. Please create a task in the UI.`);
        continue;
      }
      
      console.log(`Executing task: ${scheduledTask.id} - ${scheduledTask.name}, current status: ${scheduledTask.status}`);
      
      const taskId = scheduledTask.id;
      const startTime = new Date();
      const startTimestamp = startTime;
      
      // 启动任务
      await db.update(collectTasks)
        .set({ 
          status: 1, 
          startTime: startTime.toISOString() 
        })
        .where(eq(collectTasks.id, taskId));
      
      // 真正执行采集任务
      const { collectWithApi } = await import('./routes/collect');
      
      // 解析任务参数
      const params = scheduledTask.params ? JSON.parse(scheduledTask.params) : {};
      const pageLimit = params.pageLimit || 2; // 默认每分类 2 页
      
      const task = {
        id: taskId,
        type: scheduledTask.type || 1,
        params: scheduledTask.params || '{}'
      };
      
      console.log(`Starting collectWithApi with pageLimit: ${pageLimit}`);
      
      const result = await collectWithApi(db, source, task, null, pageLimit, startTime, 0, -1, 20, null);
      const total = result.total;
      const success = result.success;
      const failed = result.failed;
      
      console.log(`Collection result: total=${total}, success=${success}, failed=${failed}`);
      
      const endTime = new Date();
      
      await db.update(collectTasks)
        .set({ 
          status: 2, 
          endTime: endTime.toISOString(),
          total,
          success,
          failed
        })
        .where(eq(collectTasks.id, taskId));
      
      // 写入执行日志
      const logResult = await db.insert(collectTaskLogs).values({
        taskId,
        taskName: scheduledTask.name,
        taskType: scheduledTask.type || 1,
        sourceId: source.id,
        sourceName: source.name,
        status: 1, // 成功
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        total,
        success,
        failed,
        duration: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString()
      }).returning();
      
      console.log(`Collection task ${taskId} completed, log id: ${logResult[0].id}, total=${total}, success=${success}, failed=${failed}`);
      
      await db.update(spiderSources)
        .set({ lastCollectTime: new Date().toISOString() })
        .where(eq(spiderSources.id, source.id));
        
      console.log(`Collection task ${taskId} finished successfully`);
    } catch (error) {
      console.error(`Collection failed for source ${source.name}:`, error);
      console.error(`Error stack:`, (error as Error).stack);
      
      // 注意：这里不能更新不存在的 taskId，需要先查找任务
      const { spiderSources, collectTasks, collectTaskLogs } = await import('./db');
      const failedSource = await db.select().from(spiderSources).where(eq(spiderSources.id, source.id)).get();
      if (failedSource) {
        const recentFailedTask = await db.select()
          .from(collectTasks)
          .where(
            and(
              eq(collectTasks.sourceId, source.id),
              eq(collectTasks.status, 1)
            )
          )
          .orderBy(desc(collectTasks.startTime))
          .get();
        
        if (recentFailedTask) {
          await db.update(collectTasks)
            .set({ 
              status: 3, 
              endTime: new Date().toISOString(),
              errorLog: String(error)
            })
            .where(eq(collectTasks.id, recentFailedTask.id));
          
          await db.insert(collectTaskLogs).values({
            taskId: recentFailedTask.id,
            taskName: recentFailedTask.name,
            taskType: recentFailedTask.type || 1,
            sourceId: source.id,
            sourceName: source.name,
            status: 2, // 失败
            startTime: recentFailedTask.startTime || new Date().toISOString(),
            endTime: new Date().toISOString(),
            total: 0,
            success: 0,
            failed: 0,
            errorLog: String(error),
            duration: 0,
            createTime: new Date().toISOString(),
            updateTime: new Date().toISOString()
          });
        }
      }
    }
  }
}

async function executeBatchCollection(db: ReturnType<typeof createDatabase>, cache: KVNamespace, abortCheck?: () => Promise<void>) {
  const { spiderSources, collectTaskLogs } = await import('./db');
  
  let activeSources: any[];
  try {
    activeSources = await db.select().from(spiderSources).where(eq(spiderSources.status, 1));
  } catch (dbError) {
    console.error('[executeBatchCollection] 读取采集源失败:', dbError);
    throw new Error('DB_READ_SOURCES_FAILED: ' + String(dbError));
  }
  
  if (activeSources.length === 0) {
    return;
  }
  
  const source = activeSources[0];
  const startTime = new Date();
  let result = null;
  let kvIndexUpdated = false;
  
  try {
    if (abortCheck) await abortCheck();
    
    const KV_KEY_PREFIX = `collect_progress_${source.id}_`;
    
    const indexVersion = await cache.get(KV_KEY_PREFIX + 'index_version');
    if (indexVersion !== 'v2') {
      console.log(`[executeBatchCollection] Index version mismatch (expected v2, got ${indexVersion}), resetting index`);
      await cache.delete(KV_KEY_PREFIX + 'current_index');
      await cache.delete(KV_KEY_PREFIX + 'total_categories');
      await cache.put(KV_KEY_PREFIX + 'index_version', 'v2', { expirationTtl: 86400 });
    }
    
    const currentIndexStr = await cache.get(KV_KEY_PREFIX + 'current_index');
    let currentIndex = currentIndexStr ? parseInt(currentIndexStr) : 0;
    
    const { collectWithApi } = await import('./routes/collect');
    
    if (abortCheck) await abortCheck();
    
    // 执行采集（最核心部分，即使后续操作失败，采集结果已存入数据库）
    result = await collectWithApi(db, source, null, cache, 2, startTime, currentIndex, 1, 30, null, abortCheck);
    
    // 更新 KV 索引（最高优先级：使用重试机制确保写入一定成功）
    let retryCount = 0;
    const maxRetries = 5;
    
    while (retryCount < maxRetries) {
      try {
        if (abortCheck) await abortCheck();
        
        if (result.allCategoriesProcessed) {
          console.log(`[executeBatchCollection] Resetting index (all categories processed)`);
          await cache.put(KV_KEY_PREFIX + 'current_index', '0', { expirationTtl: 86400 });
          await cache.delete(KV_KEY_PREFIX + 'total_categories');
        } else {
          const nextIndex = currentIndex + 1;
          console.log(`[executeBatchCollection] Saving index: ${currentIndex} -> ${nextIndex}`);
          await cache.put(KV_KEY_PREFIX + 'current_index', String(nextIndex), { expirationTtl: 86400 });
        }
        kvIndexUpdated = true;
        console.log(`[executeBatchCollection] ✅ KV index updated successfully`);
        break; // 成功则退出重试循环
      } catch (kvError) {
        retryCount++;
        console.error(`[executeBatchCollection] KV index update failed (attempt ${retryCount}/${maxRetries}):`, kvError.message);
        
        if (retryCount >= maxRetries) {
          console.error('[executeBatchCollection] ❌ KV index update failed after all retries! Task will stop!');
          throw new Error('KV_INDEX_UPDATE_FAILED: ' + String(kvError));
        }
        
        // 指数退避：1s, 2s, 4s, 8s
        const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
        console.log(`[executeBatchCollection] Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // 最后采集时间（可选，不影响任务执行）
    try {
      await db.update(spiderSources)
        .set({ lastCollectTime: new Date().toISOString() })
        .where(eq(spiderSources.id, source.id));
    } catch (updateError) {
      console.error('[executeBatchCollection] 更新 lastCollectTime 失败，不影响任务:', updateError);
    }
    
    // 写入执行日志（容错：即使日志写入失败也不中断任务）
    try {
      await db.insert(collectTaskLogs).values({
        taskId: source.id,
        taskName: source.name,
        sourceId: source.id,
        sourceName: source.name,
        taskType: 3,
        status: 1,
        startTime: startTime.toISOString(),
        endTime: new Date().toISOString(),
        duration: Math.round((new Date().getTime() - startTime.getTime()) / 1000),
        total: result.total || 0,
        success: result.success || 0,
        failed: result.failed || 0,
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString()
      });
    } catch (logError) {
      console.error('[executeBatchCollection] 日志写入失败，但不中断任务:', logError);
    }
    
    const duration = Date.now(); // 累加时间戳
    console.log(`[executeBatchCollection] ✅ 任务完成：${kvIndexUpdated ? 'KV 已更新' : 'KV 未更新'}`);
    
  } catch (error) {
    console.error('[executeBatchCollection] ❌ 任务执行失败:', error);
    console.error('[executeBatchCollection] Error stack:', (error as Error).stack);
    
    // 错误时写入失败日志（容错：失败日志写入失败也不中断流程）
    try {
      // 仅当 result 存在时记录成功指标，否则全为 0
      const hasResult = result !== null;
      await db.insert(collectTaskLogs).values({
        taskId: source.id,
        taskName: source.name,
        sourceId: source.id,
        sourceName: source.name,
        taskType: 3,
        status: 2,
        startTime: startTime.toISOString(),
        endTime: new Date().toISOString(),
        duration: hasResult ? Math.round((new Date().getTime() - startTime.getTime()) / 1000) : 0,
        total: hasResult ? (result.total || 0) : 0,
        success: hasResult ? (result.success || 0) : 0,
        failed: hasResult ? (result.failed || 0) : 0,
        errorLog: String(error),
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString()
      });
    } catch (logError) {
      console.error('[executeBatchCollection] 失败日志写入失败:', logError);
    }
    
    // 无论日志是否写入成功，都抛出错误让上层处理
    throw error;
  }
}

/**
 * 清理旧的采集日志，只保留最新的100条记录
 */
async function cleanupOldCollectLogs(db: ReturnType<typeof createDatabase>) {
  try {
    // 先统计总记录数
    const countResult = await db.select({ id: collectTaskLogs.id })
      .from(collectTaskLogs)
      .orderBy(desc(collectTaskLogs.createTime))
      .limit(100)
      .all();
    
    if (countResult.length === 0) {
      return;
    }
    
    // 获取第100条记录的ID作为阈值
    const thresholdId = countResult.length < 100 ? 0 : countResult[countResult.length - 1].id;
    
    if (thresholdId > 0) {
      // 删除ID小于阈值的旧记录（比 NOT IN 更安全高效）
      await db.delete(collectTaskLogs)
        .where(lt(collectTaskLogs.id, thresholdId));
      
      console.log(`[CLEANUP] Removed old collect logs with id < ${thresholdId}`);
    }
  } catch (error) {
    console.error('[CLEANUP] Failed to cleanup old collect logs:', error);
  }
}