"use strict";

importScripts("api.js", "links.js", "rules.js", "redirects.js", "metrics.js", "redirectlog.js");

// Listeners first, synchronously, so events can wake the worker.
startMetrics();
startRedirectLog();
startRules();
