# Standalone Reddit Post: Replicating OpenRouter's Fusion/Fable 5 pipeline locally: A local-cloud hybrid MoA extension

## Title: 
Replicating OpenRouter's Fusion/Fable 5 pipeline locally: A local-cloud hybrid MoA extension

---

## Body:

I wanted to find a way to replicate the deep reasoning and debate capabilities of OpenRouter Fusion (and Anthropic's retired Fable 5 models) without burning through hundreds of dollars in cloud API tokens every week. 

To solve this, I built a high-performance **local-cloud hybrid Mixture-of-Agents (MoA) pipeline** as a native extension for the **[Pi Coding Agent](https://pi.dev)**. 

My setup runs on an **Apple M5 Pro (48GB Unified RAM)**, and I’ve open-sourced the extension on GitHub so anyone can drop it into their agent setups: **[justinw3053/pi-ensemble-fusion](https://github.com/justinw3053/pi-ensemble-fusion)**.

### The Architecture

```
                  ┌───────────────────────┐
                  │     User Question     │
                  └───────────┬───────────┘
                              ▼
                  ┌───────────────────────┐
                  │  Pi Router / Trigger  │ (TUI Command / Agent Tool)
                  └───────────┬───────────┘
             ┌────────────────┴────────────────┐
             ▼ (Concurrent Local Run)          ▼ (Concurrent Local Run)
     ┌──────────────┐                  ┌──────────────┐
     │ Generator A  │                  │ Generator B  │
     │  Qwen 27B    │                  │  Gemma 26B   │
     │   (Ollama)   │                  │   (Ollama)   │
     └───────┬──────┘                  └───────┬──────┘
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                  ┌───────────────────────┐
                  │      Cloud Judge      │ (Synthesizes/Selects winner)
                  │ (Gemini 3.1 Pro via   │
                  │     Gemini CLI)       │
                  └───────────┬───────────┘
                              ▼
                  ┌───────────────────────┐
                  │     Master Answer     │
                  └───────────────────────┘
```

1. **Parallel Local Generators (90% of the work for free):** The prompt concurrently fans out to **`qwen3.6:27b-mlx`** (logic/depth) and **`gemma4:26b-mlx`** (expressive reasoning) running inside local Ollama using native TypeScript `Promise.all()`. This leverages Apple Silicon's shared high-bandwidth Unified Memory, bypassing internet latency during the heavy generation phase.
2. **Cloud Synthesis (Frontier Reasoning):** Once the local models finish, their outputs are formatted into a prompt and handed to **`gemini-3.1-pro-preview`** (via the Gemini CLI) acting as the supreme judge. Gemini Pro evaluates both local responses, resolves contradictions, catches hallucinations, and synthesizes a single, definitive master response.
3. **The Hybrid Payoff:** Because the massive generation legs happen entirely on local VRAM for free, only the final synthesis step hits the cloud. You get top-tier reasoning depth for a fraction of a cent per query.

### Developer Integrations

To make this practical for daily engineering, I registered it in Pi under two entry-points:
*   **The `/ensemble` Slash Command:** For direct, interactive prompting in the Pi terminal. It features a real-time progress bar/spinner in notifications and opens a fullscreen word-wrapped overlay view (using native `ctx.ui.custom`).
*   **The Autonomous LLM Tool (`ask_ensemble`):** Extends the core agent's capabilities. Your active Pi coding assistant (Sebastian) can autonomously delegate complex architectural or debugging problems to the ensemble.
*   **Automatic Workspace & Clipboard Sync:** Once complete, the extension pipes the result into the macOS clipboard (`pbcopy`) and caches it as a visible markdown file (`ensemble_last_response.md`) in your working directory (automatically ignored in `.gitignore`). Closing the fullscreen TUI viewer immediately leaves you with the response ready to paste anywhere.

### Dynamic Arbitration Strategies

The extension supports two distinct inline strategies:
*   `--strategy synthesize` (Default): The judge critically evaluates and merges the best parts of both local models.
*   `--strategy best_of_n`: The judge compares both answers and returns the single superior response completely **verbatim**, maintaining raw code formatting and syntax integrity.

Fanning out to local 26B/27B models on unified memory and letting the cloud perform only the final synthesis works surprisingly well. 

If anyone is running Pi and Ollama, feel free to clone, drop it in your extensions folder, and let me know how it performs on your local model suite: **[justinw3053/pi-ensemble-fusion](https://github.com/justinw3053/pi-ensemble-fusion)**!
