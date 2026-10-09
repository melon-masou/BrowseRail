export type ExtensionConnectionState =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "handshaking"
  | "connected"
  | "syncing"
  | "reconnecting";

export type StateChangeListener = (
  next: ExtensionConnectionState,
  prev: ExtensionConnectionState,
  detail?: string | undefined,
) => void;

export class ExtensionStateMachine {
  private state: ExtensionConnectionState;
  private detail?: string | undefined;
  private readonly listeners = new Set<StateChangeListener>();
  private readonly logger: (message: string) => void;

  constructor(
    initialState: ExtensionConnectionState = "disconnected",
    logger: (message: string) => void = console.log,
  ) {
    this.state = initialState;
    this.logger = logger;
    this.logger(`[BrowseRail:Extension:StateMachine] Initial state: ${this.state}`);
  }

  getState(): ExtensionConnectionState {
    return this.state;
  }

  getDetail(): string | undefined {
    return this.detail;
  }

  transition(next: ExtensionConnectionState, detail?: string | undefined): void {
    if (this.state === next) {
      this.detail = detail;
      return;
    }
    const prev = this.state;
    this.state = next;
    this.detail = detail;
    const detailMsg = detail ? ` (${detail})` : "";
    this.logger(`[BrowseRail:Extension:StateMachine] ${prev} -> ${next}${detailMsg}`);
    for (const listener of this.listeners) {
      listener(next, prev, detail);
    }
  }

  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
