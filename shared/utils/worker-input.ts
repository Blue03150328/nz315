import { collectionCode, collectionId } from './collection-input'
import { isInputDate } from './input-date'
import { productionLabelOf, DEFAULT_TRACE_BASE_URL } from './internal-trace-url'
export function workerContext(body: any) {
 if(body.unifiedScan===true&&!(body.mode==='production'&&body.lineWorkflow===true&&body.stockWorkflow===true))throw Error('统一生产扫码须选择产线、产品和生产资料')
 if(body.mode==='external')return {mode:'external' as const,name:String(body.name||'外码采集').slice(0,100)}
 const productId=Number(body.productId),batchNo=String(body.batchNo||'').trim(),produceDate=String(body.produceDate||''),expireDate=String(body.expireDate||'')
 if(body.mode!=='production'||!Number.isSafeInteger(productId)||productId<=0||!batchNo||batchNo.length>64||!isInputDate(produceDate)||!isInputDate(expireDate)||expireDate<produceDate)throw Error('请选择产品，填写有效生产日期、有效期和瓶盖批号')
 if(body.lineWorkflow===true){const taskId=Number(body.taskId);if(!Number.isSafeInteger(taskId)||taskId<0||(body.stockWorkflow===true&&taskId===0&&body.autoLine!==true))throw Error('请选择有效生产线任务');return {mode:'production' as const,productId,batchNo,produceDate,expireDate,lineWorkflow:true as const,taskId,...(body.stockWorkflow===true?{stockWorkflow:true as const}:{}),...(body.unifiedScan===true?{unifiedScan:true as const}:{}),...(body.autoLine===true?{autoLine:true as const,lineName:String(body.lineName||'').normalize('NFKC').trim().replace(/\s+/g,' ')}:{})}}
 return {mode:'production' as const,productId,batchNo,produceDate,expireDate,poolId:collectionId(body.poolId)}
}
export function workerEvents(body:any,unified=false,baseUrl=DEFAULT_TRACE_BASE_URL) {
 if(!Array.isArray(body.events)||!body.events.length||body.events.length>20)throw Error('每批须为1至20条')
 const seen=new Set<string>()
 return body.events.map((e:any)=>{
  const eventId=collectionId(e.eventId),sequence=Number(e.sequence),capturedAt=String(e.capturedAt||'')
  if(seen.has(eventId)||!Number.isSafeInteger(sequence)||sequence<=0||typeof e.rawCode!=='string'||!e.rawCode.trim()||e.rawCode.length>4096||!['valid','duplicate','invalid'].includes(e.kind)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt)||!Number.isFinite(Date.parse(capturedAt)))throw Error('采集事件格式不正确')
  seen.add(eventId);const code=unified?productionLabelOf(e.rawCode,baseUrl).code:collectionCode(e.rawCode)
  if(e.code!=null&&e.code!==code)throw Error('原文与码值不一致')
  return {eventId,sequence,rawCode:e.rawCode,code,kind:e.kind,capturedAt}
 }).sort((a:any,b:any)=>a.sequence-b.sequence)
}
