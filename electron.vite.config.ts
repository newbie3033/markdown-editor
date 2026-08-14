import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          // Split vendor libraries into separate chunks: the app shell can
          // start rendering while the heavier Milkdown/ProseMirror code is
          // still being parsed. No catch-all chunk to avoid import cycles.
          manualChunks(id: string): string | undefined {
            if (!id.includes('node_modules')) return undefined
            if (
              /prosemirror|@milkdown|remark|micromark|mdast|unist|unified|@floating-ui|katex|codemirror|@codemirror|@lezer|vue|@vue|dompurify|hast|refractor/.test(
                id
              )
            ) {
              return 'milkdown-vendor'
            }
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
            return undefined
          }
        }
      }
    }
  }
})
