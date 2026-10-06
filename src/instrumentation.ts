// Next's Webpack compiler discovers instrumentation beside src/app.
// Keep one startup implementation for both Webpack and Turbopack builds.
export { register } from '../instrumentation';
