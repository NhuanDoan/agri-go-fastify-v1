import type { Knex } from "knex";
import { randomUUID } from "node:crypto";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from "../../common/errors/app-error.js";
import {
  hashPassword,
  verifyPassword,
} from "../../common/security/password.js";
import type { TokenService } from "../../common/security/token.service.js";
import type { Db } from "../../common/utils/db.js";
import type { MailService } from "../mail/mail.service.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { UserRow } from "../users/users.types.js";
import type { AuthRepository } from "./auth.repository.js";
import type {
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from "./auth.schema.js";
import type { ClientMeta, OtpPurpose } from "./auth.types.js";
import type { OtpService } from "./otp.service.js";

export interface Session {
  user: UserRow;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

type RefreshOutcome =
  | { kind: "ok"; session: Session }
  | { kind: "reject"; message: string };

/** One message for every failure: the caller learns nothing about which part was wrong. */
const INVALID_CODE = "Invalid or expired code";

export class AuthService {
  /** Compared against when the email is unknown, so response time doesn't reveal which emails exist. */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly db: Knex,
    private readonly users: UsersRepository,
    private readonly refreshRepo: AuthRepository,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly mail: MailService,
    private readonly bcryptRounds: number,
  ) {
    this.dummyHash = hashPassword(randomUUID(), bcryptRounds);
  }

  // ---------------------------------------------------------------- registration and e-mail verification

  async register(input: RegisterBody, meta: ClientMeta): Promise<Session> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmail(email))
      throw new ConflictError("Email is already registered");

    const password_hash = await hashPassword(input.password, this.bcryptRounds);
    const user = await this.db.transaction(async (trx) => {
      const id = await this.users.create(
        {
          full_name: input.fullName.trim(),
          email,
          password_hash,
          phone: input.phone ?? null,
          role: "customer", // never taken from the request
          status: "active",
        },
        trx,
      );
      const created = (await this.users.findById(id, trx))!;
      await this.sendOtp(trx, created, "email_verification"); // user + code + queued mail: one commit
      return created;
    });
    return this.issue(user, randomUUID(), meta);
  }

  async verifyEmail(input: VerifyEmailBody): Promise<void> {
    const user = await this.users.findByEmail(input.email.trim());
    if (user?.email_verified_at) return; // already verified: idempotent
    if (
      !user ||
      !(await this.otp.verify(user.id, "email_verification", input.code))
    ) {
      throw new BadRequestError(INVALID_CODE);
    }
    await this.users.update(user.id, { email_verified_at: new Date() });
  }

  /** Answers the same whether or not the account exists. */
  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email.trim());
    if (!user || user.email_verified_at) return;
    await this.db.transaction((trx) =>
      this.sendOtp(trx, user, "email_verification"),
    );
  }

  // ---------------------------------------------------------------- password reset

  /** Answers the same whether or not the account exists. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email.trim());
    if (!user || user.status !== "active") return;
    await this.db.transaction((trx) =>
      this.sendOtp(trx, user, "password_reset"),
    );
  }

  async resetPassword(input: ResetPasswordBody): Promise<void> {
    const user = await this.users.findByEmail(input.email.trim());
    if (
      !user ||
      user.status !== "active" ||
      !(await this.otp.verify(user.id, "password_reset", input.code))
    ) {
      throw new BadRequestError(INVALID_CODE);
    }
    const password_hash = await hashPassword(
      input.newPassword,
      this.bcryptRounds,
    );
    await this.db.transaction(async (trx) => {
      // receiving the code also proves control of the mailbox
      await this.users.update(
        user.id,
        {
          password_hash,
          email_verified_at: user.email_verified_at ?? new Date(),
        },
        trx,
      );
      await this.refreshRepo.revokeAllForUser(user.id, trx); // sign out everywhere
    });
  }

  // ---------------------------------------------------------------- login and sessions (unchanged from step 4)

  async login(input: LoginBody, meta: ClientMeta): Promise<Session> {
    const user = await this.users.findByEmail(input.email.trim());
    const valid = await verifyPassword(
      input.password,
      user?.password_hash ?? (await this.dummyHash),
    );
    if (!user || !valid)
      throw new UnauthorizedError("Invalid email or password");
    if (user.status === "locked") throw new ForbiddenError("Account is locked");
    return this.issue(user, randomUUID(), meta);
  }

  async refresh(refreshToken: string, meta: ClientMeta): Promise<Session> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const hash = this.tokens.hash(refreshToken);

    const outcome = await this.db.transaction<RefreshOutcome>(async (trx) => {
      const row = await this.refreshRepo.findByIdForUpdate(claims.jti, trx);
      if (!row || row.token_hash !== hash)
        throw new UnauthorizedError("Invalid refresh token");
      if (row.expires_at.getTime() <= Date.now())
        throw new UnauthorizedError("Refresh token expired");

      if (row.revoked_at) {
        await this.refreshRepo.revokeFamily(row.family_id, trx);
        return {
          kind: "reject",
          message: "Refresh token reuse detected; please log in again",
        };
      }

      const user = await this.users.findById(row.user_id, trx);
      if (!user || user.status === "locked") {
        await this.refreshRepo.revokeFamily(row.family_id, trx);
        return { kind: "reject", message: "Account unavailable" };
      }

      const session = await this.issue(
        user,
        row.family_id,
        meta,
        trx,
        (newJti) => this.refreshRepo.markRotated(row.id, newJti, trx),
      );
      return { kind: "ok", session };
    });

    if (outcome.kind === "reject") throw new UnauthorizedError(outcome.message);
    return outcome.session;
  }

  async logout(refreshToken: string): Promise<void> {
    const claims = this.tokens.tryVerifyRefresh(refreshToken);
    if (claims) await this.refreshRepo.revokeFamily(claims.familyId);
  }

  async logoutAll(userId: number): Promise<void> {
    await this.refreshRepo.revokeAllForUser(userId);
  }

  async changePassword(
    userId: number,
    input: ChangePasswordBody,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedError();
    if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
      throw new UnauthorizedError("Current password is incorrect");
    }
    const password_hash = await hashPassword(
      input.newPassword,
      this.bcryptRounds,
    );
    await this.db.transaction(async (trx) => {
      await this.users.update(userId, { password_hash }, trx);
      await this.refreshRepo.revokeAllForUser(userId, trx);
    });
  }

  /** Housekeeping job. */
  async purgeExpired(): Promise<number> {
    return (
      (await this.refreshRepo.deleteExpired()) + (await this.otp.purgeExpired())
    );
  }

  // ---------------------------------------------------------------- internals

  private async sendOtp(
    db: Db,
    user: UserRow,
    purpose: OtpPurpose,
  ): Promise<void> {
    const code = await this.otp.issue(db, user.id, purpose);
    if (!code) return; // resend cool-down: silently do nothing
    await this.mail.enqueue(db, {
      type: purpose,
      to: user.email,
      data: { fullName: user.full_name, code, ttlMinutes: this.otp.ttlMinutes },
    });
  }

  private async issue(
    user: UserRow,
    familyId: string,
    meta: ClientMeta,
    trx?: Knex.Transaction,
    onNewToken?: (jti: string) => Promise<void>,
  ): Promise<Session> {
    const jti = randomUUID();
    const refreshToken = this.tokens.signRefresh({
      userId: user.id,
      jti,
      familyId,
    });

    await this.refreshRepo.create(
      {
        id: jti,
        user_id: user.id,
        family_id: familyId,
        token_hash: this.tokens.hash(refreshToken),
        expires_at: new Date(Date.now() + this.tokens.refreshTtlSeconds * 1000),
        user_agent: meta.userAgent?.slice(0, 255) ?? null,
        ip: meta.ip ?? null,
      },
      trx,
    );
    if (onNewToken) await onNewToken(jti);

    return {
      user,
      accessToken: this.tokens.signAccess({ id: user.id, role: user.role }),
      refreshToken,
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }
}
