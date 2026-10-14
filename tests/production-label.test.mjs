import {test} from 'node:test'
import assert from 'node:assert/strict'
import {register} from 'node:module'
register('./_ts-loader.mjs',import.meta.url)
const {productionLabelOf}=await import('../shared/utils/internal-trace-url.ts')
const code='12001041001000000000000000000001'
test('统一生产按精确来源识别内部网址和完整裸码',()=>{
 for(const raw of [code,'https://nz315.cn/trace?code='+code,'https://www.nz315.cn:443/trace?from=scan&code='+code])assert.deepEqual(productionLabelOf(raw),{classification:'internal',code,reason:''})
})
test('本站坏格式、错误路径端口及无法识别的内容只进异常',()=>{
 for(const raw of ['随机原文','123','http://third.example/','https://www.nz315.cn/other?code='+code,'https://www.nz315.cn:3100/trace?code='+code,'https://nz315.cn/trace?code=123','https://nz315.cn/trace?code='+code+'&code='+code,'https://user@nz315.cn/trace?code='+code,'https://nz315.cn/trace?code='+code+'#x','https://nz315.cn/x/../trace?code='+code,code+'\n','broken?code='+code])assert.equal(productionLabelOf(raw).classification,'unparsed',raw)
})
test('外站原文不按包含的内部域名或数字片段误归内部',()=>{
 for(const raw of ['https://label.example/view?id=abc','https://www.nz315.cn.evil.example/trace?code='+code,'https://label.example/view?site=nz315.cn&code='+code])assert.deepEqual(productionLabelOf(raw),{classification:'external',code:null,reason:''})
 assert.equal(productionLabelOf('https://custom.example/other?a=1','https://custom.example/trace?code=').classification,'unparsed')
})
