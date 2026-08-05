import React from "react";
import { Card } from "../ui/components";
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

/** Mirrors the restored overview grid during the initial account load. */
export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" data-testid="dashboard-skeleton">
      <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1 lg:col-span-4">
        <Card>
          <div className="flex flex-col gap-3">
            <Bone className="h-4 w-28" />
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center justify-between gap-3">
                <Bone className="h-3 w-24" />
                <Bone className="h-4 w-14" />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="flex flex-col gap-4">
            <Bone className="h-4 w-24" />
            <Bone className="h-40 w-full" />
          </div>
        </Card>
        <Card>
          <div className="flex flex-col gap-4">
            <Bone className="h-4 w-28" />
            <Bone className="mx-auto h-36 w-36 rounded-full" />
          </div>
        </Card>
      </div>

      <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2 lg:col-span-8">
        <Card>
          <div className="mb-6 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {Array.from({ length: 5 }, (_, index) => (
                <Bone key={index} className="h-10 w-14 shrink-0 rounded-md" />
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Bone className="h-10 w-20 rounded-md" />
              <Bone className="h-10 w-10 rounded-md" />
            </div>
          </div>

          <div className="mb-8 flex flex-col items-center gap-4">
            <Bone className="h-3 w-28" />
            <Bone className="h-14 w-3/5 max-w-xs" />
            <Bone className="h-6 w-24" />
          </div>

          <div className="flex flex-col gap-6">
            <Bone className="h-1.5 w-full rounded-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 5 }, (_, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-2 rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-700"
                >
                  <div className="flex items-center gap-1.5">
                    <Bone className="h-[15px] w-[15px] shrink-0 rounded-sm" />
                    <Bone className="h-3 w-12" />
                  </div>
                  <Bone className="h-5 w-10" />
                  <Bone className="h-2.5 w-14" />
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex gap-2">
            <Bone className="h-8 w-20" />
            <Bone className="h-8 w-24" />
          </div>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Bone key={index} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
