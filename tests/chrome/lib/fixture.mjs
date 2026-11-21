import { buildExtension, removeBuild } from "./extension.mjs";
import { Chrome } from "./chrome.mjs";

/** Start headless Chrome with a fresh copy of the extension installed. */
export async function startChrome() {
  const build = buildExtension();
  const chrome = new Chrome(build.profile);
  try {
    await chrome.start();
    await chrome.loadExtension(build.dir);
    // Rules are installed asynchronously after the service worker starts.
    await chrome.waitWorkerLog("GoLinks: extension loaded");
  } catch (e) {
    await chrome.stop();
    removeBuild(build.root);
    throw e;
  }
  return {
    chrome,
    dir: build.dir,
    async stop() {
      await chrome.stop();
      removeBuild(build.root);
    },
  };
}
