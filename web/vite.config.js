import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { spawn } from 'child_process';

// 自定义插件:serve 项目根的 data/processed/ 目录
// 让前端 fetch('/data/processed/events.json') 能访问到 ../data/processed/events.json
function serveDataPlugin() {
  const dataDir = resolve(__dirname, '..', 'data');
  return {
    name: 'serve-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const filePath = resolve(dataDir, req.url.replace(/^\//, '').split('?')[0]);
        if (!filePath.startsWith(dataDir)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        try {
          const content = readFileSync(filePath);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(content);
        } catch {
          res.statusCode = 404;
          res.end('Not Found');
        }
      });

      // 刷新数据接口:SSE 流式回传 pipeline 日志
      // 前端 POST /api/refresh → 后端 spawn npm run pipeline → 实时推送 stdout
      server.middlewares.use('/api/refresh', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const send = (type, data) => {
          res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
        };

        send('log', '🚀 启动 Pipeline...\n');
        const projectRoot = resolve(__dirname, '..');
        const child = spawn('npm', ['run', 'pipeline'], {
          cwd: projectRoot,
          shell: true,
        });

        child.stdout.on('data', (chunk) => {
          send('log', chunk.toString());
        });
        child.stderr.on('data', (chunk) => {
          send('log', chunk.toString());
        });
        child.on('close', (code) => {
          if (code === 0) {
            send('done', '✅ Pipeline 完成,数据已更新');
          } else {
            send('error', `❌ Pipeline 失败(退出码 ${code})`);
          }
          res.end();
        });
        child.on('error', (err) => {
          send('error', `❌ 启动失败: ${err.message}`);
          res.end();
        });

        // 客户端断开时杀掉子进程
        req.on('close', () => {
          if (!child.killed) child.kill();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), serveDataPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    open: true,
    fs: {
      // 允许访问项目根目录(用于读取 data/)
      allow: ['..'],
    },
  },
  base: './',
});
