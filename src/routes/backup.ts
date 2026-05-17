import { Hono } from 'hono';
import { Env } from '../types/env';
import * as response from '../utils/response';
import { createDatabase } from '../db';
import {
  admins,
  users,
  types,
  vods,
  vodSources,
  spiderSources,
  collectTasks,
  collectTaskLogs,
  playHistories,
  rechargePackages,
  pointsRecords,
  paymentOrders,
  bannedKeywords,
  announcements
} from '../db';

const app = new Hono<{ Bindings: Env }>();

interface BackupFileInfo {
  id: string;
  name: string;
  size: number;
  sizeBytes: number;
  createdAtFormatted: string;
  isExpired: boolean;
}

function formatBeijingTime(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(date);
}

function generateBackupFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `YS_backup_${year}-${month}-${day}-${hours}${minutes}.sql`;
}

/**
 * 格式化文件大小
 * @param bytes - 文件大小（字节）
 * @returns 格式化后的文件大小字符串
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

app.get('/', async (c) => {
  try {
    const bucket = c.env.BACKUP_BUCKET;
    const daysToKeepStr = c.req.query('daysToKeep');
    const daysToKeep = parseInt(daysToKeepStr || '30');

    if (!bucket) {
      return c.json(response.error('R2存储桶未配置'));
    }

    const listResult = await bucket.list({
      prefix: 'YS_backup_'
    });

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const files: BackupFileInfo[] = [];
    for (const file of listResult.objects) {
      files.push({
        id: file.key,
        name: file.key,
        size: formatFileSize(file.size),
        sizeBytes: file.size,
        createdAtFormatted: new Date(file.uploaded).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai'
        }),
        isExpired: new Date(file.uploaded) < cutoffDate
      });
    }

    files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

    return c.json(response.success({
      list: files,
      total: files.length,
      page: 1,
      pageSize: 20
    }));
  } catch (error) {
    console.error('获取备份文件列表失败:', error);
    return c.json(response.error('获取备份文件列表失败'));
  }
});

app.post('/', async (c) => {
  try {
    const db = c.env.DB;
    const bucket = c.env.BACKUP_BUCKET;

    if (!db) {
      return c.json(response.error('数据库连接不可用'));
    }

    if (!bucket) {
      return c.json(response.error('R2存储桶未配置'));
    }

    const drizzleDb = createDatabase(db);
    const backupFileName = generateBackupFileName();

    let backupData = '-- Database backup\n-- Generated at: ' + formatBeijingTime() + '\n-- Using Drizzle ORM\n\n';

    const tableMap = [
      { name: 'ys_admin', schema: admins },
      { name: 'ys_user', schema: users },
      { name: 'ys_type', schema: types },
      { name: 'ys_vod', schema: vods },
      { name: 'ys_vod_source', schema: vodSources },
      { name: 'ys_spider_source', schema: spiderSources },
      { name: 'ys_collect_task', schema: collectTasks },
      { name: 'ys_collect_task_log', schema: collectTaskLogs },
      { name: 'ys_play_history', schema: playHistories },
      { name: 'ys_recharge_package', schema: rechargePackages },
      { name: 'ys_points_record', schema: pointsRecords },
      { name: 'ys_payment_order', schema: paymentOrders },
      { name: 'ys_banned_keyword', schema: bannedKeywords },
      { name: 'ys_announcement', schema: announcements }
    ];

    let tableCount = 0;

    for (const tableInfo of tableMap) {
      try {
        const tableData = await drizzleDb.select().from(tableInfo.schema);

        if (tableData.length > 0) {
          backupData += `-- Table: ${tableInfo.name} (${tableData.length} rows)\n`;

          for (const row of tableData) {
            const columns = Object.keys(row as object);
            const values = Object.values(row as object).map(v => {
              if (v === null) return 'NULL';
              if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
              if (typeof v === 'boolean') return v ? 1 : 0;
              return String(v);
            });

            backupData += `INSERT INTO "${tableInfo.name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});\n`;
          }
          backupData += '\n';
          tableCount++;
        }
      } catch (tableError) {
        console.warn(`获取表 ${tableInfo.name} 数据时出错:`, tableError);
      }
    }

    await bucket.put(backupFileName, backupData, {
      httpMetadata: {
        contentType: 'text/plain',
        contentDisposition: `attachment; filename="${backupFileName}"`
      },
      customMetadata: {
        type: 'database_backup',
        createdAt: new Date().toISOString(),
        source: 'manual_backup'
      }
    });

    return c.json(response.success({
      backupPath: backupFileName,
      timestamp: formatBeijingTime(),
      tableCount,
      fileSize: backupData.length
    }, '数据库备份执行成功'));
  } catch (error) {
    console.error('手动执行数据库备份失败:', error);
    return c.json(response.error('备份任务执行失败'));
  }
});

app.post('/:id/restore', async (c) => {
  try {
    const { id } = c.req.param();

    if (!id) {
      return c.json(response.error('备份文件名不能为空'));
    }

    const db = c.env.DB;
    const bucket = c.env.BACKUP_BUCKET;

    if (!bucket) {
      return c.json(response.error('R2存储桶未配置'));
    }

    const object = await bucket.get(id);

    if (!object) {
      return c.json(response.error(`备份文件不存在: ${id}`));
    }

    const backupData = await object.text();

    const statements = backupData
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      try {
        await db.exec(statement);
      } catch (stmtError) {
        console.warn(`执行SQL语句时出错（可能是DDL语句，跳过）:`, stmtError);
      }
    }

    return c.json(response.success(null, '数据库恢复执行成功'));
  } catch (error) {
    console.error('恢复数据库失败:', error);
    return c.json(response.error('恢复任务执行失败'));
  }
});

app.delete('/:id', async (c) => {
  try {
    const { id } = c.req.param();

    if (!id) {
      return c.json(response.error('备份文件名不能为空'));
    }

    const bucket = c.env.BACKUP_BUCKET;

    if (!bucket) {
      return c.json(response.error('R2存储桶未配置'));
    }

    await bucket.delete(id);

    return c.json(response.success(null, '删除成功'));
  } catch (error) {
    console.error('删除备份文件失败:', error);
    return c.json(response.error('删除失败'));
  }
});

app.get('/:id/download', async (c) => {
  try {
    const { id } = c.req.param();

    if (!id) {
      return c.json(response.error('备份文件名不能为空'));
    }

    const bucket = c.env.BACKUP_BUCKET;

    if (!bucket) {
      return c.json(response.error('R2存储桶未配置'));
    }

    const object = await bucket.get(id);

    if (!object) {
      return c.json(response.error(`备份文件不存在: ${id}`));
    }

    const backupData = await object.text();

    return new Response(backupData, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${id}"`
      }
    });
  } catch (error) {
    console.error('下载备份文件失败:', error);
    return c.json(response.error('下载失败'));
  }
});

export default app;
