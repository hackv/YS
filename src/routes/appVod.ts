import { Hono } from 'hono';
import { or } from 'drizzle-orm';
import { Env } from '../types/env';
import { vods, types, vodSources } from '../db';
import { createDatabase } from '../db';
import * as response from '../utils/response';

const app = new Hono<{ Bindings: Env }>();

/**
 * 获取分类及其所有子分类 ID
 */
function getAllChildIds(types: any[], parentId: number): number[] {
  const ids = [parentId];
  const children = types.filter(t => t.parent_id === parentId);
  children.forEach(child => {
    ids.push(...getAllChildIds(types, child.id));
  });
  return ids;
}

/**
 * 解析播放 URL 字符串为结构化数据
 * 支持新格式 (推荐) 和旧格式 (兼容)
 */
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
    
    if (urls.indexOf('#') >= 0) {
      // 格式：第 1 集$url1#第 2 集$url2
      episodes = urls.split('#').map(ep => {
        const parts = ep.split('$');
        return { name: (parts[0] || '').trim(), url: (parts[1] || '').trim() };
      }).filter(ep => !!ep.url);
    } else if (urls.indexOf('$') >= 0) {
      // 格式：url1$url2$url3(无集数名称)
      episodes = urls.split('$').map((url, idx) => ({ 
        name: `第${idx + 1}集`, 
        url: url.trim() 
      })).filter(u => u.url);
    } else if (urls) {
      // 单个 URL
      episodes = [{ name: '播放', url: urls }];
    }
    
    return { from, episodes };
  });
  
  return result;
}

/**
 * 转换视频数据字段为驼峰命名
 */
function convertVodToCamel(vod: any): any {
  if (!vod) return vod;
  
  return {
    id: vod.id,
    name: vod.name,
    subName: vod.sub_name,
    pic: vod.pic,
    score: vod.score && vod.score > 0 ? vod.score.toString() : '',
    year: vod.year,
    area: vod.area,
    type_name: vod.type_name,
    director: vod.director,
    vod_actor: vod.vod_actor,
    actor: vod.vod_actor,
    tag: vod.tag,
    remarks: vod.remarks,
    vod_content: vod.content,
    vod_hits: vod.hits,
    hits: vod.hits,
    createTime: vod.create_time,
    updateTime: vod.update_time
  };
}

/**
 * 获取首页内容
 * GET /api/app/vod/home
 */
app.get('/home', async (c) => {
  const limit = c.req.query('limit') || '6';
  const limitNum = parseInt(limit);

  // 获取轮播图 (使用热门视频作为轮播图)
  const bannersSQL = `
    SELECT * FROM ys_vod 
    WHERE status = 1 
    ORDER BY hits DESC 
    LIMIT ?
  `;
  const bannersResult = await c.env.DB.prepare(bannersSQL).bind(limitNum * 2).all();
  const banners = bannersResult.results || [];

  // 从数据库获取所有分类
  const allTypesSQL = 'SELECT id, name, parent_id FROM ys_type WHERE status = 1 ORDER BY parent_id, sort';
  const allTypesResult = await c.env.DB.prepare(allTypesSQL).all();
  const allTypes = allTypesResult.results || [];
  
  // 获取一级分类
  const dbCategories = allTypes.filter(t => t.parent_id === 0);
  
  // 如果数据库没有分类，使用默认分类
  const categories = dbCategories.length > 0 
    ? dbCategories.map(cat => ({ name: cat.name, typeId: cat.id }))
    : [
        { name: '热门', typeId: 0 },
        { name: '电影', typeId: 1 },
        { name: '电视剧', typeId: 2 },
        { name: '动漫', typeId: 3 },
        { name: '综艺', typeId: 4 },
        { name: '短剧', typeId: 5 },
      ];

  const categoryResults = [];
  
  // 分类别名映射（数据库名称 -> 前端显示名称）
  const categoryNames: Record<string, string> = {
    '电影': '电影',
    '电视剧': '电视剧',
    '连续剧': '电视剧',
    '短剧': '短剧',
    '动漫': '动漫',
    '综艺': '综艺',
    '纪录片': '纪录片',
    '其他': '其他'
  };
  
  for (const category of categories) {
    if (!categoryNames[category.name]) {
      continue;
    }
    
    let conditions = ['status = 1'];
    let bindArgs: any[] = [];
    
    if (category.typeId > 0) {
      const childIds = getAllChildIds(allTypes, category.typeId);
      const placeholders = childIds.map(() => '?').join(',');
      conditions.push(`type_id IN (${placeholders})`);
      bindArgs.push(...childIds);
    }
    
    const whereClause = conditions.join(' AND ');
    const categorySQL = `
      SELECT * FROM ys_vod 
      WHERE ${whereClause} 
      ORDER BY hits DESC 
      LIMIT ?
    `;
    
    const categoryResult = await c.env.DB.prepare(categorySQL).bind(...bindArgs, limitNum).all();
    let vodsList = categoryResult.results || [];
    
    // 如果该分类没有视频，使用热门视频作为补充
    if (vodsList.length === 0 && category.typeId !== 0) {
      const hotSQL = `
        SELECT * FROM ys_vod 
        WHERE status = 1 
        ORDER BY hits DESC 
        LIMIT ?
      `;
      const hotResult = await c.env.DB.prepare(hotSQL).bind(limitNum).all();
      vodsList = hotResult.results || [];
    }
    
    categoryResults.push({
      typeId: category.typeId,
      typeName: categoryNames[category.name],  // 使用前端显示名称
      vods: vodsList.map(vod => convertVodToCamel(vod))
    });
  }

  return c.json(response.success({
    banners: banners.map(vod => ({
      id: vod.id,
      name: vod.name,
      pic: vod.pic,
      score: vod.score && vod.score > 0 ? vod.score.toString() : '',
      remarks: vod.remarks
    })),
    categories: categoryResults
  }));
});

/**
 * 获取排行榜
 * GET /api/app/vod/rank?type=hot&limit=10&category=电视剧
 */
app.get('/rank', async (c) => {
  let type = c.req.query('type') || 'hot';
  const limit = c.req.query('limit') || '10';
  let category = c.req.query('category');
  const limitNum = parseInt(limit);
  
  // 前端 type 参数到分类名称的映射（前端传值->数据库分类名称）
  const frontendTypeToCategory: Record<string, string> = {
    'tv': '电视剧',
    'movie': '电影',
    'short': '短剧',
    'anime': '动漫',
    'variety': '综艺',
    'documentary': '纪录片'
  };
  
  // 如果 type 是分类类型，映射为 category 参数
  if (frontendTypeToCategory[type]) {
    if (!category) {
      category = frontendTypeToCategory[type];
    }
    // 对于分类类型，保持按播放量排序
    type = 'hot';
  }

  let conditions = ['status = 1'];
  let bindArgs: any[] = [];

  if (category) {
    const allTypesSQL = 'SELECT id, name, parent_id FROM ys_type WHERE status = 1';
    const allTypesResult = await c.env.DB.prepare(allTypesSQL).all();
    const allTypes = allTypesResult.results || [];
    
    let categoryIds: number[] = [];
    
    const categoryAliases: Record<string, string> = {
      // 电视剧系列 -> 数据库分类名称
      '电视剧': '电视剧',
      '连续剧': '电视剧',
      '剧集': '电视剧',
      '追剧': '电视剧',
      '热播剧': '电视剧',
      '台剧': '台剧',
      '韩剧': '韩剧',
      '美剧': '美剧',
      '港剧': '港剧',
      '日剧': '日剧',
      '英剧': '英剧',
      '海外剧': '美剧',
      
      // 电影系列
      '电影': '电影',
      '影片': '电影',
      '大片': '电影',
      '院线': '电影',
      
      // 短剧系列
      '短剧': '短剧',
      '微短剧': '短剧',
      '迷你剧': '短剧',
      '快手短剧': '短剧',
      '抖音短剧': '短剧',
      
      // 动漫系列
      '动漫': '动漫',
      '动画': '动漫',
      '动画片': '动漫',
      '日本动漫': '动漫',
      '国产动漫': '动漫',
      '日韩动漫': '动漫',
      '欧美动漫': '动漫',
      '国漫': '动漫',
      '日漫': '动漫',
      
      // 综艺系列
      '综艺': '综艺',
      '真人秀': '综艺',
      '娱乐': '综艺',
      '脱口秀': '综艺',
      '大陆综艺': '综艺',
      '日韩综艺': '综艺',
      '欧美综艺': '综艺',
      
      // 纪录片系列
      '纪录片': '纪录片',
      '记录片': '纪录片',
      '纪实': '纪录片',
      '纪录片电影': '纪录片',
      
      // 纪录片细分
      '纪录电影': '纪录片',
      '人文纪录': '纪录片',
      '自然纪录': '纪录片',
      
      // 其他
      '其他': '其他'
    };
    
    const normalizedCategory = categoryAliases[category] || category;
    
    const foundByName = allTypes.find((t: any) => t.name === normalizedCategory);
    if (foundByName) {
      categoryIds = getAllChildIds(allTypes, foundByName.id);
    } else if (/^\d+$/.test(category)) {
      const categoryId = parseInt(category);
      categoryIds = getAllChildIds(allTypes, categoryId);
    }
    
    if (categoryIds.length > 0) {
      const placeholders = categoryIds.map(() => '?').join(',');
      conditions.push(`type_id IN (${placeholders})`);
      bindArgs.push(...categoryIds);
    }
  }

  let orderBy = 'hits DESC';
  if (type === 'new') {
    orderBy = 'update_time DESC';
  }

  const whereClause = conditions.join(' AND ');

  const sql = `
    SELECT * FROM ys_vod 
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  
  const result = await c.env.DB.prepare(sql).bind(...bindArgs, limitNum).all();
  let list = result.results || [];

  // 如果分类下没有视频，返回热门视频作为补充
  if (category && list.length === 0) {
    const fallbackSQL = `
      SELECT * FROM ys_vod 
      WHERE status = 1 
      ORDER BY hits DESC
      LIMIT ?
    `;
    const fallbackResult = await c.env.DB.prepare(fallbackSQL).bind(limitNum).all();
    list = fallbackResult.results || [];
  }

  const results = list.map((vod: any) => ({
    id: vod.id,
    name: vod.name,
    pic: vod.pic,
    score: vod.score && vod.score > 0 ? vod.score.toString() : '',
    remarks: vod.remarks,
    hits: vod.hits
  }));

  return c.json(response.success(results));
});

/**
 * 获取分类内容
 * GET /api/app/vod/category?category=xxx&area=xxx&year=xxx&tag=xxx&sort=hits&page=1&pageSize=20
 */
app.get('/category', async (c) => {
  const category = c.req.query('category');
  const wd = c.req.query('wd');  // 关键词搜索
  const source = c.req.query('source');  // 爬虫源
  const tag = c.req.query('tag');
  const area = c.req.query('area');
  const year = c.req.query('year');
  const sort = c.req.query('sort') || 'hits';
  const page = c.req.query('page') || '1';
  const pageSize = c.req.query('pageSize') || '20';

  const pageNum = parseInt(page);
  const pageSizeNum = parseInt(pageSize);
  const offset = (pageNum - 1) * pageSizeNum;

  // 构建查询条件
  let conditions = ['status = 1'];
  let bindArgs: any[] = [];
  
  // 关键词搜索支持：name、vod_name、subName、sub_name
  if (wd && wd.trim() !== '') {
    conditions.push('(name LIKE ? OR sub_name LIKE ?)');
    const keyword = `%${wd}%`;
    bindArgs.push(keyword, keyword);
  }
  
  // 爬虫源筛选
  if (source && source.trim() !== '') {
    conditions.push('source_id = ?');
    bindArgs.push(parseInt(source));
  }

  if (category) {
    // 从数据库获取所有分类
    const allTypesSQL = 'SELECT id, name, parent_id FROM ys_type WHERE status = 1';
    const allTypesResult = await c.env.DB.prepare(allTypesSQL).all();
    const allTypes = allTypesResult.results || [];
    
    // 查找分类ID（支持按名称或ID查询）
    let categoryIds: number[] = [];
    
    const categoryAliases: Record<string, string> = {
      // 电视剧系列
      '电视剧': '电视剧',
      '连续剧': '电视剧',
      '剧集': '电视剧',
      '追剧': '电视剧',
      '热播剧': '电视剧',
      '台剧': '台剧',
      '韩剧': '韩剧',
      '美剧': '美剧',
      '港剧': '港剧',
      '日剧': '日剧',
      '英剧': '英剧',
      '海外剧': '美剧',
      
      // 电影系列
      '电影': '电影',
      '影片': '电影',
      '大片': '电影',
      '院线': '电影',
      
      // 短剧系列
      '短剧': '短剧',
      '微短剧': '短剧',
      '迷你剧': '短剧',
      '快手短剧': '短剧',
      '抖音短剧': '短剧',
      
      // 动漫系列
      '动漫': '动漫',
      '动画': '动漫',
      '动画片': '动漫',
      '日本动漫': '动漫',
      '国产动漫': '动漫',
      '日韩动漫': '动漫',
      '欧美动漫': '动漫',
      '国漫': '动漫',
      '日漫': '动漫',
      
      // 综艺系列
      '综艺': '综艺',
      '真人秀': '综艺',
      '娱乐': '综艺',
      '脱口秀': '综艺',
      '大陆综艺': '综艺',
      '日韩综艺': '综艺',
      '欧美综艺': '综艺',
      
      // 纪录片系列
      '纪录片': '纪录片',
      '记录片': '纪录片',
      '纪实': '纪录片',
      '纪录片电影': '纪录片',
      
      // 纪录片细分
      '纪录电影': '纪录片',
      '人文纪录': '纪录片',
      '自然纪录': '纪录片',
      
      // 其他
      '其他': '其他'
    };
    
    const normalizedCategory = categoryAliases[category] || category;
    
    // 尝试按名称查找
    const foundByName = allTypes.find(t => t.name === normalizedCategory);
    if (foundByName) {
      categoryIds = getAllChildIds(allTypes, foundByName.id);
    } else if (/^\d+$/.test(category)) {
      // 尝试按ID查找
      const categoryId = parseInt(category);
      categoryIds = getAllChildIds(allTypes, categoryId);
    }
    
    if (categoryIds.length > 0) {
      const placeholders = categoryIds.map(() => '?').join(',');
      conditions.push(`type_id IN (${placeholders})`);
      bindArgs.push(...categoryIds);
    }
  }

  if (tag) {
    conditions.push('tag LIKE ?');
    bindArgs.push(`%${tag}%`);
  }
  
  // 地区别名映射（前端参数 -> 数据库值）
  const areaAliases: Record<string, string> = {
    // 大陆系列同义词
    '中国大陆': '大陆',
    '中国': '大陆',
    '大陆': '大陆',
    '国产': '大陆',
    '国内': '大陆',
    '内地': '大陆',
    '华人': '大陆',
    '汉语': '大陆',
    
    // 日本系列
    '日本': '日本',
    '日本动漫': '日本',
    '日': '日本',
    
    // 韩国系列
    '韩国': '韩国',
    '韩剧': '韩国',
    '韩': '韩国',
    '南韩': '韩国',
    
    // 日韩系列
    '日韩': '日韩',
    '韩国日本': '日韩',
    
    // 欧美系列
    '欧美': '欧美',
    '西方': '欧美',
    '西方世界': '欧美',
    
    // 美国系列
    '美国': '美国',
    'USA': '美国',
    'merica': '美国',
    '美': '美国',
    '好莱坞': '美国',
    
    // 英国系列
    '英国': '英国',
    'UK': '英国',
    'Britian': '英国',
    '英伦': '英国',
    '英': '英国',
    
    // 香港系列
    '香港': '香港',
    '港': '香港',
    '港剧': '香港',
    '港片': '香港',
    '粤语': '香港',
    'HK': '香港',
    
    // 台湾系列
    '台湾': '台湾',
    '台': '台湾',
    '台剧': '台湾',
    '台版': '台湾',
    'TW': '台湾',
    
    // 其他国家/地区
    '泰国': '泰国',
    '泰': '泰国',
    '泰剧': '泰国',
    
    '新加坡': '新加坡',
    '星': '新加坡',
    
    '印度': '印度',
    '印': '印度',
    '宝莱坞': '印度',
    
    '法国': '法国',
    '法': '法国',
    
    '德国': '德国',
    '德': '德国',
    
    '加拿大': '加拿大',
    '加': '加拿大',
    
    '澳大利亚': '澳大利亚',
    '澳洲': '澳大利亚',
    '澳': '澳大利亚',
    
    '俄罗斯': '俄罗斯',
    '俄': '俄罗斯',
    
    '意大利': '意大利',
    '意': '意大利',
    
    '西班牙': '西班牙',
    '西': '西班牙',
    
    '巴西': '巴西',
    '巴': '巴西',
    
    '伊朗': '伊朗',
    '伊朗电影': '伊朗',
    
    // 其他
    '其他': '其它',
    '其它': '其它',
    '未知': '其它',
    '不明': '其它',
    '国外': '欧美'
  };
  
  if (area) {
    const normalizedArea = areaAliases[area] || area;
    conditions.push('area = ?');
    bindArgs.push(normalizedArea);
  }
  
  // 年份语法处理
  if (year) {
    // 支持 "2024-2025" 范围内的筛选
    if (year.indexOf('-') >= 0) {
      const yearRange = year.split('-');
      const startYear = yearRange[0].trim();
      const endYear = yearRange[1].trim();
      conditions.push('year >= ? AND year <= ?');
      bindArgs.push(startYear, endYear);
    } else {
      conditions.push('year = ?');
      bindArgs.push(year);
    }
  }

  const whereClause = conditions.join(' AND ');
  
  // 排序
  let orderBy = 'hits DESC';
  if (sort === 'time') {
    orderBy = 'update_time DESC';
  }

  const countSQL = `SELECT COUNT(*) as cnt FROM ys_vod WHERE ${whereClause}`;
  const countResult = await c.env.DB.prepare(countSQL).bind(...bindArgs).first();
  let total = countResult?.cnt || 0;

  const listSQL = `
    SELECT * FROM ys_vod WHERE ${whereClause} 
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  const listResult = await c.env.DB.prepare(listSQL).bind(...bindArgs, pageSizeNum, offset).all();
  let list = (listResult.results || []).map(vod => convertVodToCamel(vod));

  // 仅当没有地区/年份筛选且分类下没有视频时，才返回热门视频作为补充
  if (!area && !year && list.length === 0 && category) {
    const fallbackSQL = `
      SELECT * FROM ys_vod 
      WHERE status = 1 
      ORDER BY hits DESC
      LIMIT ? OFFSET ?
    `;
    const fallbackResult = await c.env.DB.prepare(fallbackSQL).bind(pageSizeNum, offset).all();
    list = (fallbackResult.results || []).map(vod => convertVodToCamel(vod));
    total = list.length;
  }

  return c.json(response.success({
    list,
    total,
    page: pageNum,
    pageSize: pageSizeNum
  }));
});

/**
 * 获取筛选选项
 * GET /api/app/vod/filter-options?category=xxx
 */
app.get('/filter-options', async (c) => {
  // 静态筛选选项
  const tags = ['剧情', '古装', '历史', '穿越', '爱情', '都市', '悬疑', '动作', '喜剧', '科幻', '冒险', '战争', '犯罪'];
  const areas = ['中国大陆', '中国香港', '中国台湾', '美国', '日本', '韩国', '英国', '法国', '其他'];
  
  // 生成年份列表 (2000 到当前年份)
  const currentYear = new Date().getFullYear();
  const years: string[] = [];
  for (let i = currentYear; i >= 2000; i--) {
    years.push(i.toString());
  }
  
  const sorts = [
    { label: '按播放量', value: 'hits' },
    { label: '按更新时间', value: 'time' }
  ];

  return c.json(response.success({
    tags: tags.map(val => ({ label: val, value: val })),
    areas: areas.map(val => ({ label: val, value: val })),
    years: years.map(val => ({ label: val, value: val })),
    sorts
  }));
});

/**
 * 检查更新
 * GET /api/app/vod/updates?since=xxx&ids=xxx&limit=100
 */
app.get('/updates', async (c) => {
  const since = c.req.query('since');
  const ids = c.req.query('ids');
  const limit = c.req.query('limit') || '100';
  const limitNum = Math.min(parseInt(limit), 500);

  let conditions = ['status = 1'];
  let bindArgs: any[] = [];

  if (since) {
    conditions.push('update_time > ?');
    bindArgs.push(since);
  }

  if (ids) {
    const idArray = ids.split(',').map(id => parseInt(id));
    const placeholders = idArray.map(() => '?').join(',');
    conditions.push(`id IN (${placeholders})`);
    bindArgs.push(...idArray);
  }

  const whereClause = conditions.join(' AND ');
  
  const listSQL = `
    SELECT id, name, pic, score, remarks, hits, update_time 
    FROM ys_vod 
    WHERE ${whereClause} 
    ORDER BY update_time DESC 
    LIMIT ?
  `;
  const listResult = await c.env.DB.prepare(listSQL).bind(...bindArgs, limitNum).all();
  
  const currentTime = new Date().toISOString();

  return c.json(response.success({
    updatedIds: (listResult.results || []).map((vod: any) => vod.id),
    currentTime
  }));
});

export default app;