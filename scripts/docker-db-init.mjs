// This initializer is deliberately limited to the isolated Docker database.
if(process.env.DB_HOST!=='mysql'||process.env.DB_NAME!=='nz315_docker')throw Error('Docker initializer only permits mysql/nz315_docker')
if(process.env.DOCKER_SEED_DEMO!=='1')process.argv.push('--migrate-only')
await import('./db-init.mjs')
