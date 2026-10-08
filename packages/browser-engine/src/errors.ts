/** Expected, user-visible failures. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/** Failures of the surrounding world: transport, provider, browser connection. */
export class RuntimeFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeFailure";
  }
}

/** The observation a decision was made against no longer matches the page. */
export class StalePage extends InputError {
  constructor(message: string) {
    super(message);
    this.name = "StalePage";
  }
}

export function classify(error: unknown): InputError | RuntimeFailure | null {
  if (error instanceof InputError) return error;
  if (error instanceof RuntimeFailure) return error;
  return null;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
