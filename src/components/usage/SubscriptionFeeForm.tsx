import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  useSubscriptionFeeList,
  useCreateSubscriptionFee,
  useUpdateSubscriptionFee,
  useDeleteSubscriptionFee,
} from "@/lib/query/subscriptionFees";
import { KNOWN_APP_TYPES, type AppType } from "@/types/usage";
import type {
  SubscriptionFee,
} from "@/types/subscriptionFees";

/** YYYY-MM-DD → Unix 秒 (UTC 00:00:00) */
function dateToUnix(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

/** Unix 秒 → YYYY-MM-DD */
function unixToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

interface FormData {
  agentType: string;
  planLabel: string;
  monthlyFee: string;
  currency: "USD";
  billingDay: number;
  effectiveFromDate: string;
  effectiveToDate?: string;
  note: string;
}

const formSchema = z
  .object({
    agentType: z.string().min(1),
    planLabel: z.string().min(1),
    monthlyFee: z
      .string()
      .regex(/^\d+(\.\d+)?$/, "subscriptionFee.invalidMonthlyFee"),
    currency: z.literal("USD"),
    billingDay: z.coerce.number().int().min(1).max(31),
    effectiveFromDate: z.string().min(1),
    effectiveToDate: z.string().optional(),
    note: z.string(),
  })
  .refine(
    (data) => {
      if (!data.effectiveToDate) return true;
      return data.effectiveToDate >= data.effectiveFromDate;
    },
    { message: "subscriptionFee.invalidDateRange", path: ["effectiveToDate"] },
  );

const defaultValues: FormData = {
  agentType: "claude",
  planLabel: "",
  monthlyFee: "",
  currency: "USD",
  billingDay: 1,
  effectiveFromDate: new Date().toISOString().slice(0, 10),
  effectiveToDate: "",
  note: "",
};

function toFormData(fee: SubscriptionFee): FormData {
  return {
    agentType: fee.agentType,
    planLabel: fee.planLabel,
    monthlyFee: fee.monthlyFee,
    currency: "USD",
    billingDay: fee.billingDay,
    effectiveFromDate: unixToDate(fee.effectiveFrom),
    effectiveToDate: fee.effectiveTo ? unixToDate(fee.effectiveTo) : "",
    note: fee.note ?? "",
  };
}

function toInputPayload(data: FormData): {
  agentType: AppType;
  planLabel: string;
  monthlyFee: string;
  currency: string;
  billingDay: number;
  effectiveFrom: number;
  effectiveTo?: number | null;
  note?: string | null;
} {
  return {
    agentType: data.agentType as AppType,
    planLabel: data.planLabel.trim(),
    monthlyFee: data.monthlyFee.trim(),
    currency: data.currency,
    billingDay: data.billingDay,
    effectiveFrom: dateToUnix(data.effectiveFromDate),
    effectiveTo: data.effectiveToDate ? dateToUnix(data.effectiveToDate) : null,
    note: data.note.trim() || null,
  };
}

export function SubscriptionFeeForm() {
  const { t } = useTranslation();
  const { data: fees = [], isLoading } = useSubscriptionFeeList();
  const createMutation = useCreateSubscriptionFee();
  const updateMutation = useUpdateSubscriptionFee();
  const deleteMutation = useDeleteSubscriptionFee();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionFee | null>(
    null,
  );

  const form = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema) as any,
    defaultValues,
  });

  const isEditing = editingId !== null;
  const isPending =
    createMutation.isPending || updateMutation.isPending;

  const handleAdd = () => {
    setEditingId(null);
    form.reset(defaultValues);
    setShowForm(true);
  };

  const handleEdit = (fee: SubscriptionFee) => {
    setEditingId(fee.id);
    form.reset(toFormData(fee));
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    form.reset(defaultValues);
  };

  const handleSubmit = async (data: FormData) => {
    const payload = toInputPayload(data);
    try {
      if (isEditing) {
        await updateMutation.mutateAsync({ id: editingId, input: payload });
        toast.success(
          t("subscriptionFee.updated", { defaultValue: "订阅费已更新" }),
        );
      } else {
        await createMutation.mutateAsync(payload);
        toast.success(
          t("subscriptionFee.created", { defaultValue: "订阅费已创建" }),
        );
      }
      handleCancel();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success(
        t("subscriptionFee.deleted", { defaultValue: "订阅费已删除" }),
      );
      if (editingId === deleteTarget.id) handleCancel();
    } catch (err) {
      toast.error(String(err));
    }
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-4">
      {/* 列表 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          {t("subscriptionFee.list", { defaultValue: "订阅费列表" })}
        </h3>
        <Button size="sm" variant="outline" onClick={handleAdd}>
          <Plus className="h-4 w-4 mr-1" />
          {t("subscriptionFee.add", { defaultValue: "新增" })}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          {t("common.loading", { defaultValue: "加载中..." })}
        </p>
      ) : fees.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("subscriptionFee.empty", { defaultValue: "暂无订阅费记录" })}
        </p>
      ) : (
        <div className="space-y-2">
          {fees.map((fee) => (
            <div
              key={fee.id}
              className="flex items-center justify-between rounded-md border p-3 text-sm"
            >
              <div className="space-y-0.5">
                <div className="font-medium">
                  {fee.agentType} — {fee.planLabel}
                </div>
                <div className="text-muted-foreground">
                  {fee.monthlyFee} {fee.currency}
                  {fee.note ? ` · ${fee.note}` : ""}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleEdit(fee)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setDeleteTarget(fee)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 表单 */}
      {showForm && (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4 rounded-md border p-4"
          >
            <FormField
              control={form.control}
              name="agentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("subscriptionFee.agentType", {
                      defaultValue: "Agent 类型",
                    })}
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {KNOWN_APP_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="planLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("subscriptionFee.planLabel", {
                      defaultValue: "套餐名称",
                    })}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="monthlyFee"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("subscriptionFee.monthlyFee", {
                      defaultValue: "月费 (USD)",
                    })}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} type="text" inputMode="decimal" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="billingDay"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("subscriptionFee.billingDay", {
                      defaultValue: "账单日 (1-31)",
                    })}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={1}
                      max={31}
                      onChange={(e) =>
                        field.onChange(parseInt(e.target.value, 10) || "")
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="effectiveFromDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("subscriptionFee.effectiveFrom", {
                      defaultValue: "生效日期",
                    })}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="effectiveToDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("subscriptionFee.effectiveTo", {
                      defaultValue: "失效日期 (可选)",
                    })}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t("subscriptionFee.note", { defaultValue: "备注" })}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? t("common.saving", { defaultValue: "保存中..." })
                  : isEditing
                    ? t("common.save", { defaultValue: "保存" })
                    : t("common.add", { defaultValue: "新增" })}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
              >
                {t("common.cancel", { defaultValue: "取消" })}
              </Button>
            </div>
          </form>
        </Form>
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title={t("subscriptionFee.deleteTitle", {
          defaultValue: "删除订阅费",
        })}
        message={t("subscriptionFee.deleteMessage", {
          defaultValue: `确定删除「${deleteTarget?.planLabel ?? ""}」吗？此操作不可撤销。`,
        })}
        confirmText={t("common.delete", { defaultValue: "删除" })}
        onConfirm={() => handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
