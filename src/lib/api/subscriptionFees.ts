import { invoke } from "@tauri-apps/api/core";
import type {
  SubscriptionFee,
  SubscriptionFeeInput,
  SubscriptionFeeListQuery,
} from "@/types/subscriptionFees";

export const subscriptionFeeApi = {
  list: (params?: SubscriptionFeeListQuery): Promise<SubscriptionFee[]> =>
    invoke("list_subscription_fees", {
      agentType: params?.agentType,
      includeInactive: params?.includeInactive,
    }),

  create: (input: SubscriptionFeeInput): Promise<SubscriptionFee> =>
    invoke("create_subscription_fee", { input }),

  update: (id: number, input: SubscriptionFeeInput): Promise<SubscriptionFee> =>
    invoke("update_subscription_fee", { id, input }),

  remove: (id: number): Promise<void> =>
    invoke("delete_subscription_fee", { id }),
};
