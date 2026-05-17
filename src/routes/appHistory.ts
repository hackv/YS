import { Hono } from 'hono';
import { Env } from '../types/env';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

/**
 * 添加播放历史
 * POST /api/app/history
 */
app.post('/', async (c) => {
  const { vodId, episodeIndex, episodeName, playUrl, playProgress, duration, userId, deviceId } = await c.req.json();
  
  // 至少提供一个 userId 或 deviceId
  if (!userId && !deviceId) {
    return c.json(response.error('userId 或 deviceId 至少提供一个', 1001));
  }

  // 验证视频是否存在
  if (vodId) {
    const vodSQL = 'SELECT * FROM ys_vod WHERE id = ? AND status = 1';
    const vodResult = await c.env.DB.prepare(vodSQL).bind(vodId).all();
    if (!vodResult.results?.[0]) {
      return c.json(response.error('视频不存在', 1002));
    }
  }

  // 使用 userId 或 deviceId 查找现有记录
  let whereClause = '';
  let bindArgs: any[] = [];
  
  if (userId) {
    whereClause = 'user_id = ? AND vod_id = ?';
    bindArgs = [userId, vodId];
  } else if (deviceId) {
    whereClause = 'device_id = ? AND vod_id = ?';
    bindArgs = [deviceId, vodId];
  }

  const existingSQL = `SELECT * FROM ys_play_history WHERE ${whereClause}`;
  const existingResult = await c.env.DB.prepare(existingSQL).bind(...bindArgs).all();
  const existing = existingResult.results?.[0];

  if (existing) {
    // 更新现有记录
    const updateSQL = `
      UPDATE ys_play_history 
      SET episode_index = ?, episode_name = ?, play_url = ?, play_progress = ?, duration = ?, update_time = datetime('now', '+8 hours')
      WHERE id = ?
    `;
    await c.env.DB.prepare(updateSQL).bind(
      episodeIndex ?? existing.episode_index,
      episodeName || existing.episode_name,
      playUrl || existing.play_url,
      playProgress ?? existing.play_progress,
      duration ?? existing.duration,
      existing.id
    ).run();
  } else {
    // 插入新记录
    const insertSQL = `
      INSERT INTO ys_play_history (user_id, vod_id, episode_index, episode_name, play_url, play_progress, duration, device_id, create_time, update_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
    `;
    await c.env.DB.prepare(insertSQL).bind(
      userId || null,
      vodId || null,
      episodeIndex,
      episodeName,
      playUrl,
      playProgress,
      duration,
      deviceId
    ).run();
  }

  return c.json(response.success(null, '保存成功'));
});

/**
 * 获取播放历史
 * GET /api/app/history
 */
app.get('/', async (c) => {
  const { userId, deviceId, page = '1', pageSize = '20' } = c.req.query();
  
  // 至少提供一个 userId 或 deviceId
  if (!userId && !deviceId) {
    return c.json(response.error('userId 或 deviceId 至少提供一个', 1001));
  }

  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  // 获取历史记录列表
  let whereClause = '';
  let bindArgs: any[] = [];
  
  if (userId) {
    whereClause = 'h.user_id = ?';
    bindArgs = [userId];
  } else if (deviceId) {
    whereClause = 'h.device_id = ?';
    bindArgs = [deviceId];
  }

  const sql = `
    SELECT h.*, v.name as vod_name, v.pic as vod_pic
    FROM ys_play_history h
    LEFT JOIN ys_vod v ON h.vod_id = v.id
    WHERE ${whereClause}
    ORDER BY h.update_time DESC
    LIMIT ? OFFSET ?
  `;

  const historyResult = await c.env.DB.prepare(sql).bind(...bindArgs, pageSizeNum, offset).all();

  const list = (historyResult.results || []).map((row: any) => ({
    id: row.id,
    vodId: row.vod_id,
    episodeIndex: row.episode_index,
    episodeName: row.episode_name,
    playUrl: row.play_url,
    playProgress: row.play_progress,
    duration: row.duration,
    updateTime: row.update_time,
    vod: {
      id: row.vod_id,
      name: row.vod_name,
      pic: row.vod_pic
    }
  }));

  return c.json(response.success({
    list,
    total: list.length,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

/**
 * 删除播放历史
 * DELETE /api/app/history
 */
app.delete('/', async (c) => {
  const { id, userId, deviceId } = c.req.query();
  
  // 至少提供一个参数
  if (!id && !userId && !deviceId) {
    return c.json(response.error('id, userId 或 deviceId 至少提供一个', 1001));
  }

  // 构建 WHERE 条件
  const conditions: string[] = [];
  const bindArgs: any[] = [];
  
  if (id) {
    bindArgs.push(parseInt(id));
    conditions.push('id = ?');
  }
  
  if (userId) {
    bindArgs.push(parseInt(userId));
    conditions.push('user_id = ?');
  }
  
  if (deviceId) {
    bindArgs.push(deviceId);
    conditions.push('device_id = ?');
  }

  if (conditions.length === 0) {
    return c.json(response.error('无效的删除条件', 1001));
  }

  const whereClause = conditions.join(' AND ');
  const deleteSql = `DELETE FROM ys_play_history WHERE ${whereClause}`;

  await c.env.DB.prepare(deleteSql).bind(...bindArgs).run();

  return c.json(response.success(null, '删除成功'));
});

export default app;