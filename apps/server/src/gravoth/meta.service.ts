/**
 * What the server says about itself. `COMMIT_SHA` is set by the image build; `MIN_GAME_VERSION` is the oldest game build the
 * API still answers (a newer save format or a changed route raises it, and the game then asks the player to update).
 */
export class GravothMeta {
  private readonly startedAt = Date.now();

  uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  info(): {
    service: 'gravoth';
    version: string;
    commit: string;
    minGameVersion: string;
  } {
    return {
      service: 'gravoth',
      version: process.env['npm_package_version'] ?? '0.1.0',
      commit: Bun.env['COMMIT_SHA'] ?? 'dev',
      minGameVersion: Bun.env['MIN_GAME_VERSION'] ?? '0.11.8',
    };
  }
}
