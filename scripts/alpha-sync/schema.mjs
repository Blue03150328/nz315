// 阿尔法外部价格资料独立存储，不关联或覆盖厂家产品和农药登记资料。
export const ALPHA_DDL = [
  `CREATE TABLE IF NOT EXISTS alpha_product_price (
    sku_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    product_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    product_name VARCHAR(500) NOT NULL,
    product_code VARCHAR(200) NOT NULL,
    brand VARCHAR(200) NOT NULL,
    specification VARCHAR(500) NOT NULL,
    supplier_name VARCHAR(500) NOT NULL,
    supply_price DECIMAL(18,4) NULL,
    wholesale_price DECIMAL(18,4) NULL,
    member_price DECIMAL(18,4) NULL,
    sale_price DECIMAL(18,4) NULL,
    reference_price DECIMAL(18,4) NULL,
    list_price DECIMAL(18,4) NULL,
    minimum_price DECIMAL(18,4) NULL,
    raw_data JSON NOT NULL,
    row_hash CHAR(64) CHARACTER SET ascii NOT NULL,
    present_in_latest TINYINT NOT NULL DEFAULT 1,
    source_date DATE NOT NULL,
    sync_id CHAR(36) CHARACTER SET ascii NOT NULL,
    synced_at DATETIME(3) NOT NULL,
    KEY idx_alpha_product (product_id),
    KEY idx_alpha_present (present_in_latest, source_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='阿尔法商品规格及价格（外部参考资料）'`,
  `CREATE TABLE IF NOT EXISTS alpha_shop_listing (
    shop_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    product_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    shop_name VARCHAR(500) NOT NULL,
    product_name VARCHAR(500) NOT NULL,
    present_in_latest TINYINT NOT NULL DEFAULT 1,
    source_date DATE NOT NULL,
    sync_id CHAR(36) CHARACTER SET ascii NOT NULL,
    synced_at DATETIME(3) NOT NULL,
    PRIMARY KEY (shop_id, product_id),
    KEY idx_alpha_listing_product (product_id, present_in_latest)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='阿尔法店铺商品上架关系'`,
  `CREATE TABLE IF NOT EXISTS alpha_sync_run (
    id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
    source_date DATE NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
    price_count INT UNSIGNED NOT NULL,
    listing_count INT UNSIGNED NOT NULL,
    inserted_count INT UNSIGNED NOT NULL,
    updated_count INT UNSIGNED NOT NULL,
    unchanged_count INT UNSIGNED NOT NULL,
    missing_count INT UNSIGNED NOT NULL,
    completed_at DATETIME(3) NOT NULL,
    UNIQUE KEY uk_alpha_source_file (source_date, file_sha256),
    KEY idx_alpha_sync_completed (completed_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='阿尔法成功同步记录（与数据同事务提交）'`,
]

export async function ensureAlphaTables(conn) {
  for (const ddl of ALPHA_DDL) await conn.query(ddl)
}
