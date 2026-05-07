"use client";

import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <form action="/logout" method="post">
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
