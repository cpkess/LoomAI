import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth/authorize";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Access your organization&apos;s AI workspace</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <LoginForm />
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/register" className="text-foreground underline underline-offset-4">
            Create an organization
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
