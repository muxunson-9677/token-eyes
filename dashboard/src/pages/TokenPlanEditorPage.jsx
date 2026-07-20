import React from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { TokenPlanSection } from "../components/settings/TokenPlanSection.jsx";
import { copy } from "../lib/copy";

function editorPlanIdFromPath(pathname) {
  const normalized = String(pathname || "").replace(/\/+$/, "");
  if (normalized === "/settings/cost/token-plans/new") return "new";
  const match = normalized.match(/^\/settings\/cost\/token-plans\/([^/]+)\/edit$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
export function TokenPlanEditorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const editorPlanId = editorPlanIdFromPath(location.pathname);

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <button
            type="button"
            onClick={() => navigate("/settings/cost")}
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-oai-gray-600 hover:text-oai-black dark:text-oai-gray-300 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {copy("settings.token_plan.back_to_cost")}
          </button>
          <TokenPlanSection editorPlanId={editorPlanId} onNavigate={navigate} />
        </div>
      </main>
    </div>
  );
}
