export interface DesktopWidgetProjectSelection {
  id: string;
  label: string;
  path: string;
}

type WidgetStatusSession = {
  id?: unknown;
  label?: unknown;
  sessionLabel?: unknown;
  taskLabel?: unknown;
  status?: unknown;
  state?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
};

type WidgetStatusProject = {
  id?: unknown;
  label?: unknown;
  path?: unknown;
  red?: unknown;
  yellow?: unknown;
  green?: unknown;
  unknown?: unknown;
  sessions?: WidgetStatusSession[];
  sessionIds?: unknown[];
  updatedAt?: unknown;
  [key: string]: unknown;
};

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

function safeCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

function safeTimestamp(value: unknown) {
  const text = String(value || "").trim();
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function safeLabel(value: unknown, fallback = "") {
  const label = String(value || "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return label.slice(0, 120) || fallback;
}

function normalizeSession(session: WidgetStatusSession) {
  const id = String(session?.id || "").trim();
  if (!id) return null;
  const label = safeLabel(
    session?.label || session?.sessionLabel || session?.taskLabel,
  ) || null;
  return {
    ...session,
    id,
    label,
    updatedAt: safeTimestamp(session?.updatedAt),
  };
}

function newestProjectTimestamp(project: WidgetStatusProject, sessions: Array<ReturnType<typeof normalizeSession>>) {
  const timestamps = [
    safeTimestamp(project?.updatedAt),
    ...sessions.map((session) => session?.updatedAt || null),
  ].filter((value): value is string => Boolean(value));
  return timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function normalizeProject(project: WidgetStatusProject) {
  const id = String(project?.id || "").trim();
  if (!id) return null;
  const sessions = (Array.isArray(project?.sessions) ? project.sessions : [])
    .map(normalizeSession)
    .filter((session): session is NonNullable<ReturnType<typeof normalizeSession>> => Boolean(session));
  return {
    ...project,
    id,
    label: safeLabel(project?.label, id).slice(0, 80),
    path: normalizeProjectPath(project?.path),
    red: safeCount(project?.red),
    yellow: safeCount(project?.yellow),
    green: safeCount(project?.green),
    unknown: safeCount(project?.unknown),
    sessions,
    sessionIds: Array.from(new Set((Array.isArray(project?.sessionIds) ? project.sessionIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean))),
    legacyProjectIds: [id],
    updatedAt: newestProjectTimestamp(project, sessions),
  };
}

function projectStatusCounts(sessions: Array<NonNullable<ReturnType<typeof normalizeSession>>>) {
  const counts = { red: 0, yellow: 0, green: 0, unknown: 0 };
  for (const session of sessions) {
    const status = String(session?.status || "").trim().toLowerCase();
    if (status === "red" || status === "yellow" || status === "green") counts[status] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function mergeNormalizedProject(
  existing: NonNullable<ReturnType<typeof normalizeProject>>,
  candidate: NonNullable<ReturnType<typeof normalizeProject>>,
) {
  const sessions = new Map(existing.sessions.map((session) => [session.id, session]));
  for (const session of candidate.sessions) {
    const current = sessions.get(session.id);
    if (!current || Date.parse(session.updatedAt || "") > Date.parse(current.updatedAt || "")) {
      sessions.set(session.id, session);
    }
  }
  const mergedSessions = Array.from(sessions.values());
  const mergedCounts = mergedSessions.length > 0
    ? projectStatusCounts(mergedSessions)
    : {
      red: existing.red + candidate.red,
      yellow: existing.yellow + candidate.yellow,
      green: existing.green + candidate.green,
      unknown: existing.unknown + candidate.unknown,
    };
  return {
    ...existing,
    path: existing.path || candidate.path,
    ...mergedCounts,
    sessions: mergedSessions,
    sessionIds: Array.from(new Set([...existing.sessionIds, ...candidate.sessionIds])),
    legacyProjectIds: Array.from(new Set([...existing.legacyProjectIds, ...candidate.legacyProjectIds])),
    updatedAt: newestProjectTimestamp(
      { updatedAt: [existing.updatedAt, candidate.updatedAt]
        .filter(Boolean)
        .sort((left, right) => Date.parse(String(right)) - Date.parse(String(left)))[0] },
      mergedSessions,
    ),
  };
}

export function mergeWidgetStatusProjects(
  detected: WidgetStatusProject[] = [],
  recent: WidgetStatusProject[] = [],
  selected: DesktopWidgetProjectSelection[] = [],
) {
  const projects = new Map<string, NonNullable<ReturnType<typeof normalizeProject>>>();
  const projectIdByIdentity = new Map<string, string>();
  const projectBySessionId = new Map<string, string>();
  const addProject = (project: NonNullable<ReturnType<typeof normalizeProject>>) => {
    const identity = project.path
      ? `path:${project.path.toLowerCase()}`
      : `label:${project.label.toLowerCase()}`;
    const existingId = projectIdByIdentity.get(identity) || (projects.has(project.id) ? project.id : null);
    const canonicalId = existingId || project.id;
    const existing = projects.get(canonicalId);
    const merged = existing ? mergeNormalizedProject(existing, project) : project;
    projects.set(canonicalId, merged);
    projectIdByIdentity.set(identity, canonicalId);
    for (const session of merged.sessions) projectBySessionId.set(session.id, canonicalId);
    for (const sessionId of merged.sessionIds) projectBySessionId.set(sessionId, canonicalId);
  };
  for (const candidate of detected) {
    const project = normalizeProject(candidate);
    if (!project) continue;
    addProject(project);
  }
  for (const candidate of recent) {
    const project = normalizeProject({ ...candidate, sessions: [] });
    if (!project) continue;
    addProject(project);
  }
  for (const candidate of selected) {
    const project = normalizeProject({ ...candidate, sessions: [] });
    if (!project || projectBySessionId.has(project.id)) continue;
    addProject(project);
  }
  return Array.from(projects.values());
}

export function migrateWidgetProjectSelectionIds(
  projects: Array<{ id?: unknown; sessions?: Array<{ id?: unknown }>; sessionIds?: unknown[]; legacyProjectIds?: unknown[] }> = [],
  selectedIds: unknown[] = [],
) {
  const projectBySessionId = new Map<string, string>();
  for (const project of projects) {
    const projectId = String(project?.id || "").trim();
    if (!projectId) continue;
    for (const session of Array.isArray(project?.sessions) ? project.sessions : []) {
      const sessionId = String(session?.id || "").trim();
      if (sessionId && !projectBySessionId.has(sessionId)) {
        projectBySessionId.set(sessionId, projectId);
      }
    }
    for (const value of Array.isArray(project?.sessionIds) ? project.sessionIds : []) {
      const sessionId = String(value || "").trim();
      if (sessionId && !projectBySessionId.has(sessionId)) {
        projectBySessionId.set(sessionId, projectId);
      }
    }
    for (const value of Array.isArray(project?.legacyProjectIds) ? project.legacyProjectIds : []) {
      const legacyProjectId = String(value || "").trim();
      if (legacyProjectId && !projectBySessionId.has(legacyProjectId)) {
        projectBySessionId.set(legacyProjectId, projectId);
      }
    }
  }
  const migrated: string[] = [];
  for (const value of selectedIds) {
    const id = String(value || "").trim();
    if (!id) continue;
    const nextId = projectBySessionId.get(id) || id;
    if (!migrated.includes(nextId)) migrated.push(nextId);
  }
  return migrated;
}
