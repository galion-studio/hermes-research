// Research sound cues. 432 Hz just intonation. Definitions only.
// No voice audio, no clones, no wav files.

export const RESEARCH_A = 432;

export const RESEARCH_CUES = Object.freeze([
  Object.freeze({ id: "ask", ratio: "1:1", hz: 432 }),
  Object.freeze({ id: "listen", ratio: "1:1", hz: 432 }),
  Object.freeze({ id: "helper", ratio: "5:4", hz: 540 }),
  Object.freeze({ id: "local", ratio: "2:3", hz: 288 }),
  Object.freeze({ id: "returned", ratio: "3:2", hz: 648 }),
  Object.freeze({ id: "hide", ratio: "1:2", hz: 216 }),
  Object.freeze({ id: "show", ratio: "2:1", hz: 864 }),
  Object.freeze({ id: "leave", ratio: "1:4", hz: 108 }),
]);

export function cueHz(ratio, a = RESEARCH_A) {
  const [num, den] = ratio.split(":").map(Number);
  return (a * num) / den;
}
