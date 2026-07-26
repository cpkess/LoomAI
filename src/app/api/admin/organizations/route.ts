import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { errorResponse, requirePlatformAdmin } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { organizationMembers, organizations, users } from "@/lib/db/schema";
import { slugify } from "@/lib/utils";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  adminEmail: z.string().email(),
  adminName: z.string().min(1).max(120),
});

// Platform admins create organizations and their first org admin in one step.
// If the admin account is new, a temporary password is returned once.
export async function POST(req: Request) {
  try {
    await requirePlatformAdmin();
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
    const { name, adminEmail, adminName } = parsed.data;

    const root = slugify(name) || "org";
    let slug = root;
    for (let i = 2; ; i++) {
      const clash = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
      if (!clash) break;
      slug = `${root}-${i}`;
    }

    let user = await db.query.users.findFirst({ where: eq(users.email, adminEmail.toLowerCase()) });
    let tempPassword: string | undefined;
    if (!user) {
      tempPassword = nanoid(12);
      [user] = await db
        .insert(users)
        .values({ name: adminName, email: adminEmail.toLowerCase(), passwordHash: await bcrypt.hash(tempPassword, 10) })
        .returning();
    }

    const [org] = await db.insert(organizations).values({ slug, name }).returning();
    await db.insert(organizationMembers).values({ organizationId: org.id, userId: user.id, role: "org_admin" });

    return Response.json({ organization: org, tempPassword }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
