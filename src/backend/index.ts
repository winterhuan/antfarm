import type { Backend, BackendType } from './interface.js';
import { OpenClawBackend } from './openclaw.js';

// Placeholder - will be implemented in Task 3
class HermesBackend implements Backend {
  async install(_workflow: any, _sourceDir: string): Promise<void> {
    throw new Error('HermesBackend not implemented yet');
  }

  async uninstall(_workflowId: string): Promise<void> {
    throw new Error('HermesBackend not implemented yet');
  }

  async startRun(_workflow: any): Promise<void> {
    throw new Error('HermesBackend not implemented yet');
  }

  async stopRun(_workflow: any): Promise<void> {
    throw new Error('HermesBackend not implemented yet');
  }
}

export function createBackend(type: BackendType): Backend {
  switch (type) {
    case 'openclaw':
      return new OpenClawBackend();
    case 'hermes':
      return new HermesBackend();
    default:
      throw new Error(`Unknown backend type: ${type}`);
  }
}

export type { Backend, BackendType } from './interface.js';
