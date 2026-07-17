import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { localAuthBackend } from "./local";
import type { AuthBackend } from "./types";

// Registered auth backends. Additional backends (LDAP, OIDC, ...) plug in
// here without changing the rest of the app.
const backends: AuthBackend[] = [localAuthBackend];

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      isPlatformAdmin: boolean;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.LOOMAI_SECRET ?? "loomai-dev-secret",
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        for (const backend of backends) {
          const identity = await backend.verifyCredentials(email, password);
          if (identity) {
            return {
              id: identity.id,
              email: identity.email,
              name: identity.name,
              isPlatformAdmin: identity.isPlatformAdmin,
            };
          }
        }
        return null;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.isPlatformAdmin = (user as { isPlatformAdmin?: boolean }).isPlatformAdmin ?? false;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      session.user.isPlatformAdmin = Boolean(token.isPlatformAdmin);
      return session;
    },
  },
});
