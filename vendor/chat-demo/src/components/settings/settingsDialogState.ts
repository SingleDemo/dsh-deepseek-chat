import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有可用凭据时打开设置并选中「数据管理」，返回是否已能发起请求 */
export const ensureApiKey = () => {
  // 插件改动：账号登录模式下不再要求手填 Key，登录状态由设置里的账号行展示。
  if (useSettings.getState().authMode === 'account') {
    return true
  }
  if (useSettings.getState().apiKey) {
    return true
  }
  openSettings('data')
  return false
}
