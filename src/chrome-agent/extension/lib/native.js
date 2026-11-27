// Native-messaging port lifecycle with jittered exponential backoff.
export const HOST_NAME = "com.tabcrew.chrome";

export class NativeLink {
  constructor({ onRequest, onState, helloInfo }) {
    this.onRequest = onRequest;
    this.helloInfo = helloInfo || (async () => ({}));
    this.onState = onState || (() => {});
    this.port = null;
    this.attempt = 0;
    this.timer = null;
    this.state = { connected: false, host: null, hostPid: null, lastError: null, since: null };
  }

  setState(patch) {
    Object.assign(this.state, patch);
    this.onState(this.state);
  }

  connect() {
    clearTimeout(this.timer);
    if (this.port) return;
    let port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (e) {
      this.setState({ connected: false, lastError: e.message });
      return this.scheduleReconnect();
    }
    this.port = port;
    port.onMessage.addListener((msg) => this.onMessage(msg));
    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || "disconnected";
      this.port = null;
      this.setState({ connected: false, lastError: err });
      this.scheduleReconnect();
    });
    this.sendHello();
  }

  /** Identify this browser to the host (also sent again after the user renames it). */
  async sendHello() {
    let info = {};
    try { info = await this.helloInfo(); } catch {}
    this.post({ type: "hello", extId: chrome.runtime.id, version: chrome.runtime.getManifest().version, ...info });
  }

  scheduleReconnect() {
    const base = Math.min(30000, 1000 * 2 ** Math.min(this.attempt, 5));
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  post(msg) {
    if (!this.port) return false;
    try { this.port.postMessage(msg); return true; } catch { return false; }
  }

  async onMessage(msg) {
    switch (msg?.type) {
      case "hello_ack":
        this.attempt = 0;
        this.setState({ connected: true, host: msg.host, hostPid: msg.pid, lastError: null, since: Date.now() });
        break;
      case "ping":
        this.post({ type: "pong", t: msg.t });
        break;
      case "pong":
        break;
      case "tool_request": {
        const resp = await this.onRequest(msg);
        this.post(resp);
        break;
      }
      case "cancel":
        this.onRequest({ type: "cancel", id: msg.id });
        break;
      default:
        break;
    }
  }
}
