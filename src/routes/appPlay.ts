import { Hono } from 'hono';
import { Env } from '../types/env';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

/**
 * 获取播放地址
 * GET /api/app/play?vodId=xxx&episodeIndex=0
 */
app.get('/', async (c) => {
  const { vodId, episodeIndex = '0' } = c.req.query();
  
  if (!vodId) {
    return c.json(response.error('vodId 不能为空', 1001));
  }

  const vid = parseInt(vodId);
  const epIndex = parseInt(episodeIndex);

  // 查找 vods 表
  const vodSQL = 'SELECT * FROM ys_vod WHERE id = ? AND status = 1';
  const vodResult = await c.env.DB.prepare(vodSQL).bind(vid).all();
  const vod = vodResult.results?.[0] as any;
  
  if (!vod) {
    return c.json(response.notFound('视频不存在'));
  }

  // 查找播放源列表
  const sourcesSQL = 'SELECT * FROM ys_vod_source WHERE vod_id = ?';
  const sourcesResult = await c.env.DB.prepare(sourcesSQL).bind(vid).all();
  const sources = (sourcesResult.results || []) as any[];

  let playUrl = '';
  let from = '';
  let episodeName = '';

  if (sources.length > 0) {
    // 优先使用 vodSources 表中的播放信息
    const source = sources[0];
    from = String(source.source_name || source.play_from || '默认');
    
    // 解析播放 URL，获取指定集数
    const episodes = parseEpisodes(String(source.play_from), String(source.play_url));
    if (episodes.length > epIndex) {
      playUrl = episodes[epIndex].url;
      episodeName = episodes[epIndex].name;
    } else {
      return c.json(response.error('该集数不存在', 1002));
    }
  } else if (vod.play_url) {
    // 降级使用 vods 表中的播放信息
    from = String(vod.play_from || '默认');
    const episodes = parseEpisodes(String(vod.play_from), String(vod.play_url));
    
    if (episodes.length > epIndex) {
      playUrl = episodes[epIndex].url;
      episodeName = episodes[epIndex].name;
    } else {
      // 如果解析失败，直接使用 playUrl
      playUrl = String(vod.play_url);
      const remarks = String(vod.remarks || '');
      episodeName = remarks.indexOf('集') >= 0 ? remarks : `第${epIndex + 1}集`;
    }
  } else {
    return c.json(response.error('没有找到播放地址', 1003));
  }

  return c.json(response.success({
    url: playUrl,
    from: from,
    episodeName: episodeName,
    episodeIndex: epIndex,
    vodId: vid
  }));
});

/**
 * 解析播放 URL 字符串为剧集数组
 */
function parseEpisodes(playFrom: string, playUrl: string): Array<{ name: string, url: string }> {
  playFrom = String(playFrom || '').trim();
  playUrl = String(playUrl || '').trim();
  
  if (!playFrom || !playUrl) {
    return [];
  }

  const episodes: Array<{ name: string, url: string }> = [];
  
  // 按 $$$ 分割播放源 (多播放源情况)
  const urls = playUrl.split('$$$');
  
  // 只处理第一个播放源的剧集
  const firstSourceUrls = urls[0] || '';
  
  if (firstSourceUrls.indexOf('#') >= 0) {
    // 格式：第 1 集$url1#第 2 集$url2#第 3 集$url3
    firstSourceUrls.split('#').forEach(ep => {
      const parts = ep.split('$');
      if (parts.length >= 2) {
        episodes.push({
          name: parts[0].trim(),
          url: parts[1].trim()
        });
      }
    });
  } else if (firstSourceUrls.indexOf('$') >= 0) {
    const parts = firstSourceUrls.split('$');
    if (parts.length === 2 && parts[1].startsWith('http')) {
      // 格式：名称$url（单集，如 HD$url）
      episodes.push({
        name: parts[0].trim() || '播放',
        url: parts[1].trim()
      });
    } else {
      // 格式：url1$url2$url3 (无集数名称)
      parts.forEach((url, idx) => {
        if (url.trim()) {
          episodes.push({
            name: `第${idx + 1}集`,
            url: url.trim()
          });
        }
      });
    }
  } else if (firstSourceUrls) {
    // 单个 URL
    episodes.push({
      name: '播放',
      url: firstSourceUrls.trim()
    });
  }

  return episodes;
}

export default app;

export { parseEpisodes };