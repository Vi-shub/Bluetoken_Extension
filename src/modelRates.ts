/**
 * Water consumption rates per token for models used across
 * Cursor, VS Code / GitHub Copilot, and Antigravity.
 *
 * Scope 1  = on-site data center cooling water only.
 * Scope 1+2 = Scope 1 + indirect water from electricity generation.
 *
 * Rates are approximate (peer-reviewed baselines + scaled relatives).
 * Order matters: more specific patterns must come before generic ones.
 */

export interface ModelRate {
  displayName: string;
  provider: string;
  scope1PerToken: number;
  scope12PerToken: number;
  reasoningMultiplier?: number;
  patterns: string[];
}

export const MODEL_RATES: ModelRate[] = [
  // ── OpenAI (Cursor + Copilot + VS Code Chat) ─────────────────────────────
  {
    displayName: "GPT-4o mini",
    provider: "OpenAI",
    scope1PerToken: 0.00180,
    scope12PerToken: 0.00240,
    patterns: ["gpt-4o-mini", "gpt4o-mini", "4o-mini"],
  },
  {
    displayName: "GPT-4o",
    provider: "OpenAI",
    scope1PerToken: 0.00363,
    scope12PerToken: 0.00438,
    patterns: ["gpt-4o", "gpt4o", "chatgpt-4o"],
  },
  {
    displayName: "GPT-4.1 nano",
    provider: "OpenAI",
    scope1PerToken: 0.00150,
    scope12PerToken: 0.00200,
    patterns: ["gpt-4.1-nano", "gpt4.1-nano", "4.1-nano"],
  },
  {
    displayName: "GPT-4.1 mini",
    provider: "OpenAI",
    scope1PerToken: 0.00240,
    scope12PerToken: 0.00320,
    patterns: ["gpt-4.1-mini", "gpt4.1-mini", "4.1-mini"],
  },
  {
    displayName: "GPT-4.1",
    provider: "OpenAI",
    scope1PerToken: 0.00380,
    scope12PerToken: 0.00460,
    patterns: ["gpt-4.1", "gpt4.1"],
  },
  {
    displayName: "GPT-4.5",
    provider: "OpenAI",
    scope1PerToken: 0.00400,
    scope12PerToken: 0.00500,
    patterns: ["gpt-4.5", "gpt4.5"],
  },
  {
    displayName: "GPT-5 mini / nano",
    provider: "OpenAI",
    scope1PerToken: 0.00280,
    scope12PerToken: 0.00360,
    patterns: ["gpt-5-mini", "gpt-5-nano", "gpt5-mini", "gpt5-nano"],
  },
  {
    displayName: "GPT-5 / GPT-5.x",
    provider: "OpenAI",
    scope1PerToken: 0.00420,
    scope12PerToken: 0.00520,
    patterns: ["gpt-5", "gpt5"],
  },
  {
    displayName: "o1 / o3 / o4 (reasoning)",
    provider: "OpenAI",
    scope1PerToken: 0.036,
    scope12PerToken: 0.044,
    patterns: [
      "o1-pro",
      "o1-mini",
      "o1-preview",
      "o1",
      "o3-mini",
      "o3-pro",
      "o3",
      "o4-mini",
      "o4",
    ],
  },
  {
    displayName: "GPT-4 Turbo",
    provider: "OpenAI",
    scope1PerToken: 0.00363,
    scope12PerToken: 0.00450,
    patterns: ["gpt-4-turbo", "gpt4-turbo", "gpt-4-0125", "gpt-4-1106"],
  },
  {
    displayName: "GPT-4",
    provider: "OpenAI",
    scope1PerToken: 0.00363,
    scope12PerToken: 0.00450,
    patterns: ["gpt-4", "gpt4"],
  },
  {
    displayName: "GPT-3.5",
    provider: "OpenAI",
    scope1PerToken: 0.00200,
    scope12PerToken: 0.00250,
    patterns: ["gpt-3.5", "gpt3.5", "gpt-35", "chatgpt-3.5"],
  },

  // ── Anthropic (Cursor + Copilot) ────────────────────────────────────────
  {
    displayName: "Claude Opus 4 / 4.x",
    provider: "Anthropic",
    scope1PerToken: 0.040,
    scope12PerToken: 0.055,
    patterns: [
      "claude-opus-4",
      "claude-4-opus",
      "claude-4.5-opus",
      "opus-4",
      "claude-opus",
    ],
    reasoningMultiplier: 8,
  },
  {
    displayName: "Claude Sonnet 4 / 4.x",
    provider: "Anthropic",
    scope1PerToken: 0.00550,
    scope12PerToken: 0.00700,
    patterns: [
      "claude-sonnet-4",
      "claude-4-sonnet",
      "claude-4.5-sonnet",
      "sonnet-4",
      "claude-sonnet",
    ],
  },
  {
    displayName: "Claude Haiku 4 / 3.5",
    provider: "Anthropic",
    scope1PerToken: 0.00180,
    scope12PerToken: 0.00240,
    patterns: ["claude-haiku-4", "claude-4-haiku", "claude-haiku", "haiku"],
  },
  {
    displayName: "Claude 3.7 / Extended Thinking",
    provider: "Anthropic",
    scope1PerToken: 0.035,
    scope12PerToken: 0.050,
    patterns: ["claude-3-7", "claude-3.7", "extended-thinking", "sonnet-thinking"],
    reasoningMultiplier: 10,
  },
  {
    displayName: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    scope1PerToken: 0.00450,
    scope12PerToken: 0.00580,
    patterns: ["claude-3-5-sonnet", "claude-3.5-sonnet", "claude-3.5"],
  },
  {
    displayName: "Claude 3.x",
    provider: "Anthropic",
    scope1PerToken: 0.00420,
    scope12PerToken: 0.00553,
    patterns: ["claude-3-opus", "claude-3-sonnet", "claude-3", "claude3"],
  },
  {
    displayName: "Claude 2.x",
    provider: "Anthropic",
    scope1PerToken: 0.00350,
    scope12PerToken: 0.00460,
    patterns: ["claude-2", "claude2"],
  },
  {
    displayName: "Claude",
    provider: "Anthropic",
    scope1PerToken: 0.00420,
    scope12PerToken: 0.00550,
    patterns: ["claude", "anthropic"],
  },

  // ── Google / Antigravity (Gemini) ───────────────────────────────────────
  {
    displayName: "Gemini 2.5 Pro",
    provider: "Google",
    scope1PerToken: 0.00320,
    scope12PerToken: 0.00400,
    patterns: [
      "gemini-2.5-pro",
      "gemini-2-5-pro",
      "gemini-2.5-pro-preview",
      "antigravity-pro",
    ],
  },
  {
    displayName: "Gemini 2.5 Flash-Lite",
    provider: "Google",
    scope1PerToken: 0.00100,
    scope12PerToken: 0.00140,
    patterns: [
      "gemini-2.5-flash-lite",
      "gemini-2-5-flash-lite",
      "flash-lite",
      "gemini-flash-lite",
    ],
  },
  {
    displayName: "Gemini 2.5 Flash",
    provider: "Google",
    scope1PerToken: 0.00150,
    scope12PerToken: 0.00200,
    patterns: [
      "gemini-2.5-flash",
      "gemini-2-5-flash",
      "gemini-2.5-flash-preview",
      "gemini-flash",
    ],
  },
  {
    displayName: "Gemini 2.0 Flash",
    provider: "Google",
    scope1PerToken: 0.00140,
    scope12PerToken: 0.00190,
    patterns: ["gemini-2.0-flash", "gemini-2-0-flash", "gemini-2.0-flash-exp"],
  },
  {
    displayName: "Gemini 2.0 / 1.5 Pro",
    provider: "Google",
    scope1PerToken: 0.00280,
    scope12PerToken: 0.00350,
    patterns: [
      "gemini-2.0-pro",
      "gemini-2.0",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-pro",
      "gemini-1.5",
    ],
  },
  {
    displayName: "Gemini Ultra / Experimental",
    provider: "Google",
    scope1PerToken: 0.00400,
    scope12PerToken: 0.00500,
    patterns: ["gemini-ultra", "gemini-exp", "gemini-experimental"],
  },
  {
    displayName: "Antigravity chat (Gemini)",
    provider: "Google",
    scope1PerToken: 0.00250,
    scope12PerToken: 0.00309,
    patterns: ["antigravity", "ag-chat", "gemini-chat"],
  },
  {
    displayName: "Gemini",
    provider: "Google",
    scope1PerToken: 0.00250,
    scope12PerToken: 0.00309,
    patterns: ["gemini", "google-ai", "google"],
  },

  // ── Cursor-native models ────────────────────────────────────────────────
  {
    displayName: "Cursor Composer 2",
    provider: "Cursor",
    scope1PerToken: 0.00320,
    scope12PerToken: 0.00420,
    patterns: ["composer-2", "composer2"],
  },
  {
    displayName: "Cursor Composer",
    provider: "Cursor",
    scope1PerToken: 0.00300,
    scope12PerToken: 0.00400,
    patterns: ["composer-1", "composer", "cursor-composer"],
  },
  {
    displayName: "Cursor Agent / Background",
    provider: "Cursor",
    scope1PerToken: 0.00320,
    scope12PerToken: 0.00420,
    patterns: [
      "cursor-agent",
      "background-agent",
      "cursor-bg",
      "agent-mode",
      "cursor-ide-agent",
    ],
  },
  {
    displayName: "Cursor Small / Fast",
    provider: "Cursor",
    scope1PerToken: 0.00180,
    scope12PerToken: 0.00240,
    patterns: ["cursor-small", "cursor-fast", "cursor-lite"],
  },
  {
    displayName: "Cursor chat (blended)",
    provider: "Cursor",
    scope1PerToken: 0.00300,
    scope12PerToken: 0.00400,
    patterns: ["cursor-chat", "cursor-auto", "cursor"],
  },

  // ── GitHub Copilot / VS Code Chat ───────────────────────────────────────
  {
    displayName: "GitHub Copilot (GPT)",
    provider: "GitHub Copilot",
    scope1PerToken: 0.00363,
    scope12PerToken: 0.00438,
    patterns: [
      "copilot-gpt",
      "github-copilot",
      "copilot-chat",
      "vs-code-chat",
      "vscode-chat",
    ],
  },
  {
    displayName: "Copilot Edits / Agent",
    provider: "GitHub Copilot",
    scope1PerToken: 0.00380,
    scope12PerToken: 0.00460,
    patterns: ["copilot-edits", "copilot-agent", "copilot-workspace", "multi-file-edit"],
  },
  {
    displayName: "Editor chat (blended)",
    provider: "Mixed",
    scope1PerToken: 0.00300,
    scope12PerToken: 0.00400,
    patterns: ["editor-blended", "auto", "default"],
  },

  // ── Meta ────────────────────────────────────────────────────────────────
  {
    displayName: "Llama 4",
    provider: "Meta",
    scope1PerToken: 0.00450,
    scope12PerToken: 0.00600,
    patterns: ["llama-4", "llama4", "llama-4-maverick", "llama-4-scout"],
  },
  {
    displayName: "Llama 3 / 70B",
    provider: "Meta",
    scope1PerToken: 0.00620,
    scope12PerToken: 0.00830,
    patterns: ["llama-3.3", "llama-3.1", "llama-3", "llama3", "llama-70", "llama2-70"],
  },
  {
    displayName: "Llama (small)",
    provider: "Meta",
    scope1PerToken: 0.00150,
    scope12PerToken: 0.00200,
    patterns: ["llama-2-7", "llama-2-13", "llama-7", "llama-13", "llama"],
  },

  // ── Mistral ─────────────────────────────────────────────────────────────
  {
    displayName: "Mistral Large / Medium",
    provider: "Mistral AI",
    scope1PerToken: 0.00250,
    scope12PerToken: 0.00340,
    patterns: ["mistral-large", "mistral-medium", "magistral", "mistral-small"],
  },
  {
    displayName: "Codestral",
    provider: "Mistral AI",
    scope1PerToken: 0.00180,
    scope12PerToken: 0.00250,
    patterns: ["codestral"],
  },
  {
    displayName: "Mistral 7B",
    provider: "Mistral AI",
    scope1PerToken: 0.00100,
    scope12PerToken: 0.00138,
    patterns: ["mistral-7b", "mistral7b"],
  },
  {
    displayName: "Mistral / Mixtral",
    provider: "Mistral AI",
    scope1PerToken: 0.00200,
    scope12PerToken: 0.00280,
    patterns: ["mixtral", "mistral", "pixtral"],
  },

  // ── Others common in Cursor / Copilot pickers ───────────────────────────
  {
    displayName: "DeepSeek V3 / R1",
    provider: "DeepSeek",
    scope1PerToken: 0.00250,
    scope12PerToken: 0.00350,
    patterns: [
      "deepseek-r1",
      "deepseek-v3",
      "deepseek-chat",
      "deepseek-coder",
      "deepseek",
    ],
  },
  {
    displayName: "Qwen",
    provider: "Alibaba",
    scope1PerToken: 0.00220,
    scope12PerToken: 0.00300,
    patterns: ["qwen3", "qwen2.5", "qwen2", "qwen-coder", "qwen"],
  },
  {
    displayName: "Grok",
    provider: "xAI",
    scope1PerToken: 0.00350,
    scope12PerToken: 0.00450,
    patterns: ["grok-4", "grok-3", "grok-2", "grok"],
  },
  {
    displayName: "Perplexity",
    provider: "Perplexity AI",
    scope1PerToken: 0.00540,
    scope12PerToken: 0.00723,
    patterns: ["perplexity", "pplx", "sonar"],
  },
  {
    displayName: "Command R / Cohere",
    provider: "Cohere",
    scope1PerToken: 0.00280,
    scope12PerToken: 0.00360,
    patterns: ["command-r", "command-a", "cohere"],
  },
  {
    displayName: "Amazon Nova",
    provider: "Amazon",
    scope1PerToken: 0.00220,
    scope12PerToken: 0.00300,
    patterns: ["nova-pro", "nova-lite", "nova-micro", "amazon-nova", "nova"],
  },
  {
    displayName: "Phi",
    provider: "Microsoft",
    scope1PerToken: 0.00120,
    scope12PerToken: 0.00160,
    patterns: ["phi-4", "phi-3", "phi"],
  },
  {
    displayName: "Yi / 01.AI",
    provider: "01.AI",
    scope1PerToken: 0.00200,
    scope12PerToken: 0.00280,
    patterns: ["yi-large", "yi-"],
  },
  {
    displayName: "Kimi / Moonshot",
    provider: "Moonshot",
    scope1PerToken: 0.00280,
    scope12PerToken: 0.00360,
    patterns: ["kimi", "moonshot"],
  },
];

export const FALLBACK_RATE: ModelRate = {
  displayName: "Unknown model",
  provider: "Unknown",
  scope1PerToken: 0.00300,
  scope12PerToken: 0.00400,
  patterns: [],
};

export function getRateForModel(modelId: string): ModelRate {
  const lower = modelId.toLowerCase();
  for (const rate of MODEL_RATES) {
    if (rate.patterns.some((p) => lower.includes(p))) {
      return rate;
    }
  }
  return FALLBACK_RATE;
}

/** Display names for the Set Model quick-pick (grouped by IDE ecosystem). */
export function listModelPickChoices(): string[] {
  return [
    // Cursor
    "composer-2",
    "composer",
    "cursor-agent",
    "cursor-chat",
    "cursor-small",
    // Copilot / VS Code
    "github-copilot",
    "copilot-edits",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-5",
    "o3",
    "o1",
    // Anthropic (Cursor + Copilot)
    "claude-sonnet-4",
    "claude-opus-4",
    "claude-haiku",
    "claude-3.5-sonnet",
    // Antigravity / Gemini
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini",
    "antigravity",
    // Others
    "deepseek",
    "llama-4",
    "llama-3",
    "mistral",
    "codestral",
    "grok",
    "qwen",
    "other",
  ];
}
