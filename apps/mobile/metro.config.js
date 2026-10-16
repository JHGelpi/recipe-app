const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @powersync/web publishes its entry points through package "exports".
config.resolver.unstable_enablePackageExports = true;

// Metro defaults to one worker per CPU core, which exhausts memory on
// machines with many cores and little RAM (e.g. WSL capped at 2 GB).
config.maxWorkers = Number(process.env.METRO_MAX_WORKERS) || 2;

module.exports = config;
