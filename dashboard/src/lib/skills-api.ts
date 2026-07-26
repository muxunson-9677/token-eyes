import { fetchAuthenticatedLocalApi } from "./local-api-fetch";

type AnyRecord = Record<string, any>;

const SLUG = "tokentracker-skills";

async function fetchSkillsJson(params?: AnyRecord) {
  const searchParams = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  const url = `/functions/${SLUG}${query ? `?${query}` : ""}`;
  const response = await fetchAuthenticatedLocalApi(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function mutateSkillsJson(body: AnyRecord) {
  const response = await fetchAuthenticatedLocalApi(`/functions/${SLUG}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

export function getInstalledSkills() {
  return fetchSkillsJson({ mode: "installed" });
}

export function discoverSkills(options: { force?: boolean } = {}) {
  return fetchSkillsJson({ mode: "discover", ...(options.force ? { force: 1 } : {}) });
}

export function searchSkills(query: string, offset = 0, limit = 20) {
  return fetchSkillsJson({ mode: "search", q: query, offset, limit });
}

export function getSkillRepos() {
  return fetchSkillsJson({ mode: "repos" });
}

export function installSkill(skill: AnyRecord, targets: string[]) {
  return mutateSkillsJson({ action: "install", skill, targets });
}

export function uninstallSkill(id: string) {
  return mutateSkillsJson({ action: "uninstall", id });
}

export function restoreSkill(id: string) {
  return mutateSkillsJson({ action: "restore", id });
}

export function setSkillTargets(id: string, targets: string[]) {
  return mutateSkillsJson({ action: "set_targets", id, targets });
}

export function importLocalSkill(directory: string, targets: string[]) {
  return mutateSkillsJson({ action: "import_local", directory, targets });
}

export function deleteLocalSkill(directory: string, targets?: string[]) {
  return mutateSkillsJson({ action: "delete_local", directory, targets: targets || [] });
}

export function addSkillRepo(repo: AnyRecord) {
  return mutateSkillsJson({ action: "add_repo", repo });
}

export function removeSkillRepo(owner: string, name: string) {
  return mutateSkillsJson({ action: "remove_repo", owner, name });
}

export function getPopularSkills(options: { force?: boolean } = {}) {
  return fetchSkillsJson({ mode: "popular", ...(options.force ? { force: 1 } : {}) });
}

export function checkSkillUpdates(options: { force?: boolean } = {}) {
  return fetchSkillsJson({ mode: "updates", ...(options.force ? { force: 1 } : {}) });
}

export function getSkillActivity(limit = 50) {
  return fetchSkillsJson({ mode: "activity", limit });
}

export function getSkillUsage(options: { force?: boolean } = {}) {
  return fetchSkillsJson({ mode: "skill_usage", ...(options.force ? { force: 1 } : {}) });
}
