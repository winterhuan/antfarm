export interface CliHarness {
  /** Captured stdout lines */
  stdout: string[];
  /** Captured stderr lines */
  stderr: string[];
  /** Captured exit code (null if process.exit was not called) */
  exitCode: number | null;
  /** Restore original process methods */
  restore: () => void;
}

interface OriginalMethods {
  stdoutWrite: typeof process.stdout.write;
  stderrWrite: typeof process.stderr.write;
  exit: typeof process.exit;
}

export function createCliHarness(): CliHarness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  // Use an object to hold exitCode so the reference is shared
  const state = { exitCode: null as number | null };
  let isActive = false;

  // Store original methods
  const originals: OriginalMethods = {
    stdoutWrite: process.stdout.write.bind(process.stdout),
    stderrWrite: process.stderr.write.bind(process.stderr),
    exit: process.exit.bind(process),
  };

  // Create intercepting write function
  function createInterceptingWrite(
    original: typeof process.stdout.write,
    captureArray: string[]
  ): typeof process.stdout.write {
    return function (
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ): boolean {
      // Handle overload: write(chunk, callback)
      if (typeof encoding === "function") {
        callback = encoding;
        encoding = undefined;
      }

      // Convert chunk to string and capture
      const str = chunk instanceof Uint8Array ? Buffer.from(chunk).toString(encoding || "utf8") : String(chunk);
      captureArray.push(str);

      // Call original to maintain expected behavior
      return original.call(process.stdout, chunk, encoding as BufferEncoding, callback);
    } as typeof process.stdout.write;
  }

  // Intercept stdout.write
  process.stdout.write = createInterceptingWrite(originals.stdoutWrite, stdout);

  // Intercept stderr.write
  process.stderr.write = createInterceptingWrite(originals.stderrWrite, stderr);

  // Intercept process.exit - capture code without terminating
  process.exit = function (code?: number | string | null | undefined): never {
    state.exitCode = typeof code === "number" ? code : 0;
    // Throw an error instead of actually exiting
    // This allows tests to catch and verify the exit
    const error = new Error(`process.exit called with code: ${state.exitCode}`);
    (error as Error & { isExitIntercept: boolean }).isExitIntercept = true;
    throw error;
  } as typeof process.exit;

  isActive = true;

  function restore(): void {
    if (!isActive) {
      return; // Already restored or never activated
    }

    process.stdout.write = originals.stdoutWrite;
    process.stderr.write = originals.stderrWrite;
    process.exit = originals.exit;
    isActive = false;
  }

  return {
    stdout,
    stderr,
    get exitCode() {
      return state.exitCode;
    },
    restore,
  };
}
