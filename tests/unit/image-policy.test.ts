import { describe, expect, it } from "vitest";
import { validateImageUpload } from "../../src/modules/media/image-policy.js";

describe("image upload policy", () => {
  it.each([
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    [
      "image/png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    ["image/webp", Buffer.from("RIFF1234WEBP")],
  ])("accepts %s with a matching signature", (mimetype, buffer) => {
    expect(() => validateImageUpload(mimetype, buffer)).not.toThrow();
  });

  it("rejects unsupported MIME types", () => {
    expect(() =>
      validateImageUpload("image/gif", Buffer.from("GIF89a")),
    ).toThrow("Only JPEG, PNG, and WebP images are supported");
  });

  it("rejects a MIME/signature mismatch", () => {
    expect(() =>
      validateImageUpload("image/png", Buffer.from("not an image")),
    ).toThrow("Uploaded file is not a valid image");
  });
});
