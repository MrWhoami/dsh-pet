/**
 * dsh-pet locale dictionaries (zh/en).
 * @module @linxin666/dsh-pet/client/locales
 */

/** Dictionary namespace this package registers. */
export const NS = 'pet'

/** Chinese copy. */
export const zh = {
  'pet.feed': '喂食',
  'pet.hide': '隐藏',
  'pet.rename': '改名',
  'pet.confirm': '确定',
  'pet.namePlaceholder': '输入新名字',
  'pet.summon': '召唤{name}',
  'pet.rank': '亲密度 {rank}',
  'pet.rank.name.幼鲸': '幼鲸',
  'pet.rank.name.伙伴': '伙伴',
  'pet.rank.name.挚友': '挚友',
  'pet.rank.name.深海羁绊': '深海羁绊',
  'pet.rank.name.心有灵犀': '心有灵犀',
  'pet.rank.name.传说羁绊': '传说羁绊',
  'pet.rank.name.神话羁绊': '神话羁绊',
  'pet.rank.name.永恒之契': '永恒之契',
  'pet.rank.name.鲸生共渡': '鲸生共渡',
  'pet.points': '{points} 点',
  'pet.treats': '小鱼干 ×{n}',
  'pet.state.loading': '宠物正在赶来…',
  'pet.state.error': '宠物迷路了（连接失败）',
  'pet.renderer.unavailable': '这只宠物需要的渲染器（{renderer}）在当前版本不可用。',
  'pet.live2d.core-missing': 'Live2D 核心未安装：请把官方 live2dcubismcore.min.js 放入 $DSH_HOME/pets/.runtime/ 后刷新（步骤见宠物插件 README）。',
  'pet.live2d.vendor-missing': 'Live2D 组件缺失，请升级宠物插件。',
  'pet.live2d.load-failed': 'Live2D 模型加载失败，请检查该宠物目录的完整性。',
  'pet.openSessionHint': '点击跳转到对应会话',
  // 玩法 HUD（miku-pet 泛化：属性条 / 打工 / 睡觉 / 商店；统一小鱼干经济）。
  'pet.gameplay.menu': '玩法',
  'pet.gameplay.work': '打工',
  'pet.gameplay.stopWork': '收工',
  'pet.gameplay.sleep': '休息',
  'pet.gameplay.wake': '起床',
  'pet.gameplay.shop': '商店',
  'pet.gameplay.skin': '皮肤',
  'pet.gameplay.skinDefault': '默认',
  'pet.gameplay.back': '返回',
  'pet.gameplay.buy': '购买',
  'pet.gameplay.insufficient': '{currency}不足',
  'pet.gameplay.prize': '中奖 +{amount} {currency}',
  'pet.gameplay.working': '打工中',
  'pet.gameplay.sleeping': '睡觉中',
  'pet.gameplay.stat.hunger': '饱食',
  'pet.gameplay.stat.mood': '心情',
  'pet.gameplay.stat.energy': '精力',
  'pet.gameplay.stat.affection': '好感',
  'pet.gameplay.currency.treats': '小鱼干',
  'pet.moreSessions': '展开其余 {n} 个会话的气泡',
  'pet.collapseSessions': '收起会话气泡',
  // 一级设置页（settings.section 席位）。
  'settings.title': '宠物',
  'settings.description': '选一只宠物，摆在页面的角落里。',
  'settings.pet': '宠物',
  'settings.petHint': '名字跟着宠物走，在宠物面板里改。',
  'settings.displayGroup': '显示',
  'settings.bubbleGroup': '气泡',
  'settings.desktopGroup': '桌面',
  'settings.petSurface': '当前客户端的宠物显示方式',
  'settings.petSurfaceAuto': '自动',
  'settings.petSurfacePage': '保留页面宠物',
  'settings.petSurfaceDesktop': '使用桌面宠物',
  'settings.petSurfaceHint': '立即生效，仅保存于当前标签页。隧道访问请选择保留页面宠物；本机通过 LAN 地址访问可选择使用桌面宠物。仅在桌面宠物就绪后隐藏页面宠物。',
  'settings.desktopOverlay': '桌面悬浮窗',
  'settings.desktopOverlayHint': '客户端窗口最小化后，宠物继续显示在桌面上；悬浮窗运行时页面内的宠物会暂时隐藏。',
  'settings.desktopOverlayRunning': '伴生窗口运行中。',
  'settings.desktopOverlayStarting': '伴生窗口正在启动。',
  'settings.desktopOverlayStopped': '伴生窗口未运行。',
  'settings.desktopOverlayDismissed': '桌面悬浮窗已关闭；把开关关掉再打开可重新启动。',
  'settings.desktopOverlayMissing': '未找到伴生窗口程序，请把 DshPetOverlay.exe 放到 $DSH_HOME/pets/.runtime/dsh-pet-overlay/。',
  'settings.desktopOverlayUnsupported': '当前平台不支持桌面悬浮窗。',
  'settings.desktopOverlayLoopbackRequired': '桌面悬浮窗需要宿主支持回环连接。如需同时保留 LAN 访问，请将 webServer.host 配置为 0.0.0.0 或 :: 后重启；仅本机访问可使用 127.0.0.1 或 ::1。',
  'settings.desktopOverlayStopFailed': '伴生窗口未能关闭，仍在运行。请从宠物右键菜单退出，或重新开关此选项以重试。',
  'settings.desktopOverlayUnsupportedPet': '上次伴生窗因宠物包含游戏玩法或使用 Live2D 而退出。选择受支持的宠物后，请关闭再打开此开关以重新启动。',
  'settings.desktopOverlayStartFailed': '伴生窗口加载失败或启动超时；页面宠物仍可使用。请查看日志，排除问题后关闭再打开此开关。',
  'settings.desktopOverlayFailed': '伴生窗口启动失败，查看 %TEMP%\\dsh-pet-overlay.log 或宿主日志。',
  'settings.desktopOverlayFailedDismissed': '伴生窗口已停止且不会自动重启；把开关关掉再打开可重新启动，详情见 %TEMP%\\dsh-pet-overlay.log。',
  'settings.decoration': '状态装饰',
  'settings.decorationHint': '气泡里带上喷水鲸鱼这类装饰。',
  'settings.statusBubbles': '状态气泡',
  'settings.statusBubblesHint': '宠物报告正在思考、正在用哪个工具。',
  'settings.visible': '显示宠物',
  'settings.visibleHint': '藏起来后可在输入区召唤回来。',
  'settings.size': '大小（px）',
  'settings.sizeHint': '宠物的高度。',
  'settings.bubbleScale': '气泡字号',
  'settings.bubbleScaleHint': '字号随宠物缩放，再乘上这个倍数。',
  'settings.right': '距右侧（px）',
  'settings.rightHint': '离窗口右边的距离。',
  'settings.bottom': '距底部（px）',
  'settings.bottomHint': '离窗口底边的距离。',
  'settings.inherit': '默认',
  'settings.on': '开',
  'settings.off': '关',
  'settings.overridden': '已修改',
  'settings.reset': '恢复默认',
  'settings.notExposed': '这个版本的 DSH 没有开放宠物的设置，可直接编辑 $DSH_HOME/settings.yaml。',
  'settings.readOnly': '设置只读。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.saveFailed': '没有保存成功，输入的值还留着。',
  'settings.invalidNumber': '填一个数字，留空用默认值。',
} as const

/** English copy. */
export const en = {
  'pet.feed': 'Feed',
  'pet.hide': 'Hide',
  'pet.rename': 'Rename',
  'pet.confirm': 'OK',
  'pet.namePlaceholder': 'Enter a new name',
  'pet.summon': 'Summon {name}',
  'pet.rank': 'Affinity {rank}',
  'pet.rank.name.幼鲸': 'Baby Whale',
  'pet.rank.name.伙伴': 'Companion',
  'pet.rank.name.挚友': 'Close Friend',
  'pet.rank.name.深海羁绊': 'Deep Sea Bond',
  'pet.rank.name.心有灵犀': 'Kindred Spirit',
  'pet.rank.name.传说羁绊': 'Legendary Bond',
  'pet.rank.name.神话羁绊': 'Mythic Bond',
  'pet.rank.name.永恒之契': 'Eternal Covenant',
  'pet.rank.name.鲸生共渡': 'Lifelong Companion',
  'pet.points': '{points} pts',
  'pet.treats': 'Treats ×{n}',
  'pet.state.loading': 'The pet is on its way…',
  'pet.state.error': 'The pet is lost (connection failed)',
  'pet.renderer.unavailable': 'This pet needs a renderer ({renderer}) that is not available in this build.',
  'pet.live2d.core-missing': 'Live2D Cubism Core is not installed: place the official live2dcubismcore.min.js under $DSH_HOME/pets/.runtime/ and refresh (see the pet plugin README).',
  'pet.live2d.vendor-missing': 'The Live2D component is missing; please update the pet plugin.',
  'pet.live2d.load-failed': 'The Live2D model failed to load; check the pet directory is complete.',
  'pet.openSessionHint': 'Click to jump to this session',
  // Gameplay HUD (miku-pet generalization: stat bars / work / sleep / shop; unified treats economy).
  'pet.gameplay.menu': 'Play',
  'pet.gameplay.work': 'Work',
  'pet.gameplay.stopWork': 'Stop work',
  'pet.gameplay.sleep': 'Sleep',
  'pet.gameplay.wake': 'Wake up',
  'pet.gameplay.shop': 'Shop',
  'pet.gameplay.skin': 'Skin',
  'pet.gameplay.skinDefault': 'Default',
  'pet.gameplay.back': 'Back',
  'pet.gameplay.buy': 'Buy',
  'pet.gameplay.insufficient': 'Not enough {currency}',
  'pet.gameplay.prize': 'Prize +{amount} {currency}',
  'pet.gameplay.working': 'Working',
  'pet.gameplay.sleeping': 'Sleeping',
  'pet.gameplay.stat.hunger': 'Hunger',
  'pet.gameplay.stat.mood': 'Mood',
  'pet.gameplay.stat.energy': 'Energy',
  'pet.gameplay.stat.affection': 'Affection',
  'pet.gameplay.currency.treats': 'Treats',
  'pet.moreSessions': 'Expand {n} more session bubbles',
  'pet.collapseSessions': 'Collapse session bubbles',
  // First-level settings section (the `settings.section` seat).
  'settings.title': 'Pet',
  'settings.description': 'Pick a pet to sit in a corner of the page.',
  'settings.pet': 'Pet',
  'settings.petHint': 'Each pet keeps its own name; rename it from the pet panel.',
  'settings.displayGroup': 'Display',
  'settings.bubbleGroup': 'Bubbles',
  'settings.desktopGroup': 'Desktop',
  'settings.petSurface': 'Pet display in this client',
  'settings.petSurfaceAuto': 'Automatic',
  'settings.petSurfacePage': 'Keep page pet',
  'settings.petSurfaceDesktop': 'Use desktop pet',
  'settings.petSurfaceHint': 'Applies immediately to this tab only. Keep the page pet over a tunnel; use the desktop pet for LAN access on the Host machine. The page pet hides only when the companion is ready.',
  'settings.desktopOverlay': 'Desktop overlay',
  'settings.desktopOverlayHint': 'Keep the pet on the desktop after the client window is minimized; the in-page pet hides while the window runs.',
  'settings.desktopOverlayRunning': 'Companion window is running.',
  'settings.desktopOverlayStarting': 'Companion window is starting.',
  'settings.desktopOverlayStopped': 'Companion window is not running.',
  'settings.desktopOverlayDismissed': 'Desktop overlay is closed; turn the switch off and on to restart it.',
  'settings.desktopOverlayMissing': 'Companion not found. Put DshPetOverlay.exe under $DSH_HOME/pets/.runtime/dsh-pet-overlay/.',
  'settings.desktopOverlayUnsupported': 'Desktop overlay is not supported on this platform.',
  'settings.desktopOverlayLoopbackRequired': 'The desktop overlay needs loopback access. To retain LAN access, set webServer.host to 0.0.0.0 or :: and restart; for local-only access, use 127.0.0.1 or ::1.',
  'settings.desktopOverlayStopFailed': 'The companion could not be stopped and is still running. Quit it from the pet context menu, or turn this switch on and off to retry.',
  'settings.desktopOverlayUnsupportedPet': 'The companion last exited because the pet had gameplay or used Live2D. After selecting a supported pet, turn this switch off and on to restart it.',
  'settings.desktopOverlayStartFailed': 'The companion failed to load or timed out during startup; the page pet remains available. Check the log, then turn this switch off and on to retry.',
  'settings.desktopOverlayFailed': 'The companion failed to start; check %TEMP%\\dsh-pet-overlay.log or the host log.',
  'settings.desktopOverlayFailedDismissed': 'The companion stopped and will not restart automatically; turn the switch off and on to restart it. See %TEMP%\\dsh-pet-overlay.log.',
  'settings.decoration': 'Status decoration',
  'settings.decorationHint': 'Bubbles carry ornaments like the spouting whale.',
  'settings.statusBubbles': 'Status bubbles',
  'settings.statusBubblesHint': 'The pet reports when it is thinking and which tool it is using.',
  'settings.visible': 'Show the pet',
  'settings.visibleHint': 'A hidden pet comes back from the input row.',
  'settings.size': 'Size (px)',
  'settings.sizeHint': 'How tall the pet stands.',
  'settings.bubbleScale': 'Bubble text',
  'settings.bubbleScaleHint': 'Text follows the pet size, times this factor.',
  'settings.right': 'Right inset (px)',
  'settings.rightHint': 'Distance from the right edge of the window.',
  'settings.bottom': 'Bottom inset (px)',
  'settings.bottomHint': 'Distance from the bottom edge of the window.',
  'settings.inherit': 'Default',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.overridden': 'Changed',
  'settings.reset': 'Reset to default',
  'settings.notExposed': 'This DSH version does not open the pet settings here; edit $DSH_HOME/settings.yaml instead.',
  'settings.readOnly': 'Settings are read-only.',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.saveFailed': 'Not saved; what you typed is still there.',
  'settings.invalidNumber': 'Enter a number, or leave it empty for the default.',
} as const

/** Key union for this namespace. */
export type PetKey = keyof typeof zh

/** The settings-card slice of the pet dictionary. */
export type SettingsCardKey = PetKey

/**
 * Active dictionary, picked by the document language at call time. The pet
 * mounts as a global floating surface (not a session-scoped slot), so it has
 * no framework locale seat and resolves its copy the same tiny way the
 * task-board's DOM-injected surface does.
 */
export function dictionary(): Record<PetKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/**
 * Translate a key with optional `{name}` template params. Mirrors the slot
 * `Translate` contract `(key, params?) => string` so it can be handed to the
 * same components that used to receive the framework-injected `t` seat. The
 * key is typed loosely (`string`) so the function is assignable to the slot's
 * `TranslateNS<'pet'>` (whose key domain also spans the shared common
 * vocabulary); a missing key degrades to the key itself rather than throwing.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  let text: string = (dictionary() as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-pet UI copy. */
    pet: PetKey
  }
}
