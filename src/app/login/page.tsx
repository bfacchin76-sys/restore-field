import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "./login-form";

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  const { next } = await searchParams;
  const target = typeof next === "string" && next.startsWith("/app") ? next : "/app";

  if (session?.user?.id && session.user.active) {
    redirect(target);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <LoginForm next={target} />
    </main>
  );
}
