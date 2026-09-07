import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { startDashboardServer } from '../../domains/dashboard/server.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-kernel-project');

describe('dashboard visual', () => {
  it('serves status JSON and a dashboard page', async () => {
    const server = await startDashboardServer({ projectRoot: fixture, port: 0 });
    try {
      const statusResponse = await fetch(server.url + '/api/status');
      expect(statusResponse.ok).toBe(true);
      const status = await statusResponse.json() as Record<string, unknown>;
      expect(status).toHaveProperty('goals');
      expect(status).toHaveProperty('plans');

      const htmlResponse = await fetch(server.url);
      const html = await htmlResponse.text();
      expect(html).toContain('cometflow-dashboard');
      expect(html).toContain('CometFlow Dashboard');
    } finally {
      await server.close();
    }
  });
});
