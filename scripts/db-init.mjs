// 数据库初始化脚本：按 PRD 第七章创建 11 张表 + 演示数据
// 用法：node scripts/db-init.mjs
'use strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 读取 .env（简易解析，无 dotenv 依赖）
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const DB = {
  host: env.DB_HOST || '127.0.0.1',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root',
  password: env.DB_PASSWORD || '', // 从 .env 读取，禁止硬编码默认密码
  database: env.DB_NAME || 'nz315',
};

// 建表 DDL 全集（核心业务表 + message 消息 + consumer 消费者 + product_original/upload_batch/pesticide_reg 扩展表；表数 = DDL.length 自动统计）
const DDL = [
  `CREATE TABLE IF NOT EXISTS enterprise (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL COMMENT '企业名称',
    credit_code VARCHAR(50) NULL COMMENT '统一社会信用代码',
    unit_code VARCHAR(32) NULL COMMENT '单元识别码',
    contact VARCHAR(100) NULL COMMENT '联系人',
    phone VARCHAR(50) NULL COMMENT '联系电话',
    legal_person VARCHAR(100) NULL COMMENT '法定代表人',
    website VARCHAR(255) NULL COMMENT '企业官网',
    address VARCHAR(500) NULL COMMENT '注册地址',
    logo VARCHAR(500) NULL COMMENT '企业LOGO',
    description TEXT NULL COMMENT '企业简介',
    license_no VARCHAR(100) NULL COMMENT '农药生产许可证号',
    qualification_expire DATE NULL COMMENT '资质到期日（提前30/60/90天提醒）',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '0禁用 1启用',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_credit_code (credit_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS product_spec (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    spec_name VARCHAR(100) NOT NULL COMMENT '规格名称，企业内唯一',
    net_content DECIMAL(12,3) NULL COMMENT '净含量数值',
    content_unit VARCHAR(10) NULL COMMENT '含量单位：毫升/升/克/千克/片/包/粒（2026-09-03 起存中文，存量英文由用户自行迁移）',
    pack_unit VARCHAR(10) NULL COMMENT '瓶/袋/桶/盒/罐/支/箱',
    spec_code CHAR(3) NOT NULL COMMENT '企业规格码（码第9-11位，系统自动分配）',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '0停用 1启用',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_enterprise_spec_name (enterprise_id, spec_name),
    UNIQUE KEY uq_enterprise_spec_code (enterprise_id, spec_code),
    KEY idx_spec_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS product (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    trademark VARCHAR(100) NULL COMMENT '产品商标',
    name VARCHAR(255) NOT NULL COMMENT '农药名称',
    registration_no VARCHAR(32) NOT NULL COMMENT '登记证号（全局唯一）',
    registration_expire DATE NULL COMMENT '登记证有效期至',
    reg_category TINYINT NULL COMMENT '1=PD 2=WP',
    holder_name VARCHAR(255) NULL COMMENT '登记证持有人名称',
    produce_type TINYINT NULL COMMENT '1持有人生产 2委托加工 3委托分装',
    dosage VARCHAR(50) NULL COMMENT '剂型',
    content VARCHAR(50) NULL COMMENT '总含量',
    spec_id BIGINT NULL COMMENT '规格ID（外键 product_spec）',
    shelf_life VARCHAR(20) NULL COMMENT '保质期',
    category VARCHAR(50) NULL COMMENT '农药类别',
    toxicity VARCHAR(20) NULL COMMENT '毒性',
    is_restricted TINYINT NOT NULL DEFAULT 0 COMMENT '是否限制使用',
    label_image VARCHAR(500) NULL,
    manual_image VARCHAR(500) NULL,
    status TINYINT NOT NULL DEFAULT 1 COMMENT '0停用 1启用',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_registration_no (registration_no),
    KEY idx_enterprise (enterprise_id),
    KEY idx_spec (spec_id),
    KEY idx_reg_expire (registration_expire)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 原药（母药）信息表（2026-09-04 多行化：复配产品可录入多条原药；原 product.original_* 单值列迁移后下线）
  `CREATE TABLE IF NOT EXISTS product_original (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT NOT NULL COMMENT '产品ID',
    ingredient VARCHAR(120) NULL COMMENT '对应有效成分名（提示溯源用，可空）',
    reg_no VARCHAR(40) NOT NULL COMMENT '原药登记证号',
    company VARCHAR(255) NOT NULL COMMENT '原药生产企业名称',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_product (product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='产品原药（母药）信息（多行，1049 制剂展示用）'`,
  `CREATE TABLE IF NOT EXISTS batch (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    batch_no VARCHAR(64) NOT NULL COMMENT '生产批次号（同产品下唯一）',
    produce_date DATE NULL COMMENT '生产日期',
    quality_cert_no VARCHAR(64) NULL COMMENT '质量合格证号',
    expire_date DATE NULL COMMENT '有效期至',
    qc_result TINYINT NULL COMMENT '0不合格 1合格',
    qc_report_no VARCHAR(64) NULL COMMENT '质检报告号',
    quantity INT NULL COMMENT '生产数量',
    code_count INT NOT NULL DEFAULT 0 COMMENT '关联码数量',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_product_batch (product_id, batch_no),
    KEY idx_enterprise (enterprise_id),
    KEY idx_produce_date (produce_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS trace_code (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    code VARCHAR(32) NOT NULL COMMENT '追溯码（32位，全局唯一）',
    product_id BIGINT NULL,
    batch_id BIGINT NULL,
    produce_date DATE NULL COMMENT '生产日期（冗余，扫码优先于批次）',
    batch_no VARCHAR(64) NULL COMMENT '生产批号（冗余）',
    quality_cert_no VARCHAR(64) NULL COMMENT '质量合格证号（冗余，扫码优先于批次）',
    expire_date DATE NULL COMMENT '有效期至（单码覆盖冗余，扫码优先于批次）',
    qc_result TINYINT NULL COMMENT '质检结果0不合格1合格（单码覆盖冗余，扫码优先于批次）',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '码状态：1已生成 2已绑定',
    abnormal_flag TINYINT NOT NULL DEFAULT 0 COMMENT '异常标记：0正常 1已冻结 2已作废',
    abnormal_reason VARCHAR(200) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uploaded_at DATETIME NULL COMMENT '采集上传时间',
    bound_at DATETIME NULL COMMENT '绑定批次时间',
    UNIQUE KEY uq_code (code),
    KEY idx_enterprise (enterprise_id),
    KEY idx_product (product_id),
    KEY idx_batch (batch_id),
    KEY idx_status (status),
    KEY idx_abnormal (abnormal_flag),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='追溯码表（亿级数据量，上线前按D1决策分库分表/归档）'`,
  `CREATE TABLE IF NOT EXISTS \`user\` (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NULL,
    username VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL COMMENT 'bcrypt 加密',
    name VARCHAR(50) NULL,
    phone VARCHAR(20) NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'code_admin' COMMENT 'platform_admin/enterprise_admin/code_admin/viewer',
    data_permission JSON NULL,
    status TINYINT NOT NULL DEFAULT 1 COMMENT '0禁用 1启用',
    last_login_at DATETIME NULL,
    last_login_ip VARCHAR(50) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_username (username),
    KEY idx_enterprise (enterprise_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS operation_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NULL,
    user_id BIGINT NULL,
    module VARCHAR(50) NULL,
    action VARCHAR(50) NULL,
    content TEXT NULL COMMENT '操作内容（含修改前后值 JSON）',
    ip VARCHAR(50) NULL,
    result TINYINT NULL COMMENT '0失败 1成功',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_enterprise_time (enterprise_id, created_at),
    KEY idx_module (module),
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志（保留至少3年，不可删除）'`,
  `CREATE TABLE IF NOT EXISTS scan_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NULL,
    code VARCHAR(32) NULL,
    product_id BIGINT NULL,
    scan_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    province VARCHAR(50) NULL,
    city VARCHAR(50) NULL,
    district VARCHAR(50) NULL,
    town VARCHAR(50) NULL,
    shop_name VARCHAR(100) NULL,
    price DECIMAL(10,2) NULL,
    scan_device VARCHAR(30) NULL COMMENT '微信/支付宝/浏览器',
    scan_subject TINYINT NOT NULL DEFAULT 1 COMMENT '1消费者 2监管 3内部盘点',
    ip_location VARCHAR(100) NULL,
    KEY idx_code_time (code, scan_time),
    KEY idx_enterprise_time (enterprise_id, scan_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='扫码记录（亿级，按D1决策归档）'`,
  `CREATE TABLE IF NOT EXISTS risk_alert (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NULL,
    alert_type TINYINT NULL COMMENT '1-8 对应8类异常',
    code_id BIGINT NULL,
    product_id BIGINT NULL,
    evidence JSON NULL COMMENT '证据数据',
    trigger_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    repeat_count INT NOT NULL DEFAULT 1,
    handle_status TINYINT NOT NULL DEFAULT 0 COMMENT '0待处理 1已核实合规 2已确认违规',
    handler_id BIGINT NULL,
    handle_time DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_enterprise_status (enterprise_id, handle_status),
    KEY idx_type (alert_type),
    KEY idx_trigger (trigger_time)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 站内消息（PRD 5.11 消息中心）——此前遗漏未纳入初始化脚本，新环境会缺表导致消息中心/风险预警通知报错
  `CREATE TABLE IF NOT EXISTS message (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NULL,
    user_id BIGINT NULL,
    type VARCHAR(30) NOT NULL COMMENT 'risk风险预警/upload_done上传完成/code_stock库存预警/account账号安全/other系统通知',
    title VARCHAR(200) NOT NULL,
    content TEXT NULL,
    link VARCHAR(255) NULL COMMENT '点击跳转路径',
    is_read TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_enterprise_read (enterprise_id, is_read),
    KEY idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内消息'`,
  // 消费者（公众端微信网页授权登录，与后台 user 表完全隔离）
  `CREATE TABLE IF NOT EXISTS consumer (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    openid VARCHAR(64) NOT NULL COMMENT '微信 openid（同一公众号内唯一）',
    unionid VARCHAR(64) NULL COMMENT '微信 unionid（开放平台跨应用打通，可能为空）',
    nickname VARCHAR(100) NULL COMMENT '微信昵称',
    avatar VARCHAR(500) NULL COMMENT '微信头像地址',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '0禁用 1正常',
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_openid (openid),
    KEY idx_unionid (unionid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消费者（微信公众号网页授权）'`,
  // 农药登记数据源字典表（2026农药登记证大全2.xlsx 导入：产品弹窗选择产品自动回填，登记证号唯一主键匹配；只读不参与业务写）
  `CREATE TABLE IF NOT EXISTS pesticide_reg (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    registration_no VARCHAR(40) NOT NULL COMMENT '登记证号（全局唯一）',
    product_name VARCHAR(255) NOT NULL COMMENT '产品名称',
    commodity_name VARCHAR(255) NULL COMMENT '商品名称',
    trademark VARCHAR(255) NULL COMMENT '商标',
    content VARCHAR(100) NULL COMMENT '总含量原文（如 50克/升 / 30.5%）',
    dosage VARCHAR(60) NULL COMMENT '剂型（乳油/悬浮剂/原药/母药…）',
    toxicity VARCHAR(30) NULL COMMENT '毒性（归一化：去括号注释，如 低毒(原药高毒)→低毒）',
    start_date DATE NULL COMMENT '有效起始日',
    expire_date DATE NULL COMMENT '有效截止日（登记证有效期至）',
    company VARCHAR(255) NULL COMMENT '生产厂家（登记证持有人）',
    ingredients VARCHAR(800) NULL COMMENT '有效成分及含量原文',
    ingredient_main VARCHAR(120) NULL COMMENT '主有效成分名（制剂取首成分名，原药取自身成分名）',
    ingredient_all JSON NULL COMMENT '全部有效成分名数组（复配检测/原药匹配用）',
    mixture VARCHAR(20) NULL COMMENT '单剂/混剂',
    category VARCHAR(50) NULL COMMENT '农药类别（杀虫剂/除草剂…）',
    temp_reg_no VARCHAR(40) NULL COMMENT '临时登记证号',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_registration_no (registration_no),
    KEY idx_dosage_ingredient (dosage, ingredient_main),
    KEY idx_company (company),
    KEY idx_expire (expire_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='农药登记数据源字典表（产品表单自动回填）'`,
  // 上传文件批次（2026-09-04 码库管理聚合改造：生产采集每上传一份追溯码文件即一行；trace_code.upload_batch_id 关联）
  `CREATE TABLE IF NOT EXISTS upload_batch (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    file_name VARCHAR(255) NOT NULL COMMENT '上传原始文件名（码库管理批次名称）',
    product_id BIGINT NULL COMMENT '关联产品（导入时快照）',
    batch_id BIGINT NULL COMMENT '归并的生产批次（导入时快照）',
    batch_no VARCHAR(64) NULL COMMENT '生产批号（导入时快照）',
    produce_date DATE NULL COMMENT '生产日期（导入时快照）',
    quality_cert_no VARCHAR(64) NULL COMMENT '质量合格证号（导入时快照）',
    created_by BIGINT NULL COMMENT '导入人 user_id',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
    KEY idx_ent_created (enterprise_id, created_at),
    KEY idx_product (product_id),
    KEY idx_batch_id (batch_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上传文件批次（码库管理聚合维度，生产采集导入时创建）'`,
];

// 增量迁移：CREATE TABLE IF NOT EXISTS 不会修改已存在的表，历史库需单独补列/补索引（幂等）
async function migrate(conn) {
  const hasColumn = async (table, column) => {
    const [rows] = await conn.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
      [DB.database, table, column]
    );
    return rows.length > 0;
  };
  const hasIndex = async (table, index) => {
    const [rows] = await conn.query(
      'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
      [DB.database, table, index]
    );
    return rows.length > 0;
  };

  // scan_log.consumer_id：消费者登录后扫码，记录归属人，支撑个人中心「我的查询记录」
  if (!(await hasColumn('scan_log', 'consumer_id'))) {
    await conn.query("ALTER TABLE scan_log ADD COLUMN consumer_id BIGINT NULL COMMENT '消费者ID（登录后扫码才有值）'");
    console.log('[db] 迁移：scan_log 补充列 consumer_id');
  }
  if (!(await hasIndex('scan_log', 'idx_consumer_time'))) {
    await conn.query('ALTER TABLE scan_log ADD KEY idx_consumer_time (consumer_id, scan_time)');
    console.log('[db] 迁移：scan_log 补充索引 idx_consumer_time');
  }

  // trace_code.outer_box_code：外箱码管理模块已整体删除（2026-09-02），历史库清理冗余列（幂等）
  if (await hasColumn('trace_code', 'outer_box_code')) {
    await conn.query('ALTER TABLE trace_code DROP COLUMN outer_box_code');
    console.log('[db] 迁移：trace_code 删除列 outer_box_code（外箱码模块已移除）');
  }

  // trace_code.upload_batch_id：码库管理按上传文件批次聚合（2026-09-04 改造）——导入码带文件批次归属，历史码由 backfill 归并
  if (!(await hasColumn('trace_code', 'upload_batch_id'))) {
    await conn.query("ALTER TABLE trace_code ADD COLUMN upload_batch_id BIGINT NULL COMMENT '上传文件批次ID（upload_batch）' AFTER uploaded_at");
    console.log('[db] 迁移：trace_code 补充列 upload_batch_id');
  }
  if (!(await hasIndex('trace_code', 'idx_upload_batch'))) {
    await conn.query('ALTER TABLE trace_code ADD KEY idx_upload_batch (upload_batch_id)');
    console.log('[db] 迁移：trace_code 补充索引 idx_upload_batch');
  }

  // product_spec.dosage_forms：适用剂型字段已下线（2026-09-03 用户决策：规格不限定剂型），历史库清理（幂等）
  if (await hasColumn('product_spec', 'dosage_forms')) {
    await conn.query('ALTER TABLE product_spec DROP COLUMN dosage_forms');
    console.log('[db] 迁移：product_spec 删除列 dosage_forms（适用剂型已下线）');
  }

  // trace_code.expire_date / qc_result：批次码明细单行修改（2026-09-04）——单码字段修正只写本行冗余覆盖列，
  // 不触碰批次级共享数据（batch 表），扫码页 COALESCE 优先码级值，保证「仅修改这一条码」且扫码展示生效
  if (!(await hasColumn('trace_code', 'expire_date'))) {
    await conn.query("ALTER TABLE trace_code ADD COLUMN expire_date DATE NULL COMMENT '有效期至（单码覆盖冗余，扫码优先于批次）' AFTER quality_cert_no");
    console.log('[db] 迁移：trace_code 补充列 expire_date（单码覆盖冗余）');
  }
  if (!(await hasColumn('trace_code', 'qc_result'))) {
    await conn.query("ALTER TABLE trace_code ADD COLUMN qc_result TINYINT NULL COMMENT '质检结果0不合格1合格（单码覆盖冗余，扫码优先于批次）' AFTER expire_date");
    console.log('[db] 迁移：trace_code 补充列 qc_result（单码覆盖冗余）');
  }

  // product.original_* → product_original 表（2026-09-04 原药多行化）：存量单值迁移后删列（幂等）
  const [origCols] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (?,?)',
    [DB.database, 'product', 'original_reg_no', 'original_company']
  );
  if (origCols.length > 0) {
    // 存量迁移：product 表原药单值非空 → product_original 行（幂等：不重复插入同 product 同 reg_no 同 company）
    await conn.query(
      `INSERT IGNORE INTO product_original (product_id, reg_no, company)
       SELECT id, original_reg_no, original_company FROM product
       WHERE original_reg_no IS NOT NULL AND original_reg_no <> '' AND original_company IS NOT NULL AND original_company <> ''`
    );
    const migrated = await conn.query('SELECT ROW_COUNT() AS c');
    console.log('[db] 迁移：product.original_* 存量迁入 product_original（' + JSON.stringify(migrated[0]) + '）');
    if (await hasColumn('product', 'original_company')) {
      await conn.query('ALTER TABLE product DROP COLUMN original_company');
      console.log('[db] 迁移：product 删除列 original_company（已迁入 product_original）');
    }
    if (await hasColumn('product', 'original_reg_no')) {
      await conn.query('ALTER TABLE product DROP COLUMN original_reg_no');
      console.log('[db] 迁移：product 删除列 original_reg_no（已迁入 product_original）');
    }
  }
}

// 历史码兜底归档（2026-09-04 码库聚合改造）：改造前导入的码无 upload_batch_id，
// 码库管理（按上传文件批次聚合）将不可见——按企业归并到一条「历史数据」批次，幂等（只处理仍为 NULL 的码）
async function backfillUploadBatches(conn) {
  const [groups] = await conn.query(
    'SELECT enterprise_id, COUNT(*) AS c FROM trace_code WHERE upload_batch_id IS NULL GROUP BY enterprise_id'
  );
  for (const g of groups) {
    const [r] = await conn.query(
      'INSERT INTO upload_batch (enterprise_id, file_name, product_id, batch_id, batch_no, produce_date, quality_cert_no, created_by) VALUES (?,?,NULL,NULL,NULL,NULL,NULL,NULL)',
      [g.enterprise_id, '历史数据（码库聚合改造前导入）']
    );
    const [up] = await conn.query(
      'UPDATE trace_code SET upload_batch_id = ? WHERE enterprise_id = ? AND upload_batch_id IS NULL', [r.insertId, g.enterprise_id]
    );
    console.log('[db] 迁移：历史码归并 upload_batch#' + r.insertId + '（企业 ' + g.enterprise_id + '，' + up.affectedRows + ' 条，原文件信息不可考）');
  }
}

// 演示数据（seed）
async function seed(conn) {
  // 1) 演示企业
  const [entRows] = await conn.query('SELECT id FROM enterprise WHERE name = ?', ['山东绿丰生物科技有限公司']);
  let enterpriseId;
  if (entRows.length === 0) {
    const [r] = await conn.query(
      'INSERT INTO enterprise (name, credit_code, unit_code, contact, phone) VALUES (?,?,?,?,?)',
      ['山东绿丰生物科技有限公司', '91370100MA3XXXXX0X', '1PD200407671', '王经理', '0531-88888888']
    );
    enterpriseId = r.insertId;
  } else {
    enterpriseId = entRows[0].id;
  }

  // 2) 演示规格（码第9-11位）
  const [specRows] = await conn.query('SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_code = ?', [enterpriseId, '001']);
  let specId;
  if (specRows.length === 0) {
    const [r] = await conn.query(
      'INSERT INTO product_spec (enterprise_id, spec_name, net_content, content_unit, pack_unit, spec_code) VALUES (?,?,?,?,?,?)',
      [enterpriseId, '200毫升/瓶', 200, '毫升', '瓶', '001']
    );
    specId = r.insertId;
  } else {
    specId = specRows[0].id;
  }

  // 3) 演示产品（登记证后6位 040767）
  const [prodRows] = await conn.query('SELECT id FROM product WHERE registration_no = ?', ['PD20040767']);
  let productId;
  if (prodRows.length === 0) {
    const [r] = await conn.query(
      `INSERT INTO product (enterprise_id, trademark, name, registration_no, registration_expire, reg_category, holder_name, produce_type, dosage, content, spec_id, shelf_life, category, toxicity)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [enterpriseId, '绿丰', '25%多·酮可湿性粉剂', 'PD20040767', '2031-08-23', 1, '山东绿丰生物科技有限公司', 1, '可湿性粉剂', '25%', specId, '2年', '杀菌剂', '低毒']
    );
    productId = r.insertId;
  } else {
    productId = prodRows[0].id;
  }
  // 演示产品原药信息行（多行表）
  const [origRows] = await conn.query('SELECT id FROM product_original WHERE product_id = ? AND reg_no = ?', [productId, 'PD20080708']);
  if (origRows.length === 0) {
    await conn.query(
      'INSERT INTO product_original (product_id, reg_no, company) VALUES (?,?,?)',
      [productId, 'PD20080708', '江苏原药化工有限公司']
    );
  }

  // 4) 演示批次
  const [batchRows] = await conn.query('SELECT id FROM batch WHERE product_id = ? AND batch_no = ?', [productId, '2026080101']);
  let batchId;
  if (batchRows.length === 0) {
    const [r] = await conn.query(
      'INSERT INTO batch (enterprise_id, product_id, batch_no, produce_date, quality_cert_no, expire_date, qc_result, qc_report_no, quantity, code_count) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [enterpriseId, productId, '2026080101', '2026-08-20', '质检(鲁)2026-081001', '2028-08-19', 1, 'BG-2026-081001', 10000, 0]
    );
    batchId = r.insertId;
  } else {
    batchId = batchRows[0].id;
  }

  // 5) 演示追溯码（覆盖场景）
  const demoCodes = [
    { code: '12301011001000000000000000001001', status: 2, flag: 0 }, // 正品·已绑定
    { code: '12301011001000000000000000001002', status: 1, flag: 0 }, // 正品·已生成
    { code: '12301011001000000000000000000004', status: 2, flag: 1, reason: '印刷模糊，临时冻结' }, // 已冻结
    { code: '12301011001000000000000000000005', status: 1, flag: 2, reason: '疑似假冒，作废处理' }, // 已作废
  ];
  for (const dc of demoCodes) {
    const [exists] = await conn.query('SELECT id FROM trace_code WHERE code = ?', [dc.code]);
    if (exists.length === 0) {
      const bound = dc.status === 2;
      await conn.query(
        `INSERT INTO trace_code (enterprise_id, code, product_id, batch_id, produce_date, batch_no, quality_cert_no, status, abnormal_flag, abnormal_reason, uploaded_at, bound_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [enterpriseId, dc.code, productId, bound ? batchId : null, bound ? '2026-08-20' : null, bound ? '2026080101' : null, bound ? '质检(鲁)2026-081001' : null, dc.status, dc.flag, dc.reason || null, new Date(), bound ? new Date() : null]
      );
    }
  }

  // 6) 演示用户：总部管理员 + 厂家主账号 + 码管理员
  const users = [
    { username: 'admin', password: 'admin123', name: '系统管理员', role: 'platform_admin', enterpriseId: null },
    { username: 'lvfeng', password: 'admin123', name: '王经理', role: 'enterprise_admin', enterpriseId },
    { username: 'codeop', password: 'admin123', name: '小李', role: 'code_admin', enterpriseId },
  ];
  for (const u of users) {
    const [exists] = await conn.query('SELECT id FROM \`user\` WHERE username = ?', [u.username]);
    if (exists.length === 0) {
      const hash = await bcrypt.hash(u.password, 10);
      await conn.query(
        'INSERT INTO \`user\` (enterprise_id, username, password, name, role) VALUES (?,?,?,?,?)',
        [u.enterpriseId, u.username, hash, u.name, u.role]
      );
    }
  }
}

async function main() {
  // 1) 连接（无库）并创建数据库
  const adminConn = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password });
  await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await adminConn.end();
  console.log('[db] 数据库就绪: ' + DB.database);

  // 2) 建表
  const conn = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database });
  for (const ddl of DDL) {
    await conn.query(ddl);
  }
  console.log('[db] ' + DDL.length + ' 张表创建完成');

  // 3) 增量迁移（历史库补列/补索引）
  await migrate(conn);

  // 4) seed
  await seed(conn);

  // 5) 历史码兜底归档（upload_batch 聚合维度，幂等）
  await backfillUploadBatches(conn);
  await conn.end();
  console.log('[db] 初始化完成');
}

main().catch((e) => {
  console.error('初始化失败:', e.message);
  process.exit(1);
});