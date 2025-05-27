import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const docsDirectory = resolve(process.cwd(), "../../docs");

function readDocument(fileName: string): string {
  return readFileSync(resolve(docsDirectory, fileName), "utf8");
}

describe("engineering documentation", () => {
  it.each([
    "architecture.md",
    "protocol.md",
    "development.md",
    "operations.md",
    "case-study.md"
  ])("keeps %s as a titled Markdown document", (fileName) => {
    expect(readDocument(fileName)).toMatch(/^# .+/);
  });

  it("documents the server-authoritative flow and room lifecycle", () => {
    const architecture = readDocument("architecture.md");

    expect(architecture).toContain("```mermaid");
    expect(architecture).toContain("PongSimulation.step");
    expect(architecture).toContain("MatchResultRepository.finalizeMatch");
    expect(architecture).toContain("waiting");
    expect(architecture).toContain("reconnecting");
    expect(architecture).toContain("finished");
  });

  it("records the versioned protocol and reconnect contract", () => {
    const protocol = readDocument("protocol.md");

    for (const term of [
      "POST /auth/ws-ticket",
      "v: 1",
      "inputSeq",
      "sequence",
      "15초",
      "45초",
      "```mermaid"
    ]) {
      expect(protocol).toContain(term);
    }
  });

  it("keeps repeatable local verification commands in the development guide", () => {
    const development = readDocument("development.md");

    for (const command of [
      "pnpm unit",
      "pnpm postgres-integration",
      "pnpm smoke:http",
      "pnpm smoke:ws",
      "pnpm e2e",
      "pnpm build",
      "pnpm verify:build"
    ]) {
      expect(development).toContain(command);
    }
  });

  it("documents readiness, graceful shutdown, metrics, and the migration job", () => {
    const operations = readDocument("operations.md");

    for (const term of [
      "/health/live",
      "/health/ready",
      "/metrics",
      "SIGTERM",
      "60초",
      "migrate"
    ]) {
      expect(operations).toContain(term);
    }
  });

  it("keeps unsupported claims and template inputs out of the case study", () => {
    const caseStudy = readDocument("case-study.md");

    expect(caseStudy).toContain("## 확인 범위");
    expect(caseStudy).toContain(
      "저장소만으로 확인할 수 없는 내용은 포함하지 않습니다."
    );
    expect(caseStudy).not.toMatch(
      /^- (본인 역할|성과 수치|지원 직무):\s*$/m
    );
  });
});
