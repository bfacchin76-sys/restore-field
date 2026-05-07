import { signOut } from "@/auth";

export async function POST() {
  await signOut({ redirectTo: "/login" });
  // signOut throws NEXT_REDIRECT; never returns. Keeping this to satisfy types.
  return new Response(null, { status: 302 });
}
