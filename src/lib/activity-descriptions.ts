// Canonical human-readable description for every ActivityLog action string.
// Keep ACTIVITY_ACTION_GROUPS and the switch below in sync — the groups also
// back the Activity Logs page's action filter dropdown.
export const ACTIVITY_ACTION_GROUPS: { label: string; actions: string[] }[] = [
  { label: "Task", actions: ["task.created", "task.updated", "task.reassigned", "task.status_changed"] },
  { label: "Submission", actions: ["submission.round_opened", "review.approved", "review.changes_requested"] },
  { label: "Comment", actions: ["comment.added"] },
  { label: "Job", actions: ["job.created", "job.status_changed", "job.manager_reassigned", "job.default_editor_changed"] },
  {
    label: "Client",
    actions: [
      "client.created",
      "client.reactivated",
      "client.deactivated",
      "client.notion_url_changed",
      "client.default_manager_changed",
      "client.default_editor_changed",
      "client.offboarded",
    ],
  },
  { label: "Category", actions: ["category.created"] },
  { label: "File", actions: ["file.uploaded", "file.deleted", "file.category_changed", "file.description.updated"] },
  {
    label: "User",
    actions: [
      "user.created",
      "user.role_changed",
      "user.activated",
      "user.deactivated",
      "user.password_reset",
      "user.password_changed",
    ],
  },
  { label: "Drive", actions: ["drive.connected", "drive.disconnected"] },
];

export const ALL_ACTIVITY_ACTIONS = ACTIVITY_ACTION_GROUPS.flatMap((g) => g.actions);

function statusLabel(v: unknown): string {
  return String(v ?? "?").toLowerCase().replaceAll("_", " ");
}

export function describeActivity(
  action: string,
  meta: unknown,
  categoryLabel: (key: string) => string = (key) => key,
): string {
  const m = (meta && typeof meta === "object" ? meta : {}) as Record<string, unknown>;
  const name = (v: unknown) => (typeof v === "string" && v ? v : "a file");

  switch (action) {
    case "task.created":
      return "created the task";
    case "task.updated":
      return "edited the brief";
    case "task.status_changed":
      return `moved the task from ${statusLabel(m.from)} to ${statusLabel(m.to)}`;
    case "task.reassigned":
      return "reassigned the task";
    case "submission.round_opened":
      return `opened round ${m.round ?? "?"}`;
    case "review.approved":
      return `approved round ${m.round ?? "?"}`;
    case "review.changes_requested":
      return `requested changes on round ${m.round ?? "?"}`;
    case "comment.added":
      return "added a comment";
    case "job.created":
      return "created the job";
    case "job.status_changed":
      return `moved the job from ${statusLabel(m.from)} to ${statusLabel(m.to)}`;
    case "job.manager_reassigned":
      return "reassigned the job's manager";
    case "job.default_editor_changed":
      return "changed the job's default editor";
    case "client.created":
      return "created the client";
    case "client.reactivated":
      return "reactivated the client";
    case "client.deactivated":
      return "deactivated the client";
    case "client.notion_url_changed":
      return "updated the linked Notion page";
    case "client.default_manager_changed":
      return "changed the default manager";
    case "client.default_editor_changed":
      return "changed the default editor";
    case "client.offboarded":
      return "offboarded the client";
    case "category.created":
      return `created category ${name(m.label)}`;
    case "file.uploaded":
      if (typeof m.category === "string") return `uploaded ${name(m.name)} to ${categoryLabel(m.category)}`;
      if (typeof m.round === "number" || typeof m.round === "string")
        return `uploaded ${name(m.name)} for round ${m.round}`;
      if (m.attachment) return `attached ${name(m.name)} to the task`;
      return `uploaded ${name(m.name)}`;
    case "file.deleted":
      return `deleted ${name(m.name)}`;
    case "file.category_changed":
      return `moved ${name(m.name)} from ${categoryLabel(String(m.from ?? ""))} to ${categoryLabel(String(m.to ?? ""))}`;
    case "file.description.updated":
      return `updated the description of ${name(m.name)}`;
    case "user.created":
      return `created a user account (${String(m.role ?? "?").toLowerCase()})`;
    case "user.role_changed":
      return `changed role from ${String(m.from ?? "?").toLowerCase()} to ${String(m.to ?? "?").toLowerCase()}`;
    case "user.activated":
      return "activated the user";
    case "user.deactivated":
      return "deactivated the user";
    case "user.password_reset":
      return "reset the user's password";
    case "user.password_changed":
      return "changed their password";
    case "drive.connected":
      return `connected Google Drive (${name(m.googleAccountEmail)})`;
    case "drive.disconnected":
      return "disconnected Google Drive";
    default:
      return action;
  }
}
