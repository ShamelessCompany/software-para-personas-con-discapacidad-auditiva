import type { AsrResult, AsrStartResult, OperationResult, SidecarStatus } from "../shared/types";

export const LISTENING_TRANSITION_RESULT = {
  DEMO_STARTED: "demo-started",
  REAL_STARTED: "real-started",
  STOPPED: "stopped",
  PAUSED: "paused",
  RESUMED: "resumed",
  MICROPHONE_FAILED: "microphone-failed",
  OPERATION_FAILED: "operation-failed",
} as const;

type ListeningTransitionResultKind = (typeof LISTENING_TRANSITION_RESULT)[keyof typeof LISTENING_TRANSITION_RESULT];

export interface ListeningTransitionResult {
  kind: ListeningTransitionResultKind;
  operation?: OperationResult | AsrStartResult;
}

interface ListeningTransitionServices {
  startMicrophone: () => Promise<boolean>;
  pauseMicrophone: () => Promise<void>;
  resumeMicrophone: () => Promise<void>;
  stopMicrophone: () => void;
  startAsr: () => Promise<AsrStartResult>;
  stopAsr: () => Promise<OperationResult>;
  startDemo: () => void;
  pauseDemo: () => void;
  resumeDemo: () => void;
  cancelDemo: () => void;
  onTransition: (transitioning: boolean) => void;
}

const SESSION_MODE = {
  REAL: "real",
  DEMO: "demo",
} as const;

type SessionMode = (typeof SESSION_MODE)[keyof typeof SESSION_MODE];

const TRANSITION_PHASE = {
  START_REAL: "start-real",
  START_DEMO: "start-demo",
  STOP: "stop",
  PAUSE: "pause",
  RESUME: "resume",
} as const;

type TransitionPhase = (typeof TRANSITION_PHASE)[keyof typeof TRANSITION_PHASE];

export class ListeningTransitionController {
  private generation = 0;
  private queue = Promise.resolve();
  private phase: TransitionPhase | null = null;
  private mode: SessionMode | null = null;
  private disposed = false;
  private activeAsrSessionId: number | null = null;
  private endingAsrSessionId: number | null = null;

  constructor(private readonly services: ListeningTransitionServices) {}

  isStartingReal(): boolean {
    return this.phase === TRANSITION_PHASE.START_REAL;
  }

  isRealActive(): boolean {
    return this.mode === SESSION_MODE.REAL;
  }

  acceptsAsrResult(result: Pick<AsrResult, "kind" | "sessionId" | "text"> & Partial<Pick<AsrResult, "cause">>): boolean {
    if (this.phase === TRANSITION_PHASE.STOP) {
      return result.kind === "final" && result.cause === "stop-flush" && result.sessionId === this.endingAsrSessionId;
    }
    return (
      !this.disposed
      && this.phase === null
      && this.mode === SESSION_MODE.REAL
      && result.sessionId === this.activeAsrSessionId
    );
  }

  acceptsSidecarStatus(status: SidecarStatus): boolean {
    if (this.disposed) return false;
    const ownerSessionId = status.ownerSessionId;

    if (this.phase === TRANSITION_PHASE.START_REAL) return false;
    if (this.phase === TRANSITION_PHASE.START_DEMO) return false;
    if (this.phase === TRANSITION_PHASE.STOP) {
      return ownerSessionId === this.endingAsrSessionId;
    }
    if (this.mode === SESSION_MODE.REAL) return ownerSessionId === this.activeAsrSessionId;
    if (this.mode === SESSION_MODE.DEMO) return false;
    return ownerSessionId === null || ownerSessionId === this.endingAsrSessionId;
  }

  startReal(): Promise<ListeningTransitionResult | null> {
    const generation = this.begin(TRANSITION_PHASE.START_REAL, true);
    return this.enqueue(generation, async () => {
      const operation = await this.services.startAsr();
      if (!this.isCurrent(generation)) {
        await this.services.stopAsr();
        return null;
      }
      if (!operation.ok) {
        return { kind: LISTENING_TRANSITION_RESULT.OPERATION_FAILED, operation };
      }

      const microphoneStarted = await this.services.startMicrophone();
      if (!this.isCurrent(generation)) {
        this.services.stopMicrophone();
        await this.services.stopAsr();
        return null;
      }
      if (!microphoneStarted) {
        await this.services.stopAsr();
        return { kind: LISTENING_TRANSITION_RESULT.MICROPHONE_FAILED };
      }

      this.activeAsrSessionId = operation.sessionId;
      this.endingAsrSessionId = null;
      this.mode = SESSION_MODE.REAL;
      return { kind: LISTENING_TRANSITION_RESULT.REAL_STARTED, operation };
    });
  }

  startDemo(): Promise<ListeningTransitionResult | null> {
    const generation = this.begin(TRANSITION_PHASE.START_DEMO, true);
    return this.enqueue(generation, async () => {
      const operation = await this.services.stopAsr();
      if (!this.isCurrent(generation)) return null;
      if (!operation.ok) return { kind: LISTENING_TRANSITION_RESULT.OPERATION_FAILED, operation };

      this.services.startDemo();
      this.endingAsrSessionId = null;
      this.mode = SESSION_MODE.DEMO;
      return { kind: LISTENING_TRANSITION_RESULT.DEMO_STARTED, operation };
    });
  }

  stop(): Promise<ListeningTransitionResult | null> {
    const generation = this.begin(TRANSITION_PHASE.STOP, true);
    return this.enqueue(generation, async () => {
      const operation = await this.services.stopAsr();
      if (!this.isCurrent(generation)) return null;
      return operation.ok
        ? { kind: LISTENING_TRANSITION_RESULT.STOPPED, operation }
        : { kind: LISTENING_TRANSITION_RESULT.OPERATION_FAILED, operation };
    });
  }

  pause(demoMode: boolean): Promise<ListeningTransitionResult | null> {
    const generation = this.begin(TRANSITION_PHASE.PAUSE, false);
    return this.enqueue(generation, async () => {
      if (demoMode) this.services.pauseDemo();
      else await this.services.pauseMicrophone();
      if (!this.isCurrent(generation)) return null;
      return { kind: LISTENING_TRANSITION_RESULT.PAUSED };
    });
  }

  resume(demoMode: boolean): Promise<ListeningTransitionResult | null> {
    const generation = this.begin(TRANSITION_PHASE.RESUME, false);
    return this.enqueue(generation, async () => {
      if (demoMode) this.services.resumeDemo();
      else await this.services.resumeMicrophone();
      if (!this.isCurrent(generation)) return null;
      return { kind: LISTENING_TRANSITION_RESULT.RESUMED };
    });
  }

  cancelReal(): Promise<ListeningTransitionResult | null> {
    if (!this.isStartingReal() && !this.isRealActive()) return Promise.resolve(null);
    return this.stop();
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.activeAsrSessionId = null;
    this.endingAsrSessionId = null;
    this.services.cancelDemo();
    this.services.stopMicrophone();
  }

  private begin(phase: TransitionPhase, releaseResources: boolean): number {
    this.generation += 1;
    this.phase = phase;
    this.services.onTransition(true);
    if (releaseResources) {
      this.endingAsrSessionId = this.activeAsrSessionId;
      this.activeAsrSessionId = null;
      this.mode = null;
      this.services.cancelDemo();
      this.services.stopMicrophone();
    }
    return this.generation;
  }

  private enqueue(
    generation: number,
    operation: () => Promise<ListeningTransitionResult | null>,
  ): Promise<ListeningTransitionResult | null> {
    const result = this.queue.then(async () => {
      if (!this.isCurrent(generation)) return null;
      try {
        return await operation();
      } catch {
        if (this.isCurrent(generation) && this.phase === TRANSITION_PHASE.START_REAL) {
          this.services.stopMicrophone();
          try {
            await this.services.stopAsr();
          } catch {
            // La UI informa el fallo original; la limpieza ya fue intentada.
          }
        }
        return this.isCurrent(generation) ? { kind: LISTENING_TRANSITION_RESULT.OPERATION_FAILED } : null;
      }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result.then((outcome) => {
      if (this.isCurrent(generation)) {
        this.phase = null;
        if (this.mode === null) this.endingAsrSessionId = null;
        this.services.onTransition(false);
      }
      return outcome;
    });
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}
