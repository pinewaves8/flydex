import type { Platform } from '@/types/common'

/** 获取当前平台 */
export function getPlatform(): Platform {
  if (navigator.userAgent.includes('Win')) return 'windows'
  if (navigator.userAgent.includes('Mac')) return 'macos'
  return 'linux'
}

/** 是否为 Windows */
export function isWindows(): boolean {
  return getPlatform() === 'windows'
}

/** 是否为 macOS */
export function isMacOS(): boolean {
  return getPlatform() === 'macos'
}
