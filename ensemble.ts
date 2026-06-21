import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { writeFileSync, appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Helper to copy text to system clipboard on macOS
function copyToClipboard(text: string) {
  if (process.platform === "darwin") {
    try {
      const proc = spawn("pbcopy");
      proc.stdin.write(text);
      proc.stdin.end();
    } catch (e) {
      // Ignore copy errors silently
    }
  }
}

// Helper to save result to workspace and add to gitignore
function saveToWorkspace(text: string, cwd: string) {
  try {
    const filename = "ensemble_last_response.md";
    const filePath = cwd ? `${cwd}/${filename}` : filename;
    writeFileSync(filePath, text, "utf-8");

    // Check if gitignore exists and add filename if not present
    const gitignorePath = cwd ? `${cwd}/.gitignore` : ".gitignore";
    if (existsSync(gitignorePath)) {
      const gitignore = readFileSync(gitignorePath, "utf-8");
      if (!gitignore.includes(filename)) {
        appendFileSync(gitignorePath, `\n${filename}\n`, "utf-8");
      }
    } else {
      writeFileSync(gitignorePath, `${filename}\n`, "utf-8");
    }
  } catch (e: any) {
    console.error(`[Ensemble Save Error]: ${e.message}`);
  }
}

// Automatically injects local file trees and file contents mentioned in the prompt
function hydrateWorkspaceContext(prompt: string, cwd: string, notify: (msg: string) => void): string {
  let hydratedPrompt = prompt;
  try {
    if (!cwd) return hydratedPrompt;

    const items = readdirSync(cwd);
    const files: string[] = [];
    const dirs: string[] = [];
    const matchedFiles: string[] = [];

    for (const item of items) {
      if (item.startsWith(".") || item === "node_modules" || item === "dist" || item === "package-lock.json" || item === "ensemble_last_response.md") continue;
      const fullPath = join(cwd, item);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        dirs.push(item);
      } else {
        files.push(item);
        
        // If user prompt mentions this filename explicitly (case-insensitive check)
        if (prompt.toLowerCase().includes(item.toLowerCase())) {
          const content = readFileSync(fullPath, "utf-8");
          // Cap file read size to 15k characters to keep local context window light
          const truncatedContent = content.length > 15000 
            ? content.substring(0, 15000) + "\n... [content truncated to fit token limits] ..." 
            : content;
          
          hydratedPrompt += `\n\n[Workspace File Content: ${item}]\n\`\`\`\n${truncatedContent}\n\`\`\`\n`;
          matchedFiles.push(item);
        }
      }
    }

    // Always append the workspace directory map so models understand your directory tree
    let treeContext = `\n\n[Workspace Directory Tree Map]\n`;
    treeContext += `Working Directory: ${cwd}\n`;
    if (dirs.length > 0) treeContext += `Directories: ${dirs.join(", ")}\n`;
    if (files.length > 0) treeContext += `Files: ${files.join(", ")}\n`;
    
    hydratedPrompt += treeContext;

    if (matchedFiles.length > 0) {
      notify(`Injected contents of files: ${matchedFiles.join(", ")}`);
    } else {
      notify(`Injected local workspace file tree context.`);
    }
  } catch (e) {
    // Fail silently, return original prompt
  }
  return hydratedPrompt;
}

// Configurable models via environment variables or default fallbacks
const MODEL_GEN_A = process.env.ENSEMBLE_GEN_A || "qwen3.6:27b-mlx";
const MODEL_GEN_B = process.env.ENSEMBLE_GEN_B || "gemma4:26b-mlx";
const MODEL_JUDGE = process.env.ENSEMBLE_JUDGE || "gemini-3.1-pro-preview";

// Helper to query local Ollama HTTP endpoints
async function queryOllama(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch("http://localhost:11434/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama fetch failed for ${model}: ${response.statusText}`);
  }

  const json = await response.json() as any;
  return json.choices[0].message.content;
}

// Helper to spawn the local Gemini CLI as the ultimate Judge
function runGeminiJudge(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gemini", ["-p", prompt]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("close", (code) => {
      if (code === 0) {
        // Clean up stderr fallback messages if any bleed into stdout
        const cleanOutput = stdout
          .replace("Ripgrep is not available. Falling back to GrepTool.\n", "")
          .trim();
        resolve(cleanOutput);
      } else {
        reject(new Error(`Gemini CLI failed with code ${code}: ${stderr}`));
      }
    });
  });
}

// Real-time progress bar and spinner animator
class ProgressLoader {
  private intervalId: any = null;
  private currentMsg = "";
  private spinnerIndex = 0;
  private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private pct = 0;
  private targetCap = 0;

  constructor(private notify: (msg: string) => void) {}

  public start() {
    this.pct = 5;
    this.targetCap = 45; // Default cap for first phase (Ollama generation)
    this.currentMsg = "Initializing pipeline...";
    
    this.intervalId = setInterval(() => {
      const spinner = this.spinnerFrames[this.spinnerIndex % this.spinnerFrames.length];
      this.spinnerIndex++;
      
      // Gradually tick up towards the current phase's cap to show active progress
      if (this.pct < this.targetCap) {
        this.pct += 1;
      }
      
      // Calculate bar slots based on percentage (1 slot = 10%)
      const completedSlots = Math.floor(this.pct / 10);
      const remainingSlots = 10 - completedSlots;
      const bar = "█".repeat(completedSlots) + "░".repeat(remainingSlots);

      this.notify(`${spinner} [${bar}] ${this.pct}% | ${this.currentMsg}`);
    }, 150);
  }

  public setPhase(cap: number, msg: string) {
    this.targetCap = cap;
    this.currentMsg = msg;
    // Boost percentage if it is behind the new phase boundary
    if (this.pct < cap - 25) {
      this.pct = cap - 25;
    }
  }

  public stop(success: boolean) {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    const finalSpinner = success ? "✓" : "❌";
    const finalBar = success ? "██████████" : "░░░░░░░░░░";
    const finalPct = success ? 100 : 0;
    this.notify(`${finalSpinner} [${finalBar}] ${finalPct}% | ${success ? "Ensemble processing complete!" : "Ensemble processing failed."}`);
  }
}

// Helper to wrap a single long line into multiple lines fitting the terminal width
function wrapLine(line: string, maxWidth: number): string[] {
  if (line.length <= maxWidth) return [line];
  
  const words = line.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + (currentLine ? " " : "") + word).length <= maxWidth) {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    } else {
      if (currentLine) lines.push(currentLine);
      if (word.length > maxWidth) {
        // Force split extremely long words
        let remaining = word;
        while (remaining.length > maxWidth) {
          lines.push(remaining.substring(0, maxWidth));
          remaining = remaining.substring(maxWidth);
        }
        currentLine = remaining;
      } else {
        currentLine = word;
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Memory state for active session context handoff
let lastEnsemblePrompt = "";
let lastEnsembleAnswer = "";

// Helper to wait for a single terminal keypress before resuming the TUI
function waitForKeypress(): Promise<void> {
  return new Promise((resolve) => {
    const isRaw = process.stdin.isRaw;
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.once("data", () => {
      if (typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(isRaw);
      }
      resolve();
    });
  });
}

export default function ensembleExtension(pi: ExtensionAPI) {
  // System prompt for generators
  const systemPrompt = "You are an expert technical advisor. Provide a highly detailed, technically rigorous, and accurate answer to the user's question. Focus on correctness and avoid fluff.";

  // Register lifecycle hook to inject ensemble context into active model's memory
  pi.on("before_agent_start", async (event) => {
    if (!lastEnsembleAnswer) return undefined;

    const contextBlock = `

## Active Context: Latest MoA Ensemble Response
The user recently queried our Mixture-of-Agents ensemble. Use this response as active context for any follow-up questions from the user, acting as if you wrote the response yourself.
- **Original Prompt:** "${lastEnsemblePrompt}"
- **Ensemble Master Answer:**
${lastEnsembleAnswer}
`;

    return {
      systemPrompt: event.systemPrompt + contextBlock
    };
  });

  const runPipeline = async (
    prompt: string, 
    strategy: "synthesize" | "best_of_n", 
    notify: (msg: string) => void,
    cwd?: string
  ): Promise<string> => {
    const loader = new ProgressLoader(notify);
    loader.start();

    try {
      loader.setPhase(15, "Hydrating local workspace context...");
      const hydratedPrompt = hydrateWorkspaceContext(prompt, cwd || "", (msg) => loader.setPhase(15, msg));

      loader.setPhase(45, `Querying generators (${MODEL_GEN_A} & ${MODEL_GEN_B}) concurrently...`);
      // 1. Fire parallel calls to Ollama with the fully hydrated context prompt
      const [genAResponse, genBResponse] = await Promise.all([
        queryOllama(MODEL_GEN_A, systemPrompt, hydratedPrompt).catch(e => `[Error ${MODEL_GEN_A}]: ${e.message}`),
        queryOllama(MODEL_GEN_B, systemPrompt, hydratedPrompt).catch(e => `[Error ${MODEL_GEN_B}]: ${e.message}`)
      ]);

      // 2. Format the synthesis/judging prompt for the Judge based on the selected strategy
      let judgePrompt = "";
      if (strategy === "best_of_n") {
        judgePrompt = `
      You are the Supreme Judge in a Mixture-of-Agents ensemble. 
      Below is a user's original request along with answers generated by two distinct expert models.

      Your task:
      1. Critically evaluate both expert responses for accuracy, technical depth, correctness, and potential hallucinations.
      2. Select the single superior response.
      3. Return that chosen response absolutely verbatim. Do NOT modify the code, syntax, or phrasing of the winning response. 
      4. Output ONLY the verbatim winning response, without any introductory or concluding remarks (do not say "Model A is better" or "Here is the winning response").

      CRITICAL CONSTRAINTS & GUARDRAILS:
      - Do NOT rewrite, explain, or add any introductory/concluding remarks.
      - Output ONLY the verbatim text of the winning model's response.
      - NEVER state or imply that you have performed real-time terminal audits, active directory scans, or file system actions yourself.

      [Original User Prompt (Hydrated Workspace Context)]:
      ${hydratedPrompt}

      ---

      [Expert Response A (${MODEL_GEN_A})]:
      ${genAResponse}

      ---

      [Expert Response B (${MODEL_GEN_B})]:
      ${genBResponse}

      ---

      Provide the verbatim winning response below:
      `;
      } else {
        // Default: synthesize
        judgePrompt = `
      You are the Supreme Judge in a Mixture-of-Agents ensemble. 
      Below is a user's original request along with answers generated by two distinct expert models.

      Your task:
      1. Critically evaluate both responses for accuracy, omissions, and hallucinations.
      2. Synthesize the absolute best parts of both answers.
      3. Resolve any contradictions based on ground truth and standard engineering patterns.
      4. Output a single, perfectly unified, professional, and definitive master answer. Do not output multiple sections of "Model A said X, Model B said Y" unless helpful for contrasting trade-offs. Present the final output as a single cohesive response.

      CRITICAL CONSTRAINTS & GUARDRAILS:
      - NEVER claim, state, or imply that you have performed real-time file system actions, terminal execution, audits, directory scans, or network calls yourself. You are a text synthesizer, not an active agent.
      - Stick strictly to synthesizing the content provided in Expert Response A and Expert Response B. Do not make up imaginary facts or inject external environment variables/paths (such as referring to '/content' or non-existent notebooks) that are not explicitly present in the provided responses.
      - Maintain an objective, professional, direct technical advisor tone. Eliminate conversational preambles, introductory brags, meta-commentary, or references to your own system capabilities. Present the final output directly.

      [Original User Prompt (Hydrated Workspace Context)]:
      ${hydratedPrompt}

      ---

      [Expert Response A (${MODEL_GEN_A})]:
      ${genAResponse}

      ---

      [Expert Response B (${MODEL_GEN_B})]:
      ${genBResponse}

      ---

      Provide your final master synthesis below.
      `;
      }

      loader.setPhase(95, `Invoking ${MODEL_JUDGE} for final synthesis...`);

      // 3. Execute the Gemini CLI Judge
      const result = await runGeminiJudge(judgePrompt);
      
      // Update cache for active session handoff
      lastEnsemblePrompt = prompt;
      lastEnsembleAnswer = result;

      // Copy to system clipboard and save to workspace visible cache
      copyToClipboard(result);
      saveToWorkspace(result, cwd || "");

      loader.stop(true);
      return result;
    } catch (error) {
      loader.stop(false);
      throw error;
    }
  };

  // 1. Register LLM Tool
  pi.registerTool({
    name: "ask_ensemble",
    label: "Ask MoA Ensemble",
    description: "Queries a Mixture-of-Agents ensemble of local and cloud models. Concurrently runs local generator models, then passes both responses to Gemini to judge and select/synthesize the definitive answer.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The complex question or challenge to resolve." }),
      strategy: Type.Optional(Type.Union([
        Type.Literal("synthesize"),
        Type.Literal("best_of_n")
      ], { 
        description: "The arbitration strategy. 'synthesize' merges responses; 'best_of_n' returns the winning model's response completely verbatim.",
        default: "synthesize" 
      }))
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const strategy = params.strategy || "synthesize";
      try {
        const result = await runPipeline(params.prompt, strategy, (msg) => console.log(`[Ensemble]: ${msg}`), ctx?.cwd);
        return {
          content: [
            {
              type: "text",
              text: result
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: `Ensemble Pipeline Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    }
  });

  // 2. Register Slash Command
  pi.registerCommand("ensemble", {
    description: "Queries the Mixture-of-Agents ensemble natively inline in your chat thread. Options: --strategy [synthesize|best_of_n]",
    handler: async (args: string, ctx) => {
      let prompt = (args || "").trim();
      let strategy = "synthesize";

      // Parse --strategy flag if present
      if (prompt.includes("--strategy")) {
        const match = prompt.match(/--strategy\s+(\S+)/);
        if (match) {
          const val = match[1].toLowerCase();
          if (val === "best_of_n" || val === "synthesize") {
            strategy = val;
          }
          prompt = prompt.replace(/--strategy\s+\S+/, "").trim();
        }
      }

      // If no prompt was provided, notify usage
      if (!prompt) {
        ctx.ui.notify("Usage: /ensemble <your prompt> [--strategy synthesize|best_of_n]", "warning");
        return;
      }

      ctx.ui.notify(`Initializing Ensemble Pipeline (${strategy} mode)...`);
      try {
        const result = await runPipeline(prompt, strategy, (msg) => ctx.ui.notify(msg), ctx.cwd);
        
        if (ctx.hasUI) {
          const lines = result.split("\n");
          await ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: any) => {
            return {
              handleInput(data: string) {
                // Only close on 'q' or 'ESC'. Avoid "\r" (Enter) to prevent trailing Enter keypress from closing the overlay instantly!
                if (data === "q" || data === "\x1b" || data === "\u001b") {
                  done();
                }
              },
              render(width: number): string[] {
                const maxLineWidth = width - 4; // Margin padding
                const wrappedLines: string[] = [];

                lines.forEach(rawLine => {
                  const wrapped = wrapLine(rawLine, maxLineWidth);
                  wrappedLines.push(...wrapped);
                });

                const border = "═".repeat(Math.min(width, 80));
                const header = theme.bold(theme.fg("accent", `🌟 Ensemble Master Answer (${strategy}) 🌟`));
                const footer = theme.fg("dim", `[Press 'q' or ESC to return to chat]`);
                
                const finalLines = [
                  border,
                  header,
                  border,
                  ...wrappedLines,
                  border,
                  footer,
                  border
                ];

                // Defensively truncate every line to width - 1 to guarantee zero TUI crashes
                return finalLines.map(line => line.substring(0, width - 1));
              },
              invalidate() {}
            };
          });

          // Notify completion
          ctx.ui.notify("Answer copied to clipboard, saved & added to memory context!", "success");
        } else {
          console.log(`\n=== 🌟 Ensemble Master Answer (${strategy}) ===\n\n${result}\n`);
        }
      } catch (error: any) {
        if (ctx.hasUI) {
          ctx.ui.notify(`Error: ${error.message}`, "error");
        } else {
          console.error(`\n❌ Error: ${error.message}\n`);
        }
      }
    }
  });
}
