import * as fs from 'fs';
import * as path from 'path';
import { CandidateStatus } from './candidateLifecycle';
import { ValidationReport, ExperimentReport } from './types';

export interface CandidateTransition {
  from: CandidateStatus;
  to: CandidateStatus;
  at: number;
  reason?: string;
  evidence?: Record<string, unknown>;
  actor: 'system' | 'user' | 'ai';
}

export interface PersistedCandidate {
  id: string;
  routeKey: string;
  status: CandidateStatus;
  originalCode: string;
  optimizedCode: string;
  sourceHash: string;
  pattern: string;
  strategy?: string;
  validationReport?: ValidationReport;
  shadowReport?: ExperimentReport;
  transitions: CandidateTransition[];
  createdAt: number;
  updatedAt: number;
}

export interface CandidateStore {
  save(candidate: PersistedCandidate): Promise<void>;
  get(candidateId: string): Promise<PersistedCandidate | undefined>;
  getByRoute(routeKey: string): Promise<PersistedCandidate[]>;
  getByStatus(status: CandidateStatus): Promise<PersistedCandidate[]>;
  updateStatus(
    candidateId: string,
    status: CandidateStatus,
    transition: CandidateTransition,
    validationReport?: ValidationReport,
    shadowReport?: ExperimentReport,
  ): Promise<void>;
  delete(candidateId: string): Promise<boolean>;
  listAll(): Promise<PersistedCandidate[]>;
}

export class MemoryCandidateStore implements CandidateStore {
  private candidates = new Map<string, PersistedCandidate>();

  public async save(candidate: PersistedCandidate): Promise<void> {
    this.candidates.set(candidate.id, { ...candidate });
  }

  public async get(candidateId: string): Promise<PersistedCandidate | undefined> {
    const found = this.candidates.get(candidateId);
    return found ? { ...found } : undefined;
  }

  public async getByRoute(routeKey: string): Promise<PersistedCandidate[]> {
    return Array.from(this.candidates.values()).filter((c) => c.routeKey === routeKey);
  }

  public async getByStatus(status: CandidateStatus): Promise<PersistedCandidate[]> {
    return Array.from(this.candidates.values()).filter((c) => c.status === status);
  }

  public async updateStatus(
    candidateId: string,
    status: CandidateStatus,
    transition: CandidateTransition,
    validationReport?: ValidationReport,
    shadowReport?: ExperimentReport,
  ): Promise<void> {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return;

    candidate.status = status;
    candidate.updatedAt = Date.now();
    candidate.transitions.push(transition);
    if (validationReport) candidate.validationReport = validationReport;
    if (shadowReport) candidate.shadowReport = shadowReport;
  }

  public async delete(candidateId: string): Promise<boolean> {
    return this.candidates.delete(candidateId);
  }

  public async listAll(): Promise<PersistedCandidate[]> {
    return Array.from(this.candidates.values());
  }
}

export class FileCandidateStore implements CandidateStore {
  private storageDir: string;
  private memoryFallback = new MemoryCandidateStore();

  constructor(storagePath: string = './.seim-storage') {
    this.storageDir = path.join(storagePath, 'candidates');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch {
      // Ignore directory creation error (falls back to memory operations if write fails)
    }
  }

  private getFilePath(candidateId: string): string {
    const safeId = candidateId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.storageDir, `${safeId}.json`);
  }

  public async save(candidate: PersistedCandidate): Promise<void> {
    await this.memoryFallback.save(candidate);
    try {
      this.ensureDirectory();
      const filePath = this.getFilePath(candidate.id);
      const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(candidate, null, 2), 'utf-8');
      await fs.promises.rename(tmpPath, filePath);
    } catch (err) {
      // Best-effort write to disk
    }
  }

  public async get(candidateId: string): Promise<PersistedCandidate | undefined> {
    const mem = await this.memoryFallback.get(candidateId);
    if (mem) return mem;

    try {
      const filePath = this.getFilePath(candidateId);
      const data = await fs.promises.readFile(filePath, 'utf-8');
      const candidate: PersistedCandidate = JSON.parse(data);
      await this.memoryFallback.save(candidate);
      return candidate;
    } catch {
      return undefined;
    }
  }

  public async getByRoute(routeKey: string): Promise<PersistedCandidate[]> {
    const all = await this.listAll();
    return all.filter((c) => c.routeKey === routeKey);
  }

  public async getByStatus(status: CandidateStatus): Promise<PersistedCandidate[]> {
    const all = await this.listAll();
    return all.filter((c) => c.status === status);
  }

  public async updateStatus(
    candidateId: string,
    status: CandidateStatus,
    transition: CandidateTransition,
    validationReport?: ValidationReport,
    shadowReport?: ExperimentReport,
  ): Promise<void> {
    const candidate = await this.get(candidateId);
    if (!candidate) return;

    candidate.status = status;
    candidate.updatedAt = Date.now();
    candidate.transitions.push(transition);
    if (validationReport) candidate.validationReport = validationReport;
    if (shadowReport) candidate.shadowReport = shadowReport;

    await this.save(candidate);
  }

  public async delete(candidateId: string): Promise<boolean> {
    await this.memoryFallback.delete(candidateId);
    try {
      const filePath = this.getFilePath(candidateId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      return true;
    } catch {
      return false;
    }
  }

  public async listAll(): Promise<PersistedCandidate[]> {
    try {
      this.ensureDirectory();
      const files = await fs.promises.readdir(this.storageDir);
      const candidates: PersistedCandidate[] = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const data = await fs.promises.readFile(path.join(this.storageDir, file), 'utf-8');
            const parsed = JSON.parse(data);
            if (parsed && parsed.id) {
              candidates.push(parsed);
              await this.memoryFallback.save(parsed);
            }
          } catch {}
        }
      }
      return candidates;
    } catch {
      return this.memoryFallback.listAll();
    }
  }
}
