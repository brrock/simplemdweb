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
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { watch } from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'
import { VFile } from 'vfile'
import { WebSocketServer } from 'ws'
import { Command } from 'commander'

const program = new Command()

program
  .name('markdown-server')
  .description('A simple markdown server')
  .version('1.0.0')

program
  .command('serve')
  .description('Start the Markdown server')
  .option('--file <path>', 'Specify the Markdown file or directory', 'README.md')
  .option('--port <port>', 'Specify the server port', '3000')
  .action((options) => {
    new MarkdownServer({ command: 'serve', filepath: options.file, port: parseInt(options.port) }).start()
  })

program
  .command('watch')
  .description('Watch a folder for changes and rebuild')
  .option('--dir <path>', 'Specify the directory to watch', '.')
  .action((options) => {
    new MarkdownServer({ command: 'watch', filepath: options.dir, port: 0 }).watchFiles()
  })

program
  .command('build')
  .description('Generate static HTML from Markdown')
  .option('--file <path>', 'Specify the Markdown file to build')
  .action((options) => {
    if (!options.file) {
      console.error('Please specify a Markdown file to build using --file <path>')
      process.exit(1)
    }
    new MarkdownServer({ command: 'build', filepath: options.file, port: 0 }).buildStatic()
  })

program
  .command('help')
  .description('Show help message')
  .action(() => {
    program.help()
  })

program.parse()

type CommandType = 'serve' | 'watch' | 'build' | 'help'

type ServerConfig = {
  command: CommandType
  filepath: string
  port: number
}

class MarkdownServer {
  private app = new Hono()
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
    if (config.command === 'build') {
      this.buildStatic()
    } else if (config.command === 'watch') {
      this.watchFiles()
    } else {
      this.setupRoutes()
    }
  }

  private async processMarkdown(content: string): Promise<string> {
    const vfile = new VFile(content)
    const file = await this.processor.process(vfile)
    return String(file)
  }

  private template(content: string, title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.15.3/katex.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
</head>
<body>
  <article>
    ${content}
  </article>
</body>
</html>`
  }

  private async buildStatic(): Promise<void> {
    const outputDir = resolve(process.cwd(), 'dist')
    await mkdir(outputDir, { recursive: true })
    
    const fullPath = resolve(this.config.filepath)
    const content = await readFile(fullPath, 'utf-8')
    const processedContent = await this.processMarkdown(content)
    const html = this.template(processedContent, basename(this.config.filepath))
    
    const outputFilePath = join(outputDir, basename(this.config.filepath).replace('.md', '.html'))
    await writeFile(outputFilePath, html)
    console.log(`Generated: ${outputFilePath}`)
    console.log('Static build complete!')
  }

  private watchFiles(): void {
    const directory = resolve(this.config.filepath)
    console.log(`Watching directory: ${directory}`)
    watch(directory, { recursive: true }, async (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        console.log(`File changed: ${filename}`)
        await this.buildStatic()
      }
    })
  }

  private setupRoutes(): void {
    this.app.get('/:file?', async (c) => {
      const requestedFile = c.req.param('file') ?? 'README.md'
      const content = await readFile(this.config.filepath, 'utf-8')
      const html = await this.processMarkdown(content)
      return c.html(this.template(html, requestedFile))
    })
  }

  async start(): Promise<void> {
    Bun.serve({
      port: this.config.port,
      fetch: this.app.fetch
    })
    console.log(`🚀 Server running at http://localhost:${this.config.port}`)
  }
}
