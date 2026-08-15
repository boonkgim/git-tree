import type { GitTreeApi } from './index'

declare global {
  interface Window {
    gitTree: GitTreeApi
  }
}

export {}
