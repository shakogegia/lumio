import type { Metadata } from "next";
import { listUsers } from "@lumio/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const users = await listUsers();
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Everyone with an account on this server.</p>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-muted/40">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="truncate text-sm font-medium text-foreground">{u.name}</div>
              <div className="truncate text-xs text-muted-foreground">{u.email}</div>
            </div>
            {u.twoFactorEnabled && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                2FA
              </span>
            )}
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {u.createdAt.toLocaleDateString()}
            </span>
          </li>
        ))}
        {users.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">No users yet.</li>
        )}
      </ul>
    </main>
  );
}
