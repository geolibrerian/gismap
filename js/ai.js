const CONFIG_KEY = "gismap-online:ai-config:v2";
const LEGACY_CONFIG_KEY = "gismap-online:ai-config:v1";

const PROVIDER_DEFAULTS = {
  ollama: { endpoint: "http://localhost:11434", model: "llama3.2" },
  openai: { endpoint: "https://api.openai.com/v1", model: "gpt-5-mini" },
  anthropic: { endpoint: "https://api.anthropic.com/v1", model: "claude-sonnet-5" },
  "openai-compatible": { endpoint: "", model: "" },
};

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
    const system =
      "You are the GIS Map Online spatial analysis assistant. Use only the supplied map context. " +
      "Distinguish observations from inference and say when the loaded data cannot answer a question.";
    const mapContext = this.#compactContext(context);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: `Map context:\n${JSON.stringify(mapContext)}\n\nQuestion: ${prompt}` },
    ];
    this.events.publish("ai:start");
    try {
      let text;
      if (this.config.provider === "ollama") {
        const response = await fetch(`${this.config.endpoint}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.config.model, messages, stream: false }),
        });
        if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
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

  #compactContext(context) {
    if (!context) return { loadedLayers: this.mapController.getAllLayerConfigs() };
    return {
      coordinates: context.point
        ? { longitude: context.point.longitude, latitude: context.point.latitude }
        : null,
      address: context.address?.address ?? null,
      features: (context.results ?? []).slice(0, 20).map((result) => ({
        layer: result.layerTitle,
        attributes: result.attributes,
      })),
      loadedLayers: this.mapController.getAllLayerConfigs().map(({ title, type, url }) => ({ title, type, url })),
    };
  }

  #readConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY));
    } catch {
      return null;
    }
  }
}
