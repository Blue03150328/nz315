<script setup lang="ts">
// 高德地图画布组件：负责地图实例与 marker 的增删、点击/选中联动
// 设计约定：
//  - 本组件只输出「画布」，展示层（门店信息卡）由父级基于 mapClick/activeChange 渲染，
//    避免把 UI 塞进地图内部，便于移动/PC 两套布局复用同一份地图状态
//  - marker 使用纯 DOM 内容（HTMLMarker），便于样式统一与选中态高亮
//  - 坐标约定：门店库/高德均为 GCJ-02；父级传入前已转换，本组件不做转换
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { loadAmap } from '~/composables/useAmapLoader'

const props = withDefaults(defineProps<{
  amapKey: string
  securityCode?: string
  stores: any[]                    // 门店列表（含 lng/lat/isAuthorized）
  center?: { lng: number; lat: number } | null   // 我的位置
  activeStoreId?: number | null    // 当前选中门店 id
  fitMode?: 'bounds' | 'center'    // 自适应模式
}>(), { securityCode: '', activeStoreId: null, fitMode: 'bounds' })

const emit = defineEmits<{
  (e: 'mapReady', map: any): void
  (e: 'storeClick', store: any): void
  (e: 'storeHover', store: any): void
  (e: 'storeLeave'): void
  (e: 'markerPos', pos: { x: number; y: number }): void
}>()

const el = ref<HTMLElement | null>(null)
let AMap: any = null
let map: any = null
let markers: any[] = []
let myMarker: any = null
let fitBoundsTimeout: any = null

const mapReady = ref(false)

// 地图容器尺寸变化（折叠/全屏切换由父级裁剪，画布尺寸本身不变；仅窗口缩放需重排）
const handleResize = () => { if (map) map.resize() }

onMounted(async () => {
  if (!props.amapKey || !el.value) return
  try {
    AMap = await loadAmap(props.amapKey, props.securityCode || '')
  } catch (e: any) {
    console.warn('[StoreMap] 高德加载失败：', e?.message || e)
    return
  }
  if (!el.value) return
  map = new AMap.Map(el.value, {
    zoom: 11,
    center: props.center ? [props.center.lng, props.center.lat] : [117.121, 36.651],
    viewMode: '2D',
    resizeEnable: true,
  })
  mapReady.value = true
  emit('mapReady', map)
  renderMarkers()
  window.addEventListener('resize', handleResize)
  // 初次布局后等待容器稳定再自适应（图片/字体加载会改变容器高度）
  nextTick(() => fitToContent())
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (fitBoundsTimeout) clearTimeout(fitBoundsTimeout)
  if (map) { map.destroy(); map = null }
  markers = []
})

// ---------- marker 渲染 ----------
// marker 元素内容（授权经销商橙 / 普通门店绿；isActive 时加外圈高亮）
function markerContent(store: any, isActive: boolean): HTMLDivElement {
  const color = Number(store.isAuthorized) ? '#e67e22' : '#2c5c3a'
  const div = document.createElement('div')
  // marker 定位针 + 店内图标（SVG 而非 emoji，避免不同平台字形差异）
  div.innerHTML = `
    <div style="position:relative;transform:translate(-50%,-100%);">
      <div style="
        width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        background:${color};border:2px solid #fff;
        box-shadow:0 2px 8px rgba(0,0,0,.18);
        display:flex;align-items:center;justify-content:center;
        ${isActive ? 'outline:3px solid ' + color + '66;outline-offset:2px;' : ''}
      ">
        <svg style="transform:rotate(45deg)" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l1-5h16l1 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>
        </svg>
      </div>
    </div>`
  return div
}

function makeMarker(store: any, isActive: boolean): any {
  if (!AMap) return null
  const marker = new AMap.Marker({
    position: [Number(store.lng), Number(store.lat)],
    content: markerContent(store, isActive),
    anchor: 'bottom-center',
    offset: new AMap.Pixel(0, 0),
  })
  marker.setExtData({ store })
  marker.on('click', () => {
    emit('storeClick', store)
    if (map) {
      map.setCenter([Number(store.lng), Number(store.lat)])
      // 回传 marker 的屏幕坐标，供父级在 PC 端把详情卡锚定在 marker 旁
      const px = map.lngLatToContainer(new AMap.LngLat(Number(store.lng), Number(store.lat)))
      emit('markerPos', { x: px.x, y: px.y })
    }
  })
  marker.on('mouseover', () => emit('storeHover', store))
  marker.on('mouseout', () => emit('storeLeave'))
  return marker
}

function renderMarkers() {
  if (!map) return
  map.remove(markers)
  markers = []
  // 我的位置：小蓝点（保持轻量，与门店 marker 区分）
  if (props.center) {
    const dot = document.createElement('div')
    dot.innerHTML = `
      <div style="transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;
        background:#409eff;border:3px solid #fff;box-shadow:0 0 0 6px rgba(64,158,255,.18);
        position:relative;"></div>`
    if (AMap) {
      myMarker = new AMap.Marker({
        position: [props.center.lng, props.center.lat],
        content: dot,
        anchor: 'center',
      })
      map.add(myMarker)
    }
  }
  const withPos = (props.stores || []).filter((s: any) => s.lng !== null && s.lat !== null)
  withPos.forEach((s: any) => {
    const m = makeMarker(s, Number(s.id) === Number(props.activeStoreId))
    if (m) { markers.push(m); map.add(m) }
  })
}

// 仅更新选中态：hover/点击切换时只替换受影响 marker 的 DOM，避免全量重建（列表扫过不卡顿）
function updateActiveMarkers() {
  if (!map || !AMap) return
  for (const m of markers) {
    const s = m.getExtData?.().store
    if (!s) continue
    const active = Number(s.id) === Number(props.activeStoreId)
    m.setContent(markerContent(s, active))
  }
}

// 自适应视口：有坐标门店时 fit 全部（含我的位置），否则居中标示
function fitToContent() {
  if (!map || !AMap) return
  // 注意：AMap 2.0 的 setFitView 只接受 [lng,lat] 数组或覆盖物实例，不接受 {lng,lat} 对象
  const points: [number, number][] = []
  if (props.center && Number.isFinite(props.center.lng)) points.push([props.center.lng, props.center.lat])
  ;(props.stores || []).forEach((s: any) => {
    if (s.lng !== null && s.lat !== null && Number.isFinite(Number(s.lng))) points.push([Number(s.lng), Number(s.lat)])
  })
  if (points.length === 0) return
  if (points.length === 1) {
    map.setCenter(points[0])
    map.setZoom(13)
    return
  }
  // 全部点位同城（距离 < 0.5 度）时放大一些，避免视口过大门店缩成小点
  const lngs = points.map(p => p[0]), lats = points.map(p => p[1])
  const spanLng = Math.max(...lngs) - Math.min(...lngs)
  const spanLat = Math.max(...lats) - Math.min(...lats)
  const maxZoom = spanLng < 0.5 && spanLat < 0.5 ? 12 : 10
  try {
    map.setFitView(points, false, [60, 60, 60, 60], maxZoom)
  } catch {
    map.setCenter(points[Math.floor(points.length / 2)])
  }
}

// 门店数据变化：全量重绘 marker 并自适应
watch(() => props.stores, () => {
  if (mapReady.value) { renderMarkers(); fitToContent() }
}, { deep: false })

// 选中态变化：只更新高亮，避免 hover 扫过列表时反复全量重建 marker
watch(() => props.activeStoreId, () => {
  if (mapReady.value) updateActiveMarkers()
})

watch(() => props.center, () => {
  if (mapReady.value && props.center) {
    renderMarkers()
    if (map) map.setCenter([props.center.lng, props.center.lat])
  }
})

// 暴露给父级：页面据此把 marker 的容器坐标换算成详情卡锚点
function markerContainerPos(lng: number, lat: number): { x: number; y: number } | null {
  if (!map || !AMap) return null
  try {
    const px = map.lngLatToContainer(new AMap.LngLat(Number(lng), Number(lat)))
    return { x: px.x, y: px.y }
  } catch {
    return null
  }
}

// 注意：map 是 onMounted 后才赋值的普通变量，直接放对象里会在 setup 时固化为 null 快照，
// 父级永远拿不到实例（PC 列表点击门店时 setCenter 静默失效）。必须用 getter 暴露实时引用。
defineExpose({
  get map() { return map },
  mapReady,
  fitToContent,
  markerContainerPos,
})
</script>

<template>
  <div ref="el" class="h-full w-full" />
</template>
