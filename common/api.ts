// Namespace shim, loaded before every other script. Firefox exposes `browser`
// and Chrome only `chrome`; both return Promises from the MV3 APIs used here.
const api: Api = globalThis.browser ?? globalThis.chrome!;
