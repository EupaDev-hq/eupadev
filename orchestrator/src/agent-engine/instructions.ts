/**
 * Role instructions (note `docs/reflexions/2026-10-15-note-consignes-agents.md`, decision 1 and correction 1; ROADMAP
 * §8.8 no. 5): they come from the engine image, NEVER from the cloned repository (data that an agent may have written).
 * Instructions of a role = `AGENTS.md` + `agents/<role>.md` + the role's domain rules (`.claude/rules/*.md`, without their
 * `paths:` frontmatter), read once at startup in `INSTRUCTIONS_PATH` (the template folder in dev, `/app/instructions`
 * in the image). Fail-closed: a missing or empty file, an invisible character = refusal to start.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Role } from '../external/contracts.ts';
import { invisibleCharacter } from '../text.ts';

export const ROLES: readonly Role[] = ['overlap', 'scoping', 'contract', 'tests', 'builder', 'security-reviewer', 'quality-reviewer'];

/**
 * Domain rules included in the instructions of each role (those its prompt cites). The rules keep their domain names
 * (`backend.md` = API and data rules, `frontend.md` = interface rules): the builder receives both
 * (ADR-021). Word caps (A-R6, C3, `tests/instructions.test.ts`): charter 500, role 400, rule file 300.
 */
export const RULES_BY_ROLE: Record<Role, readonly string[]> = {
  overlap: [],
  scoping: ['frontend'],
  contract: ['backend', 'security'],
  tests: ['tests'],
  builder: ['backend', 'frontend', 'security', 'quality'],
  'security-reviewer': ['security', 'tests'],
  'quality-reviewer': ['quality', 'backend', 'frontend', 'tests'],
};

export type InstructionsByRole = Readonly<Record<Role, string>>;

/** Body of a rule without its YAML frontmatter (`paths:` only serves on-demand loading in interactive mode). */
export function withoutFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

/** Pure assembly: charter, role prompt, rules, separated by an empty line. */
export function assembler(charter: string, prompt: string, rules: readonly string[]): string {
  return `${[charter, prompt, ...rules].map((t) => t.trimEnd()).join('\n\n')}\n`;
}

export function loadInstructions(dir: string): InstructionsByRole {
  const read = (path: string): string => {
    let text: string;
    try {
      text = readFileSync(join(dir, path), 'utf8');
    } catch (e) {
      throw new Error(`agents' instructions: ${path} unreadable in ${dir} (${(e as Error).message})`);
    }
    if (text.trim() === '') throw new Error(`agents' instructions: ${path} empty`);
    const invisible = invisibleCharacter(text);
    if (invisible !== null) throw new Error(`agents' instructions: invisible character in ${path} (${invisible})`);
    return text;
  };
  const charter = read('AGENTS.md');
  const rules = new Map<string, string>();
  const rule = (name: string) => {
    if (!rules.has(name)) rules.set(name, withoutFrontmatter(read(join('.claude', 'rules', `${name}.md`))));
    return rules.get(name)!;
  };
  const instructions = {} as Record<Role, string>;
  for (const role of ROLES) instructions[role] = assembler(charter, read(join('agents', `${role}.md`)), RULES_BY_ROLE[role].map(rule));
  return instructions;
}
