-- 更新 ys_vod_source 表，添加缺失的字段
ALTER TABLE ys_vod_source ADD COLUMN source_id INTEGER;
ALTER TABLE ys_vod_source ADD COLUMN source_vod_id TEXT;
ALTER TABLE ys_vod_source ADD COLUMN source_name TEXT;
ALTER TABLE ys_vod_source ADD COLUMN play_from TEXT;
ALTER TABLE ys_vod_source ADD COLUMN play_url TEXT;
ALTER TABLE ys_vod_source ADD COLUMN play_server TEXT;
ALTER TABLE ys_vod_source ADD COLUMN play_note TEXT;
ALTER TABLE ys_vod_source ADD COLUMN priority INTEGER DEFAULT 0;
ALTER TABLE ys_vod_source ADD COLUMN status INTEGER DEFAULT 1;
ALTER TABLE ys_vod_source ADD COLUMN collect_time TEXT;
