import React from "react";
import { Pencil } from "lucide-react";
import { copy } from "../../lib/copy";
import { SectionCard, ToggleSwitch } from "./Controls.jsx";

const AVATAR_SIZE = 96;
const AVATAR_MAX_BYTES = 16 * 1024;

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/webp", quality);
  });
}

function readBlobBytes(blob) {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Unable to read avatar"));
    reader.onload = () => resolve(reader.result);
    reader.readAsArrayBuffer(blob);
  });
}

export async function prepareLeaderboardAvatar(file) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
    throw new Error("Avatar must be an image");
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();

  let blob = null;
  for (const quality of [0.82, 0.68, 0.52, 0.4]) {
    blob = await canvasBlob(canvas, quality);
    if (blob && blob.size <= AVATAR_MAX_BYTES) break;
  }
  if (!blob || blob.type !== "image/webp" || blob.size > AVATAR_MAX_BYTES) {
    throw new Error("Avatar cannot be compressed below 16 KiB");
  }
  const digest = await crypto.subtle.digest("SHA-256", await readBlobBytes(blob));
  const hash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return new File([blob], `${hash}.webp`, { type: "image/webp" });
}

function InlineEditorActions({ disabled, onCancel, onSave, saveLabel = copy("settings.account.save") }) {
  return (
    <>
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className="rounded-md bg-oai-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-oai-brand-600 disabled:opacity-50"
      >
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-2 py-1.5 text-xs text-oai-gray-500 transition-colors hover:text-oai-gray-700 dark:hover:text-oai-gray-300"
      >
        {copy("settings.account.cancel")}
      </button>
    </>
  );
}

function EditNameControls({ nameInput, setEditingName, setNameInput, profileSaving, handleSaveName }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="text"
        value={nameInput}
        onChange={(e) => setNameInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSaveName();
          if (e.key === "Escape") setEditingName(false);
        }}
        maxLength={50}
        autoFocus
        className="flex-1 rounded-md border border-oai-gray-300 bg-transparent px-2.5 py-1.5 text-sm text-oai-black outline-none focus:border-oai-brand-500 focus:ring-1 focus:ring-inset focus:ring-oai-brand-500 dark:border-oai-gray-700 dark:text-white"
        placeholder={copy("settings.account.displayName")}
      />
      <InlineEditorActions
        disabled={profileSaving || !nameInput.trim()}
        onCancel={() => setEditingName(false)}
        onSave={handleSaveName}
        saveLabel={profileSaving ? copy("settings.account.saving") : undefined}
      />
    </div>
  );
}

function EditGithubControls({
  githubError,
  githubInput,
  handleSaveGithub,
  profileSaving,
  setEditingGithub,
  setGithubError,
  setGithubInput,
}) {
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={githubInput}
          onChange={(event) => {
            setGithubInput(event.target.value);
            if (githubError) setGithubError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSaveGithub();
            if (event.key === "Escape") {
              setEditingGithub(false);
              setGithubError(null);
            }
          }}
          maxLength={100}
          autoFocus
          className="flex-1 rounded-md border border-oai-gray-300 bg-transparent px-2.5 py-1.5 text-sm text-oai-black outline-none focus:border-oai-brand-500 focus:ring-1 focus:ring-inset focus:ring-oai-brand-500 dark:border-oai-gray-700 dark:text-white"
          placeholder={copy("settings.account.githubUrlPlaceholder")}
        />
        <InlineEditorActions
          disabled={profileSaving}
          onCancel={() => {
            setEditingGithub(false);
            setGithubError(null);
          }}
          onSave={handleSaveGithub}
          saveLabel={profileSaving ? copy("settings.account.saving") : undefined}
        />
      </div>
      {githubError ? (
        <div className="mt-1.5 text-xs text-red-600 dark:text-red-400">{githubError}</div>
      ) : null}
    </div>
  );
}

function EditButton({ disabled = false, label, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-oai-gray-200 px-3 text-xs font-medium text-oai-gray-700 transition-colors hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}

function SettingsField({ actions, editing, editor, hint, label }) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-oai-gray-900 dark:text-oai-gray-200">{label}</div>
          {editing ? editor : (
            <div className="mt-0.5 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {hint}
            </div>
          )}
        </div>
        {editing ? null : actions}
      </div>
    </div>
  );
}

function DisplayNameActions({ name }) {
  return (
    <EditButton
      label={copy("settings.account.edit")}
      onClick={name.startEditingName}
    />
  );
}

function DisplayNameField({ name }) {
  const {
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
  } = name;

  const displayValue = customDisplayName || displayName;

  return (
    <SettingsField
      label={copy("settings.account.nickname")}
      editing={editingName}
      hint={displayValue}
      editor={
        <EditNameControls
          nameInput={nameInput}
          setEditingName={setEditingName}
          setNameInput={setNameInput}
          profileSaving={profileSaving}
          handleSaveName={handleSaveName}
        />
      }
      actions={<DisplayNameActions name={name} />}
    />
  );
}

function GithubProfileField({ github }) {
  const {
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
  } = github;

  return (
    <SettingsField
      label={copy("settings.account.github")}
      editing={editingGithub}
      hint={githubUrl || copy("settings.account.githubUrlHint")}
      editor={
        <EditGithubControls
          githubError={githubError}
          githubInput={githubInput}
          handleSaveGithub={handleSaveGithub}
          profileSaving={profileSaving}
          setEditingGithub={setEditingGithub}
          setGithubError={setGithubError}
          setGithubInput={setGithubInput}
        />
      }
      actions={
        <div className="flex shrink-0 items-center gap-2">
          <EditButton label={copy("settings.account.edit")} onClick={startEditingGithub} />
          <ToggleSwitch
            checked={showGithubOn}
            onChange={handleShowGithubToggle}
            disabled={profileLoading || profileSaving}
            ariaLabel={copy("settings.account.githubUrl")}
          />
        </div>
      }
    />
  );
}

export function SignedOutAccountSection() {
  return (
    <SectionCard title={copy("settings.section.account")}>
      <div className="py-3">
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.account.signedOutHint")}
        </p>
      </div>
    </SectionCard>
  );
}

export function PublicProfileFields({ name, github }) {
  return (
    <>
      <DisplayNameField name={name} />
      <GithubProfileField github={github} />
    </>
  );
}

export function AvatarField({ avatar }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm text-oai-gray-900 dark:text-oai-gray-200">
          {copy("settings.account.avatar")}
        </div>
        <div className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.account.avatarHint")}
        </div>
      </div>
      <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-oai-gray-200 px-3 text-xs dark:border-oai-gray-800">
        {avatar.uploading ? copy("settings.account.saving") : copy("settings.account.avatarChoose")}
        <input
          className="sr-only"
          type="file"
          accept="image/*"
          disabled={avatar.uploading}
          onChange={(event) => avatar.handleAvatarFile(event.target.files?.[0] || null)}
        />
      </label>
    </div>
  );
}

export function ActualCostField({ checked, disabled, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm text-oai-gray-900 dark:text-oai-gray-200">
          {copy("settings.account.shareActualCost")}
        </div>
        <div className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.account.shareActualCostHint")}
        </div>
      </div>
      <ToggleSwitch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={copy("settings.account.shareActualCost")}
      />
    </div>
  );
}
