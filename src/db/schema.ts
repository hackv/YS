import { sqliteTable, text, integer, real, blob, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const admins = sqliteTable('ys_admin', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username', { length: 50 }).notNull().unique(),
  password: text('password', { length: 255 }).notNull(),
  nickname: text('nickname', { length: 50 }),
  email: text('email', { length: 100 }),
  phone: text('phone', { length: 20 }),
  avatar: text('avatar', { length: 255 }),
  role: integer('role', { mode: 'number' }).default(1),
  status: integer('status', { mode: 'number' }).default(1),
  lastLoginTime: text('last_login_time'),
  lastLoginIp: text('last_login_ip', { length: 50 }),
  loginCount: integer('login_count', { mode: 'number' }).default(0),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const users = sqliteTable('ys_user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username', { length: 50 }).unique(),
  password: text('password', { length: 255 }),
  nickname: text('nickname', { length: 50 }),
  email: text('email', { length: 100 }),
  phone: text('phone', { length: 20 }),
  avatar: text('avatar', { length: 255 }),
  groupId: integer('group_id', { mode: 'number' }).default(1),
  points: integer('points', { mode: 'number' }).default(0),
  status: integer('status', { mode: 'number' }).default(1),
  deviceId: text('device_id', { length: 100 }),
  lastLoginTime: text('last_login_time'),
  lastLoginIp: text('last_login_ip', { length: 50 }),
  vipExpireTime: text('vip_expire_time'),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const types = sqliteTable('ys_type', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { length: 60 }).notNull(),
  enName: text('en_name', { length: 60 }),
  parentId: integer('parent_id', { mode: 'number' }).default(0),
  sort: integer('sort', { mode: 'number' }).default(0),
  status: integer('status', { mode: 'number' }).default(1),
  logo: text('logo', { length: 255 }),
  pic: text('pic', { length: 1024 }),
  description: text('description', { length: 255 }),
  type: integer('type', { mode: 'number' }).default(1),
  sourceId: integer('source_id', { mode: 'number' }),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
}, (table) => ({
  parentIdIdx: index('idx_parentid_status').on(table.parentId, table.status),
  typeIdx: index('idx_type_status').on(table.type, table.status)
}));

export const vods = sqliteTable('ys_vod', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { length: 255 }).notNull(),
  subName: text('sub_name', { length: 255 }),
  enName: text('en_name', { length: 255 }),
  typeId: integer('type_id', { mode: 'number' }).default(0),
  typeId1: integer('type_id1', { mode: 'number' }).default(0),
  status: integer('status', { mode: 'number' }).default(1),
  letter: text('letter', { length: 1 }),
  normalizedName: text('normalized_name', { length: 255 }),
  color: text('color', { length: 6 }),
  tag: text('tag', { length: 100 }),
  class: text('class', { length: 255 }),
  pic: text('pic', { length: 1024 }),
  picThumb: text('pic_thumb', { length: 1024 }),
  picSlide: text('pic_slide', { length: 1024 }),
  picScreenshot: text('pic_screenshot'),
  actor: text('actor', { length: 255 }),
  director: text('director', { length: 255 }),
  writer: text('writer', { length: 100 }),
  blurb: text('blurb', { length: 255 }),
  remarks: text('remarks', { length: 100 }),
  pubdate: text('pubdate', { length: 100 }),
  total: integer('total', { mode: 'number' }).default(0),
  serial: text('serial', { length: 20 }).default('0'),
  area: text('area', { length: 20 }),
  lang: text('lang', { length: 10 }),
  year: text('year', { length: 10 }),
  version: text('version', { length: 30 }),
  state: text('state', { length: 30 }),
  level: integer('level', { mode: 'number' }).default(0),
  copyright: integer('copyright', { mode: 'number' }).default(0),
  points: integer('points', { mode: 'number' }).default(0),
  hits: integer('hits', { mode: 'number' }).default(0),
  hitsDay: integer('hits_day', { mode: 'number' }).default(0),
  hitsWeek: integer('hits_week', { mode: 'number' }).default(0),
  hitsMonth: integer('hits_month', { mode: 'number' }).default(0),
  duration: text('duration', { length: 10 }),
  up: integer('up', { mode: 'number' }).default(0),
  down: integer('down', { mode: 'number' }).default(0),
  score: real('score').default(0.0),
  scoreAll: integer('score_all', { mode: 'number' }).default(0),
  scoreNum: integer('score_num', { mode: 'number' }).default(0),
  doubanId: integer('douban_id', { mode: 'number' }).default(0),
  doubanScore: real('douban_score').default(0.0),
  content: text('content'),
  playFrom: text('play_from', { length: 255 }),
  playServer: text('play_server', { length: 255 }),
  playNote: text('play_note', { length: 255 }),
  playUrl: text('play_url'),
  downFrom: text('down_from', { length: 255 }),
  downServer: text('down_server', { length: 255 }),
  downNote: text('down_note', { length: 255 }),
  downUrl: text('down_url'),
  sourceId: integer('source_id', { mode: 'number' }),
  sourceVodId: text('source_vod_id', { length: 50 }),
  collectTime: text('collect_time'),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
}, (table) => ({
  letterNameIdx: index('idx_letter_name').on(table.letter, table.name),
  normalizedNameTypeIdIdx: index('idx_normalized_name_typeid').on(table.normalizedName, table.typeId),
  typeIdStatusIdx: index('idx_typeid_status').on(table.typeId, table.status),
  typeId1StatusIdx: index('idx_typeid1_status').on(table.typeId1, table.status),
  statusUpdatedAtIdx: index('idx_status_updatedat').on(table.status, table.updateTime),
  statusHitsIdx: index('idx_status_hits').on(table.status, table.hits),
  statusHitsWeekIdx: index('idx_status_hitsweek').on(table.status, table.hitsWeek),
  statusLevelIdx: index('idx_status_level').on(table.status, table.level),
  statusScoreIdx: index('idx_status_score').on(table.status, table.score),
  areaIdx: index('idx_area').on(table.area),
  yearIdx: index('idx_year').on(table.year),
  sourceIdIdx: index('idx_sourceid').on(table.sourceId),
  typeIdTypeId1StatusIdx: index('idx_typeid_typeid1_status').on(table.typeId, table.typeId1, table.status)
}));

export const vodSources = sqliteTable('ys_vod_source', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vodId: integer('vod_id', { mode: 'number' }).notNull(),
  sourceId: integer('source_id', { mode: 'number' }),
  sourceVodId: text('source_vod_id', { length: 50 }),
  sourceName: text('source_name', { length: 100 }),
  playFrom: text('play_from', { length: 255 }),
  playUrl: text('play_url'),
  playServer: text('play_server', { length: 255 }),
  playNote: text('play_note', { length: 255 }),
  priority: integer('priority', { mode: 'number' }).default(0),
  status: integer('status', { mode: 'number' }).default(1),
  name: text('name', { length: 100 }),
  url: text('url'),
  sort: integer('sort', { mode: 'number' }).default(0),
  collectTime: text('collect_time'),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const spiderSources = sqliteTable('ys_spider_source', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { length: 100 }).notNull(),
  code: text('code', { length: 50 }).notNull().unique(),
  type: integer('type', { mode: 'number' }).default(1),
  apiHost: text('api_host', { length: 255 }),
  script: text('script'),
  scriptPath: text('script_path', { length: 255 }),
  description: text('description'),
  status: integer('status', { mode: 'number' }).default(1),
  priority: integer('priority', { mode: 'number' }).default(0),
  collectMode: text('collect_mode', { length: 20 }).default('increment'),
  cronExpression: text('cron_expression', { length: 100 }),
  categoryId: integer('category_id', { mode: 'number' }),
  config: text('config'),
  disabledCategories: text('disabled_categories'),
  bannedKeywords: text('banned_keywords'),
  lastCollectTime: text('last_collect_time'),
  collectCount: integer('collect_count', { mode: 'number' }).default(0),
  successCount: integer('success_count', { mode: 'number' }).default(0),
  failCount: integer('fail_count', { mode: 'number' }).default(0),
  errorCount: integer('error_count', { mode: 'number' }).default(0),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const collectTasks = sqliteTable('ys_collect_task', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { length: 100 }).notNull(),
  sourceId: integer('source_id', { mode: 'number' }).notNull(),
  type: integer('type', { mode: 'number' }).default(2),
  status: integer('status', { mode: 'number' }).default(0),
  schedule: text('schedule', { length: 50 }),
  params: text('params'),
  total: integer('total', { mode: 'number' }).default(0),
  success: integer('success', { mode: 'number' }).default(0),
  failed: integer('failed', { mode: 'number' }).default(0),
  startTime: text('start_time'),
  endTime: text('end_time'),
  errorLog: text('error_log'),
  collectMode: integer('collect_mode', { mode: 'number' }).default(2),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const collectTaskLogs = sqliteTable('ys_collect_task_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id', { mode: 'number' }).notNull(),
  taskName: text('task_name', { length: 100 }).notNull(),
  sourceId: integer('source_id', { mode: 'number' }).notNull(),
  sourceName: text('source_name', { length: 100 }),
  taskType: integer('task_type', { mode: 'number' }).notNull(),
  status: integer('status', { mode: 'number' }).default(0),
  startTime: text('start_time'),
  endTime: text('end_time'),
  duration: integer('duration', { mode: 'number' }),
  total: integer('total', { mode: 'number' }).default(0),
  success: integer('success', { mode: 'number' }).default(0),
  failed: integer('failed', { mode: 'number' }).default(0),
  errorLog: text('error_log'),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const playHistories = sqliteTable('ys_play_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id', { mode: 'number' }),
  vodId: integer('vod_id', { mode: 'number' }).notNull(),
  episodeIndex: integer('episode_index', { mode: 'number' }).default(0),
  episodeName: text('episode_name', { length: 100 }),
  playUrl: text('play_url', { length: 1024 }),
  playProgress: integer('play_progress', { mode: 'number' }).default(0),
  duration: integer('duration', { mode: 'number' }).default(0),
  deviceId: text('device_id', { length: 100 }),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const rechargePackages = sqliteTable('ys_recharge_package', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { length: 100 }).notNull(),
  price: real('price').notNull(),
  points: integer('points', { mode: 'number' }).notNull(),
  bonusPoints: integer('bonus_points', { mode: 'number' }).default(0),
  description: text('description', { length: 255 }),
  sort: integer('sort', { mode: 'number' }).default(0),
  status: integer('status', { mode: 'number' }).default(1),
  isRecommend: integer('is_recommend', { mode: 'number' }).default(0),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const pointsRecords = sqliteTable('ys_points_record', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id', { mode: 'number' }).notNull(),
  type: integer('type', { mode: 'number' }).notNull(),
  points: integer('points', { mode: 'number' }).notNull(),
  balance: integer('balance', { mode: 'number' }).notNull(),
  relatedId: integer('related_id', { mode: 'number' }),
  relatedType: text('related_type', { length: 50 }),
  description: text('description', { length: 255 }),
  operatorId: integer('operator_id', { mode: 'number' }),
  operatorIp: text('operator_ip', { length: 50 }),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`)
});

export const paymentOrders = sqliteTable('ys_payment_order', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderNo: text('order_no', { length: 64 }).notNull().unique(),
  userId: integer('user_id', { mode: 'number' }).notNull(),
  packageId: integer('package_id', { mode: 'number' }).notNull(),
  amount: real('amount').notNull(),
  points: integer('points', { mode: 'number' }).notNull(),
  bonusPoints: integer('bonus_points', { mode: 'number' }).default(0),
  status: integer('status', { mode: 'number' }).default(0),
  payType: text('pay_type', { length: 20 }),
  transactionId: text('transaction_id', { length: 64 }),
  payTime: text('pay_time'),
  expireTime: text('expire_time'),
  deviceId: text('device_id', { length: 100 }),
  clientIp: text('client_ip', { length: 50 }),
  remark: text('remark', { length: 255 }),
  requestId: text('request_id', { length: 64 }),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const bannedKeywords = sqliteTable('ys_banned_keyword', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword', { length: 100 }).notNull(),
  type: integer('type', { mode: 'number' }).default(1),
  sourceId: integer('source_id', { mode: 'number' }),
  matchField: text('match_field', { length: 255 }).default('all'),
  matchMode: text('match_mode', { length: 20 }).default('contains'),
  status: integer('status', { mode: 'number' }).default(1),
  remark: text('remark', { length: 255 }),
  hitCount: integer('hit_count', { mode: 'number' }).default(0),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});

export const announcements = sqliteTable('ys_announcement', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title', { length: 200 }).notNull(),
  content: text('content').notNull(),
  type: integer('type', { mode: 'number' }).default(1),
  targetType: integer('target_type', { mode: 'number' }).default(1),
  imageUrl: text('image_url', { length: 500 }),
  linkUrl: text('link_url', { length: 500 }),
  startTime: text('start_time'),
  endTime: text('end_time'),
  sort: integer('sort', { mode: 'number' }).default(0),
  status: integer('status', { mode: 'number' }).default(1),
  isPopup: integer('is_popup', { mode: 'number' }).default(0),
  viewCount: integer('view_count', { mode: 'number' }).default(0),
  adminId: integer('admin_id', { mode: 'number' }),
  createTime: text('create_time').default(sql`datetime('now', '+8 hours')`),
  updateTime: text('update_time').default(sql`datetime('now', '+8 hours')`)
});