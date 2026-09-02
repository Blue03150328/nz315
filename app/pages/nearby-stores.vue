<script setup lang="ts">
// 附近农资店（公众端，整页沉浸式设计）
// 规格依据：用户提供的 PC 双栏 / 移动端纵向 + 折叠地图设计稿；
// 实现约束：本项目为 Nuxt 4 + Nuxt UI v4 + Tailwind v4（非 Element Plus），
// 组件复用 Nuxt UI，配色按设计稿取：#f8f9f4 背景 / #2c5c3a 主色 / #e67e22 强调橙 / 8px 圆角
//
// 布局方案（纯 CSS 实现移动/PC 两套，无 JS 重排）：
//   - DOM 顺序 = 移动端视觉顺序（搜索 → 列表 → 地图）
//   - 桌面端用 flex order 让列表(38%) 居左、地图(62%) 居右
//   - 移动端地图画布固定 100dvh 高，外层裁剪 35vh → 展开时外层固定全屏即可（零 resize）
import { wgs84ToGcj02 } from '~/composables/useGeoConvert'

definePageMeta({ layout: 'fullbleed' })
const toast = useToast()
const cfg = useRuntimeConfig()
const amapKey = cfg.public.amapJsKey as string
const securityCode = cfg.public.amapSecurityCode as string

// ---------- 数据与定位 ----------
const pos = ref<{ lng: number; lat: number } | null>(null)   // 我的位置（GCJ-02）
const locating = ref(false)
const locateError = ref('')
const keyword = ref('')

const { data, pending, refresh } = await useFetch<any>('/api/stores/nearby', {
  key: 'stores-nearby-v3',
  query: computed(() => ({
    lng: pos.value?.lng,
    lat: pos.value?.lat,
    keyword: keyword.value || undefined,
    radius: 30000,
    limit: 30,
  })),
})
const stores = computed<any[]>(() => data.value?.rows || [])

const locate = () => {
  if (!import.meta.client || locating.value) return
  if (!navigator.geolocation) { locateError.value = '当前浏览器不支持定位'; return }
  locating.value = true
  locateError.value = ''
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const g = wgs84ToGcj02(p.coords.longitude, p.coords.latitude)
      pos.value = { lng: Number(g.lng.toFixed(6)), lat: Number(g.lat.toFixed(6)) }
      locating.value = false
      refresh()
      toast.add({ title: '定位成功，已按距离由近到远排序', color: 'success' })
    },
    (err) => {
      locating.value = false
      locateError.value = err.code === err.PERMISSION_DENIED
        ? '未获得定位权限，已按授权门店优先展示'
        : '定位失败，请检查定位服务是否开启'
      if (!locatingToastShown.value) {
        toast.add({ title: '定位不可用', description: locateError.value, color: 'warning' })
        locatingToastShown.value = true
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  )
}
const locatingToastShown = ref(false)
const doSearch = () => refresh()

// ---------- 门店选中与展示 ----------
const activeStore = ref<any>(null)      // 当前选中门店（详情卡/弹窗数据源）
const detailStore = ref<any>(null)      // 底部弹窗中的门店
const showDetailSheet = ref(false)
const mapExpanded = ref(false)          // 移动端折叠地图全屏开关
const popupPos = ref<{ x: number; y: number } | null>(null)
const isPc = ref(false)                 // PC 判定：>=1024px

// 视口监听（同时驱动 store-click 的展示分支）
const onViewport = () => { isPc.value = typeof window !== 'undefined' && window.innerWidth >= 1024 }
onMounted(() => { onViewport(); window.addEventListener('resize', onViewport) })
onBeforeUnmount(() => window.removeEventListener('resize', onViewport))

// 地图实例句柄（StoreMap 暴露 mapReady 与容器坐标换算）
const mapRef = ref<{ map?: any; mapReady: Ref<boolean> } | null>(null)

const fmtDistance = (m: number | null | undefined) => {
  if (m === null || m === undefined) return ''
  return m < 1000 ? m + ' 米' : (m / 1000).toFixed(1) + ' 公里'
}
const telHref = (s: any) => 'tel:' + String(s.phone || '')
const navHref = (s: any) => 'https://uri.amap.com/navigation?to=' + s.lng + ',' + s.lat + ',' + encodeURIComponent(s.name) + '&mode=car&coordinate=gaode'

// 任意门店被点击（卡片或 marker）：PC → 地图居中并计算详情卡锚点；移动 → 底部弹窗
const onStoreClick = (s: any) => {
  activeStore.value = s
  // 通过地图实例把门店经纬度换算成画布内坐标，作为详情卡锚点（含列表点击场景）
  const comp: any = mapRef.value
  const px = comp?.markerContainerPos?.(Number(s.lng), Number(s.lat))
  popupPos.value = px || null
  const m = comp?.map
  if (m && Number.isFinite(Number(s.lng)) && Number.isFinite(Number(s.lat))) {
    // 微延迟到详情卡渲染后再移动中心，避免锚点随容器漂移
    setTimeout(() => {
      try { m.setCenter([Number(s.lng), Number(s.lat)]) } catch { /* 忽略 */ }
    }, 50)
  }
  if (!isPc.value) {
    detailStore.value = s
    showDetailSheet.value = true
    mapExpanded.value = false      // 收起全屏地图回到列表
  }
}
// PC 详情卡定位：marker 锚点 + 边界收敛（防止卡片溢出地图可视区被裁掉）
const pcCardStyle = computed(() => {
  if (!popupPos.value) return { display: 'none' }
  const cardW = 264, cardH = 220
  // 地图画布相对 zone-map 的偏移（详情卡挂在 zone-map 内）
  const zone = (popupPos as any).__zoneW || 0
  const zoneW = typeof document !== 'undefined' ? document.querySelector('.zone-map')?.clientWidth || zone : zone
  const zoneH = typeof document !== 'undefined' ? document.querySelector('.zone-map')?.clientHeight || 0 : 0
  let x = popupPos.value.x + 16
  let y = popupPos.value.y - 16
  // 超出右边界 → 向左翻转到 marker 左侧
  if (x + cardW > (zoneW || 1200)) x = Math.max(8, popupPos.value.x - cardW - 16)
  else x = Math.min(x, Math.max(8, (zoneW || 1200) - cardW - 8))
  if (y + cardH > (zoneH || 900)) y = Math.max(8, (zoneH || 900) - cardH - 8)
  if (y < 8) y = 8
  return { left: x + 'px', top: y + 'px' }
})
const onStoreHover = (s: any) => { activeStore.value = s }          // PC hover 联动高亮 marker
const onStoreLeave = () => { /* 保留当前选中，避免闪烁 */ }
const closePopup = () => { activeStore.value = null; popupPos.value = null }
const closeSheet = () => { showDetailSheet.value = false; detailStore.value = null }
</script>

<template>
  <div class="nearby-page">
    <!-- ============ 顶栏：移动端含返回；PC 为紧凑工具栏 ============ -->
    <header class="page-topbar">
      <!-- 移动：返回 -->
      <button v-if="!isPc" type="button" class="topbar-btn" aria-label="返回" @click="router.back()">
        <UIcon name="i-lucide-arrow-left" class="h-5 w-5" />
      </button>
      <div class="topbar-title-wrap">
        <div class="flex items-center gap-2">
          <div class="topbar-logo">
            <UIcon name="i-lucide-store" class="h-4.5 w-4.5 text-white" />
          </div>
          <span class="text-[15px] font-bold text-[#2c5c3a]">附近农资店</span>
          <span class="topbar-sub">授权农资门店 一查即达</span>
        </div>
      </div>
      <button type="button" class="topbar-btn topbar-locate-btn" @click="locate">
        <UIcon v-if="!locating" name="i-lucide-locate-fixed" class="h-4.5 w-4.5" />
        <UIcon v-else name="i-lucide-loader-circle" class="h-4.5 w-4.5 animate-spin" />
        <span class="hidden sm:inline">{{ pos ? '重新定位' : '定位' }}</span>
      </button>
    </header>

    <!-- ============ 主体（DOM=移动顺序；CSS order 实现 PC 分栏） ============ -->
    <div class="nearby-body">
      <!-- 左侧栏（PC：38% 宽；移动端其子元素按视觉顺序直排） -->
      <div class="pc-left-col">
      <!-- ① 搜索区 -->
      <section class="zone-search">
        <div class="search-row">
          <div class="search-input-wrap">
            <UIcon name="i-lucide-search" class="search-icon" />
            <input
              v-model="keyword"
              type="search"
              placeholder="搜索门店名称 / 地址"
              class="search-input"
              @keyup.enter="doSearch"
            >
          </div>
          <button type="button" class="search-btn" :disabled="pending" @click="doSearch">
            <UIcon name="i-lucide-search" class="h-4 w-4 sm:hidden" />
            <span class="hidden sm:inline">搜索</span>
          </button>
        </div>
        <div class="search-meta">
          <span v-if="locateError" class="locate-error-text">
            <UIcon name="i-lucide-map-pin-off" class="h-3 w-3" />{{ locateError }}
          </span>
          <span v-else-if="pos" class="locate-ok-text">
            <UIcon name="i-lucide-check" class="h-3 w-3" />已定位 · 按距离由近到远
          </span>
          <span v-else class="locate-idle-text">
            <UIcon name="i-lucide-info" class="h-3 w-3" />开启定位查看距离
          </span>
          <span class="zone-count">共 {{ stores.length }} 家门店</span>
        </div>
      </section>

      <!-- ② 门店列表 -->
      <section class="zone-list">
        <!-- 空状态 -->
        <div v-if="!pending && stores.length === 0" class="empty-state">
          <div class="empty-icon"><UIcon name="i-lucide-store" class="h-9 w-9 text-[#c7d6c0]" /></div>
          <p class="empty-title">附近暂无收录的农资店</p>
          <p class="empty-sub">可尝试搜索其它名称，或稍后再来看看</p>
        </div>

        <button
          v-for="s in stores"
          :key="s.id"
          type="button"
          class="store-card"
          :class="{ 'is-active': activeStore && Number(activeStore.id) === Number(s.id) }"
          @mouseenter="onStoreHover(s)"
          @mouseleave="onStoreLeave"
          @click="onStoreClick(s)"
        >
          <div class="store-card-head">
            <div class="store-card-title">
              <span class="truncate">{{ s.name }}</span>
              <span v-if="s.isAuthorized" class="auth-tag">授权经销商</span>
            </div>
            <span v-if="s.distance !== null && s.distance !== undefined" class="distance-tag">{{ fmtDistance(s.distance) }}</span>
          </div>
          <div class="store-line"><UIcon name="i-lucide-map-pin" class="line-icon" /><span class="truncate">{{ s.address || '地址待完善' }}</span></div>
          <div class="store-line"><UIcon name="i-lucide-clock" class="line-icon" /><span class="truncate">{{ s.businessHours || '营业时间待确认' }}</span></div>
          <div v-if="s.licenseNo" class="store-line"><UIcon name="i-lucide-badge-check" class="line-icon" /><span class="truncate">农药经营许可证 {{ s.licenseNo }}</span></div>
          <div class="store-card-foot">
            <a v-if="s.phone" :href="telHref(s)" class="call-btn" @click.stop>
              <UIcon name="i-lucide-phone" class="h-3.5 w-3.5" />拨打电话
            </a>
            <span v-else class="text-[11px] text-[#a9b8a6]">暂无联系电话</span>
          </div>
        </button>
      </section>

      </div>

      <!-- ③ 地图区（含移动折叠/全屏与 PC 详情卡） -->
      <section class="zone-map">
        <div class="map-clip" :class="{ 'is-full': mapExpanded }">
          <!-- 画布常驻 100dvh；折叠态靠 clip 露出顶部 35vh，展开态 clip 铺满视口 -->
          <div class="map-canvas">
            <StoreMap
              ref="mapRef"
              :amap-key="amapKey"
              :security-code="securityCode"
              :stores="stores"
              :center="pos"
              :active-store-id="activeStore ? Number(activeStore.id) : null"
              @store-click="onStoreClick"
              @store-hover="onStoreHover"
              @store-leave="onStoreLeave"
            />
          </div>
          <div v-if="!amapKey" class="map-fallback">
            <UIcon name="i-lucide-map" class="h-6 w-6 text-[#c7d6c0]" />
            <p class="text-sm">地图暂不可用</p>
            <p class="text-xs">门店列表与距离功能不受影响</p>
          </div>
          <!-- 折叠态控件 -->
          <template v-if="isPc">
            <div class="map-badge-pc">门店分布 · 悬停列表可查看对应位置</div>
          </template>
          <template v-else>
            <div v-if="!mapExpanded" class="map-badge-m">门店分布</div>
            <button v-if="!mapExpanded" type="button" class="map-expand-btn" @click="mapExpanded = true">
              <UIcon name="i-lucide-maximize-2" class="h-4 w-4" />展开地图
            </button>
            <button v-else type="button" class="map-collapse-btn" @click="mapExpanded = false">
              <UIcon name="i-lucide-minimize-2" class="h-4 w-4" />收起地图
            </button>
          </template>
        </div>

        <!-- PC 详情卡：锚定 marker，并做边界收敛避免卡片溢出地图可视区 -->
        <div v-if="isPc && activeStore && popupPos" class="pc-card" :style="pcCardStyle">
          <button type="button" class="pc-card-close" aria-label="关闭" @click="closePopup"><UIcon name="i-lucide-x" class="h-3.5 w-3.5" /></button>
          <div class="pc-card-head">
            <span class="truncate text-[15px] font-bold">{{ activeStore.name }}</span>
            <span v-if="activeStore.isAuthorized" class="auth-tag auth-tag-sm">授权</span>
          </div>
          <div class="pc-card-line"><UIcon name="i-lucide-map-pin" class="line-icon" /><span>{{ activeStore.address || '地址待完善' }}</span></div>
          <div v-if="activeStore.businessHours" class="pc-card-line"><UIcon name="i-lucide-clock" class="line-icon" /><span>{{ activeStore.businessHours }}</span></div>
          <div v-if="activeStore.licenseNo" class="pc-card-line"><UIcon name="i-lucide-badge-check" class="line-icon" /><span class="truncate">许可证 {{ activeStore.licenseNo }}</span></div>
          <div class="pc-card-actions">
            <a v-if="activeStore.phone" :href="telHref(activeStore)" class="pc-action-btn call"><UIcon name="i-lucide-phone" class="h-3.5 w-3.5" />拨打电话</a>
            <a :href="navHref(activeStore)" target="_blank" rel="noopener" class="pc-action-btn"><UIcon name="i-lucide-navigation" class="h-3.5 w-3.5" />高德导航</a>
          </div>
        </div>
      </section>
    </div>

    <!-- ============ 移动端底部弹窗（门店详情） ============ -->
    <Transition name="sheet">
      <div v-if="showDetailSheet && detailStore" class="sheet-mask" @click.self="closeSheet">
        <div class="sheet">
          <div class="sheet-handle" />
          <div class="sheet-head">
            <span class="truncate text-lg font-bold">{{ detailStore.name }}</span>
            <span v-if="detailStore.isAuthorized" class="auth-tag">授权经销商</span>
            <span v-if="detailStore.distance !== null && detailStore.distance !== undefined" class="distance-tag ml-auto">{{ fmtDistance(detailStore.distance) }}</span>
          </div>
          <div class="sheet-line"><UIcon name="i-lucide-map-pin" class="line-icon" /><span>{{ detailStore.address || '地址待完善' }}</span></div>
          <div v-if="detailStore.businessHours" class="sheet-line"><UIcon name="i-lucide-clock" class="line-icon" /><span>{{ detailStore.businessHours }}</span></div>
          <div v-if="detailStore.licenseNo" class="sheet-line"><UIcon name="i-lucide-badge-check" class="line-icon" /><span class="truncate">许可证 {{ detailStore.licenseNo }}</span></div>
          <div class="sheet-actions">
            <a v-if="detailStore.phone" :href="telHref(detailStore)" class="sheet-action-btn call"><UIcon name="i-lucide-phone" class="h-4 w-4" />拨打电话</a>
            <a :href="navHref(detailStore)" target="_blank" rel="noopener" class="sheet-action-btn"><UIcon name="i-lucide-navigation" class="h-4 w-4" />导航前往</a>
          </div>
          <button type="button" class="sheet-close" @click="closeSheet">关闭</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ================= 本页主题 ================= */
/* 背景 #f8f9f4 / 主色 #2c5c3a / 强调橙 #e67e22 / 卡片圆角 8px 柔和阴影 */
.nearby-page { --c-bg: #f8f9f4; --c-primary: #2c5c3a; --c-accent: #e67e22;
  background: var(--c-bg); min-height: 100dvh; color: #2a332a; }
/* ================= 顶栏 ================= */
.page-topbar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #fff;
  border-bottom: 1px solid #e5ebde; }
.topbar-btn { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px;
  border-radius: 8px; color: var(--c-primary); transition: background .15s; flex: none; }
.topbar-btn:active { background: #eef2e9; }
.topbar-title-wrap { flex: 1; min-width: 0; }
.topbar-logo { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border-radius: 6px; background: var(--c-primary); }
.topbar-sub { margin-left: 6px; font-size: 11px; color: #8fa18b; }
.topbar-locate-btn { gap: 4px; font-size: 12px; }
/* ================= 主体布局：移动纵向 / PC 分栏 ================= */
.nearby-body { display: flex; flex-direction: column; }
.zone-search { order: 1; }
.zone-list { order: 2; }
.zone-map { order: 3; }
/* 左栏包裹层：移动端不产生盒子（子元素直排），PC 端为 38% 宽左列 */
.pc-left-col { display: contents; }
@media (min-width: 1024px) {
  /* PC：左栏 38%（搜索+列表滚动），右侧地图 62% 整高 */
  .nearby-body { flex-direction: row; height: calc(100dvh - 58px); }
  .pc-left-col { display: flex; flex-direction: column; width: 38%; flex: none;
    border-right: 1px solid #e5ebde; background: var(--c-bg); min-width: 0; }
  .zone-search { padding: 12px 14px 4px; }
  .zone-list { flex: 1; overflow-y: auto; padding: 0 14px 14px; }
  .zone-map { flex: 1; position: relative; min-width: 0; background: #eef2e9; }
}
/* ================= 搜索区 ================= */
.search-row { display: flex; gap: 8px; padding: 10px 12px 0; }
.zone-search > .search-row + .search-meta { padding: 6px 12px 8px; }
.search-input-wrap { position: relative; flex: 1; min-width: 0; }
.search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: #9db09b; }
.search-input { width: 100%; height: 40px; padding: 0 12px 0 36px; font-size: 14px; border: 1px solid #dde6d5;
  border-radius: 8px; background: #fff; color: #26302a; outline: none; transition: border-color .15s, box-shadow .15s; }
.search-input::placeholder { color: #a9b8a6; }
.search-input:focus { border-color: var(--c-primary); box-shadow: 0 0 0 3px rgba(44,92,58,.1); }
.search-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; width: 44px;
  border-radius: 8px; color: #fff; background: var(--c-primary); font-size: 14px; font-weight: 600;
  transition: background .15s; }
.search-btn:hover { background: #244f33; }
.search-btn:disabled { opacity: .55; }
.search-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8fa18b; }
.locate-error-text { display: inline-flex; align-items: center; gap: 4px; color: var(--c-accent); font-weight: 500; }
.locate-ok-text { display: inline-flex; align-items: center; gap: 4px; color: var(--c-primary); }
.locate-idle-text { display: inline-flex; align-items: center; gap: 4px; }
.zone-count { margin-left: auto; font-weight: 500; color: var(--c-primary); }
/* ================= 门店列表 ================= */
.zone-list { padding: 0 12px 12px; }
.store-card { display: block; width: 100%; text-align: left; background: #fff; border: 1px solid #e5ebde;
  border-radius: 8px; padding: 12px 14px; margin-bottom: 10px;
  box-shadow: 0 1px 3px rgba(25,45,30,.04), 0 3px 10px rgba(25,45,30,.03);
  transition: border-color .15s, box-shadow .15s, transform .15s; }
.store-card:hover { border-color: #9fbc93; }
.store-card.is-active { border-color: var(--c-primary); box-shadow: 0 0 0 3px rgba(44,92,58,.1), 0 4px 14px rgba(25,45,30,.06); }
.store-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.store-card-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.store-card-title > span:first-child { font-size: 15px; font-weight: 700; color: #1f2a20; }
.auth-tag { flex: none; display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; color: #fff; background: var(--c-accent); }
.auth-tag-sm { padding: 0 6px; font-size: 10px; }
.distance-tag { flex: none; font-size: 12px; font-weight: 700; color: var(--c-accent); }
.store-line { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: #5a6b58; font-size: 13px; min-width: 0; }
.line-icon { flex: none; width: 14px; height: 14px; color: #9db09b; }
.store-card-foot { display: flex; margin-top: 9px; padding-top: 8px; border-top: 1px dashed #eef1e9; }
.call-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 600; color: var(--c-primary); background: #eef2e9; }
.call-btn:hover { background: #e0e9d8; }
/* 空状态 */
.empty-state { display: flex; flex-direction: column; align-items: center; padding: 44px 16px; }
.empty-icon { display: flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 50%;
  background: #e9efe3; margin-bottom: 12px; }
.empty-title { font-size: 15px; font-weight: 600; color: #7d9079; }
.empty-sub { margin-top: 4px; font-size: 12px; color: #a9b8a6; }
/* ================= 地图区 ================= */
.zone-map { position: relative; }
.map-clip { position: relative; overflow: hidden; height: 35vh; min-height: 170px; background: #e5ebde; }
.map-canvas { height: 100dvh; width: 100%; }
.map-clip.is-full { position: fixed; inset: 0; z-index: 80; height: 100dvh; min-height: 0; }
.map-badge-m { position: absolute; top: 10px; left: 10px; padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 600; color: #fff; background: rgba(44,92,58,.75); backdrop-filter: blur(2px); }
.map-badge-pc { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); padding: 4px 12px;
  border-radius: 999px; font-size: 12px; color: #fff; background: rgba(44,92,58,.7); }
.map-expand-btn { position: absolute; right: 12px; bottom: 14px; display: inline-flex; align-items: center; gap: 5px;
  padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #fff;
  background: var(--c-primary); box-shadow: 0 4px 14px rgba(25,45,30,.3); }
.map-collapse-btn { position: absolute; top: 12px; right: 12px; display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--c-primary);
  background: #fff; box-shadow: 0 2px 10px rgba(25,45,30,.15); }
.map-fallback { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 3px; background: #eef2e9; color: #7d9079; }
/* PC 地图整高 */
@media (min-width: 1024px) {
  .map-clip { height: 100%; min-height: 0; }
  .map-canvas { height: 100%; }
  .map-expand-btn, .map-collapse-btn, .map-badge-m { display: none; }
}
/* PC 详情卡 */
.pc-card { position: absolute; z-index: 30; width: 264px; background: #fff; border-radius: 10px;
  box-shadow: 0 10px 32px rgba(20,38,22,.18); padding: 12px; border: 1px solid #e5ebde; }
.pc-card-close { position: absolute; top: 6px; right: 6px; display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 6px; color: #8fa18b; }
.pc-card-close:hover { background: #f1f4ed; }
.pc-card-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.pc-card-line { display: flex; align-items: flex-start; gap: 5px; margin-top: 4px; font-size: 12px; color: #5a6b58; }
.pc-card-actions { display: flex; gap: 8px; margin-top: 10px; }
.pc-action-btn { display: inline-flex; flex: 1; align-items: center; justify-content: center; gap: 5px;
  padding: 7px 0; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--c-primary);
  border: 1px solid #cfe0c8; }
.pc-action-btn.call { color: #fff; background: var(--c-accent); border-color: var(--c-accent); }
/* ================= 移动底部弹窗 ================= */
.sheet-mask { position: fixed; inset: 0; z-index: 90; background: rgba(16,28,18,.45); display: flex; align-items: flex-end; }
.sheet { width: 100%; background: #fff; border-radius: 16px 16px 0 0; padding: 8px 16px 14px;
  box-shadow: 0 -6px 24px rgba(20,38,22,.16); }
.sheet-handle { width: 36px; height: 4px; border-radius: 2px; background: #e2e9dc; margin: 0 auto 10px; }
.sheet-head { display: flex; align-items: center; gap: 6px; }
.sheet-line { display: flex; align-items: flex-start; gap: 6px; margin-top: 9px; font-size: 13px; color: #5a6b58; }
.sheet-actions { display: flex; gap: 10px; margin-top: 14px; }
.sheet-action-btn { display: inline-flex; flex: 1; align-items: center; justify-content: center; gap: 6px;
  padding: 11px 0; border-radius: 8px; font-size: 14px; font-weight: 700; color: #fff; background: var(--c-primary); }
.sheet-action-btn.call { background: var(--c-accent); }
.sheet-close { display: block; width: 100%; margin-top: 10px; text-align: center; font-size: 13px; color: #8fa18b; }
/* 弹窗过渡 */
.sheet-enter-active, .sheet-leave-active { transition: transform .22s ease, opacity .22s ease; }
.sheet-enter-from, .sheet-leave-to { transform: translateY(100%); opacity: 0; }
</style>
