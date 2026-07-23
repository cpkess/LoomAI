"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { organizationMembers, organizations, users } from "@/lib/db/schema";
import { slugify } from "@/lib/utils";

import { signIn, signOut } from "./index";

export interface AuthFormState {
  error?: string;
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email and password." };

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw err;
  }
  return {};
}

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  organizationName: z.string().min(1).max(120),
});

async function uniqueOrgSlug(base: string): Promise<string> {
  const root = slugify(base) || "org";
  let candidate = root;
  for (let i = 2; ; i++) {
    const existing = await db.query.organizations.findFirst({ where: eq(organizations.slug, candidate) });
    if (!existing) return candidate;
    candidate = `${root}-${i}`;
  }
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { name, email, password, organizationName } = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  if (existing) return { error: "An account with this email already exists." };

  const [user] = await db
    .insert(users)
    .values({
      name,
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
    })
    .returning();

  const [org] = await db
    .insert(organizations)
    .values({ slug: await uniqueOrgSlug(organizationName), name: organizationName })
    .returning();

  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: user.id,
    role: "org_admin",
  });

  try {
    await signIn("credentials", { email, password, redirectTo: `/${org.slug}/projects` });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }
  return {};
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
