export class GameLoop {
  private lastTime: number = 0;
  private accumulator: number = 0;
  private isRunning: boolean = false;
  private animationFrameId: number = 0;

  // Fixed timestep for deterministic simulation (e.g., 60fps)
  public readonly timeStep: number = 1000 / 60;

  public get active(): boolean {
    return this.isRunning;
  }

  constructor(
    private updateCallback: (dt: number) => void,
    private renderCallback: () => void,
  ) {}

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  public stop() {
    this.isRunning = false;
    cancelAnimationFrame(this.animationFrameId);
  }

  private loop(currentTime: number) {
    if (!this.isRunning) return;

    const frameTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Prevent spiral of death if the tab is inactive
    this.accumulator += Math.min(frameTime, 250);

    while (this.accumulator >= this.timeStep) {
      this.updateCallback(this.timeStep / 1000); // dt in seconds
      this.accumulator -= this.timeStep;
    }

    this.renderCallback();

    this.animationFrameId = requestAnimationFrame((t) => this.loop(t));
  }
}
