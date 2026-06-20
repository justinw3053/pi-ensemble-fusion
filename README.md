# Pi Ensemble Fusion (Mixture-of-Agents)

A high-performance **Mixture-of-Agents (MoA) / Fusion** ensemble pipeline extension built natively for the [Pi Coding Agent](https://pi.dev). 

It fuses the raw horsepower of concurrent local models with the ultimate analytical reasoning of a cloud frontier model, creating an incredibly smart, fast, and extremely cost-efficient "Fable-level" reasoning engine right in your terminal.

Inspired by **OpenRouter Fusion** and designed to mimic supreme reasoning capabilities (such as Anthropic's retired *Fable 5* models) using a cost-efficient local-cloud hybrid architecture.

---

## 🗺️ Architectural Concept

Instead of sending a complex prompt to a single model, **Pi Ensemble Fusion** runs a three-part pipeline:

```
                  ┌───────────────────────┐
                  │     User Question     │
                  └───────────┬───────────┘
                              ▼
                  ┌───────────────────────┐
                  │  Pi Router / Trigger  │ (Auto-triggers or via /ensemble)
                  └───────────┬───────────┘
             ┌────────────────┴────────────────┐
             ▼ (Concurrent Local Run)          ▼ (Concurrent Local Run)
     ┌──────────────┐                  ┌──────────────┐
     │ Generator A  │                  │ Generator B  │
     │ (Ollama)     │                  │ (Ollama)     │
     └───────┬──────┘                  └───────┬──────┘
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                  ┌───────────────────────┐
                  │      Cloud Judge      │ (Synthesizes/Selects winner)
                  │ (Gemini 3.1 Pro via   │
                  │   gemini-acp / CLI)   │
                  └───────────┬───────────┘
                              ▼
                  ┌───────────────────────┐
                  │     Master Answer     │
                  └───────────────────────┘
```

1. **Parallel Local Generators (VRAM Speed):** Concurrently sends the question to two massive local models (e.g., Qwen 27B and Gemma 26B) running on your local Apple Silicon/Ollama setup using native TypeScript `Promise.all()`. This takes advantage of shared high-bandwidth Unified Memory, bypassing internet latency.
2. **Cloud Synthesis (Frontier Reasoning):** Automatically structures the answers and hands them over to **Gemini 3.1 Pro** (via the `gemini` CLI) acting as the supreme judge. Gemini compares both answers, catches omissions, resolves contradictions, and delivers a definitive, highly polished master response.
3. **Hybrid Cost Efficiency:** Your local hardware does 90% of the token-generation work for free, leaving only the final synthesis step for the cloud API—giving you top-tier reasoning for a fraction of a cent per call.

---

## 🛠️ Features

*   **⚡ Concurrency First:** Local models are queried in parallel, ensuring latency is determined by the single slowest local model, rather than the sum of both.
*   **🧩 Dual Entry Points:**
    *   **Slash Command (`/ensemble`):** Query the ensemble manually in the Pi TUI. Supports active spinner notifications during generation.
    *   **Autonomous Tool (`ask_ensemble`):** Allows your Pi coding assistant (e.g., *Sebastian*) to autonomously delegate complex architectural or logical problems to the ensemble.
*   **⚖️ Dynamic Arbitration Strategies:**
    *   `synthesize` (Default): The judge critically evaluates both answers and merges the best components of each into a unified output.
    *   `best_of_n`: The judge evaluates both responses and returns the single superior response completely **verbatim**, maintaining raw code structure and avoiding synthesis syntax issues.

---

## ⚙️ Configuration & Model Selection

You can fully customize which models play which roles using system environment variables. Place these in your shell profile (e.g., `~/.zshrc`) or run them inline:

```bash
# Define your local parallel generators
export ENSEMBLE_GEN_A="qwen3.6:27b-mlx"
export ENSEMBLE_GEN_B="gemma4:26b-mlx"

# Define your supreme judge (defaults to Gemini Pro)
export ENSEMBLE_JUDGE="gemini-3.1-pro-preview"
```

---

## 🚀 Installation

### 1. Prerequisite: Dependencies
Make sure you have:
*   [Ollama](https://ollama.com) running locally with your chosen generator models loaded.
*   [Gemini CLI](https://github.com/google/gemini-cli) installed and authenticated.

### 2. Register Global Extension
Because Pi loads TypeScript extensions dynamically, you can install this extension simply by copying or symlinking `ensemble.ts` to your global Pi extensions folder:

```bash
# Create the directory if it doesn't exist
mkdir -p ~/.pi/agent/extensions

# Copy the extension
cp ensemble.ts ~/.pi/agent/extensions/ensemble.ts
```

Then open/restart your Pi agent session. It will automatically detect and load the extension!

---

## 📖 Usage

### Option A: Manual Terminal Commands (Pi TUI)

Simply type `/ensemble` in your active Pi session to prompt the ensemble interactively:

```
/ensemble What is the most memory-efficient way to handle large XML parsing in Node.js?
```

You can customize the strategy inline using the `--strategy` option:

```
/ensemble Design a thread-safe singleton in TS. --strategy best_of_n
```

### Option B: Autonomous Agent Delegation (TUI or headless)

Your Pi Agent (such as Sebastian) automatically recognizes the `ask_ensemble` tool and will invoke it when faced with deep problems. You can also explicitly prompt your agent to use it:

```
pi "Use the ask_ensemble tool to diagnose why this AWS CDK deployment is failing with circular dependency"
```

---

## 📜 License

MIT License. Feel free to use, modify, and distribute!
