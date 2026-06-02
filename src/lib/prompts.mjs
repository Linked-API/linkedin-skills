// Thin wrappers over @clack/prompts — the ONLY module that touches the TTY. Imported solely by
// the interactive frontend (wizard.mjs). A cancelled prompt throws PromptCancelled so the wizard
// can unwind cleanly.
import * as clack from '@clack/prompts';

export class PromptCancelled extends Error {}

function unwrap(value) {
  if (clack.isCancel(value)) throw new PromptCancelled();
  return value;
}

export function intro(message) {
  clack.intro(message);
}

export function outro(message) {
  clack.outro(message);
}

export function note(message, title) {
  clack.note(message, title);
}

export function cancel(message) {
  clack.cancel(message);
}

export function spinner() {
  return clack.spinner();
}

export async function select(options) {
  return unwrap(await clack.select(options));
}

export async function confirm(options) {
  return unwrap(await clack.confirm(options));
}

export async function password(options) {
  return unwrap(await clack.password(options));
}
