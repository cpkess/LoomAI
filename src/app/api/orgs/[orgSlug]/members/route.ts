import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { errorResponse, requireOrg } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizationMembers, orgRole, users } from "@/lib/db/schema";

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(orgRole.enumValues).default("member"),
  title: z.string().max(120).optional(),
});

// Invite a member. Without an email server in the loop, inviting an unknown
// address creates the account with a temporary password that is returned
// once for the admin to hand over out-of-band.
export async function POST(req: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  try {
    const { orgSlug } = await params;
    const ctx = await requireOrg(orgSlug, "org_admin");
    const parsed = inviteSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const { email, name, role, title } = parsed.data;

    let user = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
    let tempPassword: string | undefined;
    if (!user) {
      tempPassword = nanoid(12);
      [user] = await db
        .insert(users)
        .values({ name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(tempPassword, 10) })
        .returning();
    }

    const existing = await db.query.organizationMembers.findFirst({
      where: and(eq(organizationMembers.organizationId, ctx.org.id), eq(organizationMembers.userId, user.id)),
    });
    if (existing) return Response.json({ error: "Already a member of this organization" }, { status: 409 });

    const [member] = await db
      .insert(organizationMembers)
      .values({ organizationId: ctx.org.id, userId: user.id, role, title: title ?? null })
      .returning();

    return Response.json({ member, tempPassword }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
