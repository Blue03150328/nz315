import { processWorkerBindings } from '../utils/worker-production'
export default defineNitroPlugin(nitro=>{
 let running=false
 const tick=async()=>{if(running)return;running=true;try{await processWorkerBindings()}catch(error){console.error('Worker binding retry:',error instanceof Error?error.message:error)}finally{running=false}}
 const timer=setInterval(tick,5000);timer.unref();nitro.hooks.hook('close',()=>{clearInterval(timer)})
})
