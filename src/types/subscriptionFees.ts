import type { AppType } from "@/types/usage";

/** 后端返回的订阅费记录 */
export interface SubscriptionFee {
  id: number;
  agentType: AppType;
  planLabel: string;
  monthlyFee: string;
  currency: string;
  billingDay: number;
  effectiveFrom: number;
  effectiveTo?: number | null;
  note?: string | null;
}

/** 创建/更新订阅费的输入 */
export interface SubscriptionFeeInput {
  agentType: AppType;
  planLabel: string;
  monthlyFee: string;
  currency?: string;
  billingDay: number;
  effectiveFrom: number;
  effectiveTo?: number | null;
  note?: string | null;
}

/** 表单值（日期为 YYYY-MM-DD 字符串） */
export interface SubscriptionFeeFormValues {
  id?: number;
  agentType: AppType;
  planLabel: string;
  monthlyFee: string;
  currency: "USD";
  billingDay: number;
  effectiveFromDate: string;
  effectiveToDate?: string;
  note: string;
}

/** list 查询参数 */
export interface SubscriptionFeeListQuery {
  agentType?: AppType;
  includeInactive?: boolean;
}
