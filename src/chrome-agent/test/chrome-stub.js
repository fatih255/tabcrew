// Minimal chrome.* stub so extension modules can be imported under Node.
const ev = () => ({ addListener() {}, removeListener() {} });
globalThis.chrome = {
  debugger: { onEvent: ev(), onDetach: ev() },
  tabs: { onRemoved: ev(), onUpdated: ev() },
  webNavigation: { onCommitted: ev() },
  runtime: { onMessage: ev() },
};
