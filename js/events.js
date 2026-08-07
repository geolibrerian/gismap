/** A tiny pub/sub bus inspired by David Walsh's topic-based example. */
export class EventBus {
  #topics = new Map();

  subscribe(topic, listener) {
    if (!this.#topics.has(topic)) this.#topics.set(topic, new Set());
    this.#topics.get(topic).add(listener);
    return { remove: () => this.#topics.get(topic)?.delete(listener) };
  }

  publish(topic, payload = {}) {
    for (const listener of this.#topics.get(topic) ?? []) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Subscriber failed for ${topic}`, error);
      }
    }
  }

  clear(topic) {
    topic ? this.#topics.delete(topic) : this.#topics.clear();
  }
}

export const events = new EventBus();
