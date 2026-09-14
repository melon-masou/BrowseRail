import { describe, expect, it } from "vitest";

import { createRandomInstanceLabel, instanceLabelFromUid } from "./instance-label";

describe("instance labels", () => {
  it("derives a stable short label from the persistent instance identity", () => {
    expect(instanceLabelFromUid("12345678-1234-1234-1234-123456789abc")).toBe(
      "Browser-12345678",
    );
  });

  it("creates a short random browser label", () => {
    expect(createRandomInstanceLabel()).toMatch(/^Browser-[0-9a-f]{8}$/);
  });
});
