import React from "react";
import { cn } from "../lib/cn";

function Bone({ className }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-oai-gray-200/70 dark:bg-oai-gray-800/70",
        className,
      )}
    />
  );
}

function SkeletonRow({ index }) {
  const nameWidth = index < 3 ? "w-28" : index < 8 ? "w-24" : "w-20";
  return (
    <li className="grid min-h-[78px] grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_9rem] sm:gap-4 sm:px-5">
      <Bone className="h-6 w-6 rounded-full" />
      <div className="flex min-w-0 items-center gap-3">
        <Bone className="h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 space-y-2">
          <Bone className={cn("h-4", nameWidth)} />
          <div className="flex gap-2">
            <Bone className="h-3 w-20" />
            <Bone className="h-3 w-16" />
          </div>
        </div>
      </div>
      <div className="space-y-2 justify-self-end">
        <Bone className="h-4 w-20" />
        <Bone className="ml-auto h-3 w-12" />
      </div>
    </li>
  );
}

/** Skeleton that mirrors the compact leaderboard person rows. */
export function LeaderboardSkeleton({ rows = 10 }) {
  return (
    <ol className="divide-y divide-oai-gray-100 dark:divide-oai-gray-800/70">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} index={index} />
      ))}
    </ol>
  );
}
