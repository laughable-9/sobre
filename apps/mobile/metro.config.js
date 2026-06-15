// @ts-check
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * @stellar/stellar-sdk's root entry bundles Horizon, which statically
 * requires "eventsource" for streaming. eventsource itself requires Node's
 * "url"/"http"/"https", none of which exist on React Native. We only use
 * Soroban RPC reads (rpc.Server.simulateTransaction / getAccount), never
 * Horizon streaming, so eventsource is dead code here — stub it out so
 * Metro doesn't choke on the unavailable Node builtins.
 */
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "eventsource") {
    return {
      type: "empty",
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
