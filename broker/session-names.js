export const MAX_SESSION_LABEL_LENGTH = 200;

export const SESSION_NAMES = Object.freeze([
  "Aaron",
  "Abigail",
  "Adam",
  "Adrian",
  "Aisha",
  "Alice",
  "Amelia",
  "Andrew",
  "Anna",
  "Anthony",
  "Aria",
  "Arthur",
  "Aurora",
  "Ava",
  "Benjamin",
  "Caleb",
  "Camila",
  "Charlotte",
  "Chloe",
  "Clara",
  "Daniel",
  "David",
  "Dylan",
  "Eleanor",
  "Elena",
  "Elijah",
  "Elizabeth",
  "Ella",
  "Emily",
  "Emma",
  "Ethan",
  "Eva",
  "Evelyn",
  "Felix",
  "Gabriel",
  "George",
  "Grace",
  "Hannah",
  "Harper",
  "Hazel",
  "Henry",
  "Isaac",
  "Isabella",
  "Jack",
  "Jacob",
  "James",
  "Jasmine",
  "John",
  "Joseph",
  "Julia",
  "Julian",
  "Layla",
  "Leah",
  "Leo",
  "Levi",
  "Liam",
  "Lily",
  "Logan",
  "Lucas",
  "Lucy",
  "Luna",
  "Madison",
  "Maria",
  "Mason",
  "Mateo",
  "Max",
  "Maya",
  "Mia",
  "Michael",
  "Mila",
  "Naomi",
  "Natalie",
  "Nathan",
  "Nicholas",
  "Noah",
  "Nora",
  "Oliver",
  "Olivia",
  "Oscar",
  "Owen",
  "Penelope",
  "Rafael",
  "Rebecca",
  "Riley",
  "Rose",
  "Ruby",
  "Samuel",
  "Sara",
  "Scarlett",
  "Sebastian",
  "Simon",
  "Sofia",
  "Stella",
  "Theo",
  "Thomas",
  "Victoria",
  "Violet",
  "William",
  "Zachary",
  "Zoe",
]);

function preferredNameIndex(sessionId) {
  let hash = 2_166_136_261;
  for (let index = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % SESSION_NAMES.length;
}

export function chooseAvailableSessionName(sessionId, activeNames) {
  const start = preferredNameIndex(sessionId);
  for (let offset = 0; offset < SESSION_NAMES.length; offset += 1) {
    const candidate = SESSION_NAMES[(start + offset) % SESSION_NAMES.length];
    if (!activeNames.has(candidate)) return candidate;
  }
  return null;
}

export function formatNamedSessionLabel(baseLabel, name) {
  const suffix = ` · ${name}`;
  return `${baseLabel.slice(0, MAX_SESSION_LABEL_LENGTH - suffix.length)}${suffix}`;
}
