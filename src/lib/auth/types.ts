// Authentication is abstracted behind this interface so additional backends
// (LDAP, Active Directory, OAuth/OIDC, SAML) can be added without changing
// call sites. Each backend verifies credentials and returns a normalized
// identity; account provisioning stays in the app.

export interface AuthIdentity {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
}

export interface AuthBackend {
  /** Unique backend id, e.g. "local", "ldap", "oidc". */
  id: string;
  /** Verify credentials and return the identity, or null when invalid. */
  verifyCredentials(email: string, password: string): Promise<AuthIdentity | null>;
}
