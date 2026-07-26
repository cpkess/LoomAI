import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import type { AuthBackend, AuthIdentity } from "./types";

export const localAuthBackend: AuthBackend = {
  id: "local",

  async verifyCredentials(email, password): Promise<AuthIdentity | null> {
    const user = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;
    return { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin };
  },
};
