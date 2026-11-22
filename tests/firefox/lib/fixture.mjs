import path from "node:path";
import { buildExtension, removeBuild } from "./extension.mjs";
import { Firefox } from "./firefox.mjs";

/** Start headless Firefox with a fresh copy of the extension installed. */
export async function startFirefox(extraPrefs = {}) {
  const build = buildExtension();
  const ff = new Firefox(path.join(build.root, "geckodriver.log"), extraPrefs);
  try {
    await ff.start();
    await ff.installAddon(build.dir);
    // Rules are installed asynchronously after the background page starts.
    await ff.waitLog("GoLinks: rules updated successfully");
  } catch (e) {
    await ff.stop();
    removeBuild(build.root);
    throw e;
  }
  return {
    ff,
    dir: build.dir,
    async stop() {
      await ff.stop();
      removeBuild(build.root);
    },
  };
}
