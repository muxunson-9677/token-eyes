import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { subscriptionFeeApi } from "@/lib/api/subscriptionFees";
import type {
  SubscriptionFeeInput,
  SubscriptionFeeListQuery,
} from "@/types/subscriptionFees";

export const subscriptionFeeKeys = {
  all: ["subscriptionFee"] as const,
  list: (params?: SubscriptionFeeListQuery) =>
    [...subscriptionFeeKeys.all, "list", params?.agentType ?? null, params?.includeInactive ?? null] as const,
};

export function useSubscriptionFeeList(params?: SubscriptionFeeListQuery) {
  return useQuery({
    queryKey: subscriptionFeeKeys.list(params),
    queryFn: () => subscriptionFeeApi.list(params),
  });
}

export function useCreateSubscriptionFee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SubscriptionFeeInput) =>
      subscriptionFeeApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionFeeKeys.all });
    },
  });
}

export function useUpdateSubscriptionFee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: SubscriptionFeeInput }) =>
      subscriptionFeeApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionFeeKeys.all });
    },
  });
}

export function useDeleteSubscriptionFee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => subscriptionFeeApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionFeeKeys.all });
    },
  });
}
