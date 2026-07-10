import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export default async function ClientHubPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role === "EDITOR") redirect("/dashboard");
  if (user.role === "CLIENT") redirect(user.clientId ? `/client-hub/${user.clientId}` : "/dashboard");

  const clients = await db.client.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Client Hub</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <Link
            key={c.id}
            href={`/client-hub/${c.id}`}
            className="rounded-xl border border-gray-200 bg-white p-4 hover:border-blue-400 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-600"
          >
            <h2 className="font-semibold">{c.name}</h2>
            {c.notes && (
              <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{c.notes}</p>
            )}
          </Link>
        ))}
        {clients.length === 0 && <p className="text-sm text-gray-500">No clients yet.</p>}
      </div>
    </div>
  );
}
