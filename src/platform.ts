/* SelfHub — پلتفرم mtcute برای Cloudflare Workers */

import type { ICorePlatform } from '@mtcute/core'
import { WebCryptoProvider, WebSocketTransport } from '@mtcute/web'
import { initSync } from '@mtcute/wasm'
import wasmModule from '@mtcute/wasm/mtcute-simd.wasm'

/**
 * پلتفرم سبک برای Workers — بدون وابستگی به navigator/localStorage
 */
export class WorkersPlatform implements ICorePlatform {
  beforeExit(_fn: () => void): () => void {
    return () => {}
  }
  log(_color: number, level: number, tag: string, fmt: string, args: unknown[]): void {
    if (level <= 2) console.log(`[mtcute:${tag}]`, fmt, ...args)
  }
  getDefaultLogLevel(): number | null {
    return null
  }
  getDeviceModel(): string {
    return 'SelfHub on Cloudflare Workers'
  }
  onNetworkChanged(_fn: (connected: boolean) => void): () => void {
    return () => {}
  }
  isOnline(): boolean {
    return true
  }
}

/**
 * کریپتو برای Workers:
 * کامپایل runtime کد WASM در Workers ممنوع است؛
 * پس ماژول WASM با قانون CompiledWasm از باندل می‌آید و با initSync نمونه‌سازی می‌شود.
 */
export class WorkersCryptoProvider extends WebCryptoProvider {
  override async initialize(): Promise<void> {
    initSync(wasmModule)
  }
}

export function makeTransport(): WebSocketTransport {
  // اتصال از طریق اندپوینت‌های رسمی WebSocket تلگرام (همان که کلاینت وب استفاده می‌کند)
  return new WebSocketTransport()
}
