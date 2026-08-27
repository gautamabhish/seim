import * as fs from 'fs';
import * as path from 'path';

export interface EvolutionArtifact {
  id: string;
  routeKey: string;
  candidateId: string;
  sourceHash: string;
  patchDiff: string;
  builtCode: string;
  testResults?: { passed: boolean; details?: any };
  securityScan?: { passed: boolean; details?: any };
  createdAt: number;
  promotedAt?: number;
  lineage: string[];
}

export interface ArtifactStore {
  save(artifact: EvolutionArtifact): Promise<void>;
  get(id: string): Promise<EvolutionArtifact | undefined>;
  getByRoute(routeKey: string): Promise<EvolutionArtifact[]>;
  listAll(): Promise<EvolutionArtifact[]>;
  delete(id: string): Promise<boolean>;
}

export class MemoryArtifactStore implements ArtifactStore {
  private artifacts = new Map<string, EvolutionArtifact>();

  public async save(artifact: EvolutionArtifact): Promise<void> {
    this.artifacts.set(artifact.id, { ...artifact });
  }

  public async get(id: string): Promise<EvolutionArtifact | undefined> {
    const found = this.artifacts.get(id);
    return found ? { ...found } : undefined;
  }

  public async getByRoute(routeKey: string): Promise<EvolutionArtifact[]> {
    return Array.from(this.artifacts.values()).filter((a) => a.routeKey === routeKey);
  }

  public async listAll(): Promise<EvolutionArtifact[]> {
    return Array.from(this.artifacts.values());
  }

  public async delete(id: string): Promise<boolean> {
    return this.artifacts.delete(id);
  }
}

export class FileArtifactStore implements ArtifactStore {
  private storageDir: string;
  private memoryFallback = new MemoryArtifactStore();

  constructor(storagePath: string = './.seim-storage') {
    this.storageDir = path.join(storagePath, 'artifacts');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch {}
  }

  private getFilePath(id: string): string {
    const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.storageDir, `${safeId}.json`);
  }

  public async save(artifact: EvolutionArtifact): Promise<void> {
    await this.memoryFallback.save(artifact);
    try {
      this.ensureDirectory();
      const filePath = this.getFilePath(artifact.id);
      await fs.promises.writeFile(filePath, JSON.stringify(artifact, null, 2), 'utf-8');
    } catch {}
  }

  public async get(id: string): Promise<EvolutionArtifact | undefined> {
    const mem = await this.memoryFallback.get(id);
    if (mem) return mem;

    try {
      const filePath = this.getFilePath(id);
      const data = await fs.promises.readFile(filePath, 'utf-8');
      const artifact: EvolutionArtifact = JSON.parse(data);
      await this.memoryFallback.save(artifact);
      return artifact;
    } catch {
      return undefined;
    }
  }

  public async getByRoute(routeKey: string): Promise<EvolutionArtifact[]> {
    const all = await this.listAll();
    return all.filter((a) => a.routeKey === routeKey);
  }

  public async listAll(): Promise<EvolutionArtifact[]> {
    try {
      this.ensureDirectory();
      const files = await fs.promises.readdir(this.storageDir);
      const artifacts: EvolutionArtifact[] = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const data = await fs.promises.readFile(path.join(this.storageDir, file), 'utf-8');
            const parsed = JSON.parse(data);
            if (parsed && parsed.id) {
              artifacts.push(parsed);
              await this.memoryFallback.save(parsed);
            }
          } catch {}
        }
      }
      return artifacts;
    } catch {
      return this.memoryFallback.listAll();
    }
  }

  public async delete(id: string): Promise<boolean> {
    await this.memoryFallback.delete(id);
    try {
      const filePath = this.getFilePath(id);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      return true;
    } catch {
      return false;
    }
  }
}
