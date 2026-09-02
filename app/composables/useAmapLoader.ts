
// 高德 JS API 加载器（模块级单例）：
// 多个地图组件（桌面栏/移动折叠地图/全屏地图）共享同一份加载 Promise，
// 避免重复注入 <script> 与重复初始化
let amapPromise: Promise<any> | null = null

export function loadAmap(key: string, securityCode: string): Promise<any> {
  if (!key) return Promise.reject(new Error('未配置高德 JS API key'))
  if (typeof window === 'undefined') return Promise.reject(new Error('仅客户端可用'))
  const w = window as any
  if (w.AMap) return Promise.resolve(w.AMap)
  if (amapPromise) return amapPromise
  if (securityCode) w._AMapSecurityConfig = { securityJsCode: securityCode }
  amapPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(key)
    s.async = true
    s.onload = () => resolve(w.AMap)
    s.onerror = () => { amapPromise = null; reject(new Error('高德地图脚本加载失败')) }
    document.head.appendChild(s)
  })
  return amapPromise
}
