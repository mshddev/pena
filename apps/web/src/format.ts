/** Relative timestamps shared by the dashboard and the workspaces index. */
export function formatRelativeTime(date: string): string {
  const value = new Date(date);
  const minutes = Math.round((Date.now() - value.getTime()) / 60_000);

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (minutes < 60 * 24) {
    return `${Math.round(minutes / 60)}h ago`;
  }

  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

  if (value.getFullYear() !== new Date().getFullYear()) {
    options.year = "numeric";
  }

  return new Intl.DateTimeFormat(undefined, options).format(value);
}
