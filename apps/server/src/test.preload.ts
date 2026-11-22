// `bun test` only (bunfig.toml's [test] preload): quiet logs unless a run asks for them
// with LOG_LEVEL, so a failure is not buried under request lines.
process.env['LOG_LEVEL'] ??= 'error';
