import { Request, Response, RequestHandler } from 'express';
import { SeimInstance } from './types';

export function createStudioHandler(instance: SeimInstance): RequestHandler {
  return (req: Request, res: Response): void => {
    const route = req.params[0] || 'index';
    if (req.path.endsWith('/api/status')) {
      res.json({ ok: true, status: instance.status() });
      return;
    }
    if (req.path.endsWith('/api/metrics')) {
      res.json(instance.metrics.snapshot());
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!doctype html>
<html>
<head>
  <title>SEIM Studio</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    nav { background: #1e293b; padding: 1rem; display: flex; gap: 1rem; }
    nav a { color: #94a3b8; text-decoration: none; }
    nav a.active { color: #38bdf8; }
    main { padding: 1.5rem; }
    pre { background: #1e293b; padding: 1rem; border-radius: 0.5rem; overflow: auto; }
  </style>
</head>
<body>
  <nav>
    <a href="${instance.config.studioPath}">Endpoint Explorer</a>
    <a href="${instance.config.studioPath}/api/metrics">Metrics JSON</a>
    <a href="${instance.config.studioPath}/api/status">Status</a>
  </nav>
  <main>
    <h1>SEIM Studio</h1>
    <p>Mode: <strong>${instance.config.mode}</strong></p>
    <pre>${JSON.stringify({ status: instance.status(), metrics: instance.metrics.snapshot() }, null, 2)}</pre>
  </main>
  <script>
    setInterval(() => location.reload(), 10000);
  </script>
</body>
</html>`);
  };
}
