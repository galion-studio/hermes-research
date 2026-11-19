// Loopback host check. Kept out of the Hermes client so a health read does not load it.

export function isLoopback(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, "").toLowerCase();
  if (host.includes(":")) {
    return expandV6(host) === "0000:0000:0000:0000:0000:0000:0000:0001";
  }
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => n > 255)) return false;
  return nums[0] === 127;
}

function expandV6(host) {
  const [head, tail] = host.split("::");
  if (host.split("::").length > 2) return "";
  const left = head ? head.split(":").filter(Boolean) : [];
  const right = tail ? tail.split(":").filter(Boolean) : [];
  if (left.length + right.length > 8) return "";
  const mid = Array(8 - left.length - right.length).fill("0");
  return [...left, ...mid, ...right].map((part) => part.padStart(4, "0")).join(":");
}
