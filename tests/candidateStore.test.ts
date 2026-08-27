import * as fs from 'fs';
import * as path from 'path';
import { MemoryCandidateStore, FileCandidateStore, PersistedCandidate } from '../src/candidateStore';

describe('CandidateStore', () => {
  const testStorage = './.seim-test-candidate-store';

  afterAll(() => {
    try {
      if (fs.existsSync(testStorage)) {
        fs.rmSync(testStorage, { recursive: true, force: true });
      }
    } catch {}
  });

  const makeCandidate = (id: string, routeKey = '/api/test'): PersistedCandidate => ({
    id,
    routeKey,
    status: 'generated',
    originalCode: 'orig',
    optimizedCode: 'opt',
    sourceHash: 'hash123',
    pattern: 'sequential-async',
    transitions: [{ from: 'detected', to: 'generated', at: Date.now(), actor: 'system' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  describe('MemoryCandidateStore', () => {
    it('should save, retrieve, update, and list candidates', async () => {
      const store = new MemoryCandidateStore();
      const cand = makeCandidate('c1');

      await store.save(cand);
      const retrieved = await store.get('c1');
      expect(retrieved?.id).toBe('c1');

      await store.updateStatus('c1', 'approved', {
        from: 'generated',
        to: 'approved',
        at: Date.now(),
        reason: 'Passed review',
        actor: 'user',
      });

      const updated = await store.get('c1');
      expect(updated?.status).toBe('approved');
      expect(updated?.transitions).toHaveLength(2);

      const byRoute = await store.getByRoute('/api/test');
      expect(byRoute).toHaveLength(1);
    });
  });

  describe('FileCandidateStore', () => {
    it('should persist and load candidates from disk', async () => {
      const store = new FileCandidateStore(testStorage);
      const cand = makeCandidate('c-file-1', '/api/disk');

      await store.save(cand);
      const retrieved = await store.get('c-file-1');
      expect(retrieved?.id).toBe('c-file-1');
      expect(retrieved?.routeKey).toBe('/api/disk');

      const all = await store.listAll();
      expect(all.length).toBeGreaterThanOrEqual(1);

      await store.delete('c-file-1');
      const deleted = await store.get('c-file-1');
      expect(deleted).toBeUndefined();
    });
  });
});
