export function greet(name: string): string {
  return `Hello, ${name}!`;
}
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}
