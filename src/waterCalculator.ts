import * as vscode from "vscode";
import { getRateForModel, ModelRate, FALLBACK_RATE } from "./modelRates";

export type WaterScope = "scope1" | "scope1and2";

export interface WaterResult {
  mlPerToken: number;
  totalMl: number;
  tokens: number;
  modelId: string;
  modelRate: ModelRate;
  scope: WaterScope;
  comparison: string;
  formattedAmount: string;
}

/**
 * Calculate water consumed for a given number of tokens and model.
 */
export function calculateWater(
  tokens: number,
  modelId: string,
  scope: WaterScope,
  overrides: Record<string, number> = {}
): WaterResult {
  const modelRate = getRateForModel(modelId);

  let mlPerToken: number;
  const overrideKey = modelId.toLowerCase();
  if (overrides[overrideKey] !== undefined) {
    mlPerToken = overrides[overrideKey];
  } else {
    mlPerToken = scope === "scope1" ? modelRate.scope1PerToken : modelRate.scope12PerToken;
  }

  const totalMl = tokens * mlPerToken;

  return {
    mlPerToken,
    totalMl,
    tokens,
    modelId,
    modelRate,
    scope,
    comparison: toComparison(totalMl),
    formattedAmount: formatWater(totalMl, getUnitsConfig()),
  };
}

function getUnitsConfig(): string {
  return vscode.workspace.getConfiguration("bluetoken").get<string>("units", "auto");
}

/**
 * Formats a mL value into the most human-readable form.
 * "auto" picks the best unit based on quantity.
 */
export function formatWater(ml: number, unit: string = "auto"): string {
  if (unit === "drops") {
    const drops = ml / 0.05;
    return drops < 1 ? `<1 drop` : `${drops.toFixed(0)} drop${drops < 2 ? "" : "s"}`;
  }
  if (unit === "teaspoons") {
    const tsp = ml / 4.93;
    return `${tsp.toFixed(3)} tsp`;
  }
  if (unit === "ml") {
    return `${ml.toFixed(3)} mL`;
  }

  // auto
  if (ml < 0.05) {
    return `< 1 drop`;
  }
  if (ml < 1) {
    const drops = Math.round(ml / 0.05);
    return `${drops} drop${drops === 1 ? "" : "s"}`;
  }
  if (ml < 1000) {
    return `${ml.toFixed(1)} mL`;
  }
  return `${(ml / 1000).toFixed(2)} L`;
}

/**
 * Returns a relatable real-world comparison string for a given mL value.
 */
export function toComparison(ml: number): string {
  if (ml < 0.05) return "less than a single drop";
  if (ml < 0.5) return `about ${Math.round(ml / 0.05)} drops of water`;
  if (ml < 1.5) return "about a small medicine dropper";
  if (ml < 6) {
    const tsp = ml / 4.93;
    return `about ${tsp.toFixed(1)} teaspoon${tsp < 1.5 ? "" : "s"}`;
  }
  if (ml < 15) return "about a tablespoon";
  if (ml < 40) return "a small sip of water";
  if (ml < 120) return `about ${Math.round(ml / 30)} tablespoons`;
  if (ml < 260) return `about ${(ml / 250).toFixed(1)} cups of water`;
  if (ml < 600) return `about ${(ml / 500).toFixed(1)} small water bottles`;
  if (ml < 1100) return "about a full water bottle";
  return `${(ml / 1000).toFixed(1)} liters of water`;
}

/**
 * Reads user configuration for water scope.
 */
export function getScopeConfig(): WaterScope {
  return vscode.workspace.getConfiguration("bluetoken").get<WaterScope>("scope", "scope1and2");
}

/**
 * Reads model rate overrides from user settings.
 */
export function getModelOverrides(): Record<string, number> {
  return vscode.workspace.getConfiguration("bluetoken").get<Record<string, number>>("modelRateOverrides", {});
}

/**
 * Estimates token count from a text string.
 * Uses the ~4 chars per token rule — ~85% accurate for English.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
