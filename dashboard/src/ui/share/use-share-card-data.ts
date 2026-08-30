import { useMemo } from "react";
import {
  buildShareCardData,
  type ShareCardData,
  type ShareCardModel,
  type ShareCardPeriod,
} from "./build-share-card-data";

interface UseShareCardDataParams {
  handle: string;
  startDate: string | null;
  activeDays: number;
  summary: any;
  topModels: ShareCardModel[] | null | undefined;
  period: ShareCardPeriod;
  periodFrom: string | null;
  periodTo: string | null;
  heatmap: any;
  currency?: string;
  exchangeRate?: number;
}

export function useShareCardData(params: UseShareCardDataParams): ShareCardData {
  const {
    handle,
    startDate,
    activeDays,
    summary,
    topModels,
    period,
    periodFrom,
    periodTo,
    heatmap,
    currency,
    exchangeRate,
  } = params;

  const rate = exchangeRate;

  return useMemo(
    () =>
      buildShareCardData({
        handle,
        startDate,
        activeDays,
        summary,
        topModels,
        rank: null,
        period,
        periodFrom,
        periodTo,
        heatmap,
        currency,
        exchangeRate: typeof rate === "number" ? rate : undefined,
      }),
    [
      handle,
      startDate,
      activeDays,
      summary,
      topModels,
      period,
      periodFrom,
      periodTo,
      heatmap,
      currency,
      rate,
    ],
  );
}
