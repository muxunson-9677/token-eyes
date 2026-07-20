import React from "react";
import { Check, Copy, LogOut } from "lucide-react";
import { copy } from "../../lib/copy";
import { useAccountProfileSettings } from "./useAccountProfileSettings.js";
import { SectionCard } from "./Controls.jsx";
import {
  ActualCostField,
  AvatarField,
  PublicProfileFields,
  SignedOutAccountSection,
} from "./AccountSectionParts.jsx";

export function AccountSection() {
  const settings = useAccountProfileSettings();

  if (!settings.enabled) return null;
  if (!settings.signedIn) return React.createElement(SignedOutAccountSection);

  return (
    <SectionCard
      title={copy("settings.section.account")}
      subtitle={settings.email || (settings.name.customDisplayName || settings.name.displayName)}
      action={<SignOutButton onSignOut={settings.signOut} />}
    >
      <PublicProfileFields name={settings.name} github={settings.github} />
      <AvatarField avatar={settings.avatar} />
      <ActualCostField
        checked={settings.shareActualCost}
        disabled={settings.actualCostSaving}
        onChange={settings.handleActualCostToggle}
      />
      <UserIdRow userId={settings.userId} />
      <button
        type="button"
        disabled={settings.deleting}
        onClick={() => {
          if (window.confirm(copy("settings.account.deleteParticipationConfirm"))) {
            settings.handleDeleteParticipation();
          }
        }}
        className="mt-3 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50 dark:text-red-400"
      >
        {copy("settings.account.deleteParticipation")}
      </button>
    </SectionCard>
  );
}

function UserIdRow({ userId }) {
  const [copied, setCopied] = React.useState(false);
  if (!userId) return null;

  const handleCopy = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-oai-gray-900 dark:text-oai-gray-200">
          {copy("settings.account.userId")}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {userId}
        </div>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-oai-gray-200 px-3 text-xs font-medium text-oai-gray-700 transition-colors hover:bg-oai-gray-100 dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
        aria-label={copy("settings.account.copyUserId")}
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {copied ? copy("settings.account.copied") : copy("settings.account.copy")}
      </button>
    </div>
  );
}

function SignOutButton({ onSignOut }) {
  return (
    <button
      type="button"
      onClick={() => onSignOut()}
      className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-oai-gray-500 transition-colors hover:text-oai-gray-700 dark:hover:text-oai-gray-300"
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      {copy("settings.account.signOut")}
    </button>
  );
}
