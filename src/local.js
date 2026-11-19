// What this desk already holds. Offline answers use only these lines.
// A citation is never added here.

export const LOCAL_LIMIT =
  "The research path is not reachable from here. Local. What is already known stays marked local.";

export const OFFLINE_MARK = "Offline.";

const FACTS = [
  {
    when: (q) =>
      /who are you|what are you|your name|galion research|what are we looking into/.test(q),
    say: "Galion Research. What are we looking into? Galion Research is a PhD-level research workspace, separate from Galion One, with its own memory. Developed by Galion Labs. Built in Rust. Open source under the MIT License.",
  },
  {
    when: (q) => /galion one/.test(q),
    say: "Galion One and Galion Research are different products. Galion Research is a PhD-level research workspace with its own memory. This desk can hand a voice across to Galion One. It is not a copy of the One page.",
  },
  {
    when: (q) => /ultra|per month|what does it cost|price/.test(q),
    say: "Ultra is $220/€220 per month.",
  },
  {
    when: (q) => /citation|cite a|sources? you/.test(q),
    say: "A citation is named only when a source was handed to this desk. Galion Research does not invent one.",
  },
  {
    when: (q) => /helper/.test(q),
    say: "Research may split a question across helpers on its own. The desk shows that as one quiet line.",
  },
  {
    when: (q) => /\b(ink|ice|sky|ocean|palette|colour|color)\b/.test(q),
    say: "The desk is Ink #0B0F14, Ice #B8E8FF, Sky #58C4FF, and Ocean #0B5FA5.",
  },
  {
    when: (q) => /hermes|gateway key|api key/.test(q),
    say: "The research engine runs on this machine. The gateway key stays in the server environment.",
  },
];

export function localKnowledge(question) {
  const q = question.toLowerCase();
  const known = FACTS.filter((fact) => fact.when(q)).map((fact) => fact.say);
  const reply = known.length
    ? `${OFFLINE_MARK} Local. ${known.join(" ")} The research path is not reachable from here.`
    : `${OFFLINE_MARK} ${LOCAL_LIMIT}`;
  return {
    reply,
    citations: [],
    found: [],
    inferred: [],
    unknown: [reply],
  };
}
