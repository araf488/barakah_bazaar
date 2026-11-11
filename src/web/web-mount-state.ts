import { Injectable } from '@nestjs/common';

/**
 * Whether the web mount finished preparing in this process. `main.ts` marks it once
 * `mountWeb` resolves; `/health` reads it to report `web: up`.
 */
@Injectable()
export class WebMountState {
  private prepared = false;

  get isPrepared(): boolean {
    return this.prepared;
  }

  markPrepared(): void {
    this.prepared = true;
  }
}
