import { stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

const root = process.cwd()

const notFound = () => new Response('Not found', { status: 404 })

const server = Bun.serve({
  // Loopback only: this serves the whole repo root, .git included.
  hostname: '127.0.0.1',
  fetch: async req => {
    const url = new URL(req.url)
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (path !== root && !path.startsWith(root + sep)) return notFound()
    const isDir = (await stat(path).catch(() => null))?.isDirectory()
    if (isDir && !url.pathname.endsWith('/'))
      return Response.redirect(new URL(`${url.pathname}/${url.search}`, url), 301)
    const file = Bun.file(isDir ? join(path, 'index.html') : path)
    if (!(await file.exists())) return notFound()
    return new Response(file, { headers: { 'cache-control': 'no-cache' } })
  },
})

console.log(`Serving ${root} at ${server.url}`)
