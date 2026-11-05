import type { FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";
import type { CloudinaryService } from "./cloudinary.service.js";
import type { CloudinaryCleanupRepository } from "./cloudinary-cleanup.repository.js";

const MAX_ATTEMPTS = 8;

export class CloudinaryCleanupService {
  constructor(
    private readonly repo: CloudinaryCleanupRepository,
    private readonly media: CloudinaryService,
    private readonly log: FastifyBaseLogger,
  ) {}

  enqueue(db: Parameters<CloudinaryCleanupRepository["enqueue"]>[0], publicId: string) {
    return this.repo.enqueue(db, publicId);
  }

  async cleanupOrphan(publicId: string): Promise<void> {
    try {
      await this.media.destroy(publicId);
      return;
    } catch (error) {
      this.log.error(
        { err: error, publicId },
        "Immediate orphan Cloudinary cleanup failed; queueing retry",
      );
    }
    try {
      await this.repo.enqueueStandalone(publicId);
    } catch (error) {
      this.log.error(
        { err: error, publicId },
        "Failed to register orphan Cloudinary asset",
      );
    }
  }

  async processBatch(limit = 10): Promise<number> {
    const token = randomUUID();
    const rows = await this.repo.claim(limit, 120, token);
    for (const row of rows) {
      try {
        await this.media.destroy(row.public_id);
        await this.repo.deleteClaimed(row.id, token);
      } catch (err) {
        const retryAt =
          row.attempts >= MAX_ATTEMPTS
            ? null
            : new Date(Date.now() + Math.min(30_000 * 2 ** row.attempts, 3_600_000));
        this.log.error(
          { err, cleanupId: row.id, publicId: row.public_id, attempts: row.attempts },
          "Cloudinary cleanup failed",
        );
        await this.repo.failClaimed(row.id, token, String(err), retryAt);
      }
    }
    return rows.length;
  }
}
