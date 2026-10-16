import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/app-error.js";
import { hashPassword } from "../../common/security/password.js";
import type { Paged } from "../../common/utils/pagination.js";
import type { UsersRepository } from "./users.repository.js";
import type {
  CreateUserBody,
  UpdateProfileBody,
  UpdateUserBody,
} from "./users.schema.js";
import type { UserFilter, UserRow } from "./users.types.js";

export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly bcryptRounds: number,
  ) {}

  list(filter: UserFilter): Promise<Paged<UserRow>> {
    return this.repo.list(filter);
  }

  async getById(id: number): Promise<UserRow> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  }

  /** Admin-created accounts are trusted: their email counts as verified. */
  async create(input: CreateUserBody): Promise<UserRow> {
    const email = input.email.trim().toLowerCase();
    if (await this.repo.findByEmail(email))
      throw new ConflictError("Email is already registered");

    const id = await this.repo.create({
      full_name: input.fullName.trim(),
      email,
      email_verified_at: new Date(),
      phone: input.phone ?? null,
      password_hash: await hashPassword(input.password, this.bcryptRounds),
      role: input.role ?? "customer",
      status: input.status ?? "active",
    });
    return this.getById(id);
  }

  async update(
    id: number,
    input: UpdateUserBody,
    actorId: number,
  ): Promise<UserRow> {
    const existing = await this.getById(id);

    // an admin must not be able to lock themselves out or drop their own admin role
    if (
      id === actorId &&
      (input.role === "customer" || input.status === "locked")
    ) {
      throw new ForbiddenError("You cannot demote or lock your own account");
    }

    const patch: Partial<UserRow> = {};
    if (input.fullName !== undefined) patch.full_name = input.fullName.trim();
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (email !== existing.email.toLowerCase()) {
        if (await this.repo.findByEmail(email))
          throw new ConflictError("Email is already registered");
        patch.email = email;
        patch.email_verified_at = null; // a new address has to be proven again
      }
    }
    if (input.role !== undefined) patch.role = input.role;
    if (input.status !== undefined) patch.status = input.status;
    if (input.password !== undefined)
      patch.password_hash = await hashPassword(
        input.password,
        this.bcryptRounds,
      );

    if (Object.keys(patch).length > 0) await this.repo.update(id, patch);
    return this.getById(id);
  }

  async remove(id: number, actorId: number): Promise<void> {
    if (id === actorId)
      throw new ForbiddenError("You cannot delete your own account");
    await this.getById(id);
    // users who have orders will be protected by a foreign key (409). Lock those accounts instead.
    await this.repo.delete(id);
  }

  async updateProfile(
    userId: number,
    input: UpdateProfileBody,
  ): Promise<UserRow> {
    const patch: Partial<UserRow> = {};
    if (input.fullName !== undefined) patch.full_name = input.fullName.trim();
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.address !== undefined) patch.address = input.address;
    if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;
    if (Object.keys(patch).length > 0) await this.repo.update(userId, patch);
    return this.getById(userId);
  }
}
