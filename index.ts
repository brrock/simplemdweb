#!/usr/bin/env bun
import { Hono } from 'hono'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import rehypeHighlight from 'rehype-highlight'
import rehypePrism from 'rehype-prism'
import { readFile, readdir } from 'node:fs/promises'
import { watch } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { VFile } from 'vfile'
import { WebSocketServer } from 'ws'

type Command = 'serve' | 'watch'
type WatchedFiles = Map<string, string>

interface ServerConfig {
  command: Command
  filepath: string
  port: number
}

interface TemplateOptions {
  content: string
  files?: string[]
  currentFile: string
}

class MarkdownServer {
  private app = new Hono()
  private wss: WebSocketServer
  private watchedFiles: WatchedFiles = new Map()
  private currentFile: string
  private processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex)
    .use(rehypePrism)
    .use(rehypeHighlight)
    .use(rehypeStringify)

  constructor(private config: ServerConfig) {
    this.currentFile = config.filepath
    this.wss = new WebSocketServer({ port: config.port + 1 })
    this.setupRoutes()
  }

  private async processMarkdown(content: string): Promise<string> {
    const vfile = new VFile(content)
    const file = await this.processor.process(vfile)
    return String(file)
  }

  private template({ content, files = [], currentFile }: TemplateOptions): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MD Preview - ${basename(currentFile)}</title>
  <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.15.3/katex.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloud  sudo rpi-eeprom-update -aflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/line-numbers/prism-line-numbers.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/toolbar/prism-toolbar.min.css">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          typography: {
            DEFAULT: {
              css: {
                maxWidth: '100ch',
                color: '#374151',
                p: {
                  marginTop: '1.25em',
                  marginBottom: '1.25em',
                },
                'h1, h2, h3': {
                  color: '#111827',
                  fontWeight: '700',
                },
                '.math': {
                  overflow: 'auto'
                },
                a: {
                  color: '#2563eb',
                  '&:hover': {
                    color: '#1d4ed8',
                  },
                },
                pre: {
                  backgroundColor: '#1f2937',
                  color: '#e5e7eb',
                  overflow: 'auto',
                  padding: '1rem',
                },
                code: {
                  color: '#ef4444',
                  '&::before': {
                    content: '""',
                  },
                  '&::after': {
                    content: '""',
                  },
                },
                'code::before': {
                  content: '""',
                },
                'code::after': {
                  content: '""',
                },
              },
            },
          },
        },
      },
    }
  </script>
</head>
<body class="min-h-screen bg-gray-50">
  ${files.length > 0 ? this.renderSidebar(files, currentFile) : ''}
  <div class="${files.length > 0 ? 'ml-64' : ''}">
    <div class="container mx-auto px-4 py-8">
      <article class="prose prose-lg mx-auto bg-white rounded-lg shadow-lg p-8">
        ${content}
      </article>
    </div>
  </div>
  <script>
    const ws = new WebSocket('ws://localhost:${this.config.port + 1}');
    ws.onmessage = () => location.reload();
  </script>
</body>
</html>`
  }

  private renderSidebar(files: string[], currentFile: string): string {
    return `
    <div class="fixed left-0 top-0 h-full w-64 bg-gray-100 p-4 overflow-y-auto">
      <h2 class="text-lg font-bold mb-4">Markdown Files</h2>
      ${files.map(file => `
        <div class="p-2 hover:bg-gray-200 rounded cursor-pointer mb-1 truncate 
                    ${file === currentFile ? 'bg-blue-100 text-blue-800' : ''}"
             onclick="window.location.href='/${encodeURIComponent(file)}'">
          ${basename(file)}
        </div>
      `).join('')}
    </div>`
  }

  private async watchDirectory(dir: string): Promise<void> {
    const files = await readdir(dir, { recursive: true })
    const mdFiles = files
      .filter((file): file is string => 
        typeof file === 'string' && file.endsWith('.md'))
      .map(file => join(dir, file))

    for (const file of mdFiles) {
      try {
        const content = await readFile(file, 'utf-8')
        this.watchedFiles.set(file, content)
      } catch (error) {
        console.error(`Error reading ${file}:`, error)
      }
    }

    watch(dir, { recursive: true }, async (_event, filename) => {
      if (!filename?.endsWith('.md')) return

      const filepath = join(dir, filename)
      try {
        const content = await readFile(filepath, 'utf-8')
        this.watchedFiles.set(filepath, content)
        this.broadcastReload()
      } catch (error) {
        console.error(`Error reading ${filepath}:`, error)
      }
    })
  }

  private broadcastReload(): void {
    this.wss.clients.forEach((client: { send: (arg0: string) => any }) => client.send('reload'))
  }

  private setupRoutes(): void {
    this.app.get('/:file?', async (c) => {
      try {
        const requestedFile = c.req.param('file')
        this.currentFile = requestedFile 
          ? decodeURIComponent(requestedFile)
          : this.config.filepath

        let content: string
        if (this.config.command === 'watch') {
          content = this.watchedFiles.get(this.currentFile) ?? 'File not found'
        } else {
          content = await readFile(this.currentFile, 'utf-8')
        }

        const html = await this.processMarkdown(content)
        const files = this.config.command === 'watch' 
          ? Array.from(this.watchedFiles.keys())
          : []

        return c.html(this.template({
          content: html,
          files,
          currentFile: this.currentFile
        }))
      } catch (error) {
        const err = error as Error
        return c.html(this.template({
          content: `
            <h1 class="text-red-600">Error</h1>
            <p>Failed to load markdown file: ${err.message}</p>
            <pre class="mt-4 p-4 bg-red-50 text-red-900 rounded">${err.stack}</pre>
          `,
          currentFile: this.currentFile
        }))
      }
    })
  }

  async start(): Promise<void> {
    if (this.config.command === 'watch') {
      const dir = resolve(process.cwd(), this.config.filepath)
      await this.watchDirectory(dir)
      console.log(`📁 Watching directory: ${dir}`)
    }

    Bun.serve({
      port: this.config.port,
      fetch: this.app.fetch
    })

    console.log(`🚀 Server running at http://localhost:${this.config.port}`)
  }
}

function parseArgs(): ServerConfig {
  const args = process.argv.slice(2)
  const options: Partial<ServerConfig> = {
    command: 'serve',
    filepath: 'README.md',
    port: 3000
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        console.log(`
Usage:
  ./preview.ts [command] [options]

Commands:
  serve     Serve a single markdown file (default)
  watch     Watch a directory for markdown files

Options:
  --file, -f    Markdown file or directory path (default: README.md)
  --port, -p    Port number (default: 3000)
  --help, -h    Show this help message

Examples:
  ./preview.ts serve --file README.md --port 3000
  ./preview.ts watch --file docs --port 4000
        `)
        process.exit(0)
        break
      
      case '--file':
      case '-f':
        options.filepath = args[++i]
        break
      
      case '--port':
      case '-p':
        options.port = parseInt(args[++i])
        if (isNaN(options.port)) {
          console.error('Error: Port must be a number')
          process.exit(1)
        }
        break
      
      case 'serve':
      case 'watch':
        options.command = args[i] as Command
        break
      
      default:
        console.error(`Unknown option: ${args[i]}`)
        process.exit(1)
    }
  }

  return options as ServerConfig
}

// Start the server
const config = parseArgs()
const server = new MarkdownServer(config)
await server.start()