const CONFIG_KEY = "gismap-online:ai-config:v2";
const LEGACY_CONFIG_KEY = "gismap-online:ai-config:v1";

const PROVIDER_DEFAULTS = {
  ollama: { endpoint: "http://localhost:11434", model: "llama3.2" },
  openai: { endpoint: "https://api.openai.com/v1", model: "gpt-5-mini" },
  anthropic: { endpoint: "https://api.anthropic.com/v1", model: "claude-sonnet-5" },
  "openai-compatible": { endpoint: "", model: "" },
};

export const AI_SYSTEM_PROMPT =
  "You are the GIS Map Online spatial analysis assistant. Treat supplied map layers, identified features, " +
  "coordinates, and geocoder details as the primary evidence. You may also use your general knowledge to " +
  "provide useful geographic, historical, and cultural context. Clearly distinguish map observations from " +
  "general-knowledge inference. Do not claim that a specific landmark or feature is at the clicked coordinates " +
  "unless the map context or geocoder confirms it. Say when a question requires current external research that " +
  "you cannot perform, and never invent missing map attributes.";

function compactAttributes(attributes) {
  return Object.fromEntries(Object.entries(attributes ?? {})
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) && value !== "")
    .slice(0, 40)
    .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 500) : value]));
}

export function buildAIMapContext(context, loadedLayers = []) {
  if (!context) return { loadedLayers };
  return {
    coordinates: context.point
      ? { longitude: context.point.longitude, latitude: context.point.latitude }
      : null,
    address: context.address?.address ?? null,
    geocoderDetails: compactAttributes(context.address?.attributes),
    features: (context.results ?? []).slice(0, 20).map((result) => ({
      layer: result.layerTitle,
      attributes: result.attributes,
    })),
    loadedLayers,
  };
}

export class AIController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.config = this.#readConfig();
    this.token = "";
    this.lastContext = null;
    // Remove credentials saved by the foundation build. Secrets now remain in memory only.
    sessionStorage.removeItem(LEGACY_CONFIG_KEY);
    this.events.subscribe("identify:complete", (payload) => {
      this.lastContext = payload;
    });
  }

  configure(config) {
    const provider = config.provider || "ollama";
    const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.ollama;
    this.config = {
      provider,
      endpoint: (config.endpoint || defaults.endpoint).trim().replace(/\/$/, ""),
      model: (config.model || defaults.model).trim(),
    };
    this.token = config.token?.trim() || "";
    if (!this.config.endpoint) throw new Error("An AI endpoint URL is required.");
    if (!this.config.model) throw new Error("An AI model is required.");
    if (provider !== "ollama" && !this.token) {
      throw new Error("An API token is required for this online provider.");
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    this.events.publish("ai:configured", { config: { ...this.config } });
  }

  async testConnection(config) {
    const endpoint = (config?.endpoint || PROVIDER_DEFAULTS.ollama.endpoint).trim().replace(/\/$/, "");
    const model = (config?.model || "").trim();
    if ((config?.provider || "ollama") !== "ollama") {
      throw new Error("The connection test currently supports local Ollama only.");
    }
    const response = await this.#fetchOllama(`${endpoint}/api/tags`, {}, endpoint);
    if (!response.ok) throw new Error(`Ollama returned ${response.status} while listing models.`);
    const payload = await response.json();
    const models = (payload.models ?? []).map((item) => item.name || item.model).filter(Boolean);
    if (model && !models.includes(model)) {
      const suggestion = models.find((name) => name === model || name.startsWith(`${model}:`));
      const installed = models.length ? models.join(", ") : "none reported";
      throw new Error(
        suggestion
          ? `Connected to Ollama, but use the exact model tag “${suggestion}”.`
          : `Connected to Ollama, but “${model}” is not installed. Installed models: ${installed}.`,
      );
    }
    return { endpoint, models };
  }

  disable() {
    this.config = null;
    this.token = "";
    localStorage.removeItem(CONFIG_KEY);
    sessionStorage.removeItem(LEGACY_CONFIG_KEY);
    this.events.publish("ai:disabled");
  }

  isConfigured() {
    if (!this.config?.endpoint || !this.config?.model) return false;
    return this.config.provider === "ollama" || Boolean(this.token);
  }

  async ask(prompt, context = this.lastContext) {
    if (!this.isConfigured()) throw new Error("Configure an AI provider from Tools first.");
    const system = AI_SYSTEM_PROMPT;
    const mapContext = this.#compactContext(context);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: `Map context:\n${JSON.stringify(mapContext)}\n\nQuestion: ${prompt}` },
    ];
    this.events.publish("ai:start");
    try {
      let text;
      if (this.config.provider === "ollama") {
        const response = await this.#fetchOllama(`${this.config.endpoint}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.config.model, messages, stream: false }),
        }, this.config.endpoint, 120000);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(
              `Ollama could not find “${this.config.model}”. Open Tools → Configure AI, use the exact installed model tag, and test again.`,
            );
          }
          throw new Error(`Ollama returned ${response.status}.`);
        }
        text = (await response.json()).message?.content;
      } else if (this.config.provider === "anthropic") {
        const response = await fetch(`${this.config.endpoint}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.token,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: this.config.model,
            max_tokens: 1200,
            system,
            messages: [{ role: "user", content: messages[1].content }],
          }),
        });
        if (!response.ok) throw new Error(`Anthropic returned ${response.status}.`);
        const payload = await response.json();
        text = payload.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n");
      } else {
        const response = await fetch(`${this.config.endpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ model: this.config.model, messages }),
        });
        if (!response.ok) throw new Error(`AI endpoint returned ${response.status}.`);
        text = (await response.json()).choices?.[0]?.message?.content;
      }
      this.events.publish("ai:complete", { text: text || "No response returned." });
      return text;
    } catch (error) {
      this.events.publish("ai:error", { error });
      throw error;
    }
  }

  async #fetchOllama(url, options, endpoint, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      const origin = globalThis.location?.origin || "this site";
      if (error?.name === "AbortError") {
        throw new Error(`Ollama at ${endpoint} did not respond before the connection timed out.`);
      }
      if (error instanceof TypeError || /failed to fetch|network/i.test(error?.message || "")) {
        throw new Error(
          `Ollama at ${endpoint} could not be reached from ${origin}. ` +
          `It may be offline or blocking this origin; open Tools → Configure AI for setup instructions.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  #compactContext(context) {
    const layers = this.mapController.getAllLayerConfigs()
      .map(({ title, type, url }) => ({ title, type, url }));
    return buildAIMapContext(context, layers);
  }

  #readConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY));
    } catch {
      return null;
    }
  }
}
