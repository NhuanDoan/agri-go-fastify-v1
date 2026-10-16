import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import type { UserRole } from "../../modules/users/users.types.js";
import { UnauthorizedError } from "../errors/app-error.js";

export interface AuthUser {
  id: number;
  role: UserRole;
}

export interface RefreshClaims {
  userId: number;
  jti: string; // unique id of this token = primary key in refresh_tokens
  familyId: string;
}

export interface TokenConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

const ALG = "HS256" as const;

/** Pure JWT sign/verify. Access and refresh tokens use DIFFERENT secrets, so one can never pass as the other. */
export class TokenService {
  constructor(private readonly cfg: TokenConfig) {}

  get accessTtlSeconds(): number {
    return this.cfg.accessTtlSeconds;
  }
  get refreshTtlSeconds(): number {
    return this.cfg.refreshTtlSeconds;
  }

  signAccess(user: AuthUser): string {
    return jwt.sign({ role: user.role }, this.cfg.accessSecret, {
      algorithm: ALG,
      subject: String(user.id),
      expiresIn: this.cfg.accessTtlSeconds,
    });
  }

  signRefresh(c: RefreshClaims): string {
    return jwt.sign({ fid: c.familyId }, this.cfg.refreshSecret, {
      algorithm: ALG,
      subject: String(c.userId),
      jwtid: c.jti,
      expiresIn: this.cfg.refreshTtlSeconds,
    });
  }

  verifyAccess(token: string): AuthUser {
    const p = this.verify(token, this.cfg.accessSecret);
    const id = Number(p.sub);
    const role = p.role;
    if (!Number.isInteger(id) || (role !== "admin" && role !== "customer")) {
      throw new UnauthorizedError("Invalid access token");
    }
    return { id, role };
  }

  verifyRefresh(token: string): RefreshClaims {
    const p = this.verify(token, this.cfg.refreshSecret);
    const userId = Number(p.sub);
    if (
      !Number.isInteger(userId) ||
      typeof p.jti !== "string" ||
      typeof p.fid !== "string"
    ) {
      throw new UnauthorizedError("Invalid refresh token");
    }
    return { userId, jti: p.jti, familyId: p.fid };
  }

  tryVerifyRefresh(token: string): RefreshClaims | null {
    try {
      return this.verifyRefresh(token);
    } catch {
      return null;
    }
  }

  /** Only this hash is stored. */
  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private verify(token: string, secret: string): jwt.JwtPayload {
    try {
      // pinning `algorithms` blocks the classic "alg: none" / algorithm-confusion attacks
      const decoded = jwt.verify(token, secret, { algorithms: [ALG] });
      if (typeof decoded === "string") throw new Error("unexpected payload");
      return decoded;
    } catch (err) {
      throw new UnauthorizedError(
        err instanceof jwt.TokenExpiredError
          ? "Token expired"
          : "Invalid token",
      );
    }
  }
}
