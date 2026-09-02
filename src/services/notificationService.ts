import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

/**
 * 系统通知 Service
 *
 * 封装 tauri-plugin-notification：首次使用时请求权限，之后按需发送。
 * 通知开关（会话完成/失败/审批）由 useSettingsStore 控制，这里只负责真正发通知。
 */
class NotificationService {
  private permissionReady: boolean | null = null

  /** 确保权限已授予（首次调用请求一次，结果缓存） */
  private async ensurePermission(): Promise<boolean> {
    if (this.permissionReady !== null) return this.permissionReady
    try {
      let granted = await isPermissionGranted()
      if (!granted) {
        granted = (await requestPermission()) === 'granted'
      }
      this.permissionReady = granted
      return granted
    } catch {
      // 平台不支持或权限请求失败：静默降级（不阻塞业务）
      this.permissionReady = false
      return false
    }
  }

  /**
   * 发送系统通知
   * @param title 标题
   * @param body 正文
   * @param opts 附加选项
   */
  async notify(title: string, body: string, opts?: { onAction?: () => void }): Promise<void> {
    const ok = await this.ensurePermission()
    if (!ok) return
    try {
      const res = await sendNotification({ title, body })
      // sendNotification 无返回值；若插件返回 Promise<void> 则静默成功
      void res
      // 点击通知回调：tauri 插件不直接暴露 onClick，这里仅预留扩展位
      void opts?.onAction
    } catch (err) {
      console.error('[notification] send failed', err)
    }
  }
}

export const notificationService = new NotificationService()
