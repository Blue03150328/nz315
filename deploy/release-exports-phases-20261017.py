# 此片段与既有备份/指纹/启动函数一同生成受控发布脚本；不单独运行。
def changed_file(path, old_sha, new_sha):
    state['overlayFiles'][path] = {'beforeSha256': old_sha, 'afterSha256': new_sha}


def patch_page(relative, function, label, click):
    page = DEST / relative
    before_sha = sha(page)
    old = page.read_text()
    assert ('async function ' + click + '(') not in old, '线上已有同名导出，请重新核对'
    line = re.search(r'^const totalPages = computed\(.*$', old, re.M)
    assert line, '分页声明锚点缺失'
    text = old[:line.end()] + '\n' + function + old[line.end():]
    if click == 'exportProducts':
        anchor = '<UButton v-if="canWrite" color="neutral" variant="solid" icon="i-lucide-plus" @click="openCreate">新增产品</UButton>'
        assert text.count(anchor) == 1, '产品新增按钮锚点不一致'
        button = '<div class="flex flex-wrap justify-end gap-2"><UButton color="neutral" variant="outline" icon="i-lucide-download" :loading="exporting" title="导出当前筛选的全部产品" @click="exportProducts">批量导出</UButton>' + anchor + '</div>'
        text = text.replace(anchor, button)
    else:
        anchor = '<UButton v-if="canWrite" color="neutral" variant="outline" icon="i-lucide-file-up" @click="openImport">批量导入</UButton>'
        assert text.count(anchor) == 1, '规格导入按钮锚点不一致'
        button = '<UButton color="neutral" variant="outline" icon="i-lucide-download" :loading="exporting" title="导出当前筛选的全部规格" @click="exportSpecs">导出规格</UButton>'
        text = text.replace(anchor, button + '\n        ' + anchor)
        text = text.replace("'/templates/spec-import-template.xlsx'", "'/templates/spec-import-template.xlsx?v=20261017-standard-times3'")
        text = re.sub(r'模板仅一列「规格」，[^\n]+', PAYLOAD['specNote'], text)
        text = text.replace('规格导入模板.xlsx（表头「规格」+ 示例数据）', '规格导入模板.xlsx（单列标准规格，如500克×20瓶）')
    page.write_text(text)
    changed_file(relative, before_sha, sha(page))


def stable_exports():
    stable()
    assert sha(ROOT / '.docker-release.json') == state['rootRecordSha256'], '现役回执已改变'


if MODE == 'prepare':
    assert not SAFE.exists() and not DEST.exists(), '发布目录已存在，请核对状态后继续'
    assert shutil.disk_usage('/').free > 2 * 1024 ** 3, '磁盘不足2GB，未发布'
    base = json.loads((ROOT / '.docker-release.json').read_text())
    assert base['commit'] == COMMIT and base['image'] == 'nz315-production:offline-tool-121-e5a4181b', '现役版本变化，请重新核对'
    assert base.get('offlineTool', {}).get('version') == '1.2.1', '离线工具覆盖层缺失'
    state = {'status': 'preparing', 'commit': COMMIT, 'previous': base, 'releaseDirectory': str(DEST), 'backup': str(SAFE), 'databaseMigration': False, 'payloadSha256': PAYLOAD_SHA, 'overlayFiles': {}}
    SAFE.mkdir(mode=0o700, parents=True)
    stable()
    state['rootRecordSha256'] = sha(ROOT / '.docker-release.json')
    state['assets'] = assets()
    state['otherServices'] = other_services()
    previous = pathlib.Path(base['releaseDirectory'])
    assert hashlib.sha256((previous / 'shared/utils/specification.ts').read_text().encode()).hexdigest() == PAYLOAD['expectedSpecificationSha256'], '现役规格解析与已验收基础不一致'
    for src, name in [(previous / base['compose'], 'previous-compose.yml'), (previous / '.docker-deploy.env', 'previous.env'), (ROOT / '.docker-release.json', 'previous-release.json'), (ROOT / 'compose.production.yml', 'previous-root-compose.yml'), (ROOT / '.docker-deploy.env', 'previous-root.env')]:
        shutil.copy2(src, SAFE / name)
    save()
    shutil.copy2(__file__, SAFE / 'release-script.py')
    shutil.copytree(str(previous), str(DEST), ignore=shutil.ignore_patterns('node_modules', '.nuxt', '.output', '.git', '.env', '.env.*', '.docker-deploy.env', '.docker-release.json', 'backup', 'logs'))
    for relative, item in PAYLOAD['files'].items():
        assert '..' not in pathlib.PurePosixPath(relative).parts and not relative.startswith('/'), '载荷路径无效'
        data = base64.b64decode(item['data'])
        assert hashlib.sha256(data).hexdigest() == item['sha256'], '载荷字节错误'
        target = DEST / relative
        old_sha = sha(target) if target.exists() else None
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        changed_file(relative, old_sha, sha(target))
    patch_page('app/pages/admin/products/index.vue', PAYLOAD['productFunction'], '批量导出', 'exportProducts')
    patch_page('app/pages/admin/specs/index.vue', PAYLOAD['specFunction'], '导出规格', 'exportSpecs')
    types = DEST / 'server/types/cjs-modules.d.ts'
    types_before_sha = sha(types)
    original = types.read_text()
    if 'write(wb: WorkBook' not in original:
        anchor = '    readFile(path: string, opts?: Record<string, unknown>): WorkBook'
        assert original.count(anchor) == 1, 'XLSX声明锚点不一致'
        types.write_text(original.replace(anchor, anchor + "\n    write(wb: WorkBook, opts: { type: 'buffer'; bookType: 'xlsx' }): Buffer"))
    changed_file('server/types/cjs-modules.d.ts', types_before_sha, sha(types))
    state['generatorPageSha256'] = sha(previous / 'app/pages/admin/generator/index.vue')
    assert sha(DEST / 'app/pages/admin/generator/index.vue') == state['generatorPageSha256'], '离线工具页面被改动'
    # 核对实际叠加范围，禁止带入产品导入、安卓或其他未授权界面改动。
    actual = set()
    for file in DEST.rglob('*'):
        if file.is_file():
            rel = str(file.relative_to(DEST))
            old = previous / rel
            if not old.exists() or sha(old) != sha(file):
                actual.add(rel)
    assert actual == set(state['overlayFiles']), ('源码差异超出清单', sorted(actual - set(state['overlayFiles'])))
    for name in ['package.json', 'package-lock.json', 'scripts/start-production-container.mjs', 'compose.production.yml']:
        assert (DEST / name).read_bytes() == (previous / name).read_bytes(), '基础运行依赖改变'
    os.symlink(ROOT / 'node_modules', DEST / 'node_modules')
    state['status'] = 'prepared'
    save()
elif MODE == 'build':
    state = json.loads(STATE.read_text())
    assert state['status'] == 'prepared'
    stable_exports()
    env = dict(os.environ, SESSION_SECRET='exports-build-only-placeholder-20261017', NODE_ENV='production', NITRO_PRESET='node-server')
    run([NODE, '--test'] + glob.glob(str(DEST / 'tests/*.test.mjs')), cwd=DEST, env=env)
    code = "import {loadNuxt,buildNuxt,writeTypes} from '@nuxt/kit';const n=await loadNuxt({cwd:process.cwd(),overrides:{buildDir:process.cwd()+'/.nuxt'}});await writeTypes(n);await buildNuxt(n);await n.close();"
    run([NODE, '--input-type=module', '-e', code], cwd=DEST, env=env)
    (DEST / 'tsconfig.release.json').write_text(json.dumps({'extends': './tsconfig.json', 'include': ['app/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts', 'nuxt.config.ts', '.nuxt/**/*.d.ts'], 'exclude': ['node_modules']}))
    run([NODE, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.release.json'], cwd=DEST, env=env)
    state['candidateBuild'] = json.loads((DEST / '.output/public/_nuxt/builds/latest.json').read_text())
    compiled = '\n'.join(p.read_text(errors='replace') for p in (DEST / '.output/public/_nuxt').glob('*.js'))
    for label in ['批量导出', '导出规格', '500克×20瓶', 'v1.2.1（便携版）', '/tools/nz315-qr-tool-v1.2.1.exe', TOOL_SHA, '关联产品', '全部产品', '输入关键词选择产品']:
        assert label in compiled, '产物缺少标识：' + label
    assert '入库留档' not in compiled, '生成页出现已移除入口'
    assert '导入产品' not in compiled, '意外携带产品导入功能'
    assert sha(DEST / 'app/pages/admin/generator/index.vue') == state['generatorPageSha256']
    (DEST / 'Dockerfile.release').write_text('FROM ' + state['previous']['image'] + '\nUSER root\nCOPY --chown=node:node .output /app/.output\nLABEL org.opencontainers.image.revision="' + PAYLOAD_SHA + '"\nUSER node\n')
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
    stable_exports()
    assert assets() == state['assets'] and other_services() == state['otherServices'], '原资源或其他服务变化，停止发布'
    stopped = False
    try:
        run(['docker', 'stop', CANDIDATE])
        run(['docker', 'stop', CONTAINER])
        stopped = True
        state['status'] = 'backing-up-paused'
        save()
        state['beforeDatabase'] = snapshot()
        save()
        dump_database()
        after = snapshot()
        assert state['beforeDatabase'] == after, '备份前后数据库指纹或结构变化，停止切换'
        state['afterBackup'] = after
        state['status'] = 'backup-verified'
        save()
        shutil.copy2(SAFE / 'previous.env', DEST / '.docker-deploy.env')
        config = (DEST / '.docker-deploy.env').read_text()
        assert re.search(r'^NZ315_IMAGE=', config, re.M)
        (DEST / '.docker-deploy.env').write_text(re.sub(r'^NZ315_IMAGE=.*$', 'NZ315_IMAGE=' + IMAGE, config, flags=re.M))
        run(['docker', 'compose', '--project-name', 'nz315-production', '--env-file', '.docker-deploy.env', '-f', 'compose.production.yml', 'up', '-d', '--wait', '--wait-timeout', '120'], cwd=DEST)
        verify_build('https://www.nz315.cn')
        assert assets() == state['assets'], '凭据、Nginx或下载文件变化'
        assert other_services() == state['otherServices'], '其他应用状态变化'
        state['status'] = 'deployed'
        state['at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save()
        record = dict(state['previous'])
        record.update({'status': 'deployed', 'image': IMAGE, 'imageId': state['imageId'], 'at': state['at'], 'releaseDirectory': str(DEST), 'backup': str(SAFE), 'publicBuild': state['candidateBuild'], 'databaseMigration': False,
            'previous': {'commit': state['previous']['commit'], 'image': state['previous']['image'], 'compose': str(SAFE / 'previous-compose.yml'), 'environment': str(SAFE / 'previous.env')},
            'sourceOverlay': {'kind': 'product-and-spec-exports-20261017', 'baseCommit': COMMIT, 'parent': state['previous'].get('sourceOverlay'), 'payloadSha256': PAYLOAD_SHA, 'files': state['overlayFiles'], 'githubMasterChanged': False},
            'validation': {'candidate': True, 'https': True, 'allOriginalTableFingerprintsUnchangedAtSwitch': True, 'allOriginalColumnsUnchanged': True, 'assetsUnchanged': True, 'otherServicesUnchanged': True, 'standardSpecTemplate': True, 'offlineToolOverlayPreserved': True}})
        (DEST / '.docker-release.json').write_text(json.dumps(record, indent=2))
        for name in ['.docker-release.json', '.docker-deploy.env', 'compose.production.yml']:
            shutil.copy2(DEST / name, ROOT / name)
        run(['docker', 'rm', CANDIDATE])
        print('DEPLOYED_SUMMARY', json.dumps({'image': IMAGE, 'at': state['at'], 'backup': str(SAFE), 'source': str(DEST), 'build': state['candidateBuild'], 'tables': state['databaseBackupTables']}), flush=True)
    except Exception:
        if stopped:
            run(['docker', 'compose', '--project-name', 'nz315-production', '--env-file', str(SAFE / 'previous.env'), '-f', str(SAFE / 'previous-compose.yml'), 'up', '-d', '--wait', '--wait-timeout', '120'])
            for source, target in [('previous-release.json', '.docker-release.json'), ('previous-root.env', '.docker-deploy.env'), ('previous-root-compose.yml', 'compose.production.yml')]:
                shutil.copy2(SAFE / source, ROOT / target)
        state['status'] = 'rolled-back-application' if stopped else 'failed-before-switch'
        save()
        raise
elif MODE == 'status':
    state = json.loads(STATE.read_text())
    print(json.dumps({key: state.get(key) for key in ['status', 'image', 'at', 'candidateBuild', 'databaseBackupTables', 'databaseBackupComplete']}, ensure_ascii=False), flush=True)
else:
    raise ValueError('未知发布阶段')
print('RELEASE_STATE', state['status'], TAG, flush=True)
