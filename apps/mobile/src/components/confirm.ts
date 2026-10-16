/**
 * Asks a yes/no question. On the web this is the browser's own dialog,
 * which every browser renders accessibly; native builds will need Alert.
 */
export async function confirm(message: string): Promise<boolean> {
  return typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : true;
}
