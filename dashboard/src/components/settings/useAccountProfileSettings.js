import { useCallback, useEffect, useMemo, useState } from "react";
import { useInsforgeAuth } from "../../contexts/InsforgeAuthContext.jsx";
import { resolveAuthAccessTokenWithRetry } from "../../lib/auth-token";
import {
  deleteLeaderboardParticipation,
  getLocalLeaderboardActualCost,
  getPublicVisibility,
  setLeaderboardActualCost,
  setPublicVisibility,
  uploadLeaderboardAvatar,
} from "../../lib/api";
import { copy } from "../../lib/copy";
import { normalizeGithubProfileUrl, pickDisplayName, pickEmail } from "./AccountSectionUtils.js";
import { prepareLeaderboardAvatar } from "./AccountSectionParts.jsx";

function warn(label, error) {
  console.warn(`[tokentracker] settings ${label}:`, error);
}

export function useAccountProfileSettings() {
  const auth = useInsforgeAuth();
  const displayName = useMemo(() => pickDisplayName(auth.user), [auth.user]);
  const email = useMemo(() => pickEmail(auth.user), [auth.user]);
  const userId = typeof auth.user?.id === "string" ? auth.user.id.trim() : "";

  const [customDisplayName, setCustomDisplayName] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [githubInput, setGithubInput] = useState("");
  const [showGithubOn, setShowGithubOn] = useState(false);
  const [editingGithub, setEditingGithub] = useState(false);
  const [githubError, setGithubError] = useState(null);
  const [shareActualCost, setShareActualCost] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [actualCostSaving, setActualCostSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const token = useCallback(
    () => resolveAuthAccessTokenWithRetry({ getAccessToken: auth.getAccessToken }),
    [auth.getAccessToken],
  );

  useEffect(() => {
    if (!auth.signedIn) return undefined;
    let active = true;
    setProfileLoading(true);
    void (async () => {
      try {
        const accessToken = await token();
        if (!accessToken || !active) return;
        const data = await getPublicVisibility({ accessToken });
        if (!active) return;
        if (!data?.leaderboard_public) {
          await setPublicVisibility({ accessToken, leaderboard_public: true });
        }
        setCustomDisplayName(data?.display_name || null);
        setGithubUrl(data?.github_url || "");
        setShowGithubOn(Boolean(data?.show_github_url));
        setShareActualCost(Boolean(data?.share_actual_cost));
        setAvatarUrl(data?.avatar_url || null);
      } catch (error) {
        warn("load leaderboard profile", error);
      } finally {
        if (active) setProfileLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [auth.signedIn, token]);

  const mutate = useCallback(async (payload) => {
    setProfileSaving(true);
    try {
      const accessToken = await token();
      if (!accessToken) return null;
      return await setPublicVisibility({ accessToken, ...payload });
    } finally {
      setProfileSaving(false);
    }
  }, [token]);

  const startEditingName = useCallback(() => {
    setNameInput(customDisplayName || displayName);
    setEditingName(true);
  }, [customDisplayName, displayName]);

  const handleSaveName = useCallback(async () => {
    const value = nameInput.trim().slice(0, 50);
    if (!value) return;
    try {
      await mutate({ display_name: value });
      setCustomDisplayName(value);
      setEditingName(false);
      auth.refreshDisplayName?.();
    } catch (error) {
      warn("save nickname", error);
    }
  }, [auth, mutate, nameInput]);

  const startEditingGithub = useCallback(() => {
    setGithubInput(githubUrl);
    setGithubError(null);
    setEditingGithub(true);
  }, [githubUrl]);

  const handleSaveGithub = useCallback(async () => {
    const value = normalizeGithubProfileUrl(githubInput);
    if (githubInput.trim() && !value) {
      setGithubError(copy("settings.account.githubUrlInvalid"));
      return;
    }
    try {
      await mutate({ github_url: value, show_github_url: Boolean(value) });
      setGithubUrl(value || "");
      setShowGithubOn(Boolean(value));
      setEditingGithub(false);
    } catch (error) {
      setGithubError(error?.message || copy("settings.account.githubUrlInvalid"));
    }
  }, [githubInput, mutate]);

  const handleShowGithubToggle = useCallback(async () => {
    if (!showGithubOn && !githubUrl) {
      startEditingGithub();
      return;
    }
    const next = !showGithubOn;
    try {
      await mutate({ show_github_url: next });
      setShowGithubOn(next);
    } catch (error) {
      warn("toggle GitHub", error);
    }
  }, [githubUrl, mutate, showGithubOn, startEditingGithub]);

  const handleActualCostToggle = useCallback(async () => {
    if (actualCostSaving) return;
    setActualCostSaving(true);
    try {
      const accessToken = await token();
      if (!accessToken) return;
      if (shareActualCost) {
        await setLeaderboardActualCost({ accessToken, share: false });
        setShareActualCost(false);
      } else {
        const periodCosts = await getLocalLeaderboardActualCost();
        await setLeaderboardActualCost({
          accessToken,
          share: true,
          periodCosts,
        });
        setShareActualCost(true);
      }
    } catch (error) {
      warn("toggle actual cost", error);
    } finally {
      setActualCostSaving(false);
    }
  }, [actualCostSaving, shareActualCost, token]);

  const handleAvatarFile = useCallback(async (file) => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const prepared = await prepareLeaderboardAvatar(file);
      const accessToken = await token();
      if (!accessToken) return;
      const result = await uploadLeaderboardAvatar({ accessToken, file: prepared });
      setAvatarUrl(result?.avatar_url || null);
    } catch (error) {
      warn("upload avatar", error);
    } finally {
      setUploading(false);
    }
  }, [token, uploading]);

  const handleDeleteParticipation = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const accessToken = await token();
      if (!accessToken) return;
      await deleteLeaderboardParticipation({ accessToken });
      await auth.signOut();
    } catch (error) {
      warn("delete leaderboard participation", error);
    } finally {
      setDeleting(false);
    }
  }, [auth, deleting, token]);

  return {
    ...auth,
    email,
    userId,
    shareActualCost,
    actualCostSaving,
    handleActualCostToggle,
    deleting,
    handleDeleteParticipation,
    avatar: { avatarUrl, uploading, handleAvatarFile },
    name: {
      anonymousOn: false,
      customDisplayName,
      displayName,
      editingName,
      handleSaveName,
      nameInput,
      profileLoading,
      profileSaving,
      setEditingName,
      setNameInput,
      startEditingName,
    },
    github: {
      editingGithub,
      githubError,
      githubInput,
      githubUrl,
      handleSaveGithub,
      handleShowGithubToggle,
      profileLoading,
      profileSaving,
      setEditingGithub,
      setGithubError,
      setGithubInput,
      showGithubOn,
      startEditingGithub,
    },
  };
}
