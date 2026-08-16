import React from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LayoutGroup, motion } from "motion/react";
import { GripVertical } from "lucide-react";
import { limitProviderIconKey, limitProviderName } from "../hooks/use-limits-display-prefs.js";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";

const LIMITS_SETTINGS_ICON_CLASS = "shrink-0 text-oai-gray-900 dark:text-oai-gray-200";

function ToggleSwitch({ checked, onChange, ariaLabel }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} onClick={onChange} className="tt-product-focusable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500">
      <span className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", checked ? "bg-oai-brand-500" : "bg-oai-gray-300 dark:bg-oai-gray-700")}>
        <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", checked ? "translate-x-[18px]" : "translate-x-[3px]")} />
      </span>
    </button>
  );
}

function SortableLimitRow({ id, order, visible, toggle, moveToward }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const label = limitProviderName(id);
  const handleKeyDown = (event) => {
    const index = order.indexOf(id);
    const targetIndex = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : -1;
    if (targetIndex < 0 || targetIndex >= order.length) return;
    event.preventDefault();
    moveToward(id, order[targetIndex]);
  };

  return (
    <motion.div
      ref={setNodeRef}
      layout
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex items-center gap-3 rounded-md py-2", "hover:bg-oai-gray-100/60 dark:hover:bg-oai-gray-800/60", isDragging && "relative z-10 opacity-60 shadow-lg")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        aria-label={copy("limits.settings.drag_handle", { provider: label })}
        className="tt-product-focusable inline-flex h-9 w-9 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-oai-gray-400 active:cursor-grabbing dark:text-oai-gray-500"
        {...attributes}
        {...listeners}
        onKeyDown={handleKeyDown}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </button>

      {limitProviderIconKey(id) ? <ProviderIcon provider={limitProviderIconKey(id)} size={18} className={cn("pointer-events-none", LIMITS_SETTINGS_ICON_CLASS)} /> : null}
      <span className="flex-1 select-none text-sm text-oai-gray-900 dark:text-oai-gray-200">{label}</span>
      <ToggleSwitch checked={visible} onChange={() => toggle(id)} ariaLabel={`${copy("limits.settings.toggle_visible")}: ${label}`} />
    </motion.div>
  );
}

/** Drag ownership belongs to the visible handle; switches remain independent. */
export function LimitsSettingsPanel({ prefs }) {
  const { order, visibility, toggle, moveToward } = prefs;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <LayoutGroup>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
        if (over && active.id !== over.id) moveToward(String(active.id), String(over.id));
      }}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            {order.map((id) => <SortableLimitRow key={id} id={id} order={order} visible={visibility[id] !== false} toggle={toggle} moveToward={moveToward} />)}
          </div>
        </SortableContext>
      </DndContext>
    </LayoutGroup>
  );
}
