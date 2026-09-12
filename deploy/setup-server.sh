#!/usr/bin/env bash
#
# 农资315 · 生产服务器环境初始化
# ------------------------------------------------------------------
# 适用：Alibaba Cloud Linux 3 / CentOS 8+ / RHEL 8+ / Ubuntu 20.04+
# 用法：以 root 执行  ->  sudo bash setup-server.sh
# 幂等：可重复执行，已装组件自动跳过
#
# 安装内容：2G swap、Node 22（npmmirror 二进制）、MySQL 8、nginx、PM2
# 创建目录：/var/www/nz315、/var/www/certbot、/var/log/nz315
# 开放端口：firewalld 的 80/443（阿里云安全组需另行在控制台开放）
# ------------------------------------------------------------------

set -euo pipefail

APP_DIR="/var/www/nz315"
CERTBOT_WEBROOT="/var/www/certbot"
LOG_DIR="/var/log/nz315"
SWAP_FILE="/swapfile"
SWAP_SIZE_MB=2048
NODE_VERSION="22.22.2"

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 0. 前置检查 ----------
[ "$(id -u)" -eq 0 ] || die "请以 root 执行（sudo bash $0）"

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  die "读不到 /etc/os-release，无法识别发行版"
fi

PKG_FAMILY="rhel"
case "${ID:-}${ID_LIKE:-}" in
  *debian*|*ubuntu*) PKG_FAMILY="debian" ;;
esac
log "发行版：${PRETTY_NAME:-$ID}　包管理器族：${PKG_FAMILY}"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  NODE_ARCH="x64"   ;;
  aarch64) NODE_ARCH="arm64" ;;
  *)       die "不支持的 CPU 架构：$ARCH（仅支持 x86_64 / aarch64）" ;;
esac

# ---------- 1. swap ----------
# 2核4G 跑 nuxt build 峰值可能吃满内存，2G swap 是防 OOM 的保险
install_swap() {
  if swapon --show 2>/dev/null | grep -q .; then
    log "已存在 swap，跳过"
    return
  fi
  if [ -f "$SWAP_FILE" ]; then
    warn "$SWAP_FILE 已存在但未启用，尝试启用"
    swapon "$SWAP_FILE" 2>/dev/null || true
    return
  fi
  log "创建 ${SWAP_SIZE_MB}MB swap（构建防 OOM）"
  if ! fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE" 2>/dev/null; then
    # 某些文件系统（如 overlayfs）不支持 fallocate，退回 dd
    dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none
  fi
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE" >/dev/null
  swapon "$SWAP_FILE"
  grep -q "^${SWAP_FILE} " /etc/fstab || printf '%s none swap sw 0 0\n' "$SWAP_FILE" >> /etc/fstab
}

# ---------- 2. 系统依赖 ----------
install_system_deps() {
  log "安装系统依赖：ca-certificates curl tar xz"
  if [ "$PKG_FAMILY" = "debian" ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl tar xz-utils gnupg
  else
    dnf install -y -q ca-certificates curl tar xz
  fi
}

# ---------- 3. Node.js 22 ----------
install_node() {
  if command -v node >/dev/null 2>&1; then
    local cur
    cur="$(node -v | sed 's/^v//')"
    local major="${cur%%.*}"
    if [ "$major" -ge 20 ] 2>/dev/null; then
      log "已装 Node v${cur}（满足 >= 20），跳过"
      return
    fi
    warn "已装 Node v${cur} 版本过低，将安装 v${NODE_VERSION}"
  fi

  log "从 npmmirror 下载 Node v${NODE_VERSION}（国内直连，不走国外源）"
  local tarball="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  local url="https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${tarball}"
  curl -fL --retry 3 --connect-timeout 20 "$url" -o "/tmp/${tarball}"
  tar -xJf "/tmp/${tarball}" -C /usr/local --strip-components=1
  rm -f "/tmp/${tarball}"

  command -v node >/dev/null 2>&1 || die "Node 安装后仍不可用，请检查 /usr/local/bin 是否在 PATH"
  log "Node 就绪：$(node -v)　npm：$(npm -v)"

  log "npm 源切换为 npmmirror（否则 npm ci 会慢到无法接受）"
  npm config set registry https://registry.npmmirror.com
  npm config set fund false
  npm config set audit false
}

# ---------- 4. MySQL 8 ----------
install_mysql() {
  if command -v mysqld >/dev/null 2>&1; then
    log "已装 MySQL（$(mysqld --version | head -1)），跳过"
  else
    log "安装 MySQL 8"
    if [ "$PKG_FAMILY" = "debian" ]; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mysql-server
    else
      dnf install -y -q mysql-server
    fi
  fi

  log "启动并设置 MySQL 开机自启"
  systemctl enable --now mysqld 2>/dev/null || systemctl enable --now mysql 2>/dev/null || true
  systemctl is-active --quiet mysqld || systemctl is-active --quiet mysql \
    || warn "MySQL 未处于 active 状态，请手动检查：systemctl status mysqld"

  log "设置服务端字符集为 utf8mb4"
  local cnf_dir="/etc/my.cnf.d"
  [ -d "$cnf_dir" ] || cnf_dir="/etc/mysql/conf.d"
  mkdir -p "$cnf_dir"
  if [ ! -f "${cnf_dir}/nz315-charset.cnf" ]; then
    cat > "${cnf_dir}/nz315-charset.cnf" <<'CNF'
[mysqld]
character-set-server = utf8mb4
collation-server     = utf8mb4_unicode_ci
default-time-zone    = '+08:00'
max_connections      = 200
CNF
    systemctl restart mysqld 2>/dev/null || systemctl restart mysql 2>/dev/null || true
  fi
}

# ---------- 5. nginx ----------
install_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    log "已装 nginx（$(nginx -v 2>&1)），跳过"
  else
    log "安装 nginx"
    if [ "$PKG_FAMILY" = "debian" ]; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
    else
      dnf install -y -q nginx
    fi
  fi
  systemctl enable --now nginx
  log "nginx 就绪：$(nginx -v 2>&1)"
}

# ---------- 6. PM2 ----------
install_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    log "已装 PM2（$(pm2 -v 2>/dev/null | tail -1)），跳过"
    return
  fi
  log "全局安装 PM2"
  npm install -g pm2
  log "PM2 就绪：$(pm2 -v 2>/dev/null | tail -1)"
}

# ---------- 7. 目录 ----------
make_dirs() {
  log "创建目录：${APP_DIR} ${CERTBOT_WEBROOT} ${LOG_DIR}"
  mkdir -p "$APP_DIR" "$CERTBOT_WEBROOT" "$LOG_DIR"

  # 部署目录含内嵌数据库凭据的构建产物，收紧权限
  chmod 750 "$APP_DIR" "$LOG_DIR"
  # certbot webroot 需被 nginx 读取
  chmod 755 "$CERTBOT_WEBROOT"
}

# ---------- 8. 防火墙 ----------
open_ports() {
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    log "firewalld 放行 http / https"
    firewall-cmd --permanent --add-service=http  >/dev/null
    firewall-cmd --permanent --add-service=https >/dev/null
    firewall-cmd --reload >/dev/null
  elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    log "ufw 放行 80 / 443"
    ufw allow 80/tcp  >/dev/null
    ufw allow 443/tcp >/dev/null
  else
    log "未检测到启用的本机防火墙，跳过（阿里云安全组仍需在控制台开放 80/443）"
  fi
}

# ---------- 执行 ----------
install_swap
install_system_deps
install_node
install_mysql
install_nginx
install_pm2
make_dirs
open_ports

log "环境变量自检"
printf '  node    : %s\n' "$(command -v node) $(node -v)"
printf '  npm     : %s\n' "$(npm -v)"
printf '  mysql   : %s\n' "$(mysqld --version | head -1)"
printf '  nginx   : %s\n' "$(nginx -v 2>&1)"
printf '  pm2     : %s\n' "$(pm2 -v 2>/dev/null | tail -1)"

cat <<'NEXT'

============================================================
环境初始化完成。接下来（详见 docs/上线操作手册-阿里云.md）：

  1. 阿里云控制台 → 安全组 → 放行 80 / 443 / 22（本脚本管不了安全组）
  2. 建库与账号：
       mysql -uroot -p
       > CREATE DATABASE nz315 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
       > CREATE USER 'nz315'@'localhost' IDENTIFIED BY '<强密码>';
       > GRANT ALL PRIVILEGES ON nz315.* TO 'nz315'@'localhost';
       > FLUSH PRIVILEGES;
  3. 拉代码到 /var/www/nz315，配置 .env，然后：
       cd /var/www/nz315
       npm ci
       node scripts/db-init.mjs
       node scripts/import-regdata.mjs
       npm run build
       pm2 start deploy/ecosystem.config.cjs
       pm2 save && pm2 startup
  4. 备案通过后：配 DNS 解析 → 申请证书 → 启用 nginx 站点配置
       cp deploy/nginx-nz315.conf /etc/nginx/conf.d/nz315.conf
       nginx -t && systemctl reload nginx
============================================================
NEXT
