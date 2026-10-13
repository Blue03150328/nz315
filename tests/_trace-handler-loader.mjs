// 结果分支测试替换数据库及外部服务边界，执行真实查询接口，不连接业务库。
const mocks = {
  'db': 'export const query=(...args)=>globalThis.traceTest.query(...args);export const execute=(...args)=>globalThis.traceTest.execute(...args)',
  'audit': 'export const clientIpOf=()=>"127.0.0.1"',
  'ip-geo': 'export const peekIpGeo=()=>null;export const backfillScanGeo=async()=>{}',
  'risk-alert': 'export const triggerAlert=async()=>{}',
  'consumer-auth': 'export const getCurrentConsumer=async()=>null',
  'worker-production': 'export const workerTracePreview=async()=>globalThis.traceTest.preview',
  'registry-lookup': 'export const lookupRegistryByCode=async()=>({candidates:[],codeParts:{validLength:true,validCategory:true,validProductionType:true,registrationLast6:"999999"}})',
  'source-snapshot': 'export const collectSourceSnapshot=async()=>{globalThis.traceTest.fetched++;return {status:"unavailable",comparisons:[],saved:false}}',
  'rate-limit': 'export const allowRequest=()=>true',
}
export async function load(url, context, next) {
  const match = url.match(/\/server\/utils\/([^/]+)\.ts$/)
  if (match && mocks[match[1]]) return { format: 'module', source: mocks[match[1]], shortCircuit: true }
  return next(url, context)
}
