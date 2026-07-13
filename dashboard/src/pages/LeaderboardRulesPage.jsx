import React from "react";
import { Link } from "react-router-dom";
import { copy } from "../lib/copy";

function RuleSection({ title, children }) {
  return (
    <section className="py-6">
      <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
      <p className="mt-2 text-sm leading-7 text-oai-gray-600 dark:text-oai-gray-300">
        {children}
      </p>
    </section>
  );
}

export function LeaderboardRulesPage() {
  return (
    <div className="flex flex-1 flex-col text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {copy("leaderboard.rules.title")}
              </h1>
              <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400 sm:text-base">
                {copy("leaderboard.rules.subtitle")}
              </p>
            </div>
            <Link
              to="/leaderboard"
              className="shrink-0 text-sm font-medium text-oai-gray-500 transition-colors hover:text-oai-black dark:text-oai-gray-400 dark:hover:text-white"
            >
              {copy("leaderboard.rules.back")}
            </Link>
          </div>

          <div className="divide-y divide-oai-gray-200 rounded-2xl border border-oai-gray-200 bg-white px-5 dark:divide-oai-gray-800 dark:border-oai-gray-800 dark:bg-oai-gray-950 sm:px-7">
            <RuleSection title={copy("leaderboard.rules.purpose.title")}>
              {copy("leaderboard.rules.purpose.body")}
            </RuleSection>
            <RuleSection title={copy("leaderboard.rules.data.title")}>
              {copy("leaderboard.rules.data.body")}
            </RuleSection>
            <RuleSection title={copy("leaderboard.rules.periods.title")}>
              {copy("leaderboard.rules.periods.body")}
            </RuleSection>
            <RuleSection title={copy("leaderboard.rules.metrics.title")}>
              {copy("leaderboard.rules.metrics.body")}
            </RuleSection>
            <RuleSection title={copy("leaderboard.rules.ranking.title")}>
              {copy("leaderboard.rules.ranking.body")}
            </RuleSection>
            <RuleSection title={copy("leaderboard.rules.deduplication.title")}>
              {copy("leaderboard.rules.deduplication.body")}
            </RuleSection>
            <RuleSection title={copy("leaderboard.rules.cost.title")}>
              {copy("leaderboard.rules.cost.body")}
            </RuleSection>
          </div>
        </div>
      </main>
    </div>
  );
}
