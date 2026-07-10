import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PageHeader, EmptyState } from "@/components/ui";

export default async function ClientHubPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role === "CLIENT") redirect(user.clientId ? `/client-hub/${user.clientId}` : "/dashboard");

  const clients = await db.client.findMany({
    where: {
      isActive: true,
      // Editors only see clients they actually have an assigned task with — read-only reference access.
      ...(user.role === "EDITOR" ? { jobs: { some: { tasks: { some: { assigneeId: user.id } } } } } : {}),
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Client Hub" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <Link
            key={c.id}
            href={`/client-hub/${c.id}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-600"
          >
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</h2>
            {c.notes && (
              <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{c.notes}</p>
            )}
          </Link>
        ))}
        {clients.length === 0 && <EmptyState>No clients yet.</EmptyState>}
      </div>
    </div>
  );
}
