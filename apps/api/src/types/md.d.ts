// Prompts are versioned markdown files (CLAUDE.md rule 7), bundled as text.
declare module '*.md' {
  const text: string;
  export default text;
}
