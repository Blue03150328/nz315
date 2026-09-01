<script setup lang="ts">
// 附近农资店（公众端）
// 数据来自平台自建门店库；距离由服务端计算，定位用浏览器原生 API + 坐标系转换，
// 高德仅用于地图展示——未配置高德密钥时自动降级为纯列表，功能不受影响。
const toast = useToast()
const cfg = useRuntimeConfig()
const amapKey = cfg.public.amapJsKey as string

const pos = ref<{ lng: number; lat: number } | null>(null)
const locating = ref(false)
const locateError = ref('')
const keyword = ref('')

const { data, pending, refresh } = await useFetch<any>('/api/stores/nearby', {
  key: 'stores-nearby',
  query: computed(() => ({
    lng: pos.value?.lng,
    lat: pos.value?.lat,
    keyword: keyword.value || undefined,
    radius: 30000,
    limit: 30,
  })),
})

// 定位：浏览器返回 WGS-84，需转成 GCJ-02 才能与门店库（高德坐标系）对齐
const locate = () => {
  if (!import.meta.client) return
  if (!navigator.geolocation) {
    locateError.value = '当前浏览器不支持定位'
    return
  }
  locating.value = true
  locateError.value = ''
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const g = wgs84ToGcj02(p.coords.longitude, p.coords.latitude)
      pos.value = { lng: Number(g.lng.toFixed(6)), lat: Number(g.lat.toFixed(6)) }
      locating.value = false
      refresh()
      toast.add({ title: '定位成功，已按距离排序', color: 'success' })
    },
    (err) => {
      locating.value = false
      locateError.value = err.code === err.PERMISSION_DENIED
        ? '定位权限被拒绝，可手动搜索门店名称'
        : '定位失败，请检查定位服务是否开启'
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  )
}

const doSearch = () => refresh()

const fmtDistance = (m: number | null) => {
  if (m === null || m === undefined) return ''
  return m < 1000 ? m + ' 米' : (m / 1000).toFixed(1) + ' 公里'
}

// 高德地图：仅在已配置密钥且定位成功后加载（渐进增强）
const mapEl = ref<HTMLElement | null>(null)
let mapInstance: any = null
const loadAmap = async () => {
  if (!amapKey || !import.meta.client || !mapEl.value || mapInstance) return
  const sec = cfg.public.amapSecurityCode as string
  if (sec) (window as any)._AMapSecurityConfig = { securityJsCode: sec }
  await new Promise<void>((resolve, reject) => {
    if ((window as any).AMap) return resolve()
    const s = document.createElement('script')
    s.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(amapKey)
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('地图脚本加载失败'))
    document.head.appendChild(s)
  })
  const AMap = (window as any).AMap
  mapInstance = new AMap.Map(mapEl.value, {
    zoom: 12,
    center: pos.value ? [pos.value.lng, pos.value.lat] : [116.397428, 39.90923],
  })
  renderMarkers()
}
const renderMarkers = () => {
  const AMap = (window as any).AMap
  if (!mapInstance || !AMap) return
  mapInstance.clearMap()
  if (pos.value) {
    new AMap.Marker({ position: [pos.value.lng, pos.value.lat], title: '我的位置', map: mapInstance })
  }
  for (const s of data.value?.rows || []) {
    if (s.lng === null || s.lat === null) continue
    new AMap.Marker({ position: [s.lng, s.lat], title: s.name, map: mapInstance })
  }
}
watch(() => data.value?.rows, () => { if (mapInstance) renderMarkers() })
watch(pos, () => { if (amapKey) loadAmap() })
onMounted(() => { if (amapKey) loadAmap() })

useHead({ title: '附近农资店 - 农资315' })
</script>

<template>
  <div class="pb-6">
    <PageHeader title="附近农资店" :show-back="true" />

    <div class="space-y-4 px-4 pt-4 lg:mx-auto lg:max-w-3xl lg:px-0">
      <!-- 定位与搜索 -->
      <div class="rounded-2xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2">
          <UInput v-model="keyword" placeholder="搜索门店名称或地址" icon="i-lucide-search" class="flex-1" @keyup.enter="doSearch" />
          <UButton :loading="pending" @click="doSearch">搜索</UButton>
        </div>
        <div class="mt-3 flex items-center justify-between gap-2">
          <div class="min-w-0 text-xs text-muted">
            <template v-if="pos">
              已定位，按距离由近到远排序
            </template>
            <template v-else-if="locateError">
              <span class="text-warning">{{ locateError }}</span>
            </template>
            <template v-else>
              开启定位可查看距离并按远近排序
            </template>
          </div>
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-locate-fixed" :loading="locating" @click="locate">
            {{ pos ? '重新定位' : '开启定位' }}
          </UButton>
        </div>
      </div>

      <!-- 地图（已配置高德密钥且定位后展示；未配置则不出现，不影响列表） -->
      <div v-if="amapKey" class="overflow-hidden rounded-2xl border border-border bg-elevated shadow-sm">
        <div ref="mapEl" class="h-56 w-full" />
      </div>

      <!-- 门店列表 -->
      <div class="overflow-hidden rounded-2xl border border-border bg-elevated shadow-sm">
        <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <span class="flex items-center gap-2 text-sm font-semibold text-default">
            <UIcon name="i-lucide-store" class="h-4 w-4 text-primary" />
            门店列表
          </span>
          <span class="text-xs text-muted">共 {{ data?.rows?.length || 0 }} 家</span>
        </div>

        <div v-if="data?.rows?.length" class="divide-y divide-border/60">
          <div v-for="s in data.rows" :key="s.id" class="px-4 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate text-sm font-semibold text-default">{{ s.name }}</span>
                  <span v-if="s.isAuthorized" class="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">授权经销商</span>
                </div>
                <div class="mt-1 flex items-start gap-1 text-xs text-muted">
                  <UIcon name="i-lucide-map-pin" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span class="min-w-0">{{ s.address || '地址待完善' }}</span>
                </div>
                <div v-if="s.businessHours" class="mt-1 flex items-center gap-1 text-xs text-muted">
                  <UIcon name="i-lucide-clock" class="h-3.5 w-3.5 shrink-0" />{{ s.businessHours }}
                </div>
                <div v-if="s.licenseNo" class="mt-1 flex items-center gap-1 text-xs text-muted">
                  <UIcon name="i-lucide-badge-check" class="h-3.5 w-3.5 shrink-0" />经营许可证 {{ s.licenseNo }}
                </div>
              </div>
              <div class="shrink-0 text-right">
                <div v-if="s.distance !== null" class="text-sm font-semibold text-primary">{{ fmtDistance(s.distance) }}</div>
                <a v-if="s.phone" :href="'tel:' + s.phone" class="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-default transition-colors hover:bg-muted/40">
                  <UIcon name="i-lucide-phone" class="h-3.5 w-3.5" />拨打
                </a>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="!pending" class="px-4 py-12 text-center">
          <UIcon name="i-lucide-store" class="mx-auto h-10 w-10 text-muted/50" />
          <p class="mt-2 text-sm text-muted">附近暂无收录的农资店</p>
          <p class="mt-1 text-xs text-muted/80">可尝试扩大范围或搜索门店名称</p>
        </div>
      </div>

      <p class="px-2 text-center text-xs text-muted">
        门店信息由平台维护，「授权经销商」为农药生产企业授权的正规渠道
      </p>
    </div>
  </div>
</template>
