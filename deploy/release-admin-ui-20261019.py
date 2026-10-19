"""后台界面精简受控发布：仅界面文件，完整备份，原字段指纹不变，零DDL。"""
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
KIND = 'admin-ui'
assert MODE in ['prepare', 'build', 'publish', 'status'], '未知发布阶段'
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
    probe(base + '/api/admin/specs/export', 401)
    for route in ['/api/admin/products', '/api/admin/products/export', '/api/admin/products/import-template', '/api/admin/specs', '/api/admin/production-lines', '/api/admin/production-tasks', '/api/admin/codes/usage-batches']:
        probe(base + route, 401)
    assert get(base + '/_nuxt/builds/latest.json') == state['candidateBuild'], '构建指纹不一致'
    with urllib.request.urlopen(base + '/templates/product-import-template.xlsx?v=20261019-grid', timeout=30) as response:
        assert hashlib.sha256(response.read()).hexdigest() == state['templateSha256'], '产品模板哈希不一致'
    with urllib.request.urlopen(base + '/templates/spec-import-template.xlsx?v=20261019-ui', timeout=30) as response:
        assert hashlib.sha256(response.read()).hexdigest() == state['specTemplateSha256'], '规格模板哈希不一致'
    status = out(['curl', '--max-time', '30', '-sS', '-X', 'POST', '-o', '/dev/null', '-w', '%{http_code}', base + '/api/admin/products/import'])
    assert status == '401', '产品导入接口未登录鉴权异常'



UI_FILES = set(["app/components/AdminFlowStrip.vue","app/components/AdminOnboarding.vue","app/components/CodeImportInput.vue","app/components/ExternalCollectionList.vue","app/components/OfflineProductionImport.vue","app/layouts/admin.vue","app/pages/admin/alerts/index.vue","app/pages/admin/batches/index.vue","app/pages/admin/codes/index.vue","app/pages/admin/collection/index.vue","app/pages/admin/external-verify/index.vue","app/pages/admin/generator/index.vue","app/pages/admin/index.vue","app/pages/admin/messages/index.vue","app/pages/admin/production-tasks/lines.vue","app/pages/admin/production-tasks/records.vue","app/pages/admin/products/index.vue","app/pages/admin/settings/index.vue","app/pages/admin/source-snapshots.vue","app/pages/admin/specs/index.vue","app/pages/admin/statistics/index.vue","app/assets/css/main.css","app/components/AdminHelp.vue"])
EXPECTED_PREVIOUS = '935d9330f6d445f2316e3023b9f97cfce563928c'

def runtime_files(folder):
    result = {}
    for directory in ['app', 'server', 'shared', 'scripts', 'config', 'public']:
        for file in (folder / directory).rglob('*'):
            if file.is_file():
                result[str(file.relative_to(folder))] = file
    for name in ['package.json', 'package-lock.json', 'nuxt.config.ts', 'compose.production.yml', 'scripts/start-production-container.mjs']:
        result[name] = folder / name
    return result

def normalized(file):
    data = file.read_bytes()
    try:
        return data.decode('utf-8').replace('\r\n', '\n').encode('utf-8')
    except UnicodeDecodeError:
        return data

if MODE == 'prepare':
    assert not SAFE.exists() and not DEST.exists(), '发布目录已存在，请核对状态'
    assert shutil.disk_usage('/').free > 2 * 1024 ** 3, '磁盘不足2GB'
    base = json.loads((ROOT / '.docker-release.json').read_text())
    assert base['commit'] == EXPECTED_PREVIOUS, '现役版本已变，请重新核对'
    assert base.get('offlineTool', {}).get('version') == '1.2.1'
    state = {'status':'preparing', 'commit':COMMIT, 'previous':base, 'previousRecordSha256':sha(ROOT / '.docker-release.json'), 'releaseDirectory':str(DEST), 'backup':str(SAFE), 'databaseMigration':False}
    stable()
    assert get('https://api.github.com/repos/Blue03150328/nz315/commits/master')['sha'] == COMMIT, '主仓版本不一致'
    SAFE.mkdir(mode=0o700, parents=True)
    state['assets'], state['otherServices'] = assets(), other_services()
    previous = pathlib.Path(base['releaseDirectory'])
    for src, name in [(previous / base['compose'],'previous-compose.yml'),(previous / '.docker-deploy.env','previous.env'),(ROOT / '.docker-release.json','previous-release.json'),(ROOT / 'compose.production.yml','previous-root-compose.yml'),(ROOT / '.docker-deploy.env','previous-root.env')]:
        shutil.copy2(src, SAFE / name)
    shutil.copy2(__file__, SAFE / 'release-script.py')
    save()
    DEST.mkdir(mode=0o755)
    source = SAFE / 'source.tar.gz'
    run(['curl','--fail','--location','--retry','3','--output',str(source),'https://codeload.github.com/Blue03150328/nz315/tar.gz/' + COMMIT])
    run(['tar','-xzf',str(source),'-C',str(DEST),'--strip-components=1'])
    old, new = runtime_files(previous), runtime_files(DEST)
    assert set(new) - set(old) == {'app/components/AdminHelp.vue'}, '新增运行文件超出界面组件'
    assert not (set(old) - set(new)), '禁止删除现役运行文件'
    changed = {name for name in new if name not in old or normalized(old[name]) != normalized(new[name])}
    assert changed == UI_FILES, ('运行源码差异超出界面清单', sorted(changed - UI_FILES), sorted(UI_FILES - changed))
    for name in changed:
        if name.endswith('.vue') and name in old:
            a = re.findall(r'<script[^>]*>([\s\S]*?)</script>', normalized(old[name]).decode())
            b = re.findall(r'<script[^>]*>([\s\S]*?)</script>', normalized(new[name]).decode())
            assert [s.strip() for s in a] == [s.strip() for s in b], '禁止改变业务脚本：' + name
    state['uiFiles'] = {name:sha(new[name]) for name in sorted(changed)}
    state['templateSha256'] = sha(DEST / 'public/templates/product-import-template.xlsx')
    state['specTemplateSha256'] = sha(DEST / 'public/templates/spec-import-template.xlsx')
    assert sha(DEST / 'server/assets/product-import-template.xlsx') == state['templateSha256']
    os.symlink(ROOT / 'node_modules', DEST / 'node_modules')
    state['status'] = 'prepared'
    save()
elif MODE == 'build':
    state = json.loads(STATE.read_text())
    assert state['status'] == 'prepared'
    stable()
    env = dict(os.environ, SESSION_SECRET='ui-build-only-placeholder-20261019', NODE_ENV='production', NITRO_PRESET='node-server')
    run([NODE, '--test'] + glob.glob(str(DEST / 'tests/*.test.mjs')), cwd=DEST, env=env)
    code = "import{loadNuxt,writeTypes,buildNuxt}from'@nuxt/kit';const n=await loadNuxt({cwd:process.cwd(),overrides:{buildDir:process.cwd()+'/.nuxt'}});await writeTypes(n);await buildNuxt(n);await n.close();"
    run([NODE,'--input-type=module','-e',code],cwd=DEST,env=env)
    (DEST / 'tsconfig.release.json').write_text(json.dumps({'extends':'./tsconfig.json','include':['app/**/*.ts','server/**/*.ts','shared/**/*.ts','nuxt.config.ts','.nuxt/**/*.d.ts'],'exclude':['node_modules']}))
    run([NODE,'node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.release.json'],cwd=DEST,env=env)
    compiled = '\n'.join(p.read_text(errors='replace') for p in (DEST / '.output/public/_nuxt').glob('*.js'))
    for label in ['使用说明与文件校验','补充来源页面（可选）','生成设置','编码参数','导入产品','批量导出','导出规格','产标名','规格代码','下载失败行','输入关键词选择产品','尚未导出','导出 TXT','导出 urls.txt','导出 CSV','v1.2.1（便携版）','/tools/nz315-qr-tool-v1.2.1.exe','e5a4181bcbc5ea24c391516ba92526b27c3fd9349873e938d33123d1dd6f4d61']:
        assert label in compiled, '产物缺少功能标识：' + label
    assert '入库留档' not in compiled, '生成页恢复了已移除入口'
    css = '\n'.join(p.read_text(errors='replace') for p in (DEST / '.output/public/_nuxt').glob('*.css'))
    assert '.b-help-panel' in css
    state['candidateBuild'] = json.loads((DEST / '.output/public/_nuxt/builds/latest.json').read_text())
    (DEST / 'Dockerfile.release').write_text('FROM '+state['previous']['image']+'\nUSER root\nCOPY --chown=node:node .output /app/.output\nLABEL org.opencontainers.image.revision="'+COMMIT+'"\nUSER node\n')
    (DEST / '.dockerignore').write_text('*\n!.output\n!.output/**\n!Dockerfile.release\n')
    run(['docker','build','-f','Dockerfile.release','-t',IMAGE,'.'],cwd=DEST)
    state['image'], state['imageId'] = IMAGE, out(['docker','image','inspect','--format','{{.Id}}',IMAGE])
    run(['docker','run','-d','--name',CANDIDATE,'--network','host','-e','NODE_ENV=production','-e','HOST=127.0.0.1','-e','PORT=3102','-e','TZ=Asia/Shanghai','-e','NZ315_ENV_FILE=/run/secrets/nz315.env','-v','/var/lib/nz315-docker/runtime.env:/run/secrets/nz315.env:ro,z','-v','/var/lib/nz315-docker/backup:/app/backup:rw,z',IMAGE,'node','scripts/start-production-container.mjs'])
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
    assert assets() == state['assets'] and other_services() == state['otherServices'], '外部资源变化，停止切换'
    assert get('https://api.github.com/repos/Blue03150328/nz315/commits/master')['sha'] == COMMIT
    assert all(sha(DEST / name) == digest for name,digest in state['uiFiles'].items()), '候选源码变化'
    stopped = False
    try:
        run(['docker','stop',CANDIDATE])
        stopped = True
        run(['docker','stop',CONTAINER])
        state['status'] = 'backing-up-paused'
        state['beforeDatabase'] = snapshot()
        save()
        dump_database()
        after = snapshot()
        assert state['beforeDatabase'] == after, '备份前后原字段指纹、结构或索引变化'
        state['afterBackup'] = after
        state['status'] = 'backup-verified'
        save()
        shutil.copy2(SAFE / 'previous.env', DEST / '.docker-deploy.env')
        config = (DEST / '.docker-deploy.env').read_text()
        assert re.search(r'^NZ315_IMAGE=',config,re.M)
        (DEST / '.docker-deploy.env').write_text(re.sub(r'^NZ315_IMAGE=.*$','NZ315_IMAGE='+IMAGE,config,flags=re.M))
        run(['docker','compose','--project-name','nz315-production','--env-file','.docker-deploy.env','-f','compose.production.yml','up','-d','--wait','--wait-timeout','120'],cwd=DEST)
        verify_build('https://www.nz315.cn')
        assert assets() == state['assets'] and other_services() == state['otherServices'], '原资源或其他服务变化'
        state['status'], state['at'] = 'deployed', datetime.datetime.now(datetime.timezone.utc).isoformat()
        save()
        record = {'status':'deployed','commit':COMMIT,'image':IMAGE,'imageId':state['imageId'],'at':state['at'],'releaseDirectory':str(DEST),'compose':'compose.production.yml','backup':str(SAFE),'runtime':'docker','databaseMigration':False,'publicBuild':state['candidateBuild'],'previous':{'commit':state['previous']['commit'],'image':state['previous']['image'],'compose':str(SAFE / 'previous-compose.yml'),'environment':str(SAFE / 'previous.env')},'offlineTool':state['previous']['offlineTool'],'offlineToolMetadataInSource':True,'templateSha256':state['templateSha256'],'specTemplateSha256':state['specTemplateSha256'],'uiFiles':state['uiFiles'],'validation':{'candidate':True,'https':True,'allOriginalTableFingerprintsUnchangedAtSwitch':True,'allOriginalColumnsUnchanged':True,'assetsUnchanged':True,'otherServicesUnchanged':True,'fullDatabaseBackupComplete':state['databaseBackupComplete'],'databaseBackupTables':state['databaseBackupTables'],'uiOnlyRuntimeDiff':True}}
        (DEST / '.docker-release.json').write_text(json.dumps(record,indent=2))
        for name in ['.docker-release.json','.docker-deploy.env','compose.production.yml']:
            shutil.copy2(DEST / name, ROOT / name)
        run(['docker','rm',CANDIDATE])
        print('DEPLOYED_SUMMARY',json.dumps({k:record[k] for k in ['commit','image','at','releaseDirectory','backup','publicBuild','validation']}),flush=True)
    except Exception:
        if stopped:
            run(['docker','compose','--project-name','nz315-production','--env-file',str(SAFE / 'previous.env'),'-f',str(SAFE / 'previous-compose.yml'),'up','-d','--wait','--wait-timeout','120'])
            for source,target in [('previous-release.json','.docker-release.json'),('previous-root.env','.docker-deploy.env'),('previous-root-compose.yml','compose.production.yml')]:
                shutil.copy2(SAFE / source,ROOT / target)
        state['status'] = 'rolled-back-application' if stopped else 'failed-before-switch'
        save()
        raise
elif MODE == 'status':
    state = json.loads(STATE.read_text())
    print(json.dumps({key:state.get(key) for key in ['status','image','at','candidateBuild','databaseBackupTables','databaseBackupComplete']},ensure_ascii=False),flush=True)
print('RELEASE_STATE',state['status'],COMMIT,flush=True)
