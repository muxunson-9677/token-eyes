export interface DesktopWidgetProjectSelection {
  id: string;
  label: string;
  path: string;
}

function normalizeProjectPath(value: unknown) {
  return String(value || "").trim().replace(/[\\/]+$/u, "");
}

export async function widgetProjectFromPath(
  value: unknown,
): Promise<DesktopWidgetProjectSelection | null> {
  const path = normalizeProjectPath(value);
  if (!path) return null;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(path.toLowerCase()),
  );
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
  const label = path.split(/[\\/]/u).filter(Boolean).at(-1) || path;
  return {
    id: `project-${hash}`,
    label: label.replace(/\p{Cc}/gu, "").slice(0, 80),
    path,
  };
}

export function mergeWidgetProjectOptions(
  detected: Array<{ id?: string; label?: string }> = [],
  selected: DesktopWidgetProjectSelection[] = [],
) {
  const projects = new Map<string, DesktopWidgetProjectSelection>();
  for (const project of detected) {
    const id = String(project?.id || "").trim();
    if (!id) continue;
    projects.set(id, {
      id,
      label: String(project?.label || id).trim().slice(0, 80),
      path: "",
    });
  }
  for (const project of selected) {
    const id = String(project?.id || "").trim();
    if (!id) continue;
    projects.set(id, {
      id,
      label: String(project?.label || id).trim().slice(0, 80),
      path: normalizeProjectPath(project?.path),
    });
  }
  return Array.from(projects.values());
}
