import { Sandbox } from '../src/sandbox';

describe('Sandbox', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = new Sandbox();
  });

  it('should run safe JavaScript function body successfully', async () => {
    const code = `
      async function handler(req, res) {
        res.json({ success: true, val: req.body.val * 2 });
      }
    `;
    const req = { body: { val: 5 } } as any;
    const res = {
      json: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    await sandbox.run(code, code, req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, val: 10 });
  });

  it('should block require of child_process statically', async () => {
    const code = `
      async function handler(req, res) {
        const cp = require('child_process');
        cp.execSync('whoami');
        res.json({ success: true });
      }
    `;
    const req = {} as any;
    const res = { json: jest.fn() } as any;

    await expect(sandbox.run(code, code, req, res, jest.fn())).rejects.toThrow(
      /SEIM sandbox security violation: module 'child_process' is not allowed/
    );
  });

  it('should block require of fs statically', async () => {
    const code = `
      async function handler(req, res) {
        const fs = require('fs');
        fs.readFileSync('/etc/passwd');
        res.json({ success: true });
      }
    `;
    const req = {} as any;
    const res = { json: jest.fn() } as any;

    await expect(sandbox.run(code, code, req, res, jest.fn())).rejects.toThrow(
      /SEIM sandbox security violation: module 'fs' is not allowed/
    );
  });

  it('should allow require of safe modules like path and url', async () => {
    const code = `
      async function handler(req, res) {
        const path = require('path');
        const url = require('url');
        res.json({ resolved: path.join('a', 'b'), formatted: url.format({ protocol: 'https', hostname: 'example.com', pathname: '/abc' }) });
      }
    `;
    const req = {} as any;
    const res = {
      json: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as any;

    await sandbox.run(code, code, req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      resolved: 'a/b',
      formatted: 'https://example.com/abc',
    });
  });

  it('should fail on sandbox timeout gracefully', async () => {
    const code = `
      async function handler(req, res) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        res.json({ success: true });
      }
    `;
    const req = {} as any;
    const res = { json: jest.fn() } as any;

    await expect(sandbox.run(code, code, req, res, jest.fn(), 50)).rejects.toThrow(
      /SEIM sandbox wall-clock timeout/
    );
  });
});
