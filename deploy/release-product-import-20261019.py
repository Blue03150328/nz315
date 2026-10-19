"""产品七列导入受控发布：精确主仓构建，完整备份与原字段指纹核对，零DDL，只切应用。"""
import datetime
import fcntl
import glob
import gzip
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request

os.umask(0o077)
MODE, COMMIT = sys.argv[1:3]
KIND = 'product-import'
assert MODE in ['prepare', 'build', 'publish'], '未知发布阶段'
assert re.fullmatch(r'[0-9a-f]{40}', COMMIT)
ROOT = pathlib.Path('/var/www/nz315')
NODE = '/usr/local/node22/bin/node'
DEST = pathlib.Path('/var/www/.nz315-' + KIND + '-20261019-' + COMMIT[:8])
SAFE = pathlib.Path('/var/backups/nz315/' + KIND + '-20261019-' + COMMIT[:8])
STATE = SAFE / 'state.json'
CANDIDATE = 'nz315-' + KIND + '-candidate-' + COMMIT[:8]
CONTAINER = 'nz315-production-app-1'
IMAGE = 'nz315-production:' + COMMIT[:12]
os.environ['PATH'] = '/usr/local/node22/bin:' + os.environ['PATH']
lock = open('/var/lock/nz315-master-release.lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def out(args, **kwargs):
    return subprocess.check_output(args, universal_newlines=True, **kwargs).strip()


def sha(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'nz315-sku-release'}), timeout=40) as response:
        return json.load(response)


def probe(url, expected=200):
    code = out(['curl', '--max-time', '30', '-sS', '-o', '/dev/null', '-w', '%{http_code}', url])
    assert code == str(expected), (url, code, expected)


def save():
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def stable():
    assert sha(ROOT / '.docker-release.json') == state['previousRecordSha256'], '现役发布回执变化，停止切换'
    assert json.loads((ROOT / '.docker-release.json').read_text())['commit'] == state['previous']['commit'], '其他发布已更换现役版本'
    assert out(['docker', 'inspect', '--format', '{{.Config.Image}}', CONTAINER]) == state['previous']['image'], '现役容器已改变'


def assets():
    files = list((ROOT / 'public/tools').glob('*')) + list((ROOT / 'public/downloads').glob('*')) + list(pathlib.Path('/var/www/nz315-downloads').glob('*'))
    files += [pathlib.Path(p) for p in glob.glob('/www/server/panel/vhost/nginx/*.conf')]
    files += [pathlib.Path('/var/lib/nz315-docker/runtime.env')]
    return {str(p): sha(p) for p in files if p.is_file()}


def other_services():
    services = json.loads(out(['pm2', 'jlist']))
    return {p['name']: {'pid': p['pid'], 'status': p['pm2_env']['status']} for p in services if p['name'] != 'nz315'}


DB_PREFIX = """import fs from 'node:fs';import {parseEnv} from 'node:util';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';const require=createRequire('/var/www/nz315/package.json'),mysql=require('mysql2/promise'),e=parseEnv(fs.readFileSync('/var/lib/nz315-docker/runtime.env','utf8'));if(e.DB_NAME!=='nz315')throw Error('目标库必须是nz315');const db=await mysql.createConnection({host:e.DB_HOST,port:Number(e.DB_PORT||3306),user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true});"""


def snapshot(baseline=None):
    suffix = """const [cols]=await db.query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');const byTable={};for(const c of cols){if(!/VIRTUAL GENERATED|STORED GENERATED/.test(c.EXTRA))(byTable[c.TABLE_NAME]??=[]).push(c.COLUMN_NAME)}const tables={};for(const [name,columns] of Object.entries(byTable)){const [rows]=await db.query('SELECT ?? FROM ??',[columns,name]);tables[name]={columns,count:rows.length,sha256:createHash('sha256').update(rows.map(r=>JSON.stringify(r)).sort().join('\\n')).digest('hex')}}const [indexes]=await db.query('SHOW INDEX FROM product');await db.end();console.log(JSON.stringify({cols,tables,indexes:indexes.map(r=>({name:r.Key_name,column:r.Column_name,sequence:r.Seq_in_index,unique:!r.Non_unique}))}));"""
    return json.loads(out([NODE, '--input-type=module', '-e', DB_PREFIX + suffix]))


def dump_database():
    script = """import fs from 'node:fs';import {parseEnv} from 'node:util';import {spawnSync} from 'node:child_process';const e=parseEnv(fs.readFileSync('/var/lib/nz315-docker/runtime.env','utf8'));if(e.DB_NAME!=='nz315')throw Error('目标库错误');const r=spawnSync('/www/server/mysql/bin/mysqldump',['--no-defaults','--no-tablespaces','--protocol=TCP','--host='+e.DB_HOST,'--port='+String(e.DB_PORT||3306),'--user='+e.DB_USER,'--single-transaction','--quick','--skip-lock-tables','--routines','--triggers','--hex-blob',e.DB_NAME],{env:{...process.env,MYSQL_PWD:e.DB_PASSWORD},stdio:['ignore','inherit','inherit']});process.exit(r.status??1);"""
    process = subprocess.Popen([NODE, '--input-type=module', '-e', script], stdout=subprocess.PIPE)
    with gzip.open(SAFE / 'database.sql.gz', 'wb') as stream:
        shutil.copyfileobj(process.stdout, stream)
    assert process.wait() == 0, '完整数据库备份失败'
    run(['gzip', '-t', str(SAFE / 'database.sql.gz')])
    state['databaseBackupSha256'] = sha(SAFE / 'database.sql.gz')
    with gzip.open(str(SAFE / 'database.sql.gz'), 'rb') as stream:
        sql = stream.read().decode('utf-8')
    names = re.findall(r'CREATE TABLE `([^`]+)`', sql)
    assert sorted(names) == sorted(state['beforeDatabase']['tables']), '完整SQL备份表清单不一致'
    assert 'Dump completed on' in sql, '完整SQL备份缺少结束标记'
    state['databaseBackupTables'] = len(names)
    state['databaseBackupComplete'] = True


def verify_build(base):
    probe(base + '/login')
    for route in ['/api/admin/products', '/api/admin/products/export', '/api/admin/products/import-template', '/api/admin/specs', '/api/admin/production-lines', '/api/admin/production-tasks', '/api/admin/codes/usage-batches']:
        probe(base + route, 401)
    assert get(base + '/_nuxt/builds/latest.json') == state['candidateBuild'], '构建指纹不一致'
    with urllib.request.urlopen(base + '/templates/product-import-template.xlsx?v=20261019-grid', timeout=30) as response:
        assert hashlib.sha256(response.read()).hexdigest() == state['templateSha256'], '产品模板哈希不一致'
    status = out(['curl', '--max-time', '30', '-sS', '-X', 'POST', '-o', '/dev/null', '-w', '%{http_code}', base + '/api/admin/products/import'])
    assert status == '401', '产品导入接口未登录鉴权异常'


if MODE == 'prepare':
    assert not SAFE.exists() and not DEST.exists(), '发布目录已存在，请查状态后继续'
    assert shutil.disk_usage('/').free > 1024 ** 3, '磁盘不足1GB，未发布'
    base = json.loads((ROOT / '.docker-release.json').read_text())
    state = {'status': 'preparing', 'commit': COMMIT, 'previous': base, 'previousRecordSha256': sha(ROOT / '.docker-release.json'), 'releaseDirectory': str(DEST), 'backup': str(SAFE), 'databaseMigration': 'product-sku-only' if KIND == 'sku' else False}
    SAFE.mkdir(mode=0o700, parents=True)
    stable()
    assert get('https://api.github.com/repos/Blue03150328/nz315/commits/master')['sha'] == COMMIT, '主仓版本不一致'
    state['assets'] = assets()
    state['otherServices'] = other_services()
    previous = pathlib.Path(base['releaseDirectory'])
    for src, name in [(previous / base['compose'], 'previous-compose.yml'), (previous / '.docker-deploy.env', 'previous.env'), (ROOT / '.docker-release.json', 'previous-release.json'), (ROOT / 'compose.production.yml', 'previous-root-compose.yml'), (ROOT / '.docker-deploy.env', 'previous-root.env')]:
        shutil.copy2(src, SAFE / name)
    save()
    DEST.mkdir(mode=0o755)
    source = SAFE / 'source.tar.gz'
    run(['curl', '--fail', '--location', '--retry', '3', '--output', str(source), 'https://codeload.github.com/Blue03150328/nz315/tar.gz/' + COMMIT])
    run(['tar', '-xzf', str(source), '-C', str(DEST), '--strip-components=1'])
    for name in ['package.json', 'package-lock.json', 'scripts/start-production-container.mjs', 'compose.production.yml']:
        new_text, old_text = (DEST / name).read_text(), (previous / name).read_text()
        equal = json.loads(new_text) == json.loads(old_text) if name.endswith('.json') else new_text.strip() == old_text.strip()
        assert equal, '基础运行依赖改变：' + name
    os.symlink(ROOT / 'node_modules', DEST / 'node_modules')
    state['templateSha256'] = sha(DEST / 'public/templates/product-import-template.xlsx')
    assert sha(DEST / 'server/assets/product-import-template.xlsx') == state['templateSha256'], '模板资产不一致'
    assert state['previous'].get('offlineTool', {}).get('version') == '1.2.1', '现役工具状态变化，需核对'
    generator = (DEST / 'app/pages/admin/generator/index.vue').read_text()
    for value in ['v1.2.1（便携版）', '/tools/nz315-qr-tool-v1.2.1.exe', 'e5a4181bcbc5ea24c391516ba92526b27c3fd9349873e938d33123d1dd6f4d61']:
        assert value in generator, '现役离线工具元数据未保留'
    state['status'] = 'prepared'
    save()
elif MODE == 'build':
    state = json.loads(STATE.read_text())
    assert state['status'] == 'prepared'
    stable()
    env = dict(os.environ, SESSION_SECRET='sku-build-only-placeholder-20261016', NODE_ENV='production', NITRO_PRESET='node-server')
    run([NODE, '--test'] + glob.glob(str(DEST / 'tests/*.test.mjs')), cwd=DEST, env=env)
    code = "import {loadNuxt,buildNuxt,writeTypes} from '@nuxt/kit';const n=await loadNuxt({cwd:process.cwd(),overrides:{buildDir:process.cwd()+'/.nuxt'}});await writeTypes(n);await buildNuxt(n);await n.close();"
    run([NODE, '--input-type=module', '-e', code], cwd=DEST, env=env)
    (DEST / 'tsconfig.release.json').write_text(json.dumps({'extends': './tsconfig.json', 'include': ['app/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts', 'nuxt.config.ts', '.nuxt/**/*.d.ts'], 'exclude': ['node_modules']}))
    run([NODE, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.release.json'], cwd=DEST, env=env)
    state['candidateBuild'] = json.loads((DEST / '.output/public/_nuxt/builds/latest.json').read_text())
    compiled = '\n'.join(p.read_text(errors='replace') for p in (DEST / '.output/public/_nuxt').glob('*.js'))
    for label in ['输入关键词选择规格', '浏览器下载列表可查看进度'] + (['输入关键词选择产品'] if KIND != 'sku' else []):
        assert label in compiled, '生产产物缺少功能标识：' + label
    if KIND in ['generator-export', 'codes-product-search']:
        assert '入库留档' not in compiled, '生成页仍有已移除的入库入口或说明'
        for label in ['导出 TXT', '导出 urls.txt', '导出 CSV', '尚未导出']:
            assert label in compiled, '生成页缺少原导出或防丢失提醒：' + label
    if KIND == 'codes-product-search':
        assert '关联产品' in compiled and '全部产品' in compiled, '码库产品筛选标识缺失'
    for label in ['产标名', '下载失败行', '规格代码']:
        assert label in compiled, '七列导入产物缺少功能标识：' + label
    (DEST / 'Dockerfile.release').write_text('FROM ' + state['previous']['image'] + '\nUSER root\nCOPY --chown=node:node .output /app/.output\nLABEL org.opencontainers.image.revision="' + COMMIT + '"\nUSER node\n')
    (DEST / '.dockerignore').write_text('*\n!.output\n!.output/**\n!Dockerfile.release\n')
    run(['docker', 'build', '-f', 'Dockerfile.release', '-t', IMAGE, '.'], cwd=DEST)
    state['image'] = IMAGE
    state['imageId'] = out(['docker', 'image', 'inspect', '--format', '{{.Id}}', IMAGE])
    run(['docker', 'run', '-d', '--name', CANDIDATE, '--network', 'host', '-e', 'NODE_ENV=production', '-e', 'HOST=127.0.0.1', '-e', 'PORT=3102', '-e', 'TZ=Asia/Shanghai', '-e', 'NZ315_ENV_FILE=/run/secrets/nz315.env', '-v', '/var/lib/nz315-docker/runtime.env:/run/secrets/nz315.env:ro,z', '-v', '/var/lib/nz315-docker/backup:/app/backup:rw,z', IMAGE, 'node', 'scripts/start-production-container.mjs'])
    for attempt in range(40):
        try:
            probe('http://127.0.0.1:3102/login')
            break
        except Exception:
            time.sleep(1)
    verify_build('http://127.0.0.1:3102')
    state['status'] = 'candidate-ready'
    save()
elif MODE == 'publish':
    state = json.loads(STATE.read_text())
    assert state['status'] == 'candidate-ready'
    stable()
    assert assets() == state['assets'] and other_services() == state['otherServices'], '外部资源已变化，停止发布'
    assert get('https://api.github.com/repos/Blue03150328/nz315/commits/master')['sha'] == COMMIT, '主仓已更新'
    stopped = False
    try:
        run(['docker', 'stop', CANDIDATE])
        stopped = True
        run(['docker', 'stop', CONTAINER])
        state['status'] = 'backing-up-paused'
        save()
        state['beforeDatabase'] = snapshot()
        save()
        dump_database()
        state['status'] = 'backup-verified'
        save()
        if KIND == 'sku':
            migration = DB_PREFIX + 'try{const {migrateProductSkuSchema}=await import(' + json.dumps(str(DEST / 'scripts/product-sku-schema.mjs')) + ');await migrateProductSkuSchema(db);}finally{await db.end()}'
            run([NODE, '--input-type=module', '-e', migration])
        after = snapshot()
        before = state['beforeDatabase']
        assert before['tables'] == after['tables'], '原表数据指纹变化，已停止切换'
        added = [c for c in after['cols'] if c['TABLE_NAME'] == 'product' and c['COLUMN_NAME'] == 'sku_trademark']
        assert len(added) == 1 and added[0]['EXTRA'] == 'VIRTUAL GENERATED', '产品派生列不符合预期'
        if KIND == 'sku':
            previous_added = [c for c in before['cols'] if c['TABLE_NAME'] == 'product' and c['COLUMN_NAME'] == 'sku_trademark']
            assert [c for c in before['cols'] if c not in previous_added] == [c for c in after['cols'] if c not in added], '原字段定义改变'
        else:
            assert before['cols'] == after['cols'] and before['indexes'] == after['indexes'], '本轮禁止数据库结构变化'
        sku = [r for r in after['indexes'] if r['name'] == 'uq_product_sku']
        assert len(sku) == 4 and all(r['unique'] for r in sku), 'SKU唯一索引不完整'
        state['afterMigration'] = after
        state['status'] = 'migration-verified'
        save()
        shutil.copy2(SAFE / 'previous.env', DEST / '.docker-deploy.env')
        config = (DEST / '.docker-deploy.env').read_text()
        assert re.search(r'^NZ315_IMAGE=', config, re.M)
        (DEST / '.docker-deploy.env').write_text(re.sub(r'^NZ315_IMAGE=.*$', 'NZ315_IMAGE=' + IMAGE, config, flags=re.M))
        run(['docker', 'compose', '--project-name', 'nz315-production', '--env-file', '.docker-deploy.env', '-f', 'compose.production.yml', 'up', '-d', '--wait', '--wait-timeout', '120'], cwd=DEST)
        verify_build('https://www.nz315.cn')
        assert assets() == state['assets'], '凭据、Nginx或下载件变化'
        assert other_services() == state['otherServices'], '其他应用状态变化'
        state['status'] = 'deployed'
        state['at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save()
        record = {'status': 'deployed', 'commit': COMMIT, 'image': IMAGE, 'imageId': state['imageId'], 'at': state['at'], 'releaseDirectory': str(DEST), 'compose': 'compose.production.yml', 'backup': str(SAFE), 'previous': {'commit': state['previous']['commit'], 'image': state['previous']['image'], 'compose': str(SAFE / 'previous-compose.yml'), 'environment': str(SAFE / 'previous.env')}, 'runtime': 'docker', 'databaseMigration': state['databaseMigration'], 'publicBuild': state['candidateBuild'], 'validation': {'candidate': True, 'https': True, 'allOriginalTableFingerprintsUnchangedAtMigration': True, 'allOriginalColumnsUnchanged': True, 'assetsUnchanged': True, 'otherServicesUnchanged': True}}
        record['offlineTool'] = state['previous']['offlineTool']
        record['offlineToolMetadataInSource'] = True
        record['previousSourceOverlay'] = state['previous'].get('sourceOverlay')
        record['templateSha256'] = state['templateSha256']
        record['validation']['fullDatabaseBackupComplete'] = state['databaseBackupComplete']
        record['validation']['databaseBackupTables'] = state['databaseBackupTables']
        (DEST / '.docker-release.json').write_text(json.dumps(record, indent=2))
        for name in ['.docker-release.json', '.docker-deploy.env', 'compose.production.yml']:
            shutil.copy2(DEST / name, ROOT / name)
        run(['docker', 'rm', CANDIDATE])
        print('DEPLOYED', json.dumps(record), flush=True)
    except Exception:
        if stopped:
            run(['docker', 'compose', '--project-name', 'nz315-production', '--env-file', str(SAFE / 'previous.env'), '-f', str(SAFE / 'previous-compose.yml'), 'up', '-d', '--wait', '--wait-timeout', '120'])
            for source, target in [('previous-release.json', '.docker-release.json'), ('previous-root.env', '.docker-deploy.env'), ('previous-root-compose.yml', 'compose.production.yml')]:
                shutil.copy2(SAFE / source, ROOT / target)
        state['status'] = 'rolled-back-application'
        save()
        raise
else:
    raise ValueError('未知发布阶段')
print('RELEASE_STATE', state['status'], COMMIT, flush=True)
