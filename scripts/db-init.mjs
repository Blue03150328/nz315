// 数据库初始化脚本：按 PRD 第七章创建 9 张表 + 演示数据
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

// PRD 第七章 DDL（9 张表）
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
    content_unit VARCHAR(10) NULL COMMENT 'ml/L/g/kg/片/包/粒',
    pack_unit VARCHAR(10) NULL COMMENT '瓶/袋/桶/盒/罐/支/箱',
    spec_code CHAR(3) NOT NULL COMMENT '企业规格码（码第9-11位）',
    dosage_forms JSON NULL COMMENT '适用剂型',
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
    original_company VARCHAR(255) NULL COMMENT '原药生产企业',
    original_reg_no VARCHAR(32) NULL COMMENT '原药登记证号',
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
    produce_date DATE NULL COMMENT '生产日期（冗余）',
    batch_no VARCHAR(64) NULL COMMENT '生产批号（冗余）',
    quality_cert_no VARCHAR(64) NULL COMMENT '质量合格证号（冗余）',
    status TINYINT NOT NULL DEFAULT 1 COMMENT '码状态：1已生成 2已绑定',
    abnormal_flag TINYINT NOT NULL DEFAULT 0 COMMENT '异常标记：0正常 1已冻结 2已作废',
    abnormal_reason VARCHAR(200) NULL,
    outer_box_code VARCHAR(32) NULL,
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
];

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
      'INSERT INTO product_spec (enterprise_id, spec_name, net_content, content_unit, pack_unit, spec_code, dosage_forms) VALUES (?,?,?,?,?,?,?)',
      [enterpriseId, '200ml/瓶', 200, 'ml', '瓶', '001', JSON.stringify(['可湿性粉剂', '乳油'])]
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
      `INSERT INTO product (enterprise_id, trademark, name, registration_no, registration_expire, reg_category, holder_name, produce_type, original_company, original_reg_no, dosage, content, spec_id, shelf_life, category, toxicity)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [enterpriseId, '绿丰', '25%多·酮可湿性粉剂', 'PD20040767', '2031-08-23', 1, '山东绿丰生物科技有限公司', 1, '江苏原药化工有限公司', 'PD20080708', '可湿性粉剂', '25%', specId, '2年', '杀菌剂', '低毒']
    );
    productId = r.insertId;
  } else {
    productId = prodRows[0].id;
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
  console.log('[seed] 演示数据就绪：企业/规格/产品/批次/追溯码/用户(admin, lvfeng, codeop / admin123)');
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
  console.log('[db] 9 张表创建完成');

  // 3) seed
  await seed(conn);
  await conn.end();
  console.log('[db] 初始化完成');
}

main().catch((e) => {
  console.error('初始化失败:', e.message);
  process.exit(1);
});