import type { InkMarkApi } from '../shared/ipc'

declare global {
  interface Window {
    api: InkMarkApi
  }
}

export {}
