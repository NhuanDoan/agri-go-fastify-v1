import { describe, expect, it } from "vitest";
import { slugify } from "../../src/common/utils/slugify.js";

describe("slugify", () => {
  it.each([
    ["Rau củ quả", "rau-cu-qua"],
    ["Gạo & ngũ cốc", "gao-ngu-coc"],
    ["Đường phèn", "duong-phen"],
    ["  Hello,   World!  ", "hello-world"],
    ["100% Organic", "100-organic"],
    ["---", ""],
  ])("%s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("maps different spellings of the same words to one slug", () => {
    expect(slugify("Rau củ quả")).toBe(slugify("Rau cu qua"));
  });
});
