-- Corner X：跨裝置讀取活動代碼
-- 只需要在既有 D1 執行一次。舊活動會在第一次由控制台開啟時自動產生活動代碼。
ALTER TABLE series ADD COLUMN access_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_access_code ON series(access_code);
