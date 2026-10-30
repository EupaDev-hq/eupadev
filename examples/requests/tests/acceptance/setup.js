// Starts the test stack once for the run (no-op when kept up by KIT_KEEP=1) and stops it at the end.
import { startStack, stopStack } from '../stack.js';

export default function setup() {
  process.env.REQUESTS_ADMIN_URL = startStack();
  return stopStack;
}
