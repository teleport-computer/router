let JSON_MODE = false;

export function setJsonMode(on) { JSON_MODE = on; }
export function isJsonMode() { return JSON_MODE; }

export function emit(textPayload, jsonPayload) {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(jsonPayload) + '\n');
  } else {
    process.stdout.write(textPayload + '\n');
  }
}

export function note(text) {
  if (!JSON_MODE) process.stdout.write(text + '\n');
}

export function fail(message, exitCode = 1) {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ ok: false, error: message }) + '\n');
  } else {
    process.stderr.write(message + '\n');
  }
  process.exit(exitCode);
}
