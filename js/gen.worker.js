/* ProtoSpace Analyzer — Web Worker that evaluates depth slices of the pattern field (js/field.js). */
import { withDefaults, generateRange } from './field.js';
self.onmessage = e => {
  const { id, settings, frame, z0, z1 } = e.data;
  const S = withDefaults(settings);
  const sizes = generateRange(S, frame, z0, z1);
  self.postMessage({ id, frame, z0, z1, sizes }, [sizes.buffer]);
};
