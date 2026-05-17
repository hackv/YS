import { Hono } from 'hono';
import { Env } from '../types/env';
import { createDatabase } from '../db';
import { vods, types, bannedKeywords, users, spiderSources } from '../db';
import { eq, inArray } from 'drizzle-orm';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

app.get('/stats', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  
  try {
    const totalVodsResult = await d1.prepare('SELECT COUNT(*) as count FROM ys_vod').first();
    const totalTypesResult = await d1.prepare('SELECT COUNT(*) as count FROM ys_type').first();
    const totalBannedResult = await d1.prepare('SELECT COUNT(*) as count FROM ys_banned_keyword').first();
    const totalUsersResult = await d1.prepare('SELECT COUNT(*) as count FROM ys_user').first();

    const totalVods = (totalVodsResult?.count as number) || 0;
    const totalTypes = (totalTypesResult?.count as number) || 0;
    const totalBanned = (totalBannedResult?.count as number) || 0;
    const totalUsers = (totalUsersResult?.count as number) || 0;

    const duplicateGroups = await d1.prepare('SELECT COUNT(*) as count FROM (SELECT name FROM ys_vod GROUP BY name HAVING COUNT(*) > 1)').first();
    const duplicateCount = (duplicateGroups?.count as number) || 0;

    const currentYear = new Date().getFullYear();
    const oldYearResult = await d1.prepare(`SELECT COUNT(*) as count FROM ys_vod WHERE year IS NOT NULL AND year != '' AND CAST(year AS INTEGER) < ${currentYear - 20}`).first();
    const oldYearVideos = (oldYearResult?.count as number) || 0;

    const invalidResult = await d1.prepare("SELECT COUNT(*) as count FROM ys_vod WHERE (name IS NULL OR name = '') OR (play_url IS NULL OR play_url = '' OR play_url = '[]')").first();
    const invalidVideos = (invalidResult?.count as number) || 0;

    const noCoverResult = await d1.prepare("SELECT COUNT(*) as count FROM ys_vod WHERE pic IS NULL OR pic = ''").first();
    const noCoverVideos = (noCoverResult?.count as number) || 0;

    const noPlayUrlResult = await d1.prepare("SELECT COUNT(*) as count FROM ys_vod WHERE play_url IS NULL OR play_url = '' OR play_url = '[]'").first();
    const noPlayUrlVideos = (noPlayUrlResult?.count as number) || 0;

    // No source videos (no_source = playFrom is empty but playUrl exists)
    const noSourceResult = await d1.prepare("SELECT COUNT(*) as count FROM ys_vod WHERE play_from IS NULL OR play_from = ''").first();
    const noSourceVideos = (noSourceResult?.count as number) || 0;

    const disabledCatResult = await d1.prepare("SELECT COUNT(*) as count FROM ys_vod WHERE type_id IN (SELECT id FROM ys_type WHERE status = 0)").first();
    const disabledCategoryVideos = (disabledCatResult?.count as number) || 0;

    const invalidFormatResult = await d1.prepare(`SELECT COUNT(*) as count FROM ys_vod WHERE play_url IS NOT NULL AND play_url != '' AND play_url != '[]' AND LOWER(play_url) NOT LIKE '%.mp4%' AND LOWER(play_url) NOT LIKE '%.mkv%' AND LOWER(play_url) NOT LIKE '%.avi%' AND LOWER(play_url) NOT LIKE '%.rmvb%' AND LOWER(play_url) NOT LIKE '%.mov%' AND LOWER(play_url) NOT LIKE '%.flv%' AND LOWER(play_url) NOT LIKE '%.webm%' AND LOWER(play_url) NOT LIKE '%.ts%' AND LOWER(play_url) NOT LIKE '%.m3u8%' AND LOWER(play_url) NOT LIKE '%.mpd%'`).first();
    const invalidFormatVideos = (invalidFormatResult?.count as number) || 0;

    const bannedKeywordResult = await d1.prepare("SELECT COUNT(*) as count FROM ys_vod WHERE EXISTS (SELECT 1 FROM ys_banned_keyword b WHERE b.status = 1 AND (ys_vod.name LIKE '%' || b.keyword || '%' OR ys_vod.actor LIKE '%' || b.keyword || '%' OR ys_vod.tag LIKE '%' || b.keyword || '%'))").first();
    const bannedKeywordVideos = (bannedKeywordResult?.count as number) || 0;

    return c.json(response.success({
      totalVideos: totalVods,
      totalTypes: totalTypes,
      totalBannedKeywords: totalBanned,
      totalUsers: totalUsers,
      duplicateVideos: duplicateCount,
      bannedKeywordVideos: bannedKeywordVideos,
      disabledCategoryVideos: disabledCategoryVideos,
      oldYearVideos: oldYearVideos,
      invalidFormatVideos: invalidFormatVideos,
      noCoverVideos: noCoverVideos,
      noPlayUrlVideos: noPlayUrlVideos,
      noSourceVideos: noSourceVideos,
      invalidVideos: invalidVideos
    }));
  } catch (error) {
    console.error('data-clean stats error:', error);
    return c.json(response.serverError('获取统计数据失败'));
  }
});

app.get('/preview', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { type = 'duplicates' } = c.req.query();

  try {
    let list: any[] = [];
    
    switch (type) {
      case 'duplicates':
        const duplicatesResult = await d1.prepare('SELECT name, COUNT(*) as count, GROUP_CONCAT(id) as ids FROM ys_vod GROUP BY name HAVING COUNT(*) > 1').all();
        list = (duplicatesResult.results || []).map((d: any) => ({
          type: 'duplicate',
          name: d.name,
          count: Number(d.count),
          ids: d.ids
        }));
        break;
        
      case 'disabled-categories':
        const disabledTypesResult = await d1.prepare('SELECT id, name, parent_id FROM ys_type WHERE status = 0').all();
        list = (disabledTypesResult.results || []).map((t: any) => ({
          type: 'disabled-category',
          id: t.id,
          name: t.name,
          parentId: t.parent_id
        }));
        break;
        
      case 'banned-keywords':
        const bannedListResult = await d1.prepare('SELECT keyword FROM ys_banned_keyword WHERE status = 1').all();
        const bannedWords = (bannedListResult.results || []).map((b: any) => b.keyword);
        
        if (bannedWords.length > 0) {
          const conditions = bannedWords.map((word: string) => [
            `name LIKE '%${word.replace(/'/g, "''")}%'`,
            `actor LIKE '%${word.replace(/'/g, "''")}%'`,
            `tag LIKE '%${word.replace(/'/g, "''")}%'`,
            `director LIKE '%${word.replace(/'/g, "''")}%'`,
            `blurb LIKE '%${word.replace(/'/g, "''")}%'`
          ]).flat().join(' OR ');
          
          const withBannedResult = await d1.prepare(`SELECT id, name, actor, tag FROM ys_vod WHERE ${conditions}`).all();
          list = (withBannedResult.results || []).map((v: any) => ({
            type: 'banned-keyword',
            id: v.id,
            name: v.name,
            actor: v.actor,
            tag: v.tag
          }));
        }
        break;
        
      case 'old-year':
        const currentYear = new Date().getFullYear();
        const oldVodsResult = await d1.prepare(`SELECT id, name, year FROM ys_vod WHERE year IS NOT NULL AND year != '' AND CAST(year AS INTEGER) < ${currentYear - 20}`).all();
        list = (oldVodsResult.results || []).map((v: any) => ({
          type: 'old-year',
          id: v.id,
          name: v.name,
          year: v.year
        }));
        break;
        
      case 'invalid':
        const invalidVodsResult = await d1.prepare("SELECT id, name, play_url, pic FROM ys_vod WHERE (name IS NULL OR name = '') OR (play_url IS NULL OR play_url = '' OR play_url = '[]') OR (pic IS NULL OR pic = '')").all();
        list = (invalidVodsResult.results || []).map((v: any) => ({
          type: 'invalid',
          id: v.id,
          name: v.name,
          playUrl: v.play_url,
          pic: v.pic
        }));
        break;
        
      case 'invalid-format':
        const invalidFormatVodsResult = await d1.prepare(`SELECT id, name, play_url FROM ys_vod WHERE play_url IS NOT NULL AND play_url != '' AND play_url != '[]' AND LOWER(play_url) NOT LIKE '%.mp4%' AND LOWER(play_url) NOT LIKE '%.mkv%' AND LOWER(play_url) NOT LIKE '%.avi%' AND LOWER(play_url) NOT LIKE '%.rmvb%' AND LOWER(play_url) NOT LIKE '%.mov%' AND LOWER(play_url) NOT LIKE '%.flv%' AND LOWER(play_url) NOT LIKE '%.webm%' AND LOWER(play_url) NOT LIKE '%.ts%' AND LOWER(play_url) NOT LIKE '%.m3u8%' AND LOWER(play_url) NOT LIKE '%.mpd%'`).all();
        list = (invalidFormatVodsResult.results || []).map((v: any) => ({
          type: 'invalid-format',
          id: v.id,
          name: v.name,
          playUrl: v.play_url
        }));
        break;
        
      case 'source-disabled-categories':
        const spidersResult = await d1.prepare('SELECT disabled_categories FROM ys_spider_source WHERE status = 1 AND disabled_categories IS NOT NULL AND disabled_categories != ""').all();
        const allDisabledCategoryIds: number[] = [];
        
        for (const spider of (spidersResult.results || [])) {
          if (spider.disabled_categories) {
            try {
              const disabledIds = JSON.parse(spider.disabled_categories) as number[];
              allDisabledCategoryIds.push(...disabledIds);
            } catch (e) {
              console.warn('Failed to parse disabledCategories:', spider.disabled_categories);
            }
          }
        }
        
        if (allDisabledCategoryIds.length > 0) {
          const idsStr = allDisabledCategoryIds.join(',');
          const sourceDisabledVodsResult = await d1.prepare(`SELECT id, name, type_id FROM ys_vod WHERE type_id IN (${idsStr})`).all();
          list = (sourceDisabledVodsResult.results || []).map((v: any) => ({
            type: 'source-disabled-category',
            id: v.id,
            name: v.name,
            typeId: v.type_id
          }));
        }
        break;
        
      default:
        return c.json(response.error('未知类型'));
    }

    return c.json(response.success(list));
  } catch (error) {
    console.error('data-clean preview error:', error);
    return c.json(response.serverError('获取预览数据失败'));
  }
});

app.post('/duplicates', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { dryRun = true } = await c.req.json();

  try {
    const duplicatesResult = await d1.prepare('SELECT name FROM ys_vod GROUP BY name HAVING COUNT(*) > 1').all();
    const duplicates = duplicatesResult.results || [];

    let deletedCount = 0;
    
    if (!dryRun) {
      for (const dup of duplicates) {
        const allRecordsResult = await d1.prepare(`SELECT id, create_time FROM ys_vod WHERE name = ? ORDER BY create_time`).bind(dup.name).all();
        const allRecords = allRecordsResult.results || [];
        
        if (allRecords.length > 1) {
          const idsToDelete = allRecords.slice(1).map((i: any) => i.id);
          if (idsToDelete.length > 0) {
            const idsStr = idsToDelete.join(',');
            await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
            deletedCount += idsToDelete.length;
          }
        }
      }
    } else {
      let total = 0;
      for (const dup of duplicates) {
        const countResult = await d1.prepare(`SELECT COUNT(*) as count FROM ys_vod WHERE name = ?`).bind(dup.name).first();
        total += ((countResult?.count as number) || 0) - 1;
      }
      deletedCount = total;
    }

    return c.json(response.success({
      dryRun,
      deletedCount,
      message: dryRun ? `将删除 ${deletedCount} 条重复视频（保留最早创建的记录）` : `成功删除 ${deletedCount} 条重复视频（保留最早创建的记录）`
    }));
  } catch (error) {
    console.error('data-clean duplicates error:', error);
    return c.json(response.serverError('清理重复数据失败'));
  }
});

app.post('/banned-keywords', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { dryRun = true } = await c.req.json();

  try {
    const bannedListResult = await d1.prepare('SELECT keyword FROM ys_banned_keyword WHERE status = 1').all();
    const bannedWords = (bannedListResult.results || []).map((b: any) => b.keyword);
    
    if (bannedWords.length === 0) {
      return c.json(response.success({
        dryRun,
        deletedCount: 0,
        message: '没有配置禁用关键词'
      }));
    }

    let deletedCount = 0;
    const allDeletedIds: number[] = [];
    
    for (const word of bannedWords) {
      const escapedWord = word.replace(/'/g, "''");
      const resultsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE name LIKE '%${escapedWord}%' OR actor LIKE '%${escapedWord}%' OR tag LIKE '%${escapedWord}%' OR director LIKE '%${escapedWord}%' OR blurb LIKE '%${escapedWord}%'`).all();
      const results = resultsResult.results || [];
      
      for (const r of results) {
        if (!allDeletedIds.includes(r.id)) {
          allDeletedIds.push(r.id);
        }
      }
    }
    
    deletedCount = allDeletedIds.length;
    
    if (!dryRun && deletedCount > 0) {
      const idsStr = allDeletedIds.join(',');
      await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
    }

    return c.json(response.success({
      dryRun,
      deletedCount,
      message: dryRun ? `将删除 ${deletedCount} 条包含禁用关键词的视频` : `成功删除 ${deletedCount} 条包含禁用关键词的视频`
    }));
  } catch (error) {
    console.error('data-clean banned-keywords error:', error);
    return c.json(response.serverError('清理禁用关键词视频失败'));
  }
});

app.post('/disabled-categories', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { dryRun = true } = await c.req.json();

  try {
    const disabledTypesResult = await d1.prepare('SELECT id FROM ys_type WHERE status = 0').all();
    const disabledIds = (disabledTypesResult.results || []).map((t: any) => t.id);
    
    const childTypesResult = disabledIds.length > 0 
      ? await d1.prepare(`SELECT id FROM ys_type WHERE parent_id IN (${disabledIds.join(',')})`).all()
      : { results: [] };
    const childIds = (childTypesResult.results || []).map((t: any) => t.id);
    const allDisabledIds = [...disabledIds, ...childIds];
    
    let deletedCount = 0;
    
    if (allDisabledIds.length > 0) {
      const vodsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE type_id IN (${allDisabledIds.join(',')})`).all();
      const vodsInDisabledTypes = vodsResult.results || [];
      
      deletedCount = vodsInDisabledTypes.length;
      
      if (!dryRun && deletedCount > 0) {
        const ids = vodsInDisabledTypes.map((v: any) => v.id);
        const idsStr = ids.join(',');
        await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
      }
    }

    return c.json(response.success({
      dryRun,
      deletedCount,
      message: dryRun ? `将删除 ${deletedCount} 条禁用分类的视频（包含子分类）` : `成功删除 ${deletedCount} 条禁用分类的视频（包含子分类）`
    }));
  } catch (error) {
    console.error('data-clean disabled-categories error:', error);
    return c.json(response.serverError('清理禁用分类视频失败'));
  }
});

app.post('/old-year', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { dryRun = true } = await c.req.json();

  try {
    const currentYear = new Date().getFullYear();
    const beforeYear = currentYear - 20;
    
    const oldVodsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE year IS NOT NULL AND year != '' AND CAST(year AS INTEGER) < ${beforeYear}`).all();
    const oldVods = oldVodsResult.results || [];
    
    const deletedCount = oldVods.length;
    
    if (!dryRun && deletedCount > 0) {
      const ids = oldVods.map((v: any) => v.id);
      const idsStr = ids.join(',');
      await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
    }

    return c.json(response.success({
      dryRun,
      deletedCount,
      beforeYear,
      message: dryRun ? `将删除 ${deletedCount} 条 ${beforeYear}年之前的老旧视频` : `成功删除 ${deletedCount} 条 ${beforeYear}年之前的老旧视频`
    }));
  } catch (error) {
    console.error('data-clean old-year error:', error);
    return c.json(response.serverError('清理旧年份视频失败'));
  }
});

app.post('/invalid-format', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { dryRun = true } = await c.req.json();

  try {
    const invalidFormatVodsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE play_url IS NOT NULL AND play_url != '' AND play_url != '[]' AND LOWER(play_url) NOT LIKE '%.mp4%' AND LOWER(play_url) NOT LIKE '%.mkv%' AND LOWER(play_url) NOT LIKE '%.avi%' AND LOWER(play_url) NOT LIKE '%.rmvb%' AND LOWER(play_url) NOT LIKE '%.mov%' AND LOWER(play_url) NOT LIKE '%.flv%' AND LOWER(play_url) NOT LIKE '%.webm%' AND LOWER(play_url) NOT LIKE '%.ts%' AND LOWER(play_url) NOT LIKE '%.m3u8%' AND LOWER(play_url) NOT LIKE '%.mpd%'`).all();
    const invalidFormatVods = invalidFormatVodsResult.results || [];
    
    const deletedCount = invalidFormatVods.length;
    
    if (!dryRun && deletedCount > 0) {
      const ids = invalidFormatVods.map((v: any) => v.id);
      const idsStr = ids.join(',');
      await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
    }

    return c.json(response.success({
      dryRun,
      deletedCount,
      message: dryRun ? `将删除 ${deletedCount} 条异常格式播放源的视频` : `成功删除 ${deletedCount} 条异常格式播放源的视频`
    }));
  } catch (error) {
    console.error('data-clean invalid-format error:', error);
    return c.json(response.serverError('清理异常格式视频失败'));
  }
});

app.post('/source-disabled-categories', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { dryRun = true } = await c.req.json();

  try {
    const spidersResult = await d1.prepare('SELECT disabled_categories FROM ys_spider_source WHERE status = 1 AND disabled_categories IS NOT NULL AND disabled_categories != ""').all();
    const allDisabledCategoryIds: number[] = [];
    
    for (const spider of (spidersResult.results || [])) {
      if (spider.disabled_categories) {
        try {
          const disabledIds = JSON.parse(spider.disabled_categories) as number[];
          allDisabledCategoryIds.push(...disabledIds);
        } catch (e) {
          console.warn('Failed to parse disabledCategories:', spider.disabled_categories);
        }
      }
    }
    
    if (allDisabledCategoryIds.length === 0) {
      return c.json(response.success({
        dryRun,
        deletedCount: 0,
        message: '没有配置爬虫源禁用分类'
      }));
    }

    const sourceDisabledVodsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE type_id IN (${allDisabledCategoryIds.join(',')})`).all();
    const sourceDisabledVods = sourceDisabledVodsResult.results || [];
    
    const deletedCount = sourceDisabledVods.length;
    
    if (!dryRun && deletedCount > 0) {
      const ids = sourceDisabledVods.map((v: any) => v.id);
      const idsStr = ids.join(',');
      await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
    }

    return c.json(response.success({
      dryRun,
      deletedCount,
      message: dryRun ? `将删除 ${deletedCount} 条爬虫源禁用分类的视频` : `成功删除 ${deletedCount} 条爬虫源禁用分类的视频`
    }));
  } catch (error) {
    console.error('data-clean source-disabled-categories error:', error);
    return c.json(response.serverError('清理爬虫源禁用分类视频失败'));
  }
});

app.post('/invalid', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { dryRun = true } = await c.req.json();

  try {
    const invalidVodsResult = await d1.prepare("SELECT id FROM ys_vod WHERE (name IS NULL OR name = '') OR (play_url IS NULL OR play_url = '' OR play_url = '[]') OR (pic IS NULL OR pic = '')").all();
    const invalidVods = invalidVodsResult.results || [];
    
    const deletedCount = invalidVods.length;
    
    if (!dryRun && deletedCount > 0) {
      const ids = invalidVods.map((v: any) => v.id);
      const idsStr = ids.join(',');
      await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
    }

    return c.json(response.success({
      dryRun,
      deletedCount,
      message: dryRun ? `将删除 ${deletedCount} 条无效视频（无播放源、无封面、无播放地址、无名称）` : `成功删除 ${deletedCount} 条无效视频（无播放源、无封面、无播放地址、无名称）`
    }));
  } catch (error) {
    console.error('data-clean invalid error:', error);
    return c.json(response.serverError('清理无效视频失败'));
  }
});

app.post('/all', async (c) => {
  const db = createDatabase(c.env.DB);
  const d1 = c.env.DB;
  const { dryRun = true } = await c.req.json();

  try {
    const results = {
      dryRun,
      duplicates: 0,
      bannedKeywords: 0,
      disabledCategories: 0,
      oldYear: 0,
      invalidFormat: 0,
      sourceDisabledCategories: 0,
      invalid: 0,
      total: 0
    };

    const duplicatesResult = await d1.prepare('SELECT name FROM ys_vod GROUP BY name HAVING COUNT(*) > 1').all();
    const duplicates = duplicatesResult.results || [];
    
    for (const dup of duplicates) {
      const allRecordsResult = await d1.prepare(`SELECT id, create_time FROM ys_vod WHERE name = ? ORDER BY create_time`).bind(dup.name).all();
      const allRecords = allRecordsResult.results || [];
      
      if (allRecords.length > 1) {
        results.duplicates += allRecords.length - 1;
        
        if (!dryRun) {
          const idsToDelete = allRecords.slice(1).map((i: any) => i.id);
          if (idsToDelete.length > 0) {
            const idsStr = idsToDelete.join(',');
            await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
          }
        }
      }
    }

    const bannedListResult = await d1.prepare('SELECT keyword FROM ys_banned_keyword WHERE status = 1').all();
    const bannedWords = (bannedListResult.results || []).map((b: any) => b.keyword);
    
    for (const word of bannedWords) {
      const escapedWord = word.replace(/'/g, "''");
      const bannedResultsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE name LIKE '%${escapedWord}%' OR actor LIKE '%${escapedWord}%' OR tag LIKE '%${escapedWord}%' OR director LIKE '%${escapedWord}%' OR blurb LIKE '%${escapedWord}%'`).all();
      const bannedResults = bannedResultsResult.results || [];
      
      results.bannedKeywords += bannedResults.length;
      
      if (!dryRun && bannedResults.length > 0) {
        const ids = bannedResults.map((r: any) => r.id);
        const idsStr = ids.join(',');
        await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
      }
    }

    const disabledTypesResult = await d1.prepare('SELECT id FROM ys_type WHERE status = 0').all();
    const disabledIds = (disabledTypesResult.results || []).map((t: any) => t.id);
    const childTypesResult = disabledIds.length > 0 
      ? await d1.prepare(`SELECT id FROM ys_type WHERE parent_id IN (${disabledIds.join(',')})`).all()
      : { results: [] };
    const childIds = (childTypesResult.results || []).map((t: any) => t.id);
    const allDisabledIds = [...disabledIds, ...childIds];
    
    if (allDisabledIds.length > 0) {
      const disabledVodsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE type_id IN (${allDisabledIds.join(',')})`).all();
      const disabledVods = disabledVodsResult.results || [];
      
      results.disabledCategories = disabledVods.length;
      
      if (!dryRun && disabledVods.length > 0) {
        const ids = disabledVods.map((v: any) => v.id);
        const idsStr = ids.join(',');
        await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
      }
    }

    const currentYear = new Date().getFullYear();
    const beforeYear = currentYear - 20;
    const oldVodsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE year IS NOT NULL AND year != '' AND CAST(year AS INTEGER) < ${beforeYear}`).all();
    const oldVods = oldVodsResult.results || [];
    
    results.oldYear = oldVods.length;
    
    if (!dryRun && oldVods.length > 0) {
      const ids = oldVods.map((v: any) => v.id);
      const idsStr = ids.join(',');
      await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
    }

    const invalidFormatVodsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE play_url IS NOT NULL AND play_url != '' AND play_url != '[]' AND LOWER(play_url) NOT LIKE '%.mp4%' AND LOWER(play_url) NOT LIKE '%.mkv%' AND LOWER(play_url) NOT LIKE '%.avi%' AND LOWER(play_url) NOT LIKE '%.rmvb%' AND LOWER(play_url) NOT LIKE '%.mov%' AND LOWER(play_url) NOT LIKE '%.flv%' AND LOWER(play_url) NOT LIKE '%.webm%' AND LOWER(play_url) NOT LIKE '%.ts%' AND LOWER(play_url) NOT LIKE '%.m3u8%' AND LOWER(play_url) NOT LIKE '%.mpd%'`).all();
    const invalidFormatVods = invalidFormatVodsResult.results || [];
    
    results.invalidFormat = invalidFormatVods.length;
    
    if (!dryRun && invalidFormatVods.length > 0) {
      const ids = invalidFormatVods.map((v: any) => v.id);
      const idsStr = ids.join(',');
      await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
    }

    const spidersResult = await d1.prepare('SELECT disabled_categories FROM ys_spider_source WHERE status = 1 AND disabled_categories IS NOT NULL AND disabled_categories != ""').all();
    const allDisabledCategoryIds: number[] = [];
    
    for (const spider of (spidersResult.results || [])) {
      if (spider.disabled_categories) {
        try {
          const disabledIds = JSON.parse(spider.disabled_categories) as number[];
          allDisabledCategoryIds.push(...disabledIds);
        } catch (e) {
          console.warn('Failed to parse disabledCategories:', spider.disabled_categories);
        }
      }
    }
    
    if (allDisabledCategoryIds.length > 0) {
      const sourceDisabledVodsResult = await d1.prepare(`SELECT id FROM ys_vod WHERE type_id IN (${allDisabledCategoryIds.join(',')})`).all();
      const sourceDisabledVods = sourceDisabledVodsResult.results || [];
      
      results.sourceDisabledCategories = sourceDisabledVods.length;
      
      if (!dryRun && sourceDisabledVods.length > 0) {
        const ids = sourceDisabledVods.map((v: any) => v.id);
        const idsStr = ids.join(',');
        await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
      }
    }

    const invalidVodsResult = await d1.prepare("SELECT id FROM ys_vod WHERE (name IS NULL OR name = '') OR (play_url IS NULL OR play_url = '' OR play_url = '[]') OR (pic IS NULL OR pic = '')").all();
    const invalidVods = invalidVodsResult.results || [];
    
    results.invalid = invalidVods.length;
    
    if (!dryRun && invalidVods.length > 0) {
      const ids = invalidVods.map((v: any) => v.id);
      const idsStr = ids.join(',');
      await d1.prepare(`DELETE FROM ys_vod WHERE id IN (${idsStr})`).run();
    }

    results.total = results.duplicates + results.bannedKeywords + results.disabledCategories + 
                   results.oldYear + results.invalidFormat + results.sourceDisabledCategories + results.invalid;

    return c.json(response.success({
      ...results,
      message: dryRun ? `共 ${results.total} 条数据将被清理` : `成功清理 ${results.total} 条数据`
    }));
  } catch (error) {
    console.error('data-clean all error:', error);
    return c.json(response.serverError('清理所有数据失败'));
  }
});

export default app;